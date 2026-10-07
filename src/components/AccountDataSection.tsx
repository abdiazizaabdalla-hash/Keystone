'use client';

import { useState } from 'react';
import Link from 'next/link';
import { authFetch } from '@/lib/authClient';

// "Your data" card on the Account page: download a copy of everything stored
// for the account, or ask for the account and data to be deleted.
export default function AccountDataSection({ deletionRequestedAt }: { deletionRequestedAt: string | null }) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [requestedAt, setRequestedAt] = useState<string | null>(deletionRequestedAt);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState('');

  const handleExport = async () => {
    setExporting(true);
    setExportError('');
    try {
      const res = await authFetch('/api/account/export');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not export your data');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `relay-data-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Could not export your data');
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteRequest = async () => {
    setRequesting(true);
    setRequestError('');
    try {
      const res = await authFetch('/api/account/delete-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not submit your request');
      setRequestedAt(data.requestedAt || new Date().toISOString());
      setConfirming(false);
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : 'Could not submit your request');
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-4 md:p-6 mt-6">
      <h2 className="text-lg font-semibold text-slate-100 mb-1">Your data</h2>
      <p className="text-sm text-slate-400 mb-4">
        You own what you put into Relay. See our{' '}
        <Link href="/privacy" className="text-blue-400 hover:text-blue-300">Privacy Policy</Link> for details.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3 py-3 border-t border-slate-600">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-200">Download a copy</p>
          <p className="text-xs text-slate-500">Your account, transactions, tasks, contacts, invoices, and messages as a JSON file.</p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="px-4 py-2 border border-slate-500 hover:border-blue-500 text-slate-200 text-sm font-medium rounded-lg transition disabled:opacity-50"
        >
          {exporting ? 'Preparing…' : 'Download my data'}
        </button>
      </div>
      {exportError && <p className="text-sm text-red-400 mb-2">{exportError}</p>}

      <div className="py-3 border-t border-slate-600">
        {requestedAt ? (
          <p className="text-sm text-amber-200">
            Deletion requested on {new Date(requestedAt).toLocaleDateString()}. We&apos;ll complete it within 30 days and
            email you. Cancel any active subscription from this page so you aren&apos;t billed again.
          </p>
        ) : confirming ? (
          <div>
            <p className="text-sm text-slate-300 mb-3">
              This asks us to permanently delete your account and everything in it. Cancel any active subscription first.
              We&apos;ll confirm by email and finish within 30 days.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleDeleteRequest}
                disabled={requesting}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
              >
                {requesting ? 'Submitting…' : 'Yes, request deletion'}
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={requesting}
                className="px-4 py-2 text-slate-400 hover:text-slate-200 text-sm transition"
              >
                Cancel
              </button>
            </div>
            {requestError && <p className="text-sm text-red-400 mt-2">{requestError}</p>}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-200">Delete my account</p>
              <p className="text-xs text-slate-500">Request permanent deletion of your account and data.</p>
            </div>
            <button
              onClick={() => setConfirming(true)}
              className="px-4 py-2 border border-red-800 hover:bg-red-900/30 text-red-300 text-sm font-medium rounded-lg transition"
            >
              Request deletion
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
