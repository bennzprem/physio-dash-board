'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import styles from './login.module.css';

type AllowedRole = 'SuperAdmin' | 'Admin' | 'FrontDesk' | 'ClinicalTeam';

const ROLE_ROUTES: Record<AllowedRole, string> = {
	SuperAdmin: '/super-admin',
	Admin: '/admin',
	FrontDesk: '/frontdesk',
	ClinicalTeam: '/clinical-team',
};

function EnvelopeIcon() {
	return (
		<span className={styles.inputIcon}>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
				<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
				<polyline points="22,6 12,13 2,6" />
			</svg>
		</span>
	);
}

function LockIcon() {
	return (
		<span className={styles.inputIcon}>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
				<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
				<path d="M7 11V7a5 5 0 0 1 10 0v4" />
			</svg>
		</span>
	);
}

function EyeIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
			<circle cx="12" cy="12" r="3" />
		</svg>
	);
}

function EyeSlashIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
			<line x1="1" y1="1" x2="23" y2="23" />
		</svg>
	);
}

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
		<div className={styles.container}>
			{/* Left Side - Login Form */}
			<div className={styles.leftSide}>
				<div className={styles.logo}>
					<div className={styles.logoIcon}>CSS</div>
					<div className={styles.logoText}>Centre for Sports Science</div>
				</div>

				<div className={styles.formContainer}>
					<h1>Welcome Back!</h1>
					<p className={styles.subtitle}>
						Sign in to access your dashboard and continue managing your clinical workflows.
					</p>

					<form onSubmit={handleSubmit}>
						<div className={styles.formGroup}>
							<label htmlFor="email">Email</label>
							<div className={styles.inputWrapper}>
								<EnvelopeIcon />
								<input
									type="email"
									id="email"
									placeholder="Enter your email"
									value={formState.email}
									onChange={e => setFormState(prev => ({ ...prev, email: e.target.value }))}
									disabled={loading}
									required
								/>
							</div>
						</div>

						<div className={styles.formGroup}>
							<label htmlFor="password">Password</label>
							<div className={`${styles.inputWrapper} ${styles.passwordWrapper}`}>
								<LockIcon />
								<input
									type={showPassword ? 'text' : 'password'}
									id="password"
									placeholder="Enter your password"
									value={formState.password}
									onChange={e => setFormState(prev => ({ ...prev, password: e.target.value }))}
									disabled={loading}
									required
								/>
								<button
									type="button"
									className={styles.togglePassword}
									onClick={() => setShowPassword(prev => !prev)}
									disabled={loading}
									aria-label={showPassword ? 'Hide password' : 'Show password'}
								>
									{showPassword ? <EyeSlashIcon /> : <EyeIcon />}
								</button>
							</div>
							<div className={styles.forgotPassword}>
								<Link href="/forgot-password">Forgot Password?</Link>
							</div>
						</div>

						{error && (
							<div className={styles.errorBox}>
								<p>
									<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }} aria-hidden>
										<circle cx="12" cy="12" r="10" />
										<line x1="12" y1="8" x2="12" y2="12" />
										<line x1="12" y1="16" x2="12.01" y2="16" />
									</svg>
									{error}
								</p>
							</div>
						)}

						<button type="submit" className={styles.signInBtn} disabled={loading}>
							{loading ? (
								<span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
									<svg className={styles.spin} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden style={{ display: 'inline-block' }}>
										<circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity={0.25} />
										<path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" opacity={0.75} />
									</svg>
									Signing in...
								</span>
							) : (
								'Sign In'
							)}
						</button>
					</form>

					<div className={styles.divider}>OR</div>

					<button type="button" className={styles.socialBtn} disabled={loading}>
						<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
							<path d="M19.8055 10.2292C19.8055 9.55556 19.7499 8.87499 19.6305 8.20833H10.2V12.0208H15.6012C15.3751 13.2292 14.6764 14.2917 13.6597 15C14.4792 15.5639 15.4167 15.9583 16.4166 16.1458C18.5832 14.2083 19.8055 11.3958 19.8055 10.2292Z" fill="#4285F4" />
							<path d="M10.2 20C12.7541 20 14.8874 19.1042 16.4166 16.1458L13.6597 15C12.8319 15.5347 11.7916 15.8542 10.2 15.8542C7.73325 15.8542 5.65825 13.9028 4.92075 11.375H2.05408V13.5139C3.61575 16.625 6.72908 20 10.2 20Z" fill="#34A853" />
							<path d="M4.92075 11.375C4.50825 10.2292 4.50825 8.77778 4.92075 7.625V5.48611H2.05408C0.745083 8.08333 0.745083 11.9167 2.05408 14.5139L4.92075 11.375Z" fill="#FBBC04" />
							<path d="M10.2 4.14583C11.8624 4.11806 13.4652 4.73611 14.6624 5.875L17.0749 3.45833C14.7874 1.29167 11.786 0.0763889 10.2 0.104167C6.72908 0.104167 3.61575 3.375 2.05408 5.48611L4.92075 7.625C5.65825 5.09722 7.73325 4.14583 10.2 4.14583Z" fill="#EA4335" />
						</svg>
						Continue with Google
					</button>

					<button type="button" className={styles.socialBtn} disabled={loading}>
						<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
							<path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
						</svg>
						Continue with Apple
					</button>

					<div className={styles.signupLink}>
						Don&apos;t have an account? <Link href="#">Sign Up</Link>
					</div>
				</div>
			</div>

			{/* Right Side - Hero Section */}
			<div className={styles.rightSide}>
				<div className={styles.heroContent}>
					<h2 className={styles.heroTitle}>
						Streamline patient care with your clinical dashboard
					</h2>

					<div className={styles.testimonial}>
						<div className={styles.quote}>
							The Centre for Sports Science dashboard has transformed how we track patient progress. Clear, reliable, and built for clinicians.
						</div>
						<div className={styles.author}>
							<div className={styles.authorImg}>MC</div>
							<div className={styles.authorInfo}>
								<h4>Michael Carter</h4>
								<p>Lead Physiotherapist</p>
							</div>
						</div>
					</div>
				</div>

				<div className={styles.teamsSection}>
					<div className={styles.teamsTitle}>TRUSTED BY CLINICS</div>
					<div className={styles.companyLogos}>
						<div className={styles.companyLogo}>Clinic A</div>
						<div className={styles.companyLogo}>Clinic B</div>
						<div className={styles.companyLogo}>Clinic C</div>
						<div className={styles.companyLogo}>Clinic D</div>
						<div className={styles.companyLogo}>Clinic E</div>
						<div className={styles.companyLogo}>Clinic F</div>
					</div>
				</div>

				<div className={styles.copyright}>
					© {new Date().getFullYear()} Centre for Sports Science. All rights reserved.
				</div>
			</div>
		</div>
	);
}
