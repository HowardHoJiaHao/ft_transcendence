'use client';

import { useEffect } from 'react';
import { useWebSocketContext, WebSocketMessage } from '@/context/WebSocketContext';
import { useToast } from '@/components/Toast/ToastContext';
import { useI18n } from '@/context/LanguageContext';

// Renders nothing. Listens on the shared chat websocket for the hub telling
// this tab its connection was taken over by a login elsewhere (same
// account, another browser/tab), and surfaces it as a toast instead of
// leaving the tab silently disconnected. See useWebSocket.ts's
// `sessionReplaced` flag, which stops that same event from triggering an
// auto-reconnect fight over the connection slot.
export default function SessionReplacedNotice() {
	const { subscribe } = useWebSocketContext();
	const { showToast } = useToast();
	const { t } = useI18n();

	useEffect(() => {
		const unsubscribe = subscribe((msg: WebSocketMessage) => {
			if (msg.type === 'session_replaced')
				showToast(t('toast.sessionReplaced'), 'info');
		});
		return unsubscribe;
	}, [subscribe, showToast, t]);

	return null;
}
