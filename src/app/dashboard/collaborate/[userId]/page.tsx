import { redirect } from 'next/navigation';

// The per-teammate drill-down was removed: each coordinator's deals, agents and contacts stay private to
// their own login, including from the team owner. Old links land back on the roster.
export default function CollaborateMemberPage() {
  redirect('/dashboard/collaborate');
}
