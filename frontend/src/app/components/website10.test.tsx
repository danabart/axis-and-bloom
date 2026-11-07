import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';

// Website 10 (2026-11-07): /about and /how-it-works forward to Home and The
// Axis (query params carried); /checkout/return shows the order's status label
// from the API (v_order_status.customer_label, OT-96), never a typed word.
// backend/src/features/website_handoff/CLAUDE_CODE_PROMPT_WEBSITE_10_CLOSEOUT.md

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: null, hasLiamAccess: false }) }));
vi.mock('../context/CartContext', () => ({ useCart: () => ({ clear: vi.fn() }), toCheckoutItems: (x: unknown) => x }));
vi.mock('../lib/errorReporter', () => ({ reportError: vi.fn() }));
const getCheckoutSessionStatus = vi.fn();
vi.mock('../lib/api', async (orig) => ({ ...(await orig<typeof import('../lib/api')>()), getCheckoutSessionStatus: (...a: unknown[]) => getCheckoutSessionStatus(...a) }));

import { ShortLink, RETIRED_ROUTES } from '../App';
import CheckoutReturnPage from './checkout/CheckoutReturnPage';

afterEach(() => { cleanup(); getCheckoutSessionStatus.mockReset(); });

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname}{l.search}</p>;
}

function at(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        {Object.entries(RETIRED_ROUTES).map(([from, to]) => <Route key={from} path={from} element={<ShortLink to={to} />} />)}
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
  return screen.getByTestId('where').textContent;
}

describe('retired routes', () => {
  it('/about forwards to Home', () => { expect(at('/about')).toBe('/'); });
  it('/how-it-works forwards to The Axis', () => { expect(at('/how-it-works')).toBe('/the-axis'); });
  it('keeps the incoming query (e.g. ?preview=true)', () => { expect(at('/how-it-works?preview=true')).toBe('/the-axis?preview=true'); });
});

describe('/checkout/return status line', () => {
  it('shows the label the API sends, under "Your order is placed."', async () => {
    getCheckoutSessionStatus.mockResolvedValue({
      status: 'complete', orderId: 'o1', finalized: true, orderPlacedLine: null,
      order: { lines: [{ displayName: 'Classic Balanced', weightOz: 12, quantity: 1 }], shipsTo: { street: '1 Main', city: 'Hoboken', state: 'NJ', postalCode: '07030', country: 'US' },
        subtotalCents: 2900, shippingCents: 595, taxCents: 0, totalCents: 3495, customerLabel: 'Label from the API' },
    });
    render(<MemoryRouter initialEntries={['/checkout/return?session_id=cs_test']}><CheckoutReturnPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('return-status').textContent).toBe('Label from the API'));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Your order is placed.');
  });

  it('shows no status line when the API sends none', async () => {
    getCheckoutSessionStatus.mockResolvedValue({
      status: 'complete', orderId: 'o1', finalized: true, orderPlacedLine: null,
      order: { lines: [], shipsTo: null, subtotalCents: 0, shippingCents: 0, taxCents: 0, totalCents: 0, customerLabel: null },
    });
    render(<MemoryRouter initialEntries={['/checkout/return?session_id=cs_test']}><CheckoutReturnPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeTruthy());
    expect(screen.queryByTestId('return-status')).toBeNull();
  });
});
