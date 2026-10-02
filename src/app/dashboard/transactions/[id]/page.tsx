'use client';

import { useEffect, useRef, useState, FormEvent, ChangeEvent } from 'react';
import { use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import { stagesForTaskNames } from '@/lib/transactionStages';
import { DOCUMENT_CATEGORIES, DEFAULT_CATEGORY_KEY, DEFAULT_DOCUMENT_TYPE, categoryLabel, typesForCategory } from '@/lib/documentTaxonomy';
import { DueDateSpec, formatDisplayDate } from '@/lib/dueDates';
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
  inbound_token?: string | null;
}

interface TransactionEmail {
  id: string;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  body_text: string | null;
  received_at: string;
}

interface Task {
  id: string;
  transaction_id: string;
  name: string;
  completed: boolean;
  due_date?: string | null;
  due_date_spec?: DueDateSpec | null;
  waiting_on?: string | null;
  waiting_on_since?: string | null;
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
// info comes from the Agent record above instead, see the Contacts
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
  paid_at: string | null;
  paid_amount: number | null;
  refunded?: boolean;
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

// Live-formats a Contacts phone field into "(555) 123-4567" as the user
// types, regardless of how they type it (with dashes, spaces, pasted in
// all at once, etc.) -- keeps only digits, then re-inserts the
// punctuation. Caps at 10 digits (US/Canada numbers); anything typed
// past that is simply ignored rather than overflowing the format.
function formatPhoneInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length === 0) return '';
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// Same idea for the email field -- email addresses never contain
// whitespace, so strip it live instead of waiting until blur to catch a
// stray space from typing or a pasted value.
function formatEmailInput(value: string): string {
  return value.replace(/\s+/g, '');
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

  // "Contacts" section, directly under the Checklist card: the agent
  // (read-only here, sourced from `agent` above) plus any other parties
  // the TC types in by hand. `contacts` are rows already saved to the
  // database; `draftContacts` are blank/in-progress boxes that only get
  // POSTed once the user actually puts something in them (see
  // handleDraftContactBlur below). A saved contact displays as a compact
  // read-only card (matching the Agent row above) until its `id` is in
  // `editingContactId`, so the section stays readable once it's filled in
  // instead of showing a wall of input boxes.
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [draftContacts, setDraftContacts] = useState<DraftContact[]>([]);
  const [savingContactId, setSavingContactId] = useState<string | null>(null);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const draftIdCounterRef = useRef(0);

  const makeDraftContact = (): DraftContact => {
    draftIdCounterRef.current += 1;
    return { draftId: `draft-${draftIdCounterRef.current}`, role: '', name: '', email: '', phone: '' };
  };
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [isCreatingInvoice, setIsCreatingInvoice] = useState(false);
  const [createInvoiceError, setCreateInvoiceError] = useState<string | null>(null);
  const [isClosingAndInvoicing, setIsClosingAndInvoicing] = useState(false);
  const [isMarkingInvoicePaid, setIsMarkingInvoicePaid] = useState(false);
  const [markInvoicePaidError, setMarkInvoicePaidError] = useState<string | null>(null);
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

  // Agent portal access: who's been invited/accepted onto this
  // transaction, plus the per-transaction message thread with them.
  const [agentInvites, setAgentInvites] = useState<
    { id: string; email: string; status: string; created_at: string }[]
  >([]);
  const [acceptedAgentUsers, setAcceptedAgentUsers] = useState<
    { userId: string; email: string; addedAt: string }[]
  >([]);
  const [inviteEmailDraft, setInviteEmailDraft] = useState('');
  const [isInvitingAgent, setIsInvitingAgent] = useState(false);
  const [inviteMessage, setInviteMessage] = useState('');
  const [messages, setMessages] = useState<
    {
      id: string;
      sender_id: string;
      sender_role: 'tc' | 'agent';
      body: string;
      created_at: string;
      attachment_document_id?: string | null;
      attachment?: { id: string; fileName: string; url: string | null; contentType: string | null; fileSize: number | null } | null;
    }[]
  >([]);
  const [emails, setEmails] = useState<TransactionEmail[]>([]);
  const [copiedInboundAddress, setCopiedInboundAddress] = useState(false);
  const [messageDraft, setMessageDraft] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<{ id: string; fileName: string } | null>(null);
  const [isAttachingFile, setIsAttachingFile] = useState(false);
  const [attachError, setAttachError] = useState('');
  const messageFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetchData();
    fetchTemplates();
    fetchSigningRequests();
    fetchAgentAccess();
    fetchMessages();
    fetchEmails();
  }, [resolvedParams.id]);

  // Poll for new messages so the thread updates without a manual reload
  // -- this app doesn't use Supabase Realtime anywhere else, so a plain
  // interval (paused while the tab isn't visible) is the lowest-risk way
  // to get "live enough" messaging here. Mirrors the same effect on the
  // agent side, agent/transactions/[id]/page.tsx.
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchMessages();
    }, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedParams.id]);

  // Who currently has (or has been invited to have) agent-portal access
  // to this transaction -- non-fatal if this fails, the section just
  // shows as empty.
  const fetchAgentAccess = async () => {
    try {
      const res = await authFetch(`/api/agent-invites?transactionId=${resolvedParams.id}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.invites)) setAgentInvites(data.invites);
      if (Array.isArray(data.agents)) setAcceptedAgentUsers(data.agents);
    } catch {
      // ignore
    }
  };

  const fetchMessages = async () => {
    try {
      const res = await authFetch(`/api/messages?transactionId=${resolvedParams.id}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) setMessages(data);
    } catch {
      // ignore
    }
  };

  const fetchEmails = async () => {
    try {
      const res = await authFetch(`/api/email/inbound?transactionId=${resolvedParams.id}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) setEmails(data);
    } catch {
      // ignore -- the Communication card just shows nothing if this fails.
    }
  };

  // This transaction's own inbound-email address -- forward/CC mail
  // about the deal here and it threads onto the transaction (see
  // src/app/api/email/inbound/route.ts). null until an inbound domain
  // is actually configured (NEXT_PUBLIC_INBOUND_EMAIL_DOMAIN), so the
  // Communication card can show a setup note instead of a broken address.
  const inboundDomain = process.env.NEXT_PUBLIC_INBOUND_EMAIL_DOMAIN;
  const inboundAddress =
    transaction?.inbound_token && inboundDomain ? `deal-${transaction.inbound_token}@${inboundDomain}` : null;

  const handleCopyInboundAddress = async () => {
    if (!inboundAddress) return;
    try {
      await navigator.clipboard.writeText(inboundAddress);
      setCopiedInboundAddress(true);
      setTimeout(() => setCopiedInboundAddress(false), 2000);
    } catch {
      // Clipboard API can be blocked (permissions, non-HTTPS, etc.) --
      // non-critical, the address is still shown as selectable text.
    }
  };

  const handleAttachFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !transaction) return;
    try {
      setIsAttachingFile(true);
      setAttachError('');
      const formData = new FormData();
      formData.append('file', file);
      formData.append('transactionId', transaction.id);
      formData.append('category', DEFAULT_CATEGORY_KEY);
      formData.append('documentType', DEFAULT_DOCUMENT_TYPE);
      formData.append('requiresSignature', 'false');
      const res = await authFetch('/api/documents', { method: 'POST', body: formData });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to attach file');
      setPendingAttachment({ id: result.id, fileName: result.file_name });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setAttachError(error instanceof Error ? error.message : 'Failed to attach file');
    } finally {
      setIsAttachingFile(false);
    }
  };

  const handleSendMessage = async () => {
    const text = messageDraft.trim();
    if ((!text && !pendingAttachment) || !transaction) return;
    try {
      setSendingMessage(true);
      const res = await authFetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId: transaction.id,
          body: text,
          ...(pendingAttachment ? { attachmentDocumentId: pendingAttachment.id } : {}),
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to send message');
      setMessages((prev) => [...prev, result]);
      setMessageDraft('');
      setPendingAttachment(null);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      console.error('Error sending message:', error);
    } finally {
      setSendingMessage(false);
    }
  };

  const handleInviteAgent = async () => {
    const email = inviteEmailDraft.trim();
    if (!email || !transaction) return;
    try {
      setIsInvitingAgent(true);
      setInviteMessage('');
      const res = await authFetch('/api/agent-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: transaction.id, email }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to send invite');
      setInviteEmailDraft('');
      setInviteMessage(`Invite sent to ${email}.`);
      await fetchAgentAccess();
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setInviteMessage(error instanceof Error ? error.message : 'Failed to send invite');
    } finally {
      setIsInvitingAgent(false);
    }
  };

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

  // --- Contacts: draft (unsaved) boxes ---

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
    // Defense in depth alongside the container-level onBlur guard: never
    // let a second save for the same draft start while the first is
    // still in flight (the draft isn't removed from state until the
    // POST resolves, so without this a fast double-blur could still
    // slip two requests through).
    if (savingContactId === draftId) return;

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

  // --- Contacts: saved (persisted) rows ---

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

  // Per-task "Waiting On" -- who/what is blocking this task (lender,
  // title, buyer, etc.) and since when, independent of due date and
  // completed state. Feeds the cross-transaction "Needs Attention" view.
  const [editingWaitingOnTaskId, setEditingWaitingOnTaskId] = useState<string | null>(null);
  const [editingWaitingOnValue, setEditingWaitingOnValue] = useState('');
  const [isSavingWaitingOn, setIsSavingWaitingOn] = useState(false);

  const startEditWaitingOn = (task: Task) => {
    setEditingWaitingOnTaskId(task.id);
    setEditingWaitingOnValue(task.waiting_on ?? '');
  };

  const cancelEditWaitingOn = () => setEditingWaitingOnTaskId(null);

  const saveWaitingOn = async (taskId: string, valueOverride?: string | null) => {
    const value = (valueOverride !== undefined ? valueOverride ?? '' : editingWaitingOnValue).trim();
    setIsSavingWaitingOn(true);
    try {
      const response = await authFetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ waitingOn: value || null }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to update "Waiting on"');

      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, waiting_on: result.waiting_on, waiting_on_since: result.waiting_on_since } : t
        )
      );
      setEditingWaitingOnTaskId(null);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      console.error('Error updating waiting on:', error);
      alert('Failed to update "Waiting on". Check console for details.');
    } finally {
      setIsSavingWaitingOn(false);
    }
  };

  const daysSince = (dateIso: string): number => {
    const start = new Date(`${dateIso}T00:00:00Z`).getTime();
    const now = new Date();
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return Math.max(0, Math.round((todayUtc - start) / 86400000));
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

  // Combined shortcut for TCs who don't want to check off every checklist
  // item by hand: closes the transaction (server auto-checks every task to
  // match, exactly like picking "Closed" from the Status dropdown) and then
  // creates the invoice in the same click. If closing succeeds but invoice
  // creation fails, the transaction is left Closed and the standalone
  // "Create Invoice" button (rendered once status is Closed) picks up from
  // there -- nothing is double-run or lost.
  const handleCloseAndCreateInvoice = async () => {
    if (!transaction) return;
    const confirmed = confirm(
      "Mark this transaction as Closed? This checks off every checklist item and lets you invoice the agent right away."
    );
    if (!confirmed) return;

    try {
      setIsClosingAndInvoicing(true);
      setCreateInvoiceError(null);

      const statusResponse = await authFetch(`/api/transactions/[id]?id=${transaction.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Closed' }),
      });
      if (!statusResponse.ok) {
        throw new Error('Failed to mark the transaction as closed');
      }
      const updatedTransaction = await statusResponse.json();
      const { tasks: syncedTasks, ...transactionFields } = updatedTransaction;
      setTransaction(transactionFields);
      if (Array.isArray(syncedTasks)) {
        setTasks(syncedTasks);
      }

      const invoiceResponse = await authFetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: transactionFields.agent_id,
          transactionId: transactionFields.id,
          purchasePrice: transactionFields.purchase_price,
        }),
      });
      const invoiceResult = await invoiceResponse.json();
      if (!invoiceResponse.ok) {
        throw new Error(
          invoiceResult.error ||
            'Transaction was closed, but creating the invoice failed. Use Create Invoice below to try again.'
        );
      }
      setInvoice(invoiceResult);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setCreateInvoiceError(
        error instanceof Error ? error.message : 'Failed to close the transaction and create the invoice'
      );
    } finally {
      setIsClosingAndInvoicing(false);
    }
  };

  // Paid is all-or-nothing, same as the dedicated invoice page -- a
  // closing payout isn't something agents pay in installments, so
  // marking paid here always records the full invoiced amount too.
  const handleMarkInvoicePaid = async () => {
    if (!invoice) return;
    try {
      setIsMarkingInvoicePaid(true);
      setMarkInvoicePaidError(null);
      const response = await authFetch('/api/invoices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: invoice.id,
          paid: true,
          paidAmount: invoice.amount_owed,
        }),
      });
      if (!response.ok) throw new Error('Failed to mark invoice as paid');
      const updated = await response.json();
      setInvoice(updated);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setMarkInvoicePaidError(error instanceof Error ? error.message : 'Failed to mark invoice as paid');
    } finally {
      setIsMarkingInvoicePaid(false);
    }
  };

  const handleMarkInvoiceUnpaid = async () => {
    if (!invoice) return;
    try {
      setIsMarkingInvoicePaid(true);
      setMarkInvoicePaidError(null);
      const response = await authFetch('/api/invoices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: invoice.id, paid: false }),
      });
      if (!response.ok) throw new Error('Failed to mark invoice as unpaid');
      const updated = await response.json();
      setInvoice(updated);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setMarkInvoicePaidError(error instanceof Error ? error.message : 'Failed to mark invoice as unpaid');
    } finally {
      setIsMarkingInvoicePaid(false);
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
            {transaction.status === 'Closed' && invoice && (
              <div className="flex justify-end mb-4">
                <span className="inline-block px-3 py-1 bg-green-500/20 border border-green-500/50 text-green-300 text-xs font-semibold rounded-full">
                  ✓ Invoice Generated
                </span>
              </div>
            )}
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

          {/* Invoice: no longer gated on the deal being manually walked to
              Closed via the checklist -- some TCs don't want to check off
              every item by hand. Once Closed (by either path), the plain
              "Create Invoice" button applies the agent's fee. Before that,
              "Mark as Closed & Create Invoice" does both in one click: it
              closes the transaction (auto-checking the checklist to match,
              same as the Status dropdown) and invoices it right after.
              Never auto-generated on any plan -- always a deliberate
              click either way. */}
          <div className="pt-6 mt-6 border-t border-slate-600">
            {invoice ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Invoice</p>
                    <p className="text-slate-100 font-semibold">
                      {invoice.invoice_number} · ${invoice.amount_owed.toLocaleString()} ·{' '}
                      <span className={invoice.paid ? 'text-green-400' : 'text-blue-400'}>
                        {invoice.paid ? 'Paid' : 'Unpaid'}
                      </span>
                    </p>
                    {invoice.paid && invoice.paid_at && (
                      <p className="text-xs text-slate-500 mt-0.5">Paid on {formatDisplayDate(invoice.paid_at)}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {/* Marking paid/unpaid right here saves the click into
                        the dedicated invoice page for the common case --
                        money came in some other way (check, Zelle, cash)
                        and the TC just needs to record it. Not shown once
                        Stripe has already settled it (refunded is a
                        Stripe-only state) -- that stays a read-only record
                        on the invoice page itself. */}
                    {!invoice.refunded &&
                      (invoice.paid ? (
                        <button
                          onClick={handleMarkInvoiceUnpaid}
                          disabled={isMarkingInvoicePaid}
                          className="px-3 py-1.5 border border-slate-600 hover:border-slate-500 text-slate-300 hover:text-slate-100 rounded-lg transition text-sm font-medium disabled:opacity-50"
                        >
                          {isMarkingInvoicePaid ? 'Updating…' : 'Mark as Unpaid'}
                        </button>
                      ) : (
                        <button
                          onClick={handleMarkInvoicePaid}
                          disabled={isMarkingInvoicePaid}
                          className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg transition text-sm font-semibold disabled:opacity-50"
                        >
                          {isMarkingInvoicePaid ? 'Saving…' : 'Mark as Paid'}
                        </button>
                      ))}
                    <Link
                      href={`/dashboard/invoices/${invoice.id}`}
                      className="text-sm font-medium text-blue-400 hover:text-blue-300 whitespace-nowrap"
                    >
                      View invoice →
                    </Link>
                  </div>
                </div>
                {markInvoicePaidError && <p className="text-sm text-red-400">{markInvoicePaidError}</p>}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-slate-400">
                      {transaction.status === 'Closed'
                        ? 'No invoice yet for this closed deal.'
                        : "Not using the checklist to track this deal? Close it and invoice the agent in one step."}
                    </p>
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
                  {transaction.status === 'Closed' ? (
                    <button
                      onClick={handleCreateInvoice}
                      disabled={isCreatingInvoice}
                      className="px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
                    >
                      {isCreatingInvoice ? 'Creating…' : 'Create Invoice'}
                    </button>
                  ) : (
                    <button
                      onClick={handleCloseAndCreateInvoice}
                      disabled={isClosingAndInvoicing}
                      className="px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50 whitespace-nowrap"
                    >
                      {isClosingAndInvoicing ? 'Closing…' : 'Mark as Closed & Create Invoice'}
                    </button>
                  )}
                </div>
                {createInvoiceError && <p className="text-sm text-red-400">{createInvoiceError}</p>}
              </div>
            )}
          </div>

          {/* Agent portal access: invite the agent (or anyone else who
              needs it) onto this deal's read-only portal -- checklist
              status, documents, and the message thread below. Free for
              them, scoped to just this transaction. */}
          <div className="pt-6 mt-6 border-t border-slate-600">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Agent Portal Access</p>
            <p className="text-xs text-slate-500 mb-3">
              Give someone a free, view-only login scoped to this deal -- checklist status, documents, and
              messaging. No password for them to set; they just click the emailed link.
            </p>

            {(acceptedAgentUsers.length > 0 || agentInvites.length > 0) && (
              <div className="space-y-1.5 mb-3">
                {acceptedAgentUsers.map((a) => (
                  <div key={a.userId} className="flex items-center gap-2 text-sm">
                    <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                    <span className="text-slate-200">{a.email}</span>
                    <span className="text-slate-500 text-xs">has access</span>
                  </div>
                ))}
                {agentInvites
                  .filter((inv) => inv.status !== 'accepted')
                  .map((inv) => (
                    <div key={inv.id} className="flex items-center gap-2 text-sm">
                      <span className="w-2 h-2 rounded-full bg-slate-500 shrink-0" />
                      <span className="text-slate-300">{inv.email}</span>
                      <span className="text-slate-500 text-xs">invited, not yet accepted</span>
                    </div>
                  ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <input
                type="email"
                value={inviteEmailDraft}
                onChange={(e) => setInviteEmailDraft(e.target.value)}
                placeholder="agent@example.com"
                className="flex-1 min-w-[12rem] bg-slate-600 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 text-sm focus:border-blue-500 focus:outline-none"
              />
              <button
                onClick={handleInviteAgent}
                disabled={isInvitingAgent || !inviteEmailDraft.trim()}
                className="px-4 py-2 bg-slate-600 hover:bg-slate-500 border border-slate-600 text-slate-100 text-sm font-semibold rounded-lg transition disabled:opacity-50"
              >
                {isInvitingAgent ? 'Sending…' : 'Invite'}
              </button>
            </div>
            {inviteMessage && <p className="text-xs text-slate-400 mt-2">{inviteMessage}</p>}
          </div>
        </div>

        {/* Checklist + Documents, side by side on desktop: documents are
            the primary view (wide, left), the checklist is compact
            (narrow, right) so both are usable without scrolling past one
            to reach the other. Both stack full-width on mobile, in source
            order (checklist first, documents below). */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8 mt-8">

        {/* Tasks Section + Contacts, stacked together in the
            narrow right column on desktop (this wrapper carries the
            order/self-start that used to live on the Checklist div
            directly, since it's now the thing actually placed in the
            grid). Both still stack full-width on mobile in source order. */}
        <div className="lg:order-2 lg:self-start flex flex-col gap-8">
        {/* Messages: compact preview of the latest message plus a link to
            the full-page DM-style portal (dashboard/transactions/[id]/
            messages/page.tsx) -- larger bubbles, an avatar + name on every
            message, read/reply in a dedicated view instead of this narrow
            column. See fetchMessages/messages state above, still used here
            to drive the preview and the unread-feeling "latest line". */}
        <div className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-6 flex flex-col h-[28rem]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-slate-100">Messages</h2>
            {acceptedAgentUsers.length > 0 && (
              <Link
                href={`/dashboard/transactions/${resolvedParams.id}/messages`}
                className="text-sm text-blue-400 hover:text-blue-300 font-medium transition"
              >
                Open Messages →
              </Link>
            )}
          </div>
          {acceptedAgentUsers.length === 0 ? (
            <p className="text-slate-500 text-sm">
              Invite an agent above to start a conversation here -- it stays on this deal instead of your
              regular inbox.
            </p>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto space-y-3 mb-4 pr-1">
                {messages.length === 0 && <p className="text-slate-500 text-sm">No messages yet -- say hello.</p>}
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.sender_role === 'tc' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                        m.sender_role === 'tc' ? 'bg-blue-600 text-white' : 'bg-slate-800/70 text-slate-200'
                      }`}
                    >
                      {m.body && <p>{m.body}</p>}
                      {m.attachment && (
                        <a
                          href={m.attachment.url || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`flex items-center gap-1.5 text-xs underline underline-offset-2 ${
                            m.sender_role === 'tc' ? 'text-blue-100' : 'text-blue-300'
                          } ${m.body ? 'mt-1.5' : ''}`}
                        >
                          📎 {m.attachment.fileName}
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <input
                ref={messageFileInputRef}
                type="file"
                accept="application/pdf,image/*,.doc,.docx"
                className="hidden"
                onChange={handleAttachFileSelected}
              />
              {attachError && <p className="text-xs text-red-400 mb-2">{attachError}</p>}
              {pendingAttachment && (
                <div className="flex items-center gap-2 mb-2 text-xs text-slate-300 bg-slate-700/50 border border-slate-600 rounded-lg px-2.5 py-1.5">
                  <span className="truncate flex-1">📎 {pendingAttachment.fileName}</span>
                  <button
                    type="button"
                    onClick={() => setPendingAttachment(null)}
                    className="text-slate-500 hover:text-red-400 transition flex-shrink-0"
                  >
                    ✕
                  </button>
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => messageFileInputRef.current?.click()}
                  disabled={isAttachingFile}
                  title="Attach a file"
                  className="px-3 py-2 bg-slate-600 hover:bg-slate-500 border border-slate-600 text-slate-200 rounded-lg transition disabled:opacity-50 flex-shrink-0"
                >
                  {isAttachingFile ? '…' : '📎'}
                </button>
                <input
                  type="text"
                  value={messageDraft}
                  onChange={(e) => setMessageDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder="Message the agent…"
                  className="flex-1 bg-slate-600 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 text-sm focus:border-blue-500 focus:outline-none"
                />
                <button
                  onClick={handleSendMessage}
                  disabled={sendingMessage || (!messageDraft.trim() && !pendingAttachment)}
                  className="px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </>
          )}
        </div>
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
                className="group px-3 py-2 bg-slate-700/30 border border-slate-600 rounded-lg hover:border-slate-600 transition"
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
                          {formatDisplayDate(task.due_date, { month: '2-digit', day: '2-digit' })}
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

                {!task.completed && editingWaitingOnTaskId !== task.id && (
                  <div className="mt-1.5 pl-7 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    {task.waiting_on ? (
                      <>
                        <span className="text-xs font-medium text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-full px-2 py-0.5">
                          {'\u23F3'} Waiting on {task.waiting_on}
                          {task.waiting_on_since ? ` \u00b7 ${daysSince(task.waiting_on_since)}d` : ''}
                        </span>
                        <button
                          type="button"
                          onClick={() => startEditWaitingOn(task)}
                          className="text-xs text-blue-400 hover:text-blue-300 font-medium opacity-0 group-hover:opacity-100 transition"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => saveWaitingOn(task.id, null)}
                          disabled={isSavingWaitingOn}
                          className="text-xs text-slate-500 hover:text-slate-300 font-medium opacity-0 group-hover:opacity-100 transition disabled:opacity-50"
                        >
                          Clear
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEditWaitingOn(task)}
                        className="text-xs text-slate-500 hover:text-slate-300 font-medium opacity-0 group-hover:opacity-100 transition"
                      >
                        + Waiting on...
                      </button>
                    )}
                  </div>
                )}

                {editingWaitingOnTaskId === task.id && (
                  <div
                    className="mt-1.5 pl-7 flex flex-wrap items-center gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="text"
                      value={editingWaitingOnValue}
                      onChange={(e) => setEditingWaitingOnValue(e.target.value)}
                      placeholder="e.g. Lender, Title, Buyer"
                      autoFocus
                      className="flex-1 min-w-[140px] bg-slate-600 border border-slate-600 rounded-lg px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                    />
                    {['Lender', 'Title', 'Buyer', 'Seller', 'Inspector'].map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => setEditingWaitingOnValue(suggestion)}
                        className="text-xs px-2 py-1 border border-slate-600 hover:border-slate-500 text-slate-400 hover:text-slate-200 rounded-lg transition"
                      >
                        {suggestion}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => saveWaitingOn(task.id)}
                      disabled={isSavingWaitingOn}
                      className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-medium disabled:opacity-50"
                    >
                      {isSavingWaitingOn ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditWaitingOn}
                      disabled={isSavingWaitingOn}
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

        {/* Contacts: the agent (read-only, from the agents record)
            plus any other parties for this deal, typed in by hand. Sits
            directly under the Checklist card via the shared wrapper above. */}
        <div className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-6">
          <h2 className="text-lg font-bold text-slate-100 mb-4">Contacts</h2>

          <div className="space-y-4">
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

            {/* Saved parties -- a compact read-only card (matching the
                Agent row above) until "Edit" is clicked. */}
            {contacts.map((contact) =>
              editingContactId === contact.id ? (
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
                      onClick={() => setEditingContactId(null)}
                      className="text-xs text-blue-400 hover:text-blue-300 font-medium flex-shrink-0"
                    >
                      Done
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
                    onChange={(e) => handleContactChange(contact.id, 'email', formatEmailInput(e.target.value))}
                    onBlur={(e) => handleContactBlur(contact.id, 'email', e.target.value)}
                    placeholder="Email"
                    className="w-full bg-slate-600 border border-slate-600 rounded-lg px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                  <input
                    type="tel"
                    inputMode="tel"
                    value={contact.phone || ''}
                    onChange={(e) => handleContactChange(contact.id, 'phone', formatPhoneInput(e.target.value))}
                    onBlur={(e) => handleContactBlur(contact.id, 'phone', e.target.value)}
                    placeholder="Phone"
                    className="w-full bg-slate-600 border border-slate-600 rounded-lg px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                  <div className="flex items-center justify-between">
                    {savingContactId === contact.id ? (
                      <p className="text-[11px] text-slate-500">Saving...</p>
                    ) : (
                      <span />
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemoveContact(contact.id)}
                      className="text-xs text-slate-500 hover:text-red-400 transition flex-shrink-0"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  key={contact.id}
                  className="px-3 py-2 bg-slate-700/30 border border-slate-600 rounded-lg"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-blue-400">{contact.role || 'Contact'}</span>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setEditingContactId(contact.id)}
                        className="text-xs text-slate-500 hover:text-slate-300 transition"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveContact(contact.id)}
                        className="text-xs text-slate-500 hover:text-red-400 transition"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  <p className="text-sm font-medium text-slate-200 mt-1">{contact.name || 'Unnamed'}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{contact.email || 'No email on file'}</p>
                  <p className="text-xs text-slate-400">{contact.phone || 'No phone on file'}</p>
                </div>
              )
            )}

            {/* Blank boxes -- become real rows once something's typed in. */}
            {draftContacts.map((draft) => (
              <div
                key={draft.draftId}
                className="px-3 py-2 bg-slate-700/20 border border-dashed border-slate-600 rounded-lg space-y-1.5"
                onBlur={(e) => {
                  // Commit once, when focus leaves the whole draft box --
                  // not on every individual field's blur. relatedTarget is
                  // the element about to gain focus; if it's still inside
                  // this box (the user just tabbed to the next field in
                  // the same draft), there's nothing to save yet. Firing
                  // per-field used to POST a separate, incomplete contact
                  // for every tab stop and silently drop whichever field
                  // was typed last (see handleDraftContactBlur).
                  if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
                  handleDraftContactBlur(draft.draftId);
                }}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={draft.role}
                    onChange={(e) => handleDraftContactChange(draft.draftId, 'role', e.target.value)}
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
                  placeholder="Name or company"
                  className="w-full bg-slate-600 border border-slate-600 rounded-lg px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
                <input
                  type="email"
                  value={draft.email}
                  onChange={(e) => handleDraftContactChange(draft.draftId, 'email', formatEmailInput(e.target.value))}
                  placeholder="Email"
                  className="w-full bg-slate-600 border border-slate-600 rounded-lg px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                />
                <input
                  type="tel"
                  inputMode="tel"
                  value={draft.phone}
                  onChange={(e) => handleDraftContactChange(draft.draftId, 'phone', formatPhoneInput(e.target.value))}
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

        {/* Communication -- emails forwarded/CC'd to this transaction's
            own inbound address land here (see src/app/api/email/inbound/
            route.ts). Deliberately placed at the very bottom of the page,
            below everything else and its own full-width section rather
            than living in the primary right-hand column -- this is an
            optional, low-priority tool (manual CC/forward, not automatic
            capture), not something every TC is funneled into using.
            Hidden entirely (not just the address) until
            NEXT_PUBLIC_INBOUND_EMAIL_DOMAIN is actually set -- no TC
            should ever see a backend setup/env-var message; it either
            works or it isn't there yet. */}
        {inboundDomain && (
          <div className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-6 mt-8">
            <h2 className="text-lg font-bold text-slate-100 mb-1">Communication</h2>
            <p className="text-xs text-slate-400 mb-3">
              Forward or CC emails about this deal here and they&apos;ll show up below — no need to change how you
              already send email.
            </p>

            <div className="flex items-center gap-2 mb-4">
              <code className="flex-1 min-w-0 truncate bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs text-blue-300">
                {inboundAddress}
              </code>
              <button
                type="button"
                onClick={handleCopyInboundAddress}
                className="flex-shrink-0 px-3 py-2 text-xs border border-slate-600 hover:border-slate-500 text-slate-300 rounded-lg transition"
              >
                {copiedInboundAddress ? 'Copied!' : 'Copy'}
              </button>
            </div>

            {emails.length === 0 ? (
              <p className="text-xs text-slate-500">No emails forwarded to this deal yet.</p>
            ) : (
              <div className="space-y-2">
                {emails.map((email) => (
                  <div key={email.id} className="px-3 py-2 bg-slate-700/30 border border-slate-600 rounded-lg">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-slate-200 truncate">{email.subject || '(no subject)'}</p>
                      <span className="text-xs text-slate-500 flex-shrink-0 whitespace-nowrap">
                        {formatDisplayDate(email.received_at.slice(0, 10), { month: '2-digit', day: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">{email.from_name || email.from_email}</p>
                    {email.body_text && (
                      <p className="text-xs text-slate-500 mt-1.5 line-clamp-2">{email.body_text}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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
