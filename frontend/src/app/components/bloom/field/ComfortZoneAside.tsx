import { Link } from 'react-router';
import { Caps, Titled, ArrowIcon } from '../../chrome';
import { useAuth } from '../../../context/AuthContext';
import { useCompatibility, COMFORT_ZONE_LABEL } from '../../coffee-info/useCompatibility';

// Website 5 (2026-11-05): the handoff's "Your comfort zone" aside, on the
// server's compatibility (useCompatibility, decided 2026-11-05): the pill is
// GET /:id/compatibility's `zone` (thresholds in evidence_parameter), falling
// back to the family level when the coffee has no sentence; the sentence is
// the server's. No match percentage and no per-user dimension value (Dana,
// 2026-09-26: no data basis yet). A visitor with no family sees the way to
// find one. "Unsure? Talk to Liam" only with Liam access, never while gated.

export function ComfortZoneAside({ archetype, userArchetype, coffeeId, prelaunch }: {
  /** the coffee's family */
  archetype: string;
  userArchetype: string | null;
  /** the coffee on the dial, or null for a slot with no live coffee (the family level shows alone) */
  coffeeId: number | null;
  prelaunch: boolean;
}) {
  const { hasLiamAccess } = useAuth();
  const { comfortZone, dimCompText } = useCompatibility(archetype, userArchetype, coffeeId);
  const showLiam = hasLiamAccess && !prelaunch;

  return (
    <aside className="bf-foryou" aria-live="polite" data-testid="comfort-zone">
      <div className="bf-fy-side">
        <Titled style={{ alignSelf: 'flex-start' }}>Your comfort zone</Titled>
        {userArchetype && <Caps weight={400}>From your quiz</Caps>}
      </div>
      {userArchetype == null ? (
        <Link to="/find-my-flavor" className="ab-caps bf-liam" data-testid="find-your-flavor">
          Find your flavor to see your match <ArrowIcon />
        </Link>
      ) : (
        <>
          {comfortZone && <p className="bf-fy-word" data-zone={comfortZone}>{COMFORT_ZONE_LABEL[comfortZone]}</p>}
          {dimCompText && <p className="bf-fit">{dimCompText}</p>}
        </>
      )}
      {showLiam && (
        <div className="bf-fy-foot">
          <Link to="/sommelier" className="ab-caps bf-liam" data-testid="talk-to-liam">
            Unsure? Talk to Liam <ArrowIcon />
          </Link>
        </div>
      )}
    </aside>
  );
}
