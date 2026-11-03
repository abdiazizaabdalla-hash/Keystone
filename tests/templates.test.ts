import { describe, expect, it } from 'vitest';
import { isStateCode, stateFromAddress, templateFitsState, US_STATES } from '@/lib/usStates';
import { fieldsUsed, MERGE_FIELDS, renderTemplate } from '@/lib/templateMerge';
import { STARTER_TEMPLATES } from '@/lib/templateStarters';

describe('states', () => {
  it('has 50 states plus DC', () => {
    expect(US_STATES).toHaveLength(51);
    expect(isStateCode('TX')).toBe(true);
    expect(isStateCode('tx')).toBe(false);
    expect(isStateCode('ZZ')).toBe(false);
  });

  it('reads the state from a typed address', () => {
    expect(stateFromAddress('12 Oak St, Austin, TX 78701')).toBe('TX');
    expect(stateFromAddress('12 Oak St, Austin, TX')).toBe('TX');
    expect(stateFromAddress('9 Elm Ave, Denver CO 80202-1234')).toBe('CO');
    expect(stateFromAddress('221B Baker Street')).toBeNull();
    expect(stateFromAddress('5 Main St, Nowhere, ZZ 12345')).toBeNull();
    expect(stateFromAddress(null)).toBeNull();
  });

  it('fits a template to a deal state', () => {
    expect(templateFitsState([], 'TX')).toBe(true);
    expect(templateFitsState(['TX', 'OK'], 'TX')).toBe(true);
    expect(templateFitsState(['TX'], 'CA')).toBe(false);
    expect(templateFitsState(['TX'], null)).toBe(true);
  });
});

describe('merge fields', () => {
  it('fills known fields and reports the ones with no value', () => {
    const out = renderTemplate('Hi {{client_first_name}}, closing {{ closing_date }} at {{property_address}}.', { client_first_name: 'Sam', closing_date: 'June 3' });
    expect(out.text).toBe('Hi Sam, closing June 3 at .');
    expect(out.missing).toEqual(['property_address']);
  });

  it('leaves unknown braces exactly as typed', () => {
    expect(renderTemplate('Keep {{not_a_field}} here', {}).text).toBe('Keep {{not_a_field}} here');
  });

  it('lists the fields a template uses', () => {
    expect(fieldsUsed('{{client_name}} {{client_name}} {{bogus}} {{today}}').sort()).toEqual(['client_name', 'today']);
  });
});

describe('starter templates', () => {
  const known = new Set<string>(MERGE_FIELDS.map((f) => f.key));
  it('have unique keys and only use real merge fields', () => {
    expect(new Set(STARTER_TEMPLATES.map((t) => t.key)).size).toBe(STARTER_TEMPLATES.length);
    for (const t of STARTER_TEMPLATES) {
      for (const f of fieldsUsed(`${t.subject ?? ''} ${t.body}`)) expect(known.has(f), `${t.key} uses ${f}`).toBe(true);
    }
  });
});
