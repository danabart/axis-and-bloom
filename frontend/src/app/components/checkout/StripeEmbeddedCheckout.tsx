import { loadStripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';

// Commerce 3 (2026-10-31) — the one Stripe Embedded Checkout component (G4.1),
// lifted out of /checkout so Profile's card update (a setup-mode session) uses
// the same thing. The caller creates the session on the server and passes its
// client secret; Stripe returns to the session's return_url when it completes.

const PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
// loadStripe once, at module level (Stripe's own guidance), only when a key is built in.
const stripePromise = PUBLISHABLE_KEY ? loadStripe(PUBLISHABLE_KEY) : null;

/** False when the build has no publishable key (checkout and card updates are off). */
export const stripeConfigured = Boolean(stripePromise);

export default function StripeEmbeddedCheckout({ clientSecret }: { clientSecret: string }) {
  if (!stripePromise) return null;
  return (
    <EmbeddedCheckoutProvider key={clientSecret} stripe={stripePromise} options={{ clientSecret }}>
      <EmbeddedCheckout />
    </EmbeddedCheckoutProvider>
  );
}
