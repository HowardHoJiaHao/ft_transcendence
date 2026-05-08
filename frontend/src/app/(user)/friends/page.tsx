'use client'

import { useState, useEffect } from 'react';
import Link from 'next/link';

import { useAuth } from '@/modules/user/components/AuthContext';
import { useSearch } from '@/hooks/useSearch'
import Header from "@/components/Header/Header"
import styles from "./friends.module.css"

type Friend = {
	id: number;
	username: string;
	avatar?: string | null;
	onlineStatus: boolean;
	addedAt: string;
};

export default function FriendPage()
{
	const { user } = useAuth();
	const { searchQuery, setSearchQuery, handleSearch } = useSearch();
	const [friendList, setFriendList] = useState<Friend[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		if (user)
			fetchFriendLists();
	}, [user]);

	const deleteFriend = async (partnerId: number, e: React.MouseEvent) => {
		e.stopPropagation();
		try
		{
			const token = localStorage.getItem('token') || `token_${user?.id}`;
			const res = await fetch(`http://localhost:8080/api/v1/friends/${partnerId}`, {
				method: 'DELETE',
				headers: { Authorization: `Bearer ${token}`},
			});
			if (res.ok)
			{
				setFriendList(prev => prev.filter(f => f.id !== partnerId));
			}
		}
		catch (err)
		{
			console.error('Failed to delete conversation: ', err);
		}
	}

	const fetchFriendLists = async() => {
		try
		{
			const token = localStorage.getItem('token') || `token_${user?.id}`;
			const res = await fetch(`http://localhost:8080/api/v1/friends`, {
				headers: { Authorization: `Bearer ${token}`},
			});
			if (res.ok)
			{
				const data = await res.json();
				setFriendList(data.friends || []);
			}
			else
			{
				throw new Error('Failed to fetch friends');
			}
		}
		catch(err)
		{
			console.error('Failed to fetch Friend list');
		}
		finally
		{
			setLoading(false);
		}
	}

	return (
		<main>
		  <Header searchValue={searchQuery} onSearchChange={setSearchQuery} onSearchSubmit={handleSearch}/>
			<div className={styles.container}>
			  <h1 className={styles.title}>Your Friends</h1>
			  {friendList.length === 0 ? (
				<div className={styles.emptyState}>No Friends yet.</div>
			  ) : (
				<ul className={styles.friendList}>
				  {friendList.map((friend) => (
				  	<li key={friend.id} className={styles.friendListItem}>
					  <Link href={`/user/${friend.id}`} className={styles.friendLink}>
				        <div className={styles.avatar}>
					      {friend.avatar ? (
								<img src={friend.avatar} alt="" />
							) : (
								<span className={styles.avatarPlaceholder}>{friend.username[0]}</span>
							)}
					    </div>
					    <div className={styles.friendInfo}>
					      <div className={styles.friendName}>{friend.username}</div>
					    </div>
					  </Link>
					  <div className={styles.friendActions}>
					    <button className={styles.delete} onClick={(e) => deleteFriend(friend.id, e)} title="Delete friend">x</button>
					  </div>
					</li>
				  ))}
				</ul>
			  )}
			</div>
		</main>
	);
}