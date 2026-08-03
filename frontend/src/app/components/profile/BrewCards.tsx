import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import type { BrewCardSummary } from '../../lib/api';

interface Props {
  cards: BrewCardSummary[];
}

const METHOD_LABEL: Record<string, string> = {
  v60: 'V60', french_press: 'French press', espresso: 'Espresso', moka: 'Moka pot',
  aeropress: 'Aeropress', cold_brew: 'Cold brew', drip: 'Drip', other: 'Your method',
};

/** HOME_TASK_6 (§3.2) — "Your Uganda · V60 · 1:16 · medium-coarse · 94°C —
 * adjusted after you found it bitter." Read-only v1: no editing UI here
 * (Phase 2) — cards update only through conversation via <<card:adjust>>.
 * Same quiet register and archetype-color-adjacent styling as
 * ActivityTimeline, since this sits right beside it on the Flavor Memory tab. */
export default function BrewCards({ cards }: Props) {
  if (cards.length === 0) return null;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[11px] uppercase tracking-[0.2em] text-[#a33726]/40">Brew cards</p>
      <div className="flex flex-col gap-5">
        {cards.map(card => (
          <div key={card.id} className="flex flex-col gap-1.5">
            <p className="text-sm text-[#a33726]">
              {card.coffeeName ?? 'This coffee'} · {METHOD_LABEL[card.method] ?? card.method} · {card.ratio} · {card.grindLabel}
              {card.tempC != null ? ` · ${card.tempC}°C` : ''}
            </p>
            {card.lastAdjustmentReason && (
              <p className="text-xs text-[#a33726]/60 italic leading-relaxed">
                Adjusted after {card.lastAdjustmentReason}
              </p>
            )}
            {card.notes && (
              <p className="text-xs text-[#a33726]/60 leading-relaxed">{card.notes}</p>
            )}
            <Link
              to={`/sommelier?entry=card&coffee=${card.coffeeId}`}
              className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] text-[#a33726]/40 hover:text-[#a33726] transition-colors w-fit mt-0.5"
            >
              Ask Liam about this <ArrowRight size={11} />
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
