'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen px-6 py-12 flex items-center justify-center">
      <div className="max-w-2xl">
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-8 text-center">
          <div className="w-16 h-16 bg-red-900/50 rounded-lg flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-400" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-red-300 mb-2">Something went wrong</h1>
          <p className="text-red-200 mb-6">{error.message || 'An unexpected error occurred'}</p>
          <button
            onClick={() => reset()}
            className="px-6 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-semibold rounded-lg transition"
          >
            Try Again
          </button>
        </div>
      </div>
    </div>
  );
}
