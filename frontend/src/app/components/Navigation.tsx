import { useEffect, useRef, useState } from 'react';
import { ShoppingCart } from 'lucide-react';
import { Link, useNavigate, useLocation } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { usePrelaunchGated } from '../lib/prelaunch';
import { Wrap, ArrowIcon, MarkLockup, type Tone } from './chrome';
import './chrome/chrome.css';

/**
 * Site header + Menu overlay (Website 1, 2026-11-04) — the handoff's static
 * `.top` bar ("Sign in · Cart (n) · Menu") and the full-width terracotta
 * `#siteMenu` field. Same export and mount point as the old fixed bar
 * (PublicLayout). Behaviours kept from the old hamburger: focus trap, body
 * scroll lock, role="dialog" aria-modal, Escape + outside click close, focus
 * back on the Menu button, close on route change.
 */

/** Flipped to true by Website 8 when the /cart route lands. Until then
 * "Cart (n)" opens the drawer (D3: the drawer stays either way). */
export const CART_PAGE_ROUTE_EXISTS = false;
const CART_PAGE_ROUTE = '/cart';

/** The four numbered menu items (D2). */
export const MENU_ITEMS = [
  { n: '01', to: '/shop', label: 'Shop all' },
  { n: '02', to: '/the-axis', label: 'The Axis' },
  { n: '03', to: '/bloom', label: 'The Bloom' },
  { n: '04', to: '/find-my-flavor', label: 'Find my flavor' },
];

// While gated, only Find My Flavor survives — everything else disappears
// entirely (never grayed out — "never show a door we won't open"). Same rule
// as before the redesign; ADMIN and the cart are hidden too.
const GATED_PATHS = new Set(['/find-my-flavor']);
export const GATED_LINKS = MENU_ITEMS.filter(i => GATED_PATHS.has(i.to));

