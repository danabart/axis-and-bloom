// Cupping evidence brief 4, Part B (2026-10-18): the frontend copy of
// backend/src/services/evidenceBasis.ts (no shared package). Identical below
// this header; backend/src/services/evidenceBasis.test.ts runs every vector
// against both copies, so a change to one without the other fails the suite.
// Pure: the Calibration workbench composes the basis preview live with it and
// sends the same text and JSON the backend tests pin.

export interface BasisCallRow {
  cupper_id: number;
  cupper_name: string;
  session_id: number | null;
  archetype_call: string | null;
}

export interface BasisArchetypeRow {
  assigned_from_session_id: number | null;
  latest_session_id: number | null;
  is_blind: boolean | null;
  roaster_present: boolean | null;
  roaster_form_proposal: string | null;
  roaster_remark_proposals: string[] | null;
}

export interface BasisPlacement {
  slotId: number;
  dimensionId: number | null;
  dimensionName: string | null;
  mergedMin: number | null;
  mergedMax: number | null;
  mergedSessionId: number | null;
  bandLo: number | null;
  bandHi: number | null;
}

export interface BasisInput {
  archetype: BasisArchetypeRow;
  calls: BasisCallRow[];
  /** The session the decision rests on (the page's session select); else assigned_from, else the latest. */
  sessionId?: number | null;
  roasterForm?: { version: number | null; respondent: string | null } | null;
  /** The latest website capture's descriptor remarks, verbatim; the first three are named. */
  website?: string[];
  placement?: BasisPlacement | null;
}

export type BandCheck = 'in_band' | 'out_of_band' | 'no_band' | 'no_merged_range';

export interface BasisJson {
  sessions: number[];
  calls: Record<string, string | null>;
  blind: boolean | null;
  roaster_present: boolean | null;
  roaster_form: { version: number | null; respondent: string | null; proposal: string | null } | null;
  roaster_remarks: string[];
  website: string[];
  merged_range: { dimension_id: number | null; min: number | null; max: number | null; session_id: number | null } | null;
  band: { slot_id: number; lo: number | null; hi: number | null; check: BandCheck } | null;
  rule: string;
}

const WEBSITE_NAMED = 3;

/** One line: whitespace (newlines included) collapsed, ends trimmed. */
function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
function num(n: number | null): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return 'none';
  return String(Number(n));
}

export function bandCheck(mergedMin: number | null, mergedMax: number | null, lo: number | null, hi: number | null): BandCheck {
  if (lo === null && hi === null) return 'no_band';
  if (mergedMin === null || mergedMax === null) return 'no_merged_range';
  const mid = (Number(mergedMin) + Number(mergedMax)) / 2;
  if ((lo !== null && mid < Number(lo)) || (hi !== null && mid > Number(hi))) return 'out_of_band';
  return 'in_band';
}

function sortedCalls(calls: BasisCallRow[]): BasisCallRow[] {
  return [...calls].sort((a, b) => a.cupper_id - b.cupper_id);
}

