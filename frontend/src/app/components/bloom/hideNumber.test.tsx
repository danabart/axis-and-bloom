// Usual Drink 4 (2026-11-26), D2 — DialArchetypeSection's hideNumber leaves the
// archetype number out of the breakout header and keeps the name; without it
// (the Bloom page, Find My Flavor) the number shows as before. The dial itself
// is stubbed (canvas).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('./dial/BloomDial', () => ({ BloomDial: () => <div data-testid="dial-stub" /> }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: null, loading: false, hasLiamAccess: false }) }));
vi.mock('../../context/CartContext', () => ({ useCart: () => ({ addToCart: vi.fn(), items: [] }) }));
vi.mock('./CartLines', () => ({ useCheckoutRules: () => null, shippingCentsFor: () => 0 }));

import { DialArchetypeSection } from './DialArchetypeSection';
import { buildDialConfig } from './dial/archetypeConfig';
import type { ArchetypeData } from './types';

afterEach(cleanup);

const data = {
  archetype: 'chocolate_nutty', archetypeLabel: 'Chocolate & Nutty', customerWords: ['Full', 'Grounded', 'Comforting'],
  dimensionName: null, dimensionPlatformName: null, dimensionScaleMinLabel: null, dimensionScaleMaxLabel: null,
  slots: [], doors: null, collection: null,
} as unknown as ArchetypeData;

const draw = (extra: Record<string, unknown>) => render(
  <MemoryRouter>
    <DialArchetypeSection data={data} index={0} selectedSortOrder={1} revealedKeys={new Set()} onDialSelect={() => {}}
      onToggleReveal={() => {}} onAddToCart={() => {}} onCompare={() => {}} userArchetype={null} registerDialRef={() => {}}
      folded unfoldMode="breakout" {...extra} />
  </MemoryRouter>,
);

describe('hideNumber (D2)', () => {
  const no = `NO. ${buildDialConfig(data)!.no}`;
  it('shows the number by default', () => {
    draw({});
    expect(screen.getByText('Chocolate & Nutty')).toBeTruthy();
    expect(screen.getByText(no)).toBeTruthy();
  });
  it('hides the number and keeps the name', () => {
    draw({ hideNumber: true });
    expect(screen.getByText('Chocolate & Nutty')).toBeTruthy();
    expect(screen.queryByText(no)).toBeNull();
    expect(document.body.textContent).not.toContain('NO.');
  });
});
