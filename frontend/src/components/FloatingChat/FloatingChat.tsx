'use client';

import { useAuth } from '@/modules/user/components/AuthContext'
import { useRouter } from 'next/navigation'
import styles from './FloatingChat.module.css'

export default function FloatingChat() {
	const { user } = useAuth();
	const router = useRouter();

	if (!user)
		return null;

	return (
		<button className={styles.floatingButton} 
		  onClick={() => router.push('/chat')}
		  title="Open Messages">💬
		</button>
	);
}
