import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROUTES, type RouteEntry } from './route-registry';

// Safety net for a permission-heavy codebase: every API route must be listed in
// route-registry.ts with HOW it is protected, and the route's source must still
// contain that protection. A new route, a new HTTP method, or a removed guard
// fails this test until a person updates the registry on purpose.

const API_ROOT = path.resolve(__dirname, '../src/app/api');

function findRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findRouteFiles(full));
    else if (entry.name === 'route.ts') out.push(full);
  }
  return out;
}

function routeOf(file: string): string {
  return '/api/' + path.relative(API_ROOT, path.dirname(file)).split(path.sep).join('/');
}

function methodsOf(source: string): string[] {
  const found = new Set<string>();
  for (const m of source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) found.add(m[1]);
  for (const m of source.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) found.add(m[1]);
  return [...found].sort();
}

// A signed-in user is required: the shared helpers all call getUserFromRequest.
const SESSION_GUARD =
  /getUserFromRequest\(|requireListingAccess\(|requireAgentListing\(|requireContactsUser\(|loadStaffContext\(|loadAgentContext\(/;

const files = findRouteFiles(API_ROOT);
const actual = new Map(files.map((f) => [routeOf(f), fs.readFileSync(f, 'utf8')]));

describe('API route registry', () => {
  it('finds the routes', () => {
    expect(actual.size).toBeGreaterThan(100);
  });

  it('lists every route file, and nothing that no longer exists', () => {
    const unregistered = [...actual.keys()].filter((r) => !(r in ROUTES)).sort();
    const stale = Object.keys(ROUTES).filter((r) => !actual.has(r)).sort();
    expect(unregistered, 'routes missing from tests/route-registry.ts').toEqual([]);
    expect(stale, 'registry entries for routes that were removed').toEqual([]);
  });

  it('matches the HTTP methods each route exports', () => {
    const mismatches = Object.entries(ROUTES)
      .filter(([r]) => actual.has(r))
      .filter(([r, e]) => JSON.stringify([...e.methods].sort()) !== JSON.stringify(methodsOf(actual.get(r)!)))
      .map(([r, e]) => `${r}: registry ${e.methods.join(',')} vs code ${methodsOf(actual.get(r)!).join(',')}`);
    expect(mismatches).toEqual([]);
  });

  const guardChecks: Record<RouteEntry['kind'], (route: string, src: string) => boolean> = {
    session: (_r, src) => SESSION_GUARD.test(src),
    agent: (r, src) => r.startsWith('/api/agent/') && SESSION_GUARD.test(src),
    admin: (r, src) => r.startsWith('/api/admin/') && /getUserFromRequest\(/.test(src) && /isAdmin/.test(src),
    cron: (_r, src) => /CRON_SECRET/.test(src),
    webhook: (_r, src) => /constructEvent|stripe-signature/.test(src),
    token: (_r, src) => /token/i.test(src),
    'oauth-callback': (_r, src) => /state/.test(src),
    public: () => true,
    removed: (_r, src) => !/supabase/i.test(src),
  };

  it.each(Object.entries(ROUTES))('%s still has the protection its kind promises', (route, entry) => {
    const src = actual.get(route);
    expect(src, `${route} is in the registry but has no route.ts`).toBeDefined();
    expect(guardChecks[entry.kind](route, src!), `${route} is registered as "${entry.kind}" but its code no longer shows that guard`).toBe(true);
  });

  it('requires a written reason for every route that is not session-protected', () => {
    const missing = Object.entries(ROUTES)
      .filter(([, e]) => !['session', 'agent', 'admin'].includes(e.kind) && !e.why)
      .map(([r]) => r);
    expect(missing).toEqual([]);
  });

  it('rate limits every public or token route that accepts writes', () => {
    const notLimited = Object.entries(ROUTES)
      .filter(([, e]) => (e.kind === 'public' || e.kind === 'token') && e.methods.some((m) => m !== 'GET'))
      .filter(([r]) => !/checkRateLimit\(/.test(actual.get(r) ?? ''))
      .map(([r]) => r);
    expect(notLimited).toEqual([]);
  });

  it('keeps all admin routes under /api/admin', () => {
    const wrong = Object.entries(ROUTES).filter(([r, e]) => e.kind === 'admin' && !r.startsWith('/api/admin/'));
    expect(wrong).toEqual([]);
  });

  // A free agent portal login must not be able to create or change a coordinator's
  // own work. Every writing route for signed-in users therefore either refuses
  // collaborators (a guard below), or is registered with a written reason.
  const COLLABORATOR_GUARD =
    /assertTrialActive\(|assertNotCollaborator\(|isAgentUser\(|isCollaboratorOnly\(|hasAgentRole\(|requireContactsUser\(|requireListingAccess\(|requireAgentListing\(|loadAgentContext\(|loadStaffContext\(/;

  it('guards every writing session route against free agent portal logins, or explains why not', () => {
    const open = Object.entries(ROUTES)
      .filter(([, e]) => e.kind === 'session' && e.methods.some((m) => m !== 'GET'))
      .filter(([r, e]) => !COLLABORATOR_GUARD.test(actual.get(r) ?? '') && !e.collaboratorWrites)
      .map(([r]) => r);
    expect(open, 'add assertNotCollaborator(user) to these routes, or register a collaboratorWrites reason').toEqual([]);
  });
});
