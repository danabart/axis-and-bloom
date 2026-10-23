import { signatureText, accentClauses, type SignatureRow } from '../../lib/signatureLine';

/**
 * Coffee presentation brief 1 (2026-10-23), decision 5 — the roaster's core
 * notes as one comma-separated line, in evidence order, and beneath it,
 * lighter and smaller, one "a hint of …" clause per accent family. No bars,
 * no category tags, no "show more": the rows are exactly what
 * GET /api/coffees/:id/flavor-wheel returns (qualifying, capped by the
 * evidence parameters, in display order), drawn in that order.
 * confirmed_by_cupping stays on the rows for a mark Camila may style later;
 * not rendered here.
 */
export function SignatureLine({ rows }: { rows: SignatureRow[] }) {
  const line = signatureText(rows);
  const clauses = accentClauses(rows);
  if (!line && !clauses.length) return null;
  return (
    <div>
      {line && (
        <p className="text-[15px]" style={{ color: '#45474a', fontWeight: 400, lineHeight: 1.5 }}>
          {line}
        </p>
      )}
      {clauses.map(clause => (
        <p key={clause} className="text-[12.5px] mt-1.5" style={{ color: '#7b7f80', fontWeight: 300, lineHeight: 1.5 }}>
          {clause}
        </p>
      ))}
    </div>
  );
}
