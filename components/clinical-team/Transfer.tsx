'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, updateDoc, addDoc, getDoc, getDocs, serverTimestamp, Timestamp, query, where, orderBy, type QuerySnapshot } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/PageHeader';
import type { AdminPatientStatus } from '@/lib/adminMockData';
import TransferConfirmationDialog from '@/components/transfers/TransferConfirmationDialog';
import type { PatientRecordTransfer } from '@/lib/types';

interface Therapist {
	id: string;
	name: string;
	role: string;
	email?: string;
	phone?: string;
	dateSpecificAvailability?: Record<string, { enabled: boolean; slots: Array<{ start: string; end: string }> }>;
}

interface TransferHistory {
	id?: string;
	patientId: string;
	patientName: string;
	fromTherapist?: string;
	toTherapist: string;
	transferredBy?: string;
	transferredAt: Timestamp | string;
	reason?: string;
}

interface TransferRequest {
	id?: string;
	patientId: string;
	patientName: string;
	patientDocumentId: string;
	fromTherapist?: string;
	fromTherapistId?: string;
	toTherapist: string;
	toTherapistId: string;
	requestedBy?: string;
	requestedById?: string;
	status: 'pending' | 'accepted' | 'rejected';
	requestedAt: Timestamp | string;
	respondedAt?: Timestamp | string;
	reason?: string;
}

interface AppointmentConflict {
	appointmentId: string;
	date: string;
	time: string;
	conflictReason: 'no_availability' | 'slot_unavailable' | 'already_booked';
}

interface ConfirmationState {
	isOpen: boolean;
	patient: PatientRecordTransfer | null;
	newTherapist: string;
	availabilityCheck?: {
		appointments: Array<{ id: string; date: string; time: string; status: string; duration?: number }>;
		conflicts: AppointmentConflict[];
		hasConflicts: boolean;
	};
}

const STATUS_BADGES: Record<AdminPatientStatus, string> = {
	pending: 'status-badge-pending',
	ongoing: 'status-badge-ongoing',
	completed: 'status-badge-completed',
	cancelled: 'status-badge-cancelled',
};

const STATUS_OPTIONS: Array<{ value: AdminPatientStatus; label: string }> = [
	{ value: 'pending', label: 'Pending' },
	{ value: 'ongoing', label: 'Ongoing' },
	{ value: 'completed', label: 'Completed' },
	{ value: 'cancelled', label: 'Cancelled' },
];

function normalize(value?: string | null) {
	return value?.trim().toLowerCase() ?? '';
}

const DEFAULT_APPOINTMENT_DURATION_MINUTES = 30;

function parseDurationMinutes(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
		return value;
	}
	if (typeof value === 'string') {
		const parsed = Number(value);
		if (Number.isFinite(parsed) && parsed > 0) {
			return parsed;
		}
	}
	return undefined;
}

function resolveDurationMinutes(duration?: number): number {
	return typeof duration === 'number' && Number.isFinite(duration) && duration > 0
		? duration
		: DEFAULT_APPOINTMENT_DURATION_MINUTES;
}

