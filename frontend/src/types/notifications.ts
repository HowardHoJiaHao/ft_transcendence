export type NotificationType =
  | 'message'
  | 'friend_added'
  | 'order_new'
  | 'order_completed';

export type NotificationActor = {
  id: number;
  username: string;
  avatarUrl?: string;
};

export type NotificationData = {
  count?: number;
  preview?: string;
  profileUserId?: number;
  orderId?: number;
  listingId?: number;
  listingTitle?: string;
  quantity?: number;
};

export type AppNotification = {
  id: number;
  type: NotificationType;
  actor?: NotificationActor;
  resourceId?: number;
  data: NotificationData;
  readAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type NotificationPage = {
  notifications: AppNotification[];
  unreadCount: number;
  nextCursor: string | null;
};
