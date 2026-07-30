import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationProvider, useNotifications } from '@/context/NotificationContext';

const mocks = vi.hoisted(() => ({
  subscriber: null as null | ((message: unknown) => void),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 9, username: 'member', email: 'member@example.com' },
    loading: false,
  }),
}));

vi.mock('@/context/WebSocketContext', () => ({
  useWebSocketContext: () => ({
    isConnected: false,
    subscribe: (handler: (message: unknown) => void) => {
      mocks.subscriber = handler;
      return () => {
        mocks.subscriber = null;
      };
    },
  }),
}));

function Probe() {
  const state = useNotifications();
  return (
    <div>
      <span data-testid="count">{state.unreadCount}</span>
      <span data-testid="items">{state.notifications.length}</span>
      <span data-testid="new">{String(state.sessionNewIds.has(1))}</span>
      <button onClick={state.openPanel}>open</button>
    </div>
  );
}

describe('NotificationProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('token', 'member-token');
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          notifications: [{
            id: 1,
            type: 'friend_added',
            actor: { id: 2, username: 'Alex' },
            data: { profileUserId: 2 },
            createdAt: '2026-07-29T10:00:00Z',
            updatedAt: '2026-07-29T10:00:00Z',
          }],
          unreadCount: 1,
          nextCursor: null,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ unreadCount: 0 }),
      }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the badge count and marks visible items while retaining session-new state', async () => {
    render(
      <NotificationProvider>
        <Probe />
      </NotificationProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));
    expect(screen.getByTestId('items')).toHaveTextContent('1');

    fireEvent.click(screen.getByText('open'));

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('0'));
    expect(screen.getByTestId('new')).toHaveTextContent('true');
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/v1/notifications/read',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});
