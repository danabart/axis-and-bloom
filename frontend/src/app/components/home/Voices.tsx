import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { Titled, Caps, Wrap } from '../chrome';
import { widow } from '../../lib/widow';

// 06 Voices (Website 3). The quotes are marketing_home_quote rows from
// GET /api/home/content (D10). Timing is the handoff's: each quote holds 7 s,
// then fades over 1.4 s; hovering pauses; reduced motion shows the first one.
const HOLD_MS = 7000;
const FADE_MS = 1400;

export default function Voices({ quotes }: { quotes: string[] }) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const [fading, setFading] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (reduce || paused || quotes.length < 2) return;
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;
    const id = setInterval(() => {
      setFading(true);
      fadeTimer = setTimeout(() => { setI(n => (n + 1) % quotes.length); setFading(false); }, FADE_MS);
    }, HOLD_MS + FADE_MS);
    return () => { clearInterval(id); if (fadeTimer) clearTimeout(fadeTimer); setFading(false); };
  }, [reduce, paused, quotes.length]);

  if (quotes.length === 0) return null;
  const quote = quotes[Math.min(i, quotes.length - 1)];

  return (
    <Wrap as="section" id="voices" aria-label="What coffee drinkers told us" className="hm-voices-sec">
      <div className="hm-voices" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        <Titled style={{ fontWeight: 600 }}>What coffee drinkers told us</Titled>
        <div className={`hm-quote-box${fading ? ' is-fading' : ''}`} aria-live="polite">
          <blockquote className="hm-quote" data-testid="home-quote">“{widow(quote)}”</blockquote>
        </div>
        <Caps weight={400}>From our survey</Caps>
      </div>
    </Wrap>
  );
}
