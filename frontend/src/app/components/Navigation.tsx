import { useEffect, useState } from 'react';
import { ShoppingCart, User } from 'lucide-react';
import { Link, useNavigate, useLocation } from 'react-router';
import { useAuth } from '../context/AuthContext';
import logoMark from '../../design/LOGO/LogoQuarter1.svg';

export default function Navigation() {
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const handleSignOut = async () => { await logout(); navigate('/'); };

  // true = hero section is visible = transparent nav
  const [heroVisible, setHeroVisible] = useState(pathname === '/');

  // Reset on route change (prevents stale state when navigating between pages)
  useEffect(() => {
    setHeroVisible(pathname === '/');
  }, [pathname]);

  // IntersectionObserver on [data-hero] — switches state as hero enters/leaves view
  useEffect(() => {
    const hero = document.querySelector('[data-hero]');
    if (!hero) {
      setHeroVisible(false);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => setHeroVisible(entry.isIntersecting),
      { threshold: 0 }
    );
    io.observe(hero);
    return () => io.disconnect();
  }, [pathname]);

  const linkColor = heroVisible ? '#f2f1ea' : '#9a2918';

  const LINK: React.CSSProperties = {
    fontFamily: "'Lato', Arial, sans-serif",
    fontSize: '10.5px',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: linkColor,
    textDecoration: 'none',
    transition: 'color 250ms, opacity 150ms',
  };

  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
      height: 46,
      backgroundColor: heroVisible ? 'transparent' : '#f2f1ea',
      borderBottom: heroVisible ? 'none' : '1px solid #c5c7c8',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 clamp(24px, 5vw, 64px)',
      transition: 'background-color 250ms, border-color 250ms',
    }}>

      {/* Logo lockup */}
      <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', flexShrink: 0 }}>
        <img src={logoMark} alt="Axis & Bloom" style={{ height: 17, width: 'auto' }} />
        <span style={{ fontFamily: "'Lato', Arial, sans-serif", color: linkColor, fontSize: 17, letterSpacing: '0.1em', fontWeight: 400, lineHeight: 1, transition: 'color 250ms' }}>
          AXIS & BLOOM
        </span>
      </Link>

      <div className="hidden md:flex" style={{ alignItems: 'center', gap: 'clamp(14px, 2vw, 28px)' }}>
        <Link to="/the-axis"        style={LINK} className="hover:opacity-50">THE AXIS</Link>
        <Link to="/bloom"           style={LINK} className="hover:opacity-50">THE BLOOM</Link>
        <Link to="/how-it-works"    style={LINK} className="hover:opacity-50">HOW IT WORKS</Link>
        <Link to="/find-my-flavor"  style={LINK} className="hover:opacity-50">FIND MY FLAVOR</Link>
        <Link to="/coffees"         style={LINK} className="hover:opacity-50">OUR COFFEES</Link>
        <Link to="/about"           style={LINK} className="hover:opacity-50">ABOUT</Link>
        <Link to="/shop"            style={LINK} className="hover:opacity-50">SHOP</Link>
        {isAdmin && <Link to="/admin" style={LINK} className="hover:opacity-50">ADMIN</Link>}
      </div>

      {/* Icons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexShrink: 0 }}>
        <Link
          to={user ? '/profile' : '/sign-in'} aria-label="Profile"
          style={{ color: linkColor, display: 'flex', alignItems: 'center', transition: 'color 250ms' }}
          className="hover:opacity-50"
        >
          <User size={17} strokeWidth={1.5} />
        </Link>
        {user && (
          <button
            onClick={handleSignOut} aria-label="Sign out"
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: "'Lato', Arial, sans-serif", fontSize: '10.5px', letterSpacing: '0.1em', color: linkColor, textTransform: 'uppercase', opacity: 0.55, transition: 'color 250ms' }}
            className="hidden md:block hover:opacity-100"
          >
            Sign out
          </button>
        )}
        <button
          aria-label="Shopping cart"
          style={{ position: 'relative', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: linkColor, display: 'flex', alignItems: 'center', transition: 'color 250ms' }}
          className="hover:opacity-50"
        >
          <ShoppingCart size={17} strokeWidth={1.5} />
          <span style={{
            position: 'absolute', top: -7, right: -7,
            width: 14, height: 14, borderRadius: '50%',
            backgroundColor: '#ee5974', color: '#f2f1ea',
            fontSize: 9, lineHeight: '14px', textAlign: 'center',
            fontFamily: "'Lato', Arial, sans-serif", fontWeight: 400,
          }}>0</span>
        </button>
      </div>

    </nav>
  );
}
