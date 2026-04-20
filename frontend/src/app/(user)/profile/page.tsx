'use client'

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/modules/user/components/AuthContext';
import Header from '@/components/Header/Header';
import styles from './profile.module.css'

interface UserProfile {
	id: number;
	username: string;
	email: string;
	firstName?: string;
	lastName?: string;
	phoneNo?: string;
	gender?: string;
	dateOfBirth?: string;
}

export default function ProfilePage()
{
	const router = useRouter();
	const { user:ctxUser, logout } = useAuth();
	const [user, setUser] = useState<UserProfile | null>(ctxUser ?? null);
	const [loading, setLoading] = useState(!ctxUser);
	const [error, setError] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState('');
	const [formData, setFormData] = useState({
		firstName: ctxUser?.firstName ?? '',
		lastName: ctxUser?.lastName ?? '',
		gender: ctxUser?.gender ?? '',
		dateOfBirth: ctxUser?.dateOfBirth ?? '',
	});

	//OTP Handling
	const [showOtp, setShowOtp] = useState(false);
	const [otpCode, setOtpCode] = useState('');
	const [tempToken, setTempToken] = useState('');
	const [resendCd, setResendCd] = useState(0);
	const [changeTarget, setChangeTarget] = useState<'email' | 'phoneNo' | null>(null);

	useEffect(() => 
	{
		if (resendCd <= 0)
			return ;

		const timer = setInterval(() => 
			{ setResendCd((prev) => (prev > 0 ? prev - 1 : 0)); }, 1000);

		return () => clearInterval(timer);
	}, [resendCd]);

	const sendOtp = async () => {
		if (resendCd > 0) return false;

		if (!ctxUser?.email.trim())
		{
			alert('Email is required to resend OTP');
			return false;
		}

		try
		{
			const res = await fetch ('http://localhost:8080/api/v1/auth/resend-otp', 
			{
				method: 'POST',
				headers: { 'Content-Type' : 'application/json' },
				body: JSON.stringify({ email: ctxUser?.email }),
			});

			const data = await res.json();
			if (res.ok)
			{
				if (!data.tempToken) {
					alert('Resend succeeded but no tempToken returned. Please try login again.');
					return false;
				}
				setTempToken(data.tempToken);
				setResendCd(60);
				alert(data.message ?? 'OTP resent');
				return true;
			}
			alert(data.error ?? 'Failed to resend OTP');
			return false;
		}
		catch(err)
		{
			console.error(err)
			alert('Network error')
			return false;
		}
	};


	const startOtpFlow = async (target: 'email' | 'phoneNo') => {
		setChangeTarget(target);
		setOtpCode('');
		const sent = await sendOtp();
		if (sent)
			setShowOtp(true);
	};

	//OTP Handling
	const handleOtp = async() =>
	{
		try
		{
			if (!tempToken.trim() || !otpCode.trim()) {
				alert('tempToken and otpCode are required. Please request a new OTP and enter the code.');
				return;
			}
			const res = await fetch('http://localhost:8080/api/v1/auth/verify-otp', 
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify ( {tempToken, otpCode})
			});
			const data = await res.json();
			if (res.ok) //means status code between 200 and 299
			{
				if (data?.needOtp) //the backend will only return needotp if it is after sending email step
				{
					setTempToken(data.tempToken);
					setShowOtp(true);
				}
				else //step after verified the otp
				{
					setShowOtp(false);
					setOtpCode('');
					alert('OTP verified')
					router.push(changeTarget === 'email' ? '/profile/change-email' : '/profile/change-phoneNo')
				}
			}
			else
			{
				setOtpCode('');
				alert(data.error); //shows a popup error returned by backend
			}
		}
		catch (err)
		{
			console.error(err); //prints error in browser dev console
			alert('Network error'); //shows alert for user
		}
	};

	const handleOtpSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		await handleOtp();
	};

	const handleSearch = () => {
		router.push(`/?search=${encodeURIComponent(searchQuery)}`);
	}

	useEffect(() => {

		const fetchMe = async ()=> 
		{
			setLoading(true);
			try
			{
				const token = localStorage.getItem('token') ?? '';
				const res = await fetch ('http://localhost:8080/api/v1/me', {
					headers: {
						Authorization: token ? `Bearer ${token}` : '',
					},
				});

				if (res.status === 401) //unauthorized/expired/invalid
				{
					router.push('/login');
					return ;
				}

				if (!res.ok)
				{
					const data = await res.json().catch(() => ({}));
					throw new Error(data.error || 'Failed to load profile');
				}

				const data = await res.json();
				setUser(data);
			}
			catch (err)
			{
				if (err instanceof Error)
					setError(err.message)
				else
					setError('An unexpected error occured')
			}
			finally
			{
				setLoading(false);
			}
		};

		fetchMe();
	}, [router]);

	useEffect(() => {
		if (user) {
			setFormData({
				firstName: user.firstName ?? '',
				lastName: user.lastName ?? '',
				gender: user.gender ?? '',
				dateOfBirth: user.dateOfBirth ?? '',
			});
		}
	}, [user]);

	const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
		const { name, value } = e.target;
		setFormData((prev) => ({...prev, [name]:value }));
	};

	const handleSave = async() => {
		try {
			const updatedFormData = {
				...formData,
				dateOfBirth: formData.dateOfBirth ? new Date(`${formData.dateOfBirth}T00:00:00Z`).toISOString() : null,
			};
			const token = localStorage.getItem('token');
			const res = await fetch('http://localhost:8080/api/v1/users/update', {
				method: 'PUT',
				headers: {
					'Content-Type':'application/json',
					'Authorization':`Bearer ${token}`
				},
				body: JSON.stringify(updatedFormData)
			});
			if (res.ok)
			{
				alert('Profile successfully updated')
				const updated = await res.json();
				setUser(updated);
			}
			else
			{
				alert('Failed to update profile')
			}
		}
		catch (err)
		{
				alert('Connection error. is the server running?');
		}
	}
	if (loading) return <div style={{ padding: 24 }}>Loading profile...</div>;
	if (error) return (
		<div style={{ padding: 24 }}>
			<p>Error: {error}</p>
			<button className="btn btn-secondary" onClick={() => router.push('/login')}>Login</button>
		</div>
	);
	
	if (!user) return null;

	const rowStyle: React.CSSProperties = { display: 'flex', gap: 12, alignItems: 'center', margin: '10px 0' };
	const labelStyle: React.CSSProperties = { width: 140, fontWeight: 600 };
	const mainStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', minHeight: '100vh' };
	const staticStyle: React.CSSProperties = { flex: 1, padding: '8px', color: '#666' };
	const cardStyle: React.CSSProperties = { background: 'white', borderRadius: 8, boxShadow: 'var(--shadow)', padding: 24, maxWidth: 760, margin: '24px auto'};
	const inputStyle: React.CSSProperties = { flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #ddd', background: '#fff'}
	const today = new Date().toISOString().split('T')[0];

	if (showOtp)
	{
		return (
			<div className={styles.otpContainer}>
				<form onSubmit={handleOtpSubmit} className={styles.otpForm}>
					<h2>Enter OTP Code</h2>
					<p className={styles.otpPurpose}>Verifying Purpose: {changeTarget === 'email' ? 'Change Email' : 'Change Phone Number'}</p>
					<input
						type="text"
						placeholder="6-digit OTP"
						value={otpCode}
						onChange={(e) => setOtpCode(e.target.value)}
						required
						className={styles.input}
					/>
					<div className={styles.otpActions}>
						<button type="submit" className ={styles.button}>Verify Code</button>
						<button type="button" className={styles.button} onClick={sendOtp} disabled={resendCd > 0}>
							{resendCd > 0 ? `Resend OTP (${resendCd}s)` : 'Resend OTP'}
						</button>
					</div>
				</form>
			</div>
		);
	}
	return (
		<main style={mainStyle}>
	  	<Header
			searchValue={searchQuery}
			onSearchChange={setSearchQuery}
			onSearchSubmit={handleSearch}
	 	 />

			<div className="container" style={{ flex: 1 }}>
				<div style={cardStyle}>
					<h1>My profile</h1>
					<p>Manage and protect your account</p>

					<div style={rowStyle}><div style={labelStyle}>Username</div><div style={staticStyle}>{user.username}</div></div>

					<div style={rowStyle}><div style={labelStyle}>Email</div><div style={staticStyle}>{user.email}</div><button className="btn btn-secondary btn-sm" onClick={() => startOtpFlow('email')}>change</button></div>

					<div style={rowStyle}><div style={labelStyle}>Phone Number</div><div style={staticStyle}>{user.phoneNo}</div><button className="btn btn-secondary btn-sm" onClick={() => startOtpFlow('phoneNo')}>change</button></div>

					<hr style={{ margin: '20px 0', border: '0', borderTop:'1px solid #eee'}}/>

					<div style={rowStyle}><div style={labelStyle}>First Name</div><input name="firstName" value={formData.firstName} onChange={handleChange} style={inputStyle}/></div>

					<div style={rowStyle}><div style={labelStyle}>Last Name</div><input name="lastName" value={formData.lastName} onChange={handleChange} style={inputStyle}/></div>

					<div style={rowStyle}><div style={labelStyle}>Gender</div><div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
						<div style={staticStyle}>{user.gender}</div>
						<label><input type="radio" name="gender" value="Male" checked={formData.gender === 'Male'} onChange={handleChange}/>Male</label>
						<label><input type="radio" name="gender" value="Female" checked={formData.gender === 'Female'} onChange={handleChange}/>Female</label>
						<label><input type="radio" name="gender" value="PreferNotToTell" checked={false} onChange={() => { alert('🏳️‍🌈🏳️‍🌈🏳️‍🌈 ARE YOU GAY?'); }}/>Prefer not to tell</label>
						<button type="button" className="btn btn-secondary btn-sm" onClick={() => setFormData((prev) => ({ ...prev, gender: ''}))}>Clear</button>
					</div></div>

					<div style={rowStyle}><div style={labelStyle}>Date of birth</div><div style={staticStyle}>{user.dateOfBirth ? new Date(user.dateOfBirth).toLocaleDateString() : ''}</div><input type="date" name="dateOfBirth" value={formData.dateOfBirth} onChange={handleChange} max={today} min="1950-01-01"/></div>

					<div style={{ marginTop: 24, borderTop:'1px solid #eee', paddingTop:20 }}><button className="btn btn-primary" onClick={handleSave}>Save Profile Changes</button></div>
				</div>
			</div>
		</main>
	)
}

