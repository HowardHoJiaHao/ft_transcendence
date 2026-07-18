'use client';
import { useEffect, Suspense } from 'react';
import { useAuth } from '@/context/AuthContext'
import { useRouter } from 'next/navigation';

function readCookie(name: string) {
	if (typeof document === 'undefined') return null;
	const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()\[\]\\\/\+^])/g, '\\$1') + '=([^;]*)'));
	return match ? decodeURIComponent(match[1]) : null;
}

function AuthCallbackContent() {
	const { login } = useAuth();
	const router = useRouter();

	useEffect(() => {
		const finishGoogleLogin = async () => {
			const token = readCookie('oauth_token');
			if (!token) {
				router.push('/login');
				return;
			}

			localStorage.setItem('token', token);
			document.cookie = 'oauth_token=; Max-Age=0; Path=/';

			const res = await fetch('/api/v1/me', {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			});

			if (!res.ok) {
				router.push('/login');
				return;
			}

			const user = await res.json();
			login(user);
			router.push('/');
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