import { ShoppingCart, User } from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '../context/AuthContext';
import logoMark from '../../design/LOGO/LogoQuarter1.svg'

const NAV_LINK: React.CSSProperties = {
  fontFamily: "Arial, sans-serif",
  fontSize: '0.875rem',
  letterSpacing: '0.04em',
  color: '#9a2918',
  textDecoration: 'none',
  opacity: 1,
  transition: 'opacity 0.2s',
};

export default function Navigation() {
  const { user, isAdmin } = useAuth();

  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
      height: 64,
      backgroundColor: '#f2f1ea',
      borderBottom: '1px solid rgba(154,41,24,0.1)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 clamp(24px, 5vw, 64px)',
    }}>

      {/* Logo lockup */}
      <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none', flexShrink: 0 }}>
        <img src={logoMark} alt="Axis & Bloom" style={{ height: 20, width: 'auto' }} />
        <span style={{ fontFamily: "Arial, sans-serif", color: '#9a2918', fontSize: 20, letterSpacing: '0.1em', fontWeight: 400, lineHeight: 1 }}>
          AXIS & BLOOM
        </span>
      </Link>

      {/* Primary nav — hidden on mobile */}
      <div className="hidden md:flex" style={{ alignItems: 'center', gap: 'clamp(20px, 3vw, 40px)' }}>
        <Link to="/the-axis" style={NAV_LINK} className="hover:opacity-50 transition-opacity">The Axis</Link>
        <Link to="/how-it-works" style={NAV_LINK} className="hover:opacity-50 transition-opacity">How it works</Link>
        <Link to="/find-my-flavor" style={NAV_LINK} className="hover:opacity-50 transition-opacity">Find my flavor</Link>
        <Link to="/coffees" style={NAV_LINK} className="hover:opacity-50 transition-opacity">Our coffees</Link>
        <Link to="/about" style={NAV_LINK} className="hover:opacity-50 transition-opacity">About</Link>
        <Link to="/shop" style={NAV_LINK} className="hover:opacity-50 transition-opacity">Shop</Link>
        {isAdmin && (
          <Link to="/admin" style={NAV_LINK} className="hover:opacity-50 transition-opacity">Admin</Link>
        )}
      </div>

      {/* Icons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexShrink: 0 }}>
        <Link to={user ? '/profile' : '/sign-in'} aria-label="Profile" style={{ color: '#9a2918', display: 'flex', alignItems: 'center' }} className="hover:opacity-50 transition-opacity">
          <User size={18} strokeWidth={1.5} />
        </Link>
        <button
          aria-label="Shopping cart"
          style={{ position: 'relative', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#9a2918', display: 'flex', alignItems: 'center' }}
          className="hover:opacity-50 transition-opacity"
        >
          <ShoppingCart size={18} strokeWidth={1.5} />
          <span style={{
            position: 'absolute', top: -7, right: -7,
            width: 15, height: 15, borderRadius: '50%',
            backgroundColor: '#ee5974', color: '#f2f1ea',
            fontSize: 9, lineHeight: '15px', textAlign: 'center',
            fontFamily: "Arial, sans-serif", fontWeight: 400,
          }}>0</span>
        </button>
      </div>

    </nav>
  );
}
