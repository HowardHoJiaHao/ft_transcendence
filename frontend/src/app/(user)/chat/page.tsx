'use client';

import React, { useState, useEffect } from 'react';

import { useAuth } from '@/context/AuthContext';
import { useWebSocketContext } from '@/context/WebSocketContext';
import { useI18n } from '@/context/LanguageContext';
import Header from '@/components/Header/Header';
import ChatModal from './ChatModal';
import type { PrivateMessage, Conversation, OnlineUser } from '@/types/websocket';

export default function ChatPage() {
	const { user } = useAuth();
	const { onlineUsers } = useWebSocketContext();
	const { t } = useI18n();
	const [conversations, setConversations] = useState<Conversation[]>([]);
	const [onlineChatUsers, setOnlineChatUsers] = useState<OnlineUser[]>([]);
	const [selectedPartner, setSelectedPartner] = useState<number | null>(null);
	const [messages, setMessages] = useState<PrivateMessage[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		if (user)
			fetchConversations();
	}, [user]);

	useEffect(() => {
		if (user)
			fetchOnlineUsers();
	}, [user, onlineUsers]);

	const deleteConversation = async (partnerId: number, e: React.MouseEvent) => {
		e.stopPropagation();
		try
		{
			const token = localStorage.getItem('token') || `token_$(user?.id)`;
			const res = await fetch(`/api/v1/conversations/${partnerId}`, {
				method: 'DELETE',
				headers: { Authorization: `Bearer ${token}` },
			});
			if (res.ok)
			{
				setConversations(prev => prev.filter(c => c.partner_id !== partnerId));
			}
		}
		catch (err)
		{
			console.error('Failed to delete conversation: ', err);
		}
	};

	const fetchConversations = async() => {
		try
		{
			const token = localStorage.getItem('token') || `token_${user?.id}`;
			const res = await fetch('/api/v1/conversations', {
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

	const fetchOnlineUsers = async () => {
		try {
			const token = localStorage.getItem('token') || `token_${user?.id}`;
			const res = await fetch('/api/v1/online-users', {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (res.ok) {
				const data = await res.json();
				setOnlineChatUsers(data.users || []);
			}
		}
		catch (err) {
			console.error('Failed to fetch online users: ', err);
		}
	};

	const openChat = async (partnerId: number) =>
	{
		//setSelectedPartner(partnerId);
		try
		{
			const token = localStorage.getItem('token') || `token_${user?.id}`;
			const res = await fetch(`/api/v1/messages/${partnerId}`, {
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
        <main>
		  <Header />
            <div className="p-5 max-w-[800px] mx-auto">
              <h1 className="text-2xl mb-5">{t('chat.title')}</h1>
              <section className="mb-7" aria-labelledby="online-users-heading">
                <h2 id="online-users-heading" className="text-lg mb-2.5">{t('chat.onlineNow')}</h2>
                {onlineChatUsers.length === 0 ? (
                  <p className="text-[#666] m-0">{t('chat.noOnlineUsers')}</p>
                ) : (
                  <ul className="flex flex-wrap gap-2.5 list-none m-0 p-0">
                    {onlineChatUsers.map((onlineUser) => (
                      <li key={onlineUser.id}>
                        <button
                          className="flex items-center gap-2 border border-[#e5e7eb] rounded-full bg-white cursor-pointer py-1.5 pr-3 pl-1.5 hover:bg-[#f5f5f5]"
                          onClick={() => openChat(onlineUser.id)}
                        >
                          <span className="w-8 h-8 rounded-full">
                            {onlineUser.avatar_url ? (
                              <img src={onlineUser.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                            ) : (
                              <span className="w-full h-full rounded-full bg-[#ccc] flex items-center justify-center text-white font-bold">
                                {onlineUser.username[0]}
                              </span>
                            )}
                          </span>
                          <span className="font-semibold">{onlineUser.username}</span>
                          <span className="w-2 h-2 rounded-full bg-[#22c55e]" aria-label={t('chat.online')} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              {conversations.length === 0 ? (
                <div className="text-center text-[#666] text-lg mt-[50px]">{t('chat.noConversations')}</div>
              ) : (
                <ul className="list-none p-0">
                  {conversations.map((conv) =>
                    <li key={conv.partner_id} onClick={() => openChat(conv.partner_id)} className="flex items-center p-[10px] border-b border-[#eee] cursor-pointer hover:bg-[#f5f5f5]">
                      <div className="w-10 h-10 rounded-full mr-[10px]">
                        {conv.partner_avatar_url ?
                          (<img src={conv.partner_avatar_url} alt="" className="w-full h-full rounded-full object-cover" />) : (<span className="w-full h-full rounded-full bg-[#ccc] flex items-center justify-center text-white font-bold">{conv.partner_username[0]}</span>)}
                      </div>
                      <div className="flex-1">
                        <div className="font-bold m-0">{conv.partner_username}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button className="bg-transparent border-none text-[#ff6b6b] cursor-pointer text-base" onClick={(e) => deleteConversation(conv.partner_id, e)} title="Delete conversation">x</button>
                        {/*<div>{new Date(conv.last_message_at).toLocaleDateString()}</div>*/}
                      </div>
                    </li>
                  )}
                </ul>
              )}
            {selectedPartner && (
            	<ChatModal partnerId={selectedPartner} messages={messages} onClose={() => setSelectedPartner(null)}/>
            )}
            </div>
		</main>
	);
}
