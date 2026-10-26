// Liam answer evals (2026-10-25), Part B — the reply checks, each kind
// implemented once as a pure function (reply, context) → pass | fail(detail),
// used by the eval runner (sommelierEval.ts) and on every production reply
// (checkProductionReply, called by routes/sommelier.ts on the opening, the
// Sonnet path and the gate path). Production only reports: the global checks'
// hits become sommelier_turn.reply_flags and a log line; the reply is never
// blocked or rewritten (Dana: report, never block).
// The leak detector is contentGuard's (looksLikeLeak / bannedTokensFor), not a
// second one.
// backend/src/features/ai_agent_liam/answer_evals/CLAUDE_CODE_PROMPT_LIAM_ANSWER_EVALS.md
import { db } from '../db/client.js';
import { bannedTokensFor, looksLikeLeak } from './contentGuard.js';
import { getCatalogBlock, type CatalogCoffee } from './sommelierRag.js';
import { getCurrentAnswers, getGlobalChecks, type ReplyCheckRow, type SommelierAnswerRow } from './sommelierReads.js';
import { getSommelierConfig } from './sommelierConfig.js';

export interface CheckContext {
  roasterNames: string[];
  catalog: CatalogCoffee[];
  answers: SommelierAnswerRow[];
  supportContact?: string | null;
  // Follow-up 4 (2026-10-26, OT-55), eval only: must_contain_price_of checks
  // the phrasing's coffee when set (a copied turn's resolved coffee), else the
  // check's alias, else the case's coffee_alias.
  phrasingCoffeeId?: number | null;
  caseCoffeeAlias?: string | null;
}

export type CheckOutcome =
  | { pass: true }
  | { pass: false; detail: string }
  | { judge: string };   // a judge question the caller must ask (judge rows, must_contain_answer fallback)

// Curly quotes and runs of whitespace do not make a different sentence.
const norm = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function containsPhrase(text: string, phrase: string): boolean {
  const p = phrase.trim();
  if (!p) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(p)}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

/** Every $ amount in the text, in cents ("$29" and "$29.00" are both 2900). */
export function dollarAmountsCents(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?/g)) {
    const whole = Number(m[1].replace(/,/g, ''));
    const frac = m[2] ? Number(m[2].padEnd(2, '0')) : 0;
    out.push(whole * 100 + frac);
  }
  return out;
}

const catalogCents = (catalog: CatalogCoffee[]) => new Set(catalog.flatMap(c => c.sizes.map(s => s.cents)));
const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const findCoffee = (catalog: CatalogCoffee[], alias: string) => catalog.find(c => c.alias.trim().toLowerCase() === alias.trim().toLowerCase());

/** The current answer text with {supportContact} filled in (as the prefix renders it). */
export function answerText(answer: SommelierAnswerRow, supportContact?: string | null): string {
  return supportContact ? answer.answer_text.replace(/\{supportContact\}/g, supportContact) : answer.answer_text;
}

