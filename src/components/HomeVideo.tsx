'use client';

import { useRef, useState } from 'react';

// The homepage demo video. Nothing is downloaded until the visitor presses play (only the small poster image loads),
// so it costs the page nothing. After the click it plays with sound and the normal browser controls.
export default function HomeVideo() {
  const [started, setStarted] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl shadow-blue-500/10">
      {started ? (
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full"
          src="/video/relay-tc-demo.mp4"
          poster="/video/relay-tc-demo-poster-v3.jpg"
          controls
          autoPlay
          playsInline
          preload="auto"
          aria-label="Relay TC product video, about one minute"
        />
      ) : (
        <button
          type="button"
          onClick={() => setStarted(true)}
          className="group absolute inset-0 block h-full w-full"
          aria-label="Play the Relay TC video, about one minute"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/video/relay-tc-demo-poster-v3.jpg"
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
            1 min · with sound
          </span>
        </button>
      )}
    </div>
  );
}
