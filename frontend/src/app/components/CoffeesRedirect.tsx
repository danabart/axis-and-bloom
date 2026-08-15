import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { reportError } from '../lib/errorReporter';

/**
 * Legacy `/coffees` route (Flavor Intelligence Part 1 Decision #5). Bare
 * `/coffees` redirects straight to `/flavor-intelligence`. `/coffees?coffee={id}`
 * resolves the old raw-coffeeId contract server-side via
 * GET /api/coffees/:id/legacy-slot, then redirects to the new
 * `?archetype=&slot=` contract — or falls back to the bare redirect if the
 * coffeeId no longer resolves to a live slot.
 */
export default function CoffeesRedirect() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const coffeeId = searchParams.get('coffee');
    if (!coffeeId) { navigate('/flavor-intelligence', { replace: true }); return; }

    fetch(`/api/coffees/${coffeeId}/legacy-slot`)
      .then(r => (r.ok ? r.json() : null))
      .then((resolved: { archetype: string; dialSortOrder: number } | null) => {
        navigate(
          resolved ? `/flavor-intelligence?archetype=${resolved.archetype}&slot=${resolved.dialSortOrder}` : '/flavor-intelligence',
          { replace: true }
        );
      })
      .catch(err => { reportError('[CoffeesRedirect/legacy-slot]', err); navigate('/flavor-intelligence', { replace: true }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
