'use client';

import { createContext, useContext, useState, useCallback } from "react";
import { useRouter } from 'next/navigation';

export function useSearch(initialValue = '')
{
	const router = useRouter();
	const [searchQuery, setSearchQuery] = useState(initialValue);

	const handleSearch = useCallback(() => {
		if (searchQuery.trim())
			router.push(`/?search=${encodeURIComponent(searchQuery.trim())}`);
		else
			router.push('/')
	}, [searchQuery, router]);


	const handleSearchFromInput = useCallback((inputValue: string) => {
		setSearchQuery(inputValue);
		if (inputValue.trim())
			router.push(`/?search=${encodeURIComponent(inputValue.trim())}`);
		else
			router.push('/');
	}, [router]);

	return {
		searchQuery,
		setSearchQuery,
		handleSearch,
		handleSearchFromInput,
	};
}