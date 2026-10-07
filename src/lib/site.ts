/**
 * Public contact details used on the legal pages and in account emails.
 * Change SUPPORT_EMAIL here once a real shared inbox exists (the legal pages,
 * deletion-request emails and footer all read this one constant).
 */
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'relaytransactions@gmail.com';

/** Bump when the Terms or Privacy Policy change in a way users should re-accept. */
export const LEGAL_VERSION = '2026-10-07';
