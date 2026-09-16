'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getTemplateByType } from '@/lib/taskTemplates';

export default function NewTransactionPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    agentName: '',
    fileNumber: '',
    propertyAddress: '',
    purchasePrice: '',
  });
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Create transaction via API
      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: formData.agentName,
          fileNumber: formData.fileNumber,
          propertyAddress: formData.propertyAddress,
          purchasePrice: parseFloat(formData.purchasePrice),
        }),
      });

      const transaction = await res.json();

      // Auto-create tasks
      const taskTemplate = getTemplateByType('realEstate');
      await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId: transaction.id,
          taskNames: taskTemplate,
        }),
      });

      router.push('/transactions');
    } catch (error) {
      console.error('Error:', error);
      alert('Failed to create transaction');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-4xl font-bold mb-8">Create New Transaction</h1>

        <form onSubmit={handleSubmit} className="bg-gray-800 p-8 rounded-lg">
          <div className="mb-6">
            <label className="block text-sm font-semibold mb-2">Agent Name</label>
            <input
              type="text"
              name="agentName"
              value={formData.agentName}
              onChange={handleChange}
              required
              className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-2 text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-semibold mb-2">File Number</label>
            <input
              type="text"
              name="fileNumber"
              value={formData.fileNumber}
              onChange={handleChange}
              required
              className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-2 text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-semibold mb-2">Property Address</label>
            <input
              type="text"
              name="propertyAddress"
              value={formData.propertyAddress}
              onChange={handleChange}
              required
              className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-2 text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="mb-8">
            <label className="block text-sm font-semibold mb-2">Purchase Price</label>
            <input
              type="number"
              name="purchasePrice"
              value={formData.purchasePrice}
              onChange={handleChange}
              required
              className="w-full bg-gray-700 border border-gray-600 rounded px-4 py-2 text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex gap-4">
            <button
              type="submit"
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 px-8 py-2 rounded-lg font-semibold"
            >
              {loading ? 'Creating...' : 'Create Transaction'}
            </button>
            <button
              type="button"
              onClick={() => window.history.back()}
              className="bg-gray-700 hover:bg-gray-600 px-8 py-2 rounded-lg font-semibold"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
