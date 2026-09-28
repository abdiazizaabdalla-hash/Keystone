'use client';

import { useEffect, useState } from 'react';
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

export default function AgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [defaultFees, setDefaultFees] = useState({ flatFee: '400', percentFee: '0' });

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
  }, []);

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

      setMessage(editingId ? 'Agent updated!' : 'Agent added!');
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
  };

  if (loading) {
    return (
      <div className="p-8">
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
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-semibold text-slate-100 mb-1">Agents</h1>
          <p className="text-slate-400">Manage your real estate agents</p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition shadow-lg"
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
                  className="w-full bg-slate-600 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
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
                  className="w-full bg-slate-600 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
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
                  className="w-full bg-slate-600 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-sm text-slate-400 block mb-2">Phone</label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleInputChange}
                  placeholder="(555) 123-4567"
                  className="w-full bg-slate-600 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-sm text-slate-400 block mb-2">
                  Flat Fee per Deal ($)
                </label>
                <input
                  type="number"
                  name="flatFee"
                  value={formData.flatFee}
                  onChange={handleInputChange}
                  onWheel={blurOnWheel}
                  placeholder="400"
                  step="0.01"
                  min="0"
                  className="w-full bg-slate-600 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
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
                  className="w-full bg-slate-600 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                />
                <p className="text-xs text-slate-500 mt-1">Percentage of purchase price (optional)</p>
              </div>
            </div>

            <div className="flex gap-3 pt-6 border-t border-slate-600">
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition disabled:opacity-50"
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
        <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-12 text-center">
          <svg className="w-16 h-16 text-slate-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.856-1.487M15 10a3 3 0 11-6 0 3 3 0 016 0zM6 20a3 3 0 003-3v-2a3 3 0 00-3-3H3a3 3 0 00-3 3v2a3 3 0 003 3h3z" />
          </svg>
          <h3 className="text-lg font-semibold text-slate-300 mb-2">No agents yet</h3>
          <p className="text-slate-400">Add your first agent to get started</p>
        </div>
      ) : (
        <div className="grid gap-6">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600 rounded-lg p-6 hover:border-slate-600 transition"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-sm font-bold text-white">
                    {agent.name[0]}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-100">{agent.name}</h3>
                    <p className="text-sm text-slate-400">{agent.brokerage || 'No brokerage'}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEdit(agent)}
                    className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-medium"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(agent.id)}
                    className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg transition font-medium"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-6 py-4 border-t border-slate-600">
                <div className="space-y-3">
                  {agent.email && (
                    <div>
                      <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Email</p>
                      <p className="text-slate-300">{agent.email}</p>
                    </div>
                  )}
                  {agent.phone && (
                    <div>
                      <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Phone</p>
                      <p className="text-slate-300">{formatPhoneNumber(agent.phone)}</p>
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Flat Fee per Deal</p>
                    <p className="text-lg font-semibold text-blue-400">
                      ${agent.flat_fee.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Percentage Fee</p>
                    <p className="text-lg font-semibold text-blue-400">{agent.commission_percent}%</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
