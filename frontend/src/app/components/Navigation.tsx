import { ShoppingCart, User } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { useAuth } from '../context/AuthContext';

export default function Navigation() {
  const location = useLocation();
  const { user } = useAuth();
  const menuColor = '#a33726';

  return (
    <nav className="fixed top-0 left-0 right-0 w-full px-12 py-4 flex justify-between items-center z-50">
      <Link to="/" className="flex items-center gap-2 hover:opacity-60 transition-opacity">
        <span className="text-sm tracking-wide font-semibold" style={{ color: '#b05642' }}>
          AXIS & BLOOM
        </span>
      </Link>

      <div className="flex items-center gap-10 text-sm" style={{ color: menuColor }}>
        <Link to="/how-it-works" className="hover:opacity-60 transition-opacity">How it works</Link>
        <Link to="/find-my-flavor" className="hover:opacity-60 transition-opacity">Find my flavor</Link>
        <Link to="/about" className="hover:opacity-60 transition-opacity">About</Link>
        <Link to="/shop" className="hover:opacity-60 transition-opacity">Shop</Link>
        <span className="mx-1 opacity-50">|</span>
        <Link to={user ? '/profile' : '/sign-in'} className="flex items-center gap-2 hover:opacity-60 transition-opacity">
          <User size={16} strokeWidth={1.5} />
          {user ? 'Profile' : 'Sign in'}
        </Link>
        <button className="relative hover:opacity-60 transition-opacity" aria-label="Shopping cart">
          <ShoppingCart size={20} strokeWidth={1.5} />
          <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center text-xs text-white" style={{ backgroundColor: '#963e2d' }}>
            0
          </span>
        </button>
      </div>
    </nav>
  );
}
