'use client';
import React, { useEffect, useState } from 'react';
import { useAuth } from '@/modules/user/components/AuthContext';
import { useRouter } from 'next/navigation';
import styles from './login.module.css';

export default function LoginPage ()
{
	const [username, setUsername] = useState('');
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [isRegister, setIsRegister] = useState(false);
	const [showOtp, setShowOtp] = useState(false);
	const [otpCode, setOtpCode] = useState('');
	const [tempToken, setTempToken] = useState('');
	const [resendCd, setResendCd] = useState(0)
	const { login } = useAuth(); //only take login from useauth()
	const router = useRouter(); //so when instead of calling userRouter() call router only

	//useEffect accepts 2 parameter. 1. anonymous fx 2. dependency array - makes useEffect keeps watching it, everytime it changes it redo 
	useEffect(() => 
	{
		if (resendCd <= 0)
			return ;

		const timer = setInterval(() => 
			{ setResendCd((prev) => (prev > 0 ? prev - 1 : 0)); }, 1000);

		return () => clearInterval(timer);
	}, [resendCd]);

	const handleResendOtp = async () => {
		if (resendCd > 0) return;

		if (!email.trim())
		{
			alert('Email is required to resend OTP');
			return ;
		}

		try
		{
			const res = await fetch ('http://localhost:8080/api/v1/auth/resend-otp', 
			{
				method: 'POST',
				headers: { 'Content-Type' : 'application/json' },
				body: JSON.stringify({ email }),
			});

			const data = await res.json();
			if (res.ok)
			{
				if (!data.tempToken) {
					alert('Resend succeeded but no tempToken returned. Please try login again.');
					return;
				}
				setTempToken(data.tempToken);
				setResendCd(60);
				alert(data.message ?? 'OTP sent');
				return ;
			}
			alert(data.error ?? 'Failed to resend OTP');
		}
		catch(err)
		{
			console.error(err)
			alert('Network error')
		}
	};


	const handleSubmit = async (e: React.FormEvent) =>
	{
		e.preventDefault(); //prevent default behaviour of submit. like sigint which automatically exit program, we want to modify our default submit behaviour. we dont want it to refresh 

		try
		{
			let res;
			if (showOtp)
			{
				if (!tempToken.trim() || !otpCode.trim()) {
					alert('tempToken and otpCode are required. Please request a new OTP and enter the code.');
					return;
				}
				res = await fetch('http://localhost:8080/api/v1/auth/verify-otp', 
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify ( {tempToken, otpCode})
				});
			}
			else
			{
				const endpoint = isRegister ? 'http://localhost:8080/api/v1/auth/register' : 'http://localhost:8080/api/v1/auth/login';
				res = await fetch(endpoint, 
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(
						isRegister ? {username, email, password, firstName: username, lastName: ''} : { email, password },
					)
				}); //use fetch to get response from fetch sending http request. wait for server reply
			}
			
			const data = await res.json(); //read and parse the response body. wait for body parsing
			if (res.ok) //means status code between 200 and 299
			{
				if (data?.needOtp)
				{
					setTempToken(data.tempToken);
					setShowOtp(true);
				}
				else if (isRegister && !showOtp)
				{
					setIsRegister(false); setShowOtp(false); setTempToken(''); setOtpCode(''); setPassword('');
					alert(data?.message ?? 'Registration successful. Please login.');
				}
				else
				{
					if (data?.token) //? means check data exists or not first then check token
						localStorage.setItem('token', data.token);
					login(data?.user ?? data); // give me data?.user if it exist, give data if data.user, dont exists
					router.push('/'); //navigate user to route homepage
				}
			}
			else
			{
				alert(data.error); //shows a popup error returned by backend
				if (showOtp)
					setOtpCode('');
			}
		}
		catch (err)
		{
			console.error(err); //prints error in browser dev console
			alert('Network error'); //shows alert for user
		}
	};

	const renderAuthForm = () => 
	{
		if (showOtp)
		{
			return (
				<>
					<h2>Enter OTP Code</h2>
					<input
						type="text"
						placeholder="6-digit OTP"
						value={otpCode}
						onChange={(e) => setOtpCode(e.target.value)}
						required
						className={styles.input}
					/>
					<div style={{display: 'flex', gap: 8}}>
						<button type="submit" className ={styles.button}>Verify Code</button>
						<button type="button" className={styles.button} onClick={handleResendOtp} disabled={resendCd > 0}>
							{resendCd > 0 ? `Resend OTP (${resendCd}s)` : 'Resend OTP'}
						</button>
					</div>
				</>
			);
		}
		return (
			<>
				<h2>{isRegister ? 'Register' : 'Login'}</h2>
				{isRegister && (
					<input //form of control element that let user input data
						type="text"
						placeholder="Username" //the text appear before typing
						value={username} //telling that value (what inputted) must be the same with username (stored username)
						onChange={(e) => setUsername(e.target.value)} //(e) event object. => points to code we want to run. e.target pointer to input box. e.pointer.value the current string inside the box
						required
						className={styles.input}
					/>
				)}
				<input
					type="email"
					placeholder = "Email"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					required
					className={styles.input}
				/>

				<input 
				type="password"  //typed chars are masked
				placeholder="Password"  //only "password" text shown when input empty. so that field is known as place to write password
				value={password} //what inputted given to react. controlled inout method
				onChange={(e) => setPassword(e.target.value)} //every time user types save to password state
				required 
				className={styles.input}
				/>
				
				<button type="submit" className={styles.button}>
					{isRegister ? 'Sign Up' : 'Sign In'}
				</button> 
				<p className={styles.toggle} onClick={() => setIsRegister(!isRegister)}>
					{isRegister ? 'Already have an account? Login' : `Dont't have an account? Register`}
				</p>
			</> //single tick for sentence with no ','. back tick for sentence w/ alot of signs
		);
	};

	return (
		//on submit=[handlesubmit] means when user click submit it call handlesubmit
		<div className={styles.container}>
			<form onSubmit={handleSubmit} className={styles.form}> 
				{renderAuthForm()}
			</form>
		</div>
	);
}

