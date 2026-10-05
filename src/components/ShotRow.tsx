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
  stacked = false,
}: {
  children: ReactNode;
  name: string;
  alt: string;
  caption?: string;
  reverse?: boolean;
  // Wide, short screenshots (dashboard strips, single cards) are unreadable
  // squeezed into half a row, so stacked puts the text above and the image
  // below it, full width.
  stacked?: boolean;
}) {
  const [missing, setMissing] = useState(false);

  // A failed load can settle before React attaches onError, so also
  // check the already-finished state when the node mounts.
  const imgRef = useCallback((img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth === 0) setMissing(true);
  }, []);

  if (stacked) {
    return (
      <div>
        <div className="max-w-2xl mx-auto">{children}</div>
        {!missing && (
          <figure className="max-w-4xl mx-auto mt-10">
            <div className="rounded-xl border border-slate-700 overflow-hidden shadow-2xl bg-slate-800">
              <img
                ref={imgRef}
                src={`/screenshots/${name}`}
                alt={alt}
                onError={() => setMissing(true)}
                className="w-full h-auto block"
              />
            </div>
            {caption && <figcaption className="text-xs text-slate-500 mt-3 text-center">{caption}</figcaption>}
          </figure>
        )}
      </div>
    );
  }

  return (
    <div className={missing ? 'max-w-2xl' : 'grid lg:grid-cols-2 gap-12 items-center'}>
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
          {caption && <figcaption className="text-xs text-slate-500 mt-3 text-center">{caption}</figcaption>}
        </figure>
      )}
    </div>
  );
}
