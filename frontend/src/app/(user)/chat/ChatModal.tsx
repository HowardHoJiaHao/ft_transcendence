'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useWebSocketContext } from '@/context/WebSocketContext';
import { useI18n } from '@/context/LanguageContext';
import { DEFAULT_AVATAR, resolveAvatarUrl, AVATAR_FILL, AVATAR_SIZE } from '@/lib/avatar';
import type { PrivateMessage } from '@/types/websocket';
import type { WebSocketMessage } from '@/context/WebSocketContext';

export const MAX_MESSAGE_LENGTH = 2000;
const COUNTER_VISIBLE_FROM = MAX_MESSAGE_LENGTH - 400;
const NEAR_BOTTOM_PX = 80;

export type ChatPartner = {
	id: number;
	username: string;
	avatarUrl?: string | null;
};

interface ChatModalProps {
	partner: ChatPartner;
	messages: PrivateMessage[];
	onClose: () => void;
}

export default function ChatModal({ partner, messages: initialMessages, onClose }: ChatModalProps) {
	const { user } = useAuth();
	const { sendMessage, subscribe, isConnected, onlineUsers } = useWebSocketContext();
	const { t, lang } = useI18n();
	const [messages, setMessages] = useState<PrivateMessage[]>(initialMessages);
	const [input, setInput] = useState('');
	const listRef = useRef<HTMLDivElement>(null);
	const atBottomRef = useRef(true);

	const isOnline = onlineUsers.has(partner.id);

	useEffect(() => {
		setMessages(initialMessages);
		atBottomRef.current = true;
	}, [initialMessages]);

	// Only follow new messages when the reader is already at the bottom, so
	// scrolling back through history is not yanked away by an arriving message.
	useEffect(() => {
		const list = listRef.current;
		if (list && atBottomRef.current) list.scrollTop = list.scrollHeight;
	}, [messages]);

	useEffect(() => {
		const unsubscribe = subscribe((msg: WebSocketMessage) => {
			if (msg.type !== 'private_message') return;
			const privateMsg: PrivateMessage = {
				id: msg.id,
				sender_id: msg.sender_id,
				receiver_id: msg.receiver_id,
				content: msg.content,
				created_at: msg.created_at ?? new Date().toISOString(),
			};
			if (privateMsg.sender_id === partner.id || privateMsg.receiver_id === partner.id)
				setMessages(prev => [...prev, privateMsg]);
		});
		return unsubscribe;
	}, [subscribe, partner.id]);

	const handleScroll = () => {
		const list = listRef.current;
		if (!list) return;
		atBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM_PX;
	};

	const handleSend = () => {
		const trimmed = input.trim();
		if (!trimmed || trimmed.length > MAX_MESSAGE_LENGTH) return;
		atBottomRef.current = true;
		if (sendMessage(partner.id, trimmed)) setInput('');
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	const formatTime = (dateString: string) =>
		new Date(dateString).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });

	const dayLabel = (dateString: string) => {
		const date = new Date(dateString);
		const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
		const dayDiff = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);
		if (dayDiff === 0) return t('chat.today');
		if (dayDiff === 1) return t('chat.yesterday');
		return new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(date);
	};

	// Each message carries the separator that should precede it, so the list
	// stays a flat map instead of nested day groups.
	const rows = useMemo(() => {
		let previousDay = '';
		return messages.map(msg => {
			const label = dayLabel(msg.created_at);
			const separator = label === previousDay ? null : label;
			previousDay = label;
			return { msg, separator };
		});
	}, [messages, lang]); // eslint-disable-line react-hooks/exhaustive-deps

	const remaining = MAX_MESSAGE_LENGTH - input.length;
	const showCounter = input.length >= COUNTER_VISIBLE_FROM;

	return (
		<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] p-4" onClick={onClose}>
			<div
				className="bg-white w-full max-w-[520px] h-[min(640px,calc(100vh-64px))] rounded-2xl flex flex-col shadow-[0_10px_40px_rgba(0,0,0,0.25)] overflow-hidden"
				onClick={e => e.stopPropagation()}
				role="dialog"
				aria-label={partner.username}
			>
				<header className="shrink-0 px-4 py-3 border-b border-[#eee] flex items-center gap-3 bg-white">
					<span className={`relative shrink-0 block ${AVATAR_SIZE.list}`}>
						{partner.avatarUrl ? (
							<img
								src={resolveAvatarUrl(partner.avatarUrl)}
								alt=""
								className={AVATAR_FILL}
								onError={e => { e.currentTarget.src = DEFAULT_AVATAR; }}
							/>
						) : (
							<span className={`${AVATAR_FILL} bg-[#9ca3af] text-white font-bold text-lg flex items-center justify-center`}>
								{partner.username[0]?.toUpperCase()}
							</span>
						)}
						<span className={`absolute right-0 bottom-0 w-3 h-3 rounded-full border-2 border-white ${isOnline ? 'bg-[#22c55e]' : 'bg-[#9ca3af]'}`} />
					</span>
					<span className="min-w-0 flex-1">
						<span className="block font-semibold text-[15px] text-[#111] truncate">{partner.username}</span>
						<span className="block text-xs text-[#6b7280]">
							{isOnline ? t('chat.online') : t('chat.offline')}
						</span>
					</span>
					<button
						className="shrink-0 bg-transparent border-none text-2xl cursor-pointer text-[#666] w-8 h-8 rounded-full leading-none hover:bg-[#f3f4f6] hover:text-black"
						onClick={onClose}
						aria-label={t('chat.closeChat')}
					>
						×
					</button>
				</header>

				<div
					ref={listRef}
					onScroll={handleScroll}
					className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-1.5 bg-[#fafafa]"
				>
					{messages.length === 0 ? (
						<div className="m-auto text-center text-[#888] text-sm px-6">
							{t('chat.noMessages')}
						</div>
					) : (
						rows.map(({ msg, separator }) => {
							const isOwn = msg.sender_id === user?.id;
							return (
								<React.Fragment key={msg.id}>
									{separator && (
										<div className="self-center my-2 px-3 py-1 rounded-full bg-[#e9e9e7] text-[11px] text-[#5f5f5a]">
											{separator}
										</div>
									)}
									<div className={`flex w-full ${isOwn ? 'justify-end' : 'justify-start'}`}>
										<div
											className={`max-w-[78%] px-3.5 py-2 rounded-2xl break-words [overflow-wrap:anywhere] shadow-[0_1px_1px_rgba(0,0,0,0.05)] ${
												isOwn
													? 'bg-[#007AFF] text-white rounded-br-[5px]'
													: 'bg-white text-[#111] border border-[#e8e8e6] rounded-bl-[5px]'
											}`}
										>
											<p className="m-0 text-[14.5px] leading-[1.45] whitespace-pre-wrap">{msg.content}</p>
											<span className={`block text-right text-[10px] mt-1 ${isOwn ? 'text-white/70' : 'text-[#9a9a95]'}`}>
												{formatTime(msg.created_at)}
											</span>
										</div>
									</div>
								</React.Fragment>
							);
						})
					)}
				</div>

				<div className="shrink-0 border-t border-[#eee] bg-white px-3 pt-3 pb-2">
					<div className="flex gap-2.5 items-center">
						<input
							type="text"
							className="flex-1 min-w-0 px-4 py-2.5 border border-[#ddd] rounded-[22px] outline-none text-sm focus:border-[#007AFF] disabled:bg-[#f5f5f5] disabled:cursor-not-allowed"
							value={input}
							onChange={e => setInput(e.target.value)}
							onKeyDown={handleKeyDown}
							placeholder={t('chat.inputPlaceholder')}
							maxLength={MAX_MESSAGE_LENGTH}
							disabled={!isConnected}
							aria-label={t('chat.inputPlaceholder')}
						/>
						<button
							className="shrink-0 px-5 py-2.5 bg-[#007AFF] text-white border-none rounded-[20px] cursor-pointer text-sm font-medium transition-colors duration-200 enabled:hover:bg-[#0056b3] disabled:bg-[#ccc] disabled:cursor-not-allowed"
							onClick={handleSend}
							disabled={!isConnected || !input.trim()}
						>
							{t('chat.send')}
						</button>
					</div>
					<div className="flex items-center justify-between mt-1.5 px-1 min-h-[16px]">
						<span className={`text-[11px] ${isConnected ? 'text-[#16a34a]' : 'text-[#dc2626]'}`}>
							{isConnected ? t('chat.connected') : t('chat.disconnected')}
						</span>
						{showCounter && (
							<span className={`text-[11px] ${remaining === 0 ? 'text-[#dc2626] font-semibold' : 'text-[#8b8b86]'}`}>
								{t('chat.charsLeft', { count: remaining })}
							</span>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
