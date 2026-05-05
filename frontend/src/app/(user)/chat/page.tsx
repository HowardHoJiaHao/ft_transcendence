'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/modules/user/components/AuthContext'
import ChatModal from './ChatModal';
import type { PrivateMessage, Conversation } from '@/types/websocket';
import styles from './chat.module.css';

export default function ChatPage() {
	const { user } = useAuth();
	const [conversations, setConversations] = useState<Conversation[]>([]);
	const [selectedPartner, setSelectedPartner] = useState<number | null>(null);
	const [messages, setMessages] = useState<PrivateMessage[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		if (user)
			fetchConversations();
	}, [user]);

	const fetchConversations = async() => {
		try
		{
			const token = localStorage.getItem('token') || `token_${user?.id}`;
			const res = await fetch('http://localhost:8080/api/v1/conversations', {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (res.ok)
			{
				const data = await res.json();
				setConversations(data.conversations || []);
			}
		}
		catch (err)
		{
			console.error('Failed to fetch conversations: ', err);
		}
		finally
		{
			setLoading(false);
		}
	};

	const openChat = async (partnerId: number) => 
	{
		//setSelectedPartner(partnerId);
		try
		{
			const token = localStorage.getItem('token') || `token_${user?.id}`;
			const res = await fetch(`http://localhost:8080/api/v1/messages/${partnerId}`, {
				headers: { Authorization: `Bearer ${token}`},
			});
			if (res.ok)
			{
				const data = await res.json();
				setMessages(data.messages || []);
			}
			else
			{
				setMessages([]);
			}
		}
		catch (err)
		{
			console.error('Failed to fetch messages: ', err);
		}
		setSelectedPartner(partnerId); //will try
	};

	const handleNewMessages = (msg: PrivateMessage) =>
	{
		if (msg.sender_id === selectedPartner || msg.receiver_id === selectedPartner)
		{
			setMessages(prev => [...prev, msg]);
		}
		fetchConversations();
	};

	if (loading)
		return <div>Loading...</div>

	return (
		<div className={styles.container}>
		  <h1 className={styles.title}>Your Conversations</h1>

		  {conversations.length === 0 ? (
			<div className={styles.emptyState}>No conversations yet.</div>
		  ) : (
			<ul className={styles.conversationList}>
			  {conversations.map((conv) =>
				<li key={conv.partner_id} onClick={() => openChat(conv.partner_id)} className={styles.conversationItem}>
				  <div className={styles.avatar}>
					{conv.partner_avatar_url ? 
					  (<img src={conv.partner_avatar_url} alt="" />) : (<span className={styles.avatarPlaceholder}>{conv.partner_username[0]}</span>)}
				  </div>
				  <div className={styles.conversationInfo}>
					<div className={styles.conversationName}>{conv.partner_username}</div>
				  </div>
				  <div>
					{new Date(conv.last_message_at).toLocaleDateString()}
				  </div>
				</li>
			  )}
			</ul>
		  )}
		{selectedPartner && (
			<ChatModal partnerId={selectedPartner} messages={messages} onClose={() => setSelectedPartner(null)}/>
		)}
		</div>
	);
}