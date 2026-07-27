'use client'

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

export function useRequireAuth(redirectTo = '/') {
	const { user, loading, logout, updateUser } = useAuth();
	const router = useRouter();

	useEffect(() => {
		if (!loading && !user) {
			router.push(redirectTo);
		}
	}, [user, loading, router, redirectTo]);

	return { user, loading, logout, updateUser };
} 