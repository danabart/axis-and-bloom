import { Outlet, useLocation } from 'react-router';
import Navigation from './Navigation';
import Footer from './Footer';
import NewsletterModal from './NewsletterModal';
import { FloatingCart } from './bloom/FloatingCart';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { usePrelaunchGated } from '../lib/prelaunch';

export default function PublicLayout() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { cart, cartOpen, toggleCartOpen, removeFromCart, checkout, checkoutStatus, checkoutMessage } = useCart();
  const gated = usePrelaunchGated();

  // When the pre-launch page is active, suppress nav and footer entirely
  // so nothing is visible beneath the fixed full-screen overlay
  const isPreLaunchPage = gated && pathname === '/';

  // These pages render Footer inside TasteFinderSection (behind the curtain reveal)
  const footerInPage = pathname === '/' || pathname === '/about';

  // Quiz page has its own footer handling; suppress the global one
  const noFooter = footerInPage || pathname === '/find-my-flavor';

  if (isPreLaunchPage) {
    return <Outlet />;
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Navigation />
      <main className="flex-grow">
        <Outlet />
      </main>
      {!noFooter && <Footer />}
      <NewsletterModal />
      {/* Layout-level so any page wrapped here shares one cart UI automatically
          (The Bloom Part 10, Phase B) instead of each page rendering its own.
          Hidden while gated — there's no checkout behind it before launch,
          and Add to Cart is hidden everywhere the same flag applies. */}
      {!gated && (
        <FloatingCart
          items={cart}
          open={cartOpen}
          onToggle={toggleCartOpen}
          onRemove={removeFromCart}
          onCheckout={checkout}
          checkoutStatus={checkoutStatus}
          checkoutMessage={checkoutMessage}
          isSignedIn={!!user}
        />
      )}
    </div>
  );
}
