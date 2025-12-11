'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, addDoc, query, where, getDocs, serverTimestamp, type QuerySnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/PageHeader';

interface StaffMember {
	id: string;
	userName: string;
	role: string;
	status: string;
	userEmail?: string;
}

interface LeaveRequest {
	id?: string;
	userId: string;
	userEmail?: string;
	userName: string;
	userRole: string;
	leaveType: 'sick leave' | 'casual leave' | 'annual leave' | 'loss of pay';
	startDate: string;
	endDate: string;
	numberOfDays: number;
	reasons: string;
	handoverTo?: string;
	handoverToName?: string;
	approvalRequestedTo?: string;
	approvalRequestedToName?: string;
	status: 'pending' | 'approved' | 'disapproved';
	approvedBy?: string;
	approvedByName?: string;
	approvalMessage?: string;
	disapprovalMessage?: string;
	createdAt: any;
	updatedAt: any;
}

type LeaveType = 'sick leave' | 'casual leave' | 'annual leave' | 'loss of pay';

export default function LeaveManagement() {
	const { user } = useAuth();
	const [leaveType, setLeaveType] = useState<LeaveType>('casual leave');
	const [startDate, setStartDate] = useState('');
	const [endDate, setEndDate] = useState('');
	const [reasons, setReasons] = useState('');
	const [handoverTo, setHandoverTo] = useState('');
	const [approvalRequestedTo, setApprovalRequestedTo] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [staff, setStaff] = useState<StaffMember[]>([]);
	const [admins, setAdmins] = useState<StaffMember[]>([]);
	const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
	const [loading, setLoading] = useState(true);

	// Calculate number of days
	const numberOfDays = useMemo(() => {
		if (!startDate || !endDate) return 0;
		const start = new Date(startDate);
		const end = new Date(endDate);
		if (end < start) return 0;
		const diffTime = Math.abs(end.getTime() - start.getTime());
		const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end dates
		return diffDays;
	}, [startDate, endDate]);

	// Calculate total leave taken by type
	const totalLeaveTaken = useMemo(() => {
		const totals: Record<LeaveType, number> = {
			'sick leave': 0,
			'casual leave': 0,
			'annual leave': 0,
			'loss of pay': 0,
		};

		leaveRequests
			.filter(req => req.status === 'approved')
			.forEach(req => {
				totals[req.leaveType] = (totals[req.leaveType] || 0) + req.numberOfDays;
			});

		return totals;
	}, [leaveRequests]);

	// Load staff members based on user role
	useEffect(() => {
		if (!user) return;

		const unsubscribe = onSnapshot(
			collection(db, 'staff'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data() as Record<string, unknown>;
					return {
						id: docSnap.id,
						userName: data.userName ? String(data.userName) : '',
						role: data.role ? String(data.role) : '',
						status: data.status ? String(data.status) : '',
						userEmail: data.userEmail ? String(data.userEmail) : undefined,
					} as StaffMember;
				});

				// Filter admins and super admins
				const adminList = mapped.filter(
					s => s.status === 'Active' && (
						s.role === 'Admin' || 
						s.role === 'admin' || 
						s.role === 'SuperAdmin' || 
						s.role === 'Super Admin' ||
						s.role === 'superadmin'
					)
				);
				setAdmins(adminList);

				// Show all active staff members for handover (excluding current user, admins, and super admins)
				const allStaff = mapped.filter(
					s =>
						s.status === 'Active' &&
						s.userEmail !== user.email &&
						s.role !== 'Admin' &&
						s.role !== 'admin' &&
						s.role !== 'SuperAdmin' &&
						s.role !== 'Super Admin' &&
						s.role !== 'superadmin'
				);
				setStaff(allStaff);

				setLoading(false);
			},
			error => {
				console.error('Failed to load staff', error);
				setStaff([]);
				setAdmins([]);
				setLoading(false);
			}
		);

		return () => unsubscribe();
	}, [user]);

	// Load leave requests for current user
	useEffect(() => {
		if (!user) return;

		const unsubscribe = onSnapshot(
			collection(db, 'leaveRequests'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs
					.map(docSnap => {
						const data = docSnap.data() as Record<string, unknown>;
						return {
							id: docSnap.id,
							userId: data.userId ? String(data.userId) : '',
							userEmail: data.userEmail ? String(data.userEmail) : '',
							userName: data.userName ? String(data.userName) : '',
							userRole: data.userRole ? String(data.userRole) : '',
							leaveType: (data.leaveType as LeaveType) || 'casual leave',
							startDate: data.startDate ? String(data.startDate) : '',
							endDate: data.endDate ? String(data.endDate) : '',
							numberOfDays: typeof data.numberOfDays === 'number' ? data.numberOfDays : 0,
							reasons: data.reasons ? String(data.reasons) : '',
							handoverTo: data.handoverTo ? String(data.handoverTo) : undefined,
							handoverToName: data.handoverToName ? String(data.handoverToName) : undefined,
							approvalRequestedTo: data.approvalRequestedTo ? String(data.approvalRequestedTo) : undefined,
							approvalRequestedToName: data.approvalRequestedToName ? String(data.approvalRequestedToName) : undefined,
							status: (data.status as 'pending' | 'approved' | 'disapproved') || 'pending',
							approvedBy: data.approvedBy ? String(data.approvedBy) : undefined,
							approvedByName: data.approvedByName ? String(data.approvedByName) : undefined,
							approvalMessage: data.approvalMessage ? String(data.approvalMessage) : undefined,
							disapprovalMessage: data.disapprovalMessage ? String(data.disapprovalMessage) : undefined,
							createdAt: data.createdAt,
							updatedAt: data.updatedAt,
						} as LeaveRequest;
					})
					.filter(req => {
						// Match by userId or userEmail
						return req.userId === user.uid || (user.email && req.userEmail === user.email);
					})
					.sort((a, b) => {
						const aDate = a.createdAt?.toDate?.() || new Date(0);
						const bDate = b.createdAt?.toDate?.() || new Date(0);
						return bDate.getTime() - aDate.getTime();
					});

				setLeaveRequests(mapped);
			},
			error => {
				console.error('Failed to load leave requests', error);
				setLeaveRequests([]);
			}
		);

		return () => unsubscribe();
	}, [user]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!user) {
			alert('User not authenticated');
			return;
		}

		if (!startDate || !endDate) {
			alert('Please select both start and end dates');
			return;
		}

		if (new Date(endDate) < new Date(startDate)) {
			alert('End date must be after start date');
			return;
		}

		if (!reasons.trim()) {
			alert('Please provide a reason for leave');
			return;
		}

		if (!approvalRequestedTo) {
			alert('Please select an admin for approval');
			return;
		}

		setSubmitting(true);
		try {
			const selectedAdmin = admins.find(a => a.id === approvalRequestedTo);
			const selectedHandover = handoverTo ? staff.find(s => s.id === handoverTo) : null;

			if (!selectedAdmin) {
				alert('Selected admin not found');
				setSubmitting(false);
				return;
			}

			// Get admin's user ID from users collection
			let adminUserId: string | null = null;
			if (selectedAdmin.userEmail) {
				try {
					const usersQuery = query(collection(db, 'users'), where('email', '==', selectedAdmin.userEmail.toLowerCase()));
					const usersSnapshot = await getDocs(usersQuery);
					if (!usersSnapshot.empty) {
						adminUserId = usersSnapshot.docs[0].id;
					}
				} catch (error) {
					console.error('Failed to get admin user ID:', error);
				}
			}

			// Create leave request
			const leaveRequestRef = await addDoc(collection(db, 'leaveRequests'), {
				userId: user.uid,
				userEmail: user.email,
				userName: user.displayName || user.email?.split('@')[0] || 'User',
				userRole: user.role || '',
				leaveType,
				startDate,
				endDate,
				numberOfDays,
				reasons: reasons.trim(),
				handoverTo: handoverTo || null,
				handoverToName: selectedHandover?.userName || null,
				approvalRequestedTo,
				approvalRequestedToName: selectedAdmin.userName,
				approvalRequestedToEmail: selectedAdmin.userEmail || null,
				status: 'pending',
				createdAt: serverTimestamp(),
				updatedAt: serverTimestamp(),
			});

			// Create notification for the selected admin only
			if (adminUserId) {
				try {
					await addDoc(collection(db, 'notifications'), {
						userId: adminUserId,
						title: 'Leave Request Pending Approval',
						message: `${user.displayName || user.email?.split('@')[0] || 'A user'} (${user.role || 'Employee'}) has requested ${leaveType} from ${formatDate(startDate)} to ${formatDate(endDate)} (${numberOfDays} days). Please review and approve/disapprove.`,
						category: 'leave_request',
						status: 'unread',
						leaveRequestId: leaveRequestRef.id,
						leaveRequestUserId: user.uid,
						leaveRequestUserName: user.displayName || user.email?.split('@')[0] || 'User',
						leaveRequestUserRole: user.role || '',
						leaveType,
						startDate,
						endDate,
						numberOfDays,
						reasons: reasons.trim(),
						createdAt: serverTimestamp(),
					});
				} catch (notifError) {
					console.error('Failed to create notification:', notifError);
					// Continue even if notification fails
				}
			}

			// Reset form
			setLeaveType('casual leave');
			setStartDate('');
			setEndDate('');
			setReasons('');
			setHandoverTo('');
			setApprovalRequestedTo('');

			alert('Leave request submitted successfully! The selected admin has been notified.');
		} catch (error) {
			console.error('Failed to submit leave request', error);
			alert(`Failed to submit leave request: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setSubmitting(false);
		}
	};

	const formatDate = (dateString: string) => {
		if (!dateString) return '';
		const date = new Date(dateString);
		return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
	};

	const getStatusBadge = (status: string) => {
		switch (status) {
			case 'approved':
				return 'bg-green-100 text-green-800 border-green-200';
			case 'disapproved':
				return 'bg-red-100 text-red-800 border-red-200';
			default:
				return 'bg-yellow-100 text-yellow-800 border-yellow-200';
		}
	};

	return (
		<div className="min-h-svh bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 px-6 py-10">
			<div className="mx-auto max-w-6xl space-y-6">
				<PageHeader title="Leave Management" />

				{/* Total Leave Taken Summary */}
				<section className="rounded-2xl bg-white p-6 shadow-lg border border-slate-200">
					<h2 className="text-lg font-semibold text-slate-900 mb-4">Total Leave Taken</h2>
					<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
						<div className="rounded-lg bg-blue-50 p-4 border border-blue-200">
							<p className="text-xs text-blue-600 font-medium mb-1">Sick Leave</p>
							<p className="text-2xl font-bold text-blue-900">{totalLeaveTaken['sick leave']} days</p>
						</div>
						<div className="rounded-lg bg-purple-50 p-4 border border-purple-200">
							<p className="text-xs text-purple-600 font-medium mb-1">Casual Leave</p>
							<p className="text-2xl font-bold text-purple-900">{totalLeaveTaken['casual leave']} days</p>
						</div>
						<div className="rounded-lg bg-green-50 p-4 border border-green-200">
							<p className="text-xs text-green-600 font-medium mb-1">Annual Leave</p>
							<p className="text-2xl font-bold text-green-900">{totalLeaveTaken['annual leave']} days</p>
						</div>
						<div className="rounded-lg bg-orange-50 p-4 border border-orange-200">
							<p className="text-xs text-orange-600 font-medium mb-1">Loss of Pay</p>
							<p className="text-2xl font-bold text-orange-900">{totalLeaveTaken['loss of pay']} days</p>
						</div>
					</div>
				</section>

				{/* Leave Request Form */}
				<section className="rounded-2xl bg-white p-6 shadow-lg border border-slate-200">
					<h2 className="text-lg font-semibold text-slate-900 mb-4">Apply for Leave</h2>
					<form onSubmit={handleSubmit} className="space-y-4">
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							{/* Leave Type */}
							<div>
								<label htmlFor="leaveType" className="block text-sm font-medium text-slate-700 mb-2">
									Leave Type <span className="text-red-500">*</span>
								</label>
								<select
									id="leaveType"
									value={leaveType}
									onChange={e => setLeaveType(e.target.value as LeaveType)}
									className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
									required
								>
									<option value="sick leave">Sick Leave</option>
									<option value="casual leave">Casual Leave</option>
									<option value="annual leave">Annual Leave</option>
									<option value="loss of pay">Loss of Pay</option>
								</select>
							</div>

							{/* Number of Days (Auto-calculated) */}
							<div>
								<label className="block text-sm font-medium text-slate-700 mb-2">Number of Days</label>
								<div className="w-full rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-900">
									{numberOfDays} {numberOfDays === 1 ? 'day' : 'days'}
								</div>
							</div>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							{/* Start Date */}
							<div>
								<label htmlFor="startDate" className="block text-sm font-medium text-slate-700 mb-2">
									Start Date <span className="text-red-500">*</span>
								</label>
								<input
									type="date"
									id="startDate"
									value={startDate}
									onChange={e => setStartDate(e.target.value)}
									min={new Date().toISOString().split('T')[0]}
									className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
									required
								/>
							</div>

							{/* End Date */}
							<div>
								<label htmlFor="endDate" className="block text-sm font-medium text-slate-700 mb-2">
									End Date <span className="text-red-500">*</span>
								</label>
								<input
									type="date"
									id="endDate"
									value={endDate}
									onChange={e => setEndDate(e.target.value)}
									min={startDate || new Date().toISOString().split('T')[0]}
									className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
									required
								/>
							</div>
						</div>

						{/* Reasons */}
						<div>
							<label htmlFor="reasons" className="block text-sm font-medium text-slate-700 mb-2">
								Reasons <span className="text-red-500">*</span>
							</label>
							<textarea
								id="reasons"
								value={reasons}
								onChange={e => setReasons(e.target.value)}
								rows={4}
								className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
								placeholder="Please provide a detailed reason for your leave request..."
								required
							/>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							{/* Handover Duties To */}
							<div>
								<label htmlFor="handoverTo" className="block text-sm font-medium text-slate-700 mb-2">
									Handover Duties To (Optional)
								</label>
								<select
									id="handoverTo"
									value={handoverTo}
									onChange={e => setHandoverTo(e.target.value)}
									className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
								>
									<option value="">Select a person...</option>
									{staff.map(member => (
										<option key={member.id} value={member.id}>
											{member.userName}
										</option>
									))}
								</select>
								{staff.length === 0 && (
									<p className="mt-1 text-xs text-slate-500">No team members available for handover</p>
								)}
							</div>

							{/* Approval Requested To */}
							<div>
								<label htmlFor="approvalRequestedTo" className="block text-sm font-medium text-slate-700 mb-2">
									Request Approval From <span className="text-red-500">*</span>
								</label>
								<select
									id="approvalRequestedTo"
									value={approvalRequestedTo}
									onChange={e => setApprovalRequestedTo(e.target.value)}
									className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
									required
								>
									<option value="">Select an admin...</option>
									{admins.map(admin => (
										<option key={admin.id} value={admin.id}>
											{admin.userName}
										</option>
									))}
								</select>
								{admins.length === 0 && (
									<p className="mt-1 text-xs text-slate-500">No admins available</p>
								)}
							</div>
						</div>

						{/* Submit Button */}
						<div className="flex justify-end pt-4">
							<button
								type="submit"
								disabled={submitting || numberOfDays === 0}
								className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md hover:from-blue-700 hover:via-blue-800 hover:to-indigo-700 transition-all duration-200 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
							>
								{submitting ? (
									<>
										<div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
										Submitting...
									</>
								) : (
									<>
										<i className="fas fa-paper-plane text-xs" aria-hidden="true" />
										Submit Leave Request
									</>
								)}
							</button>
						</div>
					</form>
				</section>

				{/* Pending Leave Requests */}
				<section className="rounded-2xl bg-white p-6 shadow-lg border border-slate-200">
					<h2 className="text-lg font-semibold text-slate-900 mb-4">Pending Leave Requests</h2>
					{loading ? (
						<div className="text-center py-8 text-slate-500">Loading leave requests...</div>
					) : leaveRequests.filter(req => req.status === 'pending').length === 0 ? (
						<div className="text-center py-8 text-slate-500">No pending leave requests</div>
					) : (
						<div className="space-y-4">
							{leaveRequests.filter(req => req.status === 'pending').map(request => (
								<div
									key={request.id}
									className="rounded-lg border-2 p-4 transition-all hover:shadow-md"
									style={{
										borderColor:
											request.status === 'approved'
												? '#10b981'
												: request.status === 'disapproved'
													? '#ef4444'
													: '#eab308',
									}}
								>
									<div className="flex items-start justify-between mb-3">
										<div className="flex-1">
											<div className="flex items-center gap-3 mb-2">
												<h3 className="text-base font-semibold text-slate-900 capitalize">
													{request.leaveType}
												</h3>
												<span
													className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${getStatusBadge(request.status)}`}
												>
													{request.status.charAt(0).toUpperCase() + request.status.slice(1)}
												</span>
											</div>
											<div className="text-sm text-slate-600 space-y-1">
												<p>
													<span className="font-medium">Period:</span> {formatDate(request.startDate)} -{' '}
													{formatDate(request.endDate)} ({request.numberOfDays} days)
												</p>
												{request.handoverToName && (
													<p>
														<span className="font-medium">Handover to:</span> {request.handoverToName}
													</p>
												)}
												<p>
													<span className="font-medium">Requested approval from:</span>{' '}
													{request.approvalRequestedToName}
												</p>
											</div>
										</div>
									</div>

									{request.reasons && (
										<div className="mb-3">
											<p className="text-xs font-medium text-slate-500 mb-1">Reasons:</p>
											<p className="text-sm text-slate-700 bg-slate-50 rounded p-2">{request.reasons}</p>
										</div>
									)}

									{request.status === 'approved' && request.approvedByName && (
										<div className="mt-3 rounded-lg bg-green-50 border border-green-200 p-3">
											<p className="text-xs font-medium text-green-700 mb-1">
												✓ Approved by {request.approvedByName}
											</p>
											{request.approvalMessage && (
												<p className="text-sm text-green-800">{request.approvalMessage}</p>
											)}
										</div>
									)}

									{request.status === 'disapproved' && request.approvedByName && (
										<div className="mt-3 rounded-lg bg-red-50 border border-red-200 p-3">
											<p className="text-xs font-medium text-red-700 mb-1">
												✗ Disapproved by {request.approvedByName}
											</p>
											{request.disapprovalMessage && (
												<p className="text-sm text-red-800">{request.disapprovalMessage}</p>
											)}
										</div>
									)}

									{request.createdAt && (
										<p className="text-xs text-slate-400 mt-2">
											Submitted: {formatDate(request.createdAt?.toDate?.()?.toISOString() || '')}
										</p>
									)}
								</div>
							))}
						</div>
					)}
				</section>

				{/* History of Leave */}
				<section className="rounded-2xl bg-white p-6 shadow-lg border border-slate-200">
					<h2 className="text-lg font-semibold text-slate-900 mb-4">History of Leave</h2>
					{loading ? (
						<div className="text-center py-8 text-slate-500">Loading leave history...</div>
					) : leaveRequests.filter(req => req.status !== 'pending').length === 0 ? (
						<div className="text-center py-8 text-slate-500">No leave history found</div>
					) : (
						<div className="space-y-4">
							{leaveRequests
								.filter(req => req.status !== 'pending')
								.map(request => {
									const isPast = request.endDate && new Date(request.endDate) < new Date();
									return (
										<div
											key={request.id}
											className={`rounded-lg border-2 p-4 transition-all hover:shadow-md ${
												isPast ? 'bg-slate-50' : ''
											}`}
											style={{
												borderColor:
													request.status === 'approved'
														? '#10b981'
														: request.status === 'disapproved'
															? '#ef4444'
															: '#eab308',
											}}
										>
											<div className="flex items-start justify-between mb-3">
												<div className="flex-1">
													<div className="flex items-center gap-3 mb-2">
														<h3 className="text-base font-semibold text-slate-900 capitalize">
															{request.leaveType}
														</h3>
														<span
															className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${getStatusBadge(request.status)}`}
														>
															{request.status.charAt(0).toUpperCase() + request.status.slice(1)}
														</span>
														{isPast && (
															<span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-200 text-slate-700">
																Past Leave
															</span>
														)}
													</div>
													<div className="text-sm text-slate-600 space-y-1">
														<p>
															<span className="font-medium">Period:</span> {formatDate(request.startDate)} -{' '}
															{formatDate(request.endDate)} ({request.numberOfDays} days)
														</p>
														{request.handoverToName && (
															<p>
																<span className="font-medium">Handover to:</span> {request.handoverToName}
															</p>
														)}
														<p>
															<span className="font-medium">Requested approval from:</span>{' '}
															{request.approvalRequestedToName}
														</p>
													</div>
												</div>
											</div>

											{request.reasons && (
												<div className="mb-3">
													<p className="text-xs font-medium text-slate-500 mb-1">Reasons:</p>
													<p className="text-sm text-slate-700 bg-slate-50 rounded p-2">{request.reasons}</p>
												</div>
											)}

											{request.status === 'approved' && request.approvedByName && (
												<div className="mt-3 rounded-lg bg-green-50 border border-green-200 p-3">
													<p className="text-xs font-medium text-green-700 mb-1">
														✓ Approved by {request.approvedByName}
													</p>
													{request.approvalMessage && (
														<p className="text-sm text-green-800">{request.approvalMessage}</p>
													)}
												</div>
											)}

											{request.status === 'disapproved' && request.approvedByName && (
												<div className="mt-3 rounded-lg bg-red-50 border border-red-200 p-3">
													<p className="text-xs font-medium text-red-700 mb-1">
														✗ Disapproved by {request.approvedByName}
													</p>
													{request.disapprovalMessage && (
														<p className="text-sm text-red-800">{request.disapprovalMessage}</p>
													)}
												</div>
											)}

											{request.createdAt && (
												<p className="text-xs text-slate-400 mt-2">
													Submitted: {formatDate(request.createdAt?.toDate?.()?.toISOString() || '')}
												</p>
											)}
										</div>
									);
								})}
						</div>
					)}
				</section>
			</div>
		</div>
	);
}
