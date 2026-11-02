import type { Metadata } from 'next';
import './globals.css';
import SiteAnalytics from '@/components/SiteAnalytics';
import GlobalFileDrop from '@/components/GlobalFileDrop';

export const metadata: Metadata = {
  title: 'Relay TC - Transaction coordination for agents and coordinators',
  description: 'Manage every real estate transaction from contract to closing. Work with your TC, or let Relay handle the coordination.',
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
