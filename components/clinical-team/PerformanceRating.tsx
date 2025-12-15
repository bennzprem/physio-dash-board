'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs, addDoc, serverTimestamp, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/PageHeader';

interface StaffMember {
	id: string;
	userName: string;
	userEmail?: string;
	role: string;
	status: string;
}

interface StaffRating {
	id: string;
	ratedStaffId: string;
	ratedStaffName: string;
	ratedStaffEmail?: string;
	raterId: string;
	raterName: string;
	raterEmail: string;
	rating: 1 | 2 | 3 | 4 | 5;
	criteria: string;
	comments?: string;
	status: 'Pending' | 'Approved' | 'Rejected';
	createdAt: Timestamp;
	updatedAt?: Timestamp;
	approvedBy?: string;
	approvedAt?: Timestamp;
	rejectedBy?: string;
	rejectedAt?: Timestamp;
	rejectionReason?: string;
}

// Rating schema definitions
const RATING_SCHEMA = {
	1: 'Punctuality, T-Shirt',
	2: 'Leave, No Camp Off, No Off Work',
	3: 'Physio S&C collab, Testing & Technical Reports, New Clients',
	4: 'Collab, ₹30k–₹50k Conversion, Consistency',
	5: 'Exceptional, Research, Incentive, Marketing',
} as const;

// Authorized raters
const AUTHORIZED_RATERS = ['dharanjaydubey@css.com', 'shajisp@css.com'];
const SPECIAL_RATING_RULE = {
	ratedEmail: 'dharanjaydubey@css.com',
	allowedRater: 'nawazaman@css.com',
};

