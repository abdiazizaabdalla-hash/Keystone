'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import { DueDateSpec } from '@/lib/dueDates';

interface Agent {
  id: string;
  name: string;
  brokerage: string;
  commission_percent: number;
}

interface ChecklistTemplate {
  id: string;
  name: string;
  steps: { name: string; dueDate?: DueDateSpec | null }[];
  isBaseline: boolean;
}

const BASELINE_TEMPLATE_ID = 'baseline';

export default function NewTransactionPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [canUseCustomTemplates, setCanUseCustomTemplates] = useState(false);
  const [formData, setFormData] = useState({
    agentId: '',
    fileNumber: '',
    propertyAddress: '',
    purchasePrice: '',
    acceptanceDate: '',
    closingDate: '',
    templateId: BASELINE_TEMPLATE_ID,
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAgents();
    fetchTemplates();
  }, []);

  const fetchAgents = async () => {
    try {
      const res = await authFetch('/api/agents');
      if (!res.ok) throw new Error('Failed to fetch agents');
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('Invalid agents data');
      setAgents(data);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      const errorMsg = error instanceof Error ? error.message : 'Failed to load agents';
      setError(errorMsg);
      console.error('Error fetching agents:', errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // Checklist templates are a nice-to-have selector, not a blocking
  // dependency for the form -- if this fails for any reason, the form
  // still works and simply defaults to the baseline checklist.
  const fetchTemplates = async () => {
    try {
      const res = await authFetch('/api/checklist-templates');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.templates)) setTemplates(data.templates);
      setCanUseCustomTemplates(Boolean(data.customChecklists));
    } catch (error) {
      if (error instanceof AuthRequiredError) return;
      console.error('Error fetching checklist templates:', error);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  // Formats a raw number string with thousands separators as the user
  // types, e.g. "350000" -> "350,000", so large purchase prices are easy to
  // read at a glance. Keeps at most one decimal point and two decimal digits.
  const formatWithCommas = (raw: string) => {
    let cleaned = raw.replace(/[^\d.]/g, '');
    const firstDot = cleaned.indexOf('.');
    if (firstDot !== -1) {
      cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
    }
    const [intPartRaw, decPart] = cleaned.split('.');
    const intPart = (intPartRaw || '').replace(/^0+(?=\d)/, '');
    const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return decPart !== undefined ? `${withCommas}.${decPart.slice(0, 2)}` : withCommas;
  };

  const handlePurchasePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, purchasePrice: formatWithCommas(e.target.value) }));
  };

  const blurOnWheel = (e: React.WheelEvent<HTMLInputElement>) => e.currentTarget.blur();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (!formData.agentId) throw new Error('Please select an agent');
      if (!formData.fileNumber) throw new Error('Please enter a file number');
      if (!formData.propertyAddress) throw new Error('Please enter a property address');
      if (!formData.purchasePrice) throw new Error('Please enter a purchase price');

      const res = await authFetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: formData.agentId,
          fileNumber: formData.fileNumber,
          propertyAddress: formData.propertyAddress,
          purchasePrice: parseFloat(formData.purchasePrice.replace(/,/g, '')),
          acceptanceDate: formData.acceptanceDate || null,
          closingDate: formData.closingDate || null,
          templateId: formData.templateId,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to create transaction');
      }

      router.push('/dashboard/transactions');
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      const errorMsg = error instanceof Error ? error.message : 'Failed to create transaction';
      setError(errorMsg);
      console.error('Error:', errorMsg);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen px-6 py-12">
        <div className="max-w-2xl mx-auto">
          <Link href="/dashboard/transactions" className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 mb-8 transition">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
            </svg>
            Back to Transactions
          </Link>
          <div className="flex items-center justify-center py-24">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full border-4 border-slate-600 border-t-blue-400 animate-spin mx-auto mb-4" />
              <p className="text-slate-400">Loading agents...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-6 py-12">
      <div className="max-w-2xl mx-auto">
        {/* Back Button */}
        <Link href="/dashboard/transactions" className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 mb-8 transition">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
          </svg>
          Back to Transactions
        </Link>

        {/* Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-display font-semibold text-slate-100 mb-3">Create New Deal</h1>
          <p className="text-slate-400">Enter the details to start tracking this transaction. Your checklist will be auto-generated.</p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-8 bg-red-900/30 border border-red-700 rounded-lg p-4">
            <div className="flex gap-3">
              <div className="flex-shrink-0">
                <svg className="w-5 h-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-8 space-y-8">
          {/* Agent Selection */}
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-3">
              <span className="flex items-center gap-2">
                <svg className="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" />
                </svg>
                Select Agent
              </span>
            </label>
            <select
              name="agentId"
              value={formData.agentId}
              onChange={handleChange}
              required
              className="w-full bg-slate-600 border border-slate-600 hover:border-slate-500 focus:border-blue-500 rounded-lg px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition"
            >
              <option value="">-- Select an agent --</option>
              {agents.length > 0 ? (
                agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} • {agent.brokerage}
                    {agent.commission_percent ? ` (${agent.commission_percent}%)` : ''}
                  </option>
                ))
              ) : (
                <option disabled>No agents available</option>
              )}
            </select>
            <p className="text-xs text-slate-400 mt-2">Choose which agent this transaction belongs to</p>
          </div>

          {/* File Number */}
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-3">
              <span className="flex items-center gap-2">
                <svg className="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                </svg>
                File Number
              </span>
            </label>
            <input
              type="text"
              name="fileNumber"
              value={formData.fileNumber}
              onChange={handleChange}
              placeholder="e.g., FL-2024-001234"
              required
              className="w-full bg-slate-600 border border-slate-600 hover:border-slate-500 focus:border-blue-500 rounded-lg px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition"
            />
            <p className="text-xs text-slate-400 mt-2">Unique identifier for this transaction</p>
          </div>

          {/* Property Address */}
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-3">
              <span className="flex items-center gap-2">
                <svg className="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
                </svg>
                Property Address
              </span>
            </label>
            <input
              type="text"
              name="propertyAddress"
              value={formData.propertyAddress}
              onChange={handleChange}
              placeholder="e.g., 123 Main Street, Springfield, FL 32401"
              required
              className="w-full bg-slate-600 border border-slate-600 hover:border-slate-500 focus:border-blue-500 rounded-lg px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition"
            />
            <p className="text-xs text-slate-400 mt-2">Full address of the property being transacted</p>
          </div>

          {/* Purchase Price */}
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-3">
              <span className="flex items-center gap-2">
                <svg className="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M8.16 5.314l4.897-1.596A.5.5 0 0114 4.684V7h4a2 2 0 012 2v5a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4V4.684a.5.5 0 01.693-.373zM15 9a1 1 0 100 2 1 1 0 000-2z" />
                </svg>
                Purchase Price
              </span>
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">$</span>
              <input
                type="text"
                inputMode="decimal"
                name="purchasePrice"
                value={formData.purchasePrice}
                onChange={handlePurchasePriceChange}
                onWheel={blurOnWheel}
                placeholder="e.g., 350,000"
                required
                className="w-full bg-slate-600 border border-slate-600 hover:border-slate-500 focus:border-blue-500 rounded-lg pl-8 pr-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition"
              />
            </div>
            <p className="text-xs text-slate-400 mt-2">Total purchase price for this property</p>
          </div>

          {/* Key Dates -- optional, but this is what drives automatic
              checklist due dates (see lib/dueDates.ts). Acceptance date
              anchors most tasks; closing date is only used for the couple
              that count backward from it (Funding, Closing itself) and
              falls back to an offset from acceptance if left blank. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-semibold text-slate-200 mb-3">
                <span className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
                  </svg>
                  Acceptance Date <span className="normal-case text-slate-500">(optional)</span>
                </span>
              </label>
              <input
                type="date"
                name="acceptanceDate"
                value={formData.acceptanceDate}
                onChange={handleChange}
                className="w-full bg-slate-600 border border-slate-600 hover:border-slate-500 focus:border-blue-500 rounded-lg px-4 py-3 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition"
              />
              <p className="text-xs text-slate-400 mt-2">Contract / mutual acceptance date -- used to calculate checklist due dates per your due-date workflow (Settings)</p>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-200 mb-3">
                <span className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
                  </svg>
                  Target Closing Date <span className="normal-case text-slate-500">(optional)</span>
                </span>
              </label>
              <input
                type="date"
                name="closingDate"
                value={formData.closingDate}
                onChange={handleChange}
                className="w-full bg-slate-600 border border-slate-600 hover:border-slate-500 focus:border-blue-500 rounded-lg px-4 py-3 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition"
              />
              <p className="text-xs text-slate-400 mt-2">Can be added or changed later from the transaction page</p>
            </div>
          </div>

          {/* Checklist Template */}
          {canUseCustomTemplates && (
            <div>
              <label className="block text-sm font-semibold text-slate-200 mb-3">
                <span className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 8a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zm10 1a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 01-1 1h-2a1 1 0 01-1-1v-2z" clipRule="evenodd" />
                  </svg>
                  Checklist Template
                </span>
              </label>
              <select
                name="templateId"
                value={formData.templateId}
                onChange={handleChange}
                className="w-full bg-slate-600 border border-slate-600 hover:border-slate-500 focus:border-blue-500 rounded-lg px-4 py-3 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition"
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} ({template.steps.length} steps)
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-400 mt-2">
                Choose which checklist this deal starts with.{' '}
                <Link href="/dashboard/settings" className="text-blue-400 hover:text-blue-300 transition">
                  Manage templates in Settings
                </Link>
              </p>
            </div>
          )}

          {/* Form Actions */}
          <div className="flex gap-4 pt-6 border-t border-slate-600">
            <button
              type="submit"
              disabled={submitting || agents.length === 0}
              className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 disabled:from-slate-600 disabled:to-slate-600 text-white font-semibold rounded-lg transition shadow-lg hover:shadow-blue-500/50 disabled:shadow-none"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-slate-600 border-t-slate-900 rounded-full animate-spin" />
                  Creating...
                </span>
              ) : (
                'Create Transaction'
              )}
            </button>
            <button
              type="button"
              onClick={() => router.back()}
              className="px-6 py-3 border border-slate-600 hover:border-slate-500 text-slate-300 hover:text-slate-100 font-semibold rounded-lg transition hover:bg-slate-700/50"
            >
              Cancel
            </button>
          </div>
        </form>

        {/* Info Box */}
        <div className="mt-8 bg-blue-900/20 border border-blue-800 rounded-lg p-6">
          <div className="flex gap-3">
            <div className="flex-shrink-0">
              <svg className="w-5 h-5 text-blue-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 5v8a2 2 0 01-2 2h-5l-5 4v-4H4a2 2 0 01-2-2V5a2 2 0 012-2h12a2 2 0 012 2z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-blue-300 mb-1">Auto-Generated Checklist</h3>
              <p className="text-blue-200 text-sm">When you create this transaction, Relay generates a complete checklist and calculates each step&apos;s due date from your due-date workflow (set up in Settings). You can fine-tune any individual step&apos;s due date afterward from the transaction page.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
