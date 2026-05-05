'use client';

import { useWebSocketContext } from '@/context/WebSocketContext';
import styles from './OnlineStatus.module.css';

interface Props {
	userId: number;
	showDot?: boolean;
}

export default function OnlineStatus({ userId, showDot = true }: Props) {
	const { onlineUsers } = useWebSocketContext();
	const isOnline = onlineUsers.has(userId);
	const statusClass = isOnline ? styles['status-online'] : styles['status-offline'];

	return (
		<span className={`${styles['status-text']} ${statusClass}`}>
			{showDot && (isOnline ? '●' : '○')}
			{isOnline ? 'Online' : 'Offline'}
		</span>
	)
}