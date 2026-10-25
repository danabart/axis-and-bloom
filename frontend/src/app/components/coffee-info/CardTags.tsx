import type { CardTag } from './TastingNotes';

/**
 * Coffee presentation brief 4 (2026-10-24), decision 2: up to two small tags
 * under the coffee's name (award, best brew), in the order and wording the
 * content read gives (GET /api/coffees/:id/content `tags`; the labels are
 * lookup rows). Small caps, grey, as the admin page's grey tags. Nothing when
 * the list is empty. Camila restyles later.
 */
export function CardTags({ tags }: { tags: CardTag[] }) {
  if (!tags.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {tags.map(t => (
        <span key={t.kind} className="px-2 py-0.5 rounded bg-stone-100 text-stone-400 text-[10.5px] uppercase tracking-[.12em]">
          {t.label}
        </span>
      ))}
    </div>
  );
}
