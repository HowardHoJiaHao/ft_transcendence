// Unit tests for checkout authentication, trusted request shape, and backend failure handling.
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/context/LanguageContext';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  showToast: vi.fn(),
  clearCart: vi.fn(),
  removeFromCart: vi.fn(),
  updateQuantity: vi.fn(),
  cart: {
    items: [{ id: 10, title: 'Racket', price: 100, image: '', quantity: 2 }],
    total: 200,
  },
  auth: {
    user: { id: 42, username: 'alice' } as { id: number; username: string } | null,
  },
}));

vi.mock('@/context/CartContext', () => ({
  useCart: () => ({
    ...mocks.cart,
    clearCart: mocks.clearCart,
    removeFromCart: mocks.removeFromCart,
    updateQuantity: mocks.updateQuantity,
  }),
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mocks.auth,
}));
vi.mock('@/components/Toast/ToastContext', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}));
vi.mock('@/components/Header/Header', () => ({
  default: () => <div data-testid="header" />,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import CartPage from '@/app/(user)/cart/page';

// The page reads its copy through useI18n, so it needs the real provider —
// which also keeps these assertions checking the English messages users see.
const renderCartPage = () => render(
  <LanguageProvider>
    <CartPage />
  </LanguageProvider>,
);

describe('CartPage checkout', () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.showToast.mockReset();
    mocks.clearCart.mockReset();
    mocks.removeFromCart.mockReset();
    mocks.updateQuantity.mockReset();
    mocks.auth.user = { id: 42, username: 'alice' };
    mocks.cart.items = [{ id: 10, title: 'Racket', price: 100, image: '', quantity: 2 }];
    mocks.cart.total = 200;
    vi.unstubAllGlobals();
  });

  it('redirects unauthenticated users without sending an order', async () => {
    mocks.auth.user = null;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderCartPage();
    await user.click(screen.getByRole('button', { name: 'Checkout' }));

    expect(mocks.showToast).toHaveBeenCalledWith('Please login first', 'error');
    expect(mocks.push).toHaveBeenCalledWith('/login');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends only listing IDs and quantities with the bearer token', async () => {
    localStorage.setItem('token', 'valid-jwt');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderCartPage();
    await user.click(screen.getByRole('button', { name: 'Checkout' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/orders');
    expect(options).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-jwt',
      },
    });
    expect(JSON.parse(String(options.body))).toEqual({
      items: [{ listingId: 10, quantity: 2 }],
      paymentMethod: 'meetup',
    });
    expect(mocks.clearCart).toHaveBeenCalledOnce();
    expect(mocks.showToast).toHaveBeenCalledWith('Checkout successful', 'success');
  });

  it('preserves the cart and displays the server error when checkout fails', async () => {
    localStorage.setItem('token', 'valid-jwt');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Insufficient stock for listing' }),
    }));

    const user = userEvent.setup();
    renderCartPage();
    await user.click(screen.getByRole('button', { name: 'Checkout' }));

    expect(await screen.findByText('Insufficient stock for listing')).toBeInTheDocument();
    expect(mocks.showToast).toHaveBeenCalledWith('Insufficient stock for listing', 'error');
    expect(mocks.clearCart).not.toHaveBeenCalled();
  });
});
