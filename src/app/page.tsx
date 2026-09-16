import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-6xl mx-auto px-8 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Keystone</h1>
          <nav className="flex gap-6">
            <Link href="/" className="hover:text-blue-400">
              Home
            </Link>
            <Link href="/transactions" className="hover:text-blue-400">
              Transactions
            </Link>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-8 py-16">
        <div className="text-center">
          <h2 className="text-5xl font-bold mb-4">Welcome to Keystone</h2>
          <p className="text-xl text-gray-400 mb-8">
            Transaction management for real estate professionals
          </p>
          <Link
            href="/transactions"
            className="inline-block bg-blue-600 hover:bg-blue-700 px-8 py-3 rounded-lg font-semibold"
          >
            View Transactions
          </Link>
        </div>
      </main>
    </div>
  );
}
