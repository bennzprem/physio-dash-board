'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, where, updateDoc, doc, serverTimestamp, getDocs, addDoc, getDoc, type QuerySnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/PageHeader';

interface LeaveRequest {
	id: string;
	userId: string;
	userEmail: string | null;
	userName: string;
	userRole: string;
	leaveType: string;
	startDate: string;
	endDate: string;
	numberOfDays: number;
	reasons: string;
	handoverTo: string | null;
	handoverToName: string | null;
	approvalRequestedTo: string;
	approvalRequestedToName: string;
	approvalRequestedToEmail: string | null;
	status: 'pending' | 'approved' | 'disapproved';
	approvedBy: string | null;
	approvedByName: string | null;
	approvalMessage: string | null;
	disapprovalMessage: string | null;
	createdAt: any;
	updatedAt: any;
}

function formatDate(dateStr: string | null | undefined): string {
	if (!dateStr) return '—';
	try {
		const date = new Date(dateStr);
		return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
	} catch {
		return dateStr;
	}
}

function getStatusBadge(status: string): string {
	switch (status) {
		case 'approved':
			return 'bg-green-50 text-green-700 border-green-200';
		case 'disapproved':
			return 'bg-red-50 text-red-700 border-red-200';
		case 'pending':
			return 'bg-yellow-50 text-yellow-700 border-yellow-200';
		default:
			return 'bg-slate-50 text-slate-700 border-slate-200';
	}
}

