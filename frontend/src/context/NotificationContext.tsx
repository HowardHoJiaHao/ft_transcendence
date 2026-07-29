'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useAuth } from '@/context/AuthContext';
import { useWebSocketContext } from '@/context/WebSocketContext';
import type { AppNotification, NotificationPage } from '@/types/notifications';

type NotificationContextValue = {
  notifications: AppNotification[];
  unreadCount: number;
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: boolean;
  panelOpen: boolean;
  sessionNewIds: Set<number>;
  openPanel: () => void;
  closePanel: () => void;
  loadMore: () => Promise<void>;
  retry: () => Promise<void>;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function sortNotifications(items: AppNotification[]) {
  return [...items].sort((first, second) => {
    const timeOrder = new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime();
    return timeOrder || second.id - first.id;
  });
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { isConnected, subscribe } = useWebSocketContext();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [sessionNewIds, setSessionNewIds] = useState<Set<number>>(new Set());
  const panelOpenRef = useRef(false);
  const notificationsRef = useRef<AppNotification[]>([]);
  const userIDRef = useRef<number | null>(null);
  const wasConnectedRef = useRef(false);

  useEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);

  const markRead = useCallback(async (ids: number[]) => {
    if (ids.length === 0) return;
    const requestedUserID = userIDRef.current;
    if (!requestedUserID) return;
    try {
      const response = await fetch('/api/v1/notifications/read', {
        method: 'PATCH',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids }),
      });
      if (!response.ok) throw new Error('mark read failed');
      const result = await response.json() as { unreadCount: number };
      if (userIDRef.current !== requestedUserID) return;
      const readAt = new Date().toISOString();
      const idSet = new Set(ids);
      setNotifications(previous => previous.map(item =>
        idSet.has(item.id) && !item.readAt ? { ...item, readAt } : item,
      ));
      setUnreadCount(result.unreadCount);
    } catch {
      // Keep the server-provided unread state so a later retry can recover.
      if (userIDRef.current === requestedUserID) setError(true);
    }
  }, []);

  const markVisible = useCallback((items: AppNotification[]) => {
    const unreadIDs = items.filter(item => !item.readAt).map(item => item.id);
    if (unreadIDs.length === 0) return;
    setSessionNewIds(previous => {
      const next = new Set(previous);
      unreadIDs.forEach(id => next.add(id));
      return next;
    });
    void (async () => {
      for (let index = 0; index < unreadIDs.length; index += 100) {
        await markRead(unreadIDs.slice(index, index + 100));
      }
    })();
  }, [markRead]);

  const fetchLatest = useCallback(async (markIfOpen = false) => {
    const requestedUserID = userIDRef.current;
    if (!requestedUserID) return;
    setLoading(true);
    setError(false);
    try {
      const response = await fetch('/api/v1/notifications?limit=20', {
        headers: authHeaders(),
      });
      if (!response.ok) throw new Error('load notifications failed');
      const page = await response.json() as NotificationPage;
      if (userIDRef.current !== requestedUserID) return;
      setNotifications(page.notifications);
      setUnreadCount(page.unreadCount);
      setNextCursor(page.nextCursor);
      if (markIfOpen || panelOpenRef.current) markVisible(page.notifications);
    } catch {
      if (userIDRef.current === requestedUserID) setError(true);
    } finally {
      if (userIDRef.current === requestedUserID) setLoading(false);
    }
  }, [markVisible]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      userIDRef.current = null;
      panelOpenRef.current = false;
      setNotifications([]);
      setUnreadCount(0);
      setNextCursor(null);
      setPanelOpen(false);
      setSessionNewIds(new Set());
      setError(false);
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    if (userIDRef.current !== user.id) {
      userIDRef.current = user.id;
      panelOpenRef.current = false;
      setNotifications([]);
      setUnreadCount(0);
      setNextCursor(null);
      setPanelOpen(false);
      setSessionNewIds(new Set());
      setError(false);
      setLoading(false);
      setLoadingMore(false);
      void fetchLatest();
    }
  }, [authLoading, fetchLatest, user]);

  useEffect(() => {
    if (isConnected && !wasConnectedRef.current && userIDRef.current) {
      void fetchLatest(panelOpenRef.current);
    }
    wasConnectedRef.current = isConnected;
  }, [fetchLatest, isConnected]);

  useEffect(() => subscribe(message => {
    if (message.type !== 'notification_upsert') return;
    const incoming = message.notification;
    setNotifications(previous => {
      const withoutIncoming = previous.filter(item => item.id !== incoming.id);
      return sortNotifications([incoming, ...withoutIncoming]);
    });
    setUnreadCount(message.unread_count);
    if (panelOpenRef.current) {
      setSessionNewIds(previous => new Set(previous).add(incoming.id));
      void markRead([incoming.id]);
    }
  }), [markRead, subscribe]);

  const openPanel = useCallback(() => {
    panelOpenRef.current = true;
    setPanelOpen(true);
    markVisible(notificationsRef.current);
    if (error && !loading) void fetchLatest(true);
  }, [error, fetchLatest, loading, markVisible]);

  const closePanel = useCallback(() => {
    panelOpenRef.current = false;
    setPanelOpen(false);
    setSessionNewIds(new Set());
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const requestedUserID = userIDRef.current;
    if (!requestedUserID) return;
    setLoadingMore(true);
    setError(false);
    try {
      const response = await fetch(
        `/api/v1/notifications?limit=20&before=${encodeURIComponent(nextCursor)}`,
        { headers: authHeaders() },
      );
      if (!response.ok) throw new Error('load more notifications failed');
      const page = await response.json() as NotificationPage;
      if (userIDRef.current !== requestedUserID) return;
      setNotifications(previous => {
        const byID = new Map(previous.map(item => [item.id, item]));
        page.notifications.forEach(item => byID.set(item.id, item));
        return sortNotifications([...byID.values()]);
      });
      setUnreadCount(page.unreadCount);
      setNextCursor(page.nextCursor);
      if (panelOpenRef.current) markVisible(page.notifications);
    } catch {
      if (userIDRef.current === requestedUserID) setError(true);
    } finally {
      if (userIDRef.current === requestedUserID) setLoadingMore(false);
    }
  }, [loadingMore, markVisible, nextCursor]);

  const retry = useCallback(async () => {
    await fetchLatest(panelOpenRef.current);
  }, [fetchLatest]);

  return (
    <NotificationContext.Provider value={{
      notifications,
      unreadCount,
      nextCursor,
      loading,
      loadingMore,
      error,
      panelOpen,
      sessionNewIds,
      openPanel,
      closePanel,
      loadMore,
      retry,
    }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotifications must be used within NotificationProvider');
  return context;
}
