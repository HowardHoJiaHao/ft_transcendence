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

export interface WSPrivateMessage {
	type: 'private_message';
	sender_id: number;
	receiver_id: number;
	content: string;
	created_at: string;
	id: number;
}

export interface PresenceEvent {
	type: 'user_online' | 'user_offline';
	user_id: number;
}

export type WSMessage = WSPrivateMessage | PresenceEvent; 