'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot, type QuerySnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { checkAppointmentConflict } from '@/lib/appointmentUtils';
import { useAuth } from '@/contexts/AuthContext';

interface DayAvailability {
	enabled: boolean;
	slots: Array<{ start: string; end: string }>;
}

interface StaffMember {
	id: string;
	name: string;
	userName?: string;
	role: string;
	availability?: {
		[day: string]: DayAvailability;
	};
	dateSpecificAvailability?: {
		[date: string]: DayAvailability;
	};
}

interface TransferSessionDialogProps {
	isOpen: boolean;
	appointment: {
		id: string;
		appointmentId?: string;
		patient: string;
		patientId?: string;
		doctor: string;
		date: string;
		time: string;
	} | null;
	onClose: () => void;
	onConfirm: (newTherapistId: string, newTherapistName: string) => Promise<void>;
	allAppointments: Array<{
		id: string;
		appointmentId?: string;
		patient: string;
		doctor: string;
		date: string;
		time: string;
		status?: string;
		duration?: number;
	}>;
	staff?: StaffMember[];
}

function normalize(value?: string | null): string {
	if (!value) return '';
	return value.trim().toLowerCase();
}

function formatDateKey(dateString: string): string {
	if (!dateString) return '';
	const date = new Date(dateString + 'T00:00:00');
	if (Number.isNaN(date.getTime())) return dateString;
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

export default function TransferSessionDialog({
	isOpen,
	appointment,
	onClose,
	onConfirm,
	allAppointments,
	staff = [],
}: TransferSessionDialogProps) {
	const { user } = useAuth();
	const [selectedTherapistId, setSelectedTherapistId] = useState('');
	const [conflict, setConflict] = useState<{ hasConflict: boolean; conflictingAppointments: any[] } | null>(null);
	const [checkingConflict, setCheckingConflict] = useState(false);
	const [transferring, setTransferring] = useState(false);
	const [targetStaffAppointments, setTargetStaffAppointments] = useState<Array<{ id?: string; doctor: string; date: string; time: string; status: string; duration?: number }>>([]);

	const clinicianName = useMemo(() => normalize(user?.displayName ?? ''), [user?.displayName]);

	// Filter staff to exclude current user and only show clinical roles
	const availableStaff = useMemo(() => {
		if (!staff || staff.length === 0) {
			return [];
		}
		
		const filtered = staff.filter(s => {
			if (!s || !s.id) return false;
			
			const staffName = normalize(s.userName || s.name || '');
			const isCurrentUser = staffName && clinicianName && staffName === clinicianName;
			
			// Exclude current user
			if (isCurrentUser) {
				return false;
			}
			
			// Check role - allow clinical roles only
			const role = (s.role || '').trim();
			const isClinicalRole = role === 'Physiotherapist' || 
			                      role === 'StrengthAndConditioning' || 
			                      role === 'ClinicalTeam';
			
			// Exclude non-clinical roles explicitly
			if (role === 'FrontDesk' || role === 'Admin') {
				return false;
			}
			
			// Must be a clinical role
			return isClinicalRole;
		});
		
		return filtered;
	}, [staff, clinicianName]);

	// Fetch all appointments for the selected therapist
	useEffect(() => {
		if (!isOpen || !selectedTherapistId) {
			setTargetStaffAppointments([]);
			return;
		}

		const selectedStaff = staff.find(s => s.id === selectedTherapistId);
		if (!selectedStaff) {
			setTargetStaffAppointments([]);
			return;
		}

		const therapistName = selectedStaff.userName || selectedStaff.name;
		const appointmentsQuery = query(
			collection(db, 'appointments'),
			where('doctor', '==', therapistName)
		);

		const unsubscribe = onSnapshot(
			appointmentsQuery,
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data();
					return {
						id: docSnap.id,
						doctor: data.doctor ? String(data.doctor) : '',
						date: data.date ? String(data.date) : '',
						time: data.time ? String(data.time) : '',
						status: data.status ? String(data.status) : 'pending',
						duration: typeof data.duration === 'number' ? data.duration : undefined,
					};
				});
				setTargetStaffAppointments([...mapped]);
			},
			error => {
				console.error('Failed to load appointments for conflict checking', error);
				setTargetStaffAppointments([]);
			}
		);

		return () => unsubscribe();
	}, [isOpen, selectedTherapistId, staff]);

	// Check for conflicts when therapist is selected
	useEffect(() => {
		if (!isOpen || !appointment || !selectedTherapistId) {
			setConflict(null);
			return;
		}

		const selectedStaff = staff.find(s => s.id === selectedTherapistId);
		if (!selectedStaff) {
			setConflict(null);
			return;
		}

		const therapistName = selectedStaff.userName || selectedStaff.name;

		// Check availability
		const dateKey = formatDateKey(appointment.date);
		const dateAvailability = selectedStaff.dateSpecificAvailability?.[dateKey];
		
		if (!dateAvailability || !dateAvailability.enabled) {
			setConflict({
				hasConflict: true,
				conflictingAppointments: [{
					id: 'availability',
					reason: 'Therapist has no availability for this date',
				}],
			});
			return;
		}

		// Check if time slot is available
		const [hours, minutes] = appointment.time.split(':').map(Number);
		const appointmentStartTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
		
		const hasSlot = dateAvailability.slots.some(slot => {
			const [slotStartHours, slotStartMins] = slot.start.split(':').map(Number);
			const [slotEndHours, slotEndMins] = slot.end.split(':').map(Number);
			const slotStart = slotStartHours * 60 + slotStartMins;
			const slotEnd = slotEndHours * 60 + slotEndMins;
			const aptTime = hours * 60 + minutes;

			return aptTime >= slotStart && aptTime < slotEnd;
		});

		if (!hasSlot) {
			setConflict({
				hasConflict: true,
				conflictingAppointments: [{
					id: 'slot',
					reason: 'Therapist has no available slot for this time',
				}],
			});
			return;
		}

		// Debounce conflict check
		const timeoutId = setTimeout(async () => {
			setCheckingConflict(true);
			try {
				const conflictResult = checkAppointmentConflict(
					allAppointments,
					{
						id: appointment.id,
						doctor: therapistName,
						date: appointment.date,
						time: appointment.time,
					},
					30
				);
				setConflict(conflictResult);
			} catch (error) {
				console.error('Error checking conflict:', error);
				setConflict({ hasConflict: false, conflictingAppointments: [] });
			} finally {
				setCheckingConflict(false);
			}
		}, 500);

		return () => clearTimeout(timeoutId);
	}, [selectedTherapistId, appointment, allAppointments, staff, isOpen]);

	useEffect(() => {
		if (isOpen && appointment) {
			setSelectedTherapistId('');
			setConflict(null);
		}
	}, [isOpen, appointment]);

	if (!isOpen || !appointment) return null;

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		
		if (!selectedTherapistId) {
			alert('Please select a therapist to transfer to.');
			return;
		}

		const selectedStaff = staff.find(s => s.id === selectedTherapistId);
		if (!selectedStaff) {
			alert('Selected therapist not found. Please try again.');
			return;
		}

		if (conflict?.hasConflict) {
			alert('Cannot transfer: There is a conflict with the target therapist\'s schedule. Please choose a different therapist.');
			return;
		}

		setTransferring(true);
		try {
			const therapistName = selectedStaff.userName || selectedStaff.name;
			await onConfirm(selectedTherapistId, therapistName);
			onClose();
		} catch (error) {
			console.error('Failed to transfer session:', error);
			alert('Failed to transfer session. Please try again.');
		} finally {
			setTransferring(false);
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
			<div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-xl font-semibold text-slate-900">Transfer Session</h2>
					<button
						type="button"
						onClick={onClose}
						className="text-slate-400 hover:text-slate-600"
						aria-label="Close"
						disabled={transferring}
					>
						<i className="fas fa-times" />
					</button>
				</div>

				<div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
					<p className="text-sm font-medium text-slate-700">Patient: {appointment.patient}</p>
					{appointment.patientId && (
						<p className="text-sm text-slate-600">Patient ID: {appointment.patientId}</p>
					)}
					<p className="text-sm text-slate-600">Current Therapist: {appointment.doctor}</p>
					<p className="text-sm text-slate-600">
						Date: {appointment.date} at {appointment.time}
					</p>
				</div>

				<form onSubmit={handleSubmit} className="space-y-4">
					<div>
						<label className="block text-sm font-medium text-slate-700 mb-1">
							Transfer to Therapist <span className="text-rose-500">*</span>
						</label>
						<select
							value={selectedTherapistId}
							onChange={e => setSelectedTherapistId(e.target.value)}
							required
							disabled={transferring}
							className="input-base disabled:opacity-50 disabled:cursor-not-allowed"
						>
							<option value="">Select a therapist...</option>
							{availableStaff.map(therapist => (
								<option key={therapist.id} value={therapist.id}>
									{therapist.userName || therapist.name} ({therapist.role})
								</option>
							))}
						</select>
						{availableStaff.length === 0 && staff.length > 0 && (
							<p className="mt-2 text-sm text-amber-600">
								No available therapists found. You may be the only clinical team member, or all other therapists have been filtered out.
							</p>
						)}
						{staff.length === 0 && (
							<p className="mt-2 text-sm text-slate-500">
								Loading therapists...
							</p>
						)}
					</div>

					{checkingConflict && (
						<div className="text-sm text-slate-500">
							<i className="fas fa-spinner fa-spin mr-2" />
							Checking availability...
						</div>
					)}

					{conflict?.hasConflict && (
						<div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
							<p className="text-sm font-medium text-rose-700 mb-2">
								<i className="fas fa-exclamation-triangle mr-2" />
								Conflict detected!
							</p>
							<ul className="text-xs text-rose-600 space-y-1">
								{conflict.conflictingAppointments.map((conf, idx) => (
									<li key={conf.id || idx}>
										{conf.reason || `${conf.patient || 'Appointment'} - ${conf.date || ''} at ${conf.time || ''}`}
									</li>
								))}
							</ul>
						</div>
					)}

					{conflict && !conflict.hasConflict && selectedTherapistId && (
						<div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
							<i className="fas fa-check-circle mr-2" />
							Therapist is available for this time slot
						</div>
					)}

					<div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
						<i className="fas fa-info-circle mr-2" />
						<strong>Note:</strong> The patient reports will remain accessible to both you and the new therapist.
					</div>

					<div className="flex gap-3 justify-end">
						<button
							type="button"
							onClick={onClose}
							disabled={transferring}
							className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={transferring || conflict?.hasConflict || checkingConflict || !selectedTherapistId}
							className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
						>
							{transferring ? (
								<>
									<i className="fas fa-spinner fa-spin mr-2" />
									Transferring...
								</>
							) : (
								<>
									<i className="fas fa-exchange-alt mr-2" />
									Transfer Session
								</>
							)}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}

