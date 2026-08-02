'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation'

export default function FloatingChat() {
	const { user } = useAuth();
	const router = useRouter();

	if (!user)
		return null;

	return (
		<button
		  className="fixed bottom-5 right-5 w-[60px] h-[60px] rounded-full bg-[#131314] text-white border-none shadow-[0_4px_12px_rgba(0,0,0,0.15)] cursor-pointer text-[28px] z-[1000] flex items-center justify-center transition-transform duration-200 hover:scale-110"
		  onClick={() => router.push('/chat')}
		  title="Open Messages">💬
		</button>
	);
}