// export default function ProfilePage()
// {
// 	const router = useRouter();
// 	const { user:ctxUser, logout } = useAuth();
// 	const [user, setUser] = useState<UserProfile | null>(ctxUser ?? null);
// 	const [loading, setLoading] = useState(!ctxUser);
// 	const [error, setError] = useState<string | null>(null);
// 	const [searchQuery, setSearchQuery] = useState('');
// 	const [formData, setFormData] = useState({
// 		firstName: ctxUser?.firstName ?? '',
// 		lastName: ctxUser?.lastName ?? '',
// 		gender: ctxUser?.gender ?? '',
// 		dateOfBirth: ctxUser?.dateOfBirth ?? '',
// 	});

// 	const handleSearch = () => {
//     	router.push(`/?search=${encodeURIComponent(searchQuery)}`);
//   	}

// 	useEffect(() => {

// 		const fetchMe = async ()=> 
// 		{
// 			setLoading(true);
// 			try
// 			{
// 				const token = localStorage.getItem('token') ?? '';
// 				const res = await fetch ('http://localhost:8080/api/v1/me', {
// 					headers: {
// 						Authorization: token ? `Bearer ${token}` : '',
// 					},
// 				});

// 				if (res.status === 401)
// 				{
// 					router.push('/login');
// 					return ;
// 				}

