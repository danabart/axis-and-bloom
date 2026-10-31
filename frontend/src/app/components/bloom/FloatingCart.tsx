import { motion, AnimatePresence } from 'motion/react';
import { Link, useLocation } from 'react-router';
import { useAuth } from '../../context/AuthContext';
import type { CartItem } from './types';
import { formatPrice } from './types';
import { CartLines, ShippingLine, cartSubtotalCents, useCheckoutRules } from './CartLines';

interface FloatingCartProps {
  items: CartItem[];
  open: boolean;
  onToggle: () => void;
  onRemove: (index: number) => void;
  /** Commerce 1: goes to /checkout (CartContext.checkout); payment happens there. */
  onCheckout: () => void;
  isSignedIn: boolean;
}

export function FloatingCart({ items, open, onToggle, onRemove, onCheckout, isSignedIn }: FloatingCartProps) {
  const { hasLiamAccess } = useAuth();
  const { pathname } = useLocation();
  const count = items.reduce((sum, i) => sum + i.qty, 0);
  const totalCents = cartSubtotalCents(items);
  const rules = useCheckoutRules();

  return (
    <>
      {/* Talk to Liam — secondary to the cart, sits just to its left.
          Icon-only by design, but a hover/focus label makes it legible on first sight.
          Liam access & cost brief (2026-10-01): subscribers/admins only, and never
          on /sommelier itself (it used to sit on top of the chat input). */}
      {hasLiamAccess && pathname !== '/sommelier' && <Link
        to="/sommelier"
        className="group fixed z-[60] rounded-full flex items-center justify-center shadow-lg"
        style={{
          bottom: 28, right: 96, width: 56, height: 56,
          backgroundColor: 'transparent', border: '1.5px solid #9a2918', color: '#9a2918',
        }}
        aria-label="Talk to Liam"
      >
        <span style={{ fontSize: 20 }}>💬</span>
        <span
          className="absolute pointer-events-none opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity duration-150"
          style={{
            right: '100%', marginRight: 10, whiteSpace: 'nowrap',
            backgroundColor: '#9a2918', color: '#f2f1ea',
            fontSize: 12, padding: '6px 12px', borderRadius: 999,
          }}
        >
          Talk to Liam
        </span>
      </Link>}

      {/* Floating icon — persists across the whole scroll */}
      <button
        onClick={onToggle}
        className="fixed z-[60] rounded-full flex items-center justify-center shadow-lg"
        style={{ bottom: 28, right: 28, width: 56, height: 56, backgroundColor: '#9a2918', color: '#f2f1ea' }}
        aria-label="Cart"
      >
        <span style={{ fontSize: 20 }}>🛍</span>
        {count > 0 && (
          <span
            className="absolute rounded-full flex items-center justify-center text-xs"
            style={{ top: -4, right: -4, width: 20, height: 20, backgroundColor: '#ee5974', color: '#fff' }}
          >
            {count}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.97 }}
            transition={{ duration: 0.25 }}
            className="fixed z-[60] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            style={{ bottom: 96, right: 28, width: 360, maxWidth: 'calc(100vw - 40px)', maxHeight: '70vh', backgroundColor: '#fff', border: '1px solid #e0dcd4' }}
          >
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: '#e0dcd4' }}>
              <p className="text-sm uppercase tracking-widest" style={{ color: '#9a2918' }}>Your cart</p>
              <button onClick={onToggle} className="text-sm" style={{ color: '#8a8070' }}>✕</button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {items.length === 0 && (
                <p className="text-sm" style={{ color: '#a09880' }}>Your cart is empty.</p>
              )}
              <CartLines items={items} onRemove={onRemove} />
            </div>

            {items.length > 0 && (
              <div className="px-5 py-4 border-t space-y-3" style={{ borderColor: '#e0dcd4' }}>
                <div className="flex items-center justify-between text-sm">
                  <span style={{ color: '#8a8070' }}>Subtotal</span>
                  <span style={{ color: '#4a4035' }}>{formatPrice(totalCents)}</span>
                </div>
                <ShippingLine items={items} rules={rules} />
                {isSignedIn ? (
                  <button
                    onClick={onCheckout}
                    className="w-full text-sm px-4 py-2.5 rounded-full text-white"
                    style={{ backgroundColor: '#9a2918' }}
                  >
                    Checkout
                  </button>
                ) : (
                  <Link
                    to="/sign-in?redirect=/checkout"
                    className="block text-center w-full text-sm px-4 py-2.5 rounded-full text-white"
                    style={{ backgroundColor: '#9a2918' }}
                  >
                    Sign in to check out
                  </Link>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
