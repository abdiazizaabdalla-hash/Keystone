'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface Agent {
  id: string;
  name: string;
  brokerage: string;
  commission_percent: number;
}

export default function NewTransactionPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [formData, setFormData] = useState({
    agentId: '',
    fileNumber: '',
    propertyAddress: '',
    purchasePrice: '',
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAgents();
  }, []);

  const fetchAgents = async () => {
    try {
      const res = await fetch('/api/agents');
      if (!res.ok) throw new Error('Failed to fetch agents');
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('Invalid agents data');
      setAgents(data);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to load agents';
      setError(errorMsg);
      console.error('Error fetching agents:', errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
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

      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: formData.agentId,
          fileNumber: formData.fileNumber,
          propertyAddress: formData.propertyAddress,
          purchasePrice: parseFloat(formData.purchasePrice),
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to create transaction');
      }

      router.push('/transactions');
    } catch (error) {
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
          <Link href="/transactions" className="inline-flex items-center gap-2 text-amber-400 hover:text-amber-300 mb-8 transition">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
            </svg>
            Back to Transactions
          </Link>
          <div className="flex items-center justify-center py-24">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full border-4 border-slate-700 border-t-amber-400 animate-spin mx-auto mb-4" />
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
        <Link href="/transactions" className="inline-flex items-center gap-2 text-amber-400 hover:text-amber-300 mb-8 transition">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
          </svg>
          Back to Transactions
        </Link>

        {/* Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-slate-100 mb-3">Create New Deal</h1>
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
        <form onSubmit={handleSubmit} className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-slate-700 rounded-lg p-8 space-y-8">
          {/* Agent Selection */}
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-3">
              <span className="flex items-center gap-2">
                <svg className="w-5 h-5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
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
              className="w-full bg-slate-700 border border-slate-600 hover:border-slate-500 focus:border-amber-500 rounded-lg px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 transition"
            >
              <option value="">-- Select an agent --</option>
              {agents.length > 0 ? (
                agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} • {agent.brokerage} ({agent.commission_percent}%)
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
                <svg className="w-5 h-5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
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
              className="w-full bg-slate-700 border border-slate-600 hover:border-slate-500 focus:border-amber-500 rounded-lg px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 transition"
            />
            <p className="text-xs text-slate-400 mt-2">Unique identifier for this transaction</p>
          </div>

          {/* Property Address */}
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-3">
              <span className="flex items-center gap-2">
                <svg className="w-5 h-5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
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
              className="w-full bg-slate-700 border border-slate-600 hover:border-slate-500 focus:border-amber-500 rounded-lg px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 transition"
            />
            <p className="text-xs text-slate-400 mt-2">Full address of the property being transacted</p>
          </div>

          {/* Purchase Price */}
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-3">
              <span className="flex items-center gap-2">
                <svg className="w-5 h-5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M8.16 5.314l4.897-1.596A.5.5 0 0114 4.684V7h4a2 2 0 012 2v5a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4V4.684a.5.5 0 01.693-.373zM15 9a1 1 0 100 2 1 1 0 000-2z" />
                </svg>
                Purchase Price
              </span>
            </label>
            <input
              type="number"
              name="purchasePrice"
              value={formData.purchasePrice}
              onChange={handleChange}
              placeholder="e.g., 350000"
              required
              min="0"
              step="0.01"
              className="w-full bg-slate-700 border border-slate-600 hover:border-slate-500 focus:border-amber-500 rounded-lg px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 transition"
            />
            <p className="text-xs text-slate-400 mt-2">Total purchase price for this property</p>
          </div>

          {/* Form Actions */}
          <div className="flex gap-4 pt-6 border-t border-slate-700">
            <button
              type="submit"
              disabled={submitting || agents.length === 0}
              className="flex-1 px-6 py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:from-slate-600 disabled:to-slate-600 text-slate-950 font-semibold rounded-lg transition shadow-lg hover:shadow-amber-500/50 disabled:shadow-none"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-slate-700 border-t-slate-950 rounded-full animate-spin" />
                  Creating...
                </span>
              ) : (
                'Create Transaction'
              )}
            </button>
            <button
              type="button"
              onClick={() => router.back()}
              className="px-6 py-3 border border-slate-600 hover:border-slate-500 text-slate-300 hover:text-slate-100 font-semibold rounded-lg transition hover:bg-slate-800/50"
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
              <p className="text-blue-200 text-sm">When you create this transaction, Keystone will automatically generate a complete checklist with all the standard tasks for real estate closings.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
