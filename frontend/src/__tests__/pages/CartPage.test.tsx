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
  assignCheckoutLocation: vi.fn(),
  createCheckoutRequestId: vi.fn(() => '8f41ea04-716f-4ca2-9cf2-33fd2da0d72f'),
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
vi.mock('@/context/LanguageContext', () => ({
  useI18n: () => ({
    t: (key: string) => ({
      'cart.paymentMethod': 'Payment method',
      'cart.meetupPayment': 'Meet up / COD',
      'cart.stripePayment': 'Stripe sandbox card payment',
      'cart.stripeSandboxNotice': 'Test mode only.',
      'cart.stripeMissingUrl': 'Stripe checkout could not be opened. Your cart was preserved.',
      'cart.stripeConfirming': 'We are confirming your Stripe payment.',
      'cart.stripeReceived': 'Payment received.',
      'cart.stripeCancelled': 'Payment was not confirmed.',
      'cart.paymentLabel': 'Payment',
      'cart.paymentAwaiting': 'Awaiting confirmation',
      'cart.paymentPaid': 'Paid',
      'cart.paymentFailed': 'Card attempt failed',
      'cart.paymentExpired': 'Expired',
      'cart.paymentRefunded': 'Refunded',
    } as Record<string, string>)[key] || key,
  }),
}));
vi.mock('@/lib/browserNavigation', () => ({
  assignCheckoutLocation: mocks.assignCheckoutLocation,
  createCheckoutRequestId: mocks.createCheckoutRequestId,
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

describe('CartPage checkout', () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.showToast.mockReset();
    mocks.clearCart.mockReset();
    mocks.removeFromCart.mockReset();
    mocks.updateQuantity.mockReset();
    mocks.assignCheckoutLocation.mockReset();
    mocks.createCheckoutRequestId.mockClear();
    mocks.auth.user = { id: 42, username: 'alice' };
    mocks.cart.items = [{ id: 10, title: 'Racket', price: 100, image: '', quantity: 2 }];
    mocks.cart.total = 200;
    window.history.replaceState({}, '', '/cart');
    vi.unstubAllGlobals();
  });

  it('redirects unauthenticated users without sending an order', async () => {
    mocks.auth.user = null;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(<CartPage />);
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
    render(<CartPage />);
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
    render(<CartPage />);
    await user.click(screen.getByRole('button', { name: 'Checkout' }));

    expect(await screen.findByText('Insufficient stock for listing')).toBeInTheDocument();
    expect(mocks.showToast).toHaveBeenCalledWith('Insufficient stock for listing', 'error');
    expect(mocks.clearCart).not.toHaveBeenCalled();
  });

  it('selects Stripe, sends only trusted fields, and redirects to Checkout', async () => {
    localStorage.setItem('token', 'valid-jwt');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ checkoutUrl: 'https://checkout.stripe.com/c/pay/test' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(<CartPage />);
    await user.click(screen.getByLabelText('Stripe sandbox card payment'));
    await user.click(screen.getByRole('button', { name: 'Checkout' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(options.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      items: [{ listingId: 10, quantity: 2 }],
      paymentMethod: 'stripe',
    });
    expect(body.checkoutRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(body).not.toHaveProperty('price');
    expect(body).not.toHaveProperty('total');
    expect(body).not.toHaveProperty('sellerId');
    expect(body).not.toHaveProperty('sellerEmail');
    expect(body).not.toHaveProperty('connectedAccountId');
    expect(body).not.toHaveProperty('platformFee');
    expect(mocks.clearCart).toHaveBeenCalledOnce();
    expect(mocks.assignCheckoutLocation).toHaveBeenCalledWith(
      'https://checkout.stripe.com/c/pay/test',
    );
    expect(mocks.showToast).not.toHaveBeenCalledWith('Checkout successful', 'success');
  });

  it('preserves the cart when Stripe response has no checkout URL', async () => {
    localStorage.setItem('token', 'valid-jwt');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }));

    const user = userEvent.setup();
    render(<CartPage />);
    await user.click(screen.getByLabelText('Stripe sandbox card payment'));
    await user.click(screen.getByRole('button', { name: 'Checkout' }));

    expect(await screen.findByText(
      'Stripe checkout could not be opened. Your cart was preserved.',
    )).toBeInTheDocument();
    expect(mocks.clearCart).not.toHaveBeenCalled();
    expect(mocks.assignCheckoutLocation).not.toHaveBeenCalled();
  });

  it('reuses the checkout request UUID after an ambiguous network failure', async () => {
    localStorage.setItem('token', 'valid-jwt');
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ checkoutUrl: 'https://checkout.stripe.com/c/pay/retry' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(<CartPage />);
    await user.click(screen.getByLabelText('Stripe sandbox card payment'));
    await user.click(screen.getByRole('button', { name: 'Checkout' }));
    expect(await screen.findByText('Network error during checkout')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Checkout' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const retryBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(retryBody.checkoutRequestId).toBe(firstBody.checkoutRequestId);
    expect(mocks.createCheckoutRequestId).toHaveBeenCalledOnce();
    expect(mocks.clearCart).toHaveBeenCalledOnce();
  });

  it('treats the Stripe success URL as informational and reloads purchases', async () => {
    localStorage.setItem('token', 'valid-jwt');
    window.history.replaceState({}, '', '/cart?checkout=stripe-return');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([{
        id: 1,
        listingId: 10,
        quantity: 2,
        totalPrice: 200,
        status: 'pending',
        paymentMethod: 'stripe',
        paymentStatus: 'awaiting_payment',
        createdAt: new Date().toISOString(),
        listingTitle: 'Racket',
        listingImage: '',
        sellerName: 'seller',
      }]),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CartPage />);

    expect(await screen.findByText('We are confirming your Stripe payment.')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls.every(([, options]) => !options || options.method !== 'POST')).toBe(true);
    expect(mocks.clearCart).not.toHaveBeenCalled();
  });

  it('renders the webhook-derived Stripe payment status', async () => {
    localStorage.setItem('token', 'valid-jwt');
    window.history.replaceState({}, '', '/cart?checkout=stripe-return');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ([{
        id: 1,
        listingId: 10,
        quantity: 2,
        totalPrice: 200,
        status: 'pending',
        paymentMethod: 'stripe',
        paymentStatus: 'paid',
        createdAt: new Date().toISOString(),
        listingTitle: 'Racket',
        listingImage: '',
        sellerName: 'seller',
      }]),
    }));

    render(<CartPage />);

    expect(await screen.findByText('Payment received.')).toBeInTheDocument();
    expect(await screen.findByText('Payment: Paid')).toBeInTheDocument();
  });

  it('does not mark payment paid from the Stripe cancel URL', async () => {
    window.history.replaceState({}, '', '/cart?checkout=stripe-cancelled');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<CartPage />);

    expect(await screen.findByText('Payment was not confirmed.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.clearCart).not.toHaveBeenCalled();
  });
});
