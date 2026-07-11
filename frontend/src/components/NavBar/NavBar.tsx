'use client';
import React from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import styles from './NavBar.module.css';

export default function NavBar() 
{
  const { user, logout } = useAuth();

  return (
    <nav className={styles.nav}>
      <div className={styles.logo}>
        <Link href="/">Marketplace</Link>
      </div>
      <div className={styles.actions}>
		<Link href="/admin/login" className={styles.link}>Admin</Link>
        {user ? (
          <>
            <Link href="/profile" className={styles.link}>Profile</Link>
            <Link href="/friends" className={styles.link}>Friends</Link>
            <button onClick={logout} className={styles.button}>Logout</button>
          </>
        ) : (
          <Link href="/login" className={styles.button}>Login</Link>
        )}
      </div>
    </nav>
  );
}
