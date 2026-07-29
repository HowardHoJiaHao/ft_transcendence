'use client'

import { useState, useEffect } from 'react';
import Link from 'next/link';

import { useAuth } from '@/context/AuthContext';
import OnlineStatus from '@/components/OnlineStatus';
import Header from "@/components/Header/Header"

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
			const res = await fetch(`/api/v1/friends/${partnerId}`, {
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
			const res = await fetch(`/api/v1/friends`, {
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
		  <Header />
			<div className="p-5 max-w-[800px] mx-auto">
			  <h1 className="text-2xl mb-5">Your Friends</h1>
			  {friendList.length === 0 ? (
				<div className="text-center text-[#666] text-lg mt-[50px]">No Friends yet.</div>
			  ) : (
				<ul className="list-none p-0">
				  {friendList.map((friend) => (
				  	<li key={friend.id} className="flex items-center p-[10px] border-b border-[#eee] cursor-pointer">
					  <Link href={`/user/${friend.id}`} className="flex items-center flex-1 no-underline text-inherit min-w-0">
				        <div className="w-10 h-10 rounded-full mr-[10px]">
					      {friend.avatar ? (
								<img src={friend.avatar} alt="" className="w-full h-full rounded-full object-cover" />
							) : (
								<span className="w-full h-full rounded-full bg-[#ccc] flex items-center justify-center text-white font-bold">{friend.username[0]}</span>
							)}
					    </div>
					    <div className="flex-1">
					      <div className="font-bold m-0">{friend.username}</div>
					    </div>
						<div><OnlineStatus userId={friend.id}/></div>
					  </Link>
					  <div className="flex items-center gap-2">
					    <button className="bg-transparent border-none text-[#ff6b6b] cursor-pointer text-base" onClick={(e) => deleteFriend(friend.id, e)} title="Delete friend">x</button>
					  </div>
					</li>
				  ))}
				</ul>
			  )}
			</div>
		</main>
	);
}
