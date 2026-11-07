// The logo block at the top of a generated PDF. Pushes the rest of the header down by `LOGO_SHIFT` when there is a logo.

export const LOGO_SHIFT = 54;

type LogoDoc = { image: (src: Buffer, x: number, y: number, options?: { fit?: [number, number] }) => unknown };

/** Draws the logo top-left, scaled to fit a 170x44 box, and returns how far the rest of the header must move down (0 with no logo). */
export function drawLogo(doc: LogoDoc, logo: Buffer | null | undefined, x = 56, y = 40): number {
  if (!logo) return 0;
  try {
    doc.image(logo, x, y, { fit: [170, 44] });
    return LOGO_SHIFT;
  } catch {
    return 0; // an image that can't be read is skipped, not a failed PDF
  }
}
