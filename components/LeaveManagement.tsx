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
	leaveType: 'sick leave' | 'earned leave' | 'unpaid leave';
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

type LeaveType = 'sick leave' | 'earned leave' | 'unpaid leave';

export default function LeaveManagement() {
	const { user } = useAuth();
	const [leaveType, setLeaveType] = useState<LeaveType>('earned leave');
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
	const [validationMessage, setValidationMessage] = useState<{ type: 'error' | 'warning' | 'success' | 'info'; message: string } | null>(null);

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
			'earned leave': 0,
			'unpaid leave': 0,
		};

		leaveRequests
			.filter(req => req.status === 'approved')
			.forEach(req => {
				// Map old leave types to new ones for backward compatibility
				// Handle both new and old leave types from Firestore
				const leaveTypeStr = req.leaveType as string;
				const mappedType: LeaveType = 
					leaveTypeStr === 'casual leave' || leaveTypeStr === 'annual leave' 
						? 'earned leave' 
						: leaveTypeStr === 'loss of pay' 
							? 'unpaid leave' 
							: (leaveTypeStr === 'sick leave' || leaveTypeStr === 'earned leave' || leaveTypeStr === 'unpaid leave')
								? leaveTypeStr as LeaveType
								: 'earned leave'; // Default fallback
				if (totals.hasOwnProperty(mappedType)) {
					totals[mappedType] = (totals[mappedType] || 0) + req.numberOfDays;
				}
			});

		return totals;
	}, [leaveRequests]);

	// Leave Policy Validation Rules
	// Based on CSSB Consultant Leave Policy (CSSB_Consultant_Leave_Policy.pdf)
	// Policy Details:
	// - Earned Leave (EL): 15 days per calendar year, 15 days advance notice required
	// - Sick Leave (SL): 6 days per calendar year, medical certificate mandatory for ALL sick leave
	// - Unpaid Leave (UPL): No limit, but requires proper documentation
	const validateLeaveRequest = (
		leaveType: LeaveType,
		startDate: string,
		endDate: string,
		numberOfDays: number,
		reasons: string,
		totalLeaveTaken: Record<LeaveType, number>
	): { isValid: boolean; errorMessage: string } => {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const start = new Date(startDate);
		start.setHours(0, 0, 0, 0);
		const end = new Date(endDate);
		end.setHours(0, 0, 0, 0);

		// Calculate days in advance
		const daysInAdvance = Math.ceil((start.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

		// Validation rules based on leave type
		switch (leaveType) {
			case 'sick leave':
				// Sick leave: Cannot apply for past dates
				if (daysInAdvance < 0) {
					return { isValid: false, errorMessage: 'Sick leave cannot be applied for past dates.' };
				}
				// Maximum 6 days per year for sick leave (as per CSSB policy)
				if (totalLeaveTaken['sick leave'] + numberOfDays > 6) {
					const remaining = 6 - totalLeaveTaken['sick leave'];
					return {
						isValid: false,
						errorMessage: `Sick leave limit exceeded. You have ${remaining} days remaining. Maximum 6 days per calendar year allowed as per CSSB policy.`,
					};
				}
				// Medical certificate is MANDATORY for ALL sick leave (as per CSSB policy)
				const hasMedicalCert = reasons.toLowerCase().includes('medical certificate') || 
				                      reasons.toLowerCase().includes('doctor') ||
				                      reasons.toLowerCase().includes('certificate');
				if (!hasMedicalCert) {
					return {
						isValid: false,
						errorMessage: 'A doctor\'s medical certificate is MANDATORY for all Sick Leave as per CSSB policy. Please mention the medical certificate in your reasons. Without a certificate, the leave will be treated as Unpaid Leave.',
					};
				}
				break;

			case 'earned leave':
				// Earned Leave: Minimum 15 days advance notice (as per CSSB policy)
				if (daysInAdvance < 15) {
					return {
						isValid: false,
						errorMessage: 'Earned Leave requires minimum 15 days advance notice as per CSSB policy. Please select a start date at least 15 days from today. If 15-day notice is not given, the leave will be treated as Unpaid Leave.',
					};
				}
				// Maximum 15 days per year for earned leave (as per CSSB policy)
				if (totalLeaveTaken['earned leave'] + numberOfDays > 15) {
					const remaining = 15 - totalLeaveTaken['earned leave'];
					return {
						isValid: false,
						errorMessage: `Earned Leave limit exceeded. You have ${remaining} days remaining. Maximum 15 days per calendar year allowed as per CSSB policy.`,
					};
				}
				break;

			case 'unpaid leave':
				// Unpaid Leave: Requires detailed reason
				if (reasons.trim().length < 50) {
					return {
						isValid: false,
						errorMessage: 'Unpaid Leave requires a detailed reason (minimum 50 characters). Please provide more details about why you need unpaid leave.',
					};
				}
				// Note: Unpaid leave has no limit but will result in deduction from monthly payout
				break;
		}

		// Common validations for all leave types
		// Check for overlapping leave requests
		const hasOverlap = leaveRequests.some(req => {
			if (req.status !== 'pending' && req.status !== 'approved') return false;
			const reqStart = new Date(req.startDate);
			const reqEnd = new Date(req.endDate);
			return (
				(start >= reqStart && start <= reqEnd) ||
				(end >= reqStart && end <= reqEnd) ||
				(start <= reqStart && end >= reqEnd)
			);
		});

		if (hasOverlap) {
			return {
				isValid: false,
				errorMessage: 'You have an overlapping leave request (pending or approved). Please check your existing leave requests.',
			};
		}

		return { isValid: true, errorMessage: '' };
	};

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

				// Filter admins and super admins, then filter to only show specific names
				const adminList = mapped.filter(
					s => s.status === 'Active' && (
						s.role === 'Admin' || 
						s.role === 'admin' || 
						s.role === 'SuperAdmin' || 
						s.role === 'Super Admin' ||
						s.role === 'superadmin'
					)
				);
				
				// Filter to only show: Shaji SP, Nawaz Aman, and Dr dharanjay dubey
				const allowedNames = ['Shaji SP', 'Nawaz Aman', 'Dr dharanjay dubey'];
				const filteredAdminList = adminList.filter(
					admin => allowedNames.some(name => 
						admin.userName.toLowerCase().trim() === name.toLowerCase().trim()
					)
				);
				setAdmins(filteredAdminList);

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
							leaveType: (data.leaveType as LeaveType) || 'earned leave',
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

	// Real-time validation feedback
	useEffect(() => {
		if (!startDate || !endDate || numberOfDays === 0) {
			setValidationMessage(null);
			return;
		}

		const validation = validateLeaveRequest(leaveType, startDate, endDate, numberOfDays, reasons, totalLeaveTaken);
		
		if (!validation.isValid) {
			setValidationMessage({ type: 'error', message: validation.errorMessage });
		} else {
			// Check if approaching limits
			const remainingSick = 6 - totalLeaveTaken['sick leave'];
			const remainingEarned = 15 - totalLeaveTaken['earned leave'];
			
			if (leaveType === 'sick leave' && remainingSick - numberOfDays < 2) {
				setValidationMessage({ 
					type: 'warning', 
					message: `Warning: Only ${remainingSick - numberOfDays} days of sick leave will remain after this request.` 
				});
			} else if (leaveType === 'earned leave' && remainingEarned - numberOfDays < 3) {
				setValidationMessage({ 
					type: 'warning', 
					message: `Warning: Only ${remainingEarned - numberOfDays} days of earned leave will remain after this request.` 
				});
			} else {
				setValidationMessage({ type: 'success', message: 'Leave request meets all CSSB policy requirements.' });
			}
		}
	}, [leaveType, startDate, endDate, numberOfDays, reasons, totalLeaveTaken]);

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

		// Validate leave request against policy rules
		const validation = validateLeaveRequest(leaveType, startDate, endDate, numberOfDays, reasons, totalLeaveTaken);
		if (!validation.isValid) {
			alert(validation.errorMessage);
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

			// Reset formmm
			setLeaveType('earned leave');
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
					<h2 className="text-lg font-semibold text-slate-900 mb-4">Leave Balance</h2>
					<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
						<div className="rounded-lg bg-blue-50 p-4 border border-blue-200">
							<p className="text-xs text-blue-600 font-medium mb-1">Sick Leave (SL)</p>
							<p className="text-2xl font-bold text-blue-900">{totalLeaveTaken['sick leave']} / 6 days</p>
							<p className="text-xs text-blue-700 mt-1">
								{6 - totalLeaveTaken['sick leave']} days remaining
							</p>
							<p className="text-xs text-blue-600 mt-2 italic">
								Medical certificate mandatory
							</p>
						</div>
						<div className="rounded-lg bg-green-50 p-4 border border-green-200">
							<p className="text-xs text-green-600 font-medium mb-1">Earned Leave (EL)</p>
							<p className="text-2xl font-bold text-green-900">{totalLeaveTaken['earned leave']} / 15 days</p>
							<p className="text-xs text-green-700 mt-1">
								{15 - totalLeaveTaken['earned leave']} days remaining
							</p>
							<p className="text-xs text-green-600 mt-2 italic">
								15 days advance notice required
							</p>
						</div>
						<div className="rounded-lg bg-orange-50 p-4 border border-orange-200">
							<p className="text-xs text-orange-600 font-medium mb-1">Unpaid Leave (UPL)</p>
							<p className="text-2xl font-bold text-orange-900">{totalLeaveTaken['unpaid leave']} days</p>
							<p className="text-xs text-orange-700 mt-1">No limit (deduction from payout)</p>
							<p className="text-xs text-orange-600 mt-2 italic">
								Subject to management approval
							</p>
						</div>
					</div>
					<div className="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200">
						<p className="text-xs text-amber-800">
							<i className="fas fa-info-circle mr-1" aria-hidden="true" />
							<strong>CSSB Leave Policy:</strong> Earned Leave (15 days/year, 15 days notice) | Sick Leave (6 days/year, medical certificate mandatory) | 
							Unpaid Leave (no limit, payout deduction). Leave cannot be carried forward or encashed.
						</p>
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
									<option value="sick leave">Sick Leave (SL) - 6 days/year, Medical certificate mandatory</option>
									<option value="earned leave">Earned Leave (EL) - 15 days/year, 15 days advance notice required</option>
									<option value="unpaid leave">Unpaid Leave (UPL) - No limit, Detailed reason required</option>
								</select>
								{leaveType === 'sick leave' && (
									<p className="mt-1 text-xs text-blue-600">
										<i className="fas fa-info-circle mr-1" aria-hidden="true" />
										<strong>CSSB Policy:</strong> Maximum 6 days per calendar year. A doctor's medical certificate is MANDATORY for all Sick Leave. 
										Without a certificate, the leave will be treated as Unpaid Leave.
									</p>
								)}
								{leaveType === 'earned leave' && (
									<p className="mt-1 text-xs text-green-600">
										<i className="fas fa-info-circle mr-1" aria-hidden="true" />
										<strong>CSSB Policy:</strong> Maximum 15 days per calendar year. A minimum of 15 days' prior notice is COMPULSORY. 
										If 15-day notice is not given, the leave will be treated as Unpaid Leave with payout deduction.
									</p>
								)}
								{leaveType === 'unpaid leave' && (
									<p className="mt-1 text-xs text-orange-600">
										<i className="fas fa-info-circle mr-1" aria-hidden="true" />
										<strong>CSSB Policy:</strong> Any absence without available EL/SL or without proper notice/certificate will be treated as Unpaid Leave 
										with deduction from the monthly payout. Detailed reason (50+ characters) required.
									</p>
								)}
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

						{/* Validation Message */}
						{validationMessage && (
							<div
								className={`rounded-lg border p-4 ${
									validationMessage.type === 'error'
										? 'bg-red-50 border-red-200 text-red-800'
										: validationMessage.type === 'warning'
											? 'bg-amber-50 border-amber-200 text-amber-800'
											: validationMessage.type === 'success'
												? 'bg-green-50 border-green-200 text-green-800'
												: 'bg-blue-50 border-blue-200 text-blue-800'
								}`}
							>
								<div className="flex items-start gap-2">
									<i
										className={`fas ${
											validationMessage.type === 'error'
												? 'fa-exclamation-circle'
												: validationMessage.type === 'warning'
													? 'fa-exclamation-triangle'
													: validationMessage.type === 'success'
														? 'fa-check-circle'
														: 'fa-info-circle'
										} mt-0.5`}
										aria-hidden="true"
									/>
									<p className="text-sm font-medium flex-1">{validationMessage.message}</p>
								</div>
							</div>
						)}

						{/* Leave Policy Section */}
						<div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
							<div className="flex items-start justify-between gap-4">
								<div className="flex-1">
									<h3 className="text-sm font-semibold text-blue-900 mb-1">
										<i className="fas fa-file-pdf mr-2" aria-hidden="true" />
										Leave Policy
									</h3>
									<p className="text-xs text-blue-700">
										Please read the leave policy before submitting your request. All leave requests must comply with the policy conditions.
									</p>
								</div>
								<button
									type="button"
									onClick={() => {
										const viewWindow = window.open('/CSSB_Consultant_Leave_Policy.pdf', '_blank');
										if (viewWindow) {
											viewWindow.focus();
										}
									}}
									className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
								>
									<i className="fas fa-eye" aria-hidden="true" />
									View Policy
								</button>
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
