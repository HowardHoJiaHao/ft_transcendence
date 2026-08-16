'use client'

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast/ToastContext';
import { useI18n } from '@/context/LanguageContext';
import { PROFILE_LIMITS, normalizePhone, validatePhone } from '@/lib/profileValidation';

export default function ChangePhoneNoPage()
{
	const router = useRouter();
	const { showToast } = useToast();
	const { t } = useI18n();
	const [newPhoneNo, setNewPhoneNo] = useState('');
	const [loading, setLoading] = useState(false);
	const [msg, setMsg] = useState('');

	const handleSubmit = async(e: React.FormEvent) => {
		e.preventDefault();
		setMsg('');

		if (!newPhoneNo.trim())
		{
			setMsg(t('validation.phoneRequired'));
			return ;
		}
		const invalid = validatePhone(newPhoneNo);
		if (invalid)
		{
			setMsg(t(invalid));
			showToast(t(invalid), 'error');
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
				body: JSON.stringify({ phoneNo: normalizePhone(newPhoneNo) })
			});

			const data = await res.json().catch(() => ({}));

			if (!res.ok)
			{
				const message = data.error ?? t('toast.phoneUpdateFailed');
				setMsg(message);
				showToast(message, 'error');
				return ;
			}
			setMsg(t('toast.phoneUpdated'));
			showToast(t('toast.phoneUpdated'), 'success');
			setTimeout(() => router.push('/profile'), 800);
		}
		catch
		{
			setMsg(t('toast.networkError'));
			showToast(t('toast.networkError'), 'error');
		}
		finally
		{
			setLoading(false);
		}
	}

	return (
		<div className="flex justify-center items-center h-[calc(100vh-80px)] bg-[#fafafa] px-4 py-6">
			<main className="bg-white p-10 rounded-lg shadow-[0_4px_6px_rgba(0,0,0,0.1)] w-full max-w-[560px] flex flex-col gap-4">
				<h1 className="text-center mb-2 text-[#333]">Change Phone Number</h1>
				<form onSubmit={handleSubmit} className="grid gap-3">
					<input
						type="tel"
						inputMode="tel"
						autoComplete="tel"
						maxLength={PROFILE_LIMITS.phoneRaw}
						placeholder="Enter new Phone Number"
						value={newPhoneNo}
						onChange={(e) => setNewPhoneNo(e.target.value)}
						required
						className="p-3 border border-[#ccc] rounded text-base"
					/>
					<button type="submit" disabled={loading} className="p-3 bg-[#080808] text-white border-none rounded text-base font-bold cursor-pointer w-full mt-0 hover:bg-[#323131] disabled:opacity-70 disabled:cursor-not-allowed">
						{loading ? 'Saving...' : 'Save New Phone Number'}
					</button>
				</form>
				{msg && <p className="mt-1">{msg}</p>}
			</main>
		</div>
	);
}
