import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Keystone TC - Transaction Management for Coordinators',
  description: 'All-in-one platform for transaction coordinators',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
        <div className="flex flex-col min-h-screen">
          {/* Navigation */}
          <nav className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-50">
            <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-gradient-to-br from-amber-400 to-amber-600 rounded-lg flex items-center justify-center">
                  <span className="text-sm font-bold text-slate-950">K</span>
                </div>
                <span className="text-lg font-bold bg-gradient-to-r from-amber-400 to-amber-200 bg-clip-text text-transparent">
                  Keystone TC
                </span>
              </div>
              <div className="flex items-center gap-6">
                <a href="/" className="text-sm text-slate-300 hover:text-amber-400 transition">
                  Dashboard
                </a>
                <a href="/transactions" className="text-sm text-slate-300 hover:text-amber-400 transition">
                  Transactions
                </a>
                <a href="/invoices" className="text-sm text-slate-300 hover:text-amber-400 transition">
                  Invoices
                </a>
                <div className="w-8 h-8 bg-gradient-to-br from-slate-700 to-slate-800 rounded-full flex items-center justify-center text-xs font-bold">
                  TC
                </div>
              </div>
            </div>
          </nav>

          {/* Main Content */}
          <main className="flex-1">
            {children}
          </main>

          {/* Footer */}
          <footer className="border-t border-slate-800 bg-slate-950/50 mt-12">
            <div className="max-w-7xl mx-auto px-6 py-8 text-center text-sm text-slate-400">
              <p>Keystone TC © {new Date().getFullYear()} • Built for Transaction Coordinators</p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
