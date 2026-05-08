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
			return ;
	}, [searchQuery, router]);


	const handleSearchFromInput = useCallback((inputValue: string) => {
		setSearchQuery(inputValue);
		if (inputValue.trim())
			router.push(`/?search=${encodeURIComponent(inputValue.trim())}`);
		else
			return ;
	}, [router]);

	return {
		searchQuery,
		setSearchQuery,
		handleSearch,
		handleSearchFromInput,
	};
}