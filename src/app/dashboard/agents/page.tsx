'use client';

import MoneyInput from '@/components/MoneyInput';
import PhoneInput from '@/components/PhoneInput';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';
import { formatPhoneNumber } from '@/lib/formatPhone';

interface Agent {
  id: string;
  name: string;
  brokerage: string;
  email: string;
  phone: string;
  flat_fee: number;
  commission_percent: number;
  /** 'quickbooks' when the agent was created by a QuickBooks import. */
  source?: string | null;
}

interface FormData {
  id?: string;
  name: string;
  brokerage: string;
  email: string;
  phone: string;
  flatFee: string;
  percentFee: string;
}

interface DirectoryAgent {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

export default function AgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [defaultFees, setDefaultFees] = useState({ flatFee: '400', percentFee: '0' });
  // The brokerage's own agent directory (see /api/team/agents) -- lets a
  // TC on a Team/Brokerage plan link a new contact to an existing real
  // person instead of re-typing their info from scratch, so the
  // directory's "how many TCs work with this agent" rollup actually
  // connects. Empty/hidden for a solo TC with no team.
  const [directory, setDirectory] = useState<DirectoryAgent[]>([]);
  const [selectedDirectoryId, setSelectedDirectoryId] = useState('');
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<'all' | 'quickbooks'>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Name, brokerage, email and phone (digits only, so "555 1234" finds (555) 123-4567 style numbers).
  const fromQb = (a: Agent) => a.source === 'quickbooks';
  const qbCount = useMemo(() => agents.filter(fromQb).length, [agents]);
  const visibleAgents = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = source === 'quickbooks' ? agents.filter(fromQb) : agents;
    if (!q) return pool;
    const digits = q.replace(/\D/g, '');
    return pool.filter((a) => {
      const text = `${a.name} ${a.brokerage || ''} ${a.email || ''} ${fromQb(a) ? 'quickbooks' : ''}`.toLowerCase();
      if (text.includes(q)) return true;
      return digits.length >= 3 && (a.phone || '').replace(/\D/g, '').includes(digits);
    });
  }, [agents, query, source]);

  const [formData, setFormData] = useState<FormData>({
    name: '',
    brokerage: '',
    email: '',
    phone: '',
    flatFee: '400',
    percentFee: '0',
  });

  useEffect(() => {
    fetchAgents();
    fetchDefaultFees();
    fetchDirectory();
  }, []);

  // Arriving from a transaction ("View agent profile"): open that agent's row and scroll to it.
  useEffect(() => {
    if (loading || agents.length === 0) return;
    const wanted = new URLSearchParams(window.location.search).get('agent');
    if (!wanted || !agents.some((a) => a.id === wanted)) return;
    const timer = setTimeout(() => {
      setQuery('');
      setSource('all');
      setExpanded((prev) => (prev.has(wanted) ? prev : new Set(prev).add(wanted)));
      setTimeout(() => document.getElementById(`agent-row-${wanted}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
    }, 0);
    return () => clearTimeout(timer);
  }, [loading, agents]);

  // Non-fatal -- a 403 (no team) just leaves the picker hidden.
  const fetchDirectory = async () => {
    try {
      const response = await authFetch('/api/team/agents');
      if (!response.ok) return;
      const data = await response.json();
      setDirectory(Array.isArray(data) ? data : []);
    } catch {
      // Ignore.
    }
  };

  const handlePickDirectoryAgent = (id: string) => {
    setSelectedDirectoryId(id);
    if (!id) return;
    const entry = directory.find((d) => d.id === id);
    if (!entry) return;
    setFormData((prev) => ({
      ...prev,
      name: entry.name,
      email: entry.email || prev.email,
      phone: entry.phone || prev.phone,
    }));
  };

  const fetchDefaultFees = async () => {
    try {
      const response = await authFetch('/api/auth/me');
      if (!response.ok) return;
      const data = await response.json();
      const flatFee = String(data.defaultFlatFee ?? 400);
      const percentFee = String(data.defaultPercentFee ?? 0);
      setDefaultFees({ flatFee, percentFee });
      // Only overwrite the still-untouched "Add Agent" defaults, never a form in progress.
      setFormData((prev) =>
        prev.id || prev.name ? prev : { ...prev, flatFee, percentFee }
      );
    } catch {
      // Non-critical — keep the built-in defaults ($400 flat, 0%) if this fails.
    }
  };

  const fetchAgents = async () => {
    try {
      const response = await authFetch('/api/agents');
      if (response.ok) {
        const data = await response.json();
        setAgents(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      console.error('Error fetching agents:', error);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      brokerage: '',
      email: '',
      phone: '',
      flatFee: defaultFees.flatFee,
      percentFee: defaultFees.percentFee,
    });
    setSelectedDirectoryId('');
    setEditingId(null);
    setShowForm(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    // Fee fields stay as raw strings while typing (so backspacing to empty
    // doesn't get immediately snapped back to "0") — parsed to numbers only
    // on submit.
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  // Mouse-wheel scrolling shouldn't silently change a focused number field.
  const blurOnWheel = (e: React.WheelEvent<HTMLInputElement>) => e.currentTarget.blur();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setMessage('Agent name is required');
      return;
    }

    setIsSubmitting(true);
    setMessage('');

    try {
      const payload = {
        ...(editingId && { id: editingId }),
        ...(!editingId && selectedDirectoryId && { brokerageAgentId: selectedDirectoryId }),
        name: formData.name.trim(),
        brokerage: formData.brokerage?.trim() || null,
        email: formData.email?.trim() || null,
        phone: formData.phone?.trim() || null,
        flatFee: parseFloat(String(formData.flatFee)) || 0,
        percentFee: parseFloat(String(formData.percentFee)) || 0,
      };

      const response = await authFetch('/api/agents', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save agent');
      }

      const saved = editingId ? await response.json().catch(() => null) : null;
      const gave = saved?.portalAccess as { deals?: number; listings?: number } | null | undefined;
      const gaveCount = (gave?.deals ?? 0) + (gave?.listings ?? 0);
      setMessage(
        editingId
          ? gaveCount > 0
            ? `Agent updated! They now have portal access to ${gaveCount} open deal${gaveCount === 1 ? '' : 's'} and listing${gaveCount === 1 ? '' : 's'}, and were emailed once.`
            : 'Agent updated!'
          : 'Agent added!'
      );
      await fetchAgents();
      resetForm();
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setMessage(error instanceof Error ? error.message : 'Error saving agent');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGiveAccess = async (agent: Agent) => {
    setMessage('');
    try {
      const response = await authFetch(`/api/agents/${agent.id}/portal-access`, { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not give access');
      const total = (data.deals ?? 0) + (data.listings ?? 0);
      setMessage(
        total === 0
          ? `${agent.name} already has portal access to all of their open deals and listings.`
          : `${agent.name} now has portal access to ${data.deals} open deal${data.deals === 1 ? '' : 's'}${data.listings ? ` and ${data.listings} listing${data.listings === 1 ? '' : 's'}` : ''}${data.emailed ? ', and was emailed once' : ''}.`
      );
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setMessage(error instanceof Error ? error.message : 'Could not give access');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this agent?')) return;

    try {
      const response = await authFetch(`/api/agents?id=${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete agent');
      await fetchAgents();
      setMessage('Agent deleted');
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        router.push('/auth');
        return;
      }
      setMessage('Error deleting agent');
    }
  };

  const handleEdit = (agent: Agent) => {
    setFormData({
      id: agent.id,
      name: agent.name,
      brokerage: agent.brokerage || '',
      email: agent.email || '',
      phone: agent.phone || '',
      flatFee: String(agent.flat_fee ?? 400),
      percentFee: String(agent.commission_percent ?? 0),
    });
    setEditingId(agent.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loading) {
    return (
      <div className="p-4 md:p-8">
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full border-4 border-slate-600 border-t-blue-400 animate-spin mx-auto mb-4" />
            <p className="text-slate-400">Loading agents...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-semibold text-slate-100 mb-1">Agents</h1>
          <p className="text-slate-400">
            {agents.length === 0 ? 'Manage your real estate agents' : `${agents.length} agent${agents.length === 1 ? '' : 's'}`}
          </p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="shrink-0 px-5 py-2.5 bg-blue-500 hover:bg-blue-400 text-white text-sm font-semibold rounded-lg transition shadow-lg"
          >
            + Add Agent
          </button>
        )}
      </div>

      {message && (
        <div className={`mb-6 p-4 border rounded-lg ${
          message.includes('Error') 
            ? 'bg-red-900/30 border-red-700 text-red-200' 
            : 'bg-blue-900/30 border-blue-700 text-blue-200'
        }`}>
          {message}
        </div>
      )}

      {showForm && (
        <div className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-8 mb-8">
          <h2 className="text-2xl font-bold text-slate-100 mb-6">
            {editingId ? 'Edit Agent' : 'Add New Agent'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-6">
            {!editingId && directory.length > 0 && (
              <div className="bg-slate-800/60 border border-slate-600 rounded-lg p-4">
                <label className="text-sm text-slate-400 block mb-2">
                  Link to brokerage directory <span className="text-slate-500">(optional)</span>
                </label>
                <select
                  value={selectedDirectoryId}
                  onChange={(e) => handlePickDirectoryAgent(e.target.value)}
                  className="w-full bg-slate-800/70 border border-white/10 rounded-xl px-4 py-2 text-slate-100 focus:border-blue-500 focus:outline-none"
                >
                  <option value="">-- Not linked (new contact) --</option>
                  {directory.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-2">
                  Picking someone already in your brokerage&rsquo;s agent directory fills in their info below --
                  still your own contact, with your own fee terms, just connected to the same real person.
                </p>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <label className="text-sm text-slate-400 block mb-2">
                  Agent Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  placeholder="John Smith"
                  className="w-full bg-slate-800/70 border border-white/10 rounded-xl px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="text-sm text-slate-400 block mb-2">Brokerage</label>
                <input
                  type="text"
                  name="brokerage"
                  value={formData.brokerage}
                  onChange={handleInputChange}
                  placeholder="Coldwell Banker"
                  className="w-full bg-slate-800/70 border border-white/10 rounded-xl px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-sm text-slate-400 block mb-2">Email</label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="agent@example.com"
                  className="w-full bg-slate-800/70 border border-white/10 rounded-xl px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-sm text-slate-400 block mb-2">Phone</label>
                <PhoneInput
                  name="phone"
                  value={formData.phone}
                  onValueChange={(v) => setFormData((prev) => ({ ...prev, phone: v }))}
                  className="w-full bg-slate-800/70 border border-white/10 rounded-xl px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-sm text-slate-400 block mb-2">
                  Flat Fee per Deal ($)
                </label>
                <MoneyInput
                  name="flatFee"
                  value={formData.flatFee}
                  onValueChange={(v) => setFormData((prev) => ({ ...prev, flatFee: v }))}
                  placeholder="400"
                  aria-label="Flat fee per deal"
                  className="w-full bg-slate-800/70 border border-white/10 rounded-xl px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
                <p className="text-xs text-slate-500 mt-1">Fixed fee per transaction closed</p>
              </div>

              <div>
                <label className="text-sm text-slate-400 block mb-2">
                  Percentage Fee (%)
                </label>
                <input
                  type="number"
                  name="percentFee"
                  value={formData.percentFee}
                  onChange={handleInputChange}
                  onWheel={blurOnWheel}
                  placeholder="0"
                  step="0.01"
                  min="0"
                  max="100"
                  className="w-full bg-slate-800/70 border border-white/10 rounded-xl px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
                <p className="text-xs text-slate-500 mt-1">Percentage of purchase price (optional)</p>
              </div>
            </div>

            <div className="flex gap-3 pt-6 border-t border-slate-600">
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 px-4 py-3 bg-blue-500 hover:bg-blue-400 text-white font-semibold rounded-lg transition disabled:opacity-50"
              >
                {isSubmitting ? 'Saving...' : editingId ? 'Update Agent' : 'Add Agent'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                disabled={isSubmitting}
                className="px-4 py-3 border border-slate-600 hover:border-slate-500 text-slate-300 hover:text-slate-100 rounded-lg transition font-medium disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {agents.length === 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-12 text-center">
          <svg className="w-16 h-16 text-slate-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.856-1.487M15 10a3 3 0 11-6 0 3 3 0 016 0zM6 20a3 3 0 003-3v-2a3 3 0 00-3-3H3a3 3 0 00-3 3v2a3 3 0 003 3h3z" />
          </svg>
          <h3 className="text-lg font-semibold text-slate-300 mb-2">No agents yet</h3>
          <p className="text-slate-400">Add your first agent to get started</p>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            {qbCount > 0 && (
              <div className="inline-flex rounded-lg border border-slate-600 bg-slate-800/60 p-0.5" role="tablist" aria-label="Show agents">
                {([['all', 'All', agents.length], ['quickbooks', 'From QuickBooks', qbCount]] as const).map(([id, label, n]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={source === id}
                    onClick={() => setSource(id)}
                    className={`px-3 py-1.5 text-sm rounded-md transition whitespace-nowrap ${source === id ? 'bg-slate-600 text-white font-medium' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    {label} <span className="text-xs opacity-70">{n}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="relative flex-1 min-w-[14rem]">
              <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search agents by name, brokerage, email or phone"
                aria-label="Search agents"
                className="w-full bg-slate-700/60 border border-slate-600 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
            </div>
            {visibleAgents.length > 1 && (
              <button
                type="button"
                onClick={() => setExpanded(expanded.size >= visibleAgents.length ? new Set() : new Set(visibleAgents.map((a) => a.id)))}
                className="text-sm text-slate-400 hover:text-slate-200 underline-offset-2 hover:underline"
              >
                {expanded.size >= visibleAgents.length ? 'Collapse all' : 'Expand all'}
              </button>
            )}
          </div>

          {visibleAgents.length === 0 ? (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-10 text-center">
              <p className="text-slate-300 font-medium">No agents match &ldquo;{query.trim()}&rdquo;</p>
              <button type="button" onClick={() => setQuery('')} className="mt-2 text-sm text-blue-400 hover:text-blue-300">
                Clear search
              </button>
            </div>
          ) : (
            <ul className="rounded-xl border border-slate-600 bg-slate-800/40 divide-y divide-slate-700 overflow-hidden">
              {visibleAgents.map((agent) => {
                const open = expanded.has(agent.id);
                return (
                  <li key={agent.id} id={`agent-row-${agent.id}`}>
                    <button
                      type="button"
                      onClick={() => toggleExpanded(agent.id)}
                      aria-expanded={open}
                      aria-controls={`agent-${agent.id}`}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-700/40 transition"
                    >
                      <span className="w-9 h-9 shrink-0 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-sm font-bold text-white">
                        {(agent.name[0] || '?').toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="truncate font-medium text-slate-100">{agent.name}</span>
                          {fromQb(agent) && <span className="shrink-0 rounded-full border border-emerald-600/50 bg-emerald-900/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">QuickBooks</span>}
                        </span>
                        <span className="block truncate text-xs text-slate-400">{agent.brokerage || 'No brokerage'}</span>
                      </span>
                      <span className="hidden sm:inline text-sm text-slate-400">
                        ${Number(agent.flat_fee ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        {Number(agent.commission_percent) > 0 ? ` + ${agent.commission_percent}%` : ''}
                      </span>
                      <svg className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {open && (
                      <div id={`agent-${agent.id}`} className="px-4 pb-4 pt-1 sm:pl-[4.0rem]">
                        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                          <div>
                            <dt className="text-xs uppercase tracking-wider text-slate-500">Email</dt>
                            <dd className="mt-0.5 text-slate-200 break-all">
                              {agent.email ? (
                                <a href={`mailto:${agent.email}`} className="hover:text-blue-300">
                                  {agent.email}
                                </a>
                              ) : (
                                <span className="text-slate-500">Not added</span>
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-wider text-slate-500">Phone</dt>
                            <dd className="mt-0.5 text-slate-200">
                              {agent.phone ? (
                                <a href={`tel:${agent.phone}`} className="hover:text-blue-300">
                                  {formatPhoneNumber(agent.phone)}
                                </a>
                              ) : (
                                <span className="text-slate-500">Not added</span>
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-wider text-slate-500">Flat fee per deal</dt>
                            <dd className="mt-0.5 font-semibold text-blue-400">
                              ${Number(agent.flat_fee ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-wider text-slate-500">Percentage fee</dt>
                            <dd className="mt-0.5 font-semibold text-blue-400">{agent.commission_percent ?? 0}%</dd>
                          </div>
                        </dl>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Link
                            href={`/dashboard/agents/${agent.id}`}
                            className="px-3.5 py-1.5 text-sm border border-blue-500/50 text-blue-300 hover:bg-blue-500/10 rounded-lg transition font-medium"
                          >
                            Profile &amp; history
                          </Link>
                          {agent.email && (
                            <button
                              onClick={() => handleGiveAccess(agent)}
                              title="Give this agent a portal login for every open deal and shared listing they are on"
                              className="px-3.5 py-1.5 text-sm border border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10 rounded-lg transition font-medium"
                            >
                              Give access to open deals
                            </button>
                          )}
                          <button
                            onClick={() => handleEdit(agent)}
                            className="px-3.5 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-medium"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(agent.id)}
                            className="px-3.5 py-1.5 text-sm border border-red-500/50 text-red-300 hover:bg-red-600 hover:text-white rounded-lg transition font-medium"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
