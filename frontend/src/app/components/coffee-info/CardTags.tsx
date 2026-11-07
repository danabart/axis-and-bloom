import type { CardTag } from './TastingNotes';

/**
 * Coffee presentation brief 4 (2026-10-24), decision 2: up to two small tags
 * under the coffee's name (award, best brew), in the order and wording the
 * content read gives (GET /api/coffees/:id/content `tags`; the labels are
 * lookup rows). Small caps, grey, as the admin page's grey tags. Nothing when
 * the list is empty. Camila restyles later.
 * Website 9 (2026-11-06, Dana's Q4): an award reads "Premium ★", the handoff's
 * word for it everywhere a customer sees a coffee (D12, G4.5); best brew as given.
 */
export function CardTags({ tags }: { tags: CardTag[] }) {
  if (!tags.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {tags.map(t => (
        <span key={t.kind} className="px-2 py-0.5 rounded bg-stone-100 text-stone-400 text-[10.5px] uppercase tracking-[.12em]">
          {t.kind === 'award' ? 'Premium ★' : t.label}
        </span>
      ))}
    </div>
  );
}
