import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Relay TC - Transaction Management for Coordinators',
  description: 'All-in-one platform for transaction coordinators',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-100">
        {children}
      </body>
    </html>
  );
}
