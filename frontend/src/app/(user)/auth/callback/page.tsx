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
	const { user, login } = useAuth();
	const router = useRouter();

	useEffect(() => {
		const finishGoogleLogin = async () => {
			console.log("1. Starting finishGoogleLogin flow..."); //debug
			if (user) {
				router.push('/');
				return;
			}
			const token = readCookie('oauth_token');
			console.log("2. Found cookie token:", token ? "YES (exists)" : "NO (null)"); //debug
			if (!token) {
			console.log("❌ Failed at Guard 1: No token found in cookies. Redirecting to /login"); //debug
				router.push('/login');
				return;
			}

			console.log("3. Sending fetch request to /api/v1/me...");
			const res = await fetch('/api/v1/me', {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			});

			console.log("4. Fetch response status:", res.status, "ok:", res.ok);
			if (!res.ok) {
				console.log("❌ Failed at Guard 2: Server returned error. Redirecting to /login");
				router.push('/login');
				return;
			}

			const userData = await res.json();
			console.log("5. Successfully fetched user data:", user);

			localStorage.setItem('token', token);
			document.cookie = 'oauth_token=; Max-Age=0; Path=/';

			login(userData);
			router.push('/');
		};

		finishGoogleLogin();
		console.log("6. Auth context updated, navigating home...");
	}, [login, router, user]);

	return <p>Completing sign-in</p>
}

export default function AuthCallbackPage() {
	return (
		<Suspense fallback={<p>Loading authentication window...</p>}>
			<AuthCallbackContent />
		</Suspense>
	);
}