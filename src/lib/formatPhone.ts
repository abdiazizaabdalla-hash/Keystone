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
