import { isFeatureOn } from './features';
import { supabaseServer } from './supabase';
import { matchDocumentToTasks, type MatchTask } from './documentMatch';
import { dealAutomationOwner, emitDealEvent } from './automation/events';
import { userMayAutomate } from './automation/plan';

// Connects an uploaded document to the checklist (Pro/Team automation). It only ever does three things:
//   1. a confident match marks the step "received, needs review" and clears "waiting on", which stops its follow-ups;
//   2. an unclear match, or a possible duplicate upload, tells the owner and changes nothing;
//   3. it never completes a step. A person reviews the document and completes the step.
// Best effort: it never fails or delays the upload that triggered it.

async function tell(ownerUserId: string, transactionId: string, title: string, body: string): Promise<void> {
  try {
    await supabaseServer.from('notifications').insert({
      recipient_user_id: ownerUserId,
      actor_user_id: null,
      transaction_id: transactionId,
      event_type: 'assistant',
      title: title.slice(0, 160),
      body: body.slice(0, 160),
      link: `/dashboard/transactions/${transactionId}`,
    });
  } catch (error) {
    console.error('Document sync notification failed (ignored):', error);
  }
}

export interface UploadedDoc {
  id: string;
  file_name: string;
  file_size: number | null;
  document_type: string | null;
  task_id: string | null;
}

export async function syncDocumentToChecklist(transactionId: string, doc: UploadedDoc): Promise<void> {
  try {
    if (!isFeatureOn('automation')) return;
    const ownerUserId = await dealAutomationOwner(transactionId);
    if (!ownerUserId) return;
    const { data: owner } = await supabaseServer.auth.admin.getUserById(ownerUserId);
    if (!owner.user || !userMayAutomate(owner.user)) return;

    const { data: dup } = doc.file_size
      ? await supabaseServer.from('documents').select('id').eq('transaction_id', transactionId).eq('file_name', doc.file_name).eq('file_size', doc.file_size).neq('id', doc.id).limit(1)
      : { data: null };
    if (dup && dup.length > 0) await tell(ownerUserId, transactionId, 'Possible duplicate document', `${doc.file_name} looks like a file already on this deal.`);

    const { data: tasks } = await supabaseServer.from('tasks').select('id, name, completed, waiting_on').eq('transaction_id', transactionId).limit(500);
    const match = matchDocumentToTasks({ documentType: doc.document_type ?? '', taskId: doc.task_id }, (tasks ?? []) as MatchTask[]);

    if (match.kind === 'ambiguous') {
      await tell(ownerUserId, transactionId, 'Which step is this document for?', `${doc.file_name} could belong to more than one step. Nothing was changed.`);
      return;
    }
    if (match.kind !== 'match') return;

    const step = (tasks ?? []).find((t) => t.id === match.taskId);
    const { error } = await supabaseServer
      .from('tasks')
      .update({ received_at: new Date().toISOString(), received_document_id: doc.id, needs_review: true, waiting_on: null, waiting_on_since: null })
      .eq('id', match.taskId)
      .eq('transaction_id', transactionId)
      .eq('completed', false);
    if (error) {
      if (error.code !== '42703') console.error('Document sync could not update the step:', error); // 42703: add-task-documents.sql not run yet
      return;
    }
    if (!doc.task_id) await supabaseServer.from('documents').update({ task_id: match.taskId }).eq('id', doc.id).is('task_id', null);
    await emitDealEvent(transactionId, 'task_received', { taskId: match.taskId, name: step?.name ?? '', documentId: doc.id });
    await tell(ownerUserId, transactionId, 'Document received: review it', `${doc.file_name} arrived for "${step?.name ?? 'a step'}". Review it, then complete the step.`);
  } catch (error) {
    console.error('Document sync failed (ignored):', error);
  }
}
