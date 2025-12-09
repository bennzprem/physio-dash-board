'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

type AllowedRole = 'SuperAdmin' | 'Admin' | 'FrontDesk' | 'ClinicalTeam';

const ROLE_ROUTES: Record<AllowedRole, string> = {
	SuperAdmin: '/super-admin',
	Admin: '/admin',
	FrontDesk: '/frontdesk',
	ClinicalTeam: '/clinical-team',
};

export default function LoginPage() {
	const [showPassword, setShowPassword] = useState(false);
	const [formState, setFormState] = useState({ email: '', password: '' });
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const router = useRouter();

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setError(null);

		const trimmedEmail = formState.email.trim().toLowerCase();
		const trimmedPassword = formState.password.trim();

		if (!trimmedEmail) {
			setError('Please enter your email address.');
			return;
		}

		if (!trimmedPassword) {
			setError('Please enter your password.');
			return;
		}

		setLoading(true);

		try {
			// Step 1: Authenticate with Firebase Auth
			const userCredential = await signInWithEmailAndPassword(auth as any, trimmedEmail, trimmedPassword);
			const uid = userCredential.user.uid;

			// Step 2: Fetch user document from Firestore using UID
			const userDocRef = doc(db as any, 'users', uid);
			const userSnap = await getDoc(userDocRef);

			if (!userSnap.exists()) {
				setError('User profile not found. Please contact your administrator.');
				setLoading(false);
				return;
			}

			const userData = userSnap.data();
			const rawRole = userData.role as string | undefined;

			// Normalize role to match expected format (case-insensitive matching)
			let role: AllowedRole | undefined;
			if (rawRole) {
				const normalizedRole = String(rawRole).trim();
				const lowerRole = normalizedRole.toLowerCase();
				
				// Map common variations to expected roles
				if (lowerRole === 'superadmin' || lowerRole === 'super admin' || lowerRole === 'super-admin') {
					role = 'SuperAdmin';
				} else if (lowerRole === 'admin') {
					role = 'Admin';
				} else if (lowerRole === 'frontdesk' || lowerRole === 'front desk' || lowerRole === 'front-desk') {
					role = 'FrontDesk';
				} else if (lowerRole === 'clinicalteam' || lowerRole === 'clinical team' || lowerRole === 'clinical-team' || lowerRole === 'clinic') {
					role = 'ClinicalTeam';
				} else if (normalizedRole === 'SuperAdmin' || normalizedRole === 'Admin' || normalizedRole === 'FrontDesk' || normalizedRole === 'ClinicalTeam') {
					role = normalizedRole as AllowedRole;
				}
			}

			const status = userData.status as 'Active' | 'Inactive' | undefined;

			// Step 3: Check if account is active
			if (status !== 'Active' || userData.deleted === true) {
				setError('Your account is inactive. Please contact your administrator.');
				setLoading(false);
				return;
			}

			// Step 4: Check if role is valid and has a dashboard
			if (!role || !(role in ROLE_ROUTES)) {
				console.error('Invalid role:', rawRole, 'Normalized:', role);
				setError('Your role does not have dashboard access. Please contact your administrator.');
				setLoading(false);
				return;
			}

			// Step 5: Redirect to appropriate dashboard
			const dashboardPath = ROLE_ROUTES[role];
			router.push(dashboardPath);
		} catch (error: any) {
			console.error('Login error:', error);
			setLoading(false);

			// Handle specific Firebase Auth errors
			if (error.code === 'auth/invalid-credential') {
				setError('Invalid email or password. Please check your credentials and try again.');
			} else if (error.code === 'auth/user-not-found') {
				setError('No account found with this email address.');
			} else if (error.code === 'auth/invalid-email') {
				setError('Invalid email address format.');
			} else if (error.code === 'auth/user-disabled') {
				setError('This account has been disabled. Please contact your administrator.');
			} else if (error.code === 'auth/too-many-requests') {
				setError('Too many failed login attempts. Please try again later.');
			} else {
				setError(error.message || 'Unable to sign in. Please try again.');
			}
		}
	};

	return (
		<div
			className="relative min-h-svh overflow-hidden bg-cover bg-center"
			style={{ backgroundImage: "url('/b2.jpg')" }}
		>
			{/* Gradient overlays for readability */}
			<div className="pointer-events-none absolute inset-0">
				<div className="absolute inset-0 bg-gradient-to-br from-blue-950/70 via-blue-900/60 to-blue-600/50" />
				<div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,_rgba(23,37,84,0.18),_transparent_55%)]" />
				<div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_70%,_rgba(30,64,175,0.14),_transparent_55%)]" />
				<div className="absolute top-0 left-0 w-[620px] h-[620px] bg-blue-900 rounded-full blur-[130px] opacity-20" />
				<div className="absolute bottom-0 right-0 w-[520px] h-[520px] bg-blue-700 rounded-full blur-[110px] opacity-15" />
			</div>

			<div className="relative flex min-h-svh">
				{/* Left Side - Branding */}
				<div className="hidden lg:flex lg:w-1/2 flex-col justify-center px-16 text-white">
					{/* Large Logo - Left Center */}
					<div className="mb-10">
						<Image
							src="/CenterSportsScience_logo.jpg"
							alt="Center for Sports Science logo"
							width={220}
							height={220}
							className="h-52 w-52 object-contain drop-shadow-2xl"
							priority
						/>
					</div>

					{/* Welcome Text - Left Aligned, Smaller */}
					<div className="mb-8">
						<h1 className="text-5xl font-extrabold mb-2 leading-tight tracking-wide whitespace-nowrap">
							Welcome Back
						</h1>
						<p className="text-3xl font-bold text-purple-200">.!</p>
					</div>

					{/* Center for Sports Science - Left Aligned */}
					<div className="mb-8">
						<h2 className="text-4xl font-bold mb-2 leading-tight">Center for Sports</h2>
						<h2 className="text-4xl font-bold leading-tight">Science</h2>
					</div>

					{/* Decorative line - Left Aligned */}
					<div className="mt-6">
						<div className="h-1 w-24 bg-gradient-to-r from-purple-300 to-purple-200 rounded-full"></div>
					</div>
				</div>

				{/* Right Side - Login Form */}
				<div className="w-full lg:w-1/2 flex items-center justify-center px-6 py-12">
					<div className="w-full max-w-md">
						{/* Login Card */}
						<div className="rounded-3xl bg-white/35 backdrop-blur-2xl border border-white/40 px-8 py-10 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.45)]">
							<div className="relative">
								{/* Login Header */}
								<div className="mb-8">
									<h2 className="text-4xl font-bold text-black mb-2">Login</h2>
									<p className="text-black font-semibold">Glad you're back.!</p>
								</div>

								<form className="space-y-6" onSubmit={handleSubmit}>
									{/* Email Input */}
									<div className="space-y-2">
										<label htmlFor="email" className="block text-sm font-semibold text-black">
											Email Address
										</label>
										<input
											id="email"
											type="email"
											required
											placeholder="your.email@centersports.com"
											value={formState.email}
											onChange={event => setFormState(current => ({ ...current, email: event.target.value }))}
											disabled={loading}
											className="w-full rounded-xl border-2 border-white/60 bg-white/80 px-4 py-3.5 text-sm text-black font-semibold outline-none transition-all focus:border-blue-400 focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-white/60 disabled:opacity-80"
										/>
									</div>

									{/* Password Input */}
									<div className="space-y-2">
										<label htmlFor="password" className="block text-sm font-semibold text-black">
											Password
										</label>
										<div className="relative">
											<input
												id="password"
												type={showPassword ? 'text' : 'password'}
												required
												placeholder="Enter your password"
												value={formState.password}
												onChange={event => setFormState(current => ({ ...current, password: event.target.value }))}
												disabled={loading}
												className="w-full rounded-xl border-2 border-white/60 bg-white/80 px-4 py-3.5 pr-12 text-sm text-black font-semibold outline-none transition-all focus:border-blue-400 focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-white/60 disabled:opacity-80"
											/>
											<button
												type="button"
												onClick={() => setShowPassword(prev => !prev)}
												className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-600 transition-colors"
												disabled={loading}
											>
												{showPassword ? (
													<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
														<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.29 3.29m0 0L9.88 9.88M6.29 6.29L3 3m3.29 3.29l3.29 3.29" />
													</svg>
												) : (
													<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
														<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
														<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
													</svg>
												)}
											</button>
										</div>
									</div>

									{/* Error Message */}
									{error && (
										<div className="rounded-xl border-2 border-red-300 bg-red-50 px-4 py-3">
											<p className="text-sm font-medium text-red-800 flex items-center gap-2">
												<svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
												</svg>
												{error}
											</p>
										</div>
									)}

									{/* Login Button */}
									<button
										type="submit"
										disabled={loading}
										className="w-full rounded-xl bg-gradient-to-r from-blue-900 via-blue-800 to-blue-700 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-900/40 transition-all hover:from-blue-800 hover:via-blue-700 hover:to-blue-600 hover:shadow-xl hover:shadow-blue-900/50 hover:scale-[1.02] focus:outline-none focus:ring-4 focus:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:scale-100"
									>
										{loading ? (
											<span className="flex items-center justify-center gap-2">
												<svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
													<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
													<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
												</svg>
												Signing in...
											</span>
										) : (
											'Login'
										)}
									</button>
								</form>

								{/* Forgot Password */}
								<div className="mt-6 text-center">
									<Link href="/forgot-password" className="text-sm text-slate-600 hover:text-blue-600 transition-colors">
										Forgot password ?
							</Link>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>

			{/* Copyright Notice - Bottom Left */}
			<div className="absolute bottom-4 left-4 lg:left-8 text-white text-sm">
				<p>© 2025 Centre for Sports Science. All rights reserved.</p>
			</div>
		</div>
	);
}

