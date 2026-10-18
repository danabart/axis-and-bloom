// Cupping evidence brief 4, Part D (2026-10-18): composeBasis test vectors.
// Pure: fixtures shaped like the v_evidence_archetype / _archetype_call rows
// (brief 2 data where it matters). The same vectors run against the frontend
// copy (frontend/src/app/lib/evidenceBasis.test.ts).
import { describe, it, expect } from 'vitest';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import * as backendBasis from './evidenceBasis.js';
import type { BasisInput } from './evidenceBasis.js';

// The frontend copy (frontend/src/app/lib/evidenceBasis.ts), loaded by a path
// built at run time so the backend tsc build never compiles it. Every vector
// below runs against both copies.
const frontendPath = path.resolve(process.cwd(), '..', 'frontend', 'src', 'app', 'lib', 'evidenceBasis.ts');
const frontendBasis = (await import(pathToFileURL(frontendPath).href)) as typeof backendBasis;

const call = (cupper_id: number, cupper_name: string, archetype_call: string | null, session_id = 37) => ({ cupper_id, cupper_name, session_id, archetype_call });
const row = (over: Partial<BasisInput['archetype']> = {}): BasisInput['archetype'] => ({
  assigned_from_session_id: 37, latest_session_id: 37, is_blind: true, roaster_present: false,
  roaster_form_proposal: null, roaster_remark_proposals: null, ...over,
});

// Joe Bean Blossom (s37, blind): Dana earthy, Camila no call; roaster form chocolate_nutty.
const blossom: BasisInput = {
  archetype: row({ roaster_form_proposal: 'chocolate_nutty' }),
  calls: [call(2, 'Camila', null), call(1, 'Dana', 'earthy')],
  roasterForm: { version: 1, respondent: 'Kathy Turiano' },
  website: ['Dark Chocolate', 'Campfire', 'Molasses', 'Smoke'],
};
// Geometric as the brief describes it: both cuppers and the roaster on balanced_sweet.
const geometricAllAgree: BasisInput = {
  archetype: row({ roaster_form_proposal: 'balanced_sweet' }),
  calls: [call(1, 'Dana', 'balanced_sweet'), call(2, 'Camila', 'balanced_sweet')],
  roasterForm: { version: 1, respondent: 'Kathy Turiano' },
};
// Joe Coffee La Familia (s36, roaster at the table): Dana balanced_sweet, roaster form floral.
const laFamilia: BasisInput = {
  archetype: row({ assigned_from_session_id: 36, latest_session_id: 36, is_blind: false, roaster_present: true, roaster_form_proposal: 'floral', roaster_remark_proposals: ['floral'] }),
  calls: [call(1, 'Dana', 'balanced_sweet', 36)],
  roasterForm: { version: 1, respondent: 'Natalie' },
};
// Utopian Union (s35): both cuppers struck their word, so no call from either.
const union: BasisInput = {
  archetype: row({ assigned_from_session_id: 35, latest_session_id: 35, is_blind: false, roaster_form_proposal: 'balanced_sweet' }),
  calls: [call(1, 'Dana', null, 35), call(2, 'Camila', null, 35)],
  roasterForm: { version: 1, respondent: null },
  website: ['Smooth', 'caramel sauce', 'buttered pastry', 'pistachio'],
};

