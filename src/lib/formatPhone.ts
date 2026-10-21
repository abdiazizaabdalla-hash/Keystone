/**
 * Formats a US phone number for display with standard dash/parenthesis
 * separation, e.g. "5127136414" -> "(512) 713-6414" and
 * "15127136414" -> "+1 (512) 713-6414". Falls back to returning the
 * original (trimmed) value unchanged for anything that isn't a
 * recognizable 10- or 11-digit US number (international numbers,
 * extensions, partial input, etc.) rather than mangling it.
 */
export function formatPhoneNumber(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');

  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    const d = digits.slice(1);
    return `+1 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return trimmed;
}

/**
 * As-you-type US phone formatting for form fields: "5125550123" -> "(512) 555-0123". A leading 1 or +1
 * is dropped (area codes never start with 1), and extra digits are ignored. Anything that is clearly
 * not a plain US number (letters such as "ext" or "x", or a + country code other than +1) is left
 * exactly as typed, so international numbers and extensions are never cut short.
 */
export function formatPhoneInput(value: string | null | undefined): string {
  const v = value ?? '';
  if (/[a-z]/i.test(v) || /^\s*\+(?!1(\D|$))/.test(v)) return v.slice(0, 40);
  const digits = v.replace(/\D/g, '').replace(/^1/, '').slice(0, 10);
  if (digits.length === 0) return '';
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