// const verifyOtpRequest = 
// {
// 	method: 'POST',
// 	headers: { 'Content-Type': 'application/json' },
// 	body: JSON.stringify ( {tempToken, otpCode})
// }
// const endpoint = isRegister ? 'http://localhost:8080/api/v1/auth/register' : 'http://localhost:8080/api/v1/auth/login';
// const loginRequest = 
// {
// 	method: 'POST',
// 	headers: { 'Content-Type': 'application/json' },
// 	body: JSON.stringify(
// 		isRegister ? {username, email, password, firstName: username, lastName: ''} : { email, password },
// 	)
// };


	// const handleSubmit = async (e: React.FormEvent) =>
	// {
	// 	e.preventDefault(); //prevent default behaviour of submit. like sigint which automatically exit program, we want to modify our default submit behaviour. we dont want it to refresh 

	// 	try
	// 	{
	// 		if (showOtp)
	// 		{
	// 			const res = await fetch('http://localhost:8080/api/v1/auth/verify-otp', 
	// 			{
	// 				method: 'POST',
	// 				headers: { 'Content-Type': 'application/json' },
	// 				body: JSON.stringify ( {tempToken, otpCode})
	// 			});

	// 			const data = await res.json();
	// 			if (res.ok)
	// 			{
	// 				if (data?.token) //? means check data exists or not first then check token
	// 					localStorage.setItem('token', data.token);
	// 				login(data?.user ?? data); // give me data?.user if it exist, give data if data.user, dont exists
	// 				router.push('/'); //navigate user to route homepage
	// 			}
	// 			else
	// 			{
	// 				alert(data.error);
	// 				setOtpCode('');
	// 			}
	// 			return ;
	// 		}

	// 		const endpoint = isRegister ? 'http://localhost:8080/api/v1/auth/register' : 'http://localhost:8080/api/v1/auth/login';
	// 		const res = await fetch(endpoint, 
	// 		{
	// 			method: 'POST',
	// 			headers: { 'Content-Type': 'application/json' },
	// 			body: JSON.stringify(
	// 				isRegister ? {username, email, password, firstName: username, lastName: ''} : { email, password },
	// 			)
	// 		}); //use fetch to get response from fetch sending http request. wait for server reply
			
	// 		const data = await res.json(); //read and parse the response body. wait for body parsing
	// 		if (res.ok) //means status code between 200 and 299
	// 		{
	// 			if (data?.needOtp)
	// 			{
	// 				setTempToken(data.tempToken);
	// 				setShowOtp(true);
	// 			}
	// 			else
	// 			{
	// 				if (isRegister)
	// 				{
	// 					setIsRegister(false); setShowOtp(false); setTempToken(''); setOtpCode(''); setPassword('');
	// 					alert(data?.message ?? 'Registration successful. Please login.');
	// 					return ;
	// 				}
	// 				if (data?.token) //? means check data exists or not first then check token
	// 					localStorage.setItem('token', data.token);
	// 				login(data?.user ?? data); // give me data?.user if it exist, give data if data.user, dont exists
	// 				router.push('/'); //navigate user to route homepage
	// 			}
	// 		}
	// 		else
	// 			alert(data.error); //shows a popup error returned by backend
	// 	}
	// 	catch (err)
	// 	{
	// 		console.error(err); //prints error in browser dev console
	// 		alert('Network error'); //shows alert for user
	// 	}
	// };