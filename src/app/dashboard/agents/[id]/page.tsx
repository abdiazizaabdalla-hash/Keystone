'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authFetch, AuthRequiredError } from '@/lib/authClient';

// An agent's profile is their Contacts record: this page finds (or creates) the one contact
// for the agent, then opens it, so an agent never has two disconnected records.
export default function AgentProfileRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await authFetch(`/api/agents/${id}/contact`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not open this agent');
        if (!cancelled) router.replace(`/dashboard/contacts/${data.contactId}`);
      } catch (err) {
        if (err instanceof AuthRequiredError) {
          router.push('/auth');
          return;
        }
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not open this agent');
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [id, router]);

  return (
    <div className="p-4 md:p-8">
      {error ? (
        <>
          <p className="text-red-400 mb-3">{error}</p>
          <Link href="/dashboard/agents" className="text-blue-400 hover:text-blue-300 text-sm">
            Back to agents
          </Link>
        </>
      ) : (
        <p className="text-slate-400">Opening profile…</p>
      )}
    </div>
  );
}