export default function PerformanceRating() {
	const { user } = useAuth();
	const [staff, setStaff] = useState<StaffMember[]>([]);
	const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);
	const [rating, setRating] = useState<1 | 2 | 3 | 4 | 5 | null>(null);
	const [comments, setComments] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [submittedRatings, setSubmittedRatings] = useState<StaffRating[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	// Check if current user can rate
	const canRate = useMemo(() => {
		if (!user?.email) return false;
		return AUTHORIZED_RATERS.includes(user.email.toLowerCase());
	}, [user?.email]);

	// Check if user can rate a specific staff member
	const canRateStaff = (staffMember: StaffMember): boolean => {
		if (!user?.email || !canRate) return false;
		const userEmail = user.email.toLowerCase();
		const staffEmail = staffMember.userEmail?.toLowerCase();

		// Special rule: dharanjaydubey@css.com can only be rated by nawazaman@css.com
		if (staffEmail === SPECIAL_RATING_RULE.ratedEmail) {
			return userEmail === SPECIAL_RATING_RULE.allowedRater.toLowerCase();
		}

		// General rule: authorized raters can rate all other clinical team members
		return true;
	};

	// Load staff members (only clinical team)
	useEffect(() => {
		const unsubscribe = onSnapshot(
			collection(db, 'staff'),
			(snapshot) => {
				const mapped = snapshot.docs
					.map((docSnap) => {
						const data = docSnap.data() as Record<string, unknown>;
						return {
							id: docSnap.id,
							userName: data.userName ? String(data.userName) : '',
							userEmail: data.userEmail ? String(data.userEmail) : undefined,
							role: data.role ? String(data.role) : '',
							status: data.status ? String(data.status) : '',
						} as StaffMember;
					})
					.filter(
						(s) =>
							s.status === 'Active' &&
							['Physiotherapist', 'StrengthAndConditioning', 'ClinicalTeam'].includes(s.role)
					);
				setStaff(mapped);
				setLoading(false);
			},
			(error) => {
				console.error('Failed to load staff', error);
				setError('Failed to load staff members');
				setLoading(false);
			}
		);

		return () => unsubscribe();
	}, []);

	// Load submitted ratings by current user
	useEffect(() => {
		if (!user?.email) return;

		const unsubscribe = onSnapshot(
			query(collection(db, 'staffRatings'), where('raterEmail', '==', user.email.toLowerCase())),
			(snapshot) => {
				const mapped = snapshot.docs.map((docSnap) => ({
					id: docSnap.id,
					...docSnap.data(),
				})) as StaffRating[];
				setSubmittedRatings(mapped.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis()));
			},
			(error) => {
				console.error('Failed to load submitted ratings', error);
			}
		);

		return () => unsubscribe();
	}, [user?.email]);

	// Filter staff that can be rated by current user
	const rateableStaff = useMemo(() => {
		return staff.filter((s) => canRateStaff(s));
	}, [staff, canRate]);

	const handleSubmit = async () => {
		if (!selectedStaff || !rating || !user?.email || !user?.displayName) {
			setError('Please select a staff member and provide a rating');
			return;
		}

		setSubmitting(true);
		setError(null);
		setSuccess(null);

		try {
			const ratingData = {
				ratedStaffId: selectedStaff.id,
				ratedStaffName: selectedStaff.userName,
				ratedStaffEmail: selectedStaff.userEmail?.toLowerCase() || '',
				raterId: user.uid || '',
				raterName: user.displayName || user.email,
				raterEmail: user.email.toLowerCase(),
				rating,
				criteria: RATING_SCHEMA[rating],
				comments: comments.trim() || undefined,
				status: 'Pending' as const,
				createdAt: serverTimestamp(),
			};

			await addDoc(collection(db, 'staffRatings'), ratingData);

			setSuccess(`Rating submitted successfully! The rating is pending approval.`);
			setSelectedStaff(null);
			setRating(null);
			setComments('');
		} catch (err) {
			console.error('Failed to submit rating', err);
			setError(`Failed to submit rating: ${err instanceof Error ? err.message : 'Unknown error'}`);
		} finally {
			setSubmitting(false);
		}
	};

	if (loading) {
		return (
			<div className="min-h-svh bg-purple-50 px-6 py-10">
				<div className="mx-auto max-w-6xl">
					<div className="flex items-center justify-center py-20">
						<div className="text-center">
							<div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-purple-600 border-r-transparent"></div>
							<p className="text-sm text-slate-600">Loading...</p>
						</div>
					</div>
				</div>
			</div>
		);
	}

	if (!canRate) {
		return (
			<div className="min-h-svh bg-purple-50 px-6 py-10">
				<div className="mx-auto max-w-6xl">
					<PageHeader title="Performance Rating" />
					<div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
						<i className="fas fa-lock mb-4 text-4xl text-amber-600"></i>
						<h3 className="mb-2 text-lg font-semibold text-amber-900">Access Restricted</h3>
						<p className="text-sm text-amber-700">
							You do not have permission to submit performance ratings. Only authorized raters can access this feature.
						</p>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-svh bg-purple-50 px-6 py-10">
			<div className="mx-auto max-w-6xl space-y-8">
				<PageHeader title="Performance Rating System" />

				{error && (
					<div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
						<i className="fas fa-exclamation-circle mr-2"></i>
						{error}
					</div>
				)}

				{success && (
					<div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
						<i className="fas fa-check-circle mr-2"></i>
						{success}
					</div>
				)}

				{/* Rating Form */}
				<div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
					<h2 className="mb-6 text-xl font-semibold text-slate-900">Submit Performance Rating</h2>

					<div className="space-y-6">
						{/* Staff Selection */}
						<div>
							<label className="mb-2 block text-sm font-medium text-slate-700">
								Select Staff Member <span className="text-red-500">*</span>
							</label>
							<select
								value={selectedStaff?.id || ''}
								onChange={(e) => {
									const staffMember = staff.find((s) => s.id === e.target.value);
									setSelectedStaff(staffMember || null);
								}}
								className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
							>
								<option value="">-- Select a staff member --</option>
								{rateableStaff.map((s) => (
									<option key={s.id} value={s.id}>
										{s.userName} {s.userEmail ? `(${s.userEmail})` : ''} - {s.role}
									</option>
								))}
							</select>
							{rateableStaff.length === 0 && (
								<p className="mt-2 text-xs text-slate-500">No staff members available for rating.</p>
							)}
						</div>

						{/* Rating Selection */}
						{selectedStaff && (
							<div>
								<label className="mb-3 block text-sm font-medium text-slate-700">
									Performance Rating <span className="text-red-500">*</span>
								</label>
								<div className="space-y-3">
									{[1, 2, 3, 4, 5].map((star) => (
										<label
											key={star}
											className={`flex cursor-pointer items-center rounded-lg border-2 p-4 transition ${
												rating === star
													? 'border-purple-500 bg-purple-50'
													: 'border-slate-200 bg-white hover:border-purple-300 hover:bg-purple-50/50'
											}`}
										>
											<input
												type="radio"
												name="rating"
												value={star}
												checked={rating === star}
												onChange={() => setRating(star as 1 | 2 | 3 | 4 | 5)}
												className="mr-4 h-5 w-5 cursor-pointer text-purple-600 focus:ring-purple-500"
											/>
											<div className="flex-1">
												<div className="mb-1 flex items-center">
													{[...Array(star)].map((_, i) => (
														<i key={i} className="fas fa-star text-yellow-400"></i>
													))}
													{[...Array(5 - star)].map((_, i) => (
														<i key={i} className="far fa-star text-slate-300"></i>
													))}
													<span className="ml-2 font-semibold text-slate-900">{star} Star{star > 1 ? 's' : ''}</span>
												</div>
												<p className="text-sm text-slate-600">{RATING_SCHEMA[star as keyof typeof RATING_SCHEMA]}</p>
											</div>
										</label>
									))}
								</div>
							</div>
						)}

						{/* Comments */}
						{selectedStaff && rating && (
							<div>
								<label className="mb-2 block text-sm font-medium text-slate-700">Additional Comments (Optional)</label>
								<textarea
									value={comments}
									onChange={(e) => setComments(e.target.value)}
									rows={4}
									className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
									placeholder="Add any additional comments or observations..."
								/>
							</div>
						)}

						{/* Submit Button */}
						<div className="flex justify-end">
							<button
								onClick={handleSubmit}
								disabled={!selectedStaff || !rating || submitting}
								className="rounded-lg bg-purple-600 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
							>
								{submitting ? (
									<>
										<i className="fas fa-spinner fa-spin mr-2"></i>
										Submitting...
									</>
								) : (
									<>
										<i className="fas fa-paper-plane mr-2"></i>
										Submit Rating
									</>
								)}
							</button>
						</div>
					</div>
				</div>

				{/* Submitted Ratings History */}
				{submittedRatings.length > 0 && (
					<div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
						<h2 className="mb-6 text-xl font-semibold text-slate-900">Your Submitted Ratings</h2>
						<div className="space-y-4">
							{submittedRatings.map((ratingRecord) => (
								<div
									key={ratingRecord.id}
									className={`rounded-lg border-2 p-4 ${
										ratingRecord.status === 'Approved'
											? 'border-green-200 bg-green-50'
											: ratingRecord.status === 'Rejected'
												? 'border-red-200 bg-red-50'
												: 'border-amber-200 bg-amber-50'
									}`}
								>
									<div className="flex items-start justify-between">
										<div className="flex-1">
											<div className="mb-2 flex items-center gap-3">
												<h3 className="font-semibold text-slate-900">{ratingRecord.ratedStaffName}</h3>
												<span
													className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
														ratingRecord.status === 'Approved'
															? 'bg-green-100 text-green-800'
															: ratingRecord.status === 'Rejected'
																? 'bg-red-100 text-red-800'
																: 'bg-amber-100 text-amber-800'
													}`}
												>
													{ratingRecord.status}
												</span>
											</div>
											<div className="mb-2 flex items-center">
												{[...Array(ratingRecord.rating)].map((_, i) => (
													<i key={i} className="fas fa-star text-yellow-400"></i>
												))}
												{[...Array(5 - ratingRecord.rating)].map((_, i) => (
													<i key={i} className="far fa-star text-slate-300"></i>
												))}
												<span className="ml-2 text-sm text-slate-600">{ratingRecord.criteria}</span>
											</div>
											{ratingRecord.comments && (
												<p className="mb-2 text-sm text-slate-600">
													<strong>Comments:</strong> {ratingRecord.comments}
												</p>
											)}
											{ratingRecord.rejectionReason && (
												<p className="mb-2 text-sm text-red-600">
													<strong>Rejection Reason:</strong> {ratingRecord.rejectionReason}
												</p>
											)}
											<p className="text-xs text-slate-500">
												Submitted on:{' '}
												{ratingRecord.createdAt?.toDate?.().toLocaleString() ||
													new Date(ratingRecord.createdAt as any).toLocaleString()}
											</p>
										</div>
									</div>
								</div>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

