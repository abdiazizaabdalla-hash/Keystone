'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import { DueDateSpec, normalizeDueDateSpec } from '@/lib/dueDates';
import DueDateControl from '@/components/DueDateControl';

function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const stripeReturnStatus = searchParams.get('stripe');
  const googleCalendarReturnStatus = searchParams.get('googleCalendar');
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [fullName, setFullName] = useState('');
  const [defaultFlatFee, setDefaultFlatFee] = useState('400');
  const [defaultPercentFee, setDefaultPercentFee] = useState('0');
  const [invoiceDueDays, setInvoiceDueDays] = useState('30');

  // Due-date workflow: whether new transactions get auto-calculated
  // checklist due dates at all, and this TC's own per-step rule for each
  // Baseline step (set up during onboarding, editable here anytime). A
  // separate save action from the main "Save Settings" button below,
  // same pattern as the Checklist Templates section.
  const [dueDateWorkflowEnabled, setDueDateWorkflowEnabled] = useState(false);
  const [dueDateWorkflowSteps, setDueDateWorkflowSteps] = useState<{ name: string; dueDate: DueDateSpec }[]>([]);
  const [isSavingDueDateWorkflow, setIsSavingDueDateWorkflow] = useState(false);
  const [dueDateWorkflowMessage, setDueDateWorkflowMessage] = useState('');
  const [paymentPreference, setPaymentPreference] = useState<'stripe' | 'manual' | null>(null);
  const [stripeConnectStatus, setStripeConnectStatus] = useState<{ connected: boolean; status: string | null } | null>(null);
  const [isStartingStripeConnect, setIsStartingStripeConnect] = useState(false);
  const [isSavingPaymentPreference, setIsSavingPaymentPreference] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState('');

  // Google Calendar connect/disconnect (Settings only for now -- see
  // /api/google-calendar/*).
  const [googleCalendarStatus, setGoogleCalendarStatus] = useState<{ connected: boolean; email: string | null } | null>(null);
  const [isStartingGoogleCalendar, setIsStartingGoogleCalendar] = useState(false);
  const [isDisconnectingGoogleCalendar, setIsDisconnectingGoogleCalendar] = useState(false);
  const [googleCalendarMessage, setGoogleCalendarMessage] = useState('');

  // Checklist templates (Pro/Team only) -- kept separate from the main
  // profile/agent-defaults form above since each template edit is its own
  // save action, not part of the "Save Settings" submit.
  interface TemplateStepDraft {
    name: string;
    dueDate: DueDateSpec;
  }
  const EMPTY_STEP_DRAFT: TemplateStepDraft = { name: '', dueDate: { mode: 'none' } };

  const [templates, setTemplates] = useState<
    { id: string; name: string; steps: { name: string; dueDate?: DueDateSpec | null }[]; isBaseline: boolean }[]
  >([]);
  const [canUseCustomTemplates, setCanUseCustomTemplates] = useState(false);
  const [templateMessage, setTemplateMessage] = useState('');
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null); // 'new' or a template id
  const [templateNameDraft, setTemplateNameDraft] = useState('');
  const [templateStepsDraft, setTemplateStepsDraft] = useState<TemplateStepDraft[]>([EMPTY_STEP_DRAFT]);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings();
    fetchStripeConnectStatus();
    fetchGoogleCalendarStatus();
    fetchTemplates();

    // Landing back here from Stripe Connect's hosted onboarding (see
    // /api/stripe/connect/return).
    if (stripeReturnStatus === 'refresh') {
      setPaymentMessage("That link expired before you finished — click Connect Stripe to get a new one.");
    } else if (stripeReturnStatus === 'error') {
      setPaymentMessage('Something went wrong connecting Stripe. Please try again.');
    } else if (stripeReturnStatus === 'connected') {
      setPaymentMessage('Stripe connected.');
    }

    // Landing back here from Google's consent screen (see
    // /api/google-calendar/callback).
    if (googleCalendarReturnStatus === 'connected') {
      setGoogleCalendarMessage('Google Calendar connected.');
    } else if (googleCalendarReturnStatus === 'no_refresh_token') {
      setGoogleCalendarMessage(
        'Google didn\'t grant lasting access this time — disconnect any prior Relay access in your Google Account settings, then try connecting again.'
      );
    } else if (googleCalendarReturnStatus === 'error') {
      setGoogleCalendarMessage('Something went wrong connecting Google Calendar. Please try again.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Arriving via a #checklist-templates link (e.g. from a transaction
  // page) — scroll there once the page has actually rendered. A plain
  // browser anchor-scroll can land in the wrong place because this
  // section's content (and everything above it) only appears after
  // fetchSettings/fetchTemplates resolve.
  useEffect(() => {
    if (loading) return;
    if (typeof window === 'undefined' || window.location.hash !== '#checklist-templates') return;
    const el = document.getElementById('checklist-templates');
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [loading]);

  const fetchTemplates = async () => {
    try {
      const response = await authFetch('/api/checklist-templates');
      if (!response.ok) return;
      const data = await response.json();
      if (Array.isArray(data.templates)) setTemplates(data.templates);
      setCanUseCustomTemplates(Boolean(data.customChecklists));
    } catch {
      // Non-fatal — the section just shows as unavailable/empty.
    }
  };

  const startNewTemplate = () => {
    setTemplateMessage('');
    setEditingTemplateId('new');
    setTemplateNameDraft('');
    setTemplateStepsDraft([EMPTY_STEP_DRAFT]);
  };

  const startEditTemplate = (template: { id: string; name: string; steps: { name: string; dueDate?: DueDateSpec | null }[] }) => {
    setTemplateMessage('');
    setEditingTemplateId(template.id);
    setTemplateNameDraft(template.name);
    setTemplateStepsDraft(
      template.steps.length > 0
        ? template.steps.map((step) => ({
            name: step.name,
            dueDate: step.dueDate ? normalizeDueDateSpec(step.dueDate) : { mode: 'none' },
          }))
        : [EMPTY_STEP_DRAFT]
    );
  };

  const cancelEditTemplate = () => {
    setEditingTemplateId(null);
    setTemplateNameDraft('');
    setTemplateStepsDraft([EMPTY_STEP_DRAFT]);
  };

  const updateStepDraft = (index: number, value: string) => {
    setTemplateStepsDraft((prev) => prev.map((s, i) => (i === index ? { ...s, name: value } : s)));
  };

  const updateStepDueDateDraft = (index: number, dueDate: DueDateSpec) => {
    setTemplateStepsDraft((prev) => prev.map((s, i) => (i === index ? { ...s, dueDate } : s)));
  };

  const addStepDraft = () => {
    setTemplateStepsDraft((prev) => [...prev, EMPTY_STEP_DRAFT]);
  };

  const removeStepDraft = (index: number) => {
    setTemplateStepsDraft((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  };

  const moveStepDraft = (index: number, direction: -1 | 1) => {
    setTemplateStepsDraft((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const saveTemplate = async () => {
    const name = templateNameDraft.trim();
    const steps = templateStepsDraft
      .map((s) => {
        const trimmedName = s.name.trim();
        if (trimmedName.length === 0) return null;
        return s.dueDate.mode === 'none'
          ? { name: trimmedName }
          : { name: trimmedName, dueDate: s.dueDate };
      })
      .filter((s): s is { name: string; dueDate?: DueDateSpec } => s !== null);

    if (!name) {
      setTemplateMessage('Give your template a name.');
      return;
    }
    if (steps.length === 0) {
      setTemplateMessage('Add at least one step.');
      return;
    }

    try {
      setIsSavingTemplate(true);
      setTemplateMessage('');
      const isNew = editingTemplateId === 'new';
      const response = await authFetch(
        isNew ? '/api/checklist-templates' : `/api/checklist-templates/${editingTemplateId}`,
        {
          method: isNew ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, steps }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save template');

      await fetchTemplates();
      setEditingTemplateId(null);
      setTemplateNameDraft('');
      setTemplateStepsDraft([EMPTY_STEP_DRAFT]);
      setTemplateMessage('Template saved.');
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setTemplateMessage(error instanceof Error ? error.message : 'Error saving template');
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const deleteTemplate = async (id: string) => {
    if (!confirm('Delete this checklist template? Deals already using it keep their checklist as-is.')) return;
    try {
      setDeletingTemplateId(id);
      const response = await authFetch(`/api/checklist-templates/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete template');
      }
      await fetchTemplates();
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setTemplateMessage(error instanceof Error ? error.message : 'Error deleting template');
    } finally {
      setDeletingTemplateId(null);
    }
  };

  const fetchStripeConnectStatus = async () => {
    try {
      const response = await authFetch('/api/stripe/connect/account');
      if (!response.ok) return;
      const data = await response.json();
      setStripeConnectStatus({ connected: data.connected, status: data.status });
      setPaymentPreference(data.paymentPreference || null);
    } catch {
      // Non-fatal — section just shows as "not connected".
    }
  };

  const handleConnectStripe = async () => {
    setIsStartingStripeConnect(true);
    setPaymentMessage('');
    try {
      const response = await authFetch('/api/stripe/connect/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'settings' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to start Stripe Connect');
      window.location.href = data.url;
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setPaymentMessage(error instanceof Error ? error.message : 'Error connecting to Stripe');
      setIsStartingStripeConnect(false);
    }
  };

  const fetchGoogleCalendarStatus = async () => {
    try {
      const response = await authFetch('/api/google-calendar/status');
      if (!response.ok) return;
      const data = await response.json();
      setGoogleCalendarStatus({ connected: Boolean(data.connected), email: data.email || null });
    } catch {
      // Non-fatal — section just shows as "not connected".
    }
  };

  const handleConnectGoogleCalendar = async () => {
    setIsStartingGoogleCalendar(true);
    setGoogleCalendarMessage('');
    try {
      const response = await authFetch('/api/google-calendar/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'settings' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to start Google Calendar connection');
      window.location.href = data.url;
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setGoogleCalendarMessage(error instanceof Error ? error.message : 'Error connecting to Google Calendar');
      setIsStartingGoogleCalendar(false);
    }
  };

  const handleDisconnectGoogleCalendar = async () => {
    if (!confirm('Disconnect Google Calendar? Due dates will stop syncing until you reconnect.')) return;
    setIsDisconnectingGoogleCalendar(true);
    setGoogleCalendarMessage('');
    try {
      const response = await authFetch('/api/google-calendar/disconnect', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to disconnect Google Calendar');
      setGoogleCalendarStatus({ connected: false, email: null });
      setGoogleCalendarMessage('Google Calendar disconnected.');
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setGoogleCalendarMessage(error instanceof Error ? error.message : 'Error disconnecting Google Calendar');
    } finally {
      setIsDisconnectingGoogleCalendar(false);
    }
  };

  const handleSetPaymentPreference = async (pref: 'stripe' | 'manual') => {
    setIsSavingPaymentPreference(true);
    setPaymentMessage('');
    try {
      const response = await authFetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentPreference: pref }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save payment preference');
      setPaymentPreference(pref);
      setPaymentMessage('Saved.');
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setPaymentMessage(error instanceof Error ? error.message : 'Error saving payment preference');
    } finally {
      setIsSavingPaymentPreference(false);
    }
  };

  const fetchSettings = async () => {
    try {
      const response = await authFetch('/api/auth/me');
      if (!response.ok) throw new Error('Failed to load settings');
      const data = await response.json();
      setFullName(data.fullName ?? '');
      setDefaultFlatFee(String(data.defaultFlatFee ?? 400));
      setDefaultPercentFee(String(data.defaultPercentFee ?? 0));
      setInvoiceDueDays(String(data.invoiceDueDays ?? 30));
      setDueDateWorkflowEnabled(data.dueDateWorkflowEnabled === true);
      if (Array.isArray(data.dueDateWorkflowSteps)) {
        setDueDateWorkflowSteps(
          data.dueDateWorkflowSteps.map((s: { name: string; dueDate?: unknown }) => ({
            name: s.name,
            dueDate: normalizeDueDateSpec(s.dueDate),
          }))
        );
      }
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      console.error('Error fetching settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateDueDateWorkflowStep = (index: number, dueDate: DueDateSpec) => {
    setDueDateWorkflowSteps((prev) => prev.map((s, i) => (i === index ? { ...s, dueDate } : s)));
  };

  const saveDueDateWorkflow = async () => {
    setIsSavingDueDateWorkflow(true);
    setDueDateWorkflowMessage('');
    try {
      const response = await authFetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dueDateWorkflowEnabled, dueDateWorkflowSteps }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save');

      setDueDateWorkflowEnabled(data.dueDateWorkflowEnabled === true);
      if (Array.isArray(data.dueDateWorkflowSteps)) {
        setDueDateWorkflowSteps(
          data.dueDateWorkflowSteps.map((s: { name: string; dueDate?: unknown }) => ({
            name: s.name,
            dueDate: normalizeDueDateSpec(s.dueDate),
          }))
        );
      }
      setDueDateWorkflowMessage('Saved.');
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setDueDateWorkflowMessage(error instanceof Error ? error.message : 'Error saving');
    } finally {
      setIsSavingDueDateWorkflow(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setMessage('');

    try {
      const response = await authFetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          defaultFlatFee: parseFloat(defaultFlatFee) || 0,
          defaultPercentFee: parseFloat(defaultPercentFee) || 0,
          invoiceDueDays: parseInt(invoiceDueDays, 10) || 30,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save settings');

      setFullName(data.fullName ?? '');
      setDefaultFlatFee(String(data.defaultFlatFee));
      setDefaultPercentFee(String(data.defaultPercentFee));
      setInvoiceDueDays(String(data.invoiceDueDays));
      setMessage('Settings saved.');
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setMessage(error instanceof Error ? error.message : 'Error saving settings');
    } finally {
      setIsSaving(false);
    }
  };

  // Controlled number inputs: keep the raw string in state so backspacing
  // to empty doesn't get immediately coerced back to "0", and don't let
  // mouse-wheel scrolling over a focused field change its value.
  const handleNumberChange =
    (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setter(e.target.value);
    };
  const blurOnWheel = (e: React.WheelEvent<HTMLInputElement>) => e.currentTarget.blur();

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full border-4 border-slate-600 border-t-blue-400 animate-spin mx-auto mb-4" />
            <p className="text-slate-400">Loading settings...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-3xl font-display font-semibold text-slate-100 mb-1">Settings</h1>
        <p className="text-slate-400">Preferences used across your account</p>
      </div>

      {message && (
        <div
          className={`mb-6 p-4 border rounded-lg ${
            message.includes('Error') || message.includes('Add the')
              ? 'bg-red-900/30 border-red-700 text-red-200'
              : 'bg-green-900/20 border-green-700/50 text-green-300'
          }`}
        >
          {message}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-8">
          <h2 className="text-lg font-bold text-slate-100 mb-1">Your Profile</h2>
          <p className="text-sm text-slate-400 mb-6">
            Shown to teammates on your Collaborate roster instead of your bare email address.
          </p>
          <div>
            <label className="text-sm text-slate-400 block mb-2">Full Name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Smith"
              className="w-full bg-slate-600 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-8">
          <h2 className="text-lg font-bold text-slate-100 mb-1">Agent Defaults</h2>
          <p className="text-sm text-slate-400 mb-6">
            Pre-fills the fee fields whenever you add a new agent. You can still change these per agent.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <label className="text-sm text-slate-400 block mb-2">Default Flat Fee per Deal ($)</label>
              <input
                type="number"
                value={defaultFlatFee}
                onChange={handleNumberChange(setDefaultFlatFee)}
                onWheel={blurOnWheel}
                placeholder="400"
                step="0.01"
                min="0"
                className="w-full bg-slate-600 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-sm text-slate-400 block mb-2">Default Percentage Fee (%)</label>
              <input
                type="number"
                value={defaultPercentFee}
                onChange={handleNumberChange(setDefaultPercentFee)}
                onWheel={blurOnWheel}
                placeholder="0"
                step="0.01"
                min="0"
                max="100"
                className="w-full bg-slate-600 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-8">
          <h2 className="text-lg font-bold text-slate-100 mb-1">Invoicing</h2>
          <p className="text-sm text-slate-400 mb-6">
            How many days an agent has to pay after an invoice is generated. You can still change the due date on
            any individual invoice afterward.
          </p>
          <div className="max-w-xs">
            <label className="text-sm text-slate-400 block mb-2">Due in (days)</label>
            <input
              type="number"
              value={invoiceDueDays}
              onChange={handleNumberChange(setInvoiceDueDays)}
              onWheel={blurOnWheel}
              placeholder="30"
              step="1"
              min="1"
              max="365"
              className="w-full bg-slate-600 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>

        <div id="due-date-workflow" className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-8 scroll-mt-6">
          <h2 className="text-lg font-bold text-slate-100 mb-1">Due-Date Workflow</h2>
          <p className="text-sm text-slate-400 mb-6">
            Off by default -- no checklist step gets a due date unless you turn this on. Once on, set your own
            rule for each Baseline step below (or leave a step on &quot;No due date&quot;). You can always fine-tune
            any individual step&apos;s date later from that transaction&apos;s own page.
          </p>

          {dueDateWorkflowMessage && (
            <div className="mb-4 text-sm text-slate-300">{dueDateWorkflowMessage}</div>
          )}

          <label className="flex items-center gap-2.5 text-sm text-slate-200 cursor-pointer mb-4">
            <input
              type="checkbox"
              checked={dueDateWorkflowEnabled}
              onChange={(e) => setDueDateWorkflowEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-slate-500 bg-slate-700 text-blue-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
            />
            Automatically calculate due dates
          </label>

          {dueDateWorkflowEnabled && (
            <div className="space-y-2 mb-6">
              {dueDateWorkflowSteps.map((step, index) => (
                <div
                  key={step.name}
                  className="flex flex-wrap items-center justify-between gap-2 bg-slate-800/50 border border-slate-600 rounded-lg px-4 py-3"
                >
                  <span className="text-slate-200 text-sm">{step.name}</span>
                  <DueDateControl value={step.dueDate} onChange={(next) => updateDueDateWorkflowStep(index, next)} />
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={saveDueDateWorkflow}
            disabled={isSavingDueDateWorkflow}
            className="px-5 py-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition disabled:opacity-50 text-sm"
          >
            {isSavingDueDateWorkflow ? 'Saving...' : 'Save'}
          </button>
        </div>

        <div id="checklist-templates" className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-8 scroll-mt-6">
          <div className="flex items-start justify-between gap-4 mb-1">
            <h2 className="text-lg font-bold text-slate-100">Checklist Templates</h2>
            {canUseCustomTemplates && (
              <span className="inline-block px-2.5 py-1 bg-blue-500/20 border border-blue-500/50 text-blue-300 text-xs font-semibold rounded-full shrink-0">
                Pro / Team
              </span>
            )}
          </div>
          <p className="text-sm text-slate-400 mb-6">
            Every deal starts from the Baseline checklist below for free. On Pro and Team, build your own
            checklist templates &mdash; add, remove, and reorder steps like widgets, and optionally give any step
            its own due date rule &mdash; and pick one per deal when you create it. Editing or deleting a template
            never changes the checklist on deals that already used it.
          </p>

          {templateMessage && (
            <div className="mb-4 text-sm text-slate-300">{templateMessage}</div>
          )}

          <div className="space-y-3 mb-6">
            <div className="flex items-center justify-between gap-4 bg-slate-800/50 border border-slate-600 rounded-lg px-4 py-3">
              <div>
                <p className="text-slate-100 font-medium text-sm">Baseline (default)</p>
                <p className="text-slate-500 text-xs">6 steps &middot; always available</p>
              </div>
            </div>

            {templates
              .filter((t) => !t.isBaseline)
              .map((template) => (
                <div
                  key={template.id}
                  className="flex items-center justify-between gap-4 bg-slate-800/50 border border-slate-600 rounded-lg px-4 py-3"
                >
                  <div>
                    <p className="text-slate-100 font-medium text-sm">{template.name}</p>
                    <p className="text-slate-500 text-xs">{template.steps.length} steps</p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <button
                      type="button"
                      onClick={() => startEditTemplate(template)}
                      className="text-blue-400 hover:text-blue-300 text-sm font-medium transition"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteTemplate(template.id)}
                      disabled={deletingTemplateId === template.id}
                      className="text-slate-500 hover:text-red-400 text-sm font-medium transition disabled:opacity-50"
                    >
                      {deletingTemplateId === template.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>
              ))}
          </div>

          {!canUseCustomTemplates ? (
            <div className="bg-blue-900/10 border border-blue-800/40 rounded-lg p-4 text-sm text-blue-200/90">
              Building your own checklist templates is available on the Pro and Team plans.{' '}
              <Link href="/dashboard/account" className="text-blue-400 hover:text-blue-300 font-medium transition">
                Upgrade
              </Link>{' '}
              to create one.
            </div>
          ) : editingTemplateId ? (
            <div className="bg-slate-800/50 border border-slate-600 rounded-lg p-6">
              <div className="mb-4">
                <label className="text-sm text-slate-400 block mb-2">Template Name</label>
                <input
                  type="text"
                  value={templateNameDraft}
                  onChange={(e) => setTemplateNameDraft(e.target.value)}
                  placeholder="e.g., Cash Deals"
                  className="w-full bg-slate-600 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-slate-400">Steps</label>
                <span className="text-xs text-slate-500">Due date is optional -- pick when each step should come due</span>
              </div>
              <div className="space-y-2 mb-4">
                {templateStepsDraft.map((step, index) => (
                  <div key={index} className="flex flex-wrap items-center gap-2">
                    <span className="text-slate-500 text-xs w-5 text-right shrink-0">{index + 1}.</span>
                    <input
                      type="text"
                      value={step.name}
                      onChange={(e) => updateStepDraft(index, e.target.value)}
                      placeholder={`Step ${index + 1}`}
                      className="flex-1 min-w-[10rem] bg-slate-600 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none text-sm"
                    />
                    <DueDateControl value={step.dueDate} onChange={(next) => updateStepDueDateDraft(index, next)} />
                    <button
                      type="button"
                      onClick={() => moveStepDraft(index, -1)}
                      disabled={index === 0}
                      className="text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:hover:text-slate-400 transition p-1"
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveStepDraft(index, 1)}
                      disabled={index === templateStepsDraft.length - 1}
                      className="text-slate-400 hover:text-slate-200 disabled:opacity-30 disabled:hover:text-slate-400 transition p-1"
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeStepDraft(index)}
                      disabled={templateStepsDraft.length <= 1}
                      className="text-slate-500 hover:text-red-400 disabled:opacity-30 disabled:hover:text-slate-500 transition p-1"
                      title="Remove step"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={addStepDraft}
                className="text-blue-400 hover:text-blue-300 text-sm font-medium transition mb-6"
              >
                + Add Step
              </button>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={saveTemplate}
                  disabled={isSavingTemplate}
                  className="px-5 py-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition disabled:opacity-50 text-sm"
                >
                  {isSavingTemplate ? 'Saving...' : 'Save Template'}
                </button>
                <button
                  type="button"
                  onClick={cancelEditTemplate}
                  disabled={isSavingTemplate}
                  className="px-5 py-2 border border-slate-600 hover:border-slate-500 text-slate-300 hover:text-slate-100 rounded-lg transition disabled:opacity-50 text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={startNewTemplate}
              className="px-5 py-2.5 bg-slate-600 hover:bg-slate-600 border border-slate-600 text-slate-100 font-semibold rounded-lg transition text-sm"
            >
              + New Template
            </button>
          )}
        </div>

        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-8">
          <h2 className="text-lg font-bold text-slate-100 mb-1">Getting Paid by Agents</h2>
          <p className="text-sm text-slate-400 mb-6">
            Choose how agents pay your transaction coordination invoices. Connect Stripe for a real
            &quot;Pay Online&quot; link &mdash; agents pay by card or bank transfer without creating an account, and
            the money lands directly in your own Stripe account (Relay never touches the funds). Or handle it
            yourself outside the platform (Zelle, PayPal, a check, etc.) and mark invoices paid yourself as the
            money comes in.
          </p>

          {paymentMessage && (
            <div className="mb-4 text-sm text-slate-300">{paymentMessage}</div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <div
              className={`rounded-lg border p-5 ${
                paymentPreference === 'stripe' ? 'border-blue-500 bg-slate-800/50' : 'border-slate-600'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="font-semibold text-slate-100 text-sm">Stripe</h3>
                {stripeConnectStatus?.status === 'approved' ? (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-900/30 text-green-300 border border-green-700/50">
                    Connected
                  </span>
                ) : stripeConnectStatus?.connected ? (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-900/30 text-blue-300 border border-blue-700/50">
                    Incomplete
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-slate-500 mb-4">
                Real online payments &mdash; card or bank transfer, straight to your Stripe account.
              </p>
              {stripeConnectStatus?.status === 'approved' ? (
                paymentPreference === 'stripe' ? (
                  <p className="text-xs text-slate-500">This is how you currently get paid.</p>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSetPaymentPreference('stripe')}
                    disabled={isSavingPaymentPreference}
                    className="text-sm px-4 py-2 bg-slate-600 hover:bg-slate-600 border border-slate-600 text-slate-100 font-semibold rounded-lg transition disabled:opacity-50"
                  >
                    Use Stripe
                  </button>
                )
              ) : (
                <button
                  type="button"
                  onClick={handleConnectStripe}
                  disabled={isStartingStripeConnect}
                  className="text-sm px-4 py-2 bg-slate-600 hover:bg-slate-600 border border-slate-600 text-slate-100 font-semibold rounded-lg transition disabled:opacity-50"
                >
                  {isStartingStripeConnect
                    ? 'Opening...'
                    : stripeConnectStatus?.connected
                    ? 'Finish connecting Stripe'
                    : 'Connect Stripe'}
                </button>
              )}
            </div>

            <div
              className={`rounded-lg border p-5 ${
                paymentPreference === 'manual' ? 'border-blue-500 bg-slate-800/50' : 'border-slate-600'
              }`}
            >
              <h3 className="font-semibold text-slate-100 text-sm mb-3">Handle it yourself</h3>
              <p className="text-xs text-slate-500 mb-4">
                Agents pay you directly (Zelle, Venmo, PayPal, a check, etc.). Mark invoices paid yourself once
                you&apos;ve received the money.
              </p>
              {paymentPreference === 'manual' ? (
                <p className="text-xs text-slate-500">This is how you currently get paid.</p>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSetPaymentPreference('manual')}
                  disabled={isSavingPaymentPreference}
                  className="text-sm px-4 py-2 bg-slate-600 hover:bg-slate-600 border border-slate-600 text-slate-100 font-semibold rounded-lg transition disabled:opacity-50"
                >
                  Use manual payments
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-8">
          <h2 className="text-lg font-bold text-slate-100 mb-1">Integrations</h2>
          <p className="text-sm text-slate-400 mb-6">
            Connect your Google Calendar so checklist due dates show up automatically as events -- more
            integrations (Drive, Dropbox, Dotloop) are on the way.
          </p>

          {googleCalendarMessage && (
            <div className="mb-4 text-sm text-slate-300">{googleCalendarMessage}</div>
          )}

          <div
            className={`rounded-lg border p-5 max-w-sm ${
              googleCalendarStatus?.connected ? 'border-blue-500 bg-slate-800/50' : 'border-slate-600'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="font-semibold text-slate-100 text-sm">Google Calendar</h3>
              {googleCalendarStatus?.connected && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-900/30 text-green-300 border border-green-700/50">
                  Connected
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mb-4">
              {googleCalendarStatus?.connected
                ? `Connected as ${googleCalendarStatus.email || 'your Google account'}.`
                : 'Syncs each checklist task\'s due date to your calendar automatically.'}
            </p>
            {googleCalendarStatus?.connected ? (
              <button
                type="button"
                onClick={handleDisconnectGoogleCalendar}
                disabled={isDisconnectingGoogleCalendar}
                className="text-sm px-4 py-2 border border-slate-600 hover:border-slate-500 text-slate-300 hover:text-slate-100 rounded-lg transition disabled:opacity-50"
              >
                {isDisconnectingGoogleCalendar ? 'Disconnecting...' : 'Disconnect'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleConnectGoogleCalendar}
                disabled={isStartingGoogleCalendar}
                className="text-sm px-4 py-2 bg-slate-600 hover:bg-slate-600 border border-slate-600 text-slate-100 font-semibold rounded-lg transition disabled:opacity-50"
              >
                {isStartingGoogleCalendar ? 'Opening...' : 'Connect Google Calendar'}
              </button>
            )}
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={isSaving}
            className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsContent />
    </Suspense>
  );
}