function isCurrent(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

type NavigationProps = {
  /** ink = white page (default); paper = over a dark photo (quiz). */
  tone?: Tone;
  /** Absolute over the page's first band (Home family panels). */
  floating?: boolean;
};

export default function Navigation({ tone: toneProp, floating: floatingProp }: NavigationProps = {}) {
  const { user, isAdmin, isGuest, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const gated = usePrelaunchGated();
  const { cart, toggleCartOpen } = useCart();
  const count = cart.reduce((n, i) => n + i.qty, 0);
  const signedIn = !!user && !isGuest;
  const items = gated ? GATED_LINKS : MENU_ITEMS;
  const showAdmin = isAdmin && !gated;

  // Website 3 retired the [data-hero] detection: Home passes floating + paper
  // through PublicLayout, the only page that floated.
  const floating = floatingProp ?? false;
  const tone: Tone = toneProp ?? 'ink';

  const [open, setOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setOpen(false); }, [pathname]);

  // While open: lock body scroll, Escape closes, Tab is trapped inside the
  // field, outside click closes; focus returns to the Menu button on close.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusables = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []);
    focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); return; }
      if (e.key !== 'Tab') return;
      const f = focusables();
      if (f.length === 0) return;
      const first = f[0];
      const last = f[f.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !menuRef.current?.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !menuRef.current?.contains(active))) { e.preventDefault(); first.focus(); }
    };
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || menuBtnRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    const btn = menuBtnRef.current;
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
      btn?.focus();
    };
  }, [open]);

  const handleSignOut = async () => { setOpen(false); await logout(); navigate('/'); };
  const openDrawer = () => { setOpen(false); toggleCartOpen(); };

  const cartLabel = `Cart, ${count} ${count === 1 ? 'item' : 'items'}`;
  const cartText = <>Cart <span className="ab-count">({count})</span></>;

  /** "Cart (n)" — the /cart page once it exists, the drawer until then. */
  const cartLink = (cls: string) =>
    CART_PAGE_ROUTE_EXISTS
      ? <Link to={CART_PAGE_ROUTE} className={cls} aria-label={cartLabel} onClick={() => setOpen(false)}>{cartText}</Link>
      : <button type="button" className={cls} aria-label={cartLabel} onClick={openDrawer}>{cartText}</button>;

  return (
    <>
      <header className={`ab-header ab-${tone}${floating ? ' is-floating' : ''}`}>
        <Wrap className="ab-top">
          <Link to="/" className="ab-mark" aria-label="Axis & Bloom home">
            <MarkLockup tone={tone} />
          </Link>

          <span className="ab-right ab-caps">
            {signedIn ? (
              <>
                <Link to="/profile" className={`ab-hlink ab-wide-only${isCurrent(pathname, '/profile') ? ' on' : ''}`}>Profile</Link>
                <button type="button" className="ab-hlink ab-wide-only" onClick={handleSignOut}>Sign out</button>
              </>
            ) : (
              <Link to="/sign-in" className={`ab-hlink ab-wide-only${isCurrent(pathname, '/sign-in') ? ' on' : ''}`}>Sign in</Link>
            )}
            {/* Hidden while gated, same rule as PublicLayout's FloatingCart: no door we won't open. */}
            {!gated && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                {cartLink('ab-hlink')}
                {CART_PAGE_ROUTE_EXISTS && (
                  <button type="button" className="ab-cart-glyph" aria-label="Open cart drawer" onClick={openDrawer}>
                    <ShoppingCart size={14} strokeWidth={1.5} aria-hidden="true" />
                  </button>
                )}
              </span>
            )}
            {showAdmin && <Link to="/admin" className="ab-hlink ab-wide-only">Admin</Link>}
            <button
              ref={menuBtnRef}
              type="button"
              className="ab-menu-btn"
              aria-expanded={open}
              aria-controls="siteMenu"
              onClick={() => setOpen(o => !o)}
            >
              Menu
            </button>
          </span>
        </Wrap>
      </header>

      <div
        id="siteMenu"
        ref={menuRef}
        className={`ab-menu${open ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Site menu"
        aria-hidden={!open}
        // inert keeps the closed field out of the tab order and the AT tree
        {...(!open ? { inert: '' as unknown as boolean } : {})}
      >
        <Wrap className="ab-sm-in">
          <div className="ab-sm-top">
            <Link to="/" className="ab-mark" aria-label="Axis & Bloom home" onClick={() => setOpen(false)}>
              <MarkLockup tone="paper" />
            </Link>
            <button type="button" className="ab-caps ab-menu-close" onClick={() => setOpen(false)}>Close</button>
          </div>
          <nav className="ab-sm-nav" aria-label="Site">
            {items.map(item => {
              const on = isCurrent(pathname, item.to);
              return (
                <Link key={item.to} to={item.to} className={on ? 'on' : undefined} aria-current={on ? 'page' : undefined} onClick={() => setOpen(false)}>
                  <span className="ab-m-n">{item.n}</span>
                  <span className="ab-m-t">{item.label}</span>
                  <ArrowIcon size={22} strokeWidth={1} />
                </Link>
              );
            })}
          </nav>
          <div className="ab-sm-foot ab-caps">
            <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {signedIn ? (
                <>
                  <Link to="/profile" onClick={() => setOpen(false)}>Profile</Link>
                  <span aria-hidden="true">·</span>
                  <button type="button" onClick={handleSignOut}>Sign out</button>
                </>
              ) : (
                <Link to="/sign-in" onClick={() => setOpen(false)}>Sign in</Link>
              )}
              {!gated && (<><span aria-hidden="true">·</span>{cartLink('')}</>)}
              {showAdmin && (<><span aria-hidden="true">·</span><Link to="/admin" onClick={() => setOpen(false)}>Admin</Link></>)}
            </span>
            <span style={{ fontWeight: 400 }}>Coffee, personalized.</span>
          </div>
        </Wrap>
      </div>
    </>
  );
}