/** One check against one reply. Code graders decide here; a judge row returns { judge } for the caller. */
export function runCheck(check: Pick<ReplyCheckRow, 'kind' | 'value'>, reply: string, ctx: CheckContext): CheckOutcome {
  const value = check.value ?? '';
  switch (check.kind) {
    case 'must_contain':
      return norm(reply).includes(norm(value)) ? { pass: true } : { pass: false, detail: `does not contain "${value}"` };
    case 'must_not_contain':
      return norm(reply).includes(norm(value)) ? { pass: false, detail: `contains "${value}"` } : { pass: true };
    case 'must_contain_answer': {
      // "a|b": any one of the answers passes (follow-up 2026-10-25: sourcing and partner_privacy are both right for "who roasts it").
      const keys = value.split('|').map(k => k.trim()).filter(Boolean);
      if (!keys.length) return { pass: false, detail: 'no answer key given' };
      const texts: string[] = [];
      for (const key of keys) {
        const answer = ctx.answers.find(a => a.key === key);
        if (!answer) return { pass: false, detail: `answer '${key}' has no current row` };
        texts.push(answerText(answer, ctx.supportContact));
      }
      if (texts.some(t => norm(reply).includes(norm(t)))) return { pass: true };
      if (texts.length === 1) return { judge: `Does the reply state the same fact as this answer, in any words, without contradicting it: "${texts[0]}"?` };
      return { judge: `Does the reply state the same fact as at least one of these answers, in any words, without contradicting it: ${texts.map(t => `"${t}"`).join(' or ')}?` };
    }
    case 'must_contain_price_of': {
      const byId = ctx.phrasingCoffeeId != null;
      const alias = value.trim() || ctx.caseCoffeeAlias?.trim() || '';
      const coffee = byId ? ctx.catalog.find(c => c.id === ctx.phrasingCoffeeId) : findCoffee(ctx.catalog, alias);
      const name = byId ? (coffee?.alias ?? `coffee ${ctx.phrasingCoffeeId}`) : alias;
      if (!coffee) return { pass: false, detail: `"${name}" is not in the catalog block` };
      if (!coffee.sizes.length) return { pass: false, detail: `"${name}" has no price in the catalog block` };
      const said = new Set(dollarAmountsCents(reply));
      const missing = coffee.sizes.filter(s => !said.has(s.cents));
      return missing.length ? { pass: false, detail: `missing ${missing.map(s => `${s.label} ${fmt(s.cents)}`).join(', ')}` } : { pass: true };
    }
    case 'must_name_catalog_coffee':
      return ctx.catalog.some(c => containsPhrase(reply, c.alias)) ? { pass: true } : { pass: false, detail: 'names no catalog coffee' };
    case 'must_not_name_roaster': {
      const hit = looksLikeLeak(reply, bannedTokensFor([], ctx.roasterNames, null));
      return hit ? { pass: false, detail: `names roaster "${hit}"` } : { pass: true };
    }
    case 'price_in_catalog_only': {
      const allowed = catalogCents(ctx.catalog);
      const bad = dollarAmountsCents(reply).filter(c => !allowed.has(c));
      return bad.length ? { pass: false, detail: `price not in the catalog: ${bad.map(fmt).join(', ')}` } : { pass: true };
    }
    case 'must_not_claim':
      return containsPhrase(reply, value) ? { pass: false, detail: `claims "${value}"` } : { pass: true };
    case 'judge':
      return { judge: value };
    default:
      return { pass: false, detail: `unknown check kind '${check.kind}'` };
  }
}

/** The flag codes of the global checks this reply fails (code graders only; a judge row is never global). */
export function globalFlags(reply: string, globals: ReplyCheckRow[], ctx: CheckContext): string[] {
  const flags = new Set<string>();
  for (const g of globals) {
    if (g.kind === 'judge' || !g.flag_code) continue;
    const r = runCheck(g, reply, ctx);
    if ('pass' in r && !r.pass) flags.add(g.flag_code);
  }
  return [...flags];
}

let roasterCache: { at: number; names: string[] } | null = null;
async function roasterNames(): Promise<string[]> {
  if (roasterCache && Date.now() - roasterCache.at < 300_000) return roasterCache.names;
  const r = await db.query<{ name: string }>(`SELECT name FROM roaster WHERE name IS NOT NULL`);
  roasterCache = { at: Date.now(), names: r.rows.map(x => x.name) };
  return roasterCache.names;
}

/** The live context: roaster names, the shared catalog block's coffees, the current answers, the support contact. */
export async function liveCheckContext(): Promise<CheckContext> {
  const [names, block, answers] = await Promise.all([roasterNames(), getCatalogBlock(), getCurrentAnswers()]);
  return { roasterNames: names, catalog: block.coffees, answers, supportContact: getSommelierConfig()?.brandFacts?.supportContact ?? null };
}

/**
 * Part B, production: the global checks on a final reply (after the
 * sanitizers, before the Firestore write). Returns the flag codes for
 * sommelierTurnService.recordTurn and logs [liam:REPLY_FLAG] when any hit.
 * Never throws and never changes the reply: a failure to check is logged and
 * the turn goes on with no flags.
 */
export async function checkProductionReply(reply: string, where: { sessionId: number; turn: number }): Promise<string[]> {
  try {
    const [globals, ctx] = await Promise.all([getGlobalChecks(), liveCheckContext()]);
    const flags = globalFlags(reply, globals, ctx);
    if (flags.length) console.warn(`[liam:REPLY_FLAG] session=${where.sessionId} turn=${where.turn} flags=${flags.join(',')}`);
    return flags;
  } catch (err) {
    console.error(`[liam:REPLY_CHECK_FAILED] session=${where.sessionId} turn=${where.turn}`, err instanceof Error ? err.message : err);
    return [];
  }
}
