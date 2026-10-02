'use client';

import { use, useEffect, useState } from 'react';

interface DatesInfo {
  scope: 'dates';
  propertyAddress: string;
  fileNumber: string;
  acceptanceDate: string | null;
  closingDate: string | null;
  dates: { label: string; date: string; dateDisplay: string }[];
}

interface DocumentInfo {
  scope: 'document';
  propertyAddress: string;
  fileNumber: string;
  fileName: string;
  contentType: string | null;
  previewUrl: string | null;
}

type ExternalInfo = DatesInfo | DocumentInfo;

// Public, unauthenticated page -- the token in the URL is the only
// credential (see lib/externalAccess.ts). No dashboard chrome: whoever
// opens this link (a lender, a title company, an inspector) has no
// Relay TC account, and the response already carries only what this
// link's scope allows -- nothing extra to hide here either.
export default function ExternalAccessPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [info, setInfo] = useState<ExternalInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/external/${token}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'This link is invalid or has expired');
        setInfo(data);
      })
      .catch((error) => setLoadError(error instanceof Error ? error.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="w-10 h-10 rounded-full border-4 border-slate-600 border-t-blue-400 animate-spin" />
      </div>
    );
  }

  if (loadError || !info) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center bg-slate-800/50 border border-slate-600 rounded-lg p-8">
          <h1 className="text-xl font-bold text-slate-100 mb-2">Link unavailable</h1>
          <p className="text-slate-400 text-sm">{loadError || 'This link is invalid or has expired.'}</p>
        </div>
      </div>
    );
  }

  if (info.scope === 'document') {
    return (
      <div className="min-h-screen px-6 py-12">
        <div className="max-w-3xl mx-auto">
          <div className="mb-6 text-center">
            <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">
              {info.fileNumber} · {info.propertyAddress}
            </p>
            <h1 className="text-2xl font-display font-semibold text-slate-100">{info.fileName}</h1>
          </div>

          {info.previewUrl ? (
            <div className="bg-slate-800/50 border border-slate-600 rounded-lg overflow-hidden" style={{ height: '70vh' }}>
              <iframe src={info.previewUrl} title={info.fileName} className="w-full h-full" />
            </div>
          ) : (
            <p className="text-center text-slate-400">This document is no longer available.</p>
          )}

          {info.previewUrl && (
            <div className="mt-6 text-center">
              <a
                href={info.previewUrl}
                className="inline-block px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition"
              >
                Download
              </a>
            </div>
          )}
        </div>
      </div>
    );
  }

  // scope === 'dates'
  return (
    <div className="min-h-screen px-6 py-12">
      <div className="max-w-xl mx-auto">
        <div className="mb-8 text-center">
          <p className="text-slate-500 text-xs uppercase tracking-wider mb-1">{info.fileNumber}</p>
          <h1 className="text-2xl font-display font-semibold text-slate-100">{info.propertyAddress}</h1>
        </div>

        <div className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-6 space-y-4">
          {info.acceptanceDate && (
            <div className="flex items-center justify-between border-b border-slate-600/50 pb-3">
              <span className="text-slate-300">Acceptance Date</span>
              <span className="text-slate-100 font-semibold">{info.acceptanceDate}</span>
            </div>
          )}
          {info.closingDate && (
            <div className="flex items-center justify-between border-b border-slate-600/50 pb-3">
              <span className="text-slate-300">Target Closing Date</span>
              <span className="text-slate-100 font-semibold">{info.closingDate}</span>
            </div>
          )}
          {info.dates.length === 0 && !info.acceptanceDate && !info.closingDate && (
            <p className="text-slate-400 text-center">No dates have been set on this transaction yet.</p>
          )}
          {info.dates.map((d, i) => (
            <div key={i} className="flex items-center justify-between">
              <span className="text-slate-300">{d.label}</span>
              <span className="text-slate-100 font-semibold">{d.dateDisplay}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
