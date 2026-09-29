'use client';

import { useEffect, useRef, useState, FormEvent, ChangeEvent } from 'react';
import { use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import { stagesForTaskNames } from '@/lib/transactionStages';
import { DOCUMENT_CATEGORIES, DEFAULT_CATEGORY_KEY, DEFAULT_DOCUMENT_TYPE, categoryLabel, typesForCategory } from '@/lib/documentTaxonomy';
import { DueDateSpec } from '@/lib/dueDates';
import DueDateControl from '@/components/DueDateControl';

interface Transaction {
  id: string;
  agent_id: string;
  file_number: string;
  property_address: string;
  purchase_price: number;
  status: string;
  checklist_template_name?: string | null;
  acceptance_date?: string | null;
  closing_date?: string | null;
}

interface Task {
  id: string;
  transaction_id: string;
  name: string;
  completed: boolean;
  due_date?: string | null;
  due_date_spec?: DueDateSpec | null;
}

interface Agent {
  id: string;
  name: string;
  commission_percent: number;
  flat_fee: number;
  email?: string | null;
  phone?: string | null;
}

// A person or company involved in this specific deal besides the agent
// (buyer, seller, lender, title/escrow, etc.) -- the agent's own contact
// info comes from the Agent record above instead, see the Deal Contacts
// section below.
interface Contact {
  id: string;
  transaction_id: string;
  role: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  position: number;
}

// A blank "add another contact" box that only becomes a real, saved
// Contact once the user types something into it and blurs -- so the
// handful of empty boxes we show by default never pollute the database.
interface DraftContact {
  draftId: string;
  role: string;
  name: string;
  email: string;
  phone: string;
}

interface Invoice {
  id: string;
  invoice_number: string;
  amount_owed: number;
  paid: boolean;
  due_date: string;
}

interface DocumentItem {
  id: string;
  transaction_id: string;
  task_id: string | null;
  category: string | null;
  document_type: string | null;
  file_name: string;
  storage_path: string;
  content_type: string | null;
  file_size: number | null;
  is_signed: boolean;
  requires_signature: boolean;
  created_at: string;
  url: string | null;
}

interface SigningRequestItem {
  id: string;
  document_id: string | null;
  signer_name: string;
  signer_email: string;
  source_file_name: string;
  status: 'pending' | 'signed' | 'voided' | 'declined';
  signed_at: string | null;
  signed_document_id: string | null;
  decline_reason?: string | null;
  created_at: string;
}

export default function TransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const resolvedParams = use(params);
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [signingRequests, setSigningRequests] = useState<SigningRequestItem[]>([]);
  const [requestingSignatureDocId, setRequestingSignatureDocId] = useState<string | null>(null);
  const [signerNameDraft, setSignerNameDraft] = useState('');
  const [signerEmailDraft, setSignerEmailDraft] = useState('');
  const [isSendingSignatureRequest, setIsSendingSignatureRequest] = useState(false);
  const [signatureRequestError, setSignatureRequestError] = useState<string | null>(null);
  const [agentName, setAgentName] = useState('');
  const [agent, setAgent] = useState<Agent | null>(null);

  // "Deal Contacts" section, directly under the Checklist card: the
  // agent (read-only here, sourced from `agent` above) plus any other
  // parties the TC types in by hand. `contacts` are rows already saved to
  // the database; `draftContacts` are blank/in-progress boxes that only
  // get POSTed once the user actually puts something in them (see
  // handleDraftContactBlur below).
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [draftContacts, setDraftContacts] = useState<DraftContact[]>([]);
  const [savingContactId, setSavingContactId] = useState<string | null>(null);
  const draftIdCounterRef = useRef(0);

  const makeDraftContact = (): DraftContact => {
    draftIdCounterRef.current += 1;
    return { draftId: `draft-${draftIdCounterRef.current}`, role: '', name: '', email: '', phone: '' };
  };
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [isCreatingInvoice, setIsCreatingInvoice] = useState(false);
  const [createInvoiceError, setCreateInvoiceError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [savingDateField, setSavingDateField] = useState<'acceptanceDate' | 'closingDate' | null>(null);
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const [isDeletingTransaction, setIsDeletingTransaction] = useState(false);

  // Switching this transaction's checklist template (separate from the
  // Settings page, which manages the templates themselves).
  const [templates, setTemplates] = useState<{ id: string; name: string; steps: { name: string; dueDate?: DueDateSpec | null }[] }[]>([]);
  const [isChangingTemplate, setIsChangingTemplate] = useState(false);
  const [templateSelection, setTemplateSelection] = useState('');
  const [isSavingTemplateChange, setIsSavingTemplateChange] = useState(false);
  const [templateChangeError, setTemplateChangeError] = useState<string | null>(null);

  // Document management: category-based upload form + search + per-category
  // expand/collapse, kept separate from the checklist state above.
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadCategory, setUploadCategory] = useState(DOCUMENT_CATEGORIES[0].key);
  const [uploadDocType, setUploadDocType] = useState(DOCUMENT_CATEGORIES[0].types[0]);
  const [uploadStageTaskId, setUploadStageTaskId] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadRequiresSignature, setUploadRequiresSignature] = useState(true);
  const [docSearch, setDocSearch] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetchData();
    fetchTemplates();
    fetchSigningRequests();
  }, [resolvedParams.id]);

  // Available checklist templates for the switcher below — non-fatal if
  // this fails, the switcher just won't offer any options.
  const fetchTemplates = async () => {
    try {
      const res = await authFetch('/api/checklist-templates');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.templates)) setTemplates(data.templates);
    } catch {
      // ignore
    }
  };

  // Signature requests for this transaction's documents -- non-fatal if
  // this fails, the Documents section just won't show any status badges.
  const fetchSigningRequests = async () => {
    try {
      const res = await authFetch(`/api/signing-requests?transactionId=${resolvedParams.id}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) setSigningRequests(data);
    } catch {
      // ignore
    }
  };

  const handleRequestSignature = async (documentId: string) => {
    setSignatureRequestError(null);
    if (!signerNameDraft.trim() || !signerEmailDraft.trim()) {
      setSignatureRequestError("Enter the signer's name and email.");
      return;
    }
    try {
      setIsSendingSignatureRequest(true);
      const response = await authFetch('/api/signing-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId,
          signerName: signerNameDraft.trim(),
          signerEmail: signerEmailDraft.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to send signature request');
      setSigningRequests((prev) => [data, ...prev]);
      setRequestingSignatureDocId(null);
      setSignerNameDraft('');
      setSignerEmailDraft('');
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setSignatureRequestError(error instanceof Error ? error.message : 'Failed to send signature request');
    } finally {
      setIsSendingSignatureRequest(false);
    }
  };

  const [voidingSigningRequestId, setVoidingSigningRequestId] = useState<string | null>(null);
  const handleVoidSigningRequest = async (signingRequestId: string) => {
    if (!confirm('Void this signature request? The link will stop working and you can send a new one.')) return;
    try {
      setVoidingSigningRequestId(signingRequestId);
      const response = await authFetch(`/api/signing-requests/${signingRequestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'void' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to void signing request');
      setSigningRequests((prev) =>
        prev.map((r) => (r.id === signingRequestId ? { ...r, status: 'voided' } : r))
      );
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      alert(error instanceof Error ? error.message : 'Failed to void signing request');
    } finally {
      setVoidingSigningRequestId(null);
    }
  };

  const fetchData = async () => {
    try {
      const [txRes, tasksRes, agentsRes, docsRes, invoicesRes, contactsRes] = await Promise.all([
        authFetch('/api/transactions'),
        authFetch(`/api/tasks?transactionId=${resolvedParams.id}`),
        authFetch('/api/agents'),
        authFetch(`/api/documents?transactionId=${resolvedParams.id}`),
        authFetch(`/api/invoices?transactionId=${resolvedParams.id}`),
        authFetch(`/api/transactions/${resolvedParams.id}/contacts`),
      ]);

      const txData = await txRes.json();
      const tasksData = await tasksRes.json();
      const agentsData = await agentsRes.json();
      const docsData = await docsRes.json();
      const invoicesData = await invoicesRes.json();
      const contactsData = await contactsRes.json();

      if (!Array.isArray(txData)) {
        throw new Error(`Transactions API error: ${JSON.stringify(txData)}`);
      }
      if (!Array.isArray(tasksData)) {
        throw new Error(`Tasks API error: ${JSON.stringify(tasksData)}`);
      }
      if (!Array.isArray(agentsData)) {
        throw new Error(`Agents API error: ${JSON.stringify(agentsData)}`);
      }

      const tx = txData.find((t: Transaction) => t.id === resolvedParams.id);
      setTransaction(tx || null);
      setTasks(tasksData);
      setDocuments(Array.isArray(docsData) ? docsData : []);
      setInvoice(Array.isArray(invoicesData) && invoicesData.length > 0 ? invoicesData[0] : null);

      const savedContacts = Array.isArray(contactsData) ? contactsData : [];
      setContacts(savedContacts);
      // Always keep at least 3 blank boxes on hand to fill in, regardless
      // of how many are already saved -- "keep adding" is handled
      // separately by the Add button appending more on top of this floor.
      const blankBoxesNeeded = Math.max(0, 3 - savedContacts.length);
      setDraftContacts(Array.from({ length: blankBoxesNeeded }, () => makeDraftContact()));

      if (tx) {
        const matchedAgent = agentsData.find((a: Agent) => a.id === tx.agent_id);
        setAgentName(matchedAgent?.name || 'Unknown');
        setAgent(matchedAgent || null);
      }
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('Error fetching data:', errorMsg);
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // --- Deal Contacts: draft (unsaved) boxes ---

  const handleDraftContactChange = (draftId: string, field: 'role' | 'name' | 'email' | 'phone', value: string) => {
    setDraftContacts((prev) => prev.map((d) => (d.draftId === draftId ? { ...d, [field]: value } : d)));
  };

  const handleAddDraftContact = () => {
    setDraftContacts((prev) => [...prev, makeDraftContact()]);
  };

  const handleRemoveDraftContact = (draftId: string) => {
    // Never saved, so this is purely local -- no API call.
    setDraftContacts((prev) => prev.filter((d) => d.draftId !== draftId));
  };

  // Fires on blur of any field in a draft box. A still-empty box is left
  // alone (that's the whole point of drafts); one with something typed
  // gets POSTed and promoted into `contacts`, then replaced with a fresh
  // blank draft so there's always a box ready to type into.
  const handleDraftContactBlur = async (draftId: string) => {
    const draft = draftContacts.find((d) => d.draftId === draftId);
    if (!draft) return;
    if (!draft.role.trim() && !draft.name.trim() && !draft.email.trim() && !draft.phone.trim()) return;

    setSavingContactId(draftId);
    try {
      const response = await authFetch(`/api/transactions/${resolvedParams.id}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: draft.role, name: draft.name, email: draft.email, phone: draft.phone }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.error || 'Failed to save contact');
      }
      setContacts((prev) => [...prev, result]);
      setDraftContacts((prev) => prev.filter((d) => d.draftId !== draftId));
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      console.error('Error saving contact:', error);
      alert('Failed to save that person. Check console for details.');
    } finally {
      setSavingContactId(null);
    }
  };

  // --- Deal Contacts: saved (persisted) rows ---

  const handleContactChange = (contactId: string, field: 'role' | 'name' | 'email' | 'phone', value: string) => {
    setContacts((prev) => prev.map((c) => (c.id === contactId ? { ...c, [field]: value } : c)));
  };

  const handleContactBlur = async (contactId: string, field: 'role' | 'name' | 'email' | 'phone', value: string) => {
    setSavingContactId(contactId);
    try {
      const response = await authFetch(`/api/transaction-contacts/${contactId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result?.error || 'Failed to update contact');
      }
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      console.error('Error updating contact:', error);
      alert('Failed to save that change. Check console for details.');
    } finally {
      setSavingContactId(null);
    }
  };

  const handleRemoveContact = async (contactId: string) => {
    const previousContacts = contacts;
    setContacts((prev) => prev.filter((c) => c.id !== contactId));
    try {
      const response = await authFetch(`/api/transaction-contacts/${contactId}`, { method: 'DELETE' });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result?.error || 'Failed to remove contact');
      }
    } catch (error) {
      setContacts(previousContacts);
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      console.error('Error removing contact:', error);
      alert('Failed to remove that person. Check console for details.');
    }
  };

  const handleToggleTask = async (taskId: string) => {
    // Optimistic update so the checkbox responds instantly instead of
    // waiting on the round trip.
    const previousTasks = tasks;
    const previousTransaction = transaction;
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, completed: !t.completed } : t)));

    try {
      const response = await authFetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(`Failed to toggle task: ${JSON.stringify(result)}`);
      }

      // Reconcile with the server's view (it may have auto-advanced or
      // rolled back the status) without a full page refetch.
      if (Array.isArray(result.tasks)) {
        setTasks(result.tasks);
      }
      if (result.status) {
        setTransaction((prev) => (prev && prev.status !== result.status ? { ...prev, status: result.status } : prev));
      }
    } catch (error) {
      setTasks(previousTasks);
      setTransaction(previousTransaction);
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      console.error('Error toggling task:', error);
      alert('Failed to toggle task. Check console for details.');
    }
  };

  // Per-task due-date editing -- a small "Edit" affordance next to each
  // task's due date, independent of the account-level due-date workflow
  // (Settings) and whatever checklist template was used. Only one task's
  // editor is open at a time, kept deliberately lightweight (no modal) so
  // the checklist doesn't get crowded.
  const [editingDueDateTaskId, setEditingDueDateTaskId] = useState<string | null>(null);
  const [editingDueDateValue, setEditingDueDateValue] = useState<DueDateSpec>({ mode: 'none' });
  const [isSavingDueDate, setIsSavingDueDate] = useState(false);

  const startEditDueDate = (task: Task) => {
    setEditingDueDateTaskId(task.id);
    setEditingDueDateValue(task.due_date_spec ?? { mode: 'none' });
  };

  const cancelEditDueDate = () => setEditingDueDateTaskId(null);

  const saveDueDate = async (taskId: string) => {
    setIsSavingDueDate(true);
    try {
      const response = await authFetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dueDate: editingDueDateValue }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to update due date');

      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, due_date: result.due_date, due_date_spec: result.due_date_spec } : t
        )
      );
      setEditingDueDateTaskId(null);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      console.error('Error updating due date:', error);
      alert('Failed to update due date. Check console for details.');
    } finally {
      setIsSavingDueDate(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!transaction || newStatus === transaction.status) return;

    try {
      setIsUpdatingStatus(true);
      const response = await authFetch(`/api/transactions/[id]?id=${transaction.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) {
        throw new Error('Failed to update transaction status');
      }

      const updated = await response.json();
      const { tasks: syncedTasks, ...transactionFields } = updated;
      setTransaction(transactionFields);
      // The checklist may have just been auto-checked/reopened to match —
      // apply the rows the server already computed instead of refetching.
      if (Array.isArray(syncedTasks)) {
        setTasks(syncedTasks);
      }

      if (newStatus === 'Closed') {
        alert('Transaction marked as closed. Create an invoice below when you\'re ready.');
      }
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      console.error('Error updating status:', error);
      alert('Failed to update transaction status. Check console for details.');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // Editing the acceptance/closing anchor dates from the transaction page
  // itself (the only other place they can be set is at creation time, on
  // the New Transaction form). Either date change makes the server
  // recompute every task's due_date -- see PATCH /api/transactions/[id]
  // and lib/dueDates.ts -- so we apply the tasks it hands back the same
  // way handleStatusChange does, instead of refetching.
  const handleDateFieldChange = async (field: 'acceptanceDate' | 'closingDate', value: string) => {
    if (!transaction) return;

    try {
      setSavingDateField(field);
      const response = await authFetch(`/api/transactions/[id]?id=${transaction.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value || null }),
      });

      if (!response.ok) {
        throw new Error('Failed to update date');
      }

      const updated = await response.json();
      const { tasks: updatedTasks, ...transactionFields } = updated;
      setTransaction(transactionFields);
      if (Array.isArray(updatedTasks)) {
        setTasks(updatedTasks);
      }
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      console.error('Error updating date:', error);
      alert('Failed to update date. Check console for details.');
    } finally {
      setSavingDateField(null);
    }
  };

  const startChangingTemplate = () => {
    setTemplateChangeError(null);
    // Default the picker to the current template if we can find it in the
    // list, otherwise just fall back to the first option (usually Baseline).
    const current = templates.find((t) => t.name === transaction?.checklist_template_name);
    setTemplateSelection(current?.id || templates[0]?.id || '');
    setIsChangingTemplate(true);
  };

  const cancelChangingTemplate = () => {
    setIsChangingTemplate(false);
    setTemplateChangeError(null);
  };

  const handleConfirmTemplateChange = async () => {
    if (!transaction || !templateSelection) return;

    const chosen = templates.find((t) => t.id === templateSelection);
    if (chosen && chosen.name === transaction.checklist_template_name) {
      setTemplateChangeError('This transaction already uses that checklist template.');
      return;
    }

    const ok = window.confirm(
      "Switching checklist templates resets this deal's checklist: every step is unchecked and replaced with the new template's steps, and status goes back to \"Contract Pending\". This can't be undone. Continue?"
    );
    if (!ok) return;

    try {
      setIsSavingTemplateChange(true);
      setTemplateChangeError(null);
      const response = await authFetch(`/api/transactions/${transaction.id}/checklist-template`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: templateSelection }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to switch checklist template');
      }

      const { tasks: newTasks, ...transactionFields } = result;
      setTransaction(transactionFields);
      if (Array.isArray(newTasks)) setTasks(newTasks);
      setIsChangingTemplate(false);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setTemplateChangeError(error instanceof Error ? error.message : 'Failed to switch checklist template');
    } finally {
      setIsSavingTemplateChange(false);
    }
  };

  // Commission % is never entered here -- it's whatever the agent is
  // configured with in Agents settings. This is a single direct action
  // (no form, no controlled text input) so closing a deal doesn't leave a
  // typing field wired up in an already-large page.
  const handleCreateInvoice = async () => {
    if (!transaction) return;

    try {
      setIsCreatingInvoice(true);
      setCreateInvoiceError(null);
      const response = await authFetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: transaction.agent_id,
          transactionId: transaction.id,
          purchasePrice: transaction.purchase_price,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to create invoice');
      }
      setInvoice(result);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setCreateInvoiceError(error instanceof Error ? error.message : 'Failed to create invoice');
    } finally {
      setIsCreatingInvoice(false);
    }
  };

  const handleUpload = async (
    file: File,
    taskId: string | null,
    category: string,
    documentType: string,
    requiresSignature: boolean = true
  ) => {
    try {
      setUploadingSlot('upload');
      const formData = new FormData();
      formData.append('file', file);
      formData.append('transactionId', resolvedParams.id);
      formData.append('category', category);
      formData.append('documentType', documentType);
      formData.append('requiresSignature', requiresSignature ? 'true' : 'false');
      if (taskId) formData.append('taskId', taskId);

      const response = await authFetch('/api/documents', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to upload document');
      }

      setDocuments((prev) => [result, ...prev]);
      setShowUploadForm(false);
      setUploadFile(null);
      setUploadStageTaskId('');
      setUploadRequiresSignature(true);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      console.error('Error uploading document:', error);
      alert(error instanceof Error ? error.message : 'Failed to upload document');
    } finally {
      setUploadingSlot(null);
    }
  };

  const handleUploadSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!uploadFile) return;
    handleUpload(uploadFile, uploadStageTaskId || null, uploadCategory, uploadDocType, uploadRequiresSignature);
  };

  // Lets the TC mark a document Signed/Not Signed after it's already been
  // uploaded (e.g. it was signed outside Relay) -- shows/hides the Request
  // Signature button on that document accordingly.
  const [togglingSignedDocId, setTogglingSignedDocId] = useState<string | null>(null);
  const handleToggleSigned = async (docId: string, nextIsSigned: boolean) => {
    try {
      setTogglingSignedDocId(docId);
      const response = await authFetch('/api/documents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: docId, isSigned: nextIsSigned }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to update document');
      }
      setDocuments((prev) => prev.map((d) => (d.id === docId ? { ...d, is_signed: nextIsSigned } : d)));
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      console.error('Error updating document signed status:', error);
      alert(error instanceof Error ? error.message : 'Failed to update document');
    } finally {
      setTogglingSignedDocId(null);
    }
  };

  // Lets the TC mark a document as not needing a signature at all (a photo,
  // an MLS printout, internal notes) -- when off, the Signed checkbox and
  // Request Signature button are hidden entirely for that document.
  const [togglingRequiresSignatureDocId, setTogglingRequiresSignatureDocId] = useState<string | null>(null);
  const handleToggleRequiresSignature = async (docId: string, nextRequiresSignature: boolean) => {
    try {
      setTogglingRequiresSignatureDocId(docId);
      const response = await authFetch('/api/documents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: docId, requiresSignature: nextRequiresSignature }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to update document');
      }
      setDocuments((prev) =>
        prev.map((d) => (d.id === docId ? { ...d, requires_signature: nextRequiresSignature } : d))
      );
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      console.error('Error updating document signature requirement:', error);
      alert(error instanceof Error ? error.message : 'Failed to update document');
    } finally {
      setTogglingRequiresSignatureDocId(null);
    }
  };

  const handleUploadCategoryChange = (categoryKey: string) => {
    setUploadCategory(categoryKey);
    setUploadDocType(typesForCategory(categoryKey)[0] || '');
  };

  // A per-category "+ Upload" shortcut (see the category headers below) --
  // opens the laptop's native file picker straight away and uploads
  // whatever's chosen directly into that category, with its first
  // document type as the default -- no need to scroll up to the shared
  // form and pick the category from a dropdown. One hidden input is
  // reused across every category; `directUploadCategory` tracks which
  // one the next file picked belongs to.
  const categoryFileInputRef = useRef<HTMLInputElement | null>(null);
  const [directUploadCategory, setDirectUploadCategory] = useState<string | null>(null);
  const triggerDirectUpload = (categoryKey: string) => {
    setDirectUploadCategory(categoryKey);
    if (categoryFileInputRef.current) categoryFileInputRef.current.value = '';
    categoryFileInputRef.current?.click();
  };
  const handleDirectFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const category = directUploadCategory;
    if (!file || !category) {
      setDirectUploadCategory(null);
      return;
    }
    // Left set until the upload settles (rather than cleared right away)
    // so the category's own "+ Upload" button can show "Uploading..." for
    // the one actually in flight.
    const documentType = typesForCategory(category)[0] || DEFAULT_DOCUMENT_TYPE;
    await handleUpload(file, null, category, documentType);
    setDirectUploadCategory(null);
  };

  const toggleCategoryCollapsed = (categoryKey: string) => {
    setCollapsedCategories((prev) => ({ ...prev, [categoryKey]: !prev[categoryKey] }));
  };

  const handleDeleteDocument = async (docId: string) => {
    if (!confirm('Delete this document? This cannot be undone.')) return;

    try {
      setDeletingDocId(docId);
      const response = await authFetch(`/api/documents?id=${docId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Failed to delete document');
      }

      setDocuments((prev) => prev.filter((d) => d.id !== docId));
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      console.error('Error deleting document:', error);
      alert(error instanceof Error ? error.message : 'Failed to delete document');
    } finally {
      setDeletingDocId(null);
    }
  };

  const handleDeleteTransaction = async () => {
    if (!transaction) return;
    if (
      !confirm(
        'Delete this transaction? This also removes its checklist, uploaded documents, and any invoice generated from it. This cannot be undone.'
      )
    ) {
      return;
    }

    try {
      setIsDeletingTransaction(true);
      const response = await authFetch(`/api/transactions?id=${transaction.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Failed to delete transaction');
      }

      router.push('/dashboard/transactions');
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      console.error('Error deleting transaction:', error);
      alert(error instanceof Error ? error.message : 'Failed to delete transaction');
      setIsDeletingTransaction(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen px-6 py-12">
        <div className="max-w-6xl mx-auto">
          <Link href="/dashboard/transactions" className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 mb-8 transition">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
            </svg>
            Back to Transactions
          </Link>
          <div className="flex items-center justify-center py-24">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full border-4 border-slate-600 border-t-blue-400 animate-spin mx-auto mb-4" />
              <p className="text-slate-400">Loading transaction...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen px-6 py-12">
        <div className="max-w-6xl mx-auto">
          <Link href="/dashboard/transactions" className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 mb-8 transition">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
            </svg>
            Back to Transactions
          </Link>
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-6">
            <h2 className="text-lg font-bold text-red-300 mb-2">Error Loading Transaction</h2>
            <p className="text-red-200 mb-4">{error}</p>
            <p className="text-red-300 text-sm">
              💡 If you see "permission denied", run the Supabase SQL grant statements in your Supabase dashboard.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!transaction) {
    return (
      <div className="min-h-screen px-6 py-12">
        <div className="max-w-6xl mx-auto">
          <Link href="/dashboard/transactions" className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 mb-8 transition">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
            </svg>
            Back to Transactions
          </Link>
          <div className="text-center py-24">
            <h2 className="text-xl font-semibold text-slate-300 mb-2">Transaction not found</h2>
            <p className="text-slate-400">The transaction you're looking for doesn't exist.</p>
          </div>
        </div>
      </div>
    );
  }

  const completedCount = tasks.filter((t) => t.completed).length;
  // For the overdue/due-date labels on the checklist below -- UTC so it
  // matches the UTC-anchored due_date strings computed in lib/dueDates.ts.
  const todayIso = new Date().toISOString().split('T')[0];
  // Most-recent signing request per document -- signingRequests comes
  // back newest-first from the API, so the first match per document_id
  // wins.
  const latestSigningRequestByDocId = new Map<string, SigningRequestItem>();
  for (const req of signingRequests) {
    if (req.document_id && !latestSigningRequestByDocId.has(req.document_id)) {
      latestSigningRequestByDocId.set(req.document_id, req);
    }
  }
  // Documents that ARE a produced signed PDF (the output of some signing
  // request), as opposed to the original that was sent out -- the
  // original stays its own row even after it's been signed, it just picks
  // up a "✓ Signed" badge (below) rather than moving into this set.
  const signedDocumentIds = new Set(
    signingRequests.filter((r) => r.signed_document_id).map((r) => r.signed_document_id as string)
  );
  const completionPercent = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;

  const taskNameById = tasks.reduce<Record<string, string>>((acc, t) => {
    acc[t.id] = t.name;
    return acc;
  }, {});

  const searchLower = docSearch.trim().toLowerCase();
  const filteredDocuments = searchLower
    ? documents.filter((d) => {
        const stageName = d.task_id ? taskNameById[d.task_id] || '' : '';
        return (
          d.file_name.toLowerCase().includes(searchLower) ||
          (d.document_type || '').toLowerCase().includes(searchLower) ||
          categoryLabel(d.category).toLowerCase().includes(searchLower) ||
          stageName.toLowerCase().includes(searchLower)
        );
      })
    : documents;

  // A per-document row -- badges, the Signed/Not Signed toggle, the
  // Request Signature action, delete, and the inline signer form.
  const renderDocRow = (doc: DocumentItem) => {
    const isPdf = doc.content_type === 'application/pdf' || doc.file_name.toLowerCase().endsWith('.pdf');
    const sigReq = latestSigningRequestByDocId.get(doc.id);
    const isSignedOutput = signedDocumentIds.has(doc.id);
    // Once an in-house signing request exists for this document (pending
    // or completed), that flow is the source of truth for its signed
    // status -- the manual Signed/Not Signed toggle only applies before
    // any request has been sent, or after a voided or declined one (both
    // are terminal non-signed states that hand control back to the TC).
    const hasSigningActivity = sigReq?.status === 'pending' || sigReq?.status === 'signed';
    const isToggling = togglingSignedDocId === doc.id;
    const requiresSignature = doc.requires_signature;
    const isTogglingRequiresSignature = togglingRequiresSignatureDocId === doc.id;
    return (
      <div key={doc.id}>
        <div className="flex items-center justify-between gap-3 bg-slate-800/50 border border-slate-600 rounded-lg px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <a
              href={doc.url || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 truncate block"
            >
              📄 {doc.file_name}
            </a>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
              <span className="text-xs text-slate-500">{doc.document_type || 'General'}</span>
              {doc.task_id && taskNameById[doc.task_id] && (
                <span className="text-xs px-2 py-0.5 bg-slate-600 border border-slate-600 rounded-full text-slate-300">
                  {taskNameById[doc.task_id]}
                </span>
              )}
            </div>
          </div>
          <span className="text-xs text-slate-500 flex-shrink-0">
            {doc.file_size ? `${(doc.file_size / 1024).toFixed(0)} KB` : ''}
          </span>
          {!requiresSignature && (
            <span className="text-xs px-2 py-0.5 bg-slate-700/60 border border-slate-600 rounded-full text-slate-400 flex-shrink-0">
              No signature needed
            </span>
          )}
          {requiresSignature && isSignedOutput && (
            <span className="text-xs px-2 py-0.5 bg-green-900/30 border border-green-700/50 rounded-full text-green-300 flex-shrink-0">
              ✓ Signed copy
            </span>
          )}
          {requiresSignature && !isSignedOutput && hasSigningActivity && sigReq?.status === 'pending' && (
            <>
              <span className="text-xs px-2 py-0.5 bg-blue-900/30 border border-blue-700/50 rounded-full text-blue-300 flex-shrink-0">
                Awaiting signature
              </span>
              <button
                onClick={() => handleVoidSigningRequest(sigReq.id)}
                disabled={voidingSigningRequestId === sigReq.id}
                className="text-xs px-2 py-1 border border-slate-600 hover:border-red-500 text-slate-400 hover:text-red-300 rounded-lg transition flex-shrink-0 disabled:opacity-50"
                title="Cancel this signature request"
              >
                {voidingSigningRequestId === sigReq.id ? 'Voiding…' : 'Void'}
              </button>
            </>
          )}
          {requiresSignature && !isSignedOutput && hasSigningActivity && sigReq?.status === 'signed' && (
            <span className="text-xs px-2 py-0.5 bg-green-900/30 border border-green-700/50 rounded-full text-green-300 flex-shrink-0">
              ✓ Signed
            </span>
          )}
          {requiresSignature && !isSignedOutput && !hasSigningActivity && sigReq?.status === 'declined' && (
            <span
              className="text-xs px-2 py-0.5 bg-orange-900/30 border border-orange-700/50 rounded-full text-orange-300 flex-shrink-0"
              title={sigReq.decline_reason ? `Reason: ${sigReq.decline_reason}` : undefined}
            >
              Signer declined
            </span>
          )}
          {requiresSignature && !isSignedOutput && !hasSigningActivity && sigReq?.status === 'voided' && (
            <span className="text-xs px-2 py-0.5 bg-slate-700 border border-slate-600 rounded-full text-slate-400 flex-shrink-0">
              Request voided
            </span>
          )}
          {requiresSignature && !isSignedOutput && !hasSigningActivity && (
            <label
              className={`flex items-center gap-1.5 text-xs flex-shrink-0 select-none ${
                isToggling ? 'opacity-50' : 'cursor-pointer'
              } ${doc.is_signed ? 'text-green-300 font-medium' : 'text-slate-400'}`}
            >
              <input
                type="checkbox"
                checked={doc.is_signed}
                disabled={isToggling}
                onChange={(e) => handleToggleSigned(doc.id, e.target.checked)}
                className="w-3.5 h-3.5 rounded border-slate-500 bg-slate-700 text-green-500 focus:ring-0 focus:ring-offset-0 cursor-pointer disabled:cursor-not-allowed"
              />
              Signed
            </label>
          )}
          {requiresSignature && !isSignedOutput && !hasSigningActivity && !doc.is_signed && isPdf && (
            <button
              onClick={() => {
                setRequestingSignatureDocId(doc.id);
                setSignerNameDraft('');
                setSignerEmailDraft('');
                setSignatureRequestError(null);
              }}
              className="text-xs px-2 py-1 border border-slate-600 hover:border-blue-500 text-slate-300 hover:text-blue-300 rounded-lg transition flex-shrink-0"
            >
              Request Signature
            </button>
          )}
          {!isSignedOutput && !hasSigningActivity && (
            <button
              onClick={() => handleToggleRequiresSignature(doc.id, !requiresSignature)}
              disabled={isTogglingRequiresSignature}
              className="text-xs px-2 py-1 border border-slate-600 hover:border-slate-400 text-slate-500 hover:text-slate-300 rounded-lg transition flex-shrink-0 disabled:opacity-50"
              title={requiresSignature ? 'Mark as not requiring a signature' : 'Mark as requiring a signature'}
            >
              {isTogglingRequiresSignature ? '...' : requiresSignature ? 'No sig needed' : 'Needs sig'}
            </button>
          )}
          <button
            onClick={() => handleDeleteDocument(doc.id)}
            disabled={deletingDocId === doc.id}
            className="text-slate-500 hover:text-red-400 text-sm disabled:opacity-50 flex-shrink-0"
            title="Delete document"
          >
            {deletingDocId === doc.id ? '...' : '✕'}
          </button>
        </div>
        {requestingSignatureDocId === doc.id && (
          <div className="mt-2 bg-slate-900/40 border border-slate-600 rounded-lg p-3 space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                type="text"
                value={signerNameDraft}
                onChange={(e) => setSignerNameDraft(e.target.value)}
                placeholder="Signer name"
                className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
              <input
                type="email"
                value={signerEmailDraft}
                onChange={(e) => setSignerEmailDraft(e.target.value)}
                placeholder="Signer email"
                className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
            {signatureRequestError && (
              <p className="text-xs text-red-400">{signatureRequestError}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => handleRequestSignature(doc.id)}
                disabled={isSendingSignatureRequest}
                className="text-xs px-3 py-1.5 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white font-semibold rounded-lg transition"
              >
                {isSendingSignatureRequest ? 'Sending…' : 'Send for Signature'}
              </button>
              <button
                onClick={() => setRequestingSignatureDocId(null)}
                className="text-xs px-3 py-1.5 border border-slate-600 text-slate-300 hover:text-slate-100 rounded-lg transition"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // One rectangle per document category, with a flat list of its
  // documents (no separate Signed/Not-Signed sections) and a "+ Upload"
  // shortcut that pre-selects this category on the shared upload form.
  const renderDocumentCategories = () => {
    return DOCUMENT_CATEGORIES.map((cat) => {
      const catDocs = filteredDocuments.filter((d) => (d.category || DEFAULT_CATEGORY_KEY) === cat.key);
      if (docSearch && catDocs.length === 0) return null;

      const isCollapsed = collapsedCategories[cat.key];

      return (
        <div key={cat.key} className="bg-slate-700/30 border border-slate-600 rounded-lg overflow-hidden">
          <div className="w-full flex items-center gap-2 px-4 py-3 hover:bg-slate-700/50 transition">
            <button
              onClick={() => toggleCategoryCollapsed(cat.key)}
              className="flex-1 flex items-center justify-between text-left min-w-0"
            >
              <span className="font-semibold text-slate-200">{cat.label}</span>
              <span className="flex items-center gap-2 text-xs text-slate-400 ml-3">
                {catDocs.length} document{catDocs.length === 1 ? '' : 's'}
                <svg
                  className={`w-4 h-4 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </span>
            </button>
            <button
              onClick={() => triggerDirectUpload(cat.key)}
              disabled={uploadingSlot === 'upload'}
              className="flex-shrink-0 text-xs px-2.5 py-1 border border-slate-600 hover:border-blue-500 text-slate-300 hover:text-blue-300 rounded-lg transition disabled:opacity-50"
            >
              {uploadingSlot === 'upload' && directUploadCategory === cat.key ? 'Uploading…' : '+ Upload'}
            </button>
          </div>
          {!isCollapsed && (
            <div className="px-4 pb-4 space-y-2">
              {catDocs.length === 0 ? (
                <p className="text-sm text-slate-500 italic">No documents in this category yet.</p>
              ) : (
                catDocs.map((doc) => renderDocRow(doc))
              )}
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <div className="min-h-screen px-6 py-12">
      <div className="max-w-6xl mx-auto">
        {/* Back Button */}
        <Link href="/dashboard/transactions" className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 mb-8 transition">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
          </svg>
          Back to Transactions
        </Link>

        {/* Main Card */}
        <div className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-8 mb-8">
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <span className="inline-block px-3 py-1 bg-blue-500/20 border border-blue-500/50 text-blue-300 text-sm font-semibold rounded-full">
                {transaction.status}
              </span>
              {transaction.status === 'Closed' && invoice && (
                <span className="inline-block px-3 py-1 bg-green-500/20 border border-green-500/50 text-green-300 text-xs font-semibold rounded-full">
                  ✓ Invoice Generated
                </span>
              )}
            </div>
            <h1 className="text-4xl font-display font-semibold text-slate-100 mb-2">{transaction.file_number}</h1>
            <p className="text-slate-400">{transaction.property_address}</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-6 pt-6 border-t border-slate-600">
            {/* Agent */}
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Agent</p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-sm font-bold text-white">
                  {agentName[0]}
                </div>
                <p className="text-lg font-semibold text-slate-100">{agentName}</p>
              </div>
            </div>

            {/* Purchase Price */}
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Purchase Price</p>
              <p className="text-2xl font-bold text-blue-400">${transaction.purchase_price.toLocaleString()}</p>
            </div>

            {/* Status Dropdown */}
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Status</p>
              <select
                value={transaction.status}
                onChange={(e) => handleStatusChange(e.target.value)}
                disabled={isUpdatingStatus}
                className="bg-slate-600 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none disabled:opacity-50 cursor-pointer"
              >
                {stagesForTaskNames(tasks.map((t) => t.name)).map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>

            {/* Acceptance / Closing Dates -- editable here, not just at
                creation. Changing either recomputes the checklist's due
                dates on the server (see handleDateFieldChange). */}
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Acceptance Date</p>
              <input
                type="date"
                defaultValue={transaction.acceptance_date ?? ''}
                onBlur={(e) => {
                  if (e.target.value !== (transaction.acceptance_date ?? '')) {
                    handleDateFieldChange('acceptanceDate', e.target.value);
                  }
                }}
                disabled={savingDateField === 'acceptanceDate'}
                className="bg-slate-600 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none disabled:opacity-50"
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Target Closing Date</p>
              <input
                type="date"
                defaultValue={transaction.closing_date ?? ''}
                onBlur={(e) => {
                  if (e.target.value !== (transaction.closing_date ?? '')) {
                    handleDateFieldChange('closingDate', e.target.value);
                  }
                }}
                disabled={savingDateField === 'closingDate'}
                className="bg-slate-600 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none disabled:opacity-50"
              />
            </div>
          </div>

          {/* Invoice: only relevant once the deal is Closed. Never
              auto-generated on any plan -- the TC always clicks "Create
              Invoice" below themselves, once the deal is actually Closed. */}
          {transaction.status === 'Closed' && (
            <div className="pt-6 mt-6 border-t border-slate-600">
              {invoice ? (
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Invoice</p>
                    <p className="text-slate-100 font-semibold">
                      {invoice.invoice_number} · ${invoice.amount_owed.toLocaleString()} ·{' '}
                      <span className={invoice.paid ? 'text-green-400' : 'text-blue-400'}>
                        {invoice.paid ? 'Paid' : 'Unpaid'}
                      </span>
                    </p>
                  </div>
                  <Link
                    href={`/dashboard/invoices/${invoice.id}`}
                    className="text-sm font-medium text-blue-400 hover:text-blue-300"
                  >
                    View invoice →
                  </Link>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="text-sm text-slate-400">No invoice yet for this closed deal.</p>
                      <p className="text-xs text-slate-500 mt-1">
                        Flat fee ${(agent?.flat_fee ?? 0).toLocaleString()}
                        {agent?.commission_percent ? (
                          <> + {agent.commission_percent}% of ${transaction.purchase_price.toLocaleString()}</>
                        ) : null}{' '}
                        ={' '}
                        <span className="text-slate-300 font-semibold">
                          $
                          {(
                            (agent?.flat_fee ?? 0) +
                            (transaction.purchase_price * (agent?.commission_percent ?? 0)) / 100
                          ).toLocaleString()}
                        </span>
                        {' — set per-agent in '}
                        <Link href="/dashboard/agents" className="text-blue-400 hover:text-blue-300">
                          Agents
                        </Link>
                        .
                      </p>
                    </div>
                    <button
                      onClick={handleCreateInvoice}
                      disabled={isCreatingInvoice}
                      className="px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
                    >
                      {isCreatingInvoice ? 'Creating…' : 'Create Invoice'}
                    </button>
                  </div>
                  {createInvoiceError && <p className="text-sm text-red-400">{createInvoiceError}</p>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Checklist + Documents, side by side on desktop: documents are
            the primary view (wide, left), the checklist is compact
            (narrow, right) so both are usable without scrolling past one
            to reach the other. Both stack full-width on mobile, in source
            order (checklist first, documents below). */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8 mt-8">

        {/* Tasks Section + Deal Contacts, stacked together in the
            narrow right column on desktop (this wrapper carries the
            order/self-start that used to live on the Checklist div
            directly, since it's now the thing actually placed in the
            grid). Both still stack full-width on mobile in source order. */}
        <div className="lg:order-2 lg:self-start flex flex-col gap-8">
        <div className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-6">
          <div className="mb-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-bold text-slate-100">Checklist</h2>
              <Link
                href="/dashboard/settings#checklist-templates"
                className="text-xs text-blue-400 hover:text-blue-300 transition whitespace-nowrap shrink-0 mt-0.5"
              >
                Manage Templates
              </Link>
            </div>
            {isChangingTemplate ? (
              <div className="mb-4 space-y-2">
                <select
                  value={templateSelection}
                  onChange={(e) => setTemplateSelection(e.target.value)}
                  className="w-full bg-slate-600 border border-slate-600 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:border-blue-500 focus:outline-none"
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.steps.length} steps)
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleConfirmTemplateChange}
                    disabled={isSavingTemplateChange || !templateSelection}
                    className="text-xs font-semibold text-blue-400 hover:text-blue-300 transition disabled:opacity-50"
                  >
                    {isSavingTemplateChange ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={cancelChangingTemplate}
                    disabled={isSavingTemplateChange}
                    className="text-xs text-slate-500 hover:text-slate-300 transition disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
                {templateChangeError && <p className="text-xs text-red-400">{templateChangeError}</p>}
              </div>
            ) : (
              <p className="text-xs text-slate-500 mb-4">
                {transaction.checklist_template_name || 'Baseline (default)'}
                {transaction.status !== 'Closed' && templates.length > 1 && (
                  <>
                    {' \u00b7 '}
                    <button
                      onClick={startChangingTemplate}
                      className="text-blue-400 hover:text-blue-300 transition"
                    >
                      Change
                    </button>
                  </>
                )}
              </p>
            )}

            {/* Progress Bar */}
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-medium text-slate-400">Progress</span>
                  <span className="text-xs font-semibold text-blue-400">{completionPercent}%</span>
                </div>
                <div className="w-full h-2 bg-slate-600 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300"
                    style={{ width: `${completionPercent}%` }}
                  />
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-400 mt-2">
              <span className="font-semibold text-slate-300">{completedCount}</span> of <span className="font-semibold text-slate-300">{tasks.length}</span> completed
            </p>
          </div>

          {/* Tasks List */}
          <div className="space-y-2">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="px-3 py-2 bg-slate-700/30 border border-slate-600 rounded-lg hover:border-slate-600 transition"
              >
                <div
                  className="flex items-center gap-3 group cursor-pointer"
                  onClick={() => handleToggleTask(task.id)}
                >
                  <input
                    type="checkbox"
                    checked={task.completed}
                    onChange={() => handleToggleTask(task.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-4 h-4 rounded border-2 border-slate-600 accent-blue-500 cursor-pointer flex-shrink-0"
                  />
                  <span
                    className={`flex-1 text-sm font-medium ${
                      task.completed
                        ? 'line-through text-slate-500'
                        : 'text-slate-200 group-hover:text-slate-100'
                    }`}
                  >
                    {task.name}
                  </span>
                  {!task.completed && editingDueDateTaskId !== task.id && (
                    <>
                      {task.due_date ? (
                        <span
                          className={`text-xs font-medium flex-shrink-0 ${
                            task.due_date < todayIso ? 'text-red-400' : 'text-slate-500'
                          }`}
                        >
                          {task.due_date < todayIso ? 'Overdue ' : 'Due '}
                          {new Date(`${task.due_date}T00:00:00Z`).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-600 flex-shrink-0">No due date</span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEditDueDate(task);
                        }}
                        className="text-xs text-blue-400 hover:text-blue-300 font-medium flex-shrink-0 opacity-0 group-hover:opacity-100 transition"
                      >
                        Edit
                      </button>
                    </>
                  )}
                </div>

                {editingDueDateTaskId === task.id && (
                  <div
                    className="mt-2 pl-7 flex flex-wrap items-center gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <DueDateControl value={editingDueDateValue} onChange={setEditingDueDateValue} />
                    <button
                      type="button"
                      onClick={() => saveDueDate(task.id)}
                      disabled={isSavingDueDate}
                      className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-medium disabled:opacity-50"
                    >
                      {isSavingDueDate ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditDueDate}
                      disabled={isSavingDueDate}
                      className="px-3 py-1.5 text-xs border border-slate-600 hover:border-slate-500 text-slate-300 rounded-lg transition disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Deal Contacts: the agent (read-only, from the agents record)
            plus any other parties for this deal, typed in by hand. Sits
            directly under the Checklist card via the shared wrapper above. */}
        <div className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-6">
          <h2 className="text-lg font-bold text-slate-100 mb-4">Deal Contacts</h2>

          <div className="space-y-2">
            {/* Agent row -- read-only here; edit via the Agents page. */}
            <div className="px-3 py-2 bg-slate-700/30 border border-slate-600 rounded-lg">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-blue-400">Agent</span>
                <Link
                  href="/dashboard/agents"
                  className="text-xs text-slate-500 hover:text-slate-300 transition"
                >
                  Edit
                </Link>
              </div>
              <p className="text-sm font-medium text-slate-200 mt-1">{agentName || 'Unknown'}</p>
              <p className="text-xs text-slate-400 mt-0.5">{agent?.email || 'No email on file'}</p>
              <p className="text-xs text-slate-400">{agent?.phone || 'No phone on file'}</p>
            </div>

            {/* Saved parties */}
            {contacts.map((contact) => (
              <div
                key={contact.id}
                className="px-3 py-2 bg-slate-700/30 border border-slate-600 rounded-lg space-y-1.5"
              >
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={contact.role || ''}
                    onChange={(e) => handleContactChange(contact.id, 'role', e.target.value)}
                    onBlur={(e) => handleContactBlur(contact.id, 'role', e.target.value)}
                    placeholder="Role (e.g. Buyer)"
                    className="flex-1 bg-slate-600 border border-slate-600 rounded-lg px-2 py-1 text-xs font-semibold text-blue-300 placeholder:text-slate-500 placeholder:font-normal focus:border-blue-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveContact(contact.id)}
                    className="text-xs text-slate-500 hover:text-red-400 transition flex-shrink-0"
                  >
                    Remove
                  </button>
                </div>
                <input
                  type="text"
                  value={contact.name || ''}
                  onChange={(e) => handleContactChange(contact.id, 'name', e.target.value)}
                  onBlur={(e) => handleContactBlur(contact.id, 'name', e.target.value)}
                  placeholder="Name or company"
                  className="w-full bg-slate-600 border border-slate-600 rounded-lg px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
                <input
                  type="email"
                  value={contact.email || ''}
                  onChange={(e) => handleContactChange(contact.id, 'email', e.target.value)}
                  onBlur={(e) => handleContactBlur(contact.id, 'email', e.target.value)}
                  placeholder="Email"
                  className="w-full bg-slate-600 border border-slate-600 rounded-lg px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
                <input
                  type="text"
                  value={contact.phone || ''}
                  onChange={(e) => handleContactChange(contact.id, 'phone', e.target.value)}
                  onBlur={(e) => handleContactBlur(contact.id, 'phone', e.target.value)}
                  placeholder="Phone"
                  className="w-full bg-slate-600 border border-slate-600 rounded-lg px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
                {savingContactId === contact.id && (
                  <p className="text-[11px] text-slate-500">Saving...</p>
                )}
              </div>
            ))}

            {/* Blank boxes -- become real rows once something's typed in. */}
            {draftContacts.map((draft) => (
              <div
                key={draft.draftId}
                className="px-3 py-2 bg-slate-700/20 border border-dashed border-slate-600 rounded-lg space-y-1.5"
              >
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={draft.role}
                    onChange={(e) => handleDraftContactChange(draft.draftId, 'role', e.target.value)}
                    onBlur={() => handleDraftContactBlur(draft.draftId)}
                    placeholder="Role (e.g. Buyer)"
                    className="flex-1 bg-slate-600 border border-slate-600 rounded-lg px-2 py-1 text-xs font-semibold text-blue-300 placeholder:text-slate-500 placeholder:font-normal focus:border-blue-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveDraftContact(draft.draftId)}
                    className="text-xs text-slate-500 hover:text-red-400 transition flex-shrink-0"
                  >
                    Remove
                  </button>
                </div>
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) => handleDraftContactChange(draft.draftId, 'name', e.target.value)}
                  onBlur={() => handleDraftContactBlur(draft.draftId)}
                  placeholder="Name or company"
                  className="w-full bg-slate-600 border border-slate-600 rounded-lg px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
                <input
                  type="email"
                  value={draft.email}
                  onChange={(e) => handleDraftContactChange(draft.draftId, 'email', e.target.value)}
                  onBlur={() => handleDraftContactBlur(draft.draftId)}
                  placeholder="Email"
                  className="w-full bg-slate-600 border border-slate-600 rounded-lg px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
                <input
                  type="text"
                  value={draft.phone}
                  onChange={(e) => handleDraftContactChange(draft.draftId, 'phone', e.target.value)}
                  onBlur={() => handleDraftContactBlur(draft.draftId)}
                  placeholder="Phone"
                  className="w-full bg-slate-600 border border-slate-600 rounded-lg px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
                {savingContactId === draft.draftId && (
                  <p className="text-[11px] text-slate-500">Saving...</p>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={handleAddDraftContact}
            className="mt-3 text-xs text-blue-400 hover:text-blue-300 font-medium transition"
          >
            + Add another
          </button>
        </div>
        </div>

        {/* Documents Section (primary view, left column on desktop) */}
        <div className="lg:order-1 bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-8">
          <input
            ref={categoryFileInputRef}
            type="file"
            accept="application/pdf,image/*,.doc,.docx"
            onChange={handleDirectFileSelected}
            className="hidden"
          />
          <div className="flex items-start justify-between gap-4 mb-2">
            <div>
              <h2 className="text-2xl font-bold text-slate-100 mb-2">Documents</h2>
              <p className="text-sm text-slate-400">
                Organized by category — a document can optionally be tagged with a checklist stage, but
                doesn&apos;t have to be.
              </p>
            </div>
            <button
              onClick={() => setShowUploadForm((prev) => !prev)}
              className="flex-shrink-0 px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg text-sm transition"
            >
              {showUploadForm ? 'Cancel' : '+ Upload Document'}
            </button>
          </div>

          {showUploadForm && (
            <form
              onSubmit={handleUploadSubmit}
              className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-800/50 border border-slate-600 rounded-lg p-5 my-6"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Category</label>
                <select
                  value={uploadCategory}
                  onChange={(e) => handleUploadCategoryChange(e.target.value)}
                  className="w-full bg-slate-600 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                >
                  {DOCUMENT_CATEGORIES.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Document Type</label>
                <select
                  value={uploadDocType}
                  onChange={(e) => setUploadDocType(e.target.value)}
                  className="w-full bg-slate-600 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                >
                  {typesForCategory(uploadCategory).map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Checklist Stage <span className="normal-case text-slate-500">(optional)</span>
                </label>
                <select
                  value={uploadStageTaskId}
                  onChange={(e) => setUploadStageTaskId(e.target.value)}
                  className="w-full bg-slate-600 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                >
                  <option value="">None</option>
                  {tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">File</label>
                <input
                  type="file"
                  required
                  accept="application/pdf,image/*,.doc,.docx"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  className="w-full text-sm text-slate-300 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-slate-600 file:text-slate-200 hover:file:bg-slate-600 file:cursor-pointer"
                />
              </div>

              <div className="md:col-span-2">
                <label className="flex items-center gap-2 text-sm text-slate-300 select-none cursor-pointer">
                  <input
                    type="checkbox"
                    checked={uploadRequiresSignature}
                    onChange={(e) => setUploadRequiresSignature(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-500 bg-slate-700 text-blue-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                  />
                  This document needs a signature
                  <span className="text-xs text-slate-500">
                    (uncheck for photos, printouts, or anything that won&apos;t be signed)
                  </span>
                </label>
              </div>

              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={uploadingSlot === 'upload' || !uploadFile}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg text-sm transition disabled:opacity-50"
                >
                  {uploadingSlot === 'upload' ? 'Uploading...' : 'Upload'}
                </button>
              </div>
            </form>
          )}

          <div className="mb-6">
            <input
              type="text"
              value={docSearch}
              onChange={(e) => setDocSearch(e.target.value)}
              placeholder="Search documents by name, type, category, or checklist stage..."
              className="w-full bg-slate-600 border border-slate-600 rounded-lg px-4 py-2.5 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="space-y-3">
            {renderDocumentCategories()}
            {docSearch && filteredDocuments.length === 0 && (
              <p className="text-sm text-slate-500 italic">No documents match "{docSearch}".</p>
            )}
          </div>
        </div>

        </div>

        {/* Danger Zone */}
        <div className="bg-red-950/20 border border-red-900/50 rounded-lg p-8 mt-8">
          <h2 className="text-xl font-bold text-red-300 mb-2">Danger Zone</h2>
          <p className="text-sm text-slate-400 mb-6">
            Permanently delete this transaction, its checklist, uploaded documents, and any invoice generated from it.
          </p>
          <button
            onClick={handleDeleteTransaction}
            disabled={isDeletingTransaction}
            className="px-4 py-2 bg-red-900/40 hover:bg-red-900/70 border border-red-800 text-red-300 hover:text-red-100 rounded-lg transition font-medium disabled:opacity-50"
          >
            {isDeletingTransaction ? 'Deleting...' : 'Delete Transaction'}
          </button>
        </div>
      </div>
    </div>
  );
}