// 				if (!res.ok)
// 				{
// 					const data = await res.json().catch(() => ({}));
// 					throw new Error(data.error || 'Failed to load profile');
// 				}

// 				const data = await res.json();
// 				setUser(data);
// 			}
// 			catch (err)
// 			{
// 				if (err instanceof Error)
// 					setError(err.message)
// 				else
// 					setError('An unexpected error occured')
// 			}
// 			finally
// 			{
// 				setLoading(false);
// 			}
// 		};

// 		fetchMe();
// 	}, [router]);

// 	useEffect(() => {
// 		if (user) {
// 			setFormData({
// 				firstName: user.firstName ?? '',
// 				lastName: user.lastName ?? '',
// 				gender: user.gender ?? '',
// 				dateOfBirth: user.dateOfBirth ?? '',
// 			});
// 		}
// 	}, [user]);

// 	const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
// 		const { name, value } = e.target;
// 		setFormData((prev) => ({...prev, [name]:value }));
// 	};

// 	const handleSave = async() => {
// 		try {
// 			const updatedFormData = {
// 				...formData,
// 				dateOfBirth: formData.dateOfBirth ? new Date(`${formData.dateOfBirth}T00:00:00Z`).toISOString() : null,
// 			};
// 			const token = localStorage.getItem('token');
// 			const res = await fetch('http://localhost:8080/api/v1/users/update', {
// 				method: 'PUT',
// 				headers: {
// 					'Content-Type':'application/json',
// 					'Authorization':`Bearer ${token}`
// 				},
// 				body: JSON.stringify(updatedFormData)
// 			});
// 			if (res.ok)
// 			{
// 				alert('Profile successfully updated')
// 				const updated = await res.json();
// 				setUser(updated);
// 			}
// 			else
// 			{
// 				alert('Failed to update profile')
// 			}
// 		}
// 		catch (err)
// 		{
// 				alert('Connection error. is the server running?');
// 		}
// 	}
// 	if (loading) return <div style={{ padding: 24 }}>Loading profile...</div>;
// 	if (error) return (
// 		<div style={{ padding: 24 }}>
// 			<p>Error: {error}</p>
// 			<button className="btn btn-secondary" onClick={() => router.push('/login')}>Login</button>
// 		</div>
// 	);
	
