'use client';

import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, updateDoc, doc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/PageHeader';

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

const SUPER_ADMIN_EMAIL = 'antonychacko@css.com';

export default function RatingApprovals() {
	const { user } = useAuth();
	const [pendingRatings, setPendingRatings] = useState<StaffRating[]>([]);
	const [loading, setLoading] = useState(true);
	const [processing, setProcessing] = useState<string | null>(null);
	const [rejectionReason, setRejectionReason] = useState<{ [key: string]: string }>({});
	const [showRejectModal, setShowRejectModal] = useState<string | null>(null);

	// Check if user is Super Admin
	const isSuperAdmin = user?.email?.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();

	// Load pending ratings
	useEffect(() => {
		if (!isSuperAdmin) {
			setLoading(false);
			return;
		}

		const unsubscribe = onSnapshot(
			query(collection(db, 'staffRatings'), where('status', '==', 'Pending')),
			(snapshot) => {
				const mapped = snapshot.docs.map((docSnap) => ({
					id: docSnap.id,
					...docSnap.data(),
				})) as StaffRating[];
				setPendingRatings([...mapped.sort((a, b) => {
					const aTime = a.createdAt?.toMillis?.() || 0;
					const bTime = b.createdAt?.toMillis?.() || 0;
					return bTime - aTime;
				})]);
				setLoading(false);
			},
			(error) => {
				console.error('Failed to load pending ratings', error);
				setLoading(false);
			}
		);

		return () => unsubscribe();
	}, [isSuperAdmin]);

	const handleApprove = async (ratingId: string) => {
		if (!user?.email || !user?.displayName) return;

		setProcessing(ratingId);
		try {
			const ratingRef = doc(db, 'staffRatings', ratingId);
			await updateDoc(ratingRef, {
				status: 'Approved',
				approvedBy: user.email,
				approvedAt: serverTimestamp(),
				updatedAt: serverTimestamp(),
			});
		} catch (error) {
			console.error('Failed to approve rating', error);
			alert(`Failed to approve rating: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setProcessing(null);
		}
	};

	const handleReject = async (ratingId: string) => {
		if (!user?.email || !user?.displayName) return;
		const reason = rejectionReason[ratingId]?.trim();

		if (!reason) {
			alert('Please provide a reason for rejection');
			return;
		}

		setProcessing(ratingId);
		try {
			const ratingRef = doc(db, 'staffRatings', ratingId);
			await updateDoc(ratingRef, {
				status: 'Rejected',
				rejectedBy: user.email,
				rejectedAt: serverTimestamp(),
				rejectionReason: reason,
				updatedAt: serverTimestamp(),
			});
			setShowRejectModal(null);
			setRejectionReason((prev) => {
				const updated = { ...prev };
				delete updated[ratingId];
				return updated;
			});
		} catch (error) {
			console.error('Failed to reject rating', error);
			alert(`Failed to reject rating: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setProcessing(null);
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

	if (!isSuperAdmin) {
		return (
			<div className="min-h-svh bg-purple-50 px-6 py-10">
				<div className="mx-auto max-w-6xl">
					<PageHeader title="Rating Approvals" />
					<div className="mt-8 rounded-xl border border-red-200 bg-red-50 p-6 text-center">
						<i className="fas fa-lock mb-4 text-4xl text-red-600"></i>
						<h3 className="mb-2 text-lg font-semibold text-red-900">Access Denied</h3>
						<p className="text-sm text-red-700">
							Only the Super Admin can access this page. You do not have permission to view rating approvals.
						</p>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-svh bg-purple-50 px-6 py-10">
			<div className="mx-auto max-w-6xl space-y-8">
				<PageHeader title="Performance Rating Approvals" />

				{/* Statistics */}
				<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
					<div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-sm font-medium text-amber-700">Pending Approvals</p>
								<p className="mt-2 text-3xl font-bold text-amber-900">{pendingRatings.length}</p>
							</div>
							<i className="fas fa-clock text-4xl text-amber-400"></i>
						</div>
					</div>
				</div>

				{/* Pending Ratings List */}
				{pendingRatings.length === 0 ? (
					<div className="rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-sm">
						<i className="fas fa-check-circle mb-4 text-5xl text-green-400"></i>
						<h3 className="mb-2 text-lg font-semibold text-slate-900">All Caught Up!</h3>
						<p className="text-sm text-slate-600">There are no pending ratings to review at this time.</p>
					</div>
				) : (
					<div className="space-y-4">
						{pendingRatings.map((rating) => (
							<div key={rating.id} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
								<div className="mb-4 flex items-start justify-between">
									<div className="flex-1">
										<div className="mb-2 flex items-center gap-3">
											<h3 className="text-lg font-semibold text-slate-900">{rating.ratedStaffName}</h3>
											{rating.ratedStaffEmail && (
												<span className="text-sm text-slate-500">({rating.ratedStaffEmail})</span>
											)}
										</div>
										<div className="mb-2 flex items-center gap-2">
											<span className="text-sm font-medium text-slate-600">Rated by:</span>
											<span className="text-sm text-slate-900">{rating.raterName}</span>
											{rating.raterEmail && <span className="text-sm text-slate-500">({rating.raterEmail})</span>}
										</div>
										<div className="mb-3 flex items-center">
											{[...Array(rating.rating)].map((_, i) => (
												<i key={i} className="fas fa-star text-yellow-400"></i>
											))}
											{[...Array(5 - rating.rating)].map((_, i) => (
												<i key={i} className="far fa-star text-slate-300"></i>
											))}
											<span className="ml-3 text-sm font-medium text-slate-900">
												{rating.rating} Star{rating.rating > 1 ? 's' : ''}
											</span>
										</div>
										<div className="mb-2 rounded-lg bg-slate-50 p-3">
											<p className="text-sm text-slate-600">
												<strong>Criteria:</strong> {rating.criteria}
											</p>
										</div>
										{rating.comments && (
											<div className="mb-2 rounded-lg bg-slate-50 p-3">
												<p className="text-sm text-slate-600">
													<strong>Comments:</strong> {rating.comments}
												</p>
											</div>
										)}
										<p className="text-xs text-slate-500">
											Submitted on:{' '}
											{rating.createdAt?.toDate?.().toLocaleString() ||
												new Date(rating.createdAt as any).toLocaleString()}
										</p>
									</div>
								</div>

								{/* Action Buttons */}
								<div className="flex items-center gap-3 border-t border-slate-200 pt-4">
									<button
										onClick={() => handleApprove(rating.id)}
										disabled={processing === rating.id}
										className="flex-1 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
									>
										{processing === rating.id ? (
											<>
												<i className="fas fa-spinner fa-spin mr-2"></i>
												Processing...
											</>
										) : (
											<>
												<i className="fas fa-check mr-2"></i>
												Approve
											</>
										)}
									</button>
									<button
										onClick={() => setShowRejectModal(rating.id)}
										disabled={processing === rating.id}
										className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
									>
										<i className="fas fa-times mr-2"></i>
										Reject
									</button>
								</div>

								{/* Rejection Modal */}
								{showRejectModal === rating.id && (
									<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4">
										<div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
											<h3 className="mb-4 text-lg font-semibold text-slate-900">Reject Rating</h3>
											<p className="mb-4 text-sm text-slate-600">
												Please provide a reason for rejecting this rating. This will be visible to the rater.
											</p>
											<textarea
												value={rejectionReason[rating.id] || ''}
												onChange={(e) =>
													setRejectionReason((prev) => ({
														...prev,
														[rating.id]: e.target.value,
													}))
												}
												rows={4}
												className="mb-4 w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-200"
												placeholder="Enter rejection reason..."
											/>
											<div className="flex items-center gap-3">
												<button
													onClick={() => {
														setShowRejectModal(null);
														setRejectionReason((prev) => {
															const updated = { ...prev };
															delete updated[rating.id];
															return updated;
														});
													}}
													className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
												>
													Cancel
												</button>
												<button
													onClick={() => handleReject(rating.id)}
													disabled={!rejectionReason[rating.id]?.trim() || processing === rating.id}
													className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
												>
													{processing === rating.id ? (
														<>
															<i className="fas fa-spinner fa-spin mr-2"></i>
															Processing...
														</>
													) : (
														<>
															<i className="fas fa-times mr-2"></i>
															Confirm Reject
														</>
													)}
												</button>
											</div>
										</div>
									</div>
								)}
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

