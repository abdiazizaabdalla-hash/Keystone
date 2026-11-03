import { describe, expect, it } from 'vitest';
import { allFormSources, findFormSource, formSourcesFor, STATE_FORM_INFO } from '@/lib/stateFormSources';
import { US_STATES } from '@/lib/usStates';

describe('state forms sources', () => {
  it('covers every state except Texas (which has the live TREC list), and nothing else', () => {
    const expected = US_STATES.map((s) => s.code).filter((c) => c !== 'TX' && c !== 'DC').sort();
    const have = Object.keys(STATE_FORM_INFO).sort();
    const stateCodes = new Set(US_STATES.map((s) => s.code));
    expect(have.every((c) => stateCodes.has(c))).toBe(true);
    for (const c of expected) expect(have, `missing ${c}`).toContain(c);
    expect(have).not.toContain('TX');
  });

  it('has unique ids, whole https links, and no tracking parameters', () => {
    const all = allFormSources();
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    for (const s of all) {
      expect(s.url, s.id).toMatch(/^https:\/\//);
      expect(s.url, s.id).not.toMatch(/utm_|\s/);
      expect(() => new URL(s.url), s.id).not.toThrow();
      expect(s.id.startsWith(`${s.state.toLowerCase()}-`), s.id).toBe(true);
    }
  });

  it('keeps each state’s tier honest about its sources', () => {
    for (const [code, info] of Object.entries(STATE_FORM_INFO)) {
      const kinds = info.sources.map((s) => s.type);
      if (info.tier === 'contracts' || info.tier === 'disclosures') expect(kinds, code).toContain('state');
      if (info.tier === 'none') expect(info.sources, code).toHaveLength(0);
      if (info.tier === 'association') expect(info.sources.length, code).toBeGreaterThan(0);
      expect(info.summary.length, code).toBeGreaterThan(20);
    }
  });

  it('finds a source by id', () => {
    expect(findFormSource('co-dre')?.state).toBe('CO');
    expect(findFormSource('nope')).toBeUndefined();
    expect(formSourcesFor('CO').length).toBeGreaterThan(0);
    expect(formSourcesFor('XX')).toEqual([]);
  });
});
