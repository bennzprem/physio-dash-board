'use client';

import { useState, useEffect } from 'react';
import {
	collection,
	onSnapshot,
	updateDoc,
	doc,
	query,
	where,
	orderBy,
	serverTimestamp,
	type QuerySnapshot,
	type Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import PageHeader from '@/components/PageHeader';

export interface AppointmentRequest {
	id: string;
	patientId?: string;
	patient: string;
	preferredDate?: string;
	preferredTime?: string;
	notes?: string;
	source?: string;
	createdAt: Timestamp | null;
}

function formatDate(timestamp: Timestamp | null | undefined): string {
	if (!timestamp) return '—';
	const d = timestamp?.toDate?.();
	if (!d) return '—';
	return d.toLocaleString('en-IN', {
		dateStyle: 'medium',
		timeStyle: 'short',
	});
}

function formatDateShort(dateStr: string | undefined): string {
	if (!dateStr) return '—';
	const d = new Date(dateStr);
	if (Number.isNaN(d.getTime())) return dateStr;
	return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface StaffMember {
	id: string;
	userName: string;
	role: string;
	status: string;
}

export default function Requests() {
	const [appointmentRequests, setAppointmentRequests] = useState<AppointmentRequest[]>([]);
	const [staff, setStaff] = useState<StaffMember[]>([]);
	const [loading, setLoading] = useState(true);
	const [updatingId, setUpdatingId] = useState<string | null>(null);
	const [confirmingId, setConfirmingId] = useState<string | null>(null);
	const [confirmForm, setConfirmForm] = useState({ doctor: '', date: '', time: '' });
	const [confirmSaving, setConfirmSaving] = useState(false);

	// Load appointment requests (appointments with status 'requested')
	useEffect(() => {
		const q = query(
			collection(db, 'appointments'),
			where('status', '==', 'requested'),
			orderBy('createdAt', 'desc')
		);

		const unsubscribe = onSnapshot(
			q,
			(snapshot: QuerySnapshot) => {
				const list = snapshot.docs.map(docSnap => {
					const data = docSnap.data() as Record<string, unknown>;
					return {
						id: docSnap.id,
						patientId: data.patientId ? String(data.patientId) : undefined,
						patient: data.patient ? String(data.patient) : '—',
						preferredDate: data.preferredDate ? String(data.preferredDate) : undefined,
						preferredTime: data.preferredTime ? String(data.preferredTime) : undefined,
						notes: data.notes ? String(data.notes) : undefined,
						source: data.source ? String(data.source) : undefined,
						createdAt: (data.createdAt as Timestamp) ?? null,
					} as AppointmentRequest;
				});
				setAppointmentRequests(list);
				setLoading(false);
			},
			error => {
				console.error('Failed to load appointment requests', error);
				setAppointmentRequests([]);
				setLoading(false);
			}
		);

		return () => unsubscribe();
	}, []);

	// Load staff (doctors) for Confirm modal
	useEffect(() => {
		const unsubscribe = onSnapshot(
			collection(db, 'staff'),
			(snapshot: QuerySnapshot) => {
				const list = snapshot.docs
					.map(docSnap => {
						const data = docSnap.data() as Record<string, unknown>;
						return {
							id: docSnap.id,
							userName: data.userName ? String(data.userName) : '',
							role: data.role ? String(data.role) : '',
							status: data.status ? String(data.status) : '',
						} as StaffMember;
					})
					.filter(
						s =>
							s.status === 'Active' &&
							['Physiotherapist', 'StrengthAndConditioning', 'ClinicalTeam'].includes(s.role)
					);
				setStaff(list);
			},
			error => {
				console.error('Failed to load staff', error);
				setStaff([]);
			}
		);
		return () => unsubscribe();
	}, []);

	const handleReject = async (requestId: string) => {
		setUpdatingId(requestId);
		try {
			await updateDoc(doc(db, 'appointments', requestId), {
				status: 'cancelled',
				updatedAt: serverTimestamp(),
			});
		} catch (error) {
			console.error('Failed to reject request', error);
		} finally {
			setUpdatingId(null);
		}
	};

	const handleConfirm = async () => {
		if (!confirmingId || !confirmForm.doctor || !confirmForm.date || !confirmForm.time) return;
		setConfirmSaving(true);
		try {
			const staffMember = staff.find(s => s.userName === confirmForm.doctor);
			await updateDoc(doc(db, 'appointments', confirmingId), {
				doctor: confirmForm.doctor,
				staffId: staffMember?.id ?? null,
				date: confirmForm.date,
				time: confirmForm.time,
				status: 'pending',
				updatedAt: serverTimestamp(),
			});
			setConfirmingId(null);
			setConfirmForm({ doctor: '', date: '', time: '' });
		} catch (error) {
			console.error('Failed to confirm appointment', error);
		} finally {
			setConfirmSaving(false);
		}
	};

	const openConfirmModal = (req: AppointmentRequest) => {
		setConfirmingId(req.id);
		setConfirmForm({
			doctor: '',
			date: req.preferredDate || '',
			time: req.preferredTime || '',
		});
	};

	const pendingCount = appointmentRequests.length;

	return (
		<div className="min-h-svh bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 px-6 py-10">
			<div className="mx-auto max-w-6xl space-y-6">
				<PageHeader
					title="Appointment Requests"
					description="Appointment requests from the patient mobile app. Confirm to schedule or reject."
					statusCard={
						pendingCount > 0
							? { label: 'Pending', value: String(pendingCount), subtitle: 'awaiting action' }
							: undefined
					}
				/>

				<section className="rounded-2xl bg-white p-6 shadow-lg border border-slate-200">
					<h2 className="text-lg font-semibold text-slate-900 mb-6">All appointment requests</h2>

					{loading ? (
						<div className="text-center py-12 text-slate-500">
							<i className="fas fa-spinner fa-spin text-2xl mb-2" aria-hidden="true" />
							<p>Loading appointment requests…</p>
						</div>
					) : appointmentRequests.length === 0 ? (
						<div className="text-center py-12 text-slate-500 rounded-lg border border-dashed border-slate-300 bg-slate-50">
							<i className="fas fa-calendar-check text-4xl mb-3 text-slate-400" aria-hidden="true" />
							<p className="font-medium">No appointment requests</p>
							<p className="text-sm mt-1">
								When patients submit appointment requests from the mobile app, they will appear here.
							</p>
						</div>
					) : (
						<div className="overflow-x-auto">
							<table className="min-w-full divide-y divide-slate-200 text-left text-sm">
								<thead className="bg-slate-50">
									<tr>
										<th className="px-4 py-3 font-semibold text-slate-700">Patient</th>
										<th className="px-4 py-3 font-semibold text-slate-700">Preferred date / time</th>
										<th className="px-4 py-3 font-semibold text-slate-700">Notes</th>
										<th className="px-4 py-3 font-semibold text-slate-700">Received</th>
										<th className="px-4 py-3 font-semibold text-slate-700">Actions</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-200 bg-white">
									{appointmentRequests.map(req => (
										<tr key={req.id} className="hover:bg-slate-50/50">
											<td className="px-4 py-3">
												<div className="font-medium text-slate-900">{req.patient}</div>
												{req.patientId && (
													<div className="text-xs text-slate-500">ID: {req.patientId}</div>
												)}
											</td>
											<td className="px-4 py-3 text-slate-700">
												{formatDateShort(req.preferredDate)}
												{req.preferredTime && (
													<span className="ml-1">@ {req.preferredTime}</span>
												)}
												{!req.preferredDate && !req.preferredTime && '—'}
											</td>
											<td className="px-4 py-3 text-slate-700 max-w-xs truncate" title={req.notes}>
												{req.notes || '—'}
											</td>
											<td className="px-4 py-3 text-slate-600 text-xs whitespace-nowrap">
												{formatDate(req.createdAt)}
											</td>
											<td className="px-4 py-3">
												<div className="flex flex-wrap gap-2">
													<button
														type="button"
														onClick={() => openConfirmModal(req)}
														className="rounded-md bg-green-100 px-2 py-1.5 text-xs font-medium text-green-800 hover:bg-green-200"
													>
														Confirm & schedule
													</button>
													<button
														type="button"
														onClick={() => handleReject(req.id)}
														disabled={updatingId === req.id}
														className="rounded-md bg-red-100 px-2 py-1.5 text-xs font-medium text-red-800 hover:bg-red-200 disabled:opacity-50"
													>
														{updatingId === req.id ? (
															<i className="fas fa-spinner fa-spin" aria-hidden="true" />
														) : (
															'Reject'
														)}
													</button>
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</section>
			</div>

			{/* Confirm & schedule modal */}
			{confirmingId && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
					role="dialog"
					aria-modal="true"
					aria-labelledby="confirm-modal-title"
				>
					<div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
						<h3 id="confirm-modal-title" className="text-lg font-semibold text-slate-900">
							Confirm & schedule
						</h3>
						<p className="mt-1 text-sm text-slate-600">
							Set doctor, date and time to convert this request into a scheduled appointment.
						</p>
						<div className="mt-4 space-y-4">
							<div>
								<label htmlFor="confirm-doctor" className="block text-sm font-medium text-slate-700">
									Doctor
								</label>
								<select
									id="confirm-doctor"
									value={confirmForm.doctor}
									onChange={e => setConfirmForm(f => ({ ...f, doctor: e.target.value }))}
									className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
									required
								>
									<option value="">Select doctor</option>
									{staff.map(s => (
										<option key={s.id} value={s.userName}>
											{s.userName}
										</option>
									))}
								</select>
							</div>
							<div>
								<label htmlFor="confirm-date" className="block text-sm font-medium text-slate-700">
									Date
								</label>
								<input
									id="confirm-date"
									type="date"
									value={confirmForm.date}
									onChange={e => setConfirmForm(f => ({ ...f, date: e.target.value }))}
									className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
									required
								/>
							</div>
							<div>
								<label htmlFor="confirm-time" className="block text-sm font-medium text-slate-700">
									Time
								</label>
								<input
									id="confirm-time"
									type="time"
									value={confirmForm.time}
									onChange={e => setConfirmForm(f => ({ ...f, time: e.target.value }))}
									className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
									required
								/>
							</div>
						</div>
						<div className="mt-6 flex justify-end gap-2">
							<button
								type="button"
								onClick={() => {
									setConfirmingId(null);
									setConfirmForm({ doctor: '', date: '', time: '' });
								}}
								className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleConfirm}
								disabled={confirmSaving || !confirmForm.doctor || !confirmForm.date || !confirmForm.time}
								className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
							>
								{confirmSaving ? (
									<i className="fas fa-spinner fa-spin mr-1" aria-hidden="true" />
								) : null}
								Schedule
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
