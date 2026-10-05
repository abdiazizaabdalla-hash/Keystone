'use client';

import { useCallback, useState, type ReactNode } from 'react';

// A text + screenshot row for the marketing pages. The screenshot file
// lives in public/screenshots/ -- if it isn't there yet (a section can
// be written before its screenshot is taken), the image and its column
// disappear and the text simply runs on its own, with no broken-image
// icon or empty frame. Dropping the file in is all it takes to make it
// appear.
export default function ShotRow({
  children,
  name,
  alt,
  caption,
  reverse = false,
  wide = false,
}: {
  children: ReactNode;
  name: string;
  alt: string;
  caption?: string;
  reverse?: boolean;
  // Wide, short screenshots (a strip across the dashboard, a single card)
  // get a bigger share of the row so their text stays readable.
  wide?: boolean;
}) {
  const [missing, setMissing] = useState(false);

  // A failed load can settle before React attaches onError, so also
  // check the already-finished state when the node mounts.
  const imgRef = useCallback((img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth === 0) setMissing(true);
  }, []);

  return (
    <div
      className={
        missing
          ? 'max-w-2xl'
          : `grid gap-12 items-center ${wide ? (reverse ? 'lg:grid-cols-[7fr_5fr]' : 'lg:grid-cols-[5fr_7fr]') : 'lg:grid-cols-2'}`
      }
    >
      <div className={reverse ? 'lg:order-2' : ''}>{children}</div>
      {!missing && (
        <figure className={reverse ? 'lg:order-1' : ''}>
          <div className="rounded-xl border border-slate-700 overflow-hidden shadow-2xl bg-slate-800">
            <img
              ref={imgRef}
              src={`/screenshots/${name}`}
              alt={alt}
              onError={() => setMissing(true)}
              className="w-full h-auto block"
            />
          </div>
          {caption && <figcaption className="text-xs text-slate-500 mt-3">{caption}</figcaption>}
        </figure>
      )}
    </div>
  );
}
