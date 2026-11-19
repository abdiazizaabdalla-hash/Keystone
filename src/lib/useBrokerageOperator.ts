'use client';

import { useBrokerageOwner } from './useBrokerageOwner';
import { useBrokerageAdminAccess } from './useBrokerageAdminAccess';

// Presentation only: does this person run a brokerage like its owner, because they are the owner or a managing account the owner added?
// null while finding out. The server checks the role again on every request.
export function useBrokerageOperator(): boolean | null {
  const owner = useBrokerageOwner();
  const admin = useBrokerageAdminAccess();
  if (owner === true) return true;
  if (owner === null || admin === null) return null;
  return admin.delegated === true && admin.scopes?.includes('full') === true;
}
