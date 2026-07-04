'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';;
import { useWebSocketContext } from '@/context/WebSocketContext';
import type { PrivateMessage } from '@/types/websocket';
import type { WebSocketMessage } from '@/context/WebSocketContext';
import styles from './ChatModal.module.css';

interface ChatModalProps {
	partnerId: number;
	messages: PrivateMessage[];
	onClose: () => void;
}

export default function ChatModal({ partnerId, messages: initialMessages, onClose }: ChatModalProps) {
	const { user } = useAuth();
	const { sendMessage, subscribe, isConnected } = useWebSocketContext();
	const [messages, setMessages] = useState<PrivateMessage[]>(initialMessages);
	const [input, setInput] = useState('');
	const messagesEndRef = useRef<HTMLDivElement>(null);

	useEffect(() => { setMessages(initialMessages); }, [initialMessages]);

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [messages]);

	useEffect(() => {
		const unsubscribe = subscribe((msg: WebSocketMessage) =>
		{
			if (msg.type === 'private_message')
			{
				const createdAt = msg.created_at ?? new Date().toISOString();
				const privateMsg: PrivateMessage = {
					id: msg.id,
					sender_id: msg.sender_id,
					receiver_id: msg.receiver_id,
					content: msg.content,
					created_at: createdAt,
				};
				if (privateMsg.sender_id === partnerId || privateMsg.receiver_id === partnerId)
					setMessages(prev => [...prev, privateMsg]);
			}
		});
		return unsubscribe;
	}, [subscribe, partnerId]);

	const handleSend = () => {
		if (!input.trim())
			return ;
		if (sendMessage(partnerId, input.trim()))
			setInput('');
	};

	const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) =>
	{
		if (e.key == 'Enter' && !e.shiftKey)
		{
			e.preventDefault();
			handleSend();
		}
	};

	const formatTime = (dateString: string) => 
	{
		return new Date(dateString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	};

	return (
		<div className={styles.modalOverlay} onClick={onClose}>
		<div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>

		<div className={styles.header}>
			<h3>Chat</h3>
			<button className={styles.closeButton} onClick={onClose} aria-label="Close chat">×</button>
		</div>

		<div className={styles.messageContainer}>
			{messages.length === 0 ? (
				<div className={styles.emptyState}>
					No messages yet. Start the conversation!
				</div>
			) : (
				messages.map((msg) => {
					const isOwn = msg.sender_id === user?.id;
					return (
					<div key={msg.id} className={`${styles.messageRow} ${isOwn ? styles.messageRowOwn : styles.messageRowOther}`}>
					  <div className={`${styles.messageBubble} ${isOwn ? styles.messageOwn : styles.messageOther}`}>
						<p className={styles.messageContent}>{msg.content}</p>
						<span className={styles.messageTime}>{formatTime(msg.created_at)}</span>
					  </div>
					</div>
					);
				})
			)}
			<div ref={messagesEndRef}></div>
			<div className={styles.inputArea}></div>
				<input type="text" className={styles.input} value={input} onChange={(e) => setInput(e.target.value)}
					onKeyPress={handleKeyPress} placeholder="Type a message..." disabled={!isConnected} />
				<button className={styles.sendButton} onClick={handleSend} disabled={!isConnected || !input.trim()}>Send</button>
			</div>

			<div className={`${styles.statusBar} ${isConnected ? styles.statusConnected : styles.statusDisconnected}`}>
				{isConnected ? '● Connected' : '● Disconnected'}
			</div>
		  </div>
		</div>
	);
}