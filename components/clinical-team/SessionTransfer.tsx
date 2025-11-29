'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, updateDoc, getDoc, getDocs, serverTimestamp, query, where, type QuerySnapshot, type Timestamp } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/PageHeader';
import type { AdminAppointmentStatus } from '@/lib/adminMockData';
import { checkAppointmentConflict } from '@/lib/appointmentUtils';

interface Appointment {
	id: string;
	appointmentId: string;
	patientId: string;
	patient: string;
	doctor: string;
	date: string;
	time: string;
	status: AdminAppointmentStatus;
	notes?: string;
}

interface StaffMember {
	id: string;
	userName: string;
	role: string;
	status: string;
	userEmail?: string;
	dateSpecificAvailability?: Record<string, { enabled: boolean; slots: Array<{ start: string; end: string }> }>;
}

interface PatientRecord {
	id: string;
	patientId: string;
	name: string;
	assignedDoctor?: string;
}

function normalize(value?: string | null): string {
	if (!value) return '';
	return value.trim().toLowerCase();
}

export default function SessionTransfer() {
	const { user } = useAuth();
	const [appointments, setAppointments] = useState<Appointment[]>([]);
	const [patients, setPatients] = useState<PatientRecord[]>([]);
	const [staff, setStaff] = useState<StaffMember[]>([]);
	const [loading, setLoading] = useState(true);
	const [searchTerm, setSearchTerm] = useState('');
	const [statusFilter, setStatusFilter] = useState<'all' | AdminAppointmentStatus>('all');
	const [selectedAppointments, setSelectedAppointments] = useState<Set<string>>(new Set());
	const [transferringTo, setTransferringTo] = useState<string>('');
	const [transferring, setTransferring] = useState<Record<string, boolean>>({});
	const [successMessage, setSuccessMessage] = useState<string | null>(null);
	const [showConfirmationModal, setShowConfirmationModal] = useState(false);
	const [slotModifications, setSlotModifications] = useState<Record<string, { date: string; time: string }>>({});
	const [showSlotModal, setShowSlotModal] = useState(false);

	const clinicianName = useMemo(() => normalize(user?.displayName ?? ''), [user?.displayName]);

	// Get current staff member
	const currentStaff = useMemo(() => {
		return staff.find(s => normalize(s.userName) === clinicianName);
	}, [staff, clinicianName]);

	// Load appointments from Firestore
	useEffect(() => {
		const unsubscribe = onSnapshot(
			collection(db, 'appointments'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data() as Record<string, unknown>;
					const created = (data.createdAt as Timestamp | undefined)?.toDate?.();
					return {
						id: docSnap.id,
						appointmentId: data.appointmentId ? String(data.appointmentId) : '',
						patientId: data.patientId ? String(data.patientId) : '',
						patient: data.patient ? String(data.patient) : '',
						doctor: data.doctor ? String(data.doctor) : '',
						date: data.date ? String(data.date) : '',
						time: data.time ? String(data.time) : '',
						status: (data.status as AdminAppointmentStatus) ?? 'pending',
						notes: data.notes ? String(data.notes) : undefined,
						createdAt: created ? created.toISOString() : (data.createdAt as string | undefined) || new Date().toISOString(),
					} as Appointment;
				});
				setAppointments(mapped);
				setLoading(false);
			},
			error => {
				console.error('Failed to load appointments', error);
				setAppointments([]);
				setLoading(false);
			}
		);

		return () => unsubscribe();
	}, []);

	// Load patients from Firestore
	useEffect(() => {
		const unsubscribe = onSnapshot(
			collection(db, 'patients'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data() as Record<string, unknown>;
					return {
						id: docSnap.id,
						patientId: data.patientId ? String(data.patientId) : '',
						name: data.name ? String(data.name) : '',
						assignedDoctor: data.assignedDoctor ? String(data.assignedDoctor) : undefined,
					} as PatientRecord;
				});
				setPatients(mapped);
			},
			error => {
				console.error('Failed to load patients', error);
				setPatients([]);
			}
		);

		return () => unsubscribe();
	}, []);

	// Load staff from Firestore
	useEffect(() => {
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
						dateSpecificAvailability: data.dateSpecificAvailability as StaffMember['dateSpecificAvailability'],
					} as StaffMember;
				});
				// Only include clinical roles (exclude FrontDesk and Admin), and exclude current user
				setStaff(mapped.filter(s => 
					s.status === 'Active' && 
					['Physiotherapist', 'StrengthAndConditioning', 'ClinicalTeam'].includes(s.role) &&
					normalize(s.userName) !== clinicianName
				));
			},
			error => {
				console.error('Failed to load staff', error);
				setStaff([]);
			}
		);

		return () => unsubscribe();
	}, [clinicianName]);

	// Filter appointments: only show appointments assigned to current clinician
	const filteredAppointments = useMemo(() => {
		// First filter by assigned doctor (only show appointments assigned to current clinician)
		let assignedAppointments: Appointment[] = [];
		if (clinicianName) {
			assignedAppointments = appointments.filter(appointment => 
				normalize(appointment.doctor) === clinicianName
			);
		}

		// Then apply filters
		const query = searchTerm.trim().toLowerCase();
		return assignedAppointments.filter(appointment => {
			const matchesSearch =
				!query ||
				appointment.patient.toLowerCase().includes(query) ||
				appointment.patientId.toLowerCase().includes(query) ||
				appointment.appointmentId.toLowerCase().includes(query);
			const matchesStatus = statusFilter === 'all' || appointment.status === statusFilter;

			return matchesSearch && matchesStatus;
		});
	}, [appointments, searchTerm, statusFilter, clinicianName]);

	// Get selected appointments data
	const selectedAppointmentsData = useMemo(() => {
		return filteredAppointments.filter(apt => selectedAppointments.has(apt.id));
	}, [filteredAppointments, selectedAppointments]);

	// Helper to format date as YYYY-MM-DD
	const formatDateKey = (dateString: string): string => {
		if (!dateString) return '';
		const date = new Date(dateString + 'T00:00:00');
		if (Number.isNaN(date.getTime())) return dateString;
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	};

	// Check availability for selected appointments with target therapist
	const availabilityCheck = useMemo(() => {
		if (!transferringTo || selectedAppointmentsData.length === 0) {
			return { hasConflicts: false, conflicts: [] };
		}

		const targetStaff = staff.find(s => s.id === transferringTo);
		if (!targetStaff) {
			return { hasConflicts: false, conflicts: [] };
		}

		const conflicts: Array<{ appointmentId: string; date: string; time: string; reason: string }> = [];

		// Check each selected appointment for conflicts
		selectedAppointmentsData.forEach(appointment => {
			const dateKey = formatDateKey(appointment.date);
			const dateAvailability = targetStaff.dateSpecificAvailability?.[dateKey];

			// Check if therapist has availability for this date
			if (!dateAvailability || !dateAvailability.enabled) {
				conflicts.push({
					appointmentId: appointment.appointmentId,
					date: appointment.date,
					time: appointment.time,
					reason: 'Therapist has no availability for this date',
				});
				return;
			}

			// Check if therapist has a slot for this time
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
				conflicts.push({
					appointmentId: appointment.appointmentId,
					date: appointment.date,
					time: appointment.time,
					reason: 'Therapist has no available slot for this time',
				});
				return;
			}

			// Check for conflicts with existing appointments
			const existingAppointments = appointments.filter(
				apt => apt.doctor === targetStaff.userName && apt.date === appointment.date && apt.status !== 'cancelled'
			);

			const conflictResult = checkAppointmentConflict(
				appointments.map(a => ({
					id: a.id,
					appointmentId: a.appointmentId,
					patient: a.patient,
					doctor: a.doctor,
					date: a.date,
					time: a.time,
					status: a.status
				})),
				{
					id: appointment.id,
					doctor: targetStaff.userName,
					date: appointment.date,
					time: appointment.time
				}
			);
			const timeConflict = conflictResult.hasConflict && conflictResult.conflictingAppointments?.some(
				conf => conf.appointmentId === appointment.appointmentId
			);

			if (timeConflict) {
				conflicts.push({
					appointmentId: appointment.appointmentId,
					date: appointment.date,
					time: appointment.time,
					reason: 'Therapist already has an appointment at this time',
				});
			}
		});

		return {
			hasConflicts: conflicts.length > 0,
			conflicts,
		};
	}, [transferringTo, selectedAppointmentsData, staff, appointments]);

	const handleSelectAppointment = (appointmentId: string) => {
		setSelectedAppointments(prev => {
			const newSet = new Set(prev);
			if (newSet.has(appointmentId)) {
				newSet.delete(appointmentId);
			} else {
				newSet.add(appointmentId);
			}
			return newSet;
		});
	};

	const handleSelectAll = () => {
		if (selectedAppointments.size === filteredAppointments.length) {
			setSelectedAppointments(new Set());
		} else {
			setSelectedAppointments(new Set(filteredAppointments.map(apt => apt.id)));
		}
	};

	// Get available slots for target therapist on a specific date
	const getAvailableSlots = (therapist: StaffMember, date: string): string[] => {
		const dateKey = formatDateKey(date);
		const dateAvailability = therapist.dateSpecificAvailability?.[dateKey];
		
		if (!dateAvailability || !dateAvailability.enabled || !dateAvailability.slots || dateAvailability.slots.length === 0) {
			return [];
		}

		// Get all booked appointments for this therapist and date
		const bookedSlots = appointments
			.filter(apt => apt.doctor === therapist.userName && apt.date === date && apt.status !== 'cancelled')
			.map(apt => {
				const mod = slotModifications[apt.id];
				return mod ? mod.time : apt.time;
			});

		// Generate 30-minute slots from availability ranges
		const slots: string[] = [];
		
		dateAvailability.slots.forEach(slot => {
			if (!slot.start || !slot.end) return;

			const [startHour, startMin] = slot.start.split(':').map(Number);
			const [endHour, endMin] = slot.end.split(':').map(Number);

			if (isNaN(startHour) || isNaN(startMin) || isNaN(endHour) || isNaN(endMin)) return;

			const startTime = new Date();
			startTime.setHours(startHour, startMin, 0, 0);
			const endTime = new Date();
			endTime.setHours(endHour, endMin, 0, 0);

			if (endTime < startTime) {
				endTime.setDate(endTime.getDate() + 1);
			}

			let currentTime = new Date(startTime);
			while (currentTime < endTime) {
				const timeString = `${String(currentTime.getHours()).padStart(2, '0')}:${String(currentTime.getMinutes()).padStart(2, '0')}`;
				
				// Skip if already booked
				if (!bookedSlots.includes(timeString)) {
					slots.push(timeString);
				}

				currentTime.setMinutes(currentTime.getMinutes() + 30);
			}
		});

		return [...new Set(slots)].sort();
	};

	const handleInitiateTransfer = () => {
		if (selectedAppointmentsData.length === 0) {
			alert('Please select at least one appointment to transfer.');
			return;
		}

		if (!transferringTo) {
			alert('Please select a therapist to transfer to.');
			return;
		}

		const targetStaff = staff.find(s => s.id === transferringTo);
		if (!targetStaff) {
			alert('Target therapist not found. Please try again.');
			return;
		}

		// Check if any appointments need slot modifications
		const needsSlotModification = availabilityCheck.conflicts.some(c => 
			c.reason.includes('no available slot') || c.reason.includes('already has an appointment')
		);

		if (needsSlotModification) {
			setShowSlotModal(true);
		} else {
			setShowConfirmationModal(true);
		}
	};

	const handleSlotModification = (appointmentId: string, date: string, newTime: string) => {
		setSlotModifications(prev => ({
			...prev,
			[appointmentId]: { date, time: newTime },
		}));
	};

	const handleConfirmSlotModifications = () => {
		setShowSlotModal(false);
		setShowConfirmationModal(true);
	};

	const handleTransfer = async () => {
		const targetStaff = staff.find(s => s.id === transferringTo);
		if (!targetStaff) {
			alert('Target therapist not found. Please try again.');
			return;
		}

		setShowConfirmationModal(false);

		// Start transferring
		const appointmentIds = selectedAppointmentsData.map(apt => apt.id);
		appointmentIds.forEach(id => {
			setTransferring(prev => ({ ...prev, [id]: true }));
		});

		try {
			// Group appointments by patient
			const appointmentsByPatient = new Map<string, Appointment[]>();
			selectedAppointmentsData.forEach(apt => {
				if (!appointmentsByPatient.has(apt.patientId)) {
					appointmentsByPatient.set(apt.patientId, []);
				}
				appointmentsByPatient.get(apt.patientId)!.push(apt);
			});

			// Update each appointment's doctor field and time (if modified)
			const updatePromises = selectedAppointmentsData.map(appointment => {
				const aptRef = doc(db, 'appointments', appointment.id);
				const slotMod = slotModifications[appointment.id];
				const updateData: Record<string, any> = {
					doctor: targetStaff.userName,
					staffId: targetStaff.id,
					transferredAt: serverTimestamp(),
					transferredFrom: appointment.doctor,
				};
				
				if (slotMod) {
					updateData.date = slotMod.date;
					updateData.time = slotMod.time;
				}

				return updateDoc(aptRef, updateData);
			});

			await Promise.allSettled(updatePromises);

			// Update patient records to maintain report access for both therapists
			const patientUpdatePromises: Promise<void>[] = [];
			
			for (const [patientId, transferredAppointments] of appointmentsByPatient.entries()) {
				const patient = patients.find(p => p.patientId === patientId);
				if (!patient) continue;

				const patientRef = doc(db, 'patients', patient.id);
				
				// Get original assigned doctor
				const originalDoctor = patient.assignedDoctor || transferredAppointments[0].doctor;
				
				// Get existing report access doctors or initialize with original doctor
				const existingPatientDoc = await getDoc(patientRef);
				const existingReportAccess = existingPatientDoc.data()?.reportAccessDoctors || [];
				const reportAccessSet = new Set(existingReportAccess);
				
				// Add both original and new therapist to report access
				if (originalDoctor) {
					reportAccessSet.add(originalDoctor);
				}
				reportAccessSet.add(targetStaff.userName);
				
				// Update patient record with report access doctors
				patientUpdatePromises.push(
					updateDoc(patientRef, {
						reportAccessDoctors: Array.from(reportAccessSet),
						transferredAt: serverTimestamp(),
					}).then(() => {})
				);
			}

			await Promise.allSettled(patientUpdatePromises);

			// Update target therapist's availability to include these appointment slots
			if (targetStaff.dateSpecificAvailability) {
				const updatedAvailability = { ...targetStaff.dateSpecificAvailability };

				// Group appointments by date (using modified dates if available)
				const appointmentsByDate = new Map<string, Appointment[]>();
				selectedAppointmentsData.forEach(apt => {
					const slotMod = slotModifications[apt.id];
					const date = slotMod ? slotMod.date : apt.date;
					const dateKey = formatDateKey(date);
					if (!appointmentsByDate.has(dateKey)) {
						appointmentsByDate.set(dateKey, []);
					}
					appointmentsByDate.get(dateKey)!.push(apt);
				});

				// Add slots for each date
				for (const [dateKey, dateAppointments] of appointmentsByDate.entries()) {
					const existingSchedule = updatedAvailability[dateKey];

					const newSlots = dateAppointments.map(apt => {
						const slotMod = slotModifications[apt.id];
						const time = slotMod ? slotMod.time : apt.time;
						const [hours, minutes] = time.split(':').map(Number);
						const startTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
						const endMinutes = minutes + 30;
						const endHours = hours + Math.floor(endMinutes / 60);
						const finalEndMinutes = endMinutes % 60;
						const endTime = `${String(endHours).padStart(2, '0')}:${String(finalEndMinutes).padStart(2, '0')}`;
						return { start: startTime, end: endTime };
					});

					if (!existingSchedule || !existingSchedule.enabled) {
						updatedAvailability[dateKey] = {
							enabled: true,
							slots: newSlots,
						};
					} else {
						// Merge with existing slots
						const existingSlots = existingSchedule.slots || [];
						const allSlots = [...existingSlots];
						
						newSlots.forEach(newSlot => {
							const exists = allSlots.some(existing => 
								existing.start === newSlot.start && existing.end === newSlot.end
							);
							if (!exists) {
								allSlots.push(newSlot);
							}
						});

						// Sort slots by start time
						allSlots.sort((a, b) => {
							const [aHours, aMins] = a.start.split(':').map(Number);
							const [bHours, bMins] = b.start.split(':').map(Number);
							return (aHours * 60 + aMins) - (bHours * 60 + bMins);
						});

						updatedAvailability[dateKey] = {
							enabled: true,
							slots: allSlots,
						};
					}
				}

				// Update therapist availability
				const therapistRef = doc(db, 'staff', targetStaff.id);
				await updateDoc(therapistRef, {
					dateSpecificAvailability: updatedAvailability,
					availabilityUpdatedAt: serverTimestamp(),
				});
			}

			setSuccessMessage(`Successfully transferred ${selectedAppointmentsData.length} appointment(s) to ${targetStaff.userName}`);
			setTimeout(() => setSuccessMessage(null), 5000);

			// Clear selection and modifications
			setSelectedAppointments(new Set());
			setTransferringTo('');
			setSlotModifications({});
		} catch (error) {
			console.error('Failed to transfer appointments', error);
			alert(`Failed to transfer appointments: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			appointmentIds.forEach(id => {
				setTransferring(prev => ({ ...prev, [id]: false }));
			});
		}
	};

	const getPatientName = (patientId: string): string => {
		const patient = patients.find(p => p.patientId === patientId);
		return patient?.name || patientId;
	};

	const formatDate = (dateString: string): string => {
		if (!dateString) return '—';
		const date = new Date(dateString + 'T00:00:00');
		if (Number.isNaN(date.getTime())) return dateString;
		return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
	};

	if (loading) {
		return (
			<div className="min-h-svh bg-slate-50 px-6 py-10">
				<div className="mx-auto max-w-6xl">
					<div className="flex items-center justify-center py-20">
						<div className="text-center">
							<div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-sky-600 border-r-transparent"></div>
							<p className="text-sm text-slate-600">Loading appointments...</p>
						</div>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-svh bg-slate-50 px-6 py-10">
			<div className="mx-auto max-w-6xl space-y-6">
				<PageHeader
					title="Transfer Sessions"
					description="Transfer appointments (sessions) to other clinical team members based on availability"
				/>

				{successMessage && (
					<div className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
						<i className="fas fa-check-circle mr-2" aria-hidden="true" />
						{successMessage}
					</div>
				)}

				{/* Transfer Controls */}
				<div className="section-card">
					<div className="mb-6 flex items-center justify-between">
						<div>
							<h2 className="text-lg font-semibold text-slate-900">Select Appointments to Transfer</h2>
							<p className="mt-1 text-sm text-slate-600">
								Select one or more appointments from your schedule to transfer to another therapist
							</p>
						</div>
						<div className="flex items-center gap-4">
							{selectedAppointments.size > 0 && (
								<div className="text-sm text-slate-600">
									{selectedAppointments.size} appointment{selectedAppointments.size !== 1 ? 's' : ''} selected
								</div>
							)}
							<select
								value={transferringTo}
								onChange={e => setTransferringTo(e.target.value)}
								disabled={selectedAppointments.size === 0}
								className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:opacity-50 disabled:cursor-not-allowed"
							>
								<option value="">Select therapist...</option>
								{staff.map(therapist => (
									<option key={therapist.id} value={therapist.id}>
										{therapist.userName} ({therapist.role})
									</option>
								))}
							</select>
							{selectedAppointments.size > 0 && transferringTo && (
								<button
									type="button"
									onClick={handleInitiateTransfer}
									disabled={Object.values(transferring).some(v => v)}
									className="inline-flex items-center rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
								>
									<i className="fas fa-exchange-alt mr-2" aria-hidden="true" />
									Transfer Selected
								</button>
							)}
						</div>
					</div>

					{availabilityCheck.hasConflicts && (
						<div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
							<i className="fas fa-exclamation-triangle mr-2" aria-hidden="true" />
							<strong>Conflicts detected:</strong>
							<ul className="mt-2 ml-6 list-disc">
								{availabilityCheck.conflicts.map((conflict, idx) => (
									<li key={idx}>
										{conflict.date} at {conflict.time} ({conflict.appointmentId}): {conflict.reason}
									</li>
								))}
							</ul>
						</div>
					)}

					{/* Filters */}
					<div className="mb-6 flex flex-wrap items-center gap-4">
						<div className="flex-1 min-w-[200px]">
							<input
								type="text"
								value={searchTerm}
								onChange={e => setSearchTerm(e.target.value)}
								placeholder="Search by patient name, ID, or appointment ID..."
								className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-900 placeholder-slate-400 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
							/>
						</div>
						<select
							value={statusFilter}
							onChange={e => setStatusFilter(e.target.value as 'all' | AdminAppointmentStatus)}
							className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
						>
							<option value="all">All Status</option>
							<option value="pending">Pending</option>
							<option value="ongoing">Ongoing</option>
							<option value="completed">Completed</option>
							<option value="cancelled">Cancelled</option>
						</select>
					</div>

					{/* Appointments Table */}
					<div className="overflow-x-auto">
						<table className="min-w-full divide-y divide-slate-200 text-left text-sm text-slate-700">
							<thead className="bg-slate-900 text-xs uppercase tracking-wide text-white">
								<tr>
									<th className="px-4 py-3 font-semibold">
										<input
											type="checkbox"
											checked={filteredAppointments.length > 0 && selectedAppointments.size === filteredAppointments.length}
											onChange={handleSelectAll}
											className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-200"
										/>
									</th>
									<th className="px-4 py-3 font-semibold">Appointment ID</th>
									<th className="px-4 py-3 font-semibold">Patient</th>
									<th className="px-4 py-3 font-semibold">Patient ID</th>
									<th className="px-4 py-3 font-semibold">Date</th>
									<th className="px-4 py-3 font-semibold">Time</th>
									<th className="px-4 py-3 font-semibold">Status</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100 bg-white">
								{filteredAppointments.length === 0 ? (
									<tr>
										<td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
											No appointments found
										</td>
									</tr>
								) : (
									filteredAppointments.map(appointment => (
										<tr
											key={appointment.id}
											className={`transition hover:bg-slate-50 ${
												selectedAppointments.has(appointment.id) ? 'bg-sky-50' : ''
											}`}
										>
											<td className="px-4 py-3">
												<input
													type="checkbox"
													checked={selectedAppointments.has(appointment.id)}
													onChange={() => handleSelectAppointment(appointment.id)}
													disabled={transferring[appointment.id]}
													className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-200 disabled:opacity-50"
												/>
											</td>
											<td className="px-4 py-3 font-medium text-slate-900">{appointment.appointmentId}</td>
											<td className="px-4 py-3 text-slate-700">{appointment.patient}</td>
											<td className="px-4 py-3 text-slate-600">{appointment.patientId}</td>
											<td className="px-4 py-3 text-slate-700">{formatDate(appointment.date)}</td>
											<td className="px-4 py-3 text-slate-700">{appointment.time}</td>
											<td className="px-4 py-3">
												<span className={`status-badge ${appointment.status === 'pending' ? 'status-badge-pending' : appointment.status === 'ongoing' ? 'status-badge-ongoing' : appointment.status === 'completed' ? 'status-badge-completed' : 'status-badge-cancelled'}`}>
													{appointment.status}
												</span>
											</td>
										</tr>
									))
								)}
							</tbody>
						</table>
					</div>
				</div>

				{/* Slot Modification Modal */}
				{showSlotModal && transferringTo && (
					<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
						<div className="w-full max-w-4xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
							<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
								<h2 className="text-lg font-semibold text-slate-900">Modify Appointment Slots</h2>
								<button
									type="button"
									onClick={() => setShowSlotModal(false)}
									className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
								>
									<i className="fas fa-times" aria-hidden="true" />
								</button>
							</header>
							<div className="max-h-[600px] overflow-y-auto px-6 py-6">
								<p className="mb-4 text-sm text-slate-600">
									Some appointments need slot modifications. Please select new time slots for appointments with conflicts:
								</p>
								<div className="space-y-4">
									{selectedAppointmentsData
										.filter(apt => {
											const conflict = availabilityCheck.conflicts.find(c => c.appointmentId === apt.appointmentId);
											return conflict && (conflict.reason.includes('no available slot') || conflict.reason.includes('already has an appointment'));
										})
										.map(appointment => {
											const targetStaff = staff.find(s => s.id === transferringTo);
											if (!targetStaff) return null;
											
											const availableSlots = getAvailableSlots(targetStaff, appointment.date);
											const currentMod = slotModifications[appointment.id];
											const selectedTime = currentMod ? currentMod.time : appointment.time;

											return (
												<div key={appointment.id} className="rounded-lg border border-slate-200 p-4">
													<div className="mb-3">
														<div className="font-medium text-slate-900">{appointment.patient} ({appointment.patientId})</div>
														<div className="text-sm text-slate-600">
															{appointment.appointmentId} - {formatDate(appointment.date)} at {appointment.time}
														</div>
													</div>
													<div>
														<label className="mb-2 block text-sm font-medium text-slate-700">Select New Time Slot:</label>
														{availableSlots.length === 0 ? (
															<p className="text-sm text-amber-600">No available slots for this date. Please select a different date or therapist.</p>
														) : (
															<select
																value={selectedTime}
																onChange={e => handleSlotModification(appointment.id, appointment.date, e.target.value)}
																className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
															>
																{availableSlots.map(slot => (
																	<option key={slot} value={slot}>
																		{slot}
																	</option>
																))}
															</select>
														)}
													</div>
												</div>
											);
										})}
								</div>
							</div>
							<footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
								<button
									type="button"
									onClick={() => setShowSlotModal(false)}
									className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={handleConfirmSlotModifications}
									className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700"
								>
									Continue to Confirmation
								</button>
							</footer>
						</div>
					</div>
				)}

				{/* Confirmation Modal */}
				{showConfirmationModal && transferringTo && (
					<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
						<div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
							<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
								<h2 className="text-lg font-semibold text-slate-900">Confirm Session Transfer</h2>
								<button
									type="button"
									onClick={() => setShowConfirmationModal(false)}
									className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
								>
									<i className="fas fa-times" aria-hidden="true" />
								</button>
							</header>
							<div className="max-h-[600px] overflow-y-auto px-6 py-6">
								<div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
									<i className="fas fa-exclamation-triangle mr-2" aria-hidden="true" />
									<strong>Please confirm the transfer details:</strong>
									<p className="mt-2">By transferring these sessions, you are requesting permission to transfer the appointments. The patient reports will remain accessible to both you and the new therapist.</p>
								</div>
								
								<div className="mb-4">
									<div className="mb-2 text-sm font-medium text-slate-700">Transferring to:</div>
									<div className="text-lg font-semibold text-slate-900">
										{staff.find(s => s.id === transferringTo)?.userName}
									</div>
								</div>

								<div className="mb-4">
									<div className="mb-2 text-sm font-medium text-slate-700">Appointments to transfer:</div>
									<div className="space-y-2">
										{selectedAppointmentsData.map(appointment => {
											const slotMod = slotModifications[appointment.id];
											return (
												<div key={appointment.id} className="rounded-lg border border-slate-200 p-3 text-sm">
													<div className="font-medium text-slate-900">{appointment.patient} ({appointment.patientId})</div>
													<div className="text-slate-600">
														{appointment.appointmentId} - {formatDate(slotMod ? slotMod.date : appointment.date)} at {slotMod ? slotMod.time : appointment.time}
														{slotMod && <span className="ml-2 text-amber-600">(Modified)</span>}
													</div>
												</div>
											);
										})}
									</div>
								</div>

								{availabilityCheck.hasConflicts && availabilityCheck.conflicts.filter(c => !c.reason.includes('no available slot') && !c.reason.includes('already has an appointment')).length > 0 && (
									<div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
										<strong>Warnings:</strong>
										<ul className="mt-2 ml-6 list-disc">
											{availabilityCheck.conflicts
												.filter(c => !c.reason.includes('no available slot') && !c.reason.includes('already has an appointment'))
												.map((conflict, idx) => (
													<li key={idx}>
														{conflict.date} at {conflict.time} ({conflict.appointmentId}): {conflict.reason}
													</li>
												))}
										</ul>
									</div>
								)}
							</div>
							<footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
								<button
									type="button"
									onClick={() => setShowConfirmationModal(false)}
									className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={handleTransfer}
									disabled={Object.values(transferring).some(v => v)}
									className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed"
								>
									{Object.values(transferring).some(v => v) ? (
										<>
											<div className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
											Transferring...
										</>
									) : (
										<>
											<i className="fas fa-check mr-2" aria-hidden="true" />
											Confirm Transfer
										</>
									)}
								</button>
							</footer>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

