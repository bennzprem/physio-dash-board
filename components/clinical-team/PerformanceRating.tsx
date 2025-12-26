'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs, addDoc, serverTimestamp, onSnapshot, Timestamp, deleteDoc, doc } from 'firebase/firestore';
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

interface RatingRequest {
	id: string;
	requestedById: string;
	requestedByName: string;
	requestedByEmail: string;
	requestMessage?: string;
	status: 'Pending' | 'Processed';
	createdAt: Timestamp;
	processedAt?: Timestamp;
	processedBy?: string;
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
	const [myRatings, setMyRatings] = useState<StaffRating[]>([]);
	const [ratingRequests, setRatingRequests] = useState<RatingRequest[]>([]);
	const [myRatingRequests, setMyRatingRequests] = useState<RatingRequest[]>([]);
	const [requestMessage, setRequestMessage] = useState('');
	const [submittingRequest, setSubmittingRequest] = useState(false);
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
				setStaff([...mapped]);
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

	// Load submitted ratings by current user (for raters)
	useEffect(() => {
		if (!user?.email || !canRate) return;

		const unsubscribe = onSnapshot(
			query(collection(db, 'staffRatings'), where('raterEmail', '==', user.email.toLowerCase())),
			(snapshot) => {
				const mapped = snapshot.docs.map((docSnap) => ({
					id: docSnap.id,
					...docSnap.data(),
				})) as StaffRating[];
				setSubmittedRatings([...mapped.sort((a, b) => {
					const aTime = a.createdAt?.toMillis?.() || 0;
					const bTime = b.createdAt?.toMillis?.() || 0;
					return bTime - aTime;
				})]);
			},
			(error) => {
				console.error('Failed to load submitted ratings', error);
			}
		);

		return () => unsubscribe();
	}, [user?.email, canRate]);

	// Load ratings received by current user (for clinical team members to view their own ratings)
	useEffect(() => {
		if (!user?.email || canRate) return;

		const unsubscribe = onSnapshot(
			query(collection(db, 'staffRatings'), where('ratedStaffEmail', '==', user.email.toLowerCase())),
			(snapshot) => {
				const mapped = snapshot.docs.map((docSnap) => ({
					id: docSnap.id,
					...docSnap.data(),
				})) as StaffRating[];
				// Only show approved ratings
				const approvedRatings = mapped.filter(r => r.status === 'Approved');
				setMyRatings([...approvedRatings.sort((a, b) => {
					const aTime = a.createdAt?.toMillis?.() || 0;
					const bTime = b.createdAt?.toMillis?.() || 0;
					return bTime - aTime;
				})]);
			},
			(error) => {
				console.error('Failed to load my ratings', error);
			}
		);

		return () => unsubscribe();
	}, [user?.email, canRate]);

	// Load rating requests for super admins
	useEffect(() => {
		if (!user?.email || !canRate) return;

		const unsubscribe = onSnapshot(
			query(collection(db, 'ratingRequests'), where('status', '==', 'Pending')),
			(snapshot) => {
				const mapped = snapshot.docs.map((docSnap) => ({
					id: docSnap.id,
					...docSnap.data(),
				})) as RatingRequest[];
				setRatingRequests([...mapped.sort((a, b) => {
					const aTime = a.createdAt?.toMillis?.() || 0;
					const bTime = b.createdAt?.toMillis?.() || 0;
					return bTime - aTime;
				})]);
			},
			(error) => {
				console.error('Failed to load rating requests', error);
			}
		);

		return () => unsubscribe();
	}, [user?.email, canRate]);

	// Load rating requests submitted by current user (for clinical team members)
	useEffect(() => {
		if (!user?.email || canRate) return;

		const unsubscribe = onSnapshot(
			query(collection(db, 'ratingRequests'), where('requestedByEmail', '==', user.email.toLowerCase())),
			(snapshot) => {
				const mapped = snapshot.docs.map((docSnap) => ({
					id: docSnap.id,
					...docSnap.data(),
				})) as RatingRequest[];
				setMyRatingRequests([...mapped.sort((a, b) => {
					const aTime = a.createdAt?.toMillis?.() || 0;
					const bTime = b.createdAt?.toMillis?.() || 0;
					return bTime - aTime;
				})]);
			},
			(error) => {
				console.error('Failed to load my rating requests', error);
			}
		);

		return () => unsubscribe();
	}, [user?.email, canRate]);

