'use client'

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ChangeEmailPage()
{
	const router = useRouter();
	const [newEmail, setNewEmail] = useState('');
	const [loading, setLoading] = useState(false);
	const [msg, setMsg] = useState('');

	const handleSubmit = async(e: React.FormEvent) => {
		e.preventDefault();
		setMsg('');

		if (!newEmail.trim())
		{
			setMsg('Please enter a new email')
			return ;
		}
		try
		{
			setLoading(true);
			const token = localStorage.getItem('token') ?? '';

			const res = await fetch('/api/v1/users/update', {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					Authorization: token ? 'Bearer ' + token : '',
				},
				body: JSON.stringify({ email: newEmail.trim() })
			});

			const data = await res.json().catch(() => ({}));

			if (!res.ok)
			{
				setMsg(data.error ?? 'Failed to update email');
				return ;
			}
			setMsg('Email updated successfully')
			setTimeout(() => router.push('/profile'), 800);
		}
		catch
		{
			setMsg('Network error')
		}
		finally
		{
			setLoading(false);
		}
	}

	return (
		<div className="flex justify-center items-center h-[calc(100vh-80px)] bg-[#fafafa] px-4 py-6">
			<main className="bg-white p-10 rounded-lg shadow-[0_4px_6px_rgba(0,0,0,0.1)] w-full max-w-[560px] flex flex-col gap-4">
				<h1 className="text-center mb-2 text-[#333]">Change Email</h1>
				<form onSubmit={handleSubmit} className="grid gap-3">
					<input
						type="email"
						placeholder="Enter new email"
						value={newEmail}
						onChange={(e) => setNewEmail(e.target.value)}
						required
						className="p-3 border border-[#ccc] rounded text-base"
					/>
					<button type="submit" disabled={loading} className="p-3 bg-[#080808] text-white border-none rounded text-base font-bold cursor-pointer w-full mt-0 hover:bg-[#323131] disabled:opacity-70 disabled:cursor-not-allowed">
						{loading ? 'Saving...' : 'Save New Email'}
					</button>
				</form>
				{msg && <p className="mt-1">{msg}</p>}
			</main>
		</div>
	);
}
