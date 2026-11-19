// What a logo upload may be. PDF files take PNG and JPEG only.
export const MAX_LOGO_BYTES = 1024 * 1024;

export type LogoKind = 'png' | 'jpeg';

/** Which image format these bytes really are, from the file header (a file's name or declared type can't be trusted). */
export function sniffLogo(bytes: Uint8Array): LogoKind | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  return null;
}
