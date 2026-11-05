import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { usePrelaunchGated } from '../lib/prelaunch';
import { subscribeNewsletter } from '../lib/api';
import { trackEvent, trackLead } from '../lib/analytics';
import { reportError } from '../lib/errorReporter';
import { ArrowIcon, Caps, MarkLockup } from './chrome';
import { CART_PAGE_ROUTE_EXISTS } from './Navigation';
import './chrome/chrome.css';

/**
 * Site footer (Website 1, 2026-11-04) — the handoff's white four-column
 * `.foot` grid (4 → 2 → 1 at 900/560px): mark · site links · Instagram /
 * Contact · newsletter, then the legal row. While gated only the doors that
 * are open before launch are shown ("never show a door we won't open").
 */

// The brand's Instagram profile (same address the quiz-complete email links).
// Not SHORTLINKS['/ig'] — that is our own quiz URL with Instagram campaign
// attribution, which would credit every footer click to the Instagram campaign.
const INSTAGRAM_URL = 'https://instagram.com/axisandbloom';
const CONTACT_EMAIL = 'hello@axisandbloomcoffee.com';

type NewsState = 'idle' | 'sending' | 'done' | 'error';

export default function Footer() {
  const gated = usePrelaunchGated();
  const { hasLiamAccess } = useAuth();
  const { cart, toggleCartOpen } = useCart();
  const count = cart.reduce((n, i) => n + i.qty, 0);
  const year = new Date().getFullYear();

  const [email, setEmail] = useState('');
  const [state, setState] = useState<NewsState>('idle');

  const siteLinks = [
    { to: '/the-axis', label: 'The Axis', show: !gated },
    { to: '/bloom', label: 'The Bloom Dial', show: !gated },
    { to: '/sommelier', label: 'Liam', show: !gated && hasLiamAccess },
    { to: '/find-my-flavor', label: 'Find My Flavor', show: true },
    // Kept from the old footer (Flavor Intelligence left the menu in D2; this door stays).
    { to: '/flavor-intelligence', label: 'Flavor Intelligence', show: !gated },
  ].filter(l => l.show);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (state === 'sending') return;
    setState('sending');
    try {
      await subscribeNewsletter({ email: email.trim(), source: 'footer' });
      trackEvent('EmailSubmitted', { source: 'footer' });
      trackLead({ source: 'footer' });
      setState('done');
    } catch (err) {
      reportError('[Footer/subscribe]', err);
      setState('error');
    }
  }

  return (
    <footer className="ab-foot-shell">
      <div className="ab-foot-rule" />
      <div className="ab-foot">
        <Link to="/" className="ab-mark" aria-label="Axis & Bloom home" style={{ alignSelf: 'start' }}>
          <MarkLockup />
        </Link>

        <nav aria-label="Footer" className="ab-foot-col ab-caps">
          {siteLinks.map(l => <Link key={l.to} to={l.to}>{l.label}</Link>)}
          {!gated && (CART_PAGE_ROUTE_EXISTS
            ? <Link to="/cart">Cart</Link>
            : <button type="button" className="ab-foot-link ab-caps" onClick={toggleCartOpen} aria-label={`Cart, ${count} ${count === 1 ? 'item' : 'items'}`}>Cart</button>)}
        </nav>

        <div className="ab-foot-col ab-caps">
          <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer">Instagram</a>
          <a href={`mailto:${CONTACT_EMAIL}`}>Contact</a>
        </div>

        <form className="ab-news" onSubmit={onSubmit} noValidate={false}>
          <label htmlFor="ab-footer-news" className="ab-caps" style={{ fontWeight: 600 }}>Your family of taste, in your inbox</label>
          {state === 'done' ? (
            <Caps as="p" role="status" style={{ margin: 0 }}>You're on the list.</Caps>
          ) : (
            <>
              <div className="ab-news-row">
                <input
                  id="ab-footer-news"
                  type="email"
                  required
                  placeholder="your@email.com"
                  autoComplete="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); if (state === 'error') setState('idle'); }}
                  aria-invalid={state === 'error' || undefined}
                  aria-describedby={state === 'error' ? 'ab-footer-news-error' : undefined}
                />
                <button type="submit" className="ab-caps" disabled={state === 'sending'}>
                  Join <ArrowIcon />
                </button>
              </div>
              {state === 'error' && (
                <p id="ab-footer-news-error" className="ab-news-error" role="alert">
                  We couldn't add you just now. Please try again in a moment.
                </p>
              )}
            </>
          )}
        </form>
      </div>

      <div className="ab-foot-bottom ab-caps">
        <span>© {year} Axis &amp; Bloom · Coffee matched to your personal flavor.</span>
        <span>
          <Link to="/terms">Terms</Link> · <Link to="/privacy">Privacy</Link>
        </span>
      </div>
    </footer>
  );
}