	// Filter staff that can be rated by current user
	const rateableStaff = useMemo(() => {
		return staff.filter((s) => canRateStaff(s));
	}, [staff, canRate]);

	// Calculate statistics for viewing own ratings
	const ratingStats = useMemo(() => {
		if (myRatings.length === 0) return null;
		
		const totalRatings = myRatings.length;
		const averageRating = myRatings.reduce((sum, r) => sum + r.rating, 0) / totalRatings;
		const ratingDistribution = {
			5: myRatings.filter(r => r.rating === 5).length,
			4: myRatings.filter(r => r.rating === 4).length,
			3: myRatings.filter(r => r.rating === 3).length,
			2: myRatings.filter(r => r.rating === 2).length,
			1: myRatings.filter(r => r.rating === 1).length,
		};
		
		return {
			totalRatings,
			averageRating: Math.round(averageRating * 10) / 10,
			ratingDistribution,
		};
	}, [myRatings]);

	const handleSubmit = async () => {
		if (!selectedStaff || !rating || !user?.email || !user?.displayName) {
			setError('Please select a staff member and provide a rating');
			return;
		}

		setSubmitting(true);
		setError(null);
		setSuccess(null);

		try {
			const trimmedComments = comments.trim();
			const ratingData: any = {
				ratedStaffId: selectedStaff.id,
				ratedStaffName: selectedStaff.userName,
				ratedStaffEmail: selectedStaff.userEmail?.toLowerCase() || '',
				raterId: user.uid || '',
				raterName: user.displayName || user.email,
				raterEmail: user.email.toLowerCase(),
				rating,
				criteria: RATING_SCHEMA[rating],
				status: 'Pending' as const,
				createdAt: serverTimestamp(),
			};

			// Only include comments field if there's a value (Firestore doesn't allow undefined)
			if (trimmedComments) {
				ratingData.comments = trimmedComments;
			}

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

	const handleRequestRating = async () => {
		if (!user?.email || !user?.displayName || !user?.uid) {
			setError('User information is missing. Please try again.');
			return;
		}

		setSubmittingRequest(true);
		setError(null);
		setSuccess(null);

		try {
			const trimmedMessage = requestMessage.trim();
			const requestData: any = {
				requestedById: user.uid,
				requestedByName: user.displayName || user.email,
				requestedByEmail: user.email.toLowerCase(),
				status: 'Pending' as const,
				createdAt: serverTimestamp(),
			};

			// Only include requestMessage field if there's a value (Firestore doesn't allow undefined)
			if (trimmedMessage) {
				requestData.requestMessage = trimmedMessage;
			}

			await addDoc(collection(db, 'ratingRequests'), requestData);

			setSuccess('Rating request submitted successfully! Super admins will review your request.');
			setRequestMessage('');
		} catch (err) {
			console.error('Failed to submit rating request', err);
			setError(`Failed to submit request: ${err instanceof Error ? err.message : 'Unknown error'}`);
		} finally {
			setSubmittingRequest(false);
		}
	};

	const handleProcessRequest = async (requestId: string) => {
		if (!user?.email || !canRate) return;

		try {
			const requestRef = doc(db, 'ratingRequests', requestId);
			await deleteDoc(requestRef);
			setSuccess('Rating request processed. You can now create a rating for this user.');
		} catch (err) {
			console.error('Failed to process rating request', err);
			setError(`Failed to process request: ${err instanceof Error ? err.message : 'Unknown error'}`);
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

	// View mode for clinical team members to see their own ratings
	if (!canRate) {
		return (
			<div className="min-h-svh bg-purple-50 px-6 py-10">
				<div className="mx-auto max-w-6xl space-y-8">
					<PageHeader title="My Performance Ratings" />

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

					{/* Request Stars Section */}
					<div className="rounded-2xl border border-sky-200 bg-white p-8 shadow-sm">
						<h2 className="mb-4 text-xl font-semibold text-slate-900">
							<i className="fas fa-star mr-2 text-yellow-400"></i>
							Request Performance Rating
						</h2>
						<p className="mb-4 text-sm text-slate-600">
							Request a performance rating from super admins (shajisp@css.com or dharanjaydubey@css.com). 
							They will review your request and provide feedback.
						</p>
						
						<div className="space-y-4">
							<div>
								<label className="mb-2 block text-sm font-medium text-slate-700">
									Message (Optional)
								</label>
								<textarea
									value={requestMessage}
									onChange={(e) => setRequestMessage(e.target.value)}
									rows={3}
									className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
									placeholder="Add any additional context for your rating request..."
								/>
							</div>
							
							<div className="flex justify-end">
								<button
									onClick={handleRequestRating}
									disabled={submittingRequest}
									className="rounded-lg bg-sky-600 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
								>
									{submittingRequest ? (
										<>
											<i className="fas fa-spinner fa-spin mr-2"></i>
											Submitting...
										</>
									) : (
										<>
											<i className="fas fa-paper-plane mr-2"></i>
											Submit Request
										</>
									)}
								</button>
							</div>
						</div>
					</div>

					{/* My Rating Requests */}
					{myRatingRequests.length > 0 && (
						<div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
							<h2 className="mb-6 text-xl font-semibold text-slate-900">My Rating Requests</h2>
							<div className="space-y-4">
								{myRatingRequests.map((request) => (
									<div
										key={request.id}
										className={`rounded-lg border-2 p-4 ${
											request.status === 'Pending'
												? 'border-amber-200 bg-amber-50'
												: 'border-green-200 bg-green-50'
										}`}
									>
										<div className="flex items-start justify-between">
											<div className="flex-1">
												<div className="mb-2 flex items-center gap-3">
													<span
														className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
															request.status === 'Pending'
																? 'bg-amber-100 text-amber-800'
																: 'bg-green-100 text-green-800'
														}`}
													>
														{request.status}
													</span>
												</div>
												{request.requestMessage && (
													<p className="mb-2 text-sm text-slate-700">
														<strong>Message:</strong> {request.requestMessage}
													</p>
												)}
												<p className="text-xs text-slate-500">
													Requested on:{' '}
													{request.createdAt?.toDate?.().toLocaleString() ||
														(request.createdAt ? new Date(request.createdAt as any).toLocaleString() : 'N/A')}
												</p>
											</div>
										</div>
									</div>
								))}
							</div>
						</div>
					)}

					{loading ? (
						<div className="flex items-center justify-center py-20">
							<div className="text-center">
								<div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-purple-600 border-r-transparent"></div>
								<p className="text-sm text-slate-600">Loading your ratings...</p>
							</div>
						</div>
					) : myRatings.length === 0 ? (
						<div className="rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-sm">
							<div className="mb-4 inline-block rounded-full bg-slate-100 p-6">
								<i className="fas fa-star text-4xl text-slate-400"></i>
							</div>
							<h3 className="mb-2 text-xl font-semibold text-slate-900">No Ratings Yet</h3>
							<p className="text-sm text-slate-600">
								You haven't received any approved performance ratings yet. Keep up the great work!
							</p>
						</div>
					) : (
						<>
							{/* Statistics Card with Animation */}
							<div className="relative overflow-hidden rounded-2xl border border-purple-200 bg-gradient-to-br from-purple-50 to-indigo-50 p-8 shadow-lg">
								{/* Animated background stars */}
								<div className="absolute inset-0 overflow-hidden">
									{[...Array(20)].map((_, i) => (
										<div
											key={i}
											className="absolute animate-pulse"
											style={{
												left: `${Math.random() * 100}%`,
												top: `${Math.random() * 100}%`,
												animationDelay: `${Math.random() * 2}s`,
												animationDuration: `${2 + Math.random() * 2}s`,
											}}
										>
											<i className="fas fa-star text-yellow-300 opacity-30"></i>
										</div>
									))}
								</div>
								
								<div className="relative z-10">
									<div className="mb-6 text-center">
										<h2 className="mb-2 text-2xl font-bold text-slate-900">Your Performance Summary</h2>
										<p className="text-sm text-slate-600">Based on {ratingStats?.totalRatings} approved rating{ratingStats?.totalRatings !== 1 ? 's' : ''}</p>
									</div>

									<div className="grid grid-cols-1 gap-6 md:grid-cols-2">
										{/* Average Rating Card */}
										<div className="rounded-xl border border-purple-200 bg-white p-6 shadow-md">
											<div className="mb-4 text-center">
												<div className="mb-3 inline-block animate-bounce">
													<div className="text-5xl font-bold text-purple-600">
														{ratingStats?.averageRating.toFixed(1)}
													</div>
												</div>
												<p className="text-sm font-medium text-slate-700">Average Rating</p>
											</div>
											<div className="flex justify-center">
												{[1, 2, 3, 4, 5].map((star) => (
													<div
														key={star}
														className="transform transition-all duration-500 hover:scale-125"
														style={{
															animationDelay: `${star * 0.1}s`,
														}}
													>
														<i
															className={`fas fa-star text-2xl ${
																star <= Math.round(ratingStats?.averageRating || 0)
																	? 'text-yellow-400 animate-pulse'
																	: 'text-slate-300'
															}`}
															style={{
																animationDelay: `${star * 0.1}s`,
															}}
														></i>
													</div>
												))}
											</div>
										</div>

										{/* Total Ratings Card */}
										<div className="rounded-xl border border-indigo-200 bg-white p-6 shadow-md">
											<div className="mb-4 text-center">
												<div className="mb-3 inline-block animate-pulse">
													<i className="fas fa-trophy text-5xl text-indigo-500"></i>
												</div>
												<div className="text-4xl font-bold text-indigo-600">
													{ratingStats?.totalRatings}
												</div>
												<p className="text-sm font-medium text-slate-700">Total Ratings</p>
											</div>
										</div>
									</div>

									{/* Rating Distribution */}
									<div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-md">
										<h3 className="mb-4 text-lg font-semibold text-slate-900">Rating Distribution</h3>
										<div className="space-y-3">
											{[5, 4, 3, 2, 1].map((star) => {
												const count = ratingStats?.ratingDistribution[star as keyof typeof ratingStats.ratingDistribution] || 0;
												const percentage = ratingStats ? (count / ratingStats.totalRatings) * 100 : 0;
												return (
													<div key={star} className="flex items-center gap-4">
														<div className="flex w-24 items-center gap-2">
															<span className="text-sm font-medium text-slate-700">{star} Star{star > 1 ? 's' : ''}</span>
															<div className="flex">
																{[...Array(star)].map((_, i) => (
																	<i key={i} className="fas fa-star text-yellow-400 text-xs"></i>
																))}
															</div>
														</div>
														<div className="flex-1">
															<div className="h-4 overflow-hidden rounded-full bg-slate-200">
																<div
																	className="h-full rounded-full bg-gradient-to-r from-yellow-400 to-yellow-500 transition-all duration-1000 ease-out"
																	style={{ width: `${percentage}%` }}
																></div>
															</div>
														</div>
														<div className="w-12 text-right text-sm font-semibold text-slate-700">
															{count}
														</div>
													</div>
												);
											})}
										</div>
									</div>
								</div>
							</div>

							{/* Recent Ratings List */}
							<div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
								<h2 className="mb-6 text-xl font-semibold text-slate-900">Recent Ratings</h2>
								<div className="space-y-4">
									{myRatings.map((ratingRecord, index) => (
										<div
											key={ratingRecord.id}
											className="transform rounded-lg border-2 border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 p-6 shadow-md transition-all duration-500 hover:scale-[1.02] hover:shadow-lg"
											style={{
												animation: `fadeInUp 0.6s ease-out ${index * 0.1}s both`,
											}}
										>
											<div className="flex items-start justify-between">
												<div className="flex-1">
													<div className="mb-3 flex items-center gap-3">
														<div className="flex items-center gap-2">
															{[...Array(ratingRecord.rating)].map((_, i) => (
																<i
																	key={i}
																	className="fas fa-star text-yellow-400 animate-pulse"
																	style={{
																		animationDelay: `${i * 0.1}s`,
																	}}
																></i>
															))}
															{[...Array(5 - ratingRecord.rating)].map((_, i) => (
																<i key={i} className="far fa-star text-slate-300"></i>
															))}
														</div>
														<span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">
															Approved
														</span>
													</div>
													<h3 className="mb-2 text-lg font-semibold text-slate-900">
														{ratingRecord.criteria}
													</h3>
													{ratingRecord.comments && (
														<p className="mb-3 text-sm text-slate-700 italic">
															"{ratingRecord.comments}"
														</p>
													)}
													<div className="flex items-center gap-4 text-xs text-slate-500">
														<span>
															<i className="fas fa-user mr-1"></i>
															Rated by: {ratingRecord.raterName}
														</span>
														<span>
															<i className="fas fa-calendar mr-1"></i>
															{ratingRecord.createdAt?.toDate?.().toLocaleDateString() ||
																(ratingRecord.createdAt ? new Date(ratingRecord.createdAt as any).toLocaleDateString() : 'N/A')}
														</span>
													</div>
												</div>
											</div>
										</div>
									))}
								</div>
							</div>
						</>
					)}
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

				{/* Rating Requests Section for Super Admins */}
				{ratingRequests.length > 0 && (
					<div className="rounded-2xl border border-amber-200 bg-white p-8 shadow-sm">
						<h2 className="mb-6 text-xl font-semibold text-slate-900">
							<i className="fas fa-inbox mr-2 text-amber-500"></i>
							Pending Rating Requests ({ratingRequests.length})
						</h2>
						<p className="mb-4 text-sm text-slate-600">
							The following users have requested performance ratings. Process the request and create a rating for them.
						</p>
						<div className="space-y-4">
							{ratingRequests.map((request) => {
								// Find the staff member who made the request
								const requestingStaff = staff.find(
									(s) => s.userEmail?.toLowerCase() === request.requestedByEmail.toLowerCase()
								);
								
								return (
									<div
										key={request.id}
										className="rounded-lg border-2 border-amber-200 bg-amber-50 p-6"
									>
										<div className="flex items-start justify-between">
											<div className="flex-1">
												<div className="mb-3 flex items-center gap-3">
													<h3 className="text-lg font-semibold text-slate-900">
														{request.requestedByName}
													</h3>
													<span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
														Pending
													</span>
												</div>
												<div className="mb-2 text-sm text-slate-600">
													<i className="fas fa-envelope mr-2"></i>
													{request.requestedByEmail}
												</div>
												{requestingStaff && (
													<div className="mb-2 text-sm text-slate-600">
														<i className="fas fa-briefcase mr-2"></i>
														{requestingStaff.role}
													</div>
												)}
												{request.requestMessage && (
													<div className="mb-3 rounded-lg border border-amber-200 bg-white p-3">
														<p className="text-sm text-slate-700">
															<strong>Message:</strong> {request.requestMessage}
														</p>
													</div>
												)}
												<p className="text-xs text-slate-500">
													Requested on:{' '}
													{request.createdAt?.toDate?.().toLocaleString() ||
														(request.createdAt ? new Date(request.createdAt as any).toLocaleString() : 'N/A')}
												</p>
											</div>
											<div className="ml-4 flex flex-col gap-2">
												<button
													onClick={() => {
														if (requestingStaff) {
															setSelectedStaff(requestingStaff);
															handleProcessRequest(request.id);
															// Scroll to rating form
															window.scrollTo({ top: 0, behavior: 'smooth' });
														}
													}}
													className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
												>
													<i className="fas fa-star mr-2"></i>
													Create Rating
												</button>
												<button
													onClick={() => handleProcessRequest(request.id)}
													className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2"
												>
													<i className="fas fa-check mr-2"></i>
													Mark Processed
												</button>
											</div>
										</div>
									</div>
								);
							})}
						</div>
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
													(ratingRecord.createdAt ? new Date(ratingRecord.createdAt as any).toLocaleString() : 'N/A')}
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

