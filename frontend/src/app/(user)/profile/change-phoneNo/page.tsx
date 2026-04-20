'use client'

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './change-phoneNo.module.css'

export default function ChangePhoneNoPage() 
{
	const router = useRouter();
	const [newPhoneNo, setNewPhoneNo] = useState('');
	const [loading, setLoading] = useState(false);
	const [msg, setMsg] = useState('');

	const handleSubmit = async(e: React.FormEvent) => {
		e.preventDefault();
		setMsg('');

		if (!newPhoneNo.trim())
		{
			setMsg('Please enter a new Phone Number')
			return ;
		}
		try
		{
			setLoading(true);
			const token = localStorage.getItem('token') ?? '';

			const res = await fetch('http://localhost:8080/api/v1/users/update', {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					Authorization: token ? 'Bearer ' + token : '',
				},
				body: JSON.stringify({ phoneNo: newPhoneNo.trim() })
			});

			const data = await res.json().catch(() => ({}));

			if (!res.ok)
			{
				setMsg(data.error ?? 'Failed to update PhoneNo');
				return ;
			}
			setMsg('PhoneNo updated successfully')
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
				<h1>Change Phone Number</h1>
				<form onSubmit={handleSubmit}>
					<input type="PhoneNo" placeholder="Enter new Phone Number" value={newPhoneNo} onChange={(e) => setNewPhoneNo(e.target.value)} required className={styles.input} />
					<button type="submit" disabled={loading} className={styles.button}>
						{loading ? 'Saving...' : 'Save New Phone Number'}
					</button>
				</form>
				{msg && <p className={styles.message}>{msg}</p>}
			</main>
		</div>
	);
}