/** The composed, non-editable part of the basis: `{ text, json }` with `json.rule` empty until finalized. */
export function composeBasis(input: BasisInput): { text: string; json: BasisJson } {
  const a = input.archetype;
  const calls = sortedCalls(input.calls);
  const session = input.sessionId ?? a.assigned_from_session_id ?? a.latest_session_id ?? null;
  const remarks = [...new Set((a.roaster_remark_proposals ?? []).filter(Boolean))].sort();
  const website = (input.website ?? []).map(clean).filter(Boolean);

  const parts: string[] = [];
  if (calls.length === 0) {
    parts.push('basis: cupping: none');
  } else {
    const named = calls.map(c => `${clean(c.cupper_name)}=${c.archetype_call ?? 'no call'}`).join(', ');
    const flags = `${a.is_blind ? 'blind' : 'not blind'}${a.roaster_present ? ', roaster present' : ''}`;
    parts.push(`basis: cupping s${session ?? 'none'} (${named}; ${flags})`);
  }
  if (input.roasterForm) {
    const who = input.roasterForm.respondent ? ` (${clean(input.roasterForm.respondent)})` : '';
    parts.push(`roaster form v${input.roasterForm.version ?? '?'}${who}=${a.roaster_form_proposal ?? 'no proposal'}`);
  } else {
    parts.push('roaster form: none');
  }
  parts.push(`roaster remarks=${remarks.length ? remarks.join(', ') : 'none'}`);
  parts.push(`website=${website.length ? website.slice(0, WEBSITE_NAMED).join(', ') : 'none'}`);

  let band: BasisJson['band'] = null;
  let merged: BasisJson['merged_range'] = null;
  if (input.placement) {
    const p = input.placement;
    const check = bandCheck(p.mergedMin, p.mergedMax, p.bandLo, p.bandHi);
    band = { slot_id: p.slotId, lo: p.bandLo, hi: p.bandHi, check };
    merged = p.mergedMin === null || p.mergedMax === null ? null
      : { dimension_id: p.dimensionId, min: Number(p.mergedMin), max: Number(p.mergedMax), session_id: p.mergedSessionId };
    const dim = clean(p.dimensionName ?? 'dimension');
    const range = merged ? `${num(merged.min)}-${num(merged.max)}` : 'none';
    const bandText = p.bandLo === null && p.bandHi === null ? 'none' : `${num(p.bandLo)}-${num(p.bandHi)}`;
    parts.push(`merged ${dim} ${range} vs band ${bandText} (${check})`);
  }

  const sessions = [...new Set([session, ...calls.map(c => c.session_id)].filter((s): s is number => s !== null && s !== undefined))]
    .sort((x, y) => x - y);
  const json: BasisJson = {
    sessions,
    calls: Object.fromEntries(calls.map(c => [c.cupper_name, c.archetype_call ?? null])),
    blind: calls.length ? a.is_blind : null,
    roaster_present: calls.length ? a.roaster_present : null,
    roaster_form: input.roasterForm
      ? { version: input.roasterForm.version, respondent: input.roasterForm.respondent, proposal: a.roaster_form_proposal }
      : null,
    roaster_remarks: remarks,
    website: website.slice(0, WEBSITE_NAMED),
    merged_range: merged,
    band,
    rule: '',
  };
  return { text: parts.join('; '), json };
}

/**
 * The rule part is required when the decision is not what every source said
 * (DESIGN §8.3, brief 4 decision 2): unless every cupper on the coffee called
 * the chosen archetype and every roaster proposal (form and remarks) proposed
 * it, and, for a placement, unless the slot is not out of band. A cupper with
 * no call does not support a decision; a coffee nobody cupped and no roaster
 * proposed needs the rule.
 */
export function ruleRequired(input: BasisInput, chosenArchetype: string | null, check?: BandCheck | null): boolean {
  if (check === 'out_of_band') return true;
  if (!chosenArchetype) return true;
  const said = [
    ...input.calls.map(c => c.archetype_call),
    // a submitted form is a source even when it proposes nothing (like a cupper's no call)
    ...(input.roasterForm || input.archetype.roaster_form_proposal !== null ? [input.archetype.roaster_form_proposal] : []),
    ...(input.archetype.roaster_remark_proposals ?? []),
  ];
  if (said.length === 0) return true;
  return !said.every(s => s === chosenArchetype);
}

/** The stored pair: notes / placement_note = text + '; rule: ' + (rule or 'confirmed'), basis = json with the rule. */
export function finalizeBasis(composed: { text: string; json: BasisJson }, ruleText: string): { note: string; json: BasisJson } {
  const rule = clean(ruleText) || 'confirmed';
  return { note: `${composed.text}; rule: ${rule}`, json: { ...composed.json, rule } };
}
