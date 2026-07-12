'use client';
import { useEffect, Suspense } from 'react';
import { useAuth } from '@/context/AuthContext'
import { useRouter, useSearchParams } from 'next/navigation';

function AuthCallbackContent() {
	const { login } = useAuth();
	const router = useRouter();
	const searchParams = useSearchParams();

	useEffect(() => {
		const finishGoogleLogin = async () => {
			const token = searchParams.get('token');
			if (!token) {
				router.push('/login');
				return;
			}

			localStorage.setItem('token', token);

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
	}, [login, router, searchParams]);

	return <p>Completing sign-in</p>
}

export default function AuthCallbackPage() {
	return (
		<Suspense fallback={<p>Loading authentication window...</p>}>
			<AuthCallbackContent />
		</Suspense>
	);
}