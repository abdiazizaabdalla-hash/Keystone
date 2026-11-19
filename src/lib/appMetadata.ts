// Pure readers for the server-only app_metadata blob (no database or network imports,
// so they can be unit tested and used anywhere). See privileged.ts for why
// permission-relevant facts live in app_metadata and never in user_metadata.
export interface WithAppMetadata {
  app_metadata?: Record<string, unknown> | null;
}

export function getUserPlan(user: WithAppMetadata | null | undefined): string | undefined {
  const plan = user?.app_metadata?.plan;
  return typeof plan === 'string' ? plan : undefined;
}

export function isPlatformAdmin(user: WithAppMetadata | null | undefined): boolean {
  return user?.app_metadata?.is_admin === true;
}

export function hasAgentRole(user: WithAppMetadata | null | undefined): boolean {
  return user?.app_metadata?.role === 'agent';
}
