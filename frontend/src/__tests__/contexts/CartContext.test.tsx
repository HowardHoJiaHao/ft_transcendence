// Unit tests for cart persistence, totals, quantity validation, and removal behavior.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CartProvider, useCart } from '@/context/CartContext';

const racket = {
  id: 10,
  title: 'Yonex Astrox',
  price: 100,
  image: '/racket.jpg',
};

function CartHarness() {
  const {
    items,
    addToCart,
    updateQuantity,
    clearCart,
    total,
    itemCount,
  } = useCart();
  return (
    <div>
      <span data-testid="items">{JSON.stringify(items)}</span>
      <span data-testid="count">{itemCount}</span>
      <span data-testid="total">{total}</span>
      <button onClick={() => addToCart(racket)}>Add one</button>
      <button onClick={() => addToCart(racket, 2)}>Add two</button>
      <button onClick={() => addToCart(racket, -3)}>Add invalid</button>
      <button onClick={() => updateQuantity(racket.id, 4)}>Set four</button>
      <button onClick={() => updateQuantity(racket.id, 0)}>Set zero</button>
      <button onClick={clearCart}>Clear</button>
    </div>
  );
}

describe('CartProvider', () => {
  it('restores stored items and computes quantity and price totals', async () => {
    localStorage.setItem('cart', JSON.stringify([{ ...racket, quantity: 2 }]));
    render(
      <CartProvider>
        <CartHarness />
      </CartProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'));
    expect(screen.getByTestId('total')).toHaveTextContent('200');
  });

  it('merges duplicate products and persists the updated cart', async () => {
    const user = userEvent.setup();
    render(
      <CartProvider>
        <CartHarness />
      </CartProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Add one' }));
    await user.click(screen.getByRole('button', { name: 'Add two' }));

    expect(screen.getByTestId('count')).toHaveTextContent('3');
    expect(screen.getByTestId('total')).toHaveTextContent('300');
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('cart') ?? '[]')).toEqual([
        { ...racket, quantity: 3 },
      ]);
    });
  });

  it('rejects negative quantities and removes an item when quantity reaches zero', async () => {
    const user = userEvent.setup();
    render(
      <CartProvider>
        <CartHarness />
      </CartProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Add invalid' }));
    expect(screen.getByTestId('count')).toHaveTextContent('0');

    await user.click(screen.getByRole('button', { name: 'Add one' }));
    await user.click(screen.getByRole('button', { name: 'Set four' }));
    expect(screen.getByTestId('count')).toHaveTextContent('4');

    await user.click(screen.getByRole('button', { name: 'Set zero' }));
    expect(screen.getByTestId('items')).toHaveTextContent('[]');
  });

  it('discards corrupted or unsafe stored cart data', async () => {
    localStorage.setItem('cart', JSON.stringify([{ ...racket, quantity: -50 }]));
    render(
      <CartProvider>
        <CartHarness />
      </CartProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('0'));
    expect(localStorage.getItem('cart')).toBe('[]');
  });
});
