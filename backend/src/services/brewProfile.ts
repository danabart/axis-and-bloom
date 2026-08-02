import { firestoreDb, FieldValue } from './firebase-admin.js';
import { getSommelierConfig, type BrewProfileFieldConfig } from './sommelierConfig.js';

// HOME_TASK_4 (§4.5, §3.5) — shared brew-profile logic used by both the
// conversation path (sommelier.ts's resolveRemember()) and the profile-page
// mirror (users.ts's GET/PATCH/DELETE /api/users/brew-profile), so the
// whitelist is checked in exactly one place regardless of who's writing.

const FALLBACK_FIELDS: Record<string, BrewProfileFieldConfig> = {
  brew_methods: {
    type: 'array',
    allowedValues: ['v60', 'french_press', 'espresso', 'moka', 'aeropress', 'cold_brew', 'drip', 'other'],
    maxLength: 8,
  },
  grinder: { type: 'enum', allowedValues: ['none', 'blade', 'burr_hand', 'burr_electric', 'unknown_type'] },
  takes_it: { type: 'enum', allowedValues: ['black', 'milk', 'sugar', 'milk_and_sugar'] },
  decaf_constraint: { type: 'bool' },
  aversions: { type: 'array_freeform', maxLength: 10, maxItemLength: 40 },
};
const FALLBACK_STALE_AFTER_DAYS = 120;

export function getBrewProfileFieldsConfig(): Record<string, BrewProfileFieldConfig> {
  return getSommelierConfig()?.brewProfile?.fields ?? FALLBACK_FIELDS;
}

export function getStaleAfterDays(): number {
  return getSommelierConfig()?.brewProfile?.staleAfterDays ?? FALLBACK_STALE_AFTER_DAYS;
}

// Observed directly in HOME_TASK_4's own production verification: Haiku
// naturally emitted <<remember:brew_method=v60>> (singular) despite the
// prompt's plural example and an explicit field-name callout — a real,
// demonstrated near-miss, exactly what write rule 3 exists to catch. This is
// a small defense-in-depth normalization on top of the prompt fix, not a
// replacement for it: a genuinely unknown field still gets dropped and
// counted exactly as before, this only rescues plausible singular/plural drift.
const FIELD_ALIASES: Record<string, string> = {
  brew_method: 'brew_methods',
  aversion: 'aversions',
};
export function normalizeFieldName(field: string): string {
  return FIELD_ALIASES[field] ?? field;
}

// Validates one raw value against one field's whitelist. Returns the coerced
// value to store, or null if invalid — never throws, so a bad marker or a bad
// request body always has a clean "dropped" path rather than a crash.
export function validateSingleValue(fieldCfg: BrewProfileFieldConfig, rawValue: string): string | boolean | null {
  switch (fieldCfg.type) {
    case 'enum':
    case 'array':
      return fieldCfg.allowedValues?.includes(rawValue) ? rawValue : null;
    case 'bool': {
      const lower = rawValue.trim().toLowerCase();
      if (lower === 'true') return true;
      if (lower === 'false') return false;
      return null;
    }
    case 'array_freeform': {
      const trimmed = rawValue.trim().slice(0, fieldCfg.maxItemLength ?? 40);
      return trimmed.length > 0 ? trimmed : null;
    }
    default:
      return null;
  }
}

// Write rule 3 (§4.5) — every write attempt, success or failure, increments
// an admin-visible counter. `admin_stats/brew_profile` is a 2-segment path
// (collection/doc) — even, valid. Never throws: a counter failing to
// increment must never be the reason a customer-facing request 500s.
export async function incrementBrewProfileCounter(kind: 'writes' | 'failures'): Promise<void> {
  try {
    await firestoreDb.doc('admin_stats/brew_profile').set(
      { [kind]: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  } catch (err) {
    console.error('[brewProfile] failed to increment counter', kind, err);
  }
}

export async function getBrewProfileCounters(): Promise<{ writes: number; failures: number }> {
  try {
    const snap = await firestoreDb.doc('admin_stats/brew_profile').get();
    const data = snap.exists ? snap.data() : null;
    return { writes: Number(data?.writes ?? 0), failures: Number(data?.failures ?? 0) };
  } catch {
    return { writes: 0, failures: 0 };
  }
}

interface BrewProfileFieldEntry {
  value: unknown;
  source: 'conversation' | 'profile_page';
  capturedAt: unknown; // Firestore Timestamp once read back
}
export type BrewProfileDoc = Record<string, BrewProfileFieldEntry | undefined>;

// One-line customer-context summary for Liam's system prompt (§3.5: "every
// profile field must change a sentence Liam can say"). Only ever describes
// what's actually stored — never invents, never infers.
const SUMMARY_LABELS: Record<string, string> = {
  brew_methods: 'brews with',
  grinder: 'grinder',
  takes_it: 'takes it',
  aversions: 'avoids',
};
export function formatBrewProfileSummary(profile: BrewProfileDoc | null): string {
  if (!profile) return '';
  const parts: string[] = [];
  for (const [field, label] of Object.entries(SUMMARY_LABELS)) {
    const entry = profile[field];
    if (entry?.value == null) continue;
    if (Array.isArray(entry.value)) {
      if (entry.value.length === 0) continue;
      parts.push(`${label} ${entry.value.join('/')}`);
    } else {
      parts.push(`${label} ${entry.value}`);
    }
  }
  if (profile.decaf_constraint?.value === true) parts.push('needs decaf');
  return parts.join('; ');
}

// Write rule 5 (§4.5) — "still on the V60?" casual re-confirm, at most once
// per session, only when the stale field is relevant to this turn's topic
// (HOME_TASK_2's router). Returns a context sentence for Liam, never a marker
// or an instruction the customer would see directly.
const TOPIC_TO_FIELD: Record<string, string> = {
  brewing: 'brew_methods',
  equipment: 'grinder',
  caffeine_decaf: 'decaf_constraint',
  my_coffee: 'takes_it',
};
export function getStaleFieldNudge(
  profile: BrewProfileDoc | null,
  topic: string | null,
  alreadyNudged: boolean
): string | null {
  if (alreadyNudged || !profile || !topic) return null;
  const field = TOPIC_TO_FIELD[topic];
  if (!field) return null;
  const entry = profile[field];
  const capturedAt = entry?.capturedAt as { toDate?: () => Date } | string | undefined;
  if (!capturedAt) return null;
  const capturedMs = typeof (capturedAt as { toDate?: () => Date }).toDate === 'function'
    ? (capturedAt as { toDate: () => Date }).toDate().getTime()
    : new Date(capturedAt as string).getTime();
  if (Number.isNaN(capturedMs)) return null;
  const ageDays = (Date.now() - capturedMs) / 86_400_000;
  if (ageDays < getStaleAfterDays()) return null;
  const value = Array.isArray(entry!.value) ? (entry!.value as string[]).join('/') : String(entry!.value);
  return `It's been a while since they confirmed ${field.replace(/_/g, ' ')} (${value}) — if it fits naturally this turn, a casual re-confirm ("still on that?") is welcome, not required.`;
}
