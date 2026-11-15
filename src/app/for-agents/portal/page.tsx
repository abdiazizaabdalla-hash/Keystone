import { redirect } from 'next/navigation';

// The free agent login is explained on the coordinator page.
export default function PortalRedirect() {
  redirect('/for-tcs#agent-portal');
}
