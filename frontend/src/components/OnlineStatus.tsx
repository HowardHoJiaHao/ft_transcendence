'use client';

import { useWebSocketContext } from '@/context/WebSocketContext';

interface Props {
	userId: number;
	showDot?: boolean;
}

export default function OnlineStatus({ userId, showDot = true }: Props) {
	const { onlineUsers } = useWebSocketContext();
	const isOnline = onlineUsers.has(userId);

	return (
		<span className={isOnline ? 'text-green-500' : 'text-[var(--secondary)]'}>
			{showDot && (isOnline ? '●' : '○')}
			{isOnline ? 'Online' : 'Offline'}
		</span>
	)
}
