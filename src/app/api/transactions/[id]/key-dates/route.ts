import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { isAgentUser } from '@/lib/agentPortal';
import {
  canAccessTransactionDates,
  cleanLabel,
  isKeyDateKind,
  isValidIsoDate,
  KEY_DATE_LABELS,
  type KeyDateKind,
} from '@/lib/keyDates';

// GET: the critical dates for one transaction.
// POST: add one date ({ kind, label?, dueDate, notifyAgent? }) or many at once
// ({ dates: [...] }, used when a contract is first uploaded). Extracted dates
// replace any earlier 'contract'-sourced date of the same kind so re-uploading
// a contract never duplicates them.

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: transactionId } = await params;
    const { user, isAdmin } = await getUserFromRequest(request);
    if (isAgentUser(user)) {
      return NextResponse.json({ error: 'Not available' }, { status: 403 });
    }
    if (!(await canAccessTransactionDates(transactionId, user.id, isAdmin))) {
      return NextResponse.json({ error: 'You do not have permission to view this transaction' }, { status: 403 });
    }

    const { data, error } = await supabaseServer
      .from('transaction_key_dates')
      .select('*')
      .eq('transaction_id', transactionId)
      .order('due_date', { ascending: true });
    if (error) throw error;
    return NextResponse.json(data || []);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching key dates:', error);
    return NextResponse.json({ error: 'Failed to load critical dates' }, { status: 500 });
  }
}

interface IncomingDate {
  kind?: unknown;
  label?: unknown;
  dueDate?: unknown;
  notifyAgent?: unknown;
  source?: unknown;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: transactionId } = await params;
    const { user, isAdmin } = await getUserFromRequest(request);
    if (isAgentUser(user)) {
      return NextResponse.json({ error: 'Not available' }, { status: 403 });
    }
    await assertTrialActive(user);
    if (!(await canAccessTransactionDates(transactionId, user.id, isAdmin))) {
      return NextResponse.json({ error: 'You do not have permission to edit this transaction' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const incoming: IncomingDate[] = Array.isArray(body?.dates) ? body.dates : [body];
    if (incoming.length === 0 || incoming.length > 20) {
      return NextResponse.json({ error: 'Provide between 1 and 20 dates' }, { status: 400 });
    }

    const rows = [];
    for (const item of incoming) {
      if (!isValidIsoDate(item?.dueDate)) {
        return NextResponse.json({ error: 'Each date needs a valid dueDate (YYYY-MM-DD)' }, { status: 400 });
      }
      const kind: KeyDateKind = isKeyDateKind(item.kind) ? item.kind : 'custom';
      const source = item.source === 'contract' ? 'contract' : 'manual';
      rows.push({
        transaction_id: transactionId,
        kind,
        label: cleanLabel(item.label, KEY_DATE_LABELS[kind]),
        due_date: item.dueDate as string,
        source,
        notify_agent: item.notifyAgent === true,
      });
    }

    // A re-upload of a contract replaces the dates it produced earlier.
    const contractKinds = rows.filter((r) => r.source === 'contract' && r.kind !== 'custom').map((r) => r.kind);
    if (contractKinds.length > 0) {
      await supabaseServer
        .from('transaction_key_dates')
        .delete()
        .eq('transaction_id', transactionId)
        .eq('source', 'contract')
        .in('kind', contractKinds);
    }

    const { data, error } = await supabaseServer.from('transaction_key_dates').insert(rows).select('*');
    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof TrialExpiredError) {
      return NextResponse.json({ error: error.message, code: 'trial_expired' }, { status: error.status });
    }
    console.error('Error saving key dates:', error);
    return NextResponse.json({ error: 'Failed to save critical dates' }, { status: 500 });
  }
}
