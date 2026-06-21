'use client'

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './change-email.module.css'

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
		<div className={styles.container}>
			<main className={styles.form}>
				<h1>Change Email</h1>
				<form onSubmit={handleSubmit}>
					<input
						type="email"
						placeholder="Enter new email"
						value={newEmail}
						onChange={(e) => setNewEmail(e.target.value)}
						required
						className={styles.input}
					/>
					<button type="submit" disabled={loading} className={styles.button}>
						{loading ? 'Saving...' : 'Save New Email'}
					</button>
				</form>
				{msg && <p className={styles.message}>{msg}</p>}
			</main>
		</div>
	);
}