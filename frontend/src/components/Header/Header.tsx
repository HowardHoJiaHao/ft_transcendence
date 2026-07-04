'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation'
import { useCart } from '@/context/CartContext';
import { useAuth } from '@/context/AuthContext'; //import hook to access global authentication data
import { useSearch } from '@/hooks/useSearch';
import SearchBar from '@/components/SearchBar/SearchBar';
import styles from './Header.module.css';

type HeaderProps = {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  onSearchSubmit?: () => void;
};

export default function Header({
  searchValue,
  onSearchChange,
  onSearchSubmit,
}: HeaderProps) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { itemCount } = useCart();
  const { searchQuery, setSearchQuery, handleSearch } = useSearch();
  const activeSearchValue = searchValue ?? searchQuery;
  const handleSearchChange = onSearchChange ?? setSearchQuery;
  const submitSearch = onSearchSubmit ?? handleSearch;

    return (
     <header className={styles.header}>
        <div className="container">
          <div className={styles.headerTop}>
			<Link href="/" className={styles.logo}><h1>🏸 RacketDiction 💉 </h1></Link>
            <SearchBar value={activeSearchValue} onChange={handleSearchChange} onSubmit={submitSearch} />
            <div className={styles.headerActions}>
              {user ? (
                <>
                  <Link href="/profile" className="btn btn-secondary btn-sm">{user.username}</Link>
                  <Link href="/friends" className="btn btn-secondary btn-sm">Friends</Link>
                  <button className="btn btn-secondary btn-sm" onClick={logout}>Logout</button>
                </>
              ) : (
                <Link href="/login" className="btn btn-secondary btn-sm">Login</Link>
              )}
              <Link href="/cart" className={styles.cartBtn}>🛒{itemCount > 0 && (<span className={styles.cartBadge}>{itemCount}</span>)}</Link>
              <button
              className="btn btn-primary btn-sm"
              onClick={() => router.push(user ? '/sell' : '/login')}
              >
              Sell Now
              </button>
            </div>
          </div>
        </div>
      </header>
    )
}

// {
//   searchValue,
//   onSearchChange,
//   onSearchSubmit,
// }: {
//   searchValue: string;
//   onSearchChange: (value: string) => void;
//   onSearchSubmit: () => void;
// })