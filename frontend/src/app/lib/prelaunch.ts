import { useSearchParams } from 'react-router';

/**
 * Pre-Launch Gate — single source of truth for the site-wide route allowlist
 * and the team preview bypass, extending the original homepage-only curtain
 * (`VITE_PRELAUNCH_MODE`, set in `.github/workflows/deploy.yml`) to every
 * route, the nav/footer, and the shared ArchetypeSection surfaces. See
 * backend/src/features/pre_launch_gate/prelaunch-gate/
 * CLAUDE_CODE_PROMPT_PRELAUNCH_GATE.md for the full spec.
 */

/** Site-wide flag. Flipping/removing this line in deploy.yml is the complete
 * launch switch — every consumer of this flag (the route guard, Navigation/
 * Footer's trimmed link sets, DialArchetypeSection's `prelaunch` prop)
 * collapses to today's full-site behavior when it's false/absent. */
export const PRELAUNCH_MODE = import.meta.env.VITE_PRELAUNCH_MODE === 'true';

/** Routes reachable while PRELAUNCH_MODE is on and the session hasn't
 * bypassed the gate. Everything else redirects to the curtain at "/" via
 * <PrelaunchGate> in App.tsx. In late September the checkout route will be
 * added here — one line, no refactor.
 * "/admin" is enforced by AdminRoute's own requireAdmin check, not wrapped in
 * PrelaunchGate — the gate must not add anything in front of it. "/b/:token"
 * is token-gated and was never wrapped in anything. Both are listed here only
 * for documentation completeness, not as something PrelaunchGate checks.
 * "/about" and "/the-axis" are deliberately NOT here despite the original
 * written spec listing them — Dana closed both live during execution (/about
 * is an old, admin-linked-only page not part of the live site; /the-axis was
 * a separate live call to also close it), so both are wrapped in
 * <PrelaunchGate> too. */
export const PRELAUNCH_OPEN_ROUTES = [
  '/',
  '/find-my-flavor',
  '/sign-in',
  '/profile',
  '/terms',
  '/privacy',
  '/admin',
  '/b/:token',
  '/crawl', // Hoboken Coffee Crawl event page (Sep 20 2026) — reached by QR/URL only.
] as const;

const BYPASS_KEY = 'abPreview';

/** The existing team bypass, extended from "/" to every route: appending
 * `?preview=true` to ANY url sets the same sessionStorage flag (same key,
 * same reset-on-browser-close semantics the team already knows) and unlocks
 * the whole site for the rest of the browser session. */
export function usePrelaunchBypass(): boolean {
  const [searchParams] = useSearchParams();
  const fromUrl = searchParams.get('preview') === 'true';
  if (fromUrl) sessionStorage.setItem(BYPASS_KEY, 'true');
  return fromUrl || sessionStorage.getItem(BYPASS_KEY) === 'true';
}

/** Single source of truth for "is the allowlist currently enforced for this
 * session" — consumed by the route guard, Navigation/Footer's trimmed link
 * sets, and DialArchetypeSection's `prelaunch` prop alike, so `?preview=true`
 * restores the full site everywhere at once. */
export function usePrelaunchGated(): boolean {
  const bypassed = usePrelaunchBypass();
  return PRELAUNCH_MODE && !bypassed;
}
