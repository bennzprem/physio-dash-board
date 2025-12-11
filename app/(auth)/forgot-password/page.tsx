'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function ForgotPasswordPage() {
	const [email, setEmail] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		setSuccess(null);

		const trimmed = email.trim().toLowerCase();
		if (!trimmed) {
			setError('Please enter your email address.');
			return;
		}
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(trimmed)) {
			setError('Please enter a valid email address.');
			return;
		}

		setSubmitting(true);
		try {
			// Use our custom API route that supports custom emails
			const response = await fetch('/api/auth/forgot-password', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ email: trimmed }),
			});

			const data = await response.json();

			if (!response.ok) {
				setError(data.error || 'Something went wrong. Please try again.');
			} else {
				setSuccess(data.message || 'If an account exists for that email, a reset link has been sent.');
			}
		} catch (err: any) {
			console.error('Password reset error:', err);
			// Avoid leaking whether user exists
			setSuccess('If an account exists for that email, a reset link has been sent.');
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="flex min-h-svh items-center justify-center bg-gray-50 px-4 py-10">
			<div className="w-full max-w-md">
				<div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
					<h2 className="mb-6 text-center text-xl font-semibold text-gray-900">Forgot password</h2>
					<form onSubmit={handleSubmit} noValidate className="space-y-4">
						<div className="space-y-2">
							<label htmlFor="email" className="block text-sm font-medium text-gray-700">Email Address</label>
							<input
								id="email"
								type="email"
								autoComplete="email"
								className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none ring-0 transition placeholder:text-gray-400 focus:border-gray-400"
								value={email}
								onChange={e => setEmail(e.target.value)}
								placeholder="Enter your email"
								required
								disabled={submitting}
							/>
						</div>
						{error && (
							<div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
								{error}
							</div>
						)}
						{success && (
							<div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700" role="status">
								{success}
							</div>
						)}
						<button
							type="submit"
							className="inline-flex w-full items-center justify-center rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-70"
							disabled={submitting}
						>
							{submitting ? 'Sending...' : 'Send reset link'}
						</button>
					</form>
					<div className="mt-4 text-center">
						<Link href="/login" className="text-sm text-gray-600 hover:text-gray-900">Back to login</Link>
					</div>
				</div>
			</div>
		</div>
	);
}



