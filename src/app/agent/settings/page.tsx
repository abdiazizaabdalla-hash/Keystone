'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError, clearSession } from '@/lib/authClient';

export default function AgentSettingsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');

  const [fullName, setFullName] = useState('');
  const [savedName, setSavedName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameMessage, setNameMessage] = useState('');
  const [nameError, setNameError] = useState('');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const res = await authFetch('/api/auth/me');
        if (!res.ok) throw new Error('Failed to load your profile');
        const data = await res.json();
        setEmail(data.email || '');
        setFullName(data.fullName || '');
        setSavedName(data.fullName || '');
      } catch (err) {
        if (err instanceof AuthRequiredError) {
          router.push('/agent/login');
          return;
        }
        console.error('Error loading agent settings:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [router]);

  const handleLogout = () => {
    clearSession();
    router.push('/agent/login');
  };

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    setNameError('');
    setNameMessage('');
    if (!fullName.trim()) {
      setNameError('Enter your name.');
      return;
    }
    setSavingName(true);
    try {
      const res = await authFetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: fullName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save your name');
      setSavedName(data.fullName || fullName.trim());
      setNameMessage('Saved.');
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        router.push('/agent/login');
        return;
      }
      setNameError(err instanceof Error ? err.message : 'Failed to save your name');
    } finally {
      setSavingName(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordMessage('');
    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.');
      return;
    }
    setSavingPassword(true);
    try {
      const res = await authFetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update your password');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage('Password updated. Use it the next time you log in, or keep using the emailed link -- either still works.');
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        router.push('/agent/login');
        return;
      }
      setPasswordError(err instanceof Error ? err.message : 'Failed to update your password');
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 px-6 py-12">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-8">
          <div className="flex items-center gap-3">
            <img src="/relay-icon.png" alt="Relay TC" className="w-10 h-10 object-contain" />
            <div>
              <h1 className="text-2xl font-display font-semibold text-slate-100">Settings</h1>
              <p className="text-slate-400 text-sm mt-0.5">Your name, login, and how TCs see you.</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="shrink-0 text-sm text-slate-400 hover:text-red-300 font-medium px-3 py-1.5 rounded-lg hover:bg-red-900/20 transition"
          >
            Log out
          </button>
        </div>

        {loading ? (
          <p className="text-slate-500 text-sm">Loading…</p>
        ) : (
          <div className="space-y-6">
            {/* Profile: name + read-only email. The name shown here is the
                same user_metadata.full_name every TC's message thread and
                invite list already reads (see api/messages, api/agent-invites,
                etc.) -- changing it updates how every TC sees this agent,
                not just this page. */}
            <div className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-6">
              <h2 className="text-lg font-bold text-slate-100 mb-1">Profile</h2>
              <p className="text-sm text-slate-400 mb-5">
                This is the name your TCs see on messages, deals, and invites.
              </p>
              <form onSubmit={handleSaveName} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                    Full name
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Jane Smith"
                    className="w-full bg-slate-600 border border-slate-600 rounded-lg px-4 py-2.5 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Email</label>
                  <input
                    type="email"
                    value={email}
                    disabled
                    className="w-full bg-slate-700/50 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-500 cursor-not-allowed"
                  />
                  <p className="text-xs text-slate-500 mt-1.5">
                    This is how you log in and how TCs invite you -- contact support to change it.
                  </p>
                </div>
                {nameError && <p className="text-red-400 text-sm">{nameError}</p>}
                {nameMessage && !nameError && <p className="text-green-400 text-sm">{nameMessage}</p>}
                <button
                  type="submit"
                  disabled={savingName || fullName.trim() === savedName.trim()}
                  className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition disabled:opacity-50"
                >
                  {savingName ? 'Saving…' : 'Save name'}
                </button>
              </form>
            </div>

            {/* Password: optional -- agents can always log in with a
                passwordless emailed link instead (see /agent/login), so
                this is "set one if you'd rather not wait on email every
                time", not a requirement. */}
            <div className="bg-gradient-to-br from-slate-700/50 to-slate-800/50 border border-slate-600 rounded-lg p-6">
              <h2 className="text-lg font-bold text-slate-100 mb-1">Password</h2>
              <p className="text-sm text-slate-400 mb-5">
                Set or change your password. You can still log in with an emailed link instead, any time.
              </p>
              <form onSubmit={handleChangePassword} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                    New password
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="w-full bg-slate-600 border border-slate-600 rounded-lg px-4 py-2.5 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                    Confirm new password
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    className="w-full bg-slate-600 border border-slate-600 rounded-lg px-4 py-2.5 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                {passwordError && <p className="text-red-400 text-sm">{passwordError}</p>}
                {passwordMessage && !passwordError && <p className="text-green-400 text-sm">{passwordMessage}</p>}
                <button
                  type="submit"
                  disabled={savingPassword || !newPassword}
                  className="px-5 py-2.5 bg-slate-600 hover:bg-slate-500 border border-slate-600 text-slate-100 font-semibold rounded-lg transition disabled:opacity-50"
                >
                  {savingPassword ? 'Saving…' : 'Update password'}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
