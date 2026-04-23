'use client';

import { useRouter } from 'next/navigation'; //programmatic navigation
import { useAuth } from '@/modules/user/components/AuthContext'; //import hook to access global authentication data
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
            <h1 className={styles.logo} onClick={() => router.push('/')} style={{ cursor: 'pointer' }}> 🏸 RacquetDiction 💉</h1>
            <SearchBar value={searchValue} onChange={onSearchChange} onSubmit={onSearchSubmit} />
            <div className={styles.headerActions}>
              {user ? (
                <>
                  <button className="btn btn-secondary btn-sm" onClick={() => router.push('/profile')}>{user.username}</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => router.push('/friends')}>Friends</button>
                  <button className="btn btn-secondary btn-sm" onClick={logout}>Logout</button>
                </>
              ) : (
                <button className="btn btn-secondary btn-sm" onClick={() => router.push('/login')}>Login</button>
              )}
              <button className="btn btn-primary btn-sm">Sell Now</button>
            </div>
          </div>
        </div>
      </header>
    )
}