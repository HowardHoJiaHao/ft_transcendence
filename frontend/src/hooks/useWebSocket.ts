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
		// Set when the server tells us this socket is being replaced by a
		// login elsewhere (same account, another tab/browser). Without this,
		// the kicked side auto-reconnects, kicks the new one back, and the
		// two sockets ping-pong connect/disconnect forever.
		let sessionReplaced = false;

		const connect = () => {
			if (stopped || ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING)
				return;

			const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
			const endpoint = `${protocol}//${window.location.host}/api/v1/ws`;
			const socket = new WebSocket(endpoint);
			ws = socket;

			socket.onopen = () => {
				retryDelay = 1000;
				console.log('WS open'); // TEMP DEBUG
				socket.send(JSON.stringify({ type: 'auth', token }));
			};
			socket.onclose = (event) => {
				// TEMP DEBUG: chasing the intermittent connect/disconnect
				// flicker. code/reason tell us whether this is a real network
				// drop (1006), a server-initiated close (auth_error, hub
				// kicking a stale socket), or a clean shutdown. Remove once
				// diagnosed.
				console.log('WS close', { code: event.code, reason: event.reason, wasClean: event.wasClean });
				if (ws === socket) ws = null;
				setIsConnected(false);
				if (!stopped && !sessionReplaced) {
					reconnectTimer = setTimeout(connect, retryDelay);
					retryDelay = Math.min(retryDelay * 2, 30000);
				}
			};
			socket.onerror = (event) => {
				// onclose schedules the retry and owns connection state.
				console.log('WS error', event); // TEMP DEBUG
			};
			socket.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data) as WebSocketMessage | { type: string };
					if (data.type === 'auth_ok') {
						setIsConnected(true);
						return;
					}
					if (data.type === 'auth_error') {
						socket.close();
						return;
					}
					if (data.type === 'session_replaced') {
						sessionReplaced = true;
					}
					messageHandlers.forEach((handler) => handler(data as WebSocketMessage));
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
