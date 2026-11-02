'use client';

import { useState } from 'react';

// The For Teams workflow video. Nothing downloads until the visitor presses play (only the small poster loads).
export default function TeamsVideo({ src, poster, length }: { src: string; poster: string; length: string }) {
  const [started, setStarted] = useState(false);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl shadow-blue-500/10">
      {started ? (
        <video
          className="absolute inset-0 h-full w-full"
          src={src}
          poster={poster}
          controls
          autoPlay
          playsInline
          preload="auto"
          aria-label={`Relay TC for teams, ${length}`}
        />
      ) : (
        <button
          type="button"
          onClick={() => setStarted(true)}
          className="group absolute inset-0 block h-full w-full"
          aria-label={`Play the For Teams walkthrough, ${length}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={poster}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
          />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-blue-500 text-white shadow-xl shadow-blue-500/30 ring-8 ring-white/10 transition group-hover:scale-105 group-hover:bg-blue-400">
              <svg className="ml-1 h-8 w-8" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
                <path d="M6.3 3.7a1 1 0 011.5-.86l9 6.3a1 1 0 010 1.72l-9 6.3A1 1 0 016.3 16.3V3.7z" />
              </svg>
            </span>
          </span>
          <span className="absolute bottom-4 left-4 rounded-full bg-slate-900/80 px-3 py-1 text-xs font-medium text-slate-100 backdrop-blur">
            {length}
          </span>
        </button>
      )}
    </div>
  );
}
