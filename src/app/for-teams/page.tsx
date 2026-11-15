import { redirect } from 'next/navigation';

// Teams are part of the coordinator page now.
export default function ForTeamsRedirect() {
  redirect('/for-tcs#teams');
}
