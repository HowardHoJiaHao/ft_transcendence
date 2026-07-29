'use client';
import React from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';

export default function NavBar()
{
  const { user, logout } = useAuth();

  return (
    <nav className="flex justify-between items-center px-8 py-4 bg-white border-b border-[#eaeaea]">
      <div>
        <Link href="/" className="text-2xl font-bold text-[#333] no-underline">Marketplace</Link>
      </div>
      <div className="flex items-center gap-4">
		<Link href="/admin/login" className="text-[#555] no-underline font-medium hover:underline">Admin</Link>
        {user ? (
          <>
            <Link href="/profile" className="text-[#555] no-underline font-medium hover:underline">Profile</Link>
            <Link href="/friends" className="text-[#555] no-underline font-medium hover:underline">Friends</Link>
            <button onClick={logout} className="px-4 py-2 bg-[#e53935] text-white border-none rounded cursor-pointer no-underline font-bold hover:bg-[#d32f2f]">Logout</button>
          </>
        ) : (
          <Link href="/login" className="px-4 py-2 bg-[#e53935] text-white border-none rounded cursor-pointer no-underline font-bold hover:bg-[#d32f2f]">Login</Link>
        )}
      </div>
    </nav>
  );
}
