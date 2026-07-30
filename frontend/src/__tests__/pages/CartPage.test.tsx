// Unit tests for checkout authentication, trusted request shape, and backend failure handling.
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
import { LanguageProvider } from '@/context/LanguageContext';

function renderCartPage() {
  return render(
    <LanguageProvider>
      <CartPage />
    </LanguageProvider>,
  );
}

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

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
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

  it('submits a controlled survey row for a newly created order', async () => {
    localStorage.setItem('token', 'valid-jwt');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ orders: [{ id: 91 }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([{
          id: 91,
          listingId: 10,
          quantity: 2,
          totalPrice: 200,
          status: 'pending',
          paymentMethod: 'meetup',
          createdAt: new Date().toISOString(),
          listingTitle: 'Racket',
          listingImage: '',
          sellerName: 'seller',
          recommendationSurveySubmitted: false,
        }]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 1, orderId: 91 }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderCartPage();
    await user.click(screen.getByRole('button', { name: 'Checkout' }));
    await user.click(await screen.findByRole('button', { name: 'Complete survey for order #91' }));

    const selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[0], '18-25');
    await user.selectOptions(selects[1], 'prefer_not_to_say');
    await user.selectOptions(selects[2], '1-3_years');
    await user.selectOptions(selects[3], 'attacking');
    await user.selectOptions(selects[4], '200-400');
    await user.click(screen.getByRole('button', { name: 'Add training row' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const [url, options] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(url).toBe('/api/v1/orders/91/recommendation-survey');
    expect(options.method).toBe('POST');
    expect(JSON.parse(String(options.body))).toEqual({
      age_group: '18-25',
      gender: 'prefer_not_to_say',
      experience_level: '1-3_years',
      play_style: 'attacking',
      budget_range: '200-400',
    });
    expect(mocks.showToast).toHaveBeenCalledWith('Training row added', 'success');
  });
});
