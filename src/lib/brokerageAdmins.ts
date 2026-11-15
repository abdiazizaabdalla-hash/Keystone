import type { Tier } from './tiers';
import { BROKERAGE_LIMITS, brokerageHas } from './tiers';

// Administrators of a brokerage, and what each role may do. Pure (no database), shared by the server and the screens.
// The owner always has every scope. An administrator never changes the owner's plan, billing or account, and cannot add other
// administrators, and commissions and shared templates stay with the owner for now.

export type AdminRole = 'viewer' | 'reviewer' | 'manager';
export type AdminScope = 'view' | 'compliance' | 'roster';

export const ADMIN_ROLES: { id: AdminRole; label: string; blurb: string; scopes: AdminScope[] }[] = [
  { id: 'viewer', label: 'Viewer', blurb: 'Sees the dashboard, every agent’s deals and listings, file review and reports. Cannot change anything.', scopes: ['view'] },
  { id: 'reviewer', label: 'Compliance reviewer', blurb: 'Everything a Viewer sees, and can mark files reviewed or flagged and set the required documents.', scopes: ['view', 'compliance'] },
  { id: 'manager', label: 'Manager', blurb: 'All of the above, plus invite, resend and remove agents. Not commissions, billing or other administrators.', scopes: ['view', 'compliance', 'roster'] },
];

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === 'string' && ADMIN_ROLES.some((r) => r.id === value);
}

export function scopesFor(role: AdminRole): AdminScope[] {
  return ADMIN_ROLES.find((r) => r.id === role)?.scopes ?? [];
}

export const roleLabel = (role: string) => ADMIN_ROLES.find((r) => r.id === role)?.label ?? role;

export function roleAllows(role: AdminRole, scope: AdminScope): boolean {
  return scopesFor(role).includes(scope);
}

/** How many extra administrators a tier may have. */
export function adminLimit(tier: Tier): number {
  return brokerageHas(tier, 'multiple_administrators') ? BROKERAGE_LIMITS[tier].extraAdministrators : 0;
}

/** Roles a tier may hand out: Basic gets one full administrator; scoped roles are part of Pro. */
export function allowedRoles(tier: Tier): AdminRole[] {
  return brokerageHas(tier, 'advanced_permissions') ? ADMIN_ROLES.map((r) => r.id) : ['manager'];
}

export const normaliseAdminEmail = (email: string) => email.trim().toLowerCase();
export const looksLikeEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
