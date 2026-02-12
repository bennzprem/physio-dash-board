'use client';

import { useState } from 'react';

const DEGREES = [
	{ value: "Bachelor's Degree (BPT)", label: "Bachelor's Degree (BPT)", amount: 2500 },
	{ value: "Master's Degree (MPT)", label: "Master's Degree (MPT)", amount: 5000 },
	{ value: 'Clinical', label: 'Clinical', amount: 2500 },
];

export default function RegisterInternPage() {
	const [name, setName] = useState('');
	const [college, setCollege] = useState('');
	const [degree, setDegree] = useState(DEGREES[0].value);
	const [dateOfJoining, setDateOfJoining] = useState('');
	const [dateOfLeaving, setDateOfLeaving] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

	const selectedDegree = DEGREES.find(d => d.value === degree);
	const amount = selectedDegree?.amount ?? 2500;

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setMessage(null);
		if (!name.trim() || !college.trim() || !dateOfJoining || !dateOfLeaving) {
			setMessage({ type: 'error', text: 'Please fill all required fields.' });
			return;
		}
		const joining = new Date(dateOfJoining);
		const leaving = new Date(dateOfLeaving);
		if (leaving < joining) {
			setMessage({ type: 'error', text: 'Date of leaving must be after date of joining.' });
			return;
		}
		setSubmitting(true);
		try {
			const res = await fetch('/api/intern-registration', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: name.trim(),
					college: college.trim(),
					degree,
					dateOfJoining,
					dateOfLeaving,
					amount,
				}),
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				setMessage({ type: 'error', text: data.error || 'Submission failed. Please try again.' });
				return;
			}
			setMessage({ type: 'success', text: data.message || 'Registration submitted successfully. Front desk will review and add you to the interns list.' });
			setName('');
			setCollege('');
			setDegree(DEGREES[0].value);
			setDateOfJoining('');
			setDateOfLeaving('');
		} catch (err) {
			setMessage({ type: 'error', text: 'Network error. Please try again.' });
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="min-h-screen bg-slate-50 py-8 px-4 sm:px-6 lg:px-8">
			<div className="max-w-lg mx-auto">
				<div className="bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden">
					<div className="bg-blue-600 px-6 py-4">
						<h1 className="text-xl font-bold text-white">Intern Registration</h1>
						<p className="text-blue-100 text-sm mt-1">Submit your details. Front desk will review and add you to the interns list.</p>
					</div>
					<form onSubmit={handleSubmit} className="p-6 space-y-4">
						{message && (
							<div
								className={`p-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}
								role="alert"
							>
								{message.text}
							</div>
						)}
						<div>
							<label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-1">Name <span className="text-red-500">*</span></label>
							<input
								id="name"
								type="text"
								value={name}
								onChange={(e) => setName(e.target.value)}
								required
								className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900"
								placeholder="Your full name"
							/>
						</div>
						<div>
							<label htmlFor="college" className="block text-sm font-medium text-slate-700 mb-1">College / University <span className="text-red-500">*</span></label>
							<input
								id="college"
								type="text"
								value={college}
								onChange={(e) => setCollege(e.target.value)}
								required
								className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900"
								placeholder="College or university name"
							/>
						</div>
						<div>
							<label htmlFor="degree" className="block text-sm font-medium text-slate-700 mb-1">Degree <span className="text-red-500">*</span></label>
							<select
								id="degree"
								value={degree}
								onChange={(e) => setDegree(e.target.value)}
								className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 bg-white"
							>
								{DEGREES.map((d) => (
									<option key={d.value} value={d.value}>{d.label} (₹{d.amount.toLocaleString('en-IN')})</option>
								))}
							</select>
						</div>
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
							<div>
								<label htmlFor="dateOfJoining" className="block text-sm font-medium text-slate-700 mb-1">Date of Joining <span className="text-red-500">*</span></label>
								<input
									id="dateOfJoining"
									type="date"
									value={dateOfJoining}
									onChange={(e) => setDateOfJoining(e.target.value)}
									required
									className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900"
								/>
							</div>
							<div>
								<label htmlFor="dateOfLeaving" className="block text-sm font-medium text-slate-700 mb-1">Date of Leaving <span className="text-red-500">*</span></label>
								<input
									id="dateOfLeaving"
									type="date"
									value={dateOfLeaving}
									onChange={(e) => setDateOfLeaving(e.target.value)}
									required
									className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900"
								/>
							</div>
						</div>
						<p className="text-sm text-slate-500">Amount for selected degree: ₹{amount.toLocaleString('en-IN')}</p>
						<button
							type="submit"
							disabled={submitting}
							className="w-full py-3 px-4 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
						>
							{submitting ? 'Submitting...' : 'Submit Registration'}
						</button>
					</form>
				</div>
				<p className="mt-4 text-center text-sm text-slate-500">
					After submission, front desk will approve your registration and you will appear in the Interns List.
				</p>
			</div>
		</div>
	);
}
