'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { useI18n } from '@/context/LanguageContext';
import { useNotifications } from '@/context/NotificationContext';
import { PLACEHOLDER_AVATAR, resolveAvatarUrl } from '@/lib/avatar';
import type { AppNotification } from '@/types/notifications';

type NotificationBellProps = {
  onBeforeOpen?: () => void;
};

function notificationTarget(item: AppNotification) {
  switch (item.type) {
    case 'message':
      return item.actor ? `/chat?partner=${item.actor.id}` : '/chat';
    case 'friend_added':
      return item.actor ? `/user/${item.actor.id}` : '/friends';
    case 'order_new':
      return '/profile/my-ads?tab=pending';
    case 'order_completed':
      return '/cart';
  }
}

function notificationIcon(type: AppNotification['type']) {
  switch (type) {
    case 'message': return '💬';
    case 'friend_added': return '👥';
    case 'order_new': return '🛍️';
    case 'order_completed': return '✓';
  }
}

export default function NotificationBell({ onBeforeOpen }: NotificationBellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { t, lang } = useI18n();
  const {
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
  } = useNotifications();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    closePanel();
  }, [closePanel, pathname]);

  useEffect(() => {
    if (!panelOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) closePanel();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePanel();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [closePanel, panelOpen]);

  const describe = (item: AppNotification) => {
    const actor = item.actor?.username || t('notifications.someone');
    const title = item.data.listingTitle || t('notifications.anItem');
    switch (item.type) {
      case 'message':
        return (item.data.count || 1) > 1
          ? t('notifications.messageMany', { name: actor, count: item.data.count || 1 })
          : t('notifications.messageOne', { name: actor });
      case 'friend_added':
        return t('notifications.friendAdded', { name: actor });
      case 'order_new':
        return t('notifications.orderNew', {
          name: actor,
          count: item.data.quantity || 1,
          title,
        });
      case 'order_completed':
        return t('notifications.orderCompleted', { name: actor, title });
    }
  };

  const relativeTime = (date: string) => {
    const timestamp = new Date(date).getTime();
    if (!Number.isFinite(timestamp)) return '';
    const seconds = Math.round((timestamp - Date.now()) / 1000);
    const formatter = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
    if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second');
    const minutes = Math.round(seconds / 60);
    if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
    const days = Math.round(hours / 24);
    if (Math.abs(days) < 7) return formatter.format(days, 'day');
    return new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(new Date(timestamp));
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className={`relative w-9 h-9 rounded-full border bg-[var(--light)] cursor-pointer inline-flex items-center justify-center p-0 transition-colors ${
          panelOpen ? 'border-[var(--primary)]' : 'border-[var(--border)] hover:bg-[#e9ecef]'
        }`}
        onClick={() => {
          if (panelOpen) {
            closePanel();
          } else {
            onBeforeOpen?.();
            openPanel();
          }
        }}
        aria-haspopup="dialog"
        aria-expanded={panelOpen}
        aria-label={unreadCount > 0
          ? t('notifications.bellUnread', { count: unreadCount })
          : t('notifications.bell')}
        title={t('notifications.title')}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="w-[19px] h-[19px] fill-none stroke-current stroke-2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 bg-[#ef4444] text-white rounded-full text-[10px] font-bold flex items-center justify-center border-2 border-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {panelOpen && (
        <section
          role="dialog"
          aria-label={t('notifications.title')}
          className="absolute right-0 top-[calc(100%+9px)] z-[1150] w-[min(390px,calc(100vw-24px))] bg-white border border-[#e5e7eb] rounded-xl shadow-[0_12px_35px_rgba(0,0,0,0.16)] overflow-hidden max-[600px]:fixed max-[600px]:left-3 max-[600px]:right-3 max-[600px]:top-20 max-[600px]:w-auto"
        >
          <div className="px-4 py-3 border-b border-[#eeeeec] flex items-center justify-between">
            <h2 className="m-0 text-base font-bold text-[#222]">{t('notifications.title')}</h2>
            {unreadCount > 0 && (
              <span className="text-xs font-semibold text-[#dc2626]">
                {t('notifications.unread', { count: unreadCount })}
              </span>
            )}
          </div>

          <div className="max-h-[min(520px,calc(100vh-150px))] overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <p className="m-0 p-6 text-center text-sm text-[#6b7280]">{t('notifications.loading')}</p>
            ) : error && notifications.length === 0 ? (
              <div className="p-6 text-center">
                <p className="mt-0 mb-3 text-sm text-[#b91c1c]">{t('notifications.error')}</p>
                <button type="button" onClick={() => void retry()} className="btn btn-secondary btn-sm">
                  {t('notifications.retry')}
                </button>
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center">
                <div aria-hidden="true" className="text-3xl mb-2">🔔</div>
                <p className="m-0 text-sm text-[#6b7280]">{t('notifications.empty')}</p>
              </div>
            ) : (
              <ul className="list-none m-0 p-0">
                {notifications.map(item => {
                  const isSessionNew = sessionNewIds.has(item.id);
                  return (
                    <li key={item.id} className="border-b border-[#f0f0ee] last:border-b-0">
                      <button
                        type="button"
                        className={`w-full border-0 text-left px-3.5 py-3 flex gap-3 cursor-pointer transition-colors hover:bg-[#f7f7f5] ${
                          isSessionNew || !item.readAt ? 'bg-[#fff5f7]' : 'bg-white'
                        }`}
                        onClick={() => {
                          closePanel();
                          router.push(notificationTarget(item));
                        }}
                      >
                        <span className="relative shrink-0 w-10 h-10">
                          {item.actor?.avatarUrl ? (
                            <img
                              src={resolveAvatarUrl(item.actor.avatarUrl)}
                              alt=""
                              className="w-10 h-10 rounded-full object-cover bg-[#f3f4f6]"
                              onError={event => {
                                event.currentTarget.src = PLACEHOLDER_AVATAR;
                              }}
                            />
                          ) : (
                            <span className="w-10 h-10 rounded-full bg-[#f1f1ef] flex items-center justify-center text-lg">
                              {notificationIcon(item.type)}
                            </span>
                          )}
                          <span className="absolute -right-1 -bottom-1 w-5 h-5 rounded-full bg-white border border-[#e5e7eb] flex items-center justify-center text-[10px]">
                            {notificationIcon(item.type)}
                          </span>
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-[#262626] leading-5">{describe(item)}</span>
                          {item.type === 'message' && item.data.preview && (
                            <span className="block text-xs text-[#6b7280] truncate mt-0.5">{item.data.preview}</span>
                          )}
                          <span className="block text-[11px] text-[#8b8b86] mt-1">{relativeTime(item.updatedAt)}</span>
                        </span>

                        {(isSessionNew || !item.readAt) && (
                          <span className="shrink-0 flex flex-col items-end gap-1">
                            <span className="text-[10px] font-bold uppercase tracking-wide text-[#c2185b]">
                              {t('notifications.new')}
                            </span>
                            <span aria-hidden="true" className="w-2 h-2 rounded-full bg-[#ef4444]" />
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {notifications.length > 0 && (
              <div className="p-3 text-center border-t border-[#eeeeec]">
                {nextCursor ? (
                  <button
                    type="button"
                    className="bg-transparent border-0 text-[var(--primary)] font-semibold text-sm cursor-pointer px-3 py-1.5 disabled:opacity-50"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                  >
                    {loadingMore ? t('notifications.loadingMore') : t('notifications.loadMore')}
                  </button>
                ) : (
                  <span className="text-xs text-[#8b8b86]">{t('notifications.end')}</span>
                )}
                {error && (
                  <button type="button" onClick={() => void retry()} className="block mx-auto mt-2 bg-transparent border-0 text-xs text-[#b91c1c] underline cursor-pointer">
                    {t('notifications.retry')}
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
