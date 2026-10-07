'use client';

import { useEffect, useState } from 'react';
import { authFetch, saveSession } from '@/lib/authClient';

interface Enrollment {
  factorId: string;
  qrCode: string;
  secret: string;
}

// "Two-step sign-in" card on the Account page: turn an authenticator app
// (Google Authenticator, 1Password, Authy...) on or off.
export default function AccountSecuritySection() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const res = await authFetch('/api/auth/mfa/status');
        if (res.ok) {
          const data = await res.json();
          setEnabled(Boolean(data.enabled));
        }
      } catch {
        // Card just stays hidden if status can't load.
      }
    };
    load();
  }, []);

  const call = async (url: string, body?: unknown) => {
    const res = await authFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  };

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      setEnrollment(await call('/api/auth/mfa/enroll'));
      setCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start setup');
    } finally {
      setBusy(false);
    }
  };

  const activate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrollment) return;
    setBusy(true);
    setError('');
    try {
      const data = await call('/api/auth/mfa/activate', { factorId: enrollment.factorId, code: code.trim() });
      if (data.session?.access_token) {
        saveSession(data.session.access_token, data.session.refresh_token, data.session.user.id);
      }
      setEnabled(true);
      setEnrollment(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code didn\'t work');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!window.confirm('Turn off two-step sign-in? Your account will be protected by your password only.')) return;
    setBusy(true);
    setError('');
    try {
      await call('/api/auth/mfa/disable');
      setEnabled(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not turn it off');
    } finally {
      setBusy(false);
    }
  };

  if (enabled === null) return null;

  return (
    <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-4 md:p-6 mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-100">Two-step sign-in</h2>
          <p className="text-sm text-slate-400">
            {enabled
              ? 'On. You\'ll enter a code from your authenticator app each time you sign in.'
              : 'Add a code from an authenticator app as a second step, so a stolen password isn\'t enough.'}
          </p>
        </div>
        {enabled ? (
          <button
            onClick={disable}
            disabled={busy}
            className="px-4 py-2 border border-slate-500 hover:border-red-700 text-slate-300 hover:text-red-300 text-sm font-medium rounded-lg transition disabled:opacity-50"
          >
            Turn off
          </button>
        ) : !enrollment ? (
          <button
            onClick={start}
            disabled={busy}
            className="px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
          >
            {busy ? 'Starting…' : 'Set up'}
          </button>
        ) : null}
      </div>

      {enrollment && !enabled && (
        <form onSubmit={activate} className="mt-5 pt-5 border-t border-slate-600 space-y-4">
          <p className="text-sm text-slate-300">
            1. Scan this QR code with your authenticator app (or type the key in by hand).
          </p>
          <div className="flex flex-wrap items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enrollment.qrCode} alt="Authenticator QR code" className="w-40 h-40 bg-white rounded-lg p-2" />
            <div className="min-w-0">
              <p className="text-xs text-slate-500 mb-1">Setup key</p>
              <code className="text-xs text-slate-200 break-all select-all">{enrollment.secret}</code>
            </div>
          </div>
          <p className="text-sm text-slate-300">2. Enter the 6-digit code it shows to finish.</p>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
              className="w-36 bg-slate-600 border border-slate-600 rounded-lg px-3 py-2 text-center tracking-[0.3em] text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              required
            />
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
            >
              {busy ? 'Checking…' : 'Turn on'}
            </button>
            <button
              type="button"
              onClick={() => setEnrollment(null)}
              className="px-3 py-2 text-slate-400 hover:text-slate-200 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
    </div>
  );
}
