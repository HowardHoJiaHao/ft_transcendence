'use client';

import { WebSocketMessage } from '@/context/WebSocketContext';
import { useEffect, useCallback, useState } from 'react';

let ws: WebSocket | null = null;
const messageHandlers = new Set<(msg: WebSocketMessage) => void>();

export function useWebSocket(token: string | null)
{
	const [isConnected, setIsConnected] = useState(false);

	// Reconnect with bounded exponential backoff. Notifications and chat share
	// this one authenticated connection, and consumers refresh durable state
	// when isConnected transitions back to true.
	useEffect(() => {
		if (!token) {
			setIsConnected(false);
			return;
		}

		let stopped = false;
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
		let retryDelay = 1000;

		const connect = () => {
			if (stopped || ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING)
				return;

			const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
			const endpoint = `${protocol}//${window.location.host}/api/v1/ws?token=${encodeURIComponent(token)}`;
			const socket = new WebSocket(endpoint);
			ws = socket;

			socket.onopen = () => {
				retryDelay = 1000;
				setIsConnected(true);
			};
			socket.onclose = () => {
				if (ws === socket) ws = null;
				setIsConnected(false);
				if (!stopped) {
					reconnectTimer = setTimeout(connect, retryDelay);
					retryDelay = Math.min(retryDelay * 2, 30000);
				}
			};
			socket.onerror = () => {
				// onclose schedules the retry and owns connection state.
			};
			socket.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data) as WebSocketMessage;
					messageHandlers.forEach((handler) => handler(data));
				} catch (err) {
					console.error('Failed to parse WebSocket message:', err);
				}
			};
		};

		connect();

		return () => {
			stopped = true;
			if (reconnectTimer) clearTimeout(reconnectTimer);
			const socket = ws;
			ws = null;
			socket?.close();
			setIsConnected(false);
		};
	}, [token])

	const sendMessage = useCallback((receiverId: number, content: string) => {
		if (ws?.readyState !== WebSocket.OPEN) {
			console.error('WebSocket not connected');
			return false;
		}
		ws.send(JSON.stringify({ receiver_id: receiverId, content }));
		return true;
	}, []);

	const onMessage = useCallback((handler: (msg: WebSocketMessage) => void) => {
		messageHandlers.add(handler);
		return () => { messageHandlers.delete(handler) };
	}, []);

	return { isConnected, sendMessage, onMessage };
}
