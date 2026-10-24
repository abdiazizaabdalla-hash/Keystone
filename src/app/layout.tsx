import type { Metadata } from 'next';
import './globals.css';
import SiteAnalytics from '@/components/SiteAnalytics';
import GlobalFileDrop from '@/components/GlobalFileDrop';

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
      <body className="app-bg text-slate-100">
        {children}
        <SiteAnalytics />
        <GlobalFileDrop />
      </body>
    </html>
  );
}
