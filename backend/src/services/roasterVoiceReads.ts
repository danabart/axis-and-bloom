// Coffee presentation brief 1 (2026-10-23), Part C — one read for the
// roaster's voice on a coffee, and every LLM surface reads it: the three
// content generators and the story (routes/coffees.ts), Liam's RAG
// (sommelierRag), the arrival-note sentence (routes/cron.ts) and the
// order-placed beat (beatEngine).
// backend/src/features/coffee_presentation/CLAUDE_CODE_PROMPT_COFFEE_PRESENTATION_1.md, decision 6.
//
// Reads only views and existing reads: cuppingReads (v_coffee_customer_descriptor,
// v_coffee_dimension_range), roasteryRemarkReads (v_roastery_remark) and
// roasteryPortalReads (v_roastery_portal_current_response). No new table, no
// new view: those four views already hold every column.
//
// Never in the shape: the roaster's name, coffees.name, coffees.origin, a
// remark of topic origin, or an award's text. Awards come out as a count; a
// remark or portal answer that carries an award token, the roaster's name, the
// raw coffee name or the origin text is withheld whole (it would put the
// thing the guard rejects into the prompt).
import { db, type Tx } from '../db/client.js';
import { getCustomerDescriptors, getMergedRanges, type CustomerDescriptor } from './cuppingReads.js';
import { listRemarks } from './roasteryRemarkReads.js';
import { getCurrentResponseForCoffee } from './roasteryPortalReads.js';
import { getCoffee, getArchetypes } from './catalogReads.js';
import { styleViolation } from './contentGuard.js';

type Runner = Tx | typeof db;

/** The pooled numeric dimensions in the row shape the content prompts have always taken. */
export interface DimensionRow {
  dimension: string;
  scale_min_label: string | null;
  scale_max_label: string | null;
  display_order: number | null;
  avg_min: string;
  avg_max: string;
  session_count: string;
}

// The topics a customer text may draw on (decision 6); origin never.
const VOICE_TOPICS = ['general', 'brewing', 'roast', 'process'] as const;
type VoiceTopic = (typeof VOICE_TOPICS)[number];
// The channels a remark reaches the voice from (decision 6: website / table / email).
const VOICE_CHANNELS = ['website', 'cupping_table', 'email'];

export interface RoasterVoice {
  descriptors: CustomerDescriptor[];
  remarks: Record<VoiceTopic, string[]>;
  portal: {
    takesIt: string | null; brewNotes: string | null; anythingElse: string | null; roastLevel: string | null;
    blendOrSingle: string | null; isDecaf: boolean | null; proposedArchetype: string | null;
  };
  awards: { count: number };
  dimensions: DimensionRow[];
}

/**
 * The numeric dimensions of a coffee's pooled range (cuppingReads →
 * v_coffee_dimension_range, converted to 0 to 15), as numeric strings. Moved
 * here from routes/coffees.ts (which still serves it on GET /:id/dimensions).
 */
export async function numericDimensionRows(coffeeId: number, runner: Runner = db): Promise<DimensionRow[]> {
  const ranges = await getMergedRanges(coffeeId, runner);
  return ranges
    .filter(r => r.is_numeric && r.value_min !== null && r.value_max !== null)
    .map(r => ({
      dimension: r.dimension_name,
      scale_min_label: r.scale_min_label,
      scale_max_label: r.scale_max_label,
      display_order: r.display_order,
      avg_min: Number(r.value_min).toFixed(1),
      avg_max: Number(r.value_max).toFixed(1),
      session_count: String(r.n_scores),
    }));
}

/** Words of three or more characters (letters or digits), lower-cased: the unit the award guard bans. */
export function tokensOf(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
}

/** The current award remarks of a coffee, verbatim: for the leak guard only, never for a prompt. */
export async function getAwardRemarks(coffeeId: number, runner: Runner = db): Promise<string[]> {
  const rows = await listRemarks({ coffeeId, currentOnly: true }, runner);
  return rows.filter((r: any) => r.topic === 'award').map((r: any) => String(r.remark));
}

function containsAny(text: string, needles: string[]): boolean {
  const lower = text.toLowerCase();
  const words = new Set(tokensOf(text));
  return needles.some(n => (n.includes(' ') ? lower.includes(n) : words.has(n)));
}

/**
 * The roaster's voice on one coffee. `descriptorsOnly` skips the remarks,
 * portal and dimension reads for callers that take the words alone (Liam's
 * catalog context over many coffees, the arrival note, the order beat).
 */
