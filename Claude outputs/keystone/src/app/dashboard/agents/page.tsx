'use client';

import { useEffect, useState } from 'react';

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
  flatFee: number;
  percentFee: number;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  const [formData, setFormData] = useState<FormData>({
    name: '',
    brokerage: '',
    email: '',
    phone: '',
    flatFee: 400,
    percentFee: 0,
  });

  useEffect(() => {
    fetchAgents();
  }, []);

  const fetchAgents = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        console.error('No auth token found');
        setLoading(false);
        return;
      }

      const response = await fetch('/api/agents', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        setAgents(Array.isArray(data) ? data : []);
      } else if (response.status === 401) {
        console.error('Unauthorized - token may be invalid');
      }
    } catch (error) {
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
      flatFee: 400,
      percentFee: 0,
    });
    setEditingId(null);
    setShowForm(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;

    if (name === 'flatFee' || name === 'percentFee') {
      const numValue = value === '' ? 0 : parseFloat(value);
      setFormData(prev => ({
        ...prev,
        [name]: isNaN(numValue) ? 0 : numValue,
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: value,
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setMessage('Agent name is required');
      return;
    }

    setIsSubmitting(true);
    setMessage('');

    try {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        throw new Error('No auth token found');
      }

      const payload = {
        ...(editingId && { id: editingId }),
        name: formData.name.trim(),
        brokerage: formData.brokerage?.trim() || null,
        email: formData.email?.trim() || null,
        phone: formData.phone?.trim() || null,
        flatFee: parseFloat(String(formData.flatFee)) || 0,
        percentFee: parseFloat(String(formData.percentFee)) || 0,
      };

      const response = await fetch('/api/agents', {
        method: editingId ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
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
      setMessage(error instanceof Error ? error.message : 'Error saving agent');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this agent?')) return;

    try {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        throw new Error('No auth token found');
      }

      const response = await fetch(`/api/agents?id=${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to delete agent');
      await fetchAgents();
      setMessage('Agent deleted');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Error deleting agent');
    }
  };

  const handleEdit = (agent: Agent) => {
    setFormData({
      id: agent.id,
      name: agent.name,
      brokerage: agent.brokerage || '',
      email: agent.email || '',
      phone: agent.phone || '',
      flatFee: agent.flat_fee || 400,
      percentFee: agent.commission_percent || 0,
    });
    setEditingId(agent.id);
    setShowForm(true);
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full border-4 border-slate-700 border-t-amber-400 animate-spin mx-auto mb-4" />
            <p className="text-slate-400">Loading agents...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-100 mb-1">Agents</h1>
          <p className="text-slate-400">Manage your real estate agents</p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="px-6 py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-semibold rounded-lg transition shadow-lg"
          >
            + Add Agent
          </button>
        )}
      </div>

      {/* Message */}
      {message && (
        <div className="mb-6 p-4 bg-blue-900/30 border border-blue-700 rounded-lg text-blue-200">
          {message}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-lg p-8 mb-8">
          <h2 className="text-2xl font-bold text-slate-100 mb-6">
            {editingId ? 'Edit Agent' : 'Add New Agent'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              {/* Name */}
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
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                  required
                />
              </div>

              {/* Brokerage */}
              <div>
                <label className="text-sm text-slate-400 block mb-2">Brokerage</label>
                <input
                  type="text"
                  name="brokerage"
                  value={formData.brokerage}
                  onChange={handleInputChange}
                  placeholder="Coldwell Banker"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                />
              </div>

              {/* Email */}
              <div>
                <label className="text-sm text-slate-400 block mb-2">Email</label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="agent@example.com"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                />
              </div>

              {/* Phone */}
              <div>
                <label className="text-sm text-slate-400 block mb-2">Phone</label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleInputChange}
                  placeholder="(555) 123-4567"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                />
              </div>

              {/* Flat Fee */}
              <div>
                <label className="text-sm text-slate-400 block mb-2">
                  Flat Fee per Deal ($)
                </label>
                <input
                  type="number"
                  name="flatFee"
                  value={formData.flatFee}
                  onChange={handleInputChange}
                  placeholder="400"
                  step="0.01"
                  min="0"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                />
                <p className="text-xs text-slate-500 mt-1">Fixed fee per transaction closed</p>
              </div>

              {/* Percentage Fee */}
              <div>
                <label className="text-sm text-slate-400 block mb-2">
                  Percentage Fee (%)
                </label>
                <input
                  type="number"
                  name="percentFee"
                  value={formData.percentFee}
                  onChange={handleInputChange}
                  placeholder="0"
                  step="0.01"
                  min="0"
                  max="100"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                />
                <p className="text-xs text-slate-500 mt-1">Percentage of purchase price (optional)</p>
              </div>
            </div>

            {/* Buttons */}
            <div className="flex gap-3 pt-6 border-t border-slate-700">
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 px-4 py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-semibold rounded-lg transition disabled:opacity-50"
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

      {/* Agents List */}
      {agents.length === 0 ? (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-12 text-center">
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
              className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-lg p-6 hover:border-slate-600 transition"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-gradient-to-br from-amber-500 to-amber-600 rounded-full flex items-center justify-center text-sm font-bold text-slate-950">
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

              <div className="grid md:grid-cols-2 gap-6 py-4 border-t border-slate-700">
                {/* Contact */}
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
                      <p className="text-slate-300">{agent.phone}</p>
                    </div>
                  )}
                </div>

                {/* Fees */}
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Flat Fee per Deal</p>
                    <p className="text-lg font-semibold text-amber-400">
                      ${agent.flat_fee.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Percentage Fee</p>
                    <p className="text-lg font-semibold text-amber-400">{agent.commission_percent}%</p>
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
