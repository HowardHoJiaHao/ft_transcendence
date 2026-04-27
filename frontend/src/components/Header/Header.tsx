'use client';

import { useRouter } from 'next/navigation'; //programmatic navigation
import { useAuth } from '@/modules/user/components/AuthContext'; //import hook to access global authentication data
import Link from 'next/link';
import SearchBar from '@/components/SearchBar/SearchBar';
import styles from './Header.module.css';

export default function Header({
  searchValue,
  onSearchChange,
  onSearchSubmit,
}: {
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
}) {
    const router = useRouter();
    const { user, logout } = useAuth();

    return (
     <header className={styles.header}>
        <div className="container">
          <div className={styles.headerTop}>
			<Link href="/" className={styles.logo}><h1>🏸 RacketDiction 💉 </h1></Link>
            <SearchBar value={searchValue} onChange={onSearchChange} onSubmit={onSearchSubmit} />
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
              <Link href="/cart" className="btn btn-secondary btn-sm">🛒</Link>
            </div>
          </div>
        </div>
      </header>
    )
}