import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen px-6 py-12 flex items-center justify-center">
      <div className="max-w-2xl text-center">
        <div className="mb-8">
          <h1 className="text-6xl font-bold bg-gradient-to-r from-amber-400 to-amber-200 bg-clip-text text-transparent mb-2">
            404
          </h1>
          <p className="text-2xl font-bold text-slate-100 mb-4">Page not found</p>
          <p className="text-slate-400 mb-8">
            The page you're looking for doesn't exist. It might have been moved or deleted.
          </p>
        </div>
        <Link
          href="/"
          className="inline-block px-8 py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-semibold rounded-lg transition shadow-lg hover:shadow-amber-500/50"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}
