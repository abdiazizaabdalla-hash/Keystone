'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch, AuthRequiredError } from '@/lib/authClient';

export default function SettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [fullName, setFullName] = useState('');
  const [defaultFlatFee, setDefaultFlatFee] = useState('400');
  const [defaultPercentFee, setDefaultPercentFee] = useState('0');
  const [invoiceDueDays, setInvoiceDueDays] = useState('30');
  const [zelleEnabled, setZelleEnabled] = useState(false);
  const [zelleContact, setZelleContact] = useState('');
  const [zelleDisplayName, setZelleDisplayName] = useState('');
  const [helcimStatus, setHelcimStatus] = useState<{ connected: boolean; status: string | null; dbaSubdomain: string } | null>(null);
  const [helcimDba, setHelcimDba] = useState('');
  const [isConnectingHelcim, setIsConnectingHelcim] = useState(false);
  const [isSavingHelcimDba, setIsSavingHelcimDba] = useState(false);
  const [helcimMessage, setHelcimMessage] = useState('');

  // Checklist templates (Pro/Team only) -- kept separate from the main
  // profile/agent-defaults form above since each template edit is its own
  // save action, not part of the "Save Settings" submit.
  const [templates, setTemplates] = useState<
    { id: string; name: string; steps: string[]; isBaseline: boolean }[]
  >([]);
  const [canUseCustomTemplates, setCanUseCustomTemplates] = useState(false);
  const [templateMessage, setTemplateMessage] = useState('');
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null); // 'new' or a template id
  const [templateNameDraft, setTemplateNameDraft] = useState('');
  const [templateStepsDraft, setTemplateStepsDraft] = useState<string[]>(['']);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings();
    fetchHelcimStatus();
    fetchTemplates();
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
    setTemplateStepsDraft(['']);
  };

  const startEditTemplate = (template: { id: string; name: string; steps: string[] }) => {
    setTemplateMessage('');
    setEditingTemplateId(template.id);
    setTemplateNameDraft(template.name);
    setTemplateStepsDraft(template.steps.length > 0 ? [...template.steps] : ['']);
  };

  const cancelEditTemplate = () => {
    setEditingTemplateId(null);
    setTemplateNameDraft('');
    setTemplateStepsDraft(['']);
  };

  const updateStepDraft = (index: number, value: string) => {
    setTemplateStepsDraft((prev) => prev.map((s, i) => (i === index ? value : s)));
  };

  const addStepDraft = () => {
    setTemplateStepsDraft((prev) => [...prev, '']);
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
    const steps = templateStepsDraft.map((s) => s.trim()).filter((s) => s.length > 0);

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
      setTemplateStepsDraft(['']);
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

  const fetchHelcimStatus = async () => {
    try {
      const response = await authFetch('/api/helcim/account');
      if (!response.ok) return;
      const data = await response.json();
      setHelcimStatus(data);
      setHelcimDba(data.dbaSubdomain || '');
    } catch {
      // Non-fatal — Helcim section just shows as "not connected".
    }
  };

  const handleConnectHelcim = async () => {
    setIsConnectingHelcim(true);
    setHelcimMessage('');
    try {
      const response = await authFetch('/api/helcim/connect-url');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to start Helcim connection');
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setHelcimMessage(error instanceof Error ? error.message : 'Error connecting to Helcim');
    } finally {
      setIsConnectingHelcim(false);
    }
  };

  const handleSaveHelcimDba = async () => {
    setIsSavingHelcimDba(true);
    setHelcimMessage('');
    try {
      const response = await authFetch('/api/helcim/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dbaSubdomain: helcimDba }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save Helcim subdomain');
      setHelcimMessage('Saved.');
      fetchHelcimStatus();
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setHelcimMessage(error instanceof Error ? error.message : 'Error saving Helcim subdomain');
    } finally {
      setIsSavingHelcimDba(false);
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
      setZelleEnabled(!!data.zelleEnabled);
      setZelleContact(data.zelleContact ?? '');
      setZelleDisplayName(data.zelleDisplayName ?? '');
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

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setMessage('');

    if (zelleEnabled && !zelleContact.trim()) {
      setMessage('Add the email or phone number tied to your Zelle account before enabling it.');
      setIsSaving(false);
      return;
    }

    try {
      const response = await authFetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          defaultFlatFee: parseFloat(defaultFlatFee) || 0,
          defaultPercentFee: parseFloat(defaultPercentFee) || 0,
          invoiceDueDays: parseInt(invoiceDueDays, 10) || 30,
          zelleEnabled,
          zelleContact,
          zelleDisplayName,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save settings');

      setFullName(data.fullName ?? '');
      setDefaultFlatFee(String(data.defaultFlatFee));
      setDefaultPercentFee(String(data.defaultPercentFee));
      setInvoiceDueDays(String(data.invoiceDueDays));
      setZelleEnabled(!!data.zelleEnabled);
      setZelleContact(data.zelleContact ?? '');
      setZelleDisplayName(data.zelleDisplayName ?? '');
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
            <div className="w-12 h-12 rounded-full border-4 border-ink-700 border-t-amber-400 animate-spin mx-auto mb-4" />
            <p className="text-ink-400">Loading settings...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-3xl font-display font-semibold text-ink-100 mb-1">Settings</h1>
        <p className="text-ink-400">Preferences used across your account</p>
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
        <div className="bg-gradient-to-br from-ink-800 to-ink-900 border border-ink-700 rounded-lg p-8">
          <h2 className="text-lg font-bold text-ink-100 mb-1">Your Profile</h2>
          <p className="text-sm text-ink-400 mb-6">
            Shown to teammates on your Collaborate roster instead of your bare email address.
          </p>
          <div>
            <label className="text-sm text-ink-400 block mb-2">Full Name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Smith"
              className="w-full bg-ink-700 border border-ink-600 rounded-lg px-4 py-2 text-ink-100 placeholder-ink-500 focus:border-amber-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="bg-gradient-to-br from-ink-800 to-ink-900 border border-ink-700 rounded-lg p-8">
          <h2 className="text-lg font-bold text-ink-100 mb-1">Agent Defaults</h2>
          <p className="text-sm text-ink-400 mb-6">
            Pre-fills the fee fields whenever you add a new agent. You can still change these per agent.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <label className="text-sm text-ink-400 block mb-2">Default Flat Fee per Deal ($)</label>
              <input
                type="number"
                value={defaultFlatFee}
                onChange={handleNumberChange(setDefaultFlatFee)}
                onWheel={blurOnWheel}
                placeholder="400"
                step="0.01"
                min="0"
                className="w-full bg-ink-700 border border-ink-600 rounded-lg px-4 py-2 text-ink-100 placeholder-ink-500 focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-sm text-ink-400 block mb-2">Default Percentage Fee (%)</label>
              <input
                type="number"
                value={defaultPercentFee}
                onChange={handleNumberChange(setDefaultPercentFee)}
                onWheel={blurOnWheel}
                placeholder="0"
                step="0.01"
                min="0"
                max="100"
                className="w-full bg-ink-700 border border-ink-600 rounded-lg px-4 py-2 text-ink-100 placeholder-ink-500 focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-ink-800 to-ink-900 border border-ink-700 rounded-lg p-8">
          <h2 className="text-lg font-bold text-ink-100 mb-1">Invoicing</h2>
          <p className="text-sm text-ink-400 mb-6">
            How many days an agent has to pay after an invoice is generated. You can still change the due date on
            any individual invoice afterward.
          </p>
          <div className="max-w-xs">
            <label className="text-sm text-ink-400 block mb-2">Due in (days)</label>
            <input
              type="number"
              value={invoiceDueDays}
              onChange={handleNumberChange(setInvoiceDueDays)}
              onWheel={blurOnWheel}
              placeholder="30"
              step="1"
              min="1"
              max="365"
              className="w-full bg-ink-700 border border-ink-600 rounded-lg px-4 py-2 text-ink-100 placeholder-ink-500 focus:border-amber-500 focus:outline-none"
            />
          </div>
        </div>

        <div id="checklist-templates" className="bg-gradient-to-br from-ink-800 to-ink-900 border border-ink-700 rounded-lg p-8 scroll-mt-6">
          <div className="flex items-start justify-between gap-4 mb-1">
            <h2 className="text-lg font-bold text-ink-100">Checklist Templates</h2>
            {canUseCustomTemplates && (
              <span className="inline-block px-2.5 py-1 bg-amber-500/20 border border-amber-500/50 text-amber-300 text-xs font-semibold rounded-full shrink-0">
                Pro / Team
              </span>
            )}
          </div>
          <p className="text-sm text-ink-400 mb-6">
            Every deal starts from the Baseline checklist below for free. On Pro and Team, build your own
            checklist templates &mdash; add, remove, and reorder steps like widgets &mdash; and pick one per deal
            when you create it. Editing or deleting a template never changes the checklist on deals that already
            used it.
          </p>

          {templateMessage && (
            <div className="mb-4 text-sm text-ink-300">{templateMessage}</div>
          )}

          <div className="space-y-3 mb-6">
            <div className="flex items-center justify-between gap-4 bg-ink-900/50 border border-ink-700 rounded-lg px-4 py-3">
              <div>
                <p className="text-ink-100 font-medium text-sm">Baseline (default)</p>
                <p className="text-ink-500 text-xs">6 steps &middot; always available</p>
              </div>
            </div>

            {templates
              .filter((t) => !t.isBaseline)
              .map((template) => (
                <div
                  key={template.id}
                  className="flex items-center justify-between gap-4 bg-ink-900/50 border border-ink-700 rounded-lg px-4 py-3"
                >
                  <div>
                    <p className="text-ink-100 font-medium text-sm">{template.name}</p>
                    <p className="text-ink-500 text-xs">{template.steps.length} steps</p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <button
                      type="button"
                      onClick={() => startEditTemplate(template)}
                      className="text-amber-400 hover:text-amber-300 text-sm font-medium transition"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteTemplate(template.id)}
                      disabled={deletingTemplateId === template.id}
                      className="text-ink-500 hover:text-red-400 text-sm font-medium transition disabled:opacity-50"
                    >
                      {deletingTemplateId === template.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>
              ))}
          </div>

          {!canUseCustomTemplates ? (
            <div className="bg-amber-900/10 border border-amber-800/40 rounded-lg p-4 text-sm text-amber-200/90">
              Building your own checklist templates is available on the Pro and Team plans.{' '}
              <Link href="/dashboard/account" className="text-amber-400 hover:text-amber-300 font-medium transition">
                Upgrade
              </Link>{' '}
              to create one.
            </div>
          ) : editingTemplateId ? (
            <div className="bg-ink-900/50 border border-ink-700 rounded-lg p-6">
              <div className="mb-4">
                <label className="text-sm text-ink-400 block mb-2">Template Name</label>
                <input
                  type="text"
                  value={templateNameDraft}
                  onChange={(e) => setTemplateNameDraft(e.target.value)}
                  placeholder="e.g., Cash Deals"
                  className="w-full bg-ink-700 border border-ink-600 rounded-lg px-4 py-2 text-ink-100 placeholder-ink-500 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <label className="text-sm text-ink-400 block mb-2">Steps</label>
              <div className="space-y-2 mb-4">
                {templateStepsDraft.map((step, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <span className="text-ink-500 text-xs w-5 text-right shrink-0">{index + 1}.</span>
                    <input
                      type="text"
                      value={step}
                      onChange={(e) => updateStepDraft(index, e.target.value)}
                      placeholder={`Step ${index + 1}`}
                      className="flex-1 bg-ink-700 border border-ink-600 rounded-lg px-3 py-2 text-ink-100 placeholder-ink-500 focus:border-amber-500 focus:outline-none text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => moveStepDraft(index, -1)}
                      disabled={index === 0}
                      className="text-ink-400 hover:text-ink-200 disabled:opacity-30 disabled:hover:text-ink-400 transition p-1"
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveStepDraft(index, 1)}
                      disabled={index === templateStepsDraft.length - 1}
                      className="text-ink-400 hover:text-ink-200 disabled:opacity-30 disabled:hover:text-ink-400 transition p-1"
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeStepDraft(index)}
                      disabled={templateStepsDraft.length <= 1}
                      className="text-ink-500 hover:text-red-400 disabled:opacity-30 disabled:hover:text-ink-500 transition p-1"
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
                className="text-amber-400 hover:text-amber-300 text-sm font-medium transition mb-6"
              >
                + Add Step
              </button>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={saveTemplate}
                  disabled={isSavingTemplate}
                  className="px-5 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-ink-950 font-semibold rounded-lg transition disabled:opacity-50 text-sm"
                >
                  {isSavingTemplate ? 'Saving...' : 'Save Template'}
                </button>
                <button
                  type="button"
                  onClick={cancelEditTemplate}
                  disabled={isSavingTemplate}
                  className="px-5 py-2 border border-ink-600 hover:border-ink-500 text-ink-300 hover:text-ink-100 rounded-lg transition disabled:opacity-50 text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={startNewTemplate}
              className="px-5 py-2.5 bg-ink-700 hover:bg-ink-600 border border-ink-600 text-ink-100 font-semibold rounded-lg transition text-sm"
            >
              + New Template
            </button>
          )}
        </div>

                <div className="bg-gradient-to-br from-ink-800 to-ink-900 border border-ink-700 rounded-lg p-8">
          <div className="flex items-start justify-between gap-4 mb-1">
            <h2 className="text-lg font-bold text-ink-100">Payment Methods</h2>
            <label className="flex items-center gap-2 text-sm text-ink-300 shrink-0 cursor-pointer">
              <input
                type="checkbox"
                checked={zelleEnabled}
                onChange={(e) => setZelleEnabled(e.target.checked)}
                className="w-4 h-4 rounded border-ink-600 bg-ink-700 text-amber-500 focus:ring-amber-500"
              />
              Include Zelle on invoices
            </label>
          </div>
          <p className="text-sm text-ink-400 mb-6">
            When enabled, every unpaid invoice you send includes a &quot;Pay with Zelle&quot; block with your
            details and a scannable QR code. This is informational only — Relay doesn&apos;t process the
            payment, agents pay you directly through their own bank&apos;s Zelle. This is your account-wide
            default — you can give any individual agent their own Zelle details (or turn payment info off for
            them) from that agent&apos;s Edit page.
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <label className="text-sm text-ink-400 block mb-2">Zelle Email or Phone</label>
              <input
                type="text"
                value={zelleContact}
                onChange={(e) => setZelleContact(e.target.value)}
                placeholder="you@example.com or (555) 555-1234"
                className="w-full bg-ink-700 border border-ink-600 rounded-lg px-4 py-2 text-ink-100 placeholder-ink-500 focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-sm text-ink-400 block mb-2">Name shown on QR (optional)</label>
              <input
                type="text"
                value={zelleDisplayName}
                onChange={(e) => setZelleDisplayName(e.target.value)}
                placeholder={fullName || 'Relay TC'}
                className="w-full bg-ink-700 border border-ink-600 rounded-lg px-4 py-2 text-ink-100 placeholder-ink-500 focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-ink-800 to-ink-900 border border-ink-700 rounded-lg p-8">
          <h2 className="text-lg font-bold text-ink-100 mb-1">Helcim (online payments)</h2>
          <p className="text-sm text-ink-400 mb-6">
            Connect a Helcim account to add a real &quot;Pay Online&quot; link to your invoices &mdash; agents pay by
            card without creating an account, and Relay never touches the funds (they land directly in your own
            Helcim account). This is a newer integration and still being finished.
          </p>

          {helcimMessage && (
            <div className="mb-4 text-sm text-ink-300">{helcimMessage}</div>
          )}

          {!helcimStatus?.connected ? (
            <button
              type="button"
              onClick={handleConnectHelcim}
              disabled={isConnectingHelcim}
              className="px-5 py-2.5 bg-ink-700 hover:bg-ink-600 border border-ink-600 text-ink-100 font-semibold rounded-lg transition disabled:opacity-50"
            >
              {isConnectingHelcim ? 'Opening...' : 'Connect your Helcim account'}
            </button>
          ) : (
            <div className="space-y-4">
              <div>
                <span
                  className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${
                    helcimStatus.status === 'approved'
                      ? 'bg-green-900/30 text-green-300 border border-green-700/50'
                      : helcimStatus.status === 'declined'
                      ? 'bg-red-900/30 text-red-300 border border-red-700/50'
                      : 'bg-amber-900/30 text-amber-300 border border-amber-700/50'
                  }`}
                >
                  {helcimStatus.status === 'approved'
                    ? 'Connected & approved'
                    : helcimStatus.status === 'declined'
                    ? 'Application declined'
                    : 'Application pending review'}
                </span>
              </div>

              {helcimStatus.status === 'approved' && (
                <div className="max-w-sm">
                  <label className="text-sm text-ink-400 block mb-2">
                    Your Helcim subdomain
                    <span className="text-ink-500 font-normal">
                      {' '}
                      (the part before .myhelcim.com in your Helcim hub&apos;s address)
                    </span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={helcimDba}
                      onChange={(e) => setHelcimDba(e.target.value)}
                      placeholder="your-business-name"
                      className="flex-1 bg-ink-700 border border-ink-600 rounded-lg px-4 py-2 text-ink-100 placeholder-ink-500 focus:border-amber-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleSaveHelcimDba}
                      disabled={isSavingHelcimDba}
                      className="px-4 py-2 bg-ink-700 hover:bg-ink-600 border border-ink-600 text-ink-100 rounded-lg transition disabled:opacity-50"
                    >
                      {isSavingHelcimDba ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                  <p className="text-xs text-ink-500 mt-2">
                    Needed to build your invoices&apos; pay links. Required before &quot;Pay Online&quot; will work on
                    any invoice.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={isSaving}
            className="px-6 py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-ink-950 font-semibold rounded-lg transition disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  );
}
