'use client'

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/modules/user/components/AuthContext';

interface UserProfile {
	id: number;
	username: string;
	email: string;
	firstName?: string;
	lastName?: string;
	phone?: string;
	gender?: string;
	dob?: string;
}

export default function ProfilePage()
{
	const router = useRouter();
	const { user:ctxUser, logout } = useAuth();
	const [user, setUser] = useState<UserProfile | null>(ctxUser ?? null);
	const [loading, setLoading] = useState(!ctxUser);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (user) return;

		const fetchMe = async ()=> 
		{
			setLoading(true);
			try
			{
				const token = localStorage.getItem('token') ?? '';
				const res = await fetch ('http://localhost:8080/me', {
					headers: {
						Authorization: token ? `Bearer ${token}` : '',
					},
				});

				if (res.status === 401)
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
	}, [router, user]);

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
	const mainStyle: React.CSSProperties = { width: 140, fontWeight: 600 };
	const headerStyle: React.CSSProperties = {
		background: 'white',
		borderBottom: '1px solid var(--border)',
		boxShadow: 'var(--shadow)',
		position: 'sticky',
		top: 0,
		zIndex: 1000,
		padding: '16px-0'
	};
	const headerTopStyle: React.CSSProperties = {
		display: 'flex',
		justifyContent: 'space-between',
		alignItems: 'çenter',
		marginBottom: 8,
		gap: 12,
		flexWrap: 'wrap',
	};
	const logoStyle: React.CSSProperties = { fontSize: 24, fontWeight: 700, color: 'var(--prmary)', margin: 0 };
	const headerActionsStyle: React.CSSProperties = { display: 'flex', gap:  12 };
	const cardStyle: React.CSSProperties {
		background: 'white',
		borderRadius: 8,
		boxShadow: 'var(--shadow)',
		padding: 24,
		maxWidth: 760,
		margin: '24px auto',
	};
	const footerStyle: React.CSSProperties = {
		background: 'var(--dark)',
		color: 'white',
		padding: '40px 0 20px',
		marginTop: 40
	};
	const footerGridStyle: React.CSSProperties {
		display: 'grid',
		gridTemplateColumn: 'repeat(auto-fit, minmax(180px, 1fr))',
		gap: 30,
		marginBottom: 30,
	};
	const footerBottomStyle: React.CSSProperties = {
		textAlign: 'center',
		paddingTop: 20,
		borderTop: '1px solid rgba(255, 255, 255, 0.1)',
		color: '#aaa',
		fontSize: 14,
	};
	const footerLinkStyle: React.CSSProperties = { color: '#aaa', textDecoration: 'none' };

	return (
		<main style={mainStyle}>
			</>
		<main style={mainStyle}>
			<header style={headerStyle}>
				<div className="container">
					<div style={headerTopStyle}>
						<h1 style={logoStyle}>🛍️ Transcendence</h1>
						<div style={headerActionsStyle}>
							<button className="btn btn-secondary btn-sm" onClick={() => router.push('/')}>Home</button>
							<button className="btn btn-secondary btn-sm" onClick={() => router.push('/friends')}>Friends</button>
							<button className="btn btn-secondary btn-sm" onClick={logout}>Logout</button>
						</div>
					</div>
				</div>
			</header>

			<div className="container" style={{ flex: 1 }}>
				<div style={cardStyle}>
					<h1>My profile</h1>
					<p>Manage and protect your account</p>

					<div style={rowStyle}><div style={labelStyle}>Username</div><div>{user.username}</div></div>

					<div style={rowStyle}><div style={labelStyle}>First Name</div><div>{(user.firstName ?? '')}</div></div>

					<div style={rowStyle}><div style={labelStyle}>Last Name</div><div>{(user.lastName ?? '')}</div></div>

					<div style={rowStyle}>
						<div style={labelStyle}>Email</div><div>{user.email}</div>
						<div style={{ marginLeft: 'auto' }}><button className="btn btn-secondary btn-sm" onClick={() => alert('Change email hasnt been implemented')}>change</button></div>
					</div>

					<div style={rowStyle}>
						<div style={labelStyle}>Phone Number</div><div>{user.phone ?? '—'}</div>
						<div style={{ marginLeft: 'auto' }}> <button className="btn btn-secondary btn-sm" onClick={() => alert('Change phone number hasnt been implemented')}>change</button></div>
					</div>

					<div style={rowStyle}><div style={labelStyle}>Gender</div><div>{user.gender ?? '—'}</div></div>

					<div style={rowStyle}><div style={labelStyle}>Date of birth</div><div>{user.dob ?? '—'}</div></div>

					<div style={{ marginTop: 18 }}>
						<button className="btn btn-primary" onClick={() => router.push('/profile/edit')}>Edit Profile</button>
					</div>
				</div>
			</div>

			<footer style={footerStyle}>
				<div className="container">
					<div style={footerGridStyle}>
						<div>
							<h4>About Us</h4>
							<ul>
								<li><a style={footerLinkStyle} href="#">About Transcendence</a></li>
								<li><a style={footerLinkStyle} href="#">Contact Us</a></li>
								<li><a style={footerLinkStyle} href="#">Blog</a></li>
							</ul>
						</div>
						<div>
							<h4>Support</h4>
							<ul>
								<li><a style={footerLinkStyle} href="#">Help Center</a></li>
								<li><a style={footerLinkStyle} href="#">Safety Tips</a></li>
								<li><a style={footerLinkStyle} href="#">Report Item</a></li>
							</ul>
						</div>
						<div>
							<h4>Community</h4>
							<ul>
								<li><a style={footerLinkStyle} href="#">Terms &amp; Conditions</a></li>
								<li><a style={footerLinkStyle} href="#">Privacy Policy</a></li>
								<li><a style={footerLinkStyle} href="#">Careers</a></li>
							</ul>
						</div>
						<div>
							<h4>Follow Us</h4>
							<div style={{ display: 'flex', gap: 12, flexDirection: 'column' }}>
								<a style={footerLinkStyle} href="#">Facebook</a>
								<a style={footerLinkStyle} href="#">Instagram</a>
								<a style={footerLinkStyle} href="#">Twitter</a>
							</div>
						</div>
					</div>
					<div style={footerBottomStyle}>
						<p>&copy; 2024 Transcendence Marketplace. All rights reserved.</p>
					</div>
				</div>
			</footer>
		</main>
	)
}