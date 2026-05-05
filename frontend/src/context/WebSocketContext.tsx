'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useAuth } from '@/modules/user/components/AuthContext';
import { useWebSocket } from '@/hooks/useWebSocket';
import { WSMessage } from '@/types/websocket';

export type WebSocketMessage = WSMessage;

interface WebSocketContextType {
	isConnected: boolean;
	sendMessage: (receiverId: number, content: string) => boolean;
	onlineUsers: Set<number>;
	subscribe: (handler: (msg: WebSocketMessage) => void) => () => void;
}

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
	const { user } = useAuth();

	const token = typeof window !== 'undefined' ? localStorage.getItem('token'): null;

	const [onlineUsers, setOnlineUsers] = useState<Set<number>>(new Set());

	const { isConnected, sendMessage: wsSend, onMessage } = useWebSocket(token);

	useEffect(() => {
		const unsubscribe = onMessage((msg: WebSocketMessage) => {
			if (msg.type === 'user_online') {
				setOnlineUsers(prev => new Set(prev).add(msg.user_id));
			} else if (msg.type === 'user_offline') {
				setOnlineUsers(prev => {
					const next = new Set(prev);
					next.delete(msg.user_id);
					return next;
				});
			}
		});

		return unsubscribe;
	}, []);

	return (
		<WebSocketContext.Provider value={{
			isConnected,
			sendMessage: wsSend,
			onlineUsers,
			subscribe: onMessage,
		}}>
			{children}
		</WebSocketContext.Provider>
	);
}

export function useWebSocketContext() {
	const ctx = useContext(WebSocketContext);
	if (!ctx)
		throw new Error('useWebSocketContext must be used with within WebSocketProvider');
	return ctx;
}