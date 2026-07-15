import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { getUserProfile, placeOrder } from '../lib/api';
import type { CartItem } from '../components/bloom/types';

interface Address {
  id: number; street: string; city: string; state: string; postal_code: string; country: string;
}

interface CartContextType {
  cart: CartItem[];
  cartOpen: boolean;
  toggleCartOpen: () => void;
  addToCart: (item: CartItem) => void;
  removeFromCart: (index: number) => void;
  checkout: () => Promise<void>;
  checkoutStatus: 'idle' | 'loading' | 'success' | 'error';
  checkoutMessage: string | null;
}

const CartContext = createContext<CartContextType | null>(null);

/**
 * Shared cart — relocated out of BloomPage.tsx (The Bloom Part 10, Phase B) so
 * any page wrapped in this provider can add to the same cart, not just /bloom.
 * Cart shape and add/remove/checkout behavior are unchanged from before the
 * move; the shipping-address/customer-name lookup that checkout needs is now
 * fetched here directly (its own getUserProfile() call) rather than shared
 * with BloomPage's separate userArchetype fetch, keeping the cart provider
 * self-contained and usable independent of any one page's own state.
 */
export function CartProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutStatus, setCheckoutStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [checkoutMessage, setCheckoutMessage] = useState<string | null>(null);
  const [defaultAddress, setDefaultAddress] = useState<Address | null>(null);
  const [customerName, setCustomerName] = useState<{ first: string; last: string } | null>(null);

  useEffect(() => {
    if (!user) { setDefaultAddress(null); setCustomerName(null); return; }
    getUserProfile()
      .then(p => {
        setCustomerName({ first: p?.firstName ?? '', last: p?.lastName ?? '' });
        const addr = (p?.addresses ?? []).find((a: any) => a.address_type === 'shipping') ?? p?.addresses?.[0] ?? null;
        setDefaultAddress(addr ?? null);
      })
      .catch(() => {});
  }, [user]);

  function toggleCartOpen() {
    setCartOpen(v => !v);
  }

  // Same cart line? A dial item matches on (archetype, dialSortOrder, weightOz);
  // a direct (Bloom Dial Base Data Part 3, Phase 6) item matches on (coffeeId, weightOz).
  function isSameLine(a: CartItem, b: CartItem): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'dial' && b.kind === 'dial') {
      return a.archetype === b.archetype && a.dialSortOrder === b.dialSortOrder && a.weightOz === b.weightOz;
    }
    if (a.kind === 'direct' && b.kind === 'direct') {
      return a.coffeeId === b.coffeeId && a.weightOz === b.weightOz;
    }
    return false;
  }

  function addToCart(item: CartItem) {
    setCart(prev => {
      const idx = prev.findIndex(i => isSameLine(i, item));
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, item];
    });
    setCartOpen(true);
  }

  function removeFromCart(index: number) {
    setCart(prev => prev.filter((_, i) => i !== index));
  }

  async function checkout() {
    if (!defaultAddress) {
      setCheckoutStatus('error');
      setCheckoutMessage('Add a shipping address in your Profile before checking out.');
      return;
    }
    setCheckoutStatus('loading');
    setCheckoutMessage(null);
    try {
      await placeOrder({
        items: cart.map(item => item.kind === 'dial'
          ? {
              archetype: item.archetype,
              dialSortOrder: item.dialSortOrder,
              weightOz: item.weightOz,
              quantity: item.qty,
              priceCents: item.retailPriceCents,
            }
          : {
              coffeeId: item.coffeeId,
              weightOz: item.weightOz,
              quantity: item.qty,
              priceCents: item.retailPriceCents,
            }),
        shippingAddress: {
          firstName: customerName?.first || 'Customer',
          lastName: customerName?.last || '',
          address1: defaultAddress.street,
          city: defaultAddress.city,
          province: defaultAddress.state,
          zip: defaultAddress.postal_code,
          country: defaultAddress.country,
        },
      });
      setCheckoutStatus('success');
      setCheckoutMessage('Order placed!');
      setCart([]);
    } catch {
      setCheckoutStatus('error');
      setCheckoutMessage("Checkout isn't live yet — online ordering opens soon. Everything up to this point worked.");
    }
  }

  return (
    <CartContext.Provider value={{ cart, cartOpen, toggleCartOpen, addToCart, removeFromCart, checkout, checkoutStatus, checkoutMessage }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
