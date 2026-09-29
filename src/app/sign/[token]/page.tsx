'use client';

import { useEffect, useRef, useState, use } from 'react';

interface SigningStatus {
  status: 'pending' | 'signed' | 'voided' | 'declined';
  fileName: string;
  signerName: string;
  previewUrl?: string | null;
  signedAt?: string | null;
  declineReason?: string | null;
}

// Public, unauthenticated page -- the token in the URL is the only
// credential (see lib/signing.ts). No dashboard chrome here on purpose:
// whoever opens this link may never have a Relay TC account at all.
export default function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [info, setInfo] = useState<SigningStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [signatureTab, setSignatureTab] = useState<'draw' | 'type'>('draw');
  const [typedSignature, setTypedSignature] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const [showDeclineForm, setShowDeclineForm] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [declining, setDeclining] = useState(false);
  const [declineError, setDeclineError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasStrokeRef = useRef(false);

  useEffect(() => {
    fetch(`/api/signing-requests/public/${token}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'This signing link is invalid or has expired');
        setInfo(data);
        setTypedSignature(data.signerName || '');
      })
      .catch((error) => setLoadError(error instanceof Error ? error.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [token]);

  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawingRef.current = true;
    hasStrokeRef.current = true;
    const { x, y } = getCanvasPoint(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const continueStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCanvasPoint(e);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1e293b';
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const endStroke = () => {
    drawingRef.current = false;
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasStrokeRef.current = false;
  };

  const handleSubmit = async () => {
    setSubmitError(null);

    if (!consent) {
      setSubmitError('Please confirm you consent to sign electronically.');
      return;
    }

    let signatureType: 'typed' | 'drawn';
    let signatureValue: string;

    if (signatureTab === 'type') {
      if (!typedSignature.trim()) {
        setSubmitError('Please type your name to sign.');
        return;
      }
      signatureType = 'typed';
      signatureValue = typedSignature.trim();
    } else {
      if (!hasStrokeRef.current || !canvasRef.current) {
        setSubmitError('Please draw your signature.');
        return;
      }
      signatureType = 'drawn';
      signatureValue = canvasRef.current.toDataURL('image/png');
    }

    try {
      setSubmitting(true);
      const response = await fetch(`/api/signing-requests/public/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatureType, signatureValue, consent: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to submit signature');
      setDownloadUrl(data.downloadUrl || null);
      setInfo((prev) => (prev ? { ...prev, status: 'signed' } : prev));
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Failed to submit signature');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecline = async () => {
    setDeclineError(null);
    try {
      setDeclining(true);
      const response = await fetch(`/api/signing-requests/public/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decline: true, reason: declineReason.trim() || undefined }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to decline');
      setDeclined(true);
      setInfo((prev) => (prev ? { ...prev, status: 'declined' } : prev));
    } catch (error) {
      setDeclineError(error instanceof Error ? error.message : 'Failed to decline');
    } finally {
      setDeclining(false);
    }
  };

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
          <p className="text-slate-400 text-sm">{loadError || 'This signing link is invalid or has expired.'}</p>
        </div>
      </div>
    );
  }

  // Bug fixed 2026-09: this used to treat ANY non-pending status as a
  // success screen ("has been signed") -- including 'voided' and now
  // 'declined', which are not success states and need their own
  // messaging so a signer (or a TC checking the link later) isn't told
  // something was signed when it wasn't.
  if (info.status !== 'pending' || downloadUrl || declined) {
    if (info.status === 'voided') {
      return (
        <div className="min-h-screen flex items-center justify-center px-6">
          <div className="max-w-md text-center bg-slate-800/50 border border-slate-600 rounded-lg p-8">
            <div className="w-12 h-12 rounded-full bg-slate-600/30 border border-slate-500/50 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-slate-100 mb-2">This request was cancelled</h1>
            <p className="text-slate-400 text-sm">
              The sender cancelled this signature request. If you still need to sign {info.fileName}, contact them for a new link.
            </p>
          </div>
        </div>
      );
    }

    if (info.status === 'declined' || declined) {
      return (
        <div className="min-h-screen flex items-center justify-center px-6">
          <div className="max-w-md text-center bg-slate-800/50 border border-slate-600 rounded-lg p-8">
            <div className="w-12 h-12 rounded-full bg-orange-500/20 border border-orange-500/50 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-slate-100 mb-2">You declined to sign</h1>
            <p className="text-slate-400 text-sm">
              We let the sender know you declined to sign {info.fileName}. They may follow up with you directly.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center bg-slate-800/50 border border-slate-600 rounded-lg p-8">
          <div className="w-12 h-12 rounded-full bg-green-500/20 border border-green-500/50 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-slate-100 mb-2">Signed</h1>
          <p className="text-slate-400 text-sm mb-6">
            {info.fileName} has been signed{info.signedAt ? ` on ${new Date(info.signedAt).toLocaleString()}` : ''}.
          </p>
          {downloadUrl && (
            <a
              href={downloadUrl}
              className="inline-block px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition"
            >
              Download signed PDF
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-6 py-12">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-display font-semibold text-slate-100 mb-1">Review &amp; Sign</h1>
          <p className="text-slate-400 text-sm">{info.fileName}</p>
        </div>

        {info.previewUrl && (
          <div className="mb-8 bg-slate-800/50 border border-slate-600 rounded-lg overflow-hidden" style={{ height: '60vh' }}>
            <iframe src={info.previewUrl} title={info.fileName} className="w-full h-full" />
          </div>
        )}

        <div className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-6 space-y-5">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSignatureTab('draw')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                signatureTab === 'draw' ? 'bg-blue-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              Draw
            </button>
            <button
              type="button"
              onClick={() => setSignatureTab('type')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                signatureTab === 'type' ? 'bg-blue-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              Type
            </button>
          </div>

          {signatureTab === 'draw' ? (
            <div>
              <canvas
                ref={canvasRef}
                width={640}
                height={160}
                onPointerDown={startStroke}
                onPointerMove={continueStroke}
                onPointerUp={endStroke}
                onPointerLeave={endStroke}
                className="w-full bg-white rounded-lg border border-slate-500 touch-none"
                style={{ height: 160 }}
              />
              <button
                type="button"
                onClick={clearCanvas}
                className="mt-2 text-xs text-slate-400 hover:text-slate-200 transition"
              >
                Clear
              </button>
            </div>
          ) : (
            <input
              type="text"
              value={typedSignature}
              onChange={(e) => setTypedSignature(e.target.value)}
              placeholder="Type your full name"
              className="w-full bg-white rounded-lg border border-slate-500 px-4 py-4 text-2xl italic text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              style={{ fontFamily: 'Georgia, serif' }}
            />
          )}

          <label className="flex items-start gap-3 text-sm text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-blue-500 cursor-pointer"
            />
            <span>
              I consent to sign this document electronically. I understand this has the same legal effect as a
              handwritten signature under the U.S. ESIGN Act and UETA.
            </span>
          </label>

          {submitError && <p className="text-sm text-red-400">{submitError}</p>}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || declining}
            className="w-full px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 disabled:opacity-50 text-white font-semibold rounded-lg transition"
          >
            {submitting ? 'Submitting…' : 'Sign & Submit'}
          </button>

          {!showDeclineForm ? (
            <button
              type="button"
              onClick={() => setShowDeclineForm(true)}
              disabled={submitting}
              className="w-full text-center text-sm text-slate-500 hover:text-red-400 transition"
            >
              I don&apos;t want to sign this
            </button>
          ) : (
            <div className="border-t border-slate-600 pt-4 space-y-3">
              <p className="text-sm text-slate-300">
                Let the sender know why (optional) &mdash; they&apos;ll be notified either way.
              </p>
              <textarea
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                placeholder="Optional note to the sender"
                rows={2}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              />
              {declineError && <p className="text-sm text-red-400">{declineError}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleDecline}
                  disabled={declining}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition"
                >
                  {declining ? 'Submitting…' : 'Confirm decline'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeclineForm(false)}
                  disabled={declining}
                  className="px-4 py-2 border border-slate-600 text-slate-300 hover:text-slate-100 text-sm rounded-lg transition disabled:opacity-50"
                >
                  Never mind
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