export default function AdminLeaveManagement() {
	const { user } = useAuth();
	const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
	const [loading, setLoading] = useState(true);
	const [approvingId, setApprovingId] = useState<string | null>(null);
	const [disapprovingId, setDisapprovingId] = useState<string | null>(null);
	const [approvalMessage, setApprovalMessage] = useState('');
	const [disapprovalMessage, setDisapprovalMessage] = useState('');
	const [showApprovalModal, setShowApprovalModal] = useState(false);
	const [showDisapprovalModal, setShowDisapprovalModal] = useState(false);
	const [selectedRequest, setSelectedRequest] = useState<LeaveRequest | null>(null);
	const [pendingCount, setPendingCount] = useState(0);

	// Load leave requests that are pending approval from this admin
	useEffect(() => {
		if (!user) return;

		// Get admin's email to match with approvalRequestedToEmail
		const adminEmail = user.email?.toLowerCase() || '';

		const unsubscribe = onSnapshot(
			query(collection(db, 'leaveRequests'), where('status', '==', 'pending')),
			(snapshot: QuerySnapshot) => {
				const requests: LeaveRequest[] = [];
				snapshot.forEach(docSnap => {
					const data = docSnap.data();
					const requestEmail = (data.approvalRequestedToEmail || '').toLowerCase();
					
					// Only show requests where this admin was requested for approval (match by email)
					if (requestEmail === adminEmail && requestEmail !== '') {
						requests.push({
							id: docSnap.id,
							userId: data.userId || '',
							userEmail: data.userEmail || null,
							userName: data.userName || 'Unknown',
							userRole: data.userRole || '',
							leaveType: data.leaveType || '',
							startDate: data.startDate || '',
							endDate: data.endDate || '',
							numberOfDays: data.numberOfDays || 0,
							reasons: data.reasons || '',
							handoverTo: data.handoverTo || null,
							handoverToName: data.handoverToName || null,
							approvalRequestedTo: data.approvalRequestedTo || '',
							approvalRequestedToName: data.approvalRequestedToName || '',
							approvalRequestedToEmail: data.approvalRequestedToEmail || null,
							status: data.status || 'pending',
							approvedBy: data.approvedBy || null,
							approvedByName: data.approvedByName || null,
							approvalMessage: data.approvalMessage || null,
							disapprovalMessage: data.disapprovalMessage || null,
							createdAt: data.createdAt,
							updatedAt: data.updatedAt,
						});
					}
				});
				setLeaveRequests(requests);
				setPendingCount(requests.length);
				setLoading(false);
			},
			error => {
				console.error('Failed to load leave requests:', error);
				setLeaveRequests([]);
				setLoading(false);
			}
		);

		return () => unsubscribe();
	}, [user]);

	const handleApprove = async () => {
		if (!selectedRequest || !user) return;

		setApprovingId(selectedRequest.id);
		let appointmentsToTransfer: any[] = [];
		let handoverStaffName: string | null = null;
		let handoverStaffId: string | null = null;
		let employeeStaffName: string | null = null;
		
		try {
			// Get handover person details
			
			if (selectedRequest.handoverTo) {
				try {
					const handoverStaffDoc = await getDoc(doc(db, 'staff', selectedRequest.handoverTo));
					if (handoverStaffDoc.exists()) {
						const handoverData = handoverStaffDoc.data();
						handoverStaffName = handoverData.userName || handoverData.name || null;
						handoverStaffId = handoverStaffDoc.id;
					}
				} catch (error) {
					console.error('Failed to get handover staff details:', error);
				}
			}

			// Get employee's staff details to find their userName
			try {
				// Try to find staff by userId or userEmail
				const staffQuery = query(
					collection(db, 'staff'),
					where('userEmail', '==', (selectedRequest.userEmail || '').toLowerCase())
				);
				const staffSnapshot = await getDocs(staffQuery);
				if (!staffSnapshot.empty) {
					const staffData = staffSnapshot.docs[0].data();
					employeeStaffName = staffData.userName || staffData.name || null;
				}
			} catch (error) {
				console.error('Failed to get employee staff details:', error);
			}

			// Update leave request
			await updateDoc(doc(db, 'leaveRequests', selectedRequest.id), {
				status: 'approved',
				approvedBy: user.uid,
				approvedByName: user.displayName || user.email?.split('@')[0] || 'Admin',
				approvalMessage: approvalMessage.trim() || null,
				disapprovalMessage: null,
				updatedAt: serverTimestamp(),
			});

			// Transfer appointments if handover person is specified
			if (handoverStaffName && employeeStaffName && selectedRequest.startDate && selectedRequest.endDate) {
				try {
					// Query appointments for the employee during the leave period
					const startDate = selectedRequest.startDate;
					const endDate = selectedRequest.endDate;

					// Get all appointments for the employee
					const appointmentsQuery = query(
						collection(db, 'appointments'),
						where('doctor', '==', employeeStaffName),
						where('status', 'in', ['pending', 'ongoing'])
					);
					const appointmentsSnapshot = await getDocs(appointmentsQuery);

					// Filter appointments within the leave period
					appointmentsToTransfer = appointmentsSnapshot.docs.filter(docSnap => {
						const data = docSnap.data();
						const appointmentDate = data.date;
						if (!appointmentDate) return false;
						
						// Check if appointment date falls within leave period
						return appointmentDate >= startDate && appointmentDate <= endDate;
					});

					// Transfer appointments to handover person
					if (appointmentsToTransfer.length > 0) {
						const transferPromises = appointmentsToTransfer.map(appointmentDoc => {
							const updateData: Record<string, any> = {
								doctor: handoverStaffName,
								transferredAt: serverTimestamp(),
								transferredFrom: employeeStaffName,
								transferReason: 'Leave approval',
							};
							
							if (handoverStaffId) {
								updateData.staffId = handoverStaffId;
							}

							return updateDoc(appointmentDoc.ref, updateData);
						});

						await Promise.allSettled(transferPromises);
						console.log(`Transferred ${appointmentsToTransfer.length} appointments to ${handoverStaffName}`);

						// Update patient records to show handover information
						// Get unique patient IDs from transferred appointments
						const patientIds = new Set<string>();
						appointmentsToTransfer.forEach(appointmentDoc => {
							const data = appointmentDoc.data();
							if (data.patientId) {
								patientIds.add(data.patientId);
							}
						});

						// Update each patient's assignedDoctor and store original therapist
						const patientUpdatePromises = Array.from(patientIds).map(async (patientId) => {
							try {
								// Find patient document by patientId
								const patientsQuery = query(
									collection(db, 'patients'),
									where('patientId', '==', patientId)
								);
								const patientsSnapshot = await getDocs(patientsQuery);
								
								if (!patientsSnapshot.empty) {
									const patientDoc = patientsSnapshot.docs[0];
									const patientData = patientDoc.data();
									const currentAssignedDoctor = patientData.assignedDoctor;
									
									// Only update if patient was assigned to the employee taking leave
									if (currentAssignedDoctor === employeeStaffName) {
										await updateDoc(patientDoc.ref, {
											assignedDoctor: handoverStaffName,
											transferredFromDoctor: employeeStaffName, // Store original therapist
											transferredAt: serverTimestamp(),
											transferReason: 'Leave approval',
										});
									}
								}
							} catch (error) {
								console.error(`Failed to update patient ${patientId}:`, error);
							}
						});

						await Promise.allSettled(patientUpdatePromises);
					}
				} catch (transferError) {
					console.error('Failed to transfer appointments:', transferError);
					// Continue even if transfer fails - don't block approval
				}
			}

			// Send notification to the employee
			if (selectedRequest.userId) {
				try {
					// Get user ID from users collection
					const usersQuery = query(collection(db, 'users'), where('email', '==', (selectedRequest.userEmail || '').toLowerCase()));
					const usersSnapshot = await getDocs(usersQuery);
					let employeeUserId: string | null = null;
					if (!usersSnapshot.empty) {
						employeeUserId = usersSnapshot.docs[0].id;
					} else {
						// Fallback: use userId from leave request
						employeeUserId = selectedRequest.userId;
					}

					if (employeeUserId) {
						const transferMessage = handoverStaffName && appointmentsToTransfer.length > 0
							? ` Your ${appointmentsToTransfer.length} appointment(s) during this period have been transferred to ${handoverStaffName}.`
							: '';
						
						await addDoc(collection(db, 'notifications'), {
							userId: employeeUserId,
							title: 'Leave Request Approved',
							message: `Your ${selectedRequest.leaveType} request from ${formatDate(selectedRequest.startDate)} to ${formatDate(selectedRequest.endDate)} has been approved by ${user.displayName || user.email?.split('@')[0] || 'Admin'}.${transferMessage}${approvalMessage.trim() ? ` Message: ${approvalMessage.trim()}` : ''}`,
							category: 'leave_approval',
							status: 'unread',
							leaveRequestId: selectedRequest.id,
							createdAt: serverTimestamp(),
						});
					}
				} catch (notifError) {
					console.error('Failed to send approval notification:', notifError);
				}
			}

			// Send notification to handover person if appointments were transferred
			if (handoverStaffName && appointmentsToTransfer.length > 0 && selectedRequest.handoverTo) {
				try {
					// Get handover person's user ID
					const handoverStaffDoc = await getDoc(doc(db, 'staff', selectedRequest.handoverTo));
					if (handoverStaffDoc.exists()) {
						const handoverData = handoverStaffDoc.data();
						const handoverEmail = handoverData.userEmail;
						
						if (handoverEmail) {
							const handoverUsersQuery = query(collection(db, 'users'), where('email', '==', handoverEmail.toLowerCase()));
							const handoverUsersSnapshot = await getDocs(handoverUsersQuery);
							
							if (!handoverUsersSnapshot.empty) {
								const handoverUserId = handoverUsersSnapshot.docs[0].id;
								await addDoc(collection(db, 'notifications'), {
									userId: handoverUserId,
									title: 'Appointments Transferred Due to Leave',
									message: `${appointmentsToTransfer.length} appointment(s) from ${employeeStaffName || selectedRequest.userName} have been transferred to you due to their approved leave from ${formatDate(selectedRequest.startDate)} to ${formatDate(selectedRequest.endDate)}.`,
									category: 'appointment_transfer',
									status: 'unread',
									leaveRequestId: selectedRequest.id,
									createdAt: serverTimestamp(),
								});
							}
						}
					}
				} catch (notifError) {
					console.error('Failed to send notification to handover person:', notifError);
				}
			}

			setShowApprovalModal(false);
			setSelectedRequest(null);
			setApprovalMessage('');
			
			// Show success message
			const transferMsg = handoverStaffName && appointmentsToTransfer.length > 0
				? ` ${appointmentsToTransfer.length} appointment(s) have been transferred to ${handoverStaffName}.`
				: '';
			alert(`Leave request approved successfully!${transferMsg} The employee has been notified.`);
		} catch (error) {
			console.error('Failed to approve leave request:', error);
			alert('Failed to approve leave request. Please try again.');
		} finally {
			setApprovingId(null);
		}
	};

	const handleDisapprove = async () => {
		if (!selectedRequest || !user) return;

		setDisapprovingId(selectedRequest.id);
		try {
			// Update leave request
			await updateDoc(doc(db, 'leaveRequests', selectedRequest.id), {
				status: 'disapproved',
				approvedBy: user.uid,
				approvedByName: user.displayName || user.email?.split('@')[0] || 'Admin',
				approvalMessage: null,
				disapprovalMessage: disapprovalMessage.trim() || null,
				updatedAt: serverTimestamp(),
			});

			// Send notification to the employee
			if (selectedRequest.userId) {
				try {
					// Get user ID from users collection
					const usersQuery = query(collection(db, 'users'), where('email', '==', (selectedRequest.userEmail || '').toLowerCase()));
					const usersSnapshot = await getDocs(usersQuery);
					let employeeUserId: string | null = null;
					if (!usersSnapshot.empty) {
						employeeUserId = usersSnapshot.docs[0].id;
					} else {
						// Fallback: use userId from leave request
						employeeUserId = selectedRequest.userId;
					}

					if (employeeUserId) {
						await addDoc(collection(db, 'notifications'), {
							userId: employeeUserId,
							title: 'Leave Request Disapproved',
							message: `Your ${selectedRequest.leaveType} request from ${formatDate(selectedRequest.startDate)} to ${formatDate(selectedRequest.endDate)} has been disapproved by ${user.displayName || user.email?.split('@')[0] || 'Admin'}.${disapprovalMessage.trim() ? ` Reason: ${disapprovalMessage.trim()}` : ''}`,
							category: 'leave_disapproval',
							status: 'unread',
							leaveRequestId: selectedRequest.id,
							createdAt: serverTimestamp(),
						});
					}
				} catch (notifError) {
					console.error('Failed to send disapproval notification:', notifError);
				}
			}

			setShowDisapprovalModal(false);
			setSelectedRequest(null);
			setDisapprovalMessage('');
			
			// Show success message
			alert('Leave request disapproved. The employee has been notified.');
		} catch (error) {
			console.error('Failed to disapprove leave request:', error);
			alert('Failed to disapprove leave request. Please try again.');
		} finally {
			setDisapprovingId(null);
		}
	};

	const openApprovalModal = (request: LeaveRequest) => {
		setSelectedRequest(request);
		setApprovalMessage('');
		setShowApprovalModal(true);
	};

	const openDisapprovalModal = (request: LeaveRequest) => {
		setSelectedRequest(request);
		setDisapprovalMessage('');
		setShowDisapprovalModal(true);
	};

	const pendingRequests = useMemo(() => {
		return leaveRequests.filter(req => req.status === 'pending');
	}, [leaveRequests]);

	return (
		<div className="min-h-svh bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 px-6 py-10">
			<div className="mx-auto max-w-6xl space-y-6">
				<div className="flex items-center justify-between">
					<PageHeader title="Leave Management" />
					{pendingCount > 0 && (
						<div className="flex items-center gap-2 rounded-full bg-gradient-to-r from-yellow-500 via-amber-500 to-orange-500 px-4 py-2 shadow-lg">
							<i className="fas fa-bell text-white text-sm animate-pulse" aria-hidden="true" />
							<span className="text-white font-semibold text-sm">
								{pendingCount} {pendingCount === 1 ? 'Request' : 'Requests'} Pending
							</span>
						</div>
					)}
				</div>

				{/* Pending Leave Requests */}
				<section className="rounded-2xl bg-white p-6 shadow-lg border border-slate-200">
					<div className="flex items-center justify-between mb-4">
						<h2 className="text-lg font-semibold text-slate-900">Pending Leave Requests</h2>
						{pendingCount > 0 && (
							<span className="inline-flex items-center justify-center rounded-full bg-yellow-100 text-yellow-800 text-xs font-bold px-2.5 py-0.5 border border-yellow-300">
								{pendingCount}
							</span>
						)}
					</div>
					{loading ? (
						<div className="text-center py-8 text-slate-500">Loading leave requests...</div>
					) : pendingRequests.length === 0 ? (
						<div className="text-center py-8 text-slate-500">No pending leave requests</div>
					) : (
						<div className="space-y-4">
							{pendingRequests.map(request => (
								<div
									key={request.id}
									className="rounded-lg border-2 border-yellow-200 bg-yellow-50 p-4 transition-all hover:shadow-md"
								>
									<div className="flex items-start justify-between mb-3">
										<div className="flex-1">
											<div className="flex items-center gap-3 mb-2">
												<h3 className="text-base font-semibold text-slate-900 capitalize">
													{request.leaveType} Request
												</h3>
												<span className="px-2.5 py-1 rounded-full text-xs font-semibold border bg-yellow-50 text-yellow-700 border-yellow-200">
													Pending
												</span>
											</div>
											<div className="text-sm text-slate-600 space-y-1">
												<p>
													<span className="font-medium">Employee:</span> {request.userName} ({request.userRole})
												</p>
												<p>
													<span className="font-medium">Period:</span> {formatDate(request.startDate)} -{' '}
													{formatDate(request.endDate)} ({request.numberOfDays} days)
												</p>
												{request.handoverToName && (
													<p>
														<span className="font-medium">Handover to:</span> {request.handoverToName}
													</p>
												)}
											</div>
										</div>
									</div>

									{request.reasons && (
										<div className="mb-3">
											<p className="text-xs font-medium text-slate-500 mb-1">Reasons:</p>
											<p className="text-sm text-slate-700 bg-white rounded p-2">{request.reasons}</p>
										</div>
									)}

									<div className="flex items-center gap-3 mt-4">
										<button
											type="button"
											onClick={() => openApprovalModal(request)}
											disabled={approvingId === request.id}
											className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-green-600 via-green-700 to-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:from-green-700 hover:via-green-800 hover:to-emerald-700 transition-all duration-200 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
										>
											<i className="fas fa-check text-xs" aria-hidden="true" />
											{approvingId === request.id ? 'Approving...' : 'Approve'}
										</button>
										<button
											type="button"
											onClick={() => openDisapprovalModal(request)}
											disabled={disapprovingId === request.id}
											className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-red-600 via-red-700 to-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:from-red-700 hover:via-red-800 hover:to-rose-700 transition-all duration-200 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
										>
											<i className="fas fa-times text-xs" aria-hidden="true" />
											{disapprovingId === request.id ? 'Disapproving...' : 'Disapprove'}
										</button>
									</div>

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
			</div>

			{/* Approval Modal */}
			{showApprovalModal && selectedRequest && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
					<div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
						<h3 className="text-lg font-semibold text-slate-900 mb-4">Approve Leave Request</h3>
						<p className="text-sm text-slate-600 mb-4">
							Approve {selectedRequest.userName}'s {selectedRequest.leaveType} request from{' '}
							{formatDate(selectedRequest.startDate)} to {formatDate(selectedRequest.endDate)}?
						</p>
						<div className="mb-4">
							<label htmlFor="approvalMessage" className="block text-sm font-medium text-slate-700 mb-2">
								Approval Message (Optional)
							</label>
							<textarea
								id="approvalMessage"
								value={approvalMessage}
								onChange={e => setApprovalMessage(e.target.value)}
								placeholder="Add a message..."
								className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
								rows={3}
							/>
						</div>
						<div className="flex items-center gap-3 justify-end">
							<button
								type="button"
								onClick={() => {
									setShowApprovalModal(false);
									setSelectedRequest(null);
									setApprovalMessage('');
								}}
								className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleApprove}
								disabled={approvingId !== null}
								className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-green-600 via-green-700 to-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:from-green-700 hover:via-green-800 hover:to-emerald-700 transition-all duration-200 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
							>
								{approvingId ? (
									<>
										<div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
										Approving...
									</>
								) : (
									<>
										<i className="fas fa-check text-xs" aria-hidden="true" />
										Approve
									</>
								)}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Disapproval Modal */}
			{showDisapprovalModal && selectedRequest && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
					<div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
						<h3 className="text-lg font-semibold text-slate-900 mb-4">Disapprove Leave Request</h3>
						<p className="text-sm text-slate-600 mb-4">
							Disapprove {selectedRequest.userName}'s {selectedRequest.leaveType} request from{' '}
							{formatDate(selectedRequest.startDate)} to {formatDate(selectedRequest.endDate)}?
						</p>
						<div className="mb-4">
							<label htmlFor="disapprovalMessage" className="block text-sm font-medium text-slate-700 mb-2">
								Reason for Disapproval (Optional)
							</label>
							<textarea
								id="disapprovalMessage"
								value={disapprovalMessage}
								onChange={e => setDisapprovalMessage(e.target.value)}
								placeholder="Add a reason..."
								className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
								rows={3}
							/>
						</div>
						<div className="flex items-center gap-3 justify-end">
							<button
								type="button"
								onClick={() => {
									setShowDisapprovalModal(false);
									setSelectedRequest(null);
									setDisapprovalMessage('');
								}}
								className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleDisapprove}
								disabled={disapprovingId !== null}
								className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-red-600 via-red-700 to-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:from-red-700 hover:via-red-800 hover:to-rose-700 transition-all duration-200 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
							>
								{disapprovingId ? (
									<>
										<div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
										Disapproving...
									</>
								) : (
									<>
										<i className="fas fa-times text-xs" aria-hidden="true" />
										Disapprove
									</>
								)}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

