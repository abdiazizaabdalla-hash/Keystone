import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-slate-900 px-6 py-12 flex items-center justify-center">
      <div className="max-w-md text-center">
        <span className="w-14 h-14 bg-white rounded-xl flex items-center justify-center p-2.5 shadow-sm mx-auto mb-8">
          <img src="/relay-icon.png" alt="Relay TC" className="w-full h-full object-contain" />
        </span>
        <h1 className="text-3xl font-display font-semibold text-slate-100 mb-3">Page not found</h1>
        <p className="text-slate-400 mb-8">
          The page you&apos;re looking for doesn&apos;t exist. It might have been moved or deleted.
        </p>
        <Link
          href="/"
          className="inline-block px-8 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-semibold rounded-lg transition"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