// 	if (!user) return null;

// 	const rowStyle: React.CSSProperties = { display: 'flex', gap: 12, alignItems: 'center', margin: '10px 0' };
// 	const labelStyle: React.CSSProperties = { width: 140, fontWeight: 600 };
// 	const mainStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', minHeight: '100vh' };
// 	const staticStyle: React.CSSProperties = { flex: 1, padding: '8px', color: '#666' };
// 	const cardStyle: React.CSSProperties = { background: 'white', borderRadius: 8, boxShadow: 'var(--shadow)', padding: 24, maxWidth: 760, margin: '24px auto'};
// 	const inputStyle: React.CSSProperties = { flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #ddd', background: '#fff'}
// 	const today = new Date().toISOString().split('T')[0];

// 	return (
// 		<main style={mainStyle}>
// 	  	<Header
// 			searchValue={searchQuery}
// 			onSearchChange={setSearchQuery}
// 			onSearchSubmit={handleSearch}
// 	 	 />

// 			<div className="container" style={{ flex: 1 }}>
// 				<div style={cardStyle}>
// 					<h1>My profile</h1>
// 					<p>Manage and protect your account</p>

// 					<div style={rowStyle}><div style={labelStyle}>Username</div><div style={staticStyle}>{user.username}</div></div>

// 					<div style={rowStyle}><div style={labelStyle}>Email</div><div style={staticStyle}>{user.email}</div><button className="btn btn-secondary btn-sm" onClick={() => alert('Change email requires 2FA')}>change</button></div>

// 					<div style={rowStyle}><div style={labelStyle}>Phone Number</div><div style={staticStyle}>{user.phone}</div><button className="btn btn-secondary btn-sm" onClick={() => alert('Change email requires 2FA')}>change</button></div>

// 					<hr style={{ margin: '20px 0', border: '0', borderTop:'1px solid #eee'}}/>

// 					<div style={rowStyle}><div style={labelStyle}>First Name</div><input name="firstName" value={formData.firstName} onChange={handleChange} style={inputStyle}/></div>

// 					<div style={rowStyle}><div style={labelStyle}>Last Name</div><input name="lastName" value={formData.lastName} onChange={handleChange} style={inputStyle}/></div>

// 					<div style={rowStyle}><div style={labelStyle}>Gender</div><div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
// 						<label><input type="radio" name="gender" value="Male" checked={formData.gender === 'Male'} onChange={handleChange}/>Male</label>
// 						<label><input type="radio" name="gender" value="Female" checked={formData.gender === 'Female'} onChange={handleChange}/>Female</label>
// 						<label><input type="radio" name="gender" value="PreferNotToTell" checked={false} onChange={() => { alert('🏳️‍🌈🏳️‍🌈🏳️‍🌈 ARE YOU GAY?'); }}/>Prefer not to tell</label>
// 						<button type="button" className="btn btn-secondary btn-sm" onClick={() => setFormData((prev) => ({ ...prev, gender: ''}))}>Clear</button>
// 					</div></div>

// 					<div style={rowStyle}><div style={labelStyle}>Date of birth</div><input type="date" name="dateOfBirth" value={formData.dateOfBirth} onChange={handleChange} max={today} min="1950-01-01"/></div>

// 					<div style={{ marginTop: 24, borderTop:'1px solid #eee', paddingTop:20 }}><button className="btn btn-primary" onClick={handleSave}>Save Profile Changes</button></div>
// 				</div>
// 			</div>
// 		</main>
// 	)
// }