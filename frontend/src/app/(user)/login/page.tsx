'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';;
import { useToast } from '@/components/Toast/ToastContext';
import { useI18n } from '@/context/LanguageContext';
import { useRouter } from 'next/navigation';
import { MALAYSIA_STATES, districtsOf } from '@/lib/malaysia';
import { PROFILE_LIMITS, validateNewPassword, validatePhone, validatePostcode } from '@/lib/profileValidation';
import PasswordField from '@/components/PasswordField/PasswordField';

const inputClass = "p-3 border border-[#ccc] rounded text-base";
const passwordInputClass = "w-full p-3 pr-12 border border-[#ccc] rounded text-base";
const buttonClass = "p-3 bg-[var(--primary)] text-white border-none rounded text-base font-bold cursor-pointer mt-4 hover:bg-[var(--primary-dark)]";

export default function LoginPage ()
{
	const [username, setUsername] = useState('');
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [showPassword, setShowPassword] = useState(false);
	// An account always carries a phone and address: its listings inherit both.
	const [phoneNo, setPhoneNo] = useState('');
	const [address, setAddress] = useState('');
	const [postcode, setPostcode] = useState('');
	const [signupState, setSignupState] = useState('');
	const [district, setDistrict] = useState('');
	const [isRegister, setIsRegister] = useState(false);
	const [showOtp, setShowOtp] = useState(false);
	const [otpCode, setOtpCode] = useState('');
	const [tempToken, setTempToken] = useState('');
	const [resendCd, setResendCd] = useState(0)
	const { login } = useAuth(); //only take login from useauth()
	const { showToast } = useToast();
	const { t } = useI18n();
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
			showToast('Email is required to resend OTP', 'error');
			return ;
		}

		try
		{
			const res = await fetch ('/api/v1/auth/resend-otp',
			{
				method: 'POST',
				headers: { 'Content-Type' : 'application/json' },
				body: JSON.stringify({ email }),
			});

			const data = await res.json();
			if (res.ok)
			{
				if (!data.tempToken) {
					showToast('Resend succeeded but no tempToken returned. Please try login again.', 'error');
					return;
				}
				setTempToken(data.tempToken);
				setResendCd(60);
				showToast(data.message ?? 'OTP sent', 'success');
				return ;
			}
			showToast(data.error ?? 'Failed to resend OTP', 'error');
		}
		catch(err)
		{
			console.error(err)
			showToast('Network error', 'error');
		}
	};


	const handleSubmit = async (e: React.FormEvent) =>
	{
		e.preventDefault(); //prevent default behaviour of submit. like sigint which automatically exit program, we want to modify our default submit behaviour. we dont want it to refresh

		if (isRegister && !showOtp)
		{
			const phoneProblem = validatePhone(phoneNo);
			if (phoneProblem) { showToast(t(phoneProblem), 'error'); return; }
			if (!address.trim()) { showToast(t('validation.addressRequired'), 'error'); return; }
			const postcodeProblem = validatePostcode(postcode);
			if (postcodeProblem || !postcode.trim()) {
				showToast(t(postcodeProblem ?? 'validation.postcodeInvalid'), 'error');
				return;
			}
			if (!signupState || !district) { showToast(t('validation.stateRequired'), 'error'); return; }
			const passwordProblem = validateNewPassword(password, username);
			if (passwordProblem) { showToast(t(passwordProblem), 'error'); return; }
		}

		try
		{
			let res;
			if (showOtp)
			{
				if (!tempToken.trim() || !otpCode.trim()) {
					showToast('tempToken and otpCode are required. Please request a new OTP and enter the code.', 'error');
					return;
				}
				res = await fetch('/api/v1/auth/verify-otp',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify ( {tempToken, otpCode})
				});
			}
			else
			{
				const endpoint = isRegister ? '/api/v1/auth/register' : '/api/v1/auth/login';
				res = await fetch(endpoint,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(
						isRegister
						? {
							username, email, password, firstName: username.trim().slice(0, PROFILE_LIMITS.name), lastName: '',
							phoneNo: phoneNo.trim(),
							address: address.trim(),
							postcode: postcode.trim(),
							state: signupState,
							district,
						}
						: { email, password },
					)
				}); //use fetch to get response from fetch sending http request. wait for server reply
			}

			const data = await res.json().catch(() => null); //read and parse the response body. wait for body parsing
			if (res.status === 403 && !data) {
				showToast(t('validation.passwordBlocked'), 'error');
				return;
			}
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
					showToast(data?.message ?? 'Registration successful. Please login.', 'success');
				}
				else
				{
					if (data?.token) //? means check data exists or not first then check token
						localStorage.setItem('token', data.token);
					login(data?.user ?? data); // give me data?.user if it exist, give data if data.user, dont exists
					// Return to whatever sent them here (?redirect=), so signing in
					// from a listing lands back on that listing. Same-origin paths
					// only: an absolute URL here would be an open redirect.
					const target = new URLSearchParams(window.location.search).get('redirect');
					router.push(target && target.startsWith('/') && !target.startsWith('//') ? target : '/');
				}
			}
			else
			{
				showToast(data?.error ?? 'Network error', 'error'); //shows a popup error returned by backend
				if (showOtp)
					setOtpCode('');
			}
		}
		catch (err)
		{
			console.error(err); //prints error in browser dev console
			showToast('Network error', 'error'); //shows alert for user
		}
	};

	const renderAuthForm = () =>
	{
		if (showOtp)
		{
			return (
				<>
					<h2 className="text-center mb-4 text-[#333]">Enter OTP Code</h2>
					<input
						type="text"
						inputMode="numeric"
						autoComplete="one-time-code"
						placeholder="6-digit OTP"
						value={otpCode}
						onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, PROFILE_LIMITS.otp))}
						maxLength={PROFILE_LIMITS.otp}
						required
						className="p-3 border border-[#ccc] rounded text-base self-center text-center w-[200px]"
					/>
					<div className="flex gap-2 justify-center">
						<button type="submit" className={buttonClass}>Verify Code</button>
						<button type="button" className={buttonClass} onClick={handleResendOtp} disabled={resendCd > 0}>
							{resendCd > 0 ? `Resend OTP (${resendCd}s)` : 'Resend OTP'}
						</button>
					</div>
				</>
			);
		}
		return (
			<>
				<h2 className="text-center mb-4 text-[#333]">{isRegister ? 'Register' : 'Login'}</h2>
				{isRegister && (
					<input //form of control element that let user input data
						type="text"
						placeholder="Username" //the text appear before typing
						value={username} //telling that value (what inputted) must be the same with username (stored username)
						onChange={(e) => setUsername(e.target.value.slice(0, PROFILE_LIMITS.username))} //(e) event object. => points to code we want to run. e.target pointer to input box. e.pointer.value the current string inside the box
						maxLength={PROFILE_LIMITS.username}
						required
						className={inputClass}
					/>
				)}
				<input
					type="email"
					placeholder = "Email"
					value={email}
					onChange={(e) => setEmail(e.target.value.slice(0, PROFILE_LIMITS.email))}
					maxLength={PROFILE_LIMITS.email}
					required
					className={inputClass}
				/>

				<PasswordField
					placeholder="Password"
					value={password}
					onChange={setPassword}
					show={showPassword}
					onToggle={() => setShowPassword((open) => !open)}
					showLabel={t('auth.showPassword')}
					hideLabel={t('auth.hidePassword')}
					className={passwordInputClass}
					autoComplete={isRegister ? 'new-password' : 'current-password'}
				/>
				{isRegister && <p className="text-sm text-[#666] m-0">{t('validation.passwordRules')}</p>}

				{isRegister && (
					<>
						<input
							type="tel"
							placeholder="Phone number (e.g. 012-345 6789)"
							value={phoneNo}
							onChange={(e) => setPhoneNo(e.target.value)}
							maxLength={PROFILE_LIMITS.phoneRaw}
							required
							className={inputClass}
						/>
						<input
							type="text"
							placeholder="Unit and street"
							value={address}
							onChange={(e) => setAddress(e.target.value)}
							maxLength={PROFILE_LIMITS.address}
							required
							className={inputClass}
						/>
						<input
							type="text"
							inputMode="numeric"
							placeholder="Postcode"
							value={postcode}
							onChange={(e) => setPostcode(e.target.value.replace(/[^\d]/g, ''))}
							maxLength={PROFILE_LIMITS.postcode}
							required
							className={inputClass}
						/>
						<select
							value={signupState}
							onChange={(e) => { setSignupState(e.target.value); setDistrict(''); }}
							required
							className={inputClass}
						>
							<option value="">Select state</option>
							{MALAYSIA_STATES.map((s) => (
								<option key={s} value={s}>{s}</option>
							))}
						</select>
						<select
							value={district}
							onChange={(e) => setDistrict(e.target.value)}
							disabled={!signupState}
							required
							className={inputClass}
						>
							<option value="">Select district</option>
							{districtsOf(signupState).map((d) => (
								<option key={d} value={d}>{d}</option>
							))}
						</select>
					</>
				)}

				<button type="submit" className={buttonClass}>
					{isRegister ? 'Sign Up' : 'Sign In'}
				</button>
				<button type="button" className="inline-flex items-center justify-center gap-[10px] w-full p-3 bg-white border border-[#747775] rounded cursor-pointer" onClick={() => window.location.href = '/api/v1/auth/google'}>
					<img
						src="/google-icon.svg"
						alt=""
						className="w-[18px] h-[18px]"
						onError={(event) => { event.currentTarget.style.display = 'none'; }}
					/>
					Sign in with Google
				</button>
				{!isRegister && (
					<Link
						href="/admin/login"
						className="inline-flex items-center justify-center w-full p-3 border border-[#747775] rounded text-[#333] no-underline hover:bg-[#f5f5f5]"
					>
						{t('auth.adminLogin')}
					</Link>
				)}
				<p className="text-center text-[#666] text-[.9rem] cursor-pointer mt-4 hover:underline hover:text-[#333]" onClick={() => setIsRegister(!isRegister)}>
					{isRegister ? 'Already have an account? Login' : `Dont't have an account? Register`}
				</p>
			</> //single tick for sentence with no ','. back tick for sentence w/ alot of signs
		);
	};

	return (
		//on submit=[handlesubmit] means when user click submit it call handlesubmit
		<div className="flex justify-center items-center h-[calc(100vh-80px)] bg-[#fafafa]">
			<form onSubmit={handleSubmit} className="bg-white p-10 rounded-lg shadow-[0_4px_6px_rgba(0,0,0,0.1)] w-full max-w-[400px] flex flex-col gap-4">
				{renderAuthForm()}
			</form>
		</div>
	);
}
