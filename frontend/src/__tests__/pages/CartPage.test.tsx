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
    t: (key: string, values?: Record<string, string | number>) => {
      const message = ({
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
      'cart.title': 'Shopping Cart ({count} items)',
      'cart.purchasesTitle': 'My Purchases',
      'cart.tabCart': 'Cart',
      'cart.tabPurchases': 'My Purchases',
      'cart.empty': 'Your cart is empty',
      'cart.continueShopping': 'Continue Shopping',
      'cart.loginToView': 'Please login to view purchases',
      'cart.login': 'Login',
      'cart.loadingPurchases': 'Loading purchases…',
      'cart.noPurchases': 'No purchases yet',
      'cart.startShopping': 'Start Shopping',
      'cart.seller': 'Seller: {name}',
      'cart.sellerFallback': 'Seller',
      'cart.orderedOn': 'Ordered {date} · Qty {quantity}',
      'cart.lotOf': 'Lot of {count}',
      'cart.qtyOne': 'Qty 1',
      'cart.remove': 'Remove {title}',
      'cart.orderSummary': 'Order Summary',
      'cart.subtotal': 'Subtotal',
      'cart.shipping': 'Shipping',
      'cart.free': 'Free',
      'cart.total': 'Total',
      'cart.checkout': 'Checkout',
      'cart.checkingOut': 'Checking out…',
      'cart.clearCart': 'Clear cart',
      'cart.statusPending': 'Pending Delivery',
      'cart.statusCompleted': 'Delivered',
      'cart.statusCancelled': 'Cancelled',
      'cart.statusRefunded': 'Refunded',
      'cart.loginFirst': 'Please login first',
      'cart.loginAgain': 'Please login again',
      'cart.checkoutFailed': 'Checkout failed',
      'cart.checkoutSuccess': 'Checkout successful',
      'cart.checkoutNetworkError': 'Network error during checkout',
      'cart.loadPurchasesFailed': 'Failed to load purchases',
      'cart.sold': 'Sold',
      'productReviews.writeReview': 'Write a review',
      'productReviews.ratingLabel': 'Your rating',
      'productReviews.commentLabel': 'Your review',
      'productReviews.commentPlaceholder': 'Share your experience with this product',
      'productReviews.submit': 'Post review',
      'productReviews.submitting': 'Posting…',
      'productReviews.validationRequired': 'Choose a rating and write a review first.',
      'productReviews.submitSuccess': 'Your review has been posted.',
      'productReviews.submitFailed': 'Unable to post your review.',
      'productReviews.alreadyReviewed': 'You have already reviewed this product.',
      'mlSurvey.checkoutSuccess': 'Checkout successful',
      'mlSurvey.checkoutPrompt': 'Your purchase can now add a real row to the ML training dataset.',
      'mlSurvey.completeForOrder': 'Complete survey for order #{id}',
      'mlSurvey.complete': 'Complete ML survey',
      'mlSurvey.submitted': 'ML survey submitted',
      'mlSurvey.title': 'ML training survey — order #{id}',
      'mlSurvey.description': 'Choose one option for every field.',
      'mlSurvey.ageGroup': 'Age group',
      'mlSurvey.gender': 'Gender',
      'mlSurvey.experience': 'Experience level',
      'mlSurvey.playStyle': 'Play style',
      'mlSurvey.budget': 'Budget range',
      'mlSurvey.chooseOption': 'Choose an option',
      'mlSurvey.cancel': 'Cancel',
      'mlSurvey.submit': 'Add training row',
      'mlSurvey.submitting': 'Submitting…',
      'mlSurvey.submitSuccess': 'Training row added',
      'mlSurvey.submitFailed': 'Failed to submit ML survey',
    } as Record<string, string>)[key] || key;
      return Object.entries(values ?? {}).reduce(
        (result, [name, value]) => result.replace(`{${name}}`, String(value)),
        message,
      );
    },
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

function renderCartPage() {
  return render(<CartPage />);
}

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
          listingReviewSubmitted: false,
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

  it('lets a buyer review a meetup purchase immediately after checkout', async () => {
    localStorage.setItem('token', 'valid-jwt');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ orders: [{ id: 91 }] }) })
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
          listingReviewSubmitted: false,
        }]),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 22 }) });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderCartPage();
    await user.click(screen.getByRole('button', { name: 'Checkout' }));
    await user.click(await screen.findByRole('button', { name: 'Write a review' }));
    await user.selectOptions(screen.getByLabelText('Your rating'), '5');
    await user.type(screen.getByLabelText('Your review'), 'Excellent racket');
    await user.click(screen.getByRole('button', { name: 'Post review' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const [url, options] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(url).toBe('/api/v1/products/10/reviews');
    expect(options.method).toBe('POST');
    expect(JSON.parse(String(options.body))).toEqual({ rating: 5, comment: 'Excellent racket' });
    expect(mocks.showToast).toHaveBeenCalledWith('Your review has been posted.', 'success');
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
