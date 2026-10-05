'use client';

import { useCallback, useState } from 'react';

// A marketing screenshot that quietly disappears if its file isn't in
// public/screenshots/ yet. The landing page is written with slots for
// screenshots that haven't been taken -- dropping the file in is all it
// takes to make it appear; until then the page just reads as text, with
// no broken-image icon or empty frame.
export default function Shot({
  name,
  alt,
  caption,
  className = '',
}: {
  name: string;
  alt: string;
  caption?: string;
  className?: string;
}) {
  const [missing, setMissing] = useState(false);

  // The server-rendered <img> can fail before React hydrates and attaches
  // onError, so also check the already-settled state when the node mounts.
  const imgRef = useCallback((img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth === 0) setMissing(true);
  }, []);

  if (missing) return null;

  return (
    <figure className={className}>
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
  );
}