export async function getRoasterVoice(coffeeId: number, runner: Runner = db, opts: { descriptorsOnly?: boolean } = {}): Promise<RoasterVoice> {
  const empty: RoasterVoice['portal'] = {
    takesIt: null, brewNotes: null, anythingElse: null, roastLevel: null, blendOrSingle: null, isDecaf: null, proposedArchetype: null,
  };
  const remarksOut = Object.fromEntries(VOICE_TOPICS.map(t => [t, [] as string[]])) as Record<VoiceTopic, string[]>;
  if (opts.descriptorsOnly) {
    return { descriptors: await getCustomerDescriptors(coffeeId, runner), remarks: remarksOut, portal: empty, awards: { count: 0 }, dimensions: [] };
  }

  // in parallel on the pool; one after another on a transaction's single client
  const reads = [
    () => getCustomerDescriptors(coffeeId, runner),
    () => listRemarks({ coffeeId, currentOnly: true }, runner),
    () => getCurrentResponseForCoffee(coffeeId, runner),
    () => numericDimensionRows(coffeeId, runner),
    () => getCoffee(coffeeId, runner),
  ] as const;
  const results: unknown[] = [];
  if (runner === db) results.push(...await Promise.all(reads.map(r => r())));
  else for (const r of reads) results.push(await r());
  const [descriptors, remarkRows, response, dimensions, coffee] = results as [
    Awaited<ReturnType<typeof getCustomerDescriptors>>, any[], Awaited<ReturnType<typeof getCurrentResponseForCoffee>>,
    DimensionRow[], Awaited<ReturnType<typeof getCoffee>>,
  ];

  const awards = remarkRows.filter((r: any) => r.topic === 'award');
  // What a text may not carry: award tokens, and (as phrases) the roaster's
  // name, the raw coffee name and the origin text.
  const banned = [
    ...new Set(awards.flatMap((r: any) => tokensOf(String(r.remark)))),
    ...[coffee?.roaster_name, coffee?.name, coffee?.origin, ...remarkRows.map((r: any) => r.roaster_name)]
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 2)
      .map(s => s.trim().toLowerCase()),
  ];
  // Dana's prod-go rules: a remark that files the coffee under an archetype
  // ("for lovers of fruity coffees") is withheld too, or the model repeats it.
  const labels = (await getArchetypes(runner)).map(a => a.label);
  const clean = (s: string | null | undefined) =>
    (s && s.trim() && !containsAny(s, banned) && !styleViolation(s, labels, true) ? s.trim() : null);

  // The latest website capture per roaster (brief 6 C1 rule, as for descriptors).
  const latestWebsite = new Map<string, string>();
  for (const r of remarkRows as any[]) {
    if (r.channel !== 'website') continue;
    const day = String(r.said_on instanceof Date ? r.said_on.toISOString() : r.said_on).slice(0, 10);
    if ((latestWebsite.get(r.roaster_id) ?? '') < day) latestWebsite.set(r.roaster_id, day);
  }
  for (const r of remarkRows as any[]) {
    if (!(VOICE_TOPICS as readonly string[]).includes(r.topic) || !VOICE_CHANNELS.includes(r.channel)) continue;
    if (r.channel === 'website') {
      const day = String(r.said_on instanceof Date ? r.said_on.toISOString() : r.said_on).slice(0, 10);
      if (day !== latestWebsite.get(r.roaster_id)) continue;
    }
    const text = clean(r.remark);
    if (text && !remarksOut[r.topic as VoiceTopic].includes(text)) remarksOut[r.topic as VoiceTopic].push(text);
  }

  const portal: RoasterVoice['portal'] = response ? {
    takesIt: clean(response.takesIt), brewNotes: clean(response.brewNotes), anythingElse: clean(response.anythingElse),
    roastLevel: response.roastLevel, blendOrSingle: response.blendOrSingle,
    isDecaf: response.caffeineLevel ? response.caffeineLevel === 'decaf' : response.isDecaf,
    proposedArchetype: response.proposedArchetype,
  } : empty;

  return { descriptors, remarks: remarksOut, portal, awards: { count: awards.length }, dimensions };
}

/** The signature rows' words, in order (already capped by the read): what the one-line surfaces take. */
export function signatureWords(voice: Pick<RoasterVoice, 'descriptors'>): string[] {
  return voice.descriptors.filter(d => d.is_signature).map(d => d.descriptor);
}
