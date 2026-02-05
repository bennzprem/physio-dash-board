'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import Image from 'next/image';

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
			const errorCode = error?.code || error?.error?.code || '';
			const errorMessage = error?.message || error?.error?.message || 'Unknown error';

			if (errorCode === 'auth/invalid-credential' || errorCode === 'auth/wrong-password' || errorMessage.includes('invalid-credential')) {
				setError('Invalid email or password. Please check your credentials and try again.');
			} else if (errorCode === 'auth/user-not-found' || errorMessage.includes('user-not-found')) {
				setError('No account found with this email address. Please contact your administrator.');
			} else if (errorCode === 'auth/invalid-email' || errorMessage.includes('invalid-email')) {
				setError('Invalid email address format. Please enter a valid email address.');
			} else if (errorCode === 'auth/user-disabled' || errorMessage.includes('user-disabled')) {
				setError('This account has been disabled. Please contact your administrator.');
			} else if (errorCode === 'auth/too-many-requests' || errorMessage.includes('too-many-requests')) {
				setError('Too many failed login attempts. Please wait a few minutes and try again.');
			} else if (errorCode === 'auth/network-request-failed' || errorMessage.includes('network')) {
				setError('Network error. Please check your internet connection and try again.');
			} else {
				setError(`Unable to sign in. Please check your credentials or contact your administrator.`);
			}
		}
	};

	return (
		<div className="min-h-screen flex flex-col lg:flex-row">
			{/* Left Side - Image */}
			<div className="hidden lg:flex lg:w-1/2 relative bg-gradient-to-br from-purple-50 to-purple-100">
				<div className="relative w-full h-full flex items-center justify-center p-12">
					<Image
						src="/login-illustration.png"
						alt="Login Illustration"
						fill
						className="object-contain"
						priority
					/>
				</div>
			</div>

			{/* Right Side - Login Form */}
			<div className="flex-1 flex flex-col p-6 sm:p-8 lg:p-12 xl:p-16 bg-white">
				{/* Title at Top */}
				<div className="text-center mb-6 lg:mb-8">
					<h1 className="text-xl sm:text-2xl lg:text-3xl font-bold bg-gradient-to-r from-purple-600 to-purple-800 bg-clip-text text-transparent">Center of Sports Science</h1>
				</div>
				
				{/* Centered Form Container */}
				<div className="flex-1 flex items-center justify-center">
					<div className="w-full max-w-md">
						<form onSubmit={handleSubmit} className="space-y-5">
							{/* Header */}
							<div className="text-center mb-8">
								<h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-3">Welcome Back</h2>
								<p className="text-base text-gray-600">Sign in to continue to your dashboard</p>
							</div>

						{/* Email Field */}
						<div>
							<label htmlFor="email" className="block text-sm font-semibold text-gray-800 mb-2.5">
								Email Address
							</label>
							<input
								type="email"
								id="email"
								required
								value={formState.email}
								onChange={event => setFormState(current => ({ ...current, email: event.target.value }))}
								disabled={loading}
								className="w-full px-4 py-3.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all duration-200 disabled:bg-gray-50 disabled:cursor-not-allowed text-gray-900 placeholder:text-gray-400"
								placeholder="your.email@example.com"
							/>
						</div>

						{/* Password Field */}
						<div>
							<label htmlFor="password" className="block text-sm font-semibold text-gray-800 mb-2.5">
								Password
							</label>
							<div className="relative">
								<input
									type={showPassword ? 'text' : 'password'}
									id="password"
									required
									value={formState.password}
									onChange={event => setFormState(current => ({ ...current, password: event.target.value }))}
									disabled={loading}
									className="w-full px-4 py-3.5 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all duration-200 disabled:bg-gray-50 disabled:cursor-not-allowed text-gray-900 pr-12 placeholder:text-gray-400"
									placeholder="Enter your password"
								/>
								<button
									type="button"
									onClick={() => setShowPassword(prev => !prev)}
									className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 transition-colors duration-200 focus:outline-none"
									disabled={loading}
									aria-label={showPassword ? 'Hide password' : 'Show password'}
								>
									{showPassword ? (
										<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.29 3.29m0 0L9.88 9.88" />
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

						{/* Remember Me & Forgot Password */}
						<div className="flex items-center justify-between pt-1">
							<label className="flex items-center gap-2.5 cursor-pointer group">
								<input
									type="checkbox"
									className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-2 focus:ring-purple-500 focus:ring-offset-1 cursor-pointer transition-all"
								/>
								<span className="text-sm text-gray-700 group-hover:text-gray-900 transition-colors">Remember me</span>
							</label>
							<Link href="/forgot-password" className="text-sm text-purple-600 hover:text-purple-700 font-medium transition-colors duration-200">
								Forgot Password?
							</Link>
						</div>

						{/* Error Message */}
						{error && (
							<div className="p-4 bg-red-50 border border-red-200 rounded-xl animate-in fade-in slide-in-from-top-1 duration-300">
								<p className="text-sm text-red-800 flex items-start gap-2.5">
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
							className="w-full bg-gradient-to-r from-purple-600 to-purple-700 text-white py-3.5 rounded-xl font-semibold hover:from-purple-700 hover:to-purple-800 active:scale-[0.98] transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100 shadow-lg shadow-purple-500/30 hover:shadow-xl hover:shadow-purple-500/40 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
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

						{/* Sign Up Link */}
						<p className="text-center text-sm text-gray-600 pt-2">
							Don't have an account?{' '}
							<span className="text-purple-600 font-semibold cursor-pointer hover:text-purple-700 hover:underline transition-all duration-200">
								Sign up
							</span>
						</p>
					</form>
				</div>
			</div>
<<<<<<< HEAD
=======

			{/* Copyright Notice - Bottom Left */}
			<div className="absolute bottom-4 left-4 lg:left-8 text-white text-sm">
				<p>© {new Date().getFullYear()} Centre for Sports Science. All rights reserved.</p>
			</div>
>>>>>>> 82e6bc314219a88a0ea482484406a3511ebaa543
		</div>
	</div>
	);
}
