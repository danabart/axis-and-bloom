/**
 * One address for the whole site (Checkout UX 1). Firebase Auth and
 * sessionStorage are per origin, and Stripe always returns to the backend's
 * FRONTEND_URL, so a visitor who started on another host would come back from
 * paying signed out and without the ?preview=true flag.
 *
 * VITE_CANONICAL_HOST (a bare hostname, set in deploy.yml) is the only switch;
 * unset or empty means no redirect. Path, query and hash are carried unchanged.
 *
 * Returns true when the page is leaving, so the caller must not render.
 */
export function redirectToCanonicalHost(): boolean {
  const host = import.meta.env.VITE_CANONICAL_HOST;
  if (!host || window.location.hostname === host) return false;
  const { pathname, search, hash } = window.location;
  window.location.replace(`https://${host}${pathname}${search}${hash}`);
  return true;
}
