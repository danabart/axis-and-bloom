import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { CartProvider, useCart } from '../../context/CartContext';
import type { CartItem } from '../bloom/types';

// Website 8 Part D — CartContext.setQuantity is the one quantity writer: it
// sets a line's qty, 0 removes it, and the line keeps its isSameLine identity
// (a later addToCart of the same thing merges into it, never a second line).

let api: ReturnType<typeof useCart>;
function Probe() { api = useCart(); return null; }
function mount() {
  render(<MemoryRouter><CartProvider><Probe /></CartProvider></MemoryRouter>);
}
afterEach(() => cleanup());

const coado: CartItem = { kind: 'dial', archetype: 'chocolate_nutty', archetypeLabel: 'Chocolate & Nutty', dialSortOrder: 2, weightOz: 12, platformName: 'Coado', retailPriceCents: 3200, qty: 1 };
const floralSet: CartItem = { kind: 'collection', archetype: 'floral', archetypeLabel: 'Floral', memberCount: 3, retailPriceCents: 8100, undiscountedPriceCents: 9000, qty: 1 };

describe('CartContext.setQuantity', () => {
  it('sets the qty and merges a later add of the same line', () => {
    mount();
    act(() => { api.addToCart(coado); api.addToCart(floralSet); });
    act(() => api.setQuantity(0, 3));
    expect(api.cart.map(i => i.qty)).toEqual([3, 1]);
    act(() => api.addToCart({ ...coado }));
    expect(api.cart).toHaveLength(2);
    expect(api.cart[0].qty).toBe(4);
    // a different weight is a different line
    act(() => api.addToCart({ ...coado, weightOz: 16 }));
    expect(api.cart).toHaveLength(3);
  });

  it('removes the line at 0 (or less) and leaves the others', () => {
    mount();
    act(() => { api.addToCart(coado); api.addToCart(floralSet); });
    act(() => api.setQuantity(0, 0));
    expect(api.cart).toHaveLength(1);
    expect(api.cart[0].kind).toBe('collection');
    act(() => api.setQuantity(0, -1));
    expect(api.cart).toHaveLength(0);
  });
});