function formatMinutesToTime(totalMinutes: number): string {
	const normalized =
		((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
	const hours = Math.floor(normalized / 60);
	const minutes = normalized % 60;
	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatDateLabel(date: Date | Timestamp | string): string {
	let dateObj: Date;
	if (date instanceof Timestamp) {
		dateObj = date.toDate();
	} else if (typeof date === 'string') {
		dateObj = new Date(date);
	} else {
		dateObj = date;
	}
	if (Number.isNaN(dateObj.getTime())) return '—';
	return new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC',
	}).format(dateObj);
}

export default function Transfer() {
	const { user } = useAuth();
	const [patients, setPatients] = useState<PatientRecordTransfer[]>([]);
	const [therapists, setTherapists] = useState<Therapist[]>([]);
	const [loading, setLoading] = useState(true);
	const [searchTerm, setSearchTerm] = useState('');
	const [statusFilter, setStatusFilter] = useState<AdminPatientStatus | 'all'>('all');
	const [transferring, setTransferring] = useState<Record<string, boolean>>({});
	const [successMessage, setSuccessMessage] = useState<string | null>(null);
	const [selectedTherapists, setSelectedTherapists] = useState<Record<string, string>>({});
	const [confirmation, setConfirmation] = useState<ConfirmationState>({
		isOpen: false,
		patient: null,
		newTherapist: '',
	});
	const [transferHistory, setTransferHistory] = useState<TransferHistory[]>([]);
	const [currentStaffName, setCurrentStaffName] = useState<string | null>(null);
	const [currentStaffId, setCurrentStaffId] = useState<string | null>(null);
	const [pendingRequests, setPendingRequests] = useState<TransferRequest[]>([]);
	const [processingRequest, setProcessingRequest] = useState<Record<string, boolean>>({});
	const [patientAppointments, setPatientAppointments] = useState<
		Record<string, Array<{ id: string; date: string; time: string; status: string; duration?: number }>>
	>({});
	const [appointmentConflicts, setAppointmentConflicts] = useState<Record<string, AppointmentConflict[]>>({});
	const [checkingConflicts, setCheckingConflicts] = useState<Record<string, boolean>>({});
	const [updatingStatus, setUpdatingStatus] = useState<Record<string, boolean>>({});
	const [checkingAvailability, setCheckingAvailability] = useState(false);

	// Load current staff member's userName to match against assignedDoctor
	useEffect(() => {
		if (!user?.email) {
			setCurrentStaffName(null);
			setCurrentStaffId(null);
			return;
		}

		let unsubscribe: (() => void) | null = null;

		const loadStaffDoc = async () => {
			try {
				// First, query for the specific staff document by email
				const staffQuery = query(collection(db, 'staff'), where('userEmail', '==', user.email?.toLowerCase()));
				const querySnapshot = await getDocs(staffQuery);
				
				if (!querySnapshot.empty) {
					const staffDoc = querySnapshot.docs[0];
					const data = staffDoc.data();
					setCurrentStaffName(data.userName ? String(data.userName) : null);
					setCurrentStaffId(staffDoc.id);
					
					// Then set up a real-time listener for this specific staff document
					const staffRef = doc(db, 'staff', staffDoc.id);
					unsubscribe = onSnapshot(
						staffRef,
						(snapshot) => {
							if (snapshot.exists()) {
								const data = snapshot.data();
								setCurrentStaffName(data.userName ? String(data.userName) : null);
								setCurrentStaffId(snapshot.id);
							} else {
								setCurrentStaffName(null);
								setCurrentStaffId(null);
							}
						},
						(error) => {
							console.error('Failed to load staff for current user', error);
							setCurrentStaffName(null);
							setCurrentStaffId(null);
						}
					);
				} else {
					console.warn('No staff document found for user email:', user.email);
					setCurrentStaffName(null);
					setCurrentStaffId(null);
				}
			} catch (error) {
				console.error('Failed to find staff document', error);
				setCurrentStaffName(null);
				setCurrentStaffId(null);
			}
		};

		loadStaffDoc();

		return () => {
			if (unsubscribe) {
				unsubscribe();
			}
		};
	}, [user?.email]);

	const clinicianName = useMemo(() => {
		// Use staff userName if available, otherwise fall back to displayName
		return normalize(currentStaffName ?? user?.displayName ?? '');
	}, [currentStaffName, user?.displayName]);

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
						status: (data.status as AdminPatientStatus) ?? 'pending',
					} as PatientRecordTransfer;
				});
				setPatients([...mapped]);
				
				// Initialize selected therapists with current assignments
				const initialSelections: Record<string, string> = {};
				mapped.forEach(patient => {
					if (patient.assignedDoctor) {
						initialSelections[patient.id] = patient.assignedDoctor;
					}
				});
				setSelectedTherapists(prev => ({ ...prev, ...initialSelections }));
				
				setLoading(false);
			},
			error => {
				console.error('Failed to load patients', error);
				setPatients([]);
				setLoading(false);
			}
		);

		return () => unsubscribe();
	}, []);

	// Load therapists from staff collection
	useEffect(() => {
		const unsubscribe = onSnapshot(
			collection(db, 'staff'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs
					.map(docSnap => {
						const data = docSnap.data();
						return {
							id: docSnap.id,
							name: data.userName as string,
							role: data.role as string,
							status: data.status as string,
							email: data.email as string | undefined,
							phone: data.phone as string | undefined,
							dateSpecificAvailability: data.dateSpecificAvailability as Therapist['dateSpecificAvailability'],
						};
					})
					.filter(
						staff =>
							['Physiotherapist', 'StrengthAndConditioning', 'ClinicalTeam'].includes(staff.role || '') &&
							staff.status === 'Active' &&
							Boolean(staff.name)
					)
					.map(staff => ({
						id: staff.id,
						name: staff.name,
						role: staff.role,
						email: staff.email,
						phone: staff.phone,
						dateSpecificAvailability: staff.dateSpecificAvailability,
					}));

				setTherapists([...mapped]);
			},
			error => {
				console.error('Failed to load staff', error);
				setTherapists([]);
			}
		);

		return () => unsubscribe();
	}, []);

	// Filter therapists to only show those who have at least one patient assigned
	const assignedTherapists = useMemo(() => {
		// Get all unique assigned doctor names from patients
		const assignedDoctorNames = new Set(
			patients
				.map(p => p.assignedDoctor)
				.filter((name): name is string => Boolean(name && name.trim()))
		);

		// Filter therapists to only include those with assigned patients
		return therapists.filter(therapist => 
			assignedDoctorNames.has(therapist.name)
		);
	}, [therapists, patients]);

	const filteredPatients = useMemo(() => {
		// Debug logging in development
		if (process.env.NODE_ENV === 'development') {
			console.log('Transfer - Filtering patients:', {
				totalPatients: patients.length,
				clinicianName,
				currentStaffName,
				userDisplayName: user?.displayName,
				userEmail: user?.email,
				sampleAssignedDoctors: patients.slice(0, 5).map(p => ({
					patientId: p.patientId,
					assignedDoctor: p.assignedDoctor,
					normalized: normalize(p.assignedDoctor)
				}))
			});
		}

		// First filter by assigned doctor (only show patients assigned to current staff member)
		let assignedPatients: PatientRecordTransfer[];
		
		if (!clinicianName) {
			// If no clinician name, show empty (user needs to have displayName set)
			assignedPatients = [];
		} else {
			// Filter by assigned doctor - must match exactly (after normalization)
			assignedPatients = patients.filter(patient => {
				// Show patients assigned to current user
				const normalizedAssigned = normalize(patient.assignedDoctor);
				const isAssignedToMe = normalizedAssigned === clinicianName;
				return isAssignedToMe;
			});
		}

		// Then apply other filters
		const query = searchTerm.trim().toLowerCase();
		return assignedPatients.filter(patient => {
			const matchesSearch =
				!query ||
				patient.name.toLowerCase().includes(query) ||
				patient.patientId.toLowerCase().includes(query);
			const matchesStatus = statusFilter === 'all' || patient.status === statusFilter;

			return matchesSearch && matchesStatus;
		});
	}, [patients, searchTerm, statusFilter, clinicianName, user?.displayName]);

	// Load transfer history
	useEffect(() => {
		const unsubscribe = onSnapshot(
			collection(db, 'transferHistory'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data();
					const transferredAt = data.transferredAt instanceof Timestamp 
						? data.transferredAt.toDate().toISOString() 
						: data.transferredAt || new Date().toISOString();
					return {
						id: docSnap.id,
						patientId: data.patientId ? String(data.patientId) : '',
						patientName: data.patientName ? String(data.patientName) : '',
						fromTherapist: data.fromTherapist ? String(data.fromTherapist) : undefined,
						toTherapist: data.toTherapist ? String(data.toTherapist) : '',
						transferredBy: data.transferredBy ? String(data.transferredBy) : undefined,
						transferredAt,
						reason: data.reason ? String(data.reason) : undefined,
					} as TransferHistory;
				});
				setTransferHistory([...mapped]);
			},
			error => {
				console.error('Failed to load transfer history', error);
			}
		);

		return () => unsubscribe();
	}, []);

	// Load pending transfer requests for current user
	useEffect(() => {
		if (!currentStaffId) {
			setPendingRequests([]);
			return;
		}

		const unsubscribe = onSnapshot(
			query(
				collection(db, 'transferRequests'),
				where('toTherapistId', '==', currentStaffId),
				where('status', '==', 'pending'),
				orderBy('requestedAt', 'desc')
			),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data();
					const requestedAt = data.requestedAt instanceof Timestamp 
						? data.requestedAt.toDate().toISOString() 
						: data.requestedAt || new Date().toISOString();
					const respondedAt = data.respondedAt instanceof Timestamp
						? data.respondedAt.toDate().toISOString()
						: data.respondedAt || undefined;
					return {
						id: docSnap.id,
						patientId: data.patientId ? String(data.patientId) : '',
						patientName: data.patientName ? String(data.patientName) : '',
						patientDocumentId: data.patientDocumentId ? String(data.patientDocumentId) : '',
						fromTherapist: data.fromTherapist ? String(data.fromTherapist) : undefined,
						fromTherapistId: data.fromTherapistId ? String(data.fromTherapistId) : undefined,
						toTherapist: data.toTherapist ? String(data.toTherapist) : '',
						toTherapistId: data.toTherapistId ? String(data.toTherapistId) : '',
						requestedBy: data.requestedBy ? String(data.requestedBy) : undefined,
						requestedById: data.requestedById ? String(data.requestedById) : undefined,
						status: (data.status as 'pending' | 'accepted' | 'rejected') || 'pending',
						requestedAt,
						respondedAt,
						reason: data.reason ? String(data.reason) : undefined,
					} as TransferRequest;
				});
				setPendingRequests([...mapped]);
			},
			error => {
				console.error('Failed to load transfer requests', error);
				setPendingRequests([]);
			}
		);

		return () => unsubscribe();
	}, [currentStaffId]);

	// Load patient appointments and check for conflicts when viewing transfer requests
	const checkAppointmentConflicts = async (request: TransferRequest) => {
		if (checkingConflicts[request.id!]) return;
		
		setCheckingConflicts(prev => ({ ...prev, [request.id!]: true }));

		try {
			// Load patient's upcoming appointments
			const appointmentsQuery = query(
				collection(db, 'appointments'),
				where('patientId', '==', request.patientId),
				where('status', 'in', ['pending', 'ongoing'])
			);
			const appointmentsSnapshot = await getDocs(appointmentsQuery);
			const appointments = appointmentsSnapshot.docs.map(docSnap => {
				const data = docSnap.data();
				const duration = parseDurationMinutes(data.duration ?? data.slotDuration);
				return {
					id: docSnap.id,
					date: data.date as string,
					time: data.time as string,
					status: data.status as string,
					duration,
				};
			});

			setPatientAppointments(prev => ({ ...prev, [request.id!]: appointments }));

			if (appointments.length === 0) {
				setAppointmentConflicts(prev => ({ ...prev, [request.id!]: [] }));
				return;
			}

			// Load new therapist's availability
			const therapistDoc = await getDoc(doc(db, 'staff', request.toTherapistId));
			if (!therapistDoc.exists()) {
				setAppointmentConflicts(prev => ({ ...prev, [request.id!]: [] }));
				return;
			}

			const therapistData = therapistDoc.data();
			const availability = therapistData.dateSpecificAvailability as Record<string, { enabled: boolean; slots: Array<{ start: string; end: string }> }> | undefined;

			// Check each appointment for conflicts
			const conflicts: AppointmentConflict[] = [];

			for (const appointment of appointments) {
				const dateKey = appointment.date; // Already in YYYY-MM-DD format
				const daySchedule = availability?.[dateKey];

				if (!daySchedule || !daySchedule.enabled) {
					conflicts.push({
						appointmentId: appointment.id,
						date: appointment.date,
						time: appointment.time,
						conflictReason: 'no_availability',
					});
					continue;
				}

				// Check if appointment time falls within any available slot
				const [aptHours, aptMinutes] = appointment.time.split(':').map(Number);
				const aptTime = aptHours * 60 + aptMinutes;

				const appointmentDuration = resolveDurationMinutes(appointment.duration);
				const appointmentEnd = aptTime + appointmentDuration;

				const fitsInSlot = daySchedule.slots.some(slot => {
					const [slotStartHours, slotStartMinutes] = slot.start.split(':').map(Number);
					const [slotEndHours, slotEndMinutes] = slot.end.split(':').map(Number);
					const slotStart = slotStartHours * 60 + slotStartMinutes;
					let slotEnd = slotEndHours * 60 + slotEndMinutes;
					if (slotEnd <= slotStart) slotEnd += 24 * 60;
					return aptTime >= slotStart && appointmentEnd <= slotEnd;
				});

				if (!fitsInSlot) {
					conflicts.push({
						appointmentId: appointment.id,
						date: appointment.date,
						time: appointment.time,
						conflictReason: 'slot_unavailable',
					});
					continue;
				}

				// Check if therapist already has an appointment at that time
				const existingAppointmentsQuery = query(
					collection(db, 'appointments'),
					where('doctor', '==', request.toTherapist),
					where('date', '==', appointment.date),
					where('time', '==', appointment.time),
					where('status', 'in', ['pending', 'ongoing'])
				);
				const existingSnapshot = await getDocs(existingAppointmentsQuery);
				if (!existingSnapshot.empty) {
					conflicts.push({
						appointmentId: appointment.id,
						date: appointment.date,
						time: appointment.time,
						conflictReason: 'already_booked',
					});
				}
			}

			setAppointmentConflicts(prev => ({ ...prev, [request.id!]: conflicts }));
		} catch (error) {
			console.error('Failed to check appointment conflicts', error);
			setAppointmentConflicts(prev => ({ ...prev, [request.id!]: [] }));
		} finally {
			setCheckingConflicts(prev => ({ ...prev, [request.id!]: false }));
		}
	};

	// Check conflicts when pending requests load
	useEffect(() => {
		pendingRequests.forEach(request => {
			if (request.id && !checkingConflicts[request.id]) {
				checkAppointmentConflicts(request);
			}
		});
	}, [pendingRequests.length]);

	const handleTransferClick = async (patient: PatientRecordTransfer, newTherapistName: string) => {
		if (!newTherapistName || newTherapistName === patient.assignedDoctor) {
			return;
		}

		// Prevent self-transfer
		const newTherapistNormalized = normalize(newTherapistName);
		if (newTherapistNormalized === clinicianName) {
			alert('You cannot transfer a patient to yourself. Please select a different therapist.');
			return;
		}

		// Check availability before showing confirmation
		setCheckingAvailability(true);
		try {
			const newTherapistData = therapists.find(t => t.name === newTherapistName);
			if (!newTherapistData) {
				alert('Therapist not found. Please try again.');
				setCheckingAvailability(false);
				return;
			}

			// Load patient's upcoming appointments
			const appointmentsQuery = query(
				collection(db, 'appointments'),
				where('patientId', '==', patient.patientId),
				where('status', 'in', ['pending', 'ongoing'])
			);
			const appointmentsSnapshot = await getDocs(appointmentsQuery);
			const appointments = appointmentsSnapshot.docs.map(docSnap => {
				const data = docSnap.data();
				const duration = parseDurationMinutes(data.duration ?? data.slotDuration);
				return {
					id: docSnap.id,
					date: data.date as string,
					time: data.time as string,
					status: data.status as string,
					duration,
				};
			});

			if (appointments.length === 0) {
				// No appointments, proceed with transfer
				setConfirmation({
					isOpen: true,
					patient,
					newTherapist: newTherapistName,
					availabilityCheck: {
						appointments: [],
						conflicts: [],
						hasConflicts: false,
					},
				});
				setCheckingAvailability(false);
				return;
			}

			// Load new therapist's availability
			const therapistDoc = await getDoc(doc(db, 'staff', newTherapistData.id));
			if (!therapistDoc.exists()) {
				alert('Therapist data not found. Please try again.');
				setCheckingAvailability(false);
				return;
			}

			const therapistData = therapistDoc.data();
			const availability = therapistData.dateSpecificAvailability as Record<string, { enabled: boolean; slots: Array<{ start: string; end: string }> }> | undefined;

			// Check each appointment for conflicts
			const conflicts: AppointmentConflict[] = [];

			for (const appointment of appointments) {
				const dateKey = appointment.date; // Already in YYYY-MM-DD format
				const daySchedule = availability?.[dateKey];

				if (!daySchedule || !daySchedule.enabled) {
					conflicts.push({
						appointmentId: appointment.id,
						date: appointment.date,
						time: appointment.time,
						conflictReason: 'no_availability',
					});
					continue;
				}

				// Check if appointment time falls within any available slot
				const [aptHours, aptMinutes] = appointment.time.split(':').map(Number);
				const aptTime = aptHours * 60 + aptMinutes;

				const appointmentDuration = resolveDurationMinutes(appointment.duration);
				const appointmentEnd = aptTime + appointmentDuration;

				const fitsInSlot = daySchedule.slots.some(slot => {
					const [slotStartHours, slotStartMinutes] = slot.start.split(':').map(Number);
					const [slotEndHours, slotEndMinutes] = slot.end.split(':').map(Number);
					const slotStart = slotStartHours * 60 + slotStartMinutes;
					let slotEnd = slotEndHours * 60 + slotEndMinutes;
					if (slotEnd <= slotStart) slotEnd += 24 * 60;
					return aptTime >= slotStart && appointmentEnd <= slotEnd;
				});

				if (!fitsInSlot) {
					conflicts.push({
						appointmentId: appointment.id,
						date: appointment.date,
						time: appointment.time,
						conflictReason: 'slot_unavailable',
					});
					continue;
				}

				// Check if therapist already has an appointment at that time
				const existingAppointmentsQuery = query(
					collection(db, 'appointments'),
					where('doctor', '==', newTherapistName),
					where('date', '==', appointment.date),
					where('time', '==', appointment.time),
					where('status', 'in', ['pending', 'ongoing'])
				);
				const existingSnapshot = await getDocs(existingAppointmentsQuery);
				if (!existingSnapshot.empty) {
					conflicts.push({
						appointmentId: appointment.id,
						date: appointment.date,
						time: appointment.time,
						conflictReason: 'already_booked',
					});
				}
			}

			// Show confirmation with availability check results
			setConfirmation({
				isOpen: true,
				patient,
				newTherapist: newTherapistName,
				availabilityCheck: {
					appointments,
					conflicts,
					hasConflicts: conflicts.length > 0,
				},
			});
		} catch (error) {
			console.error('Failed to check availability', error);
			alert('Failed to check therapist availability. Please try again.');
		} finally {
			setCheckingAvailability(false);
		}
	};

	const handleConfirmTransfer = async () => {
		const { patient, newTherapist } = confirmation;
		if (!patient) return;

		setTransferring(prev => ({ ...prev, [patient.id]: true }));

		try {
			const oldTherapist = patient.assignedDoctor;
			const oldTherapistData = therapists.find(t => t.name === oldTherapist);
			const newTherapistData = therapists.find(t => t.name === newTherapist);

			if (!newTherapistData) {
				alert('Therapist not found. Please try again.');
				return;
			}

			// Create transfer request instead of directly transferring
			const requestRef = await addDoc(collection(db, 'transferRequests'), {
				patientId: patient.patientId,
				patientName: patient.name,
				patientDocumentId: patient.id,
				fromTherapist: oldTherapist || null,
				fromTherapistId: oldTherapistData?.id || null,
				toTherapist: newTherapist,
				toTherapistId: newTherapistData.id,
				requestedBy: currentStaffName || user?.displayName || 'Unknown',
				requestedById: currentStaffId || user?.uid || '',
				status: 'pending',
				requestedAt: serverTimestamp(),
			});

			// Create notifications for therapists
			const notificationPromises: Promise<void>[] = [];

			// Notify new therapist about pending transfer request
			if (newTherapistData) {
				const newTherapistNotification = addDoc(collection(db, 'notifications'), {
					userId: newTherapistData.id,
					title: 'Patient Transfer Request',
					message: `${currentStaffName || 'A therapist'} has requested to transfer ${patient.name} (${patient.patientId}) to you. Please accept or reject the request.`,
					category: 'patient',
					status: 'unread',
					createdAt: serverTimestamp(),
					metadata: {
						patientId: patient.patientId,
						patientName: patient.name,
						fromTherapist: oldTherapist || null,
						toTherapist: newTherapist,
						type: 'transfer_request',
						requestId: requestRef.id,
					},
				});
				notificationPromises.push(newTherapistNotification.then(() => {}));
			}

			// Notify old therapist (if exists) about the request
			if (oldTherapist && oldTherapistData) {
				const oldTherapistNotification = addDoc(collection(db, 'notifications'), {
					userId: oldTherapistData.id,
					title: 'Patient Transfer Requested',
					message: `A transfer request has been sent for ${patient.name} (${patient.patientId}) to ${newTherapist}. Waiting for acceptance.`,
					category: 'patient',
					status: 'unread',
					createdAt: serverTimestamp(),
					metadata: {
						patientId: patient.patientId,
						patientName: patient.name,
						fromTherapist: oldTherapist,
						toTherapist: newTherapist,
						type: 'transfer_request',
						requestId: requestRef.id,
					},
				});
				notificationPromises.push(oldTherapistNotification.then(() => {}));
			}

			// Wait for all notifications (but don't fail if they fail)
			await Promise.allSettled(notificationPromises);

			setSuccessMessage(`Transfer request sent to ${newTherapist}. Waiting for acceptance.`);
			setTimeout(() => setSuccessMessage(null), 5000);

			// Close confirmation dialog
			setConfirmation({ isOpen: false, patient: null, newTherapist: '' });
		} catch (error) {
			console.error('Failed to create transfer request', error);
			alert(`Failed to create transfer request: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setTransferring(prev => ({ ...prev, [patient.id]: false }));
		}
	};

	const handleStatusChange = async (patientId: string, newStatus: AdminPatientStatus) => {
		if (!patientId || updatingStatus[patientId]) return;

		setUpdatingStatus(prev => ({ ...prev, [patientId]: true }));
		try {
			const patientRef = doc(db, 'patients', patientId);
			await updateDoc(patientRef, {
				status: newStatus,
				updatedAt: serverTimestamp(),
			});
			setSuccessMessage(`Patient status updated to ${newStatus.charAt(0).toUpperCase() + newStatus.slice(1)}`);
			setTimeout(() => setSuccessMessage(null), 3000);
		} catch (error) {
			console.error('Failed to update patient status', error);
			alert(`Failed to update patient status: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setUpdatingStatus(prev => ({ ...prev, [patientId]: false }));
		}
	};

	const handleAcceptTransfer = async (request: TransferRequest) => {
		if (!request.id || processingRequest[request.id]) return;

		// Check for appointment conflicts before accepting
		const conflicts = appointmentConflicts[request.id] || [];
		const conflictsNeedingAvailability = conflicts.filter(c => 
			c.conflictReason === 'no_availability' || c.conflictReason === 'slot_unavailable'
		);
		const conflictsAlreadyBooked = conflicts.filter(c => c.conflictReason === 'already_booked');

		// Warn about already booked conflicts (can't auto-fix these)
		if (conflictsAlreadyBooked.length > 0) {
			const conflictMessages = conflictsAlreadyBooked.map(c => 
				`${c.date} at ${c.time}: Therapist already has an appointment at this time`
			);

			const proceed = window.confirm(
				`Warning: This patient has ${conflictsAlreadyBooked.length} appointment conflict(s) where you already have other appointments:\n\n${conflictMessages.join('\n')}\n\n` +
				`These appointments cannot be automatically accommodated. You may need to reschedule them.\n\n` +
				`Do you want to proceed with the transfer?`
			);
			if (!proceed) return;
		}

		setProcessingRequest(prev => ({ ...prev, [request.id!]: true }));

		try {
			// Load current therapist availability
			const therapistDoc = await getDoc(doc(db, 'staff', request.toTherapistId));
			if (therapistDoc.exists()) {
				const therapistData = therapistDoc.data();
				const currentAvailability = (therapistData.dateSpecificAvailability as Record<string, { enabled: boolean; slots: Array<{ start: string; end: string }> }>) || {};
				const updatedAvailability = { ...currentAvailability };

				// Get all appointments being transferred
				const appointments = patientAppointments[request.id] || [];
				
				// Group appointments by date (including both conflicts and non-conflicts)
				const appointmentsByDate: Record<string, Array<{ time: string; duration?: number }>> = {};
				appointments.forEach(apt => {
					if (!appointmentsByDate[apt.date]) {
						appointmentsByDate[apt.date] = [];
					}
					appointmentsByDate[apt.date].push({ time: apt.time, duration: apt.duration });
				});

				// Create or update availability for each date with appointments
				for (const [date, timeSlots] of Object.entries(appointmentsByDate)) {
					const existingSchedule = updatedAvailability[date];
					
					if (!existingSchedule || !existingSchedule.enabled) {
						// Create new schedule for this date
						// Create slots that cover each appointment time (30 min slots)
						const newSlots = timeSlots.map(({ time, duration }) => {
							const [hours, minutes] = time.split(':').map(Number);
							const totalStartMinutes = hours * 60 + minutes;
							const appointmentDuration = resolveDurationMinutes(duration);
							const startTime = formatMinutesToTime(totalStartMinutes);
							const endTime = formatMinutesToTime(totalStartMinutes + appointmentDuration);
							return { start: startTime, end: endTime };
						});
						
						updatedAvailability[date] = {
							enabled: true,
							slots: newSlots,
						};
					} else {
						// Add slots to existing schedule
						const existingSlots = existingSchedule.slots || [];
						const newSlots = timeSlots.map(({ time, duration }) => {
							const [hours, minutes] = time.split(':').map(Number);
							const totalStartMinutes = hours * 60 + minutes;
							const appointmentDuration = resolveDurationMinutes(duration);
							const startTime = formatMinutesToTime(totalStartMinutes);
							const endTime = formatMinutesToTime(totalStartMinutes + appointmentDuration);
							return { start: startTime, end: endTime };
						});

						// Merge slots, avoiding duplicates
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

						updatedAvailability[date] = {
							enabled: true,
							slots: allSlots,
						};
					}
				}

				// Update therapist availability in Firestore
				const therapistRef = doc(db, 'staff', request.toTherapistId);
				await updateDoc(therapistRef, {
					dateSpecificAvailability: updatedAvailability,
					availabilityUpdatedAt: serverTimestamp(),
				});
			}

			// Update transfer request status
			const requestRef = doc(db, 'transferRequests', request.id);
			await updateDoc(requestRef, {
				status: 'accepted',
				respondedAt: serverTimestamp(),
			});

			// Update patient record
			const patientRef = doc(db, 'patients', request.patientDocumentId);
			await updateDoc(patientRef, {
				assignedDoctor: request.toTherapist,
				transferredAt: serverTimestamp(),
			});

			// Update all patient's appointments to new therapist
			const appointments = patientAppointments[request.id] || [];
			const appointmentUpdatePromises = appointments.map(apt => {
				const aptRef = doc(db, 'appointments', apt.id);
				return updateDoc(aptRef, {
					doctor: request.toTherapist,
				});
			});
			await Promise.allSettled(appointmentUpdatePromises);

			// Remove availability slots from old therapist if they exist and have no other appointments
			if (request.fromTherapistId && appointments.length > 0) {
				try {
					const oldTherapistDoc = await getDoc(doc(db, 'staff', request.fromTherapistId));
					if (oldTherapistDoc.exists()) {
						const oldTherapistData = oldTherapistDoc.data();
						const oldAvailability = (oldTherapistData.dateSpecificAvailability as Record<string, { enabled: boolean; slots: Array<{ start: string; end: string }> }>) || {};
						const updatedOldAvailability = { ...oldAvailability };

						// Group transferred appointments by date
						const transferredByDate: Record<string, Array<{ time: string; duration?: number }>> = {};
						appointments.forEach(apt => {
							if (!transferredByDate[apt.date]) {
								transferredByDate[apt.date] = [];
							}
							transferredByDate[apt.date].push({ time: apt.time, duration: apt.duration });
						});

						// Check each date and remove slots if they match transferred appointments and have no other appointments
						for (const [date, timeSlots] of Object.entries(transferredByDate)) {
							const dateSchedule = updatedOldAvailability[date];
							if (!dateSchedule || !dateSchedule.enabled) continue;

							// Check if there are any other appointments for the old therapist at these times
							const otherAppointmentsQuery = query(
								collection(db, 'appointments'),
								where('doctor', '==', request.fromTherapist || ''),
								where('date', '==', date)
							);
							const otherAppointmentsSnapshot = await getDocs(otherAppointmentsQuery);
							const otherAppointments = otherAppointmentsSnapshot.docs
								.map(docSnap => {
									const data = docSnap.data();
									return {
										time: data.time as string,
										patientId: data.patientId as string,
										duration: parseDurationMinutes(data.duration ?? data.slotDuration),
									};
								})
								.filter(apt => apt.patientId !== request.patientId); // Exclude transferred patient

							// Create time slots for transferred appointments
							const transferredSlots = timeSlots.map(({ time, duration }) => {
								const [hours, minutes] = time.split(':').map(Number);
								const totalStartMinutes = hours * 60 + minutes;
								const appointmentDuration = resolveDurationMinutes(duration);
								const startTime = formatMinutesToTime(totalStartMinutes);
								const endTime = formatMinutesToTime(totalStartMinutes + appointmentDuration);
								return { start: startTime, end: endTime };
							});

							// Remove slots that match transferred appointments
							// Since appointments have already been updated to the new therapist,
							// these slots should be removed from the old therapist's schedule
							const remainingSlots = dateSchedule.slots.filter(slot => {
								// Check if this slot matches a transferred appointment time
								const matchesTransferred = transferredSlots.some(transferredSlot => 
									slot.start === transferredSlot.start && slot.end === transferredSlot.end
								);

								if (!matchesTransferred) {
									// Keep slot if it doesn't match transferred appointments
									return true;
								}

								// If it matches a transferred appointment, check if there are OTHER appointments at this time
								// (appointments that weren't transferred)
								const [slotStartHours, slotStartMinutes] = slot.start.split(':').map(Number);
								const slotStartTime = slotStartHours * 60 + slotStartMinutes;
								const [slotEndHours, slotEndMinutes] = slot.end.split(':').map(Number);
								let slotEndTime = slotEndHours * 60 + slotEndMinutes;
								if (slotEndTime <= slotStartTime) {
									slotEndTime += 24 * 60;
								}
								
								const hasOtherAppointments = otherAppointments.some(apt => {
									const [aptHours, aptMinutes] = apt.time.split(':').map(Number);
									const aptTime = aptHours * 60 + aptMinutes;
									const aptDuration = resolveDurationMinutes(apt.duration);
									const aptEndTime = aptTime + aptDuration;
									// Check if appointment overlaps with this slot
									return aptTime < slotEndTime && aptEndTime > slotStartTime;
								});

								// Keep slot only if there are other (non-transferred) appointments at this time
								// Otherwise, remove it since the appointments have been transferred
								return hasOtherAppointments;
							});

							// Update or remove the date schedule
							if (remainingSlots.length === 0) {
								// Remove the entire date schedule if no slots remain
								delete updatedOldAvailability[date];
							} else {
								// Update with remaining slots
								updatedOldAvailability[date] = {
									enabled: true,
									slots: remainingSlots,
								};
							}
						}

						// Update old therapist's availability
						const oldTherapistRef = doc(db, 'staff', request.fromTherapistId);
						await updateDoc(oldTherapistRef, {
							dateSpecificAvailability: updatedOldAvailability,
							availabilityUpdatedAt: serverTimestamp(),
						});
					}
				} catch (error) {
					console.error('Failed to update old therapist availability', error);
					// Don't fail the transfer if this fails
				}
			}

			// Store transfer history
			await addDoc(collection(db, 'transferHistory'), {
				patientId: request.patientId,
				patientName: request.patientName,
				fromTherapist: request.fromTherapist || null,
				toTherapist: request.toTherapist,
				transferredAt: serverTimestamp(),
			});

			// Create notifications
			const notificationPromises: Promise<void>[] = [];

			// Notify requesting therapist
			if (request.requestedById) {
				const requestedByNotification = addDoc(collection(db, 'notifications'), {
					userId: request.requestedById,
					title: 'Transfer Request Accepted',
					message: `${request.toTherapist} has accepted the transfer request for ${request.patientName} (${request.patientId}).`,
					category: 'patient',
					status: 'unread',
					createdAt: serverTimestamp(),
					metadata: {
						patientId: request.patientId,
						patientName: request.patientName,
						fromTherapist: request.fromTherapist || null,
						toTherapist: request.toTherapist,
						type: 'transfer_accepted',
					},
				});
				notificationPromises.push(requestedByNotification.then(() => {}));
			}

			// Notify old therapist (if different from requester)
			if (request.fromTherapistId && request.fromTherapistId !== request.requestedById) {
				const oldTherapistNotification = addDoc(collection(db, 'notifications'), {
					userId: request.fromTherapistId,
					title: 'Patient Transferred',
					message: `${request.patientName} (${request.patientId}) has been transferred from you to ${request.toTherapist}.`,
					category: 'patient',
					status: 'unread',
					createdAt: serverTimestamp(),
					metadata: {
						patientId: request.patientId,
						patientName: request.patientName,
						fromTherapist: request.fromTherapist || null,
						toTherapist: request.toTherapist,
						type: 'transfer',
					},
				});
				notificationPromises.push(oldTherapistNotification.then(() => {}));
			}

			await Promise.allSettled(notificationPromises);

			let successMsg = `Transfer accepted. ${request.patientName} has been assigned to you.`;
			if (conflictsNeedingAvailability.length > 0) {
				successMsg += ` Availability slots have been automatically created for ${conflictsNeedingAvailability.length} appointment(s).`;
			}
			setSuccessMessage(successMsg);
			setTimeout(() => setSuccessMessage(null), 5000);
		} catch (error) {
			console.error('Failed to accept transfer', error);
			alert(`Failed to accept transfer: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setProcessingRequest(prev => ({ ...prev, [request.id!]: false }));
		}
	};

	const handleRejectTransfer = async (request: TransferRequest) => {
		if (!request.id || processingRequest[request.id]) return;

		if (!window.confirm(`Are you sure you want to reject the transfer request for ${request.patientName}?`)) {
			return;
		}

		setProcessingRequest(prev => ({ ...prev, [request.id!]: true }));

		try {
			// Update transfer request status
			const requestRef = doc(db, 'transferRequests', request.id);
			await updateDoc(requestRef, {
				status: 'rejected',
				respondedAt: serverTimestamp(),
			});

			// Notify requesting therapist
			if (request.requestedById) {
				await addDoc(collection(db, 'notifications'), {
					userId: request.requestedById,
					title: 'Transfer Request Rejected',
					message: `${request.toTherapist} has rejected the transfer request for ${request.patientName} (${request.patientId}).`,
					category: 'patient',
					status: 'unread',
					createdAt: serverTimestamp(),
					metadata: {
						patientId: request.patientId,
						patientName: request.patientName,
						fromTherapist: request.fromTherapist || null,
						toTherapist: request.toTherapist,
						type: 'transfer_rejected',
					},
				});
			}

			setSuccessMessage(`Transfer request rejected.`);
			setTimeout(() => setSuccessMessage(null), 5000);
		} catch (error) {
			console.error('Failed to reject transfer', error);
			alert(`Failed to reject transfer: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setProcessingRequest(prev => ({ ...prev, [request.id!]: false }));
		}
	};

	const handleCancelTransfer = () => {
		setConfirmation({ isOpen: false, patient: null, newTherapist: '' });
	};

	return (
		<div className="space-y-10">
			<div className="border-t border-slate-200" />

			{successMessage && (
					<div className="alert-success">
						<i className="fas fa-check-circle mr-2" aria-hidden="true" />
						{successMessage}
					</div>
				)}

				{/* Pending Transfer Requests Section */}
				{pendingRequests.length > 0 && (
					<section className="section-card">
						<header className="mb-4">
							<h2 className="text-lg font-semibold text-slate-900">Pending Transfer Requests</h2>
							<p className="text-sm text-slate-500">
								You have {pendingRequests.length} pending transfer request{pendingRequests.length === 1 ? '' : 's'} waiting for your response.
							</p>
						</header>
						<div className="space-y-3">
							{pendingRequests.map(request => {
								const isProcessing = processingRequest[request.id!] || false;
								return (
									<div
										key={request.id}
										className="flex flex-col gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between"
									>
										<div className="flex-1">
											<div className="flex items-center gap-3">
												<h3 className="text-base font-semibold text-slate-900">{request.patientName}</h3>
												<span className="badge-base status-badge-pending">Pending</span>
											</div>
											<p className="mt-1 text-sm text-slate-600">
												<span className="font-medium text-slate-700">Patient ID:</span>{' '}
												<code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
													{request.patientId}
												</code>
											</p>
											{request.fromTherapist && (
												<p className="mt-1 text-xs text-slate-500">
													<span className="font-medium">From:</span>{' '}
													{normalize(request.fromTherapist) === clinicianName ? (
														<span className="font-semibold text-sky-600">You</span>
													) : (
														request.fromTherapist
													)}
												</p>
											)}
											{request.requestedBy && (
												<p className="mt-1 text-xs text-slate-500">
													<span className="font-medium">Requested by:</span>{' '}
													{normalize(request.requestedBy) === clinicianName ? (
														<span className="font-semibold text-sky-600">You</span>
													) : (
														request.requestedBy
													)}
												</p>
											)}
											<p className="mt-1 text-xs text-slate-500">
												<span className="font-medium">Requested:</span>{' '}
												{request.requestedAt instanceof Timestamp 
													? request.requestedAt.toDate().toLocaleString()
													: new Date(request.requestedAt).toLocaleString()}
											</p>
											{(() => {
												const appointments = patientAppointments[request.id!] || [];
												const conflicts = appointmentConflicts[request.id!] || [];
												const isChecking = checkingConflicts[request.id!];

												if (isChecking) {
													return (
														<p className="mt-2 text-xs text-slate-500">
															<i className="fas fa-spinner fa-spin mr-1" />
															Checking appointment conflicts...
														</p>
													);
												}

												if (appointments.length > 0) {
													return (
														<div className="mt-2 space-y-1">
															<p className="text-xs font-medium text-slate-700">
																Upcoming Appointments: {appointments.length}
															</p>
															{conflicts.length > 0 && (
																<div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs">
																	<p className="font-medium text-amber-800 mb-1">
																		<i className="fas fa-exclamation-triangle mr-1" />
																		{conflicts.length} Conflict(s) Found:
																	</p>
																	<ul className="list-disc list-inside space-y-0.5 text-amber-700">
																		{conflicts.map((conflict, idx) => (
																			<li key={idx}>
																				{conflict.date} at {conflict.time} - {
																					conflict.conflictReason === 'no_availability' 
																						? 'Therapist not available'
																						: conflict.conflictReason === 'slot_unavailable'
																						? 'Time slot unavailable'
																						: 'Already booked'
																				}
																			</li>
																		))}
																	</ul>
																</div>
															)}
															{conflicts.length === 0 && appointments.length > 0 && (
																<p className="text-xs text-emerald-600">
																	<i className="fas fa-check-circle mr-1" />
																	All appointments compatible with your schedule
																</p>
															)}
														</div>
													);
												}

												return null;
											})()}
										</div>
										<div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
											<i className="fas fa-info-circle mr-2 text-slate-500" />
											Please respond to this transfer request from the Notifications panel. Actions have been moved there so that
											all therapists receive and handle requests in one consistent place.
										</div>
									</div>
								);
							})}
						</div>
					</section>
				)}

				<section className="section-card">
					<div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2">
						<div>
							<label htmlFor="search-patients" className="block text-sm font-medium text-slate-700">
								Search Patients
							</label>
							<input
								type="search"
								id="search-patients"
								value={searchTerm}
								onChange={event => setSearchTerm(event.target.value)}
								placeholder="Search by name or ID"
								className="input-base"
							/>
						</div>
						<div>
							<label htmlFor="status-filter" className="block text-sm font-medium text-slate-700">
								Status Filter
							</label>
							<select
								id="status-filter"
								value={statusFilter}
								onChange={event => setStatusFilter(event.target.value as AdminPatientStatus | 'all')}
								className="select-base"
							>
								<option value="all">All Statuses</option>
								<option value="pending">Pending</option>
								<option value="ongoing">Ongoing</option>
								<option value="completed">Completed</option>
								<option value="cancelled">Cancelled</option>
							</select>
						</div>
					</div>
				</section>

				{/* Two Column Layout: Patient Transfers and History */}
				<div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
					{/* Left Column: Patient Transfers */}
					<section className="section-card">
						<header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
							<div>
								<h2 className="text-lg font-semibold text-slate-900">Patient Transfers</h2>
								<p className="text-sm text-slate-500">
									{filteredPatients.length} patient{filteredPatients.length === 1 ? '' : 's'} found
								</p>
							</div>
							<button
								type="button"
								onClick={() => {
									setSearchTerm('');
									setStatusFilter('all');
								}}
								className="btn-secondary"
							>
								<i className="fas fa-eraser text-xs" aria-hidden="true" />
								Clear filters
							</button>
						</header>

						{loading ? (
							<div className="empty-state-container">
								<div className="loading-spinner" aria-hidden="true" />
								<span className="ml-3 align-middle">Loading patients…</span>
							</div>
						) : filteredPatients.length === 0 ? (
							<div className="empty-state-container">
								{!clinicianName ? (
									<>
										<p className="font-medium text-slate-700">No patients found.</p>
										<p className="mt-2 text-sm text-slate-500">
											Your staff profile doesn't have a userName set, or your email doesn't match a staff record. Please contact an administrator to set up your profile.
										</p>
									</>
								) : patients.length === 0 ? (
									<>
										<p className="font-medium text-slate-700">No patients found.</p>
										<p className="mt-2 text-sm text-slate-500">
											No patients are currently assigned to you ({currentStaffName || user?.displayName || 'Unknown'}).
										</p>
									</>
								) : (
									<>
										<p className="font-medium text-slate-700">No patients match your filters.</p>
										<p className="mt-2 text-sm text-slate-500">
											No patients are currently assigned to you ({currentStaffName || user?.displayName || 'Unknown'}). Try adjusting your search criteria or check if patients need to be assigned to you first.
										</p>
										{process.env.NODE_ENV === 'development' && (
											<div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
												<strong>Debug Info:</strong>
												<ul className="mt-2 list-disc list-inside space-y-1">
													<li>Your email: {user?.email || 'Not set'}</li>
													<li>Staff userName: {currentStaffName || 'Not found'}</li>
													<li>User displayName: {user?.displayName || 'Not set'}</li>
													<li>Using for matching: {clinicianName || 'Empty'}</li>
													<li>Total patients in system: {patients.length}</li>
													<li>Unique assigned doctors: {[...new Set(patients.map(p => p.assignedDoctor).filter(Boolean))].join(', ') || 'None'}</li>
												</ul>
											</div>
										)}
									</>
								)}
							</div>
						) : (
							<div className="space-y-4 max-h-[600px] overflow-y-auto">
								{filteredPatients.map(patient => {
									const isTransferring = transferring[patient.id] || false;
									const selectedTherapist = selectedTherapists[patient.id] || patient.assignedDoctor || '';

									return (
										<div
											key={patient.id}
											className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between"
										>
											<div className="flex-1">
												<div className="flex items-center gap-3 flex-wrap">
													<h3 className="text-base font-semibold text-slate-900">{patient.name}</h3>
													<div className="flex items-center gap-2">
														<select
															value={patient.status}
															onChange={event => handleStatusChange(patient.id, event.target.value as AdminPatientStatus)}
															disabled={updatingStatus[patient.id]}
															className="select-base text-xs py-1 px-2 min-w-[120px]"
														>
															{STATUS_OPTIONS.map(option => (
																<option key={option.value} value={option.value}>
																	{option.label}
																</option>
															))}
														</select>
														{updatingStatus[patient.id] && (
															<div className="h-4 w-4 animate-spin rounded-full border-2 border-sky-600 border-t-transparent" />
														)}
													</div>
												</div>
												<p className="mt-1 text-sm text-slate-600">
													<span className="font-medium text-slate-700">Patient ID:</span>{' '}
													<code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
														{patient.patientId}
													</code>
												</p>
												{patient.assignedDoctor && (
													<p className="mt-1 text-xs text-slate-500">
														<span className="font-medium">Currently assigned to:</span>{' '}
														{normalize(patient.assignedDoctor) === clinicianName ? (
															<span className="font-semibold text-sky-600">You</span>
														) : (
															patient.assignedDoctor
														)}
													</p>
												)}
												{!patient.assignedDoctor && (
													<p className="mt-1 text-xs text-amber-600">
														<i className="fas fa-exclamation-circle mr-1" aria-hidden="true" />
														Not assigned to any therapist
													</p>
												)}
											</div>
											<div className="flex flex-col gap-3 sm:flex-row sm:items-end">
												<div className="min-w-[200px]">
													<label className="block text-xs font-medium text-slate-700">Select Therapist</label>
													<select
														value={selectedTherapist}
														onChange={event =>
															setSelectedTherapists(prev => ({
																...prev,
																[patient.id]: event.target.value,
															}))
														}
														disabled={isTransferring}
														className="select-base"
													>
														<option value="">Select Therapist</option>
														{therapists
															.filter(therapist => {
																// Exclude current user from the list (prevent self-transfer)
																const therapistNameNormalized = normalize(therapist.name);
																return therapistNameNormalized !== clinicianName;
															})
															.map(therapist => (
																<option key={therapist.id} value={therapist.name}>
																	{therapist.name} ({therapist.role === 'ClinicalTeam' ? 'Clinical Team' : therapist.role})
																</option>
															))}
													</select>
												</div>
												<button
													type="button"
													onClick={() => handleTransferClick(patient, selectedTherapist)}
													disabled={
														isTransferring || 
														!selectedTherapist || 
														selectedTherapist === patient.assignedDoctor ||
														normalize(selectedTherapist) === clinicianName ||
														checkingAvailability
													}
													className="btn-primary"
													title={
														normalize(selectedTherapist) === clinicianName 
															? 'Cannot transfer to yourself' 
															: checkingAvailability
															? 'Checking availability...'
															: undefined
													}
												>
													{isTransferring || checkingAvailability ? (
														<>
															<div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
															{checkingAvailability ? 'Checking Availability...' : 'Transferring...'}
														</>
													) : (
														<>
															<i className="fas fa-exchange-alt text-xs" aria-hidden="true" />
															Transfer
														</>
													)}
												</button>
											</div>
										</div>
									);
								})}
							</div>
						)}
					</section>

					{/* Right Column: Transfer History */}
					{transferHistory.length > 0 && (
						<section className="section-card lg:sticky lg:top-6 lg:h-fit">
							<header className="mb-4">
								<h2 className="text-lg font-semibold text-slate-900">Recent Transfer History</h2>
								<p className="text-sm text-slate-500">View recent patient transfers</p>
							</header>
							<div className="space-y-3 max-h-[600px] overflow-y-auto">
								{transferHistory.slice(0, 20).map(transfer => (
									<div
										key={transfer.id}
										className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm"
									>
										<div className="flex-1 min-w-0">
											<div className="font-medium text-slate-900 truncate">{transfer.patientName}</div>
											<div className="mt-1 text-xs text-slate-600">
												{transfer.fromTherapist ? (
													<>
														<span className="text-slate-500">From:</span>{' '}
														<span className="truncate">
															{normalize(transfer.fromTherapist) === clinicianName ? 'You' : transfer.fromTherapist}
														</span>{' '}
														→{' '}
														<span className="text-slate-500">To:</span>{' '}
														<span className="font-medium text-sky-600 truncate">
															{normalize(transfer.toTherapist) === clinicianName ? 'You' : transfer.toTherapist}
														</span>
													</>
												) : (
													<>
														<span className="text-slate-500">Assigned to:</span>{' '}
														<span className="font-medium text-sky-600 truncate">
															{normalize(transfer.toTherapist) === clinicianName ? 'You' : transfer.toTherapist}
														</span>
													</>
												)}
											</div>
										</div>
										<div className="text-xs text-slate-500 whitespace-nowrap shrink-0">
											{formatDateLabel(transfer.transferredAt)}
										</div>
									</div>
								))}
							</div>
						</section>
					)}
				</div>

			{/* Confirmation Dialog */}
			<TransferConfirmationDialog
				isOpen={confirmation.isOpen}
				patientName={confirmation.patient?.name || ''}
				patientId={confirmation.patient?.patientId || ''}
				currentTherapist={confirmation.patient?.assignedDoctor}
				newTherapist={confirmation.newTherapist}
				onConfirm={handleConfirmTransfer}
				onCancel={handleCancelTransfer}
				transferring={confirmation.patient ? transferring[confirmation.patient.id] || false : false}
				availabilityCheck={confirmation.availabilityCheck}
			/>
		</div>
	);
}
