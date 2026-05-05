'use client';

import { WebSocketMessage } from '@/context/WebSocketContext';
import { useEffect, useCallback, useState } from 'react';
import { WSMessage } from '@/types/websocket';

let ws: WebSocket | null = null;
const messageHandlers = new Set<(msg: WebSocketMessage) => void>();

function connect(token: string) {
	if (ws?.readyState === WebSocket.OPEN)
		return ;

	ws = new WebSocket(`ws://localhost:8080/api/v1/ws?token=${token}`);

	ws.onopen = () => console.log('WS connected');
	ws.onclose = (event) =>
	{
		console.warn('WS disconnected', {
			code: event.code, //debug
			reason: event.reason, //debug
			wasClean: event.wasClean, //debug
		});
		ws = null;
	};
	ws.onerror = (err) => console.error('WS error:', err);
	ws.onmessage = (event) => 
	{
		try
		{
			const data = JSON.parse(event.data) as WebSocketMessage;
			messageHandlers.forEach((handler) => handler(data));
		}
		catch(err)
		{
			console.error('Failed to parse WS message:', err);
		}
	};
}

export function useWebSocket(token: string | null)
{
	const [isConnected, setIsConnected] = useState(false);

	//when token change. user login and logout
	useEffect(() => {
		if (!token)
			return
		connect(token)

		return () => {
			ws?.close();
			ws = null;
		};
	}, [token])

	useEffect(() => {
		const checkConn = setInterval(() => {
			setIsConnected(ws?.readyState === WebSocket.OPEN);
		}, 1000);
		return () => clearInterval(checkConn);
	}, []);

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
