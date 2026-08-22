import type { AppNotification } from './notifications';

export interface PrivateMessage {
	id?: number;
	sender_id: number;
	receiver_id: number;
	content: string;
	created_at: string;
}

export interface Conversation {
	partner_id: number;
	partner_username: string;
	partner_avatar_url?: string;
	last_message_at: string;
}

export interface OnlineUser {
	id: number;
	username: string;
	avatar_url?: string;
}

export interface DirectoryUser {
	id: number;
	username: string;
	avatar_url?: string;
	is_seller: boolean;
	is_buyer: boolean;
}

export interface WSPrivateMessage {
	type: 'private_message';
	sender_id: number;
	receiver_id: number;
	content: string;
	created_at: string;
	id: number;
}

export interface OnlineStatusMessage {
	type: 'user_online' | 'user_offline';
	user_id: number;
}

export interface OnlineUsersMessage {
	type: 'online_users';
	user_ids: number[];
}

export interface WSNotificationUpsert {
	type: 'notification_upsert';
	notification: AppNotification;
	unread_count: number;
}

// Sent by the hub to a socket it's about to close because the same account
// logged in elsewhere and took over the single-session slot. Lets the
// frontend tell this apart from a network drop and skip auto-reconnect.
export interface SessionReplacedMessage {
	type: 'session_replaced';
}

export type WSMessage =
	| WSPrivateMessage
	| OnlineStatusMessage
	| OnlineUsersMessage
	| WSNotificationUpsert
	| SessionReplacedMessage;
