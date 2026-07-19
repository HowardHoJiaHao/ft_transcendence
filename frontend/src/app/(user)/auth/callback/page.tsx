'use client';
import { useEffect, Suspense } from 'react';
import { useAuth } from '@/context/AuthContext'
import { useRouter } from 'next/navigation';

function AuthCallbackContent() {
	const { login } = useAuth();
	const router = useRouter();

	useEffect(() => {
		const finishGoogleLogin = async () => {
			try {
				const res = await fetch('/api/v1/me', {
					credentials: 'include',
				});

				if (!res.ok) {
					router.replace('/login');
					return;
				}

				const userData = await res.json();

				login(userData);
				router.replace('/');
			} catch {
				router.replace('/login');
			}
		};

		finishGoogleLogin();
	}, [login, router]);

	return <p>Completing sign-in</p>
}

export default function AuthCallbackPage() {
	return (
		<Suspense fallback={<p>Loading authentication window...</p>}>
			<AuthCallbackContent />
		</Suspense>
	);
}
