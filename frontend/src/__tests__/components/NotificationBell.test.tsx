import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NotificationBell from '@/components/NotificationBell/NotificationBell';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  closePanel: vi.fn(),
  openPanel: vi.fn(),
  loadMore: vi.fn(),
  retry: vi.fn(),
  notifications: [] as Array<Record<string, unknown>>,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => '/',
}));

vi.mock('@/context/LanguageContext', () => ({
  useI18n: () => ({
    lang: 'en',
    t: (key: string, vars?: Record<string, string | number>) => {
      const messages: Record<string, string> = {
        'notifications.title': 'Notifications',
        'notifications.bell': 'Notifications',
        'notifications.bellUnread': '{count} unread notifications',
        'notifications.unread': '{count} unread',
        'notifications.new': 'New',
        'notifications.someone': 'Someone',
        'notifications.anItem': 'an item',
        'notifications.messageMany': '{name} sent you {count} messages',
        'notifications.reviewAdded': '{name} gave your {title} a {rating}-star review',
        'notifications.loading': 'Loading notifications…',
        'notifications.loadingMore': 'Loading more…',
        'notifications.empty': 'You have no notifications yet.',
        'notifications.error': 'Notifications could not be loaded.',
        'notifications.retry': 'Try again',
        'notifications.loadMore': 'Load more',
        'notifications.end': 'You’re all caught up',
      };
      return (messages[key] || key).replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? `{${name}}`));
    },
  }),
}));

vi.mock('@/context/NotificationContext', () => ({
  useNotifications: () => ({
    notifications: mocks.notifications,
    unreadCount: 120,
    nextCursor: null,
    loading: false,
    loadingMore: false,
    error: false,
    panelOpen: true,
    sessionNewIds: new Set([7]),
    openPanel: mocks.openPanel,
    closePanel: mocks.closePanel,
    loadMore: mocks.loadMore,
    retry: mocks.retry,
  }),
}));

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notifications = [{
      id: 7,
      type: 'message',
      actor: { id: 4, username: 'Alex' },
      data: { count: 4, preview: 'Are you still selling this racket?' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }];
  });

  it('caps the badge, identifies new grouped messages, and routes to chat', () => {
    render(<NotificationBell />);

    expect(screen.getByText('99+')).toBeInTheDocument();
    expect(screen.getByText('Alex sent you 4 messages')).toBeInTheDocument();
    expect(screen.getByText('Are you still selling this racket?')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();

    mocks.closePanel.mockClear();
    fireEvent.click(screen.getByText('Alex sent you 4 messages'));
    expect(mocks.closePanel).toHaveBeenCalledOnce();
    expect(mocks.push).toHaveBeenCalledWith('/chat?partner=4');
  });

  it('routes a review notification to the reviewed product', () => {
    mocks.notifications = [{
      id: 8,
      type: 'review_added',
      actor: { id: 4, username: 'Alex' },
      data: { listingId: 10, listingTitle: 'Astrox 99', rating: 5 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }];

    render(<NotificationBell />);
    fireEvent.click(screen.getByText('Alex gave your Astrox 99 a 5-star review'));
    expect(mocks.push).toHaveBeenCalledWith('/products/10');
  });
});
