import { authFetch } from './authClient';

/** Open a commission statement PDF in a new tab (the request needs the sign-in header, so it cannot be a plain link). */
export async function openStatement(id: string): Promise<void> {
  const win = window.open('', '_blank');
  try {
    const res = await authFetch(`/api/commissions/${id}/statement`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not open the statement');
    const url = URL.createObjectURL(await res.blob());
    if (win) win.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    win?.close();
    throw error;
  }
}
