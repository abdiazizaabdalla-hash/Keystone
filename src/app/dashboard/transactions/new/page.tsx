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
  steps: { name: string; dueDate?: DueDateSpec | null; required?: boolean }[];
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
  // The team/brokerage's default checklist template (set from
  // /dashboard/collaborate's settings panel, Brokerage-only to change but
  // read here for any team member) -- pre-selected below once both this
  // and the template list have loaded, instead of always defaulting to
  // Baseline. appliedTeamDefaultTemplate guards against reapplying it
  // after the TC has already picked something themselves.
  const [teamDefaultTemplateId, setTeamDefaultTemplateId] = useState<string | null>(null);
  const [appliedTeamDefaultTemplate, setAppliedTeamDefaultTemplate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI contract intake -- upload a purchase contract PDF and pre-fill the
  // form above instead of typing everything in by hand. aiAvailable comes
  // from a GET check (ANTHROPIC_API_KEY configured?) so the upload option
  // simply doesn't appear on an install that hasn't set it up yet, rather
  // than showing a button that always fails.
  const [aiAvailable, setAiAvailable] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractNotes, setExtractNotes] = useState<string | null>(null);
  const [extractedFileName, setExtractedFileName] = useState<string | null>(null);
  const [contractFile, setContractFile] = useState<File | null>(null);
  const [extractedParties, setExtractedParties] = useState<{
    buyerNames: string[];
    sellerNames: string[];
    lenderName: string;
    titleCompanyName: string;
    escrowOfficerName: string;
    escrowOfficerEmail: string;
    escrowOfficerPhone: string;
  } | null>(null);

  // The contract's own deadlines (earnest money, inspection, appraisal,
  // financing, title). Shown for review/edit after extraction and saved as the
  // new transaction's Critical dates.
  const [extractedDates, setExtractedDates] = useState<{ kind: string; label: string; dueDate: string }[]>([]);

  useEffect(() => {
    fetchAgents();
    fetchTemplates();
    checkAiAvailability();
    checkTeamOwner();
  }, []);

  // Non-fatal either way: a 403/404 (no team) just means there is no team
  // default template to pre-select.
  const checkTeamOwner = async () => {
    try {
      const res = await authFetch('/api/team');
      if (!res.ok) return;
      const data = await res.json();
      if (data.team?.defaultChecklistTemplateId) {
        setTeamDefaultTemplateId(data.team.defaultChecklistTemplateId);
      }
    } catch {
      // Ignore -- same as checkAiAvailability above.
    }
  };

  // Applies the team's default template exactly once, as soon as both
  // it and the template list are in hand -- never again after that, so
  // it can't clobber a template the TC picked themselves.
  useEffect(() => {
    if (appliedTeamDefaultTemplate || !teamDefaultTemplateId) return;
    if (templates.some((t) => t.id === teamDefaultTemplateId)) {
      setFormData((prev) => ({ ...prev, templateId: teamDefaultTemplateId }));
      setAppliedTeamDefaultTemplate(true);
    }
  }, [teamDefaultTemplateId, templates, appliedTeamDefaultTemplate]);

  // Whether AI contract intake is configured at all -- purely additive,
  // so any failure here just leaves the upload option hidden rather than
  // surfacing an error on a page load that otherwise has nothing wrong.
  const checkAiAvailability = async () => {
    try {
      const res = await authFetch('/api/transactions/extract-contract');
      if (!res.ok) return;
      const data = await res.json();
      setAiAvailable(Boolean(data.available));
    } catch {
      // Silently unavailable -- the manual form still works fine.
    }
  };

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

  // Best-effort match of an extracted agent name against the TC's existing
  // agent list, so the dropdown can be pre-selected when it's an obvious
  // match -- never auto-creates or guesses when it isn't a clear hit.
  const matchAgent = (name: string): string => {
    if (!name) return '';
    const needle = name.trim().toLowerCase();
    if (!needle) return '';
    const hit = agents.find((a) => {
      const hay = a.name.trim().toLowerCase();
      return hay === needle || hay.includes(needle) || needle.includes(hay);
    });
    return hit?.id || '';
  };

  const handleContractUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file after a retry
    if (!file) return;

    setExtracting(true);
    setExtractError(null);
    setExtractNotes(null);
    setExtractedParties(null);
    setExtractedDates([]);

    try {
      const body = new FormData();
      body.append('file', file);

      const res = await authFetch('/api/transactions/extract-contract', {
        method: 'POST',
        body,
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Could not read the contract');
      }

      const f = data.fields || {};
      setFormData((prev) => ({
        ...prev,
        propertyAddress: f.propertyAddress || prev.propertyAddress,
        purchasePrice: f.purchasePrice ? formatWithCommas(String(f.purchasePrice)) : prev.purchasePrice,
        acceptanceDate: f.acceptanceDate || prev.acceptanceDate,
        closingDate: f.closingDate || prev.closingDate,
        agentId: matchAgent(f.buyerAgentName) || matchAgent(f.listingAgentName) || prev.agentId,
      }));
      setContractFile(file);
      setExtractedFileName(file.name);
      setExtractedParties({
        buyerNames: Array.isArray(f.buyerNames) ? f.buyerNames.filter(Boolean) : [],
        sellerNames: Array.isArray(f.sellerNames) ? f.sellerNames.filter(Boolean) : [],
        lenderName: f.lenderName || '',
        titleCompanyName: f.titleCompanyName || '',
        escrowOfficerName: f.escrowOfficerName || '',
        escrowOfficerEmail: f.escrowOfficerEmail || '',
        escrowOfficerPhone: f.escrowOfficerPhone || '',
      });
      const dateRe = /^\d{4}-\d{2}-\d{2}$/;
      const candidateDates: { kind: string; label: string; dueDate: unknown }[] = [
        { kind: 'earnest_money', label: 'Earnest money due', dueDate: f.earnestMoneyDueDate },
        { kind: 'inspection', label: 'Inspection deadline', dueDate: f.inspectionDeadline },
        { kind: 'appraisal', label: 'Appraisal deadline', dueDate: f.appraisalDeadline },
        { kind: 'financing', label: 'Financing contingency', dueDate: f.financingContingencyDeadline },
        { kind: 'title_commitment', label: 'Title commitment due', dueDate: f.titleCommitmentDueDate },
      ];
      setExtractedDates(
        candidateDates
          .filter((d): d is { kind: string; label: string; dueDate: string } => typeof d.dueDate === 'string' && dateRe.test(d.dueDate))
      );
      if (f.notes) setExtractNotes(f.notes);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      const errorMsg = error instanceof Error ? error.message : 'Could not read the contract';
      setExtractError(errorMsg);
    } finally {
      setExtracting(false);
    }
  };

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

      const created = await res.json();

      if (contractFile && created?.id) {
        try {
          const docBody = new FormData();
          docBody.append('file', contractFile);
          docBody.append('transactionId', created.id);
          docBody.append('category', 'contract_disclosures');
          docBody.append('documentType', 'Purchase Contract');
          await authFetch('/api/documents', { method: 'POST', body: docBody });
        } catch {
          // The transaction itself was created fine -- don't block on
          // re-attaching the contract PDF; the TC can upload it from the
          // transaction page's Documents section if this quietly failed.
        }
      }

      // Turn whatever parties the contract named into Deal Contacts rows
      // on the new transaction -- buyer/seller/title-escrow info the form
      // itself has no field for. The linked Agent is deliberately NOT
      // duplicated in here (see api/transactions/[id]/contacts/route.ts),
      // only the parties that table doesn't already represent. Best
      // effort, same as the document upload above -- never blocks saving.
      if (extractedParties && created?.id) {
        const rows: { role: string; name: string; email?: string; phone?: string }[] = [];
        if (extractedParties.buyerNames.length) {
          rows.push({ role: 'Buyer', name: extractedParties.buyerNames.join(', ') });
        }
        if (extractedParties.sellerNames.length) {
          rows.push({ role: 'Seller', name: extractedParties.sellerNames.join(', ') });
        }
        if (extractedParties.lenderName) {
          rows.push({ role: 'Lender', name: extractedParties.lenderName });
        }
        if (extractedParties.titleCompanyName || extractedParties.escrowOfficerName) {
          rows.push({
            role: 'Title',
            name: extractedParties.escrowOfficerName || extractedParties.titleCompanyName,
            email: extractedParties.escrowOfficerEmail || undefined,
            phone: extractedParties.escrowOfficerPhone || undefined,
          });
        }
        try {
          await Promise.all(
            rows.map((row) =>
              authFetch(`/api/transactions/${created.id}/contacts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(row),
              })
            )
          );
        } catch {
          // Same reasoning as the document upload -- the transaction is
          // already saved, contacts can always be added by hand from the
          // transaction page if this quietly failed.
        }
      }

      // Save the reviewed contract deadlines as this deal's Critical dates.
      // Best effort, same as the document and contacts above.
      if (extractedDates.some((d) => d.dueDate) && created?.id) {
        try {
          await authFetch(`/api/transactions/${created.id}/key-dates`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dates: extractedDates.filter((d) => d.dueDate).map((d) => ({ kind: d.kind, label: d.label, dueDate: d.dueDate, source: 'contract' })),
            }),
          });
        } catch {
          // Dates can be added by hand from the transaction page.
        }
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
      <div className="min-h-screen px-4 py-6 md:px-6 md:py-12">
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
    <div className="min-h-screen px-4 py-6 md:px-6 md:py-12">
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
          <h1 className="text-3xl md:text-4xl font-display font-semibold text-slate-100 mb-3">Create New Deal</h1>
          <p className="text-slate-400">Enter the details to start tracking this transaction. Your checklist will be auto-generated.</p>
        </div>

        {/* AI Contract Intake -- optional, only shown once ANTHROPIC_API_KEY
            is configured server-side (see checkAiAvailability above). */}
        {aiAvailable && (
          <div className="mb-8 bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-slate-100 mb-1">Upload a Contract (optional)</h3>
                <p className="text-sm text-slate-400 mb-3">
                  Upload the purchase contract PDF and Relay will read the address, price, and key dates for you. Review everything below before saving -- this is a starting point, not a substitute for checking the actual contract.
                </p>
                <label className="inline-flex items-center gap-2 px-4 py-2 bg-slate-600 hover:bg-slate-500 border border-slate-500 rounded-lg text-sm font-medium text-slate-100 cursor-pointer transition">
                  {extracting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-slate-400 border-t-slate-100 rounded-full animate-spin" />
                      Reading contract...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                      Choose PDF
                    </>
                  )}
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={handleContractUpload}
                    disabled={extracting}
                    className="hidden"
                  />
                </label>
                {extractedFileName && !extractError && (
                  <p className="text-xs text-emerald-400 mt-2">
                    Extracted from {extractedFileName} -- fields below were pre-filled, double-check them.
                  </p>
                )}
                {extractedParties &&
                  (extractedParties.buyerNames.length > 0 ||
                    extractedParties.sellerNames.length > 0 ||
                    extractedParties.titleCompanyName ||
                    extractedParties.escrowOfficerName ||
                    extractedParties.lenderName) && (
                    <p className="text-xs text-slate-400 mt-2">
                      Also found -- will be added to this deal&apos;s Contacts once saved:{' '}
                      {[
                        extractedParties.buyerNames.length ? `Buyer: ${extractedParties.buyerNames.join(', ')}` : null,
                        extractedParties.sellerNames.length ? `Seller: ${extractedParties.sellerNames.join(', ')}` : null,
                        extractedParties.lenderName ? `Lender: ${extractedParties.lenderName}` : null,
                        extractedParties.titleCompanyName || extractedParties.escrowOfficerName
                          ? `Title: ${extractedParties.escrowOfficerName || extractedParties.titleCompanyName}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                {extractedDates.length > 0 && (
                  <div className="mt-3 border border-slate-600 rounded-lg p-3 bg-slate-800/40">
                    <p className="text-xs font-semibold text-slate-200 mb-2">
                      Critical dates found in the contract -- check each one against the contract, then they&apos;ll be saved with this deal:
                    </p>
                    <ul className="space-y-2">
                      {extractedDates.map((d, i) => (
                        <li key={d.kind} className="flex items-center gap-2">
                          <span className="text-xs text-slate-300 flex-1 min-w-0 truncate">{d.label}</span>
                          <input
                            type="date"
                            value={d.dueDate}
                            onChange={(e) =>
                              setExtractedDates((prev) =>
                                prev.map((x, idx) => (idx === i ? { ...x, dueDate: e.target.value } : x))
                              )
                            }
                            className="px-2 py-1 bg-slate-700 border border-slate-500 rounded text-xs text-slate-100"
                          />
                          <button
                            type="button"
                            onClick={() => setExtractedDates((prev) => prev.filter((_, idx) => idx !== i))}
                            className="text-xs text-slate-400 hover:text-red-300 transition"
                            aria-label={`Remove ${d.label}`}
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {extractNotes && (
                  <p className="text-xs text-amber-400 mt-2">Heads up: {extractNotes}</p>
                )}
                {extractError && (
                  <p className="text-xs text-red-400 mt-2">{extractError}</p>
                )}
              </div>
            </div>
          </div>
        )}

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
                {templates.map((template) => {
                  const requiredCount = template.steps.filter((s) => s.required).length;
                  return (
                    <option key={template.id} value={template.id}>
                      {template.name} ({template.steps.length} steps
                      {requiredCount > 0 ? `, ${requiredCount} required` : ''})
                      {template.id === teamDefaultTemplateId ? ' — team default' : ''}
                    </option>
                  );
                })}
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
