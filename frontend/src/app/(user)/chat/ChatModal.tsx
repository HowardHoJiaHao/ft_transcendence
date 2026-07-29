'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';;
import { useWebSocketContext } from '@/context/WebSocketContext';
import type { PrivateMessage } from '@/types/websocket';
import type { WebSocketMessage } from '@/context/WebSocketContext';

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
		<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]" onClick={onClose}>
		<div className="bg-white w-[500px] h-[600px] rounded-xl flex flex-col shadow-[0_4px_20px_rgba(0,0,0,0.2)] overflow-hidden" onClick={(e) => e.stopPropagation()}>

		<div className="px-5 py-[15px] border-b border-[#eee] flex justify-between items-center">
			<h3 className="m-0 text-lg font-semibold">Chat</h3>
			<button className="bg-none border-none text-2xl cursor-pointer text-[#666] p-0 leading-none hover:text-black" onClick={onClose} aria-label="Close chat">×</button>
		</div>

		<div>
			{messages.length === 0 ? (
				<div className="text-center text-[#888] mt-[50px] text-sm">
					No messages yet. Start the conversation!
				</div>
			) : (
				messages.map((msg) => {
					const isOwn = msg.sender_id === user?.id;
					return (
					<div key={msg.id} className={`flex max-w-full ${isOwn ? 'justify-end' : 'justify-start'}`}>
					  <div className={`max-w-[70%] px-3.5 py-2.5 rounded-[18px] break-words bg-[#f0f0f0] text-black ${isOwn ? 'rounded-br-[4px]' : 'rounded-bl-[4px]'}`}>
						<p className="m-0 text-[17px] leading-[1.4]">{msg.content}</p>
						<span className="text-[10px] opacity-70 block text-right mt-1">{formatTime(msg.created_at)}</span>
					  </div>
					</div>
					);
				})
			)}
			<div ref={messagesEndRef}></div>
			<div className="p-[15px] border-t border-[#eee] flex gap-2.5 items-center bg-white"></div>
				<input type="text" className="flex-1 px-4 py-3 border border-[#ddd] rounded-[25px] outline-none text-sm focus:border-[#007AFF] disabled:bg-[#f5f5f5] disabled:cursor-not-allowed" value={input} onChange={(e) => setInput(e.target.value)}
					onKeyPress={handleKeyPress} placeholder="Type a message..." disabled={!isConnected} />
				<button className="px-5 py-2.5 bg-[#007AFF] text-white border-none rounded-[20px] cursor-pointer text-sm font-medium transition-colors duration-200 enabled:hover:bg-[#0056b3] disabled:bg-[#ccc] disabled:cursor-not-allowed" onClick={handleSend} disabled={!isConnected || !input.trim()}>Send</button>
			</div>

			<div className={`p-[5px] text-center text-xs border-t border-[#eee] ${isConnected ? 'text-[green]' : 'text-[red]'}`}>
				{isConnected ? '● Connected' : '● Disconnected'}
			</div>
		  </div>
		</div>
	);
}