'use client';

import { createContext, useContext, useState, useCallback } from "react";
import { useRouter } from 'next/navigation';

// The shop home page reads this once. The words stay out of the address until
// the product request is allowed, so a refused search never becomes the page URL.
const PENDING_LISTING_SEARCH_KEY = 'racket.listingSearch';
let stagedListingSearch: string | null = null;

export function stageListingSearch(term: string) {
	const trimmed = term.trim();
	stagedListingSearch = trimmed || null;
	try {
		if (trimmed)
			sessionStorage.setItem(PENDING_LISTING_SEARCH_KEY, trimmed);
		else
			sessionStorage.removeItem(PENDING_LISTING_SEARCH_KEY);
	} catch {
		// Private browsing can reject storage. The in-memory value still covers this tab.
	}
}

export function peekStagedListingSearch(): string | null {
	if (stagedListingSearch)
		return stagedListingSearch;
	if (typeof window === 'undefined')
		return null;
	try {
		return sessionStorage.getItem(PENDING_LISTING_SEARCH_KEY);
	} catch {
		return null;
	}
}

export function clearStagedListingSearch() {
	stagedListingSearch = null;
	if (typeof window === 'undefined')
		return;
	try {
		sessionStorage.removeItem(PENDING_LISTING_SEARCH_KEY);
	} catch {
		// Nothing else to clear.
	}
}

export function useSearch(initialValue = '')
{
	const router = useRouter();
	const [searchQuery, setSearchQuery] = useState(initialValue);

	const handleSearch = useCallback(() => {
		const trimmed = searchQuery.trim();
		if (!trimmed)
			return;
		stageListingSearch(trimmed);
		router.push('/');
	}, [searchQuery, router]);


	const handleSearchFromInput = useCallback((inputValue: string) => {
		setSearchQuery(inputValue);
		const trimmed = inputValue.trim();
		if (!trimmed)
			return;
		stageListingSearch(trimmed);
		router.push('/');
	}, [router]);

	return {
		searchQuery,
		setSearchQuery,
		handleSearch,
		handleSearchFromInput,
	};
}