describe.each([['backend', backendBasis], ['frontend', frontendBasis]] as const)('composeBasis (%s copy)', (_copy, mod) => {
  const { composeBasis, finalizeBasis, ruleRequired, bandCheck } = mod;
  it('Blossom: every source differs, so the rule is required; the text names both cuppers and the roaster', () => {
    const { text, json } = composeBasis(blossom);
    expect(text).toBe('basis: cupping s37 (Dana=earthy, Camila=no call; blind); roaster form v1 (Kathy Turiano)=chocolate_nutty; roaster remarks=none; website=Dark Chocolate, Campfire, Molasses');
    expect(json.calls).toEqual({ Dana: 'earthy', Camila: null });
    expect(ruleRequired(blossom, 'earthy')).toBe(true);
    expect(ruleRequired(blossom, 'chocolate_nutty')).toBe(true);
  });

  it('Geometric (all agree): no rule needed, the line ends with "rule: confirmed"', () => {
    expect(ruleRequired(geometricAllAgree, 'balanced_sweet')).toBe(false);
    const done = finalizeBasis(composeBasis(geometricAllAgree), '');
    expect(done.note.endsWith('; rule: confirmed')).toBe(true);
    expect(done.json.rule).toBe('confirmed');
  });

  it('La Familia: one cupper balanced_sweet, roaster floral, chosen floral: rule required, the composed part names both', () => {
    const { text } = composeBasis(laFamilia);
    expect(text).toContain('Dana=balanced_sweet');
    expect(text).toContain('roaster form v1 (Natalie)=floral');
    expect(text).toContain('roaster remarks=floral');
    expect(text).toContain('not blind, roaster present');
    expect(ruleRequired(laFamilia, 'floral')).toBe(true);
  });

  it('Union: both calls null, "no call" for both, rule required', () => {
    const { text, json } = composeBasis(union);
    expect(text).toContain('(Dana=no call, Camila=no call; not blind)');
    expect(text).toContain('roaster form v1=balanced_sweet');
    expect(json.calls).toEqual({ Dana: null, Camila: null });
    expect(ruleRequired(union, 'balanced_sweet')).toBe(true);
  });

  it('a coffee only one cupper cupped: the other cupper is absent from the text and the json', () => {
    const one: BasisInput = { archetype: row({ is_blind: false, roaster_form_proposal: 'chocolate_nutty', roaster_remark_proposals: ['chocolate_nutty'] }), calls: [call(1, 'Dana', 'chocolate_nutty', 36)], roasterForm: { version: 1, respondent: 'Natalie' } };
    const { text, json } = composeBasis(one);
    expect(text).not.toContain('Camila');
    expect(Object.keys(json.calls)).toEqual(['Dana']);
    expect(ruleRequired(one, 'chocolate_nutty')).toBe(false);
  });

  it('a placement out of band appends the merged range and the band, and requires the rule', () => {
    const placed: BasisInput = {
      ...geometricAllAgree,
      placement: { slotId: 4, dimensionId: 5, dimensionName: 'Acidity', mergedMin: 1, mergedMax: 7, mergedSessionId: 37, bandLo: 8, bandHi: 11 },
    };
    const { text, json } = composeBasis(placed);
    expect(text.endsWith('; merged Acidity 1-7 vs band 8-11 (out_of_band)')).toBe(true);
    expect(json.band).toEqual({ slot_id: 4, lo: 8, hi: 11, check: 'out_of_band' });
    expect(json.merged_range).toEqual({ dimension_id: 5, min: 1, max: 7, session_id: 37 });
    expect(ruleRequired(placed, 'balanced_sweet', json.band!.check)).toBe(true);
    expect(composeBasis({ ...placed, placement: { ...placed.placement!, bandLo: null, bandHi: null } }).text).toContain('vs band none (no_band)');
  });

  it('a third cupper row appears in the text and the json with no code change', () => {
    const three: BasisInput = { ...geometricAllAgree, calls: [...geometricAllAgree.calls, call(3, 'Zzz Cupper C', 'fruity')] };
    const { text, json } = composeBasis(three);
    expect(text).toContain('Dana=balanced_sweet, Camila=balanced_sweet, Zzz Cupper C=fruity');
    expect(json.calls['Zzz Cupper C']).toBe('fruity');
    expect(ruleRequired(three, 'balanced_sweet')).toBe(true);
  });

  it('a coffee nobody cupped says "cupping: none" and needs the rule', () => {
    const none: BasisInput = { archetype: row({ assigned_from_session_id: null, latest_session_id: null, is_blind: null }), calls: [] };
    const { text, json } = composeBasis(none);
    expect(text.startsWith('basis: cupping: none; roaster form: none; roaster remarks=none; website=none')).toBe(true);
    expect(json.sessions).toEqual([]);
    expect(ruleRequired(none, 'fruity')).toBe(true);
  });

  it('is deterministic, one line, and the json round-trips', () => {
    const a = composeBasis({ ...blossom, website: ['line\nbreak', '  spaced  out '] });
    const b = composeBasis({ ...blossom, website: ['line\nbreak', '  spaced  out '] });
    expect(a).toEqual(b);
    expect(a.text).not.toMatch(/[\r\n]/);
    expect(finalizeBasis(a, 'roast-driven\nfamily').note).not.toMatch(/[\r\n]/);
    expect(JSON.parse(JSON.stringify(a.json))).toEqual(a.json);
  });

  it('bandCheck: in band, out of band, no band, no merged range', () => {
    expect(bandCheck(5, 7, 4, 8)).toBe('in_band');
    expect(bandCheck(1, 3, 4, 8)).toBe('out_of_band');
    expect(bandCheck(1, 3, null, null)).toBe('no_band');
    expect(bandCheck(null, null, 4, 8)).toBe('no_merged_range');
  });

  it('names no cupper in its own source', async () => {
    const { readFileSync } = await import('node:fs');
    // composeBasis (both copies) and the workbench page name no cupper: labels come from the rows
    const files = [
      new URL('./evidenceBasis.ts', import.meta.url),
      pathToFileURL(frontendPath),
      pathToFileURL(path.resolve(process.cwd(), '..', 'frontend', 'src', 'app', 'components', 'admin', 'AdminCalibrationWorkbench.tsx')),
    ];
    const { db } = await import('../db/client.js');
    const cuppers = (await db.query<{ name: string }>(`SELECT name FROM cupper`)).rows.map(r => r.name);
    const { existsSync } = await import('node:fs');
    for (const f of files.filter(x => existsSync(x))) {
      const src = readFileSync(f, 'utf8');
      for (const name of cuppers) expect(src.includes(name), `${f} names ${name}`).toBe(false);
    }
  });
});
