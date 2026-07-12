import { motion, AnimatePresence } from 'motion/react';
import { Link } from 'react-router';
import type { CartItem } from './types';
import { formatPrice, formatWeight } from './types';

interface FloatingCartProps {
  items: CartItem[];
  open: boolean;
  onToggle: () => void;
  onRemove: (index: number) => void;
  onCheckout: () => void;
  checkoutStatus: 'idle' | 'loading' | 'success' | 'error';
  checkoutMessage: string | null;
  isSignedIn: boolean;
}

export function FloatingCart({ items, open, onToggle, onRemove, onCheckout, checkoutStatus, checkoutMessage, isSignedIn }: FloatingCartProps) {
  const count = items.reduce((sum, i) => sum + i.qty, 0);
  const totalCents = items.reduce((sum, i) => sum + i.retailPriceCents * i.qty, 0);

  return (
    <>
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
            style={{ bottom: 96, right: 28, width: 360, maxHeight: '70vh', backgroundColor: '#fff', border: '1px solid #e0dcd4' }}
          >
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: '#e0dcd4' }}>
              <p className="text-sm uppercase tracking-widest" style={{ color: '#9a2918' }}>Your cart</p>
              <button onClick={onToggle} className="text-sm" style={{ color: '#8a8070' }}>✕</button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {items.length === 0 && (
                <p className="text-sm" style={{ color: '#a09880' }}>Your cart is empty.</p>
              )}
              {items.map((item, i) => (
                <div key={i} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-normal truncate" style={{ color: '#4a4035' }}>{item.platformName}</p>
                    <p className="text-xs" style={{ color: '#a09880' }}>
                      {item.archetypeLabel} · {formatWeight(item.weightOz)} · qty {item.qty}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-sm" style={{ color: '#4a4035' }}>{formatPrice(item.retailPriceCents * item.qty)}</span>
                    <button onClick={() => onRemove(i)} className="text-xs" style={{ color: '#c8887c' }}>Remove</button>
                  </div>
                </div>
              ))}
            </div>

            {items.length > 0 && (
              <div className="px-5 py-4 border-t space-y-3" style={{ borderColor: '#e0dcd4' }}>
                <div className="flex items-center justify-between text-sm">
                  <span style={{ color: '#8a8070' }}>Subtotal</span>
                  <span style={{ color: '#4a4035' }}>{formatPrice(totalCents)}</span>
                </div>
                {isSignedIn ? (
                  <button
                    onClick={onCheckout}
                    disabled={checkoutStatus === 'loading'}
                    className="w-full text-sm px-4 py-2.5 rounded-full text-white disabled:opacity-60"
                    style={{ backgroundColor: '#9a2918' }}
                  >
                    {checkoutStatus === 'loading' ? 'Placing order…' : 'Checkout'}
                  </button>
                ) : (
                  <Link
                    to="/sign-in?redirect=/bloom"
                    className="block text-center w-full text-sm px-4 py-2.5 rounded-full text-white"
                    style={{ backgroundColor: '#9a2918' }}
                  >
                    Sign in to check out
                  </Link>
                )}
                {checkoutMessage && (
                  <p className="text-xs" style={{ color: checkoutStatus === 'error' ? '#c8887c' : '#7c9e87' }}>
                    {checkoutMessage}
                  </p>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
