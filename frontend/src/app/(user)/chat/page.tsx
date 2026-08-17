'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/context/AuthContext';
import { useWebSocketContext } from '@/context/WebSocketContext';
import { useI18n } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast/ToastContext';
import Header from '@/components/Header/Header';
import ChatModal, { type ChatPartner } from './ChatModal';
import type { Conversation, DirectoryUser, PrivateMessage } from '@/types/websocket';
import { DEFAULT_AVATAR, resolveAvatarUrl, AVATAR_SIZE, AVATAR_FILL, avatarClass, avatarFallbackClass } from '@/lib/avatar';

const PEOPLE_PAGE_SIZE = 40;
type RoleFilter = '' | 'seller' | 'buyer';

type ContextMenuState = {
	person: DirectoryUser;
	x: number;
	y: number;
};

export default function ChatPage() {
	const router = useRouter();
	const { user } = useAuth();
	const { onlineUsers } = useWebSocketContext();
	const { t } = useI18n();
	const { showToast } = useToast();
	const [conversations, setConversations] = useState<Conversation[]>([]);
	const [people, setPeople] = useState<DirectoryUser[]>([]);
	const [selectedPartner, setSelectedPartner] = useState<ChatPartner | null>(null);
	const [messages, setMessages] = useState<PrivateMessage[]>([]);
	const [loading, setLoading] = useState(true);
	const [peopleLoading, setPeopleLoading] = useState(false);
	const [hasMorePeople, setHasMorePeople] = useState(true);
	const [search, setSearch] = useState('');
	const [debouncedSearch, setDebouncedSearch] = useState('');
	const [role, setRole] = useState<RoleFilter>('');
	const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
	const [actionMessage, setActionMessage] = useState('');
	const peopleLoadingRef = useRef(false);
	const peopleRequestRef = useRef(0);
	const peopleAbortRef = useRef<AbortController | null>(null);
	const deepLinkOpenedRef = useRef(false);

	useEffect(() => {
		const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
		return () => window.clearTimeout(timeout);
	}, [search]);

	const fetchConversations = useCallback(async () => {
		try {
			const token = localStorage.getItem('token') || `token_${user?.id}`;
			const res = await fetch('/api/v1/conversations', {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (res.ok) {
				const data = await res.json();
				setConversations(data.conversations || []);
			}
		} catch (err) {
			console.error('Failed to fetch conversations: ', err);
		} finally {
			setLoading(false);
		}
	}, [user?.id]);

	const fetchPeople = useCallback(async (offset: number, replace = false) => {
		if (!user) return;
		if (replace) {
			peopleRequestRef.current += 1;
			peopleAbortRef.current?.abort();
		} else if (peopleLoadingRef.current) {
			return;
		}
		const requestID = peopleRequestRef.current;
		const controller = new AbortController();
		peopleAbortRef.current = controller;
		peopleLoadingRef.current = true;
		setPeopleLoading(true);
		try {
			const token = localStorage.getItem('token') || `token_${user.id}`;
			const params = new URLSearchParams({ limit: String(PEOPLE_PAGE_SIZE), offset: String(offset) });
			if (debouncedSearch) params.set('q', debouncedSearch);
			if (role) params.set('role', role);
			const res = await fetch(`/api/v1/people?${params.toString()}`, {
				headers: { Authorization: `Bearer ${token}` },
				signal: controller.signal,
			});
			if (!res.ok) throw new Error('Failed to fetch people');
			const data = await res.json();
			if (requestID === peopleRequestRef.current) {
				setPeople(previous => replace ? (data.people || []) : [...previous, ...(data.people || [])]);
				setHasMorePeople(Boolean(data.has_more));
			}
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') return;
			console.error('Failed to fetch people: ', err);
			setActionMessage(t('chat.peopleLoadError'));
		} finally {
			if (requestID === peopleRequestRef.current) {
				peopleLoadingRef.current = false;
				setPeopleLoading(false);
			}
		}
	}, [debouncedSearch, role, t, user]);

	useEffect(() => {
		if (user) void fetchConversations();
	}, [fetchConversations, user]);

	useEffect(() => {
		if (!user) return;
		setHasMorePeople(true);
		void fetchPeople(0, true);
	}, [debouncedSearch, fetchPeople, role, user]);

	const deleteConversation = async (partnerId: number, event: React.MouseEvent) => {
		event.stopPropagation();
		try {
			const token = localStorage.getItem('token') || `token_${user?.id}`;
			const res = await fetch(`/api/v1/conversations/${partnerId}`, {
				method: 'DELETE',
				headers: { Authorization: `Bearer ${token}` },
			});
			if (res.ok) {
				setConversations(previous => previous.filter(conversation => conversation.partner_id !== partnerId));
				showToast(t('toast.conversationDeleted'), 'success');
			} else {
				showToast(t('toast.conversationDeleteFailed'), 'error');
			}
		} catch (err) {
			console.error('Failed to delete conversation: ', err);
			showToast(t('toast.networkError'), 'error');
		}
	};

	const openChat = async (partner: ChatPartner) => {
		try {
			const token = localStorage.getItem('token') || `token_${user?.id}`;
			const res = await fetch(`/api/v1/messages/${partner.id}`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (res.ok) {
				const data = await res.json();
				setMessages(data.messages || []);
			} else {
				setMessages([]);
			}
		} catch (err) {
			console.error('Failed to fetch messages: ', err);
		}
		setSelectedPartner(partner);
	};

	// Waits for the conversation list so the deep link can name the partner in
	// the modal header rather than opening an unlabelled window.
	useEffect(() => {
		if (!user || loading || deepLinkOpenedRef.current) return;
		const rawPartner = new URLSearchParams(window.location.search).get('partner');
		if (!rawPartner || !/^[1-9]\d*$/.test(rawPartner)) return;
		const partnerID = Number(rawPartner);
		if (!Number.isSafeInteger(partnerID)) return;
		deepLinkOpenedRef.current = true;
		const known = conversations.find(conversation => conversation.partner_id === partnerID);
		void openChat({
			id: partnerID,
			username: known?.partner_username ?? t('chat.unknownUser'),
			avatarUrl: known?.partner_avatar_url ?? null,
		});
	}, [conversations, loading, user]); // eslint-disable-line react-hooks/exhaustive-deps

	const addFriend = async (person: DirectoryUser) => {
		setContextMenu(null);
		try {
			const token = localStorage.getItem('token') || `token_${user?.id}`;
			const res = await fetch(`/api/v1/friends/${person.id}`, {
				method: 'POST',
				headers: { Authorization: `Bearer ${token}` },
			});
			if (res.ok) {
				setActionMessage(t('chat.friendAdded'));
				showToast(t('chat.friendAdded'), 'success');
			} else {
				setActionMessage(t('chat.friendAddError'));
				showToast(t('chat.friendAddError'), 'error');
			}
		} catch (err) {
			console.error('Failed to add friend: ', err);
			setActionMessage(t('chat.friendAddError'));
			showToast(t('chat.friendAddError'), 'error');
		}
	};

	const openContextMenu = (person: DirectoryUser, x: number, y: number) => {
		setContextMenu({
			person,
			x: Math.min(x, window.innerWidth - 190),
			y: Math.min(y, window.innerHeight - 110),
		});
	};

	const sortedPeople = useMemo(() => [...people].sort((first, second) => {
		const onlineOrder = Number(onlineUsers.has(second.id)) - Number(onlineUsers.has(first.id));
		return onlineOrder || first.username.localeCompare(second.username);
	}), [onlineUsers, people]);

	const handlePeopleScroll = (event: React.UIEvent<HTMLDivElement>) => {
		const element = event.currentTarget;
		if (hasMorePeople && !peopleLoading && element.scrollTop + element.clientHeight >= element.scrollHeight - 80) {
			void fetchPeople(people.length);
		}
	};

	if (loading) return <div>{t('common.loading')}</div>;

	return (
		<main onClick={() => setContextMenu(null)}>
			<Header />
			<div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 max-w-[1240px] mx-auto p-5">
				<section className="min-w-0">
					<h1 className="text-2xl mb-5">{t('chat.title')}</h1>
					{conversations.length === 0 ? (
						<div className="text-center text-[#666] text-lg mt-[50px]">{t('chat.noConversations')}</div>
					) : (
						<ul className="list-none p-0 m-0 bg-white rounded-xl border border-[#eee] overflow-hidden">
							{conversations.map((conversation) => (
								<li key={conversation.partner_id} onClick={() => void openChat({ id: conversation.partner_id, username: conversation.partner_username, avatarUrl: conversation.partner_avatar_url })} className="flex items-center p-3 border-b last:border-b-0 border-[#eee] cursor-pointer hover:bg-[#f5f5f5]">
									<div className="mr-2.5">
										{conversation.partner_avatar_url ? (
											<img
												src={resolveAvatarUrl(conversation.partner_avatar_url)}
												alt=""
												className={avatarClass('list')}
												onError={(event) => { event.currentTarget.src = DEFAULT_AVATAR; }}
											/>
										) : (
											<span className={avatarFallbackClass('list', 'text-lg')}>{conversation.partner_username[0]}</span>
										)}
									</div>
									<div className="flex-1 font-bold truncate">{conversation.partner_username}</div>
									<button className="bg-transparent border-none text-[#ff6b6b] cursor-pointer text-base p-2" onClick={(event) => void deleteConversation(conversation.partner_id, event)} title={t('chat.deleteConversation')} aria-label={t('chat.deleteConversation')}>×</button>
								</li>
							))}
						</ul>
					)}
				</section>

				<aside className="bg-white border border-[#e5e7eb] rounded-xl shadow-sm overflow-hidden lg:sticky lg:top-5 h-fit" aria-labelledby="people-heading" onClick={(event) => event.stopPropagation()}>
					<div className="p-4 border-b border-[#eee]">
						<h2 id="people-heading" className="text-xl font-semibold m-0">{t('chat.people')}</h2>
						<label htmlFor="people-search" className="sr-only">{t('chat.searchPeople')}</label>
						<input id="people-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('chat.searchPeoplePlaceholder')} className="w-full mt-3 px-3 py-2 border border-[#d1d5db] rounded-lg text-sm outline-none focus:border-[var(--primary)]" />
						<div className="flex gap-2 mt-3" role="group" aria-label={t('chat.peopleFilters')}>
							{([{ value: '', label: t('chat.allPeople') }, { value: 'seller', label: t('chat.sellers') }, { value: 'buyer', label: t('chat.buyers') }] as const).map((filter) => (
								<button key={filter.value || 'all'} onClick={() => setRole(filter.value)} className={`text-sm px-3 py-1.5 rounded-full border ${role === filter.value ? 'bg-[var(--primary)] text-white border-[var(--primary)]' : 'bg-white border-[#d1d5db] text-[#444] hover:bg-[#f5f5f5]'}`}>
									{filter.label}
								</button>
							))}
						</div>
					</div>

					<div className="max-h-[min(620px,calc(100vh-270px))] min-h-[300px] overflow-y-auto" onScroll={handlePeopleScroll}>
						{sortedPeople.length === 0 && !peopleLoading ? (
							<p className="p-5 text-center text-[#666]">{t('chat.noPeople')}</p>
						) : (
							<ul className="list-none m-0 p-0">
								{sortedPeople.map((person) => {
									const isOnline = onlineUsers.has(person.id);
									return (
										<li key={person.id} className="border-b last:border-b-0 border-[#f0f0f0]">
											<div className="flex items-center gap-2 px-3 py-2.5 hover:bg-[#f8fafc]">
												<button onClick={() => void openChat({ id: person.id, username: person.username, avatarUrl: person.avatar_url })} onContextMenu={(event) => { event.preventDefault(); openContextMenu(person, event.clientX, event.clientY); }} onKeyDown={(event) => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); openContextMenu(person, rect.right, rect.bottom); } }} className="flex items-center gap-2 min-w-0 flex-1 text-left bg-transparent border-0 p-0 cursor-pointer">
													<span className={`relative shrink-0 block ${AVATAR_SIZE.list}`}>
														{person.avatar_url ? (
															<img
																src={resolveAvatarUrl(person.avatar_url)}
																																	alt=""
																className={AVATAR_FILL}
																onError={(event) => { event.currentTarget.src = DEFAULT_AVATAR; }}
															/>
														) : <span className={`${AVATAR_FILL} bg-[#9ca3af] text-white font-bold text-lg flex items-center justify-center`}>{person.username[0]?.toUpperCase()}</span>}
														<span className={`absolute right-0 bottom-0 w-3 h-3 rounded-full border-2 border-white ${isOnline ? 'bg-[#22c55e]' : 'bg-[#9ca3af]'}`} aria-label={isOnline ? t('chat.online') : t('chat.offline')} />
													</span>
													<span className="min-w-0 flex-1">
														<span className="block font-medium truncate">{person.username}</span>
														<span className="block text-xs text-[#6b7280]">{isOnline ? t('chat.online') : t('chat.offline')}</span>
													</span>
												</button>
												<button onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); openContextMenu(person, rect.right, rect.bottom); }} className="p-2 rounded-md bg-transparent border-0 cursor-pointer hover:bg-[#e5e7eb] text-lg leading-none" aria-label={t('chat.personActions')}>⋯</button>
											</div>
										</li>
									);
								})}
							</ul>
						)}
						{peopleLoading && <p className="p-3 text-center text-sm text-[#666]">{t('common.loading')}</p>}
						{hasMorePeople && !peopleLoading && people.length > 0 && <p className="p-3 text-center text-xs text-[#666]">{t('chat.scrollForMore')}</p>}
					</div>
				</aside>
			</div>

			{contextMenu && (
				<div role="menu" className="fixed z-[1100] w-[180px] bg-white rounded-lg border border-[#d1d5db] shadow-lg p-1" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
					<button role="menuitem" onClick={() => void addFriend(contextMenu.person)} className="block w-full text-left px-3 py-2 rounded-md bg-transparent border-0 cursor-pointer hover:bg-[#f3f4f6]">{t('chat.addFriend')}</button>
					<button role="menuitem" onClick={() => { setContextMenu(null); router.push(`/user/${contextMenu.person.id}`); }} className="block w-full text-left px-3 py-2 rounded-md bg-transparent border-0 cursor-pointer hover:bg-[#f3f4f6]">{t('chat.viewProfile')}</button>
				</div>
			)}
			<p className="sr-only" aria-live="polite">{actionMessage}</p>
			{selectedPartner !== null && <ChatModal partner={selectedPartner} messages={messages} onClose={() => setSelectedPartner(null)} />}
		</main>
	);
}
