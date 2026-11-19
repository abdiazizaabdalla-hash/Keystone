import { describe, expect, it, vi } from 'vitest';

// Read-only mode (npm run dev:prod-readonly): the server's database clients refuse anything that could change data.
describe('read-only live mode', () => {
  it('blocks writes but allows reads and sign-in', async () => {
    vi.resetModules();
    vi.stubEnv('RELAY_PROD_READONLY', '1');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service');
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(`${(init?.method || 'GET')} ${typeof input === 'string' ? input : (input as Request).url ?? String(input)}`);
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const { supabaseServer } = await import('@/lib/supabase');
    const read = await supabaseServer.from('transactions').select('id').limit(1);
    expect(read.error).toBeNull();
    const write = await supabaseServer.from('transactions').update({ status: 'x' }).eq('id', '1');
    expect(write.error?.message).toMatch(/Read-only mode/);
    const del = await supabaseServer.from('transactions').delete().eq('id', '1');
    expect(del.error?.message).toMatch(/Read-only mode/);
    expect(seen.some((s) => s.startsWith('PATCH') || s.startsWith('DELETE'))).toBe(false);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
});
