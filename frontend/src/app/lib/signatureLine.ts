// Coffee presentation brief 1 (2026-10-23), decision 5: the reveal panel's
// one line, George Howell style; brief 4: and the collapsed card's teaser. Pure (no React) so the backend test
// (backend/src/services/signatureLine.test.ts) can load this file by path.
//
// Nothing here caps, ranks or relabels: the rows arrive from
// GET /api/coffees/:id/flavor-wheel already qualified, capped by the
// evidence parameters and in display order (signature first, then accent),
// and are drawn in that order. The family word in an accent clause is the
// family node's descriptor as stored, lower-cased.

export interface SignatureRow {
  descriptor: string;
  family?: string | null;
  wheel_category?: string | null;
  is_signature?: boolean;
}

/** The signature notes as one comma-separated line, in the order given ("Chocolate, Almond, Peanuts"). */
export function signatureText(rows: SignatureRow[]): string {
  return rows.filter(r => r.is_signature !== false).map(r => r.descriptor).join(', ');
}

/** "a", "a and b", "a, b and c". */
function spokenList(words: string[]): string {
  return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * The collapsed position card's teaser: every note the customer may hear, or
 * null with no rows. Coffee presentation brief 2 (2026-10-24), B2: always from
 * the rows; the coffee's texts never feed the teaser. Brief 4 (2026-10-24),
 * decision 1: the signature notes, then the accent notes by name as a clause
 * ("Hazelnut, with citrus fruit and cinnamon"); with no signature rows, the
 * accent notes alone as a plain list. The caps are the read's (the rows arrive
 * capped); the family word stays the reveal's "a hint of" line.
 */
export function teaserFor(rows: SignatureRow[]): string | null {
  const signature = signatureText(rows);
  const accents = rows.filter(r => r.is_signature === false).map(r => r.descriptor);
  if (!signature) return accents.length ? accents.join(', ') : null;
  return accents.length ? `${signature}, with ${spokenList(accents.map(a => a.toLowerCase()))}` : signature;
}

/** One "a hint of <family>: <notes>" clause per accent family, families in order of first appearance. */
export function accentClauses(rows: SignatureRow[]): string[] {
  const families: Array<{ family: string; notes: string[] }> = [];
  for (const r of rows) {
    if (r.is_signature !== false) continue;
    const family = (r.family ?? r.wheel_category ?? '').toLowerCase();
    const group = families.find(g => g.family === family);
    const note = r.descriptor.toLowerCase();
    if (group) group.notes.push(note); else families.push({ family, notes: [note] });
  }
  return families.map(g => `a hint of ${g.family}: ${g.notes.join(', ')}`);
}
