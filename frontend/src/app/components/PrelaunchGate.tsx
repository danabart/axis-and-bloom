import { Navigate } from 'react-router';
import { usePrelaunchGated } from '../lib/prelaunch';

/**
 * Route guard for the pre-launch allowlist (see lib/prelaunch.ts —
 * PRELAUNCH_OPEN_ROUTES). Wraps every route NOT on that allowlist in
 * App.tsx; while VITE_PRELAUNCH_MODE is on and the session hasn't bypassed
 * the gate (`?preview=true`), redirects to the curtain at "/" instead of
 * rendering the route. When the flag is off (launch day) or the session is
 * bypassed, `usePrelaunchGated()` is false and this is a pure pass-through —
 * zero behavior change, same as today.
 */
export default function PrelaunchGate({ children }: { children: React.ReactNode }) {
  const gated = usePrelaunchGated();
  if (gated) return <Navigate to="/" replace />;
  return <>{children}</>;
}
