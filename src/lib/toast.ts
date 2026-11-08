// A small message at the top of the screen (a success, a big moment such as an invoice being paid). Anything can call showToast;
// <ToastHost /> (mounted once in each layout) displays it.

export type ToastTone = 'success' | 'info' | 'warning';

export interface ToastInput {
  title: string;
  body?: string;
  tone?: ToastTone;
  /** A page to open when the toast is clicked. */
  href?: string;
  /** Label for the click target when there is a href. */
  actionLabel?: string;
  /** How long it stays, in milliseconds. */
  durationMs?: number;
}

export const TOAST_EVENT = 'relay:toast';
export const NOTIFICATIONS_EVENT = 'relay:notifications';
export const STRIPE_CONNECTED_EVENT = 'relay:stripe-connected';

export function showToast(toast: ToastInput): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: toast }));
}
