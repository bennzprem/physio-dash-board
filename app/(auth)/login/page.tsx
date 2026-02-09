'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
<<<<<<< HEAD
import { Mail, Lock, Eye, EyeOff, ArrowRight, AlertCircle } from 'lucide-react';
=======

const iconClass = 'h-5 w-5';
const iconClassSm = 'h-4 w-4';

const MailIcon = ({ className = iconClass }: { className?: string }) => (
	<svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
);
const LockIcon = ({ className = iconClass }: { className?: string }) => (
	<svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
);
const EyeIcon = ({ className = iconClass }: { className?: string }) => (
	<svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
);
const EyeOffIcon = ({ className = iconClass }: { className?: string }) => (
	<svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
);
const ArrowRightIcon = ({ className = iconClassSm }: { className?: string }) => (
	<svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
);
const AlertCircleIcon = ({ className = iconClass }: { className?: string }) => (
	<svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
);
const Loader2Icon = ({ className = iconClassSm }: { className?: string }) => (
	<svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
);
>>>>>>> 3ff247e59b3fba2a6fbbdb41978cabb2b53ffc8b

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
			const userCredential = await signInWithEmailAndPassword(auth as any, trimmedEmail, trimmedPassword);
			const uid = userCredential.user.uid;

			const userDocRef = doc(db as any, 'users', uid);
			const userSnap = await getDoc(userDocRef);

			if (!userSnap.exists()) {
				setError('User profile not found. Please contact your administrator.');
				setLoading(false);
				return;
			}

			const userData = userSnap.data();
			const rawRole = userData.role as string | undefined;

			let role: AllowedRole | undefined;
			if (rawRole) {
				const normalizedRole = String(rawRole).trim();
				const lowerRole = normalizedRole.toLowerCase();

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

			if (status !== 'Active' || userData.deleted === true) {
				setError('Your account is inactive. Please contact your administrator.');
				setLoading(false);
				return;
			}

			if (!role || !(role in ROLE_ROUTES)) {
				setError('Your role does not have dashboard access. Please contact your administrator.');
				setLoading(false);
				return;
			}

			const dashboardPath = ROLE_ROUTES[role];
			router.push(dashboardPath);
		} catch (err: any) {
			console.error('Login error:', err);
			setLoading(false);

			const errorCode = err?.code || err?.error?.code || '';
			const errorMessage = err?.message || err?.error?.message || 'Unknown error';

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
				setError('Unable to sign in. Please check your credentials or contact your administrator.');
			}
		}
	};

	return (
		<div className="flex min-h-screen bg-white font-sans text-slate-900 relative">
			{/* Loading Overlay */}
			{loading && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-white/95 backdrop-blur-sm">
					<div className="flex flex-col items-center gap-6">
						<div className="loaderRectangle">
							<div></div>
							<div></div>
							<div></div>
							<div></div>
							<div></div>
						</div>
						<p className="text-lg font-medium text-slate-600">Authenticating credentials...</p>
					</div>
				</div>
			)}

			{/* Left Side: Login Form */}
			<div className="flex w-full flex-col justify-between p-8 md:w-1/2 lg:p-16 xl:p-24">
				{/* Logo */}
				<div className="flex items-center gap-4">
					<Image 
						src="/CenterSportsScience_logo.jpg" 
						alt="Centre for Sports Science Logo"
						width={80}
						height={80}
						className="rounded-lg object-contain"
					/>
					<span className="text-2xl font-bold tracking-tight text-blue-700">
						Centre for Sports Science
					</span>
				</div>

				{/* Form Container */}
				<div className="mx-auto w-full max-w-md py-12">
					<div className="mb-10">
						<h1 className="mb-2 text-3xl font-bold text-slate-900">Welcome Back</h1>
						<p className="text-slate-500">
							Please enter your details to access your clinical workspace.
						</p>
					</div>

					<form className="space-y-6" onSubmit={handleSubmit}>
						{/* Email Field */}
						<div>
							<label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="email">
								Professional Email
							</label>
							<div className="relative">
								<div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
									<MailIcon className="h-5 w-5 text-slate-400" />
								</div>
								<input
									type="email"
									id="email"
									className="block w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-3 text-slate-900 placeholder-slate-400 transition-all focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10"
									placeholder="name@css.com"
									value={formState.email}
									onChange={e => setFormState(prev => ({ ...prev, email: e.target.value }))}
									disabled={loading}
									required
								/>
							</div>
						</div>

						{/* Password Field */}
						<div>
							<div className="flex items-center justify-between mb-2">
								<label className="block text-sm font-medium text-slate-700" htmlFor="password">
									Password
								</label>
								<Link href="/forgot-password" className="text-sm font-semibold text-blue-600 hover:text-blue-700">
									Forgot Password?
								</Link>
							</div>
							<div className="relative">
								<div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
									<LockIcon className="h-5 w-5 text-slate-400" />
								</div>
								<input
									type={showPassword ? "text" : "password"}
									id="password"
									className="block w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-12 text-slate-900 placeholder-slate-400 transition-all focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10"
									placeholder="••••••••"
									value={formState.password}
									onChange={e => setFormState(prev => ({ ...prev, password: e.target.value }))}
									disabled={loading}
									required
								/>
								<button
									type="button"
									onClick={() => setShowPassword(!showPassword)}
									className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600"
									disabled={loading}
									aria-label={showPassword ? 'Hide password' : 'Show password'}
								>
									{showPassword ? <EyeOffIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
								</button>
							</div>
						</div>

						{/* Error Message */}
						{error && (
							<div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-800">
								<AlertCircleIcon className="h-5 w-5 flex-shrink-0 mt-0.5" />
								<p>{error}</p>
							</div>
						)}

						<button
							type="submit"
							className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3.5 text-sm font-semibold text-white shadow-xl shadow-blue-200 transition-all hover:bg-blue-700 hover:shadow-blue-300 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
							disabled={loading}
						>
<<<<<<< HEAD
							Sign In to Dashboard
							<ArrowRight className="h-4 w-4" />
=======
							{loading ? (
								<>
									<Loader2Icon className="h-4 w-4 animate-spin" />
									Signing in...
								</>
							) : (
								<>
									Sign In to Dashboard
									<ArrowRightIcon className="h-4 w-4" />
								</>
							)}
>>>>>>> 3ff247e59b3fba2a6fbbdb41978cabb2b53ffc8b
						</button>
					</form>
				</div>

				{/* Footer - Empty for spacing */}
				<div></div>
			</div>

			{/* Right Side: Professional Branding Panel */}
			<div className="relative hidden w-1/2 overflow-hidden bg-slate-900 md:flex">
				{/* Abstract Background Design */}
				<div className="absolute inset-0 bg-gradient-to-br from-blue-900 via-slate-900 to-indigo-950"></div>
				
				{/* Subtle Grid Pattern Overlay */}
				<div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '40px 40px' }}></div>

				<div className="relative flex w-full flex-col items-center justify-center px-12 text-center text-white">
					<div className="mb-8 rounded-2xl bg-white/5 p-4 backdrop-blur-xl border border-white/10">
						<svg width="200" height="120" viewBox="0 0 200 120" fill="none" xmlns="http://www.w3.org/2000/svg">
							<rect x="10" y="20" width="180" height="80" rx="8" fill="white" fillOpacity="0.05" stroke="white" strokeOpacity="0.1" />
							<rect x="25" y="40" width="40" height="40" rx="4" fill="white" fillOpacity="0.1" />
							<rect x="75" y="40" width="100" height="8" rx="4" fill="white" fillOpacity="0.1" />
							<rect x="75" y="55" width="70" height="8" rx="4" fill="white" fillOpacity="0.1" />
							<rect x="75" y="70" width="90" height="8" rx="4" fill="white" fillOpacity="0.1" />
							<circle cx="160" cy="90" r="15" fill="#3B82F6" fillOpacity="0.5" />
						</svg>
					</div>
					
					<h2 className="mb-8 text-6xl font-bold tracking-tight text-white">
						CareAxis
					</h2>
					<p className="max-w-lg text-lg leading-relaxed text-blue-100/80">
						An intelligent platform designed to streamline patient services, clinical reporting, and financial management.
					</p>
				</div>

				{/* Copyright at bottom */}
				<div className="absolute bottom-8 left-12 text-xs text-blue-100/30">
					© {new Date().getFullYear()} Centre for Sports Science. All rights reserved.
				</div>
			</div>
		</div>
	);
}
