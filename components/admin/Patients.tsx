/* eslint-disable react-hooks/exhaustive-deps */
'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import {
	collection,
	doc,
	onSnapshot,
	addDoc,
	updateDoc,
	deleteDoc,
	serverTimestamp,
	writeBatch,
	getDocs,
	query,
	where,
	type QuerySnapshot,
	type Timestamp,
} from 'firebase/firestore';
// @ts-ignore - papaparse types may not be available
import Papa from 'papaparse';

import {
	type AdminGenderOption,
	type AdminPatientRecord,
	type AdminPatientStatus,
} from '@/lib/adminMockData';
import { db } from '@/lib/firebase';
import PageHeader from '@/components/PageHeader';
import { sendSMSNotification, isValidPhoneNumber } from '@/lib/sms';
import { sendEmailNotification } from '@/lib/email';
import { useAuth } from '@/contexts/AuthContext';
import { notifyAdmins } from '@/lib/notificationUtils';
import ReportModal from '@/components/frontdesk/ReportModal';
import { createInitialSessionAllowance } from '@/lib/sessionAllowance';
import type { SessionAllowance } from '@/lib/types';
import { checkAppointmentConflict, checkAvailabilityConflict } from '@/lib/appointmentUtils';
import type { AdminAppointmentRecord } from '@/lib/adminMockData';

const genderOptions: Array<{ value: AdminGenderOption; label: string }> = [
	{ value: '', label: 'Select' },
	{ value: 'Male', label: 'Male' },
	{ value: 'Female', label: 'Female' },
	{ value: 'Other', label: 'Other' },
];

const statusOptions: Array<{ value: AdminPatientStatus; label: string }> = [
	{ value: 'pending', label: 'Pending' },
	{ value: 'ongoing', label: 'Ongoing' },
	{ value: 'completed', label: 'Completed' },
	{ value: 'cancelled', label: 'Cancelled' },
];

const statusFilterOptions: Array<{ value: 'all' | AdminPatientStatus; label: string }> = [
	{ value: 'all', label: 'All statuses' },
	...statusOptions,
];

const formatDate = (iso: string) => {
	if (!iso) return '—';
	try {
		return new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
		}).format(new Date(iso));
	} catch {
		return '—';
	}
};

const formatPatientIdShort = (patientId?: string | null, length: number = 8) => {
	if (!patientId) return '—';
	if (patientId.length <= length) return patientId;
	return '...' + patientId.slice(-length);
};

const formatDateTime = (iso: string) => {
	if (!iso) return '—';
	try {
		return new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
		}).format(new Date(iso));
	} catch {
		return '—';
	}
};

async function generatePatientId(): Promise<string> {
	const prefix = 'CSS';
	const year = new Date().getFullYear();
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	
	// Check existing patient IDs in Firestore
	const patientsSnapshot = await getDocs(collection(db, 'patients'));
	const existingIds = new Set(patientsSnapshot.docs.map(doc => doc.data().patientId).filter(Boolean));
	
	let candidate = '';
	do {
		let randomPart = '';
		for (let index = 0; index < 7; index += 1) {
			randomPart += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
		}
		candidate = `${prefix}${year}${randomPart}`;
	} while (existingIds.has(candidate));

	return candidate;
}

const PHONE_REGEX = /^[0-9]{10,15}$/;
const PATIENT_TYPE_OPTIONS: Array<{ value: 'DYES' | 'VIP' | 'GETHNA' | 'PAID' | 'OTHERS' | ''; label: string }> = [
	{ value: 'DYES', label: 'DYES' },
	{ value: 'VIP', label: 'VIP' },
	{ value: 'GETHNA', label: 'GETHNA' },
	{ value: 'PAID', label: 'PAID' },
	{ value: 'OTHERS', label: 'Others' },
];
const PAYMENT_OPTIONS: Array<{ value: 'with' | 'without'; label: string }> = [
	{ value: 'with', label: 'With Concession' },
	{ value: 'without', label: 'Without Concession' },
];

function normalizeDateInput(raw?: string) {
	if (!raw) return '';
	const trimmed = raw.trim();
	if (!trimmed) return '';

	// direct parse first
	const direct = Date.parse(trimmed);
	if (!Number.isNaN(direct)) {
		return new Date(direct).toISOString();
	}

	// handle common dd/MM/yyyy or MM/dd/yyyy formats
	const parts = trimmed.split(/[\/\-\.]/);
	if (parts.length === 3) {
		let [a, b, c] = parts.map(part => part.trim());

		// ensure year is four digits (fallback if 2 digits)
		if (c.length === 2) {
			c = Number(c) > 50 ? `19${c}` : `20${c}`;
		}

		const numA = Number(a);
		const numB = Number(b);
		const year = Number(c);

		if (!Number.isNaN(numA) && !Number.isNaN(numB) && !Number.isNaN(year)) {
			const isDayFirst = numA > 12 || (numA <= 12 && numB <= 12 && numA > numB);
			const day = isDayFirst ? numA : numB;
			const month = isDayFirst ? numB : numA;
			const parsed = new Date(year, month - 1, day);
			if (!Number.isNaN(parsed.getTime())) {
				return parsed.toISOString();
			}
		}
	}

	// fallback: store as-is (formatDate will show raw string)
	return trimmed;
}

interface PatientNote {
	id: string;
	content: string;
	createdAt: string;
}

interface PatientAttachment {
	id: string;
	fileName: string;
	sizeLabel: string;
	url?: string;
	createdAt: string;
}

interface PatientHistory {
	id: string;
	text: string;
	createdAt: string;
}

interface PatientExtras {
	notes: PatientNote[];
	attachments: PatientAttachment[];
	history: PatientHistory[];
}

export default function Patients() {
	const { user } = useAuth();
	const [patients, setPatients] = useState<AdminPatientRecord[]>([]);
	const [loading, setLoading] = useState(true);
	const [searchTerm, setSearchTerm] = useState('');
	const [statusFilter, setStatusFilter] = useState<'all' | AdminPatientStatus>('all');
	const [dateFrom, setDateFrom] = useState('');
	const [dateTo,   setDateTo]   = useState('');
	const [doctorFilter, setDoctorFilter] = useState<'all' | string>('all');
	const [selectedPatientIds, setSelectedPatientIds] = useState<Set<string>>(new Set());
	const [isImportOpen, setIsImportOpen] = useState(false);
	const [importFile, setImportFile] = useState<File | null>(null);
	const [importPreview, setImportPreview] = useState<any[]>([]);
	const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
	const [patientExtras, setPatientExtras] = useState<Record<string, PatientExtras>>({});
	const [loadingExtras, setLoadingExtras] = useState<Record<string, boolean>>({});
	const [patientBilling, setPatientBilling] = useState<any[]>([]);
	const [patientAppointments, setPatientAppointments] = useState<any[]>([]);
	const [showReports, setShowReports] = useState(false);
	const [showReportModal, setShowReportModal] = useState(false);
	const [reportModalPatientId, setReportModalPatientId] = useState<string | null>(null);
	const [isDialogOpen, setIsDialogOpen] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [noteContent, setNoteContent] = useState('');
	const [isAddingNote, setIsAddingNote] = useState(false);
	const [showActionsDropdown, setShowActionsDropdown] = useState(false);
	const [showDeletedPatients, setShowDeletedPatients] = useState(false);
	const [deleteConfirmation, setDeleteConfirmation] = useState<{ patient: (AdminPatientRecord & { id?: string }) | null; nameInput: string }>({ patient: null, nameInput: '' });
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [formState, setFormState] = useState<Omit<AdminPatientRecord, 'registeredAt'>>({
		patientId: '',
		name: '',
		dob: '',
		gender: '',
		phone: '',
		email: '',
		address: '',
		complaint: '',
		status: 'pending',
	});
	const [isBackupOpen, setIsBackupOpen] = useState(false);
	const [isRestoreOpen, setIsRestoreOpen] = useState(false);
	const [restoreFile, setRestoreFile] = useState<File | null>(null);
	const [isBackingUp, setIsBackingUp] = useState(false);
	const [isRestoring, setIsRestoring] = useState(false);
	const [showRegisterModal, setShowRegisterModal] = useState(false);
	const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
	const [bookingLoading, setBookingLoading] = useState(false);
	const [bookingForm, setBookingForm] = useState({
		patientId: '',
		doctor: '',
		date: '',
		time: '',
		notes: '',
	});
	const [staff, setStaff] = useState<Array<{
		id: string;
		userName: string;
		role: string;
		status: string;
		userEmail?: string;
		dateSpecificAvailability?: {
			[date: string]: {
				enabled: boolean;
				slots: Array<{ start: string; end: string }>;
			};
		};
	}>>([]);
	const [appointments, setAppointments] = useState<Array<AdminAppointmentRecord & { id?: string }>>([]);
	const [registerForm, setRegisterForm] = useState({
		fullName: '',
		dob: '',
		gender: '' as AdminGenderOption,
		phone: '',
		email: '',
		address: '',
		patientType: '' as 'DYES' | 'VIP' | 'GETHNA' | 'PAID' | 'OTHERS' | '',
		paymentType: '' as 'with' | 'without' | '',
		paymentDescription: '',
	});
	const [registerFormErrors, setRegisterFormErrors] = useState<Partial<Record<keyof typeof registerForm, string>>>({});
	const [isRegistering, setIsRegistering] = useState(false);
	const restoreFileInputRef = useRef<HTMLInputElement>(null);
	const [isSyncingStatuses, setIsSyncingStatuses] = useState(false);

	// Load patients from Firestore
	useEffect(() => {
		const unsubscribe = onSnapshot(
			collection(db, 'patients'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data() as Record<string, unknown>;
					const created = (data.registeredAt as Timestamp | undefined)?.toDate?.();
					const deleted = (data.deletedAt as Timestamp | undefined)?.toDate?.();
					return {
						id: docSnap.id,
						patientId: data.patientId ? String(data.patientId) : '',
						name: data.name ? String(data.name) : '',
						dob: data.dob ? String(data.dob) : '',
						gender: (data.gender as AdminGenderOption) || '',
						phone: data.phone ? String(data.phone) : '',
						email: data.email ? String(data.email) : '',
						address: data.address ? String(data.address) : '',
						complaint: data.complaint ? String(data.complaint) : '',
						status: (data.status as AdminPatientStatus) ?? 'pending',
						registeredAt: created ? created.toISOString() : (data.registeredAt as string | undefined) || new Date().toISOString(),
						deleted: data.deleted === true,
						deletedAt: deleted ? deleted.toISOString() : (data.deletedAt as string | undefined) || null,
						patientType: data.patientType ? String(data.patientType) : '',
						assignedDoctor: data.assignedDoctor ? String(data.assignedDoctor) : undefined,
						transferredFromDoctor: data.transferredFromDoctor ? String(data.transferredFromDoctor) : undefined,
						transferReason: data.transferReason ? String(data.transferReason) : undefined,
						totalSessionsRequired: typeof data.totalSessionsRequired === 'number' ? data.totalSessionsRequired : (data.totalSessionsRequired ? Number(data.totalSessionsRequired) : undefined),
						remainingSessions: typeof data.remainingSessions === 'number' ? data.remainingSessions : (data.remainingSessions ? Number(data.remainingSessions) : undefined),
						feedback: data.feedback ? String(data.feedback) : undefined,
					} as AdminPatientRecord;
				});
				setPatients([...mapped]);
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

	// Load staff from Firestore for booking appointments
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
						dateSpecificAvailability: data.dateSpecificAvailability as {
							[date: string]: {
								enabled: boolean;
								slots: Array<{ start: string; end: string }>;
							};
						} | undefined,
					};
				});
				setStaff([...mapped]);
			},
			error => {
				console.error('Failed to load staff', error);
				setStaff([]);
			}
		);

		return () => unsubscribe();
	}, []);

	// Load appointments from Firestore for conflict checking
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
						status: (data.status as 'pending' | 'ongoing' | 'completed' | 'cancelled') ?? 'pending',
						createdAt: created ? created.toISOString() : (data.createdAt as string | undefined) || new Date().toISOString(),
					} as AdminAppointmentRecord & { id?: string };
				});
				setAppointments([...mapped]);
			},
			error => {
				console.error('Failed to load appointments', error);
				setAppointments([]);
			}
		);

		return () => unsubscribe();
	}, []);

	const doctorOptionsForBooking = useMemo(() => {
		const base = staff
			.filter(member => member.role === 'ClinicalTeam' && member.status !== 'Inactive')
			.map(member => member.userName)
			.filter(Boolean)
			.sort((a, b) => a.localeCompare(b));

		if (!bookingForm.date || !bookingForm.time) {
			return base;
		}

		return base.filter(name => {
			const member = staff.find(staffMember => staffMember.userName === name);
			if (!member) return false;
			const availability = checkAvailabilityConflict(
				member.dateSpecificAvailability,
				bookingForm.date,
				bookingForm.time
			);
			return availability.isAvailable;
		});
	}, [staff, bookingForm.date, bookingForm.time]);

	const doctorOptions = useMemo(() => {
		const doctors = new Set<string>();
		patients.forEach(patient => {
			const candidate = (patient as AdminPatientRecord & { assignedDoctor?: string }).assignedDoctor;
			if (candidate) doctors.add(candidate);
		});
		return Array.from(doctors);
	}, [patients]);

	const patientSelectOptions = useMemo(() => {
		function formatDateLabel(value: string | undefined) {
			if (!value) return '';
			const parsed = new Date(value);
			if (Number.isNaN(parsed.getTime())) return '';
			return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
		}

		return [...patients]
			.filter(p => !p.deleted)
			.sort((a, b) => {
				// Sort by latest registration date first, then alphabetically by name
				let dateA = 0;
				let dateB = 0;
				
				if (a.registeredAt) {
					const parsedA = new Date(a.registeredAt);
					dateA = isNaN(parsedA.getTime()) ? 0 : parsedA.getTime();
				}
				
				if (b.registeredAt) {
					const parsedB = new Date(b.registeredAt);
					dateB = isNaN(parsedB.getTime()) ? 0 : parsedB.getTime();
				}
				
				if (dateA === 0 && dateB === 0) {
					return a.name.localeCompare(b.name);
				} else if (dateA === 0) {
					return 1;
				} else if (dateB === 0) {
					return -1;
				} else {
					if (dateB !== dateA) {
						return dateB - dateA;
					}
					return a.name.localeCompare(b.name);
				}
			})
			.map(patient => {
				const regDate = patient.registeredAt ? formatDateLabel(patient.registeredAt) : '';
				return {
					label: `${patient.name} (${patient.patientId})${regDate ? ` - Registered: ${regDate}` : ''}`,
				value: patient.patientId,
				};
			});
	}, [patients]);

	const filteredDoctorOptions = useMemo(() => {
		const doctors = new Set<string>();
		patients.forEach(patient => {
			const candidate = (patient as AdminPatientRecord & { assignedDoctor?: string }).assignedDoctor;
			if (candidate) doctors.add(candidate);
		});
		return Array.from(doctors);
	}, [patients]);

	const filteredPatients = useMemo(() => {
		const query = searchTerm.trim().toLowerCase();
		return patients
			.map((patient, index) => ({ patient, index, id: (patient as AdminPatientRecord & { id?: string }).id || '' }))
			.filter(({ patient }) => {
				// Filter by deleted status
				const isDeleted = patient.deleted === true;
				if (showDeletedPatients && !isDeleted) return false;
				if (!showDeletedPatients && isDeleted) return false;

				const matchesSearch =
					!query ||
					(patient.name || '').toLowerCase().includes(query) ||
					(patient.patientId || '').toLowerCase().includes(query) ||
					(patient.phone || '').toLowerCase().includes(query) ||
					(patient.email || '').toLowerCase().includes(query);
				
				// Status filter: explicitly ensure only ongoing patients show when filtering for ongoing
				let matchesStatus = true;
				if (statusFilter === 'ongoing') {
					// When filtering for ongoing, only show patients with status 'ongoing'
					matchesStatus = patient.status === 'ongoing';
				} else if (statusFilter !== 'all') {
					// For other status filters, match exactly
					matchesStatus = patient.status === statusFilter;
				}
				const registeredAt = patient.registeredAt ? new Date(patient.registeredAt) : null;
				const matchesDateFrom = dateFrom
					? (registeredAt ? registeredAt >= new Date(`${dateFrom}T00:00:00`) : false)
					: true;
				const matchesDateTo = dateTo
					? (registeredAt ? registeredAt <= new Date(`${dateTo}T23:59:59`) : false)
					: true;
				const assignedDoctor = (patient as AdminPatientRecord & { assignedDoctor?: string }).assignedDoctor || '';
				const matchesDoctor = doctorFilter === 'all' || assignedDoctor === doctorFilter;
				return matchesSearch && matchesStatus && matchesDateFrom && matchesDateTo && matchesDoctor;
			});
	}, [patients, searchTerm, statusFilter, dateFrom, dateTo, doctorFilter, showDeletedPatients]);

	// Presets removed per request

	const selectedPatient = useMemo(() => {
		if (!selectedPatientId) return null;
		return patients.find(patient => (patient as AdminPatientRecord & { id?: string }).id === selectedPatientId) || null;
	}, [patients, selectedPatientId]);

	// Calculate billing totals
	const billingSummary = useMemo(() => {
		const totalAmount = patientBilling.reduce((sum, bill) => sum + (bill.packageAmount || bill.amount || 0), 0);
		const totalPaid = patientBilling.reduce((sum, bill) => sum + (bill.amountPaid || 0), 0);
		const totalPending = totalAmount - totalPaid;
		return { totalAmount, totalPaid, totalPending };
	}, [patientBilling]);

	// Get next session
	const nextSession = useMemo(() => {
		if (!patientAppointments.length) return null;
		const today = new Date().toISOString().split('T')[0];
		const upcoming = patientAppointments
			.filter(apt => apt.status !== 'cancelled' && apt.date >= today)
			.sort((a, b) => {
				const dateA = new Date(a.date + 'T' + (a.time || '00:00'));
				const dateB = new Date(b.date + 'T' + (b.time || '00:00'));
				return dateA.getTime() - dateB.getTime();
			});
		return upcoming.length > 0 ? upcoming[0] : null;
	}, [patientAppointments]);


	useEffect(() => {
		if (selectedPatient) {
			const previous = document.body.style.overflow;
			document.body.style.overflow = 'hidden';
			return () => {
				document.body.style.overflow = previous;
			};
		}
		return;
	}, [selectedPatient]);

	useEffect(() => {
		if (!selectedPatient) return;
		const handler = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				closeProfile();
			}
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [selectedPatient]);

	const closeProfile = () => setSelectedPatientId(null);

	// Booking modal handlers
	useEffect(() => {
		if (!bookingForm.doctor) return;
		if (!doctorOptionsForBooking.includes(bookingForm.doctor)) {
			setBookingForm(prev => ({ ...prev, doctor: '' }));
		}
	}, [bookingForm.doctor, doctorOptionsForBooking]);

	const closeBookingModal = () => {
		setBookingForm({
			patientId: '',
			doctor: '',
			date: '',
			time: '',
			notes: '',
		});
		setIsBookingModalOpen(false);
	};

	const handleCreateAppointment = async () => {
		if (!bookingForm.patientId || !bookingForm.doctor || !bookingForm.date || !bookingForm.time) {
			alert('Please select patient, clinician, date, and time.');
			return;
		}

		const patientRecord = patients.find(p => p.patientId === bookingForm.patientId);
		const staffMember = staff.find(member => member.userName === bookingForm.doctor);

		if (!patientRecord) {
			alert('Unable to find the selected patient.');
			return;
		}

		if (!staffMember) {
			alert('Unable to find the selected clinician.');
			return;
		}

		const conflict = checkAppointmentConflict(
			appointments
				.filter((appointment): appointment is AdminAppointmentRecord & { id: string } => !!appointment.id)
				.map(appointment => ({
					id: appointment.id,
					appointmentId: appointment.appointmentId || '',
					patient: appointment.patient || '',
					doctor: appointment.doctor || '',
					date: appointment.date || '',
					time: appointment.time || '',
					status: appointment.status || 'pending',
				})),
			{
				doctor: bookingForm.doctor,
				date: bookingForm.date,
				time: bookingForm.time,
			}
		);

		if (conflict.hasConflict) {
			const proceed = window.confirm(
				`Warning: ${bookingForm.doctor} already has an appointment at this time.\nProceed anyway?`
			);
			if (!proceed) {
				return;
			}
		}

		// Check if patient has any existing appointments - consultations can only be created from front desk
		const patientAllAppointments = appointments.filter(
			a => a.patientId === bookingForm.patientId
		);
		if (patientAllAppointments.length === 0) {
			alert('Consultations can only be created from the Front Desk. Please ask the front desk to create the first appointment (consultation) for this patient.');
			return;
		}

		setBookingLoading(true);
		try {
			const appointmentId = `APT${Date.now()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
			const patientWithId = patientRecord as AdminPatientRecord & { id?: string };
			
			await addDoc(collection(db, 'appointments'), {
				appointmentId,
				patientId: patientRecord.patientId,
				patient: patientRecord.name,
				doctor: bookingForm.doctor,
				date: bookingForm.date,
				time: bookingForm.time,
				status: 'pending',
				notes: bookingForm.notes.trim() || null,
				isConsultation: false,
				createdAt: serverTimestamp(),
			});

			if (patientWithId.id) {
				const updates: Record<string, unknown> = {
					assignedDoctor: bookingForm.doctor,
				};
				if (!patientRecord.status || patientRecord.status === 'pending') {
					updates.status = 'ongoing';
				}
				await updateDoc(doc(db, 'patients', patientWithId.id), updates);
			}

			if (patientRecord.email) {
				try {
					await sendEmailNotification({
						to: patientRecord.email,
						subject: `Appointment Scheduled - ${bookingForm.date}`,
						template: 'appointment-created',
						data: {
							patientName: patientRecord.name,
							patientEmail: patientRecord.email,
							patientId: patientRecord.patientId,
							doctor: bookingForm.doctor,
							date: bookingForm.date,
							time: bookingForm.time,
							appointmentId,
						},
					});
				} catch (emailError) {
					console.error('Failed to send confirmation email to patient:', emailError);
				}
			}

			if (patientRecord.phone && isValidPhoneNumber(patientRecord.phone)) {
				try {
					await sendSMSNotification({
						to: patientRecord.phone,
						template: 'appointment-created',
						data: {
							patientName: patientRecord.name,
							patientPhone: patientRecord.phone,
							patientId: patientRecord.patientId,
							doctor: bookingForm.doctor,
							date: bookingForm.date,
							time: bookingForm.time,
							appointmentId,
						},
					});
				} catch (smsError) {
					console.error('Failed to send confirmation SMS:', smsError);
				}
			}

			if (staffMember.userEmail) {
				try {
					await sendEmailNotification({
						to: staffMember.userEmail,
						subject: `New Appointment - ${patientRecord.name} on ${bookingForm.date}`,
						template: 'appointment-created',
						data: {
							patientName: patientRecord.name,
							patientEmail: patientRecord.email || staffMember.userEmail || '',
							patientId: patientRecord.patientId,
							doctor: bookingForm.doctor,
							date: bookingForm.date,
							time: bookingForm.time,
							appointmentId,
						},
					});
				} catch (emailError) {
					console.error('Failed to send notification email to clinician:', emailError);
				}
			}

			alert('Appointment booked successfully!');
			closeBookingModal();
		} catch (error) {
			console.error('Failed to create appointment:', error);
			alert('Failed to create appointment. Please try again.');
		} finally {
			setBookingLoading(false);
		}
	};

	// Load patient billing and appointments
	useEffect(() => {
		if (!selectedPatientId || !selectedPatient) {
			setPatientBilling([]);
			setPatientAppointments([]);
			return;
		}
		
		const patientId = selectedPatient.patientId;
		
		// Load billing records
		const billingUnsubscribe = onSnapshot(
			query(collection(db, 'billing'), where('patientId', '==', patientId)),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data();
					return {
						id: docSnap.id,
						amount: typeof data.amount === 'number' ? data.amount : Number(data.amount) || 0,
						amountPaid: typeof data.amountPaid === 'number' ? data.amountPaid : Number(data.amountPaid) || 0,
						packageAmount: typeof data.packageAmount === 'number' ? data.packageAmount : (data.packageAmount ? Number(data.packageAmount) : null),
						status: data.status || 'Pending',
					};
				});
				setPatientBilling([...mapped]);
			},
			error => {
				console.error('Failed to load billing', error);
				setPatientBilling([]);
			}
		);

		// Load appointments
		const appointmentsUnsubscribe = onSnapshot(
			query(collection(db, 'appointments'), where('patientId', '==', patientId)),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data();
					return {
						id: docSnap.id,
						date: data.date || '',
						time: data.time || '',
						status: data.status || '',
					};
				});
				setPatientAppointments([...mapped]);
			},
			error => {
				console.error('Failed to load appointments', error);
				setPatientAppointments([]);
			}
		);

		return () => {
			billingUnsubscribe();
			appointmentsUnsubscribe();
		};
	}, [selectedPatientId, selectedPatient]);

	// Load patient extras (notes, attachments, history)
	useEffect(() => {
		if (!selectedPatientId) return;
		const patientId = selectedPatientId;
		
		if (patientExtras[patientId]) return; // Already loaded
		
		setLoadingExtras(prev => ({ ...prev, [patientId]: true }));
		
		const loadExtras = async () => {
			try {
				const [notesSnap, attachmentsSnap, historySnap] = await Promise.all([
					getDocs(collection(db, 'patients', patientId, 'notes')),
					getDocs(collection(db, 'patients', patientId, 'attachments')),
					getDocs(collection(db, 'patients', patientId, 'history')),
				]);
				
				const notes: PatientNote[] = notesSnap.docs.map(d => {
					const data = d.data();
					const createdAt = (data.createdAt as Timestamp)?.toDate?.()?.toISOString() || data.createdAt || new Date().toISOString();
					return {
						id: d.id,
						content: data.content || '',
						createdAt,
					};
				});
				
				const attachments: PatientAttachment[] = attachmentsSnap.docs.map(d => {
					const data = d.data();
					const createdAt = (data.createdAt as Timestamp)?.toDate?.()?.toISOString() || data.createdAt || new Date().toISOString();
					return {
						id: d.id,
						fileName: data.fileName || '',
						sizeLabel: data.sizeLabel || '',
						url: data.url,
						createdAt,
					};
				});
				
				const history: PatientHistory[] = historySnap.docs.map(d => {
					const data = d.data();
					const createdAt = (data.createdAt as Timestamp)?.toDate?.()?.toISOString() || data.createdAt || new Date().toISOString();
					return {
						id: d.id,
						text: data.text || '',
						createdAt,
					};
				});
				
				setPatientExtras(prev => ({
					...prev,
					[patientId]: { notes, attachments, history },
				}));
			} catch (error) {
				console.error('Failed to load patient extras', error);
				setPatientExtras(prev => ({
					...prev,
					[patientId]: { notes: [], attachments: [], history: [] },
				}));
			} finally {
				setLoadingExtras(prev => ({ ...prev, [patientId]: false }));
			}
		};
		
		loadExtras();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedPatientId]);

	const handleToggleSelection = (patientId: string) => {
		setSelectedPatientIds(prev => {
			const next = new Set(prev);
			if (next.has(patientId)) {
				next.delete(patientId);
			} else {
				next.add(patientId);
			}
			return next;
		});
	};

	const handleSelectAll = () => {
		if (selectedPatientIds.size === filteredPatients.length) {
			setSelectedPatientIds(new Set());
		} else {
			setSelectedPatientIds(new Set(filteredPatients.map(({ id }) => id)));
		}
	};

	const handleImportClick = () => {
		setIsImportOpen(true);
	};

	// download template CSV (headers exactly as requested)
	function downloadTemplate() {
		const headers = ['Name', 'Dob', 'Gender', 'Phoneno', 'Email', 'Address', 'DoctorName', 'RegisteredAt', 'Complaint'];
		const csv = headers.join(',') + '\n';
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'patients_template.csv';
		a.click();
		URL.revokeObjectURL(url);
	}

	const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (!file) return;
		
		setImportFile(file);
		Papa.parse(file, {
			header: true,
			complete: (results: { data: any[] }) => {
				setImportPreview((results.data || []).slice(0, 50)); // Preview first 50 rows
			},
			error: (error: Error) => {
				alert(`Failed to parse CSV: ${error.message}`);
			},
		});
	};

	const handleImportConfirm = async () => {
		if (!importFile) return;
		
		try {
			Papa.parse(importFile, {
				header: true,
				complete: async (results: { data: any[] }) => {
					let batch = writeBatch(db);
					let count = 0;
					
					for (const rawRow of (results.data as any[]) || []) {
						// build case-insensitive map of row keys
						const row: Record<string, string> = {};
						for (const k of Object.keys(rawRow || {})) {
							row[k.toLowerCase().trim()] = rawRow[k];
						}

						// read template headers or common aliases
						const name = (row['name'] || row['fullname'] || row['full name'] || row['fullname'.toLowerCase()] || '').trim();
						const dob = (row['dob'] || row['dateofbirth'] || row['date_of_birth'] || '').trim();
						const gender = (row['gender'] || '').trim();
						const phoneno = (row['phoneno'] || row['phone'] || '').trim();
						const email = (row['email'] || '').trim();
						const address = (row['address'] || '').trim();
						const doctorName = (row['doctorname'] || row['doctor'] || '').trim();
						const registeredAtRaw = (row['registeredat'] || row['registered_at'] || '').trim();
						const complaint = (row['complaint'] || row['notes'] || '').trim();

						// Basic skip rules (same as original)
						if (!name) continue;
						if (!email && !phoneno) continue;

						const patientData = {
							patientId: row['patientid'] || `CSS${Date.now()}${Math.random().toString(36).substr(2, 9)}`,
							name: String(name),
							email: String(email),
							phone: String(phoneno),
							dob: normalizeDateInput(dob),
							address: String(address),
							gender: String(gender) as AdminGenderOption,
							complaint: String(complaint),
							status: 'pending' as AdminPatientStatus,
							// store registeredAt as string (ISO or raw CSV value)
							registeredAt: registeredAtRaw || new Date().toISOString(),
							assignedDoctor: String(doctorName) || undefined,
						};
						
						const docRef = doc(collection(db, 'patients'));
						batch.set(docRef, patientData);
						count++;
						
						if (count % 500 === 0) {
							await batch.commit();
							batch = writeBatch(db);
						}
					}
					
					// commit any remaining
					try {
						await batch.commit();
					} catch (err) {
						if (count > 0) console.error('Final batch commit failed', err);
					}
					
					alert(`Successfully imported ${count} patients.`);
					setIsImportOpen(false);
					setImportFile(null);
					setImportPreview([]);
				},
				error: (err: Error) => {
					console.error('Parsing error', err);
					alert('Failed to parse CSV. Please check the file.');
				}
			});
		} catch (error) {
			console.error('Import failed', error);
			alert('Failed to import patients. Please try again.');
		}
	};

	const handleBulkDeactivate = async () => {
		if (selectedPatientIds.size === 0) {
			alert('Please select at least one patient to deactivate.');
			return;
		}
		
		const confirmed = window.confirm(
			`Are you sure you want to deactivate ${selectedPatientIds.size} patient(s)?`
		);
		if (!confirmed) return;
		
		try {
			const batch = writeBatch(db);
			for (const patientId of selectedPatientIds) {
				const patientRef = doc(db, 'patients', patientId);
				batch.update(patientRef, { status: 'cancelled' });
			}
			await batch.commit();
			alert(`Successfully deactivated ${selectedPatientIds.size} patient(s).`);
			setSelectedPatientIds(new Set());
		} catch (error) {
			console.error('Bulk deactivate failed', error);
			alert('Failed to deactivate patients. Please try again.');
		}
	};

	const handleAddNote = async () => {
		if (!selectedPatientId || !noteContent.trim()) return;
		
		setIsAddingNote(true);
		try {
			const noteData = {
				content: noteContent.trim(),
				createdAt: serverTimestamp(),
			};
			
			await addDoc(collection(db, 'patients', selectedPatientId, 'notes'), noteData);
			
			// Also add to history
			await addDoc(collection(db, 'patients', selectedPatientId, 'history'), {
				text: 'Note added',
				createdAt: serverTimestamp(),
			});
			
			// Clear cached extras to trigger reload
			setPatientExtras(prev => {
				const next = { ...prev };
				delete next[selectedPatientId];
				return next;
			});
			
			setNoteContent('');
			alert('Note added successfully.');
		} catch (error) {
			console.error('Failed to add note', error);
			alert('Failed to add note. Please try again.');
		} finally {
			setIsAddingNote(false);
		}
	};

	const handleUploadAttachment = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (!file || !selectedPatientId) return;
		
		try {
			const attachmentData = {
				fileName: file.name,
				sizeLabel: `${(file.size / 1024).toFixed(2)} KB`,
				createdAt: serverTimestamp(),
			};
			
			await addDoc(collection(db, 'patients', selectedPatientId, 'attachments'), attachmentData);
			
			// Also add to history
			await addDoc(collection(db, 'patients', selectedPatientId, 'history'), {
				text: `Attachment uploaded: ${file.name}`,
				createdAt: serverTimestamp(),
			});
			
			// Clear cached extras to trigger reload
			setPatientExtras(prev => {
				const next = { ...prev };
				delete next[selectedPatientId];
				return next;
			});
			
			alert('Attachment uploaded successfully.');
		} catch (error) {
			console.error('Failed to upload attachment', error);
			alert('Failed to upload attachment. Please try again.');
		}
	};

	const handleLogActivity = async () => {
		if (!selectedPatientId) return;
		
		const activity = prompt('Enter activity description:');
		if (!activity?.trim()) return;
		
		try {
			await addDoc(collection(db, 'patients', selectedPatientId, 'history'), {
				text: activity.trim(),
				createdAt: serverTimestamp(),
			});
			
			// Clear cached extras to trigger reload
			setPatientExtras(prev => {
				const next = { ...prev };
				delete next[selectedPatientId];
				return next;
			});
			
			alert('Activity logged successfully.');
		} catch (error) {
			console.error('Failed to log activity', error);
			alert('Failed to log activity. Please try again.');
		}
	};

	const handleProfileAction = (action: string) => () => {
		if (action === 'Schedule follow-up' || action === 'Share report' || action === 'Transfer patient') {
			alert(`${action} – functionality coming soon.`);
		}
	};

	const openDialogForCreate = () => {
		setEditingId(null);
		setFormState({
			patientId: '',
			name: '',
			dob: '',
			gender: '',
			phone: '',
			email: '',
			address: '',
			complaint: '',
			status: 'pending',
		});
		setIsDialogOpen(true);
	};

	const openDialogForEdit = (id: string) => {
		const patient = patients.find(p => (p as AdminPatientRecord & { id?: string }).id === id);
		if (!patient) return;
		setEditingId(id);
		setFormState({
			patientId: patient.patientId,
			name: patient.name,
			dob: patient.dob,
			gender: patient.gender,
			phone: patient.phone,
			email: patient.email,
			address: patient.address,
			complaint: patient.complaint,
			status: patient.status,
		});
		setIsDialogOpen(true);
	};

	const closeDialog = () => {
		setIsDialogOpen(false);
		setEditingId(null);
	};

	const handleDeleteClick = (id: string) => {
		const patient = patients.find(p => (p as AdminPatientRecord & { id?: string }).id === id);
		if (!patient) return;
		setDeleteConfirmation({ patient: patient as AdminPatientRecord & { id: string }, nameInput: '' });
	};

	const handleDeleteConfirm = async () => {
		if (!deleteConfirmation.patient || !deleteConfirmation.patient.id) return;

		const patient = deleteConfirmation.patient;
		const patientId = patient.id; // Extract id to ensure it's defined
		if (!patientId) return; // Additional type guard
		
		const enteredName = deleteConfirmation.nameInput.trim();
		const correctName = patient.name.trim();

		// Check if the entered name matches exactly (case-insensitive)
		if (enteredName.toLowerCase() !== correctName.toLowerCase()) {
			return;
		}

		setDeleteConfirmation({ patient: null, nameInput: '' });

		try {
			// First, delete all appointments for this patient
			const appointmentsQuery = query(
				collection(db, 'appointments'),
				where('patientId', '==', patient.patientId)
			);
			const appointmentsSnapshot = await getDocs(appointmentsQuery);
			
			if (appointmentsSnapshot.docs.length > 0) {
				// Use batch write for better performance and atomicity
				const batch = writeBatch(db);
				appointmentsSnapshot.docs.forEach(appointmentDoc => {
					batch.delete(appointmentDoc.ref);
				});
				await batch.commit();
				console.log(`Deleted ${appointmentsSnapshot.docs.length} appointment(s) for patient ${patient.patientId}`);
			}

			// Soft delete the patient (set deleted flag instead of actually deleting)
			// patientId is guaranteed to be a string at this point due to the checks above
			await updateDoc(doc(db, 'patients', patientId as string), {
				deleted: true,
				deletedAt: serverTimestamp(),
				status: 'cancelled',
			});

			// Notify other admins about patient deletion
			await notifyAdmins(
				'Patient Deleted',
				`${user?.displayName || user?.email || 'Admin'} deleted patient: ${patient.name} (ID: ${patient.patientId})`,
				'patient_deleted',
				{
					patientId: patient.patientId,
					patientName: patient.name,
					deletedBy: user?.uid || '',
					deletedByName: user?.displayName || user?.email || 'Unknown',
				},
				user?.uid
			);

			// Show success message
			const appointmentCount = appointmentsSnapshot.docs.length;
			const appointmentText = appointmentCount === 1 ? 'appointment' : 'appointments';
			alert(
				`✅ Patient "${patient.name}" (ID: ${patient.patientId}) has been successfully deleted.\n\n` +
				`${appointmentCount > 0 ? `${appointmentCount} associated ${appointmentText} ${appointmentCount === 1 ? 'was' : 'were'} also deleted. ` : ''}` +
				`The patient has been moved to past patients.`
			);

			// Automatically switch to past patients view
			setShowDeletedPatients(true);
		} catch (error) {
			console.error('Failed to delete patient', error);
			alert('❌ Failed to delete patient. Please try again.');
		}
	};

	const handleDeleteCancel = () => {
		setDeleteConfirmation({ patient: null, nameInput: '' });
	};

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();

		const trimmedId = formState.patientId.trim();
		const trimmedName = formState.name.trim();
		const trimmedPhone = formState.phone.trim();
		const trimmedEmail = formState.email.trim();

		if (!trimmedId || !trimmedName) {
			alert('Patient ID and name are required.');
			return;
		}

		// Check for duplicate patient ID
		const duplicateId = patients.some(record => {
			if (editingId && (record as AdminPatientRecord & { id?: string }).id === editingId) return false;
			return record.patientId.toLowerCase() === trimmedId.toLowerCase();
		});
		if (duplicateId) {
			alert('Another patient already uses this ID.');
			return;
		}

		try {
			const patientData = {
				patientId: trimmedId,
				name: trimmedName,
				dob: normalizeDateInput(formState.dob) || '',
				gender: formState.gender || '',
				phone: trimmedPhone || '',
				email: trimmedEmail || '',
				address: formState.address || '',
				complaint: formState.complaint || '',
				status: formState.status,
				registeredAt: editingId ? undefined : serverTimestamp(),
			};

			console.log('Saving patient...', { editingId, patientData });

			if (editingId) {
				// Update existing patient
				await updateDoc(doc(db, 'patients', editingId), patientData);
				console.log('Patient updated successfully');
				
				// Notify other admins about patient update
				await notifyAdmins(
					'Patient Updated',
					`${user?.displayName || user?.email || 'Admin'} updated patient: ${trimmedName} (ID: ${trimmedId})`,
					'patient_updated',
					{
						patientId: trimmedId,
						patientName: trimmedName,
						updatedBy: user?.uid || '',
						updatedByName: user?.displayName || user?.email || 'Unknown',
					},
					user?.uid
				);
			} else {
				// Create new patient
				const docRef = await addDoc(collection(db, 'patients'), patientData);
				console.log('Patient created successfully with document ID:', docRef.id);
				
				// Notify other admins about new patient
				await notifyAdmins(
					'New Patient Registered',
					`${user?.displayName || user?.email || 'Admin'} registered a new patient: ${trimmedName} (ID: ${trimmedId})`,
					'patient_created',
					{
						patientId: trimmedId,
						patientName: trimmedName,
						createdBy: user?.uid || '',
						createdByName: user?.displayName || user?.email || 'Unknown',
					},
					user?.uid
				);

				// Send registration email if email is provided
				let emailSent = false;
				if (trimmedEmail) {
					try {
						const emailResult = await sendEmailNotification({
							to: trimmedEmail,
							subject: `Welcome to Centre For Sports Science - Patient ID: ${trimmedId}`,
							template: 'patient-registered',
							data: {
								patientName: trimmedName,
								patientEmail: trimmedEmail,
								patientId: trimmedId,
							},
						});
						emailSent = emailResult.success;
					} catch (emailError) {
						// Log error but don't fail registration
						console.error('Failed to send registration email:', emailError);
					}
				}

				// Send registration SMS if phone is provided
				let smsSent = false;
				if (trimmedPhone && isValidPhoneNumber(trimmedPhone)) {
					try {
						const smsResult = await sendSMSNotification({
							to: trimmedPhone,
							template: 'patient-registered',
							data: {
								patientName: trimmedName,
								patientPhone: trimmedPhone,
								patientId: trimmedId,
							},
						});
						smsSent = smsResult.success;
					} catch (smsError) {
						// Log error but don't fail registration
						console.error('Failed to send registration SMS:', smsError);
					}
				}

				// Build confirmation message
				const confirmations = [];
				if (emailSent) confirmations.push('email');
				if (smsSent) confirmations.push('SMS');
				const confirmationText = confirmations.length > 0 
					? ` Confirmation sent via ${confirmations.join(' and ')}.`
					: '';

				// Show success message with confirmation details
				setTimeout(() => {
					alert(`Patient "${trimmedName}" (ID: ${trimmedId}) has been added successfully!${confirmationText}`);
				}, 100);
			}

			// Close dialog and reset form
			setIsDialogOpen(false);
			setEditingId(null);
			setFormState({
				patientId: '',
				name: '',
				dob: '',
				gender: '',
				phone: '',
				email: '',
				address: '',
				complaint: '',
				status: 'pending',
			});
		} catch (error) {
			console.error('Failed to save patient', error);
			const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
			console.error('Error details:', {
				message: errorMessage,
				error,
				formData: formState,
				editingId,
			});
			alert(`Failed to save patient: ${errorMessage}. Please check the console for details.`);
		}
	};

	const validateRegisterForm = () => {
		const errors: Partial<Record<keyof typeof registerForm, string>> = {};
		if (!registerForm.fullName.trim()) {
			errors.fullName = 'Please enter the patient\'s full name.';
		}
		if (!registerForm.dob) {
			errors.dob = 'Please provide the date of birth.';
		}
		if (!registerForm.gender) {
			errors.gender = 'Please select gender.';
		}
		if (!registerForm.phone.trim()) {
			errors.phone = 'Please enter a valid phone number (10-15 digits).';
		} else if (!PHONE_REGEX.test(registerForm.phone.trim())) {
			errors.phone = 'Please enter a valid phone number (10-15 digits).';
		}
		if (registerForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(registerForm.email)) {
			errors.email = 'Please enter a valid email address.';
		}
		if (!registerForm.patientType) {
			errors.patientType = 'Please select Type of Organization.';
		}
		if (registerForm.patientType === 'PAID' && !registerForm.paymentType) {
			errors.paymentType = 'Please select payment type.';
		}

		setRegisterFormErrors(errors);
		return Object.keys(errors).length === 0;
	};

	const handleRegisterPatient = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!validateRegisterForm() || isRegistering) return;

		setIsRegistering(true);
		try {
			const patientId = await generatePatientId();
			
			const patientData = {
				patientId,
				name: registerForm.fullName.trim(),
				dob: registerForm.dob,
				gender: registerForm.gender,
				phone: registerForm.phone.trim(),
				email: registerForm.email.trim() || null,
				address: registerForm.address.trim() || null,
				complaint: '',
				status: 'pending' as AdminPatientStatus,
				registeredAt: serverTimestamp(),
				patientType: registerForm.patientType as 'DYES' | 'VIP' | 'GETHNA' | 'PAID' | 'OTHERS',
				paymentType: registerForm.patientType === 'PAID' ? (registerForm.paymentType as 'with' | 'without') : 'without' as 'with' | 'without',
				paymentDescription: registerForm.patientType === 'PAID' ? (registerForm.paymentDescription.trim() || null) : null,
				sessionAllowance: registerForm.patientType === 'DYES' ? createInitialSessionAllowance() : null,
			};

			await addDoc(collection(db, 'patients'), patientData);

			// Send registration email if email is provided
			let emailSent = false;
			if (registerForm.email.trim()) {
				try {
					const emailResult = await sendEmailNotification({
						to: registerForm.email.trim(),
						subject: `Welcome to Centre For Sports Science - Patient ID: ${patientId}`,
						template: 'patient-registered',
						data: {
							patientName: registerForm.fullName.trim(),
							patientEmail: registerForm.email.trim(),
							patientId,
						},
					});
					emailSent = emailResult.success;
				} catch (emailError) {
					console.error('Failed to send registration email:', emailError);
				}
			}

			// Send registration SMS if phone is provided
			let smsSent = false;
			if (registerForm.phone.trim() && isValidPhoneNumber(registerForm.phone.trim())) {
				try {
					const smsResult = await sendSMSNotification({
						to: registerForm.phone.trim(),
						template: 'patient-registered',
						data: {
							patientName: registerForm.fullName.trim(),
							patientPhone: registerForm.phone.trim(),
							patientId,
						},
					});
					smsSent = smsResult.success;
				} catch (smsError) {
					console.error('Failed to send registration SMS:', smsError);
				}
			}

			// Notify other admins
			await notifyAdmins(
				'New Patient Registered',
				`${user?.displayName || user?.email || 'Super Admin'} registered a new patient: ${registerForm.fullName.trim()} (ID: ${patientId})`,
				'patient_created',
				{
					patientId,
					patientName: registerForm.fullName.trim(),
					createdBy: user?.uid || '',
					createdByName: user?.displayName || user?.email || 'Unknown',
				},
				user?.uid
			);

			// Build confirmation message
			const confirmations = [];
			if (emailSent) confirmations.push('email');
			if (smsSent) confirmations.push('SMS');
			const confirmationText = confirmations.length > 0 
				? ` Confirmation sent via ${confirmations.join(' and ')}.`
				: '';

			alert(`Patient "${registerForm.fullName.trim()}" has been assigned ID ${patientId}.${confirmationText}`);

			// Reset form and close modal
			setRegisterForm({
				fullName: '',
				dob: '',
				gender: '',
				phone: '',
				email: '',
				address: '',
				patientType: '',
				paymentType: '',
				paymentDescription: '',
			});
			setRegisterFormErrors({});
			setShowRegisterModal(false);
		} catch (error) {
			console.error('Failed to register patient', error);
			alert(`Failed to register patient: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setIsRegistering(false);
		}
	};

	const handleExportCsv = () => {
		if (!patients.length) {
			alert('No patients found to export.');
			return;
		}

		const headers = [
			'patientId',
			'name',
			'dob',
			'gender',
			'phone',
			'email',
			'address',
			'complaint',
			'status',
			'registeredAt',
		] as const;

		const rows = patients.map(patient =>
			headers
				.map(key => {
					const value = patient[key] ?? '';
					return `"${String(value).replace(/"/g, '""')}"`;
				})
				.join(',')
		);

		const csvContent = [headers.join(','), ...rows].join('\n');
		const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);

		const tempLink = document.createElement('a');
		tempLink.href = url;
		tempLink.setAttribute('download', `patients-${new Date().toISOString().slice(0, 10)}.csv`);
		document.body.appendChild(tempLink);
		tempLink.click();
		document.body.removeChild(tempLink);
		URL.revokeObjectURL(url);
	};

	// Backup all patient data as CSV
	const handleBackup = async () => {
		if (!patients.length) {
			alert('No patients found to backup.');
			return;
		}

		setIsBackingUp(true);
		try {
			const headers = [
				'id',
				'patientId',
				'name',
				'dob',
				'gender',
				'phone',
				'email',
				'address',
				'complaint',
				'status',
				'registeredAt',
				'assignedDoctor',
				'noteCount',
				'attachmentCount',
				'historyCount',
				'notesPreview',
				'historyPreview',
			] as const;

			const rows: string[] = [];

			for (const patient of patients) {
				const patientId = (patient as AdminPatientRecord & { id?: string }).id;
				if (!patientId) continue;

				try {
					const [notesSnap, attachmentsSnap, historySnap] = await Promise.all([
						getDocs(collection(db, 'patients', patientId, 'notes')),
						getDocs(collection(db, 'patients', patientId, 'attachments')),
						getDocs(collection(db, 'patients', patientId, 'history')),
					]);

					const notes = notesSnap.docs.map(d => (d.data().content || '').replace(/[\r\n]+/g, ' ').trim());
					const attachments = attachmentsSnap.docs;
					const history = historySnap.docs.map(d => (d.data().text || '').replace(/[\r\n]+/g, ' ').trim());

					const safe = (value: unknown) => {
						const str = value ?? '';
						return `"${String(str).replace(/"/g, '""')}"`;
					};

					rows.push(
						headers
							.map(key => {
								switch (key) {
									case 'id':
										return safe(patientId);
									case 'assignedDoctor':
										return safe((patient as { assignedDoctor?: string }).assignedDoctor ?? '');
									case 'noteCount':
										return notes.length.toString();
									case 'attachmentCount':
										return attachments.length.toString();
									case 'historyCount':
										return history.length.toString();
									case 'notesPreview':
										return safe(notes.slice(0, 3).join(' | '));
									case 'historyPreview':
										return safe(history.slice(0, 3).join(' | '));
									default:
										return safe(patient[key] ?? '');
								}
							})
							.join(',')
					);
				} catch (error) {
					console.error(`Failed to include patient ${patientId} in backup`, error);
				}
			}

			const csvContent = [headers.join(','), ...rows].join('\n');
			const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
			const url = URL.createObjectURL(blob);

			const link = document.createElement('a');
			link.href = url;
			link.setAttribute('download', `patients-backup-${new Date().toISOString().slice(0, 10)}.csv`);
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);

			alert(`Backup created for ${rows.length} patient(s).`);
			setIsBackupOpen(false);
		} catch (error) {
			console.error('Backup failed', error);
			alert('Failed to create CSV backup. Please try again.');
		} finally {
			setIsBackingUp(false);
		}
	};

	// Restore patient data from backup
	const handleRestoreFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (!file) return;

		if (!file.name.endsWith('.json')) {
			alert('Please select a valid JSON backup file.');
			return;
		}

		setRestoreFile(file);
	};

	const handleRestore = async () => {
		if (!restoreFile) {
			alert('Please select a backup file to restore.');
			return;
		}

		const confirmed = window.confirm(
			'WARNING: Restoring will overwrite existing patient data. This action cannot be undone. Are you sure you want to continue?'
		);
		if (!confirmed) return;

		setIsRestoring(true);
		try {
			const fileText = await restoreFile.text();
			const backupData = JSON.parse(fileText);

			if (!backupData.patients || !Array.isArray(backupData.patients)) {
				throw new Error('Invalid backup file format.');
			}

			let restoredCount = 0;
			let errorCount = 0;

			// Process patients in batches
			const batchSize = 100;
			for (let i = 0; i < backupData.patients.length; i += batchSize) {
				const batch = writeBatch(db);
				const patientBatch = backupData.patients.slice(i, i + batchSize);

				for (const patientBackup of patientBatch) {
					try {
						const patientRef = doc(db, 'patients', patientBackup.id);
						batch.set(patientRef, {
							...patientBackup.data,
							registeredAt: patientBackup.data.registeredAt || serverTimestamp(),
						}, { merge: true });

						restoredCount++;
					} catch (error) {
						console.error(`Failed to restore patient ${patientBackup.id}:`, error);
						errorCount++;
					}
				}

				await batch.commit();
			}

			// Restore subcollections (notes, attachments, history)
			for (const patientBackup of backupData.patients) {
				try {
					const patientId = patientBackup.id;

					// Restore notes
					if (patientBackup.notes && patientBackup.notes.length > 0) {
						const notesBatch = writeBatch(db);
						for (const note of patientBackup.notes) {
							const noteRef = doc(collection(db, 'patients', patientId, 'notes'), note.id);
							notesBatch.set(noteRef, {
								content: note.content,
								createdAt: note.createdAt ? new Date(note.createdAt) : serverTimestamp(),
							}, { merge: true });
						}
						await notesBatch.commit();
					}

					// Restore attachments
					if (patientBackup.attachments && patientBackup.attachments.length > 0) {
						const attachmentsBatch = writeBatch(db);
						for (const attachment of patientBackup.attachments) {
							const attachmentRef = doc(collection(db, 'patients', patientId, 'attachments'), attachment.id);
							attachmentsBatch.set(attachmentRef, {
								fileName: attachment.fileName,
								sizeLabel: attachment.sizeLabel,
								url: attachment.url,
								createdAt: attachment.createdAt ? new Date(attachment.createdAt) : serverTimestamp(),
							}, { merge: true });
						}
						await attachmentsBatch.commit();
					}

					// Restore history
					if (patientBackup.history && patientBackup.history.length > 0) {
						const historyBatch = writeBatch(db);
						for (const historyItem of patientBackup.history) {
							const historyRef = doc(collection(db, 'patients', patientId, 'history'), historyItem.id);
							historyBatch.set(historyRef, {
								text: historyItem.text,
								createdAt: historyItem.createdAt ? new Date(historyItem.createdAt) : serverTimestamp(),
							}, { merge: true });
						}
						await historyBatch.commit();
					}
				} catch (error) {
					console.error(`Failed to restore subcollections for patient ${patientBackup.id}:`, error);
					errorCount++;
				}
			}

			alert(
				`Restore completed. ${restoredCount} patient(s) restored successfully.${errorCount > 0 ? ` ${errorCount} error(s) occurred.` : ''}`
			);
			setIsRestoreOpen(false);
			setRestoreFile(null);
			if (restoreFileInputRef.current) {
				restoreFileInputRef.current.value = '';
			}
		} catch (error) {
			console.error('Restore failed', error);
			alert(`Failed to restore backup: ${error instanceof Error ? error.message : 'Unknown error'}. Please check the backup file and try again.`);
		} finally {
			setIsRestoring(false);
		}
	};

	const syncPatientStatuses = async () => {
		if (isSyncingStatuses) return;
		
		const confirmed = confirm('This will check all patients and update their status to "completed" if all their appointments are completed. Continue?');
		if (!confirmed) return;
		
		setIsSyncingStatuses(true);
		let updated = 0;
		let errors = 0;
		const updateLog: string[] = [];
		
		try {
			console.log('🔄 Starting patient status sync...');
			
			// Get all appointments from database
			const appointmentsSnapshot = await getDocs(collection(db, 'appointments'));
			const allAppointments = appointmentsSnapshot.docs.map(doc => ({
				id: doc.id,
				...doc.data()
			}));
			
			console.log(`Found ${allAppointments.length} total appointments`);
			
			// Group appointments by patientId
			const appointmentsByPatient = new Map<string, any[]>();
			allAppointments.forEach((apt: any) => {
				if (apt.patientId) {
					if (!appointmentsByPatient.has(apt.patientId)) {
						appointmentsByPatient.set(apt.patientId, []);
					}
					appointmentsByPatient.get(apt.patientId)!.push(apt);
				}
			});
			
			// Check each patient
			for (const patient of patients) {
				if (!patient.id || !patient.patientId) continue;
				
				const patientAppointments = appointmentsByPatient.get(patient.patientId) || [];
				
				if (patientAppointments.length === 0) continue;
				
				// Check if all appointments are completed or cancelled
				const allCompleted = patientAppointments.every((apt: any) => 
					apt.status === 'completed' || apt.status === 'cancelled'
				);
				
				// Update patient status if needed
				if (allCompleted && patient.status !== 'completed') {
					try {
						const patientRef = doc(db, 'patients', patient.id);
						await updateDoc(patientRef, {
							status: 'completed',
						});
						updated++;
						const logMsg = `✅ Updated ${patient.name} (${patient.patientId}) to completed`;
						console.log(logMsg);
						updateLog.push(logMsg);
					} catch (error) {
						errors++;
						const logMsg = `❌ Failed to update ${patient.name} (${patient.patientId}): ${error instanceof Error ? error.message : 'Unknown error'}`;
						console.error(logMsg);
						updateLog.push(logMsg);
					}
				}
			}
			
			console.log(`✅ Sync complete! Updated ${updated} patient(s).${errors > 0 ? ` ${errors} error(s).` : ''}`);
			if (updateLog.length > 0) {
				console.log('Update log:', updateLog);
			}
			
			alert(`Status sync complete!\n\nUpdated: ${updated} patient(s)${errors > 0 ? `\nErrors: ${errors}` : ''}\n\nCheck console for details.`);
		} catch (error) {
			console.error('❌ Failed to sync patient statuses:', error);
			alert(`Failed to sync patient statuses: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setIsSyncingStatuses(false);
		}
	};

	return (
		<div className="min-h-svh bg-slate-50 px-6 py-10">
			<div className="mx-auto max-w-6xl space-y-10">
				<div className="flex items-center justify-between">
					<PageHeader
						title="Patient Management"
					/>
					<button
						type="button"
						onClick={syncPatientStatuses}
						disabled={isSyncingStatuses}
						className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{isSyncingStatuses ? (
							<>
								<div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
								Syncing...
							</>
						) : (
							<>
								<i className="fas fa-sync-alt" />
								Sync Patient Statuses
							</>
						)}
					</button>
				</div>

				<div className="border-t border-slate-200" />

				<section>
					<div className="card-container">
						<div className="flex w-full flex-col gap-3 md:flex-row md:items-end md:gap-4">
							<div className="w-full md:w-[360px]">
								<label className="block text-sm font-medium text-slate-700">Search patients</label>
								<div className="relative mt-2">
									<i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400" aria-hidden="true" />
									<input
										type="search"
										value={searchTerm}
										onChange={event => setSearchTerm(event.target.value)}
										className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm text-slate-700 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
										placeholder="Filter by name, ID, or phone"
									/>
								</div>
							</div>
							<div className="w-full md:w-40">
								<label className="block text-sm font-medium text-slate-700">Status filter</label>
								<select
									value={statusFilter}
									onChange={event => setStatusFilter(event.target.value as 'all' | AdminPatientStatus)}
									className="select-base"
								>
									{statusFilterOptions.map(option => (
										<option key={option.value} value={option.value}>
											{option.label}
										</option>
									))}
								</select>
							</div>
						</div>

						{/* Registered date filter */}
						<div className="mt-4">
							<label className="block text-sm font-medium text-slate-700">Registered</label>
							<div className="mt-2 flex items-center gap-2">
								<input
									type="date"
									value={dateFrom}
									onChange={e => setDateFrom(e.target.value)}
									className="w-full max-w-[180px] rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
								/>
								<span className="text-xs text-slate-500">to</span>
								<input
									type="date"
									value={dateTo}
									onChange={e => setDateTo(e.target.value)}
									className="w-full max-w-[180px] rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
								/>
							</div>
						</div>

						{/* Doctor filter */}
						<div className="mt-4">
								<label className="block text-sm font-medium text-slate-700">Assigned doctor</label>
								<select
									value={doctorFilter}
									onChange={event => setDoctorFilter(event.target.value as 'all' | string)}
									className="select-base mt-2 w-full md:w-40 lg:w-48"
								>
									<option value="all">All doctors</option>
									{doctorOptions.map(option => (
										<option key={option} value={option}>
											{option}
										</option>
									))}
								</select>
							</div>
						</div>

						<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end sm:gap-4 mt-4">
							{/* Actions Dropdown */}
							<div className="relative actions-dropdown-container">
							<button
								type="button"
									onClick={() => setShowActionsDropdown(!showActionsDropdown)}
									className="inline-flex items-center rounded-lg bg-gradient-to-r from-blue-900 via-blue-800 to-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-900/40 transition-all hover:from-blue-800 hover:via-blue-700 hover:to-blue-600 hover:shadow-xl hover:shadow-blue-900/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
							>
									<i className="fas fa-ellipsis-v mr-2 text-sm" aria-hidden="true" />
									Actions
									<i className={`fas fa-chevron-${showActionsDropdown ? 'up' : 'down'} ml-2 text-xs`} aria-hidden="true" />
							</button>
								
								{showActionsDropdown && (
									<>
										<div 
											className="fixed inset-0 z-10" 
											onClick={() => setShowActionsDropdown(false)}
											aria-hidden="true"
										/>
										<div className="absolute right-0 z-20 mt-2 w-56 origin-top-right rounded-xl bg-white shadow-xl ring-1 ring-black ring-opacity-5 border border-blue-200">
											<div className="py-1" role="menu" aria-orientation="vertical">
												<button
													type="button"
													onClick={() => {
														setShowRegisterModal(true);
														setShowActionsDropdown(false);
													}}
													className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
													role="menuitem"
												>
													<i className="fas fa-user-plus text-emerald-600" aria-hidden="true" />
													<span className="font-medium">Register Patient</span>
												</button>
												<button
													type="button"
													onClick={() => {
														setBookingForm({
															patientId: '',
															doctor: '',
															date: '',
															time: '',
															notes: '',
														});
														setIsBookingModalOpen(true);
														setShowActionsDropdown(false);
													}}
													className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
													role="menuitem"
												>
													<i className="fas fa-calendar-plus text-blue-600" aria-hidden="true" />
													<span className="font-medium">Book Appointment</span>
												</button>
												{!showDeletedPatients && (
													<button
														type="button"
														onClick={() => {
															handleBulkDeactivate();
															setShowActionsDropdown(false);
														}}
														className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-amber-50 hover:text-amber-700 transition-colors"
														role="menuitem"
													>
														<i className="fas fa-user-slash text-amber-600" aria-hidden="true" />
														<span className="font-medium">Bulk Deactivate</span>
													</button>
												)}
							<button
								type="button"
													onClick={() => {
														handleExportCsv();
														setShowActionsDropdown(false);
													}}
													disabled={filteredPatients.length === 0}
													className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-slate-700"
													role="menuitem"
												>
													<i className="fas fa-file-csv text-blue-600" aria-hidden="true" />
													<span className="font-medium">Export CSV</span>
							</button>
							<button
								type="button"
													onClick={() => {
														setShowDeletedPatients(!showDeletedPatients);
														setShowActionsDropdown(false);
													}}
													className={`flex w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
														showDeletedPatients
															? 'bg-amber-50 text-amber-700'
															: 'text-slate-700 hover:bg-amber-50 hover:text-amber-700'
													}`}
													role="menuitem"
												>
													<i className={`fas ${showDeletedPatients ? 'fa-eye-slash' : 'fa-history'} text-amber-600`} aria-hidden="true" />
													<span className="font-medium">
														{showDeletedPatients ? 'Show Active Patients' : 'View Past Patients'}
													</span>
							</button>
											</div>
										</div>
									</>
								)}
							</div>
						</div>
				</section>

				<section className="mx-auto mt-8 max-w-6xl">
					<div className="section-card">
						{loading ? (
							<div className="py-12 text-center text-sm text-slate-500">
								<div className="loading-spinner h-10 w-10" aria-hidden="true" />
								<span className="ml-3 align-middle">Loading patients…</span>
							</div>
						) : filteredPatients.length === 0 ? (
							<div className="py-12 text-center text-sm text-slate-500">
								<p className="font-medium text-slate-700">No patients match your filters.</p>
								<p className="mt-1">Try adjusting the search or add a new profile to keep testing data fresh.</p>
							</div>
						) : (
							<div className="w-full">
								<table className="w-full divide-y divide-slate-200 text-left text-sm text-slate-700 table-fixed">
									<thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
										<tr>
											<th className="w-12 px-2 py-3 font-semibold">
												<input
													type="checkbox"
													checked={selectedPatientIds.size === filteredPatients.length && filteredPatients.length > 0}
													onChange={handleSelectAll}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
												/>
											</th>
											<th className="w-10 px-2 py-3 font-semibold">#</th>
											<th className="w-32 px-2 py-3 font-semibold">Patient ID</th>
											<th className="w-28 px-2 py-3 font-semibold">Name</th>
											<th className="w-24 px-2 py-3 font-semibold">Department</th>
											<th className="w-20 px-2 py-3 font-semibold">Gender</th>
											<th className="w-28 px-2 py-3 font-semibold">Phone</th>
											<th className="w-32 px-2 py-3 font-semibold">Assigned Therapist</th>
											<th className="w-24 px-2 py-3 font-semibold">Status</th>
											<th className="w-36 px-2 py-3 font-semibold">Registered</th>
											<th className="w-24 px-2 py-3 font-semibold text-center">Actions</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-slate-100">
										{filteredPatients.map(({ patient, index, id }, row) => (
											<tr key={`${patient.patientId}-${id}`}>
												<td className="px-2 py-4">
													<input
														type="checkbox"
														checked={selectedPatientIds.has(id)}
														onChange={() => handleToggleSelection(id)}
														className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
													/>
												</td>
												<td className="px-2 py-4 text-xs text-slate-500">{row + 1}</td>
												<td className="px-2 py-4 text-xs font-semibold text-slate-800" title={patient.patientId || '—'}>
													{formatPatientIdShort(patient.patientId, 8)}
												</td>
												<td className="px-2 py-4 text-xs text-slate-700">
													<div className="truncate" title={patient.name || 'Unnamed patient'}>
														{patient.name || 'Unnamed patient'}
													</div>
													{patient.deleted && (
														<span className="mt-1 inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
															Past
														</span>
													)}
												</td>
												<td className="px-2 py-4 text-xs text-slate-600 truncate">
													{(patient.patientType || '').toUpperCase() || '—'}
												</td>
												<td className="px-2 py-4 text-xs text-slate-600">{patient.gender || '—'}</td>
												<td className="px-2 py-4 text-xs text-slate-600 truncate" title={patient.phone || '—'}>
													{patient.phone || '—'}
												</td>
												<td className="px-2 py-4 text-xs text-slate-600 truncate" title={patient.assignedDoctor || '—'}>
													{(() => {
														const assignedDoctor = patient.assignedDoctor;
														const transferredFrom = patient.transferredFromDoctor;
														const transferReason = patient.transferReason;
														
														// Show "original --> current" format only for leave handovers
														if (transferredFrom && transferReason === 'Leave approval' && assignedDoctor) {
															return `${transferredFrom} --> ${assignedDoctor}`;
														}
														return assignedDoctor || '—';
													})()}
												</td>
												<td className="px-2 py-4">
													<span
														className={[
															'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
															patient.status === 'completed'
															? 'bg-emerald-100 text-emerald-700'
															: patient.status === 'ongoing'
																? 'bg-sky-100 text-sky-700'
																: patient.status === 'cancelled'
																	? 'bg-rose-100 text-rose-600'
																	: 'bg-amber-100 text-amber-700',
														].join(' ')}
													>
														{patient.status.charAt(0).toUpperCase() + patient.status.slice(1)}
													</span>
												</td>
												<td className="px-2 py-4 text-[10px] text-slate-500 truncate" title={showDeletedPatients && patient.deletedAt 
													? `Removed: ${formatDateTime(patient.deletedAt)}`
													: formatDateTime(patient.registeredAt)}>
													{showDeletedPatients && patient.deletedAt 
														? `Removed: ${formatDateTime(patient.deletedAt)}`
														: formatDateTime(patient.registeredAt)}
												</td>
												<td className="px-2 py-4 text-center">
													<div className="inline-flex items-center gap-1">
														<button
															type="button"
															onClick={() => setSelectedPatientId(id)}
															className="inline-flex items-center justify-center rounded-full border border-sky-200 px-1.5 py-1 text-sky-700 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800 focus-visible:border-sky-300 focus-visible:text-sky-800 focus-visible:outline-none"
															title="View profile"
														>
															<i className="fas fa-user text-[10px]" aria-hidden="true" />
														</button>
														{!showDeletedPatients && !patient.deleted && (
															<button
																type="button"
																onClick={() => handleDeleteClick(id)}
																className="inline-flex items-center justify-center rounded-full border border-rose-200 px-1.5 py-1 text-rose-600 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 focus-visible:border-rose-300 focus-visible:text-rose-700 focus-visible:outline-none"
																title="Delete"
															>
																<i className="fas fa-trash text-[10px]" aria-hidden="true" />
															</button>
														)}
													</div>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</div>
				</section>

				{/* Selected patient profile modal */}
				{selectedPatient && (
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6"
						onClick={closeProfile}
						role="dialog"
						aria-modal="true"
					>
						<div
							className="w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
							onClick={event => event.stopPropagation()}
						>
							<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4 sticky top-0 bg-white z-10">
								<div>
									<h2 className="text-lg font-semibold text-slate-900">Patient profile</h2>
									<p className="text-xs text-slate-500">ID: {selectedPatient.patientId || '—'}</p>
								</div>
							</header>

							<div className="grid max-h-[calc(90vh-64px)] gap-4 overflow-y-auto px-6 py-6 lg:grid-cols-[1.2fr,0.8fr]">
								<section className="space-y-4">
									<div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
										<h3 className="text-sm font-semibold text-slate-800">Personal details</h3>
										<dl className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
											<div>
												<dt className="font-semibold text-slate-500">Name</dt>
												<dd>{selectedPatient.name || '—'}</dd>
											</div>
											<div>
												<dt className="font-semibold text-slate-500">Patient ID</dt>
												<dd>{selectedPatient.patientId || '—'}</dd>
											</div>
											<div>
												<dt className="font-semibold text-slate-500">Date of birth</dt>
												<dd>{formatDate(selectedPatient.dob)}</dd>
											</div>
											<div>
												<dt className="font-semibold text-slate-500">Gender</dt>
												<dd>{selectedPatient.gender || '—'}</dd>
											</div>
											<div>
												<dt className="font-semibold text-slate-500">Phone</dt>
												<dd>{selectedPatient.phone || '—'}</dd>
											</div>
											<div>
												<dt className="font-semibold text-slate-500">Email</dt>
												<dd>{selectedPatient.email || '—'}</dd>
											</div>
											<div className="sm:col-span-2">
												<dt className="font-semibold text-slate-500">Address</dt>
												<dd>{selectedPatient.address || '—'}</dd>
											</div>
										</dl>
									</div>

								</section>

								{/* Sidebar */}
								<aside className="space-y-4">
									{/* Billing Info */}
									<div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
										<h3 className="text-sm font-semibold text-slate-800">Billing</h3>
										<dl className="mt-3 space-y-2 text-xs">
											<div className="flex justify-between">
												<dt className="font-semibold text-slate-500">Total Amount</dt>
												<dd className="font-semibold text-slate-900">₹{billingSummary.totalAmount.toLocaleString()}</dd>
											</div>
											<div className="flex justify-between">
												<dt className="font-semibold text-slate-500">Amount Paid</dt>
												<dd className="font-semibold text-emerald-700">₹{billingSummary.totalPaid.toLocaleString()}</dd>
											</div>
											<div className="flex justify-between">
												<dt className="font-semibold text-slate-500">Amount Pending</dt>
												<dd className="font-semibold text-amber-700">₹{billingSummary.totalPending.toLocaleString()}</dd>
											</div>
										</dl>
									</div>

									{/* Sessions */}
									<div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
										<h3 className="text-sm font-semibold text-slate-800 mb-3">Sessions</h3>
										<dl className="space-y-2 text-xs">
											<div className="flex justify-between">
												<dt className="font-semibold text-slate-500">Total Sessions</dt>
												<dd className="font-semibold text-slate-900">
													{selectedPatient?.totalSessionsRequired || 0}
												</dd>
											</div>
											<div className="flex justify-between">
												<dt className="font-semibold text-slate-500">Completed</dt>
												<dd className="font-semibold text-emerald-700">
													{(() => {
														const total = selectedPatient?.totalSessionsRequired || 0;
														const remaining = selectedPatient?.remainingSessions || 0;
														return Math.max(0, total - remaining);
													})()}
												</dd>
											</div>
											<div className="flex justify-between">
												<dt className="font-semibold text-slate-500">Remaining</dt>
												<dd className="font-semibold text-amber-700">
													{selectedPatient?.remainingSessions || 0}
												</dd>
											</div>
											<div className="pt-2 border-t border-slate-200">
												<dt className="font-semibold text-slate-500 mb-1">Next Session</dt>
												{nextSession ? (
													<dd className="text-slate-600">
														<p className="font-semibold text-slate-900">{formatDate(nextSession.date)}</p>
														{nextSession.time && (
															<p className="mt-1 text-slate-500">{nextSession.time}</p>
														)}
													</dd>
												) : (
													<dd className="text-slate-500">No upcoming sessions</dd>
												)}
											</div>
										</dl>
									</div>

									{/* Feedback */}
									<div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
										<h3 className="text-sm font-semibold text-slate-800">Patient Feedback</h3>
										<p className="mt-3 text-xs text-slate-500">
											{selectedPatient?.feedback || 'No feedback available'}
										</p>
									</div>

									{/* Reports */}
									<div className="rounded-xl border border-blue-200 bg-white p-4 shadow-sm">
										<h3 className="text-sm font-semibold text-slate-800 mb-3">Reports</h3>
										<button
											type="button"
											onClick={() => {
												setShowReportModal(true);
												setReportModalPatientId(selectedPatient?.patientId || null);
											}}
											className="w-full inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-3 text-sm font-semibold text-white transition hover:from-blue-700 hover:to-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 shadow-sm"
										>
											<i className="fas fa-file-medical mr-2" aria-hidden="true" />
											View Reports
										</button>
									</div>
								</aside>
							</div>
						</div>
					</div>
				)}

				{/* Create / Edit dialog */}
				{isDialogOpen && (
					<div
						role="dialog"
						aria-modal="true"
						className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6"
					>
						<div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
							<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
								<h2 className="text-lg font-semibold text-slate-900">
									{editingId !== null ? 'Edit Patient' : 'Add Patient'}
								</h2>
								<button
									type="button"
									onClick={closeDialog}
									className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:bg-slate-100 focus-visible:text-slate-600 focus-visible:outline-none"
									aria-label="Close dialog"
								>
									<i className="fas fa-times" aria-hidden="true" />
								</button>
							</header>

							<form onSubmit={handleSubmit} className="grid gap-4 px-6 py-6 sm:grid-cols-2">
								<div>
									<label className="block text-sm font-medium text-slate-700">Patient ID *</label>
									<input
										type="text"
										value={formState.patientId}
										onChange={event =>
											setFormState(current => ({ ...current, patientId: event.target.value }))
										}
										className="input-base"
										required
									/>
								</div>
								<div>
									<label className="block text-sm font-medium text-slate-700">Full name *</label>
									<input
										type="text"
										value={formState.name}
										onChange={event =>
											setFormState(current => ({ ...current, name: event.target.value }))
										}
										className="input-base"
										required
									/>
								</div>
								<div>
									<label className="block text-sm font-medium text-slate-700">Date of birth</label>
									<input
										type="date"
										value={formState.dob}
										onChange={event =>
											setFormState(current => ({ ...current, dob: event.target.value }))
										}
										className="input-base"
									/>
								</div>
								<div>
									<label className="block text-sm font-medium text-slate-700">Gender</label>
									<select
										value={formState.gender}
										onChange={event =>
											setFormState(current => ({
												...current,
												gender: event.target.value as AdminGenderOption,
											}))
										}
										className="select-base"
									>
										{genderOptions.map(option => (
											<option key={option.value} value={option.value}>
												{option.label}
											</option>
										))}
									</select>
								</div>
								<div>
									<label className="block text-sm font-medium text-slate-700">Phone</label>
									<input
										type="tel"
										value={formState.phone}
										onChange={event =>
											setFormState(current => ({ ...current, phone: event.target.value }))
										}
										className="input-base"
									/>
								</div>
								<div>
									<label className="block text-sm font-medium text-slate-700">Email</label>
									<input
										type="email"
										value={formState.email}
										onChange={event =>
											setFormState(current => ({ ...current, email: event.target.value }))
										}
										className="input-base"
									/>
								</div>
								<div>
									<label className="block text-sm font-medium text-slate-700">Status</label>
									<select
										value={formState.status}
										onChange={event =>
											setFormState(current => ({ ...current, status: event.target.value as AdminPatientStatus }))
										}
										className="select-base"
									>
										{statusOptions.map(option => (
											<option key={option.value} value={option.value}>
												{option.label}
											</option>
										))}
									</select>
								</div>
								<div className="sm:col-span-2">
									<label className="block text-sm font-medium text-slate-700">Address</label>
									<input
										type="text"
										value={formState.address}
										onChange={event =>
											setFormState(current => ({ ...current, address: event.target.value }))
										}
										className="input-base"
									/>
								</div>
								<div className="sm:col-span-2">
									<label className="block text-sm font-medium text-slate-700">Medical complaint</label>
									<textarea
										value={formState.complaint}
										onChange={event =>
											setFormState(current => ({ ...current, complaint: event.target.value }))
										}
										className="textarea-base min-h-[96px]"
									/>
								</div>
								<footer className="sm:col-span-2 flex items-center justify-end gap-3 pt-2">
									<button type="button" onClick={closeDialog} className="btn-secondary">
										Cancel
									</button>
									<button type="submit" className="btn-primary">
										{editingId !== null ? 'Save changes' : 'Add patient'}
									</button>
								</footer>
							</form>
						</div>
					</div>
				)}

				{/* Register Patient Modal */}
				{showRegisterModal && (
					<div
						role="dialog"
						aria-modal="true"
						className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6"
						onClick={() => setShowRegisterModal(false)}
					>
						<div
							className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl"
							onClick={e => e.stopPropagation()}
						>
							<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4 sticky top-0 bg-white z-10">
								<h2 className="text-lg font-semibold text-slate-900">Register Patient</h2>
								<button
									type="button"
									onClick={() => setShowRegisterModal(false)}
									className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
									aria-label="Close dialog"
								>
									<i className="fas fa-times" aria-hidden="true" />
								</button>
							</header>

							<form onSubmit={handleRegisterPatient} className="space-y-4 px-6 py-6">
								{/* Row 1: Full Name (6 cols), DOB (3 cols), Gender (3 cols) */}
								<div className="grid gap-4 md:grid-cols-12">
									<div className="md:col-span-6">
										<label className="block text-sm font-medium text-slate-700">
											Full Name <span className="text-rose-600">*</span>
										</label>
										<input
											type="text"
											value={registerForm.fullName}
											onChange={e => {
												setRegisterForm(prev => ({ ...prev, fullName: e.target.value }));
												setRegisterFormErrors(prev => ({ ...prev, fullName: undefined }));
											}}
											className="input-base"
											placeholder="Patient name"
											required
										/>
										{registerFormErrors.fullName && <p className="mt-1 text-xs text-rose-500">{registerFormErrors.fullName}</p>}
									</div>
									<div className="md:col-span-3">
										<label className="block text-sm font-medium text-slate-700">
											Date of Birth <span className="text-rose-600">*</span>
										</label>
										<input
											type="date"
											value={registerForm.dob}
											onChange={e => {
												setRegisterForm(prev => ({ ...prev, dob: e.target.value }));
												setRegisterFormErrors(prev => ({ ...prev, dob: undefined }));
											}}
											className="input-base"
											required
										/>
										{registerFormErrors.dob && <p className="mt-1 text-xs text-rose-500">{registerFormErrors.dob}</p>}
									</div>
									<div className="md:col-span-3">
										<label className="block text-sm font-medium text-slate-700">
											Gender <span className="text-rose-600">*</span>
										</label>
										<select
											value={registerForm.gender}
											onChange={e => {
												setRegisterForm(prev => ({ ...prev, gender: e.target.value as AdminGenderOption }));
												setRegisterFormErrors(prev => ({ ...prev, gender: undefined }));
											}}
											className="input-base"
											required
										>
											{genderOptions.map(option => (
												<option key={option.value} value={option.value}>
													{option.label}
												</option>
											))}
										</select>
										{registerFormErrors.gender && <p className="mt-1 text-xs text-rose-500">{registerFormErrors.gender}</p>}
									</div>
								</div>

								{/* Row 2: Phone (3 cols), Email (6 cols) */}
								<div className="grid gap-4 md:grid-cols-12">
									<div className="md:col-span-3">
										<label className="block text-sm font-medium text-slate-700">
											Phone Number <span className="text-rose-600">*</span>
										</label>
										<input
											type="tel"
											value={registerForm.phone}
											onChange={e => {
												setRegisterForm(prev => ({ ...prev, phone: e.target.value }));
												setRegisterFormErrors(prev => ({ ...prev, phone: undefined }));
											}}
											className="input-base"
											placeholder="10-15 digits"
											required
										/>
										{registerFormErrors.phone && <p className="mt-1 text-xs text-rose-500">{registerFormErrors.phone}</p>}
									</div>
									<div className="md:col-span-6">
										<label className="block text-sm font-medium text-slate-700">Email</label>
										<input
											type="email"
											value={registerForm.email}
											onChange={e => {
												setRegisterForm(prev => ({ ...prev, email: e.target.value }));
												setRegisterFormErrors(prev => ({ ...prev, email: undefined }));
											}}
											className="input-base"
											placeholder="name@example.com"
										/>
										{registerFormErrors.email && <p className="mt-1 text-xs text-rose-500">{registerFormErrors.email}</p>}
									</div>
								</div>

								{/* Row 3: Address */}
								<div className="grid gap-4 md:grid-cols-12">
									<div className="md:col-span-9">
										<label className="block text-sm font-medium text-slate-700">Address</label>
										<textarea
											value={registerForm.address}
											onChange={e => {
												setRegisterForm(prev => ({ ...prev, address: e.target.value }));
											}}
											className="input-base"
											placeholder="Street, city, postal code"
											rows={2}
										/>
									</div>
								</div>

								{/* Row 4: Type of Organization */}
								<div className="grid gap-4 md:grid-cols-12">
									<div className="md:col-span-12">
										<label className="block text-sm font-medium text-slate-700">
											Type of Organization <span className="text-rose-600">*</span>
										</label>
										<div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
											{(['DYES', 'VIP', 'GETHNA', 'PAID', 'OTHERS'] as const).map(type => (
												<label key={type} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 transition hover:border-sky-300 hover:bg-sky-50 cursor-pointer">
													<input
														type="radio"
														name="patientType"
														value={type}
														checked={registerForm.patientType === type}
														onChange={() => {
															setRegisterForm(prev => ({
																...prev,
																patientType: type,
																paymentType: type === 'PAID' ? prev.paymentType : '',
															}));
															setRegisterFormErrors(prev => ({
																...prev,
																patientType: undefined,
																paymentType: undefined,
															}));
														}}
														className="h-4 w-4 border-slate-300 text-sky-600 focus:ring-sky-200"
													/>
													<span className="text-sm font-medium text-slate-700">{type}</span>
												</label>
											))}
										</div>
										{registerFormErrors.patientType && <p className="mt-1 text-xs text-rose-500">{registerFormErrors.patientType}</p>}
									</div>
								</div>

								{/* Row 5: Payment Type and Description - Only visible when patientType is 'PAID' */}
								{registerForm.patientType === 'PAID' && (
									<div className="grid gap-4 md:grid-cols-12">
										<div className="md:col-span-6">
											<label className="block text-sm font-medium text-slate-700">
												Type of Payment <span className="text-rose-600">*</span>
											</label>
											<select
												value={registerForm.paymentType}
												onChange={e => {
													setRegisterForm(prev => ({ ...prev, paymentType: e.target.value as 'with' | 'without' }));
													setRegisterFormErrors(prev => ({ ...prev, paymentType: undefined }));
												}}
												className="input-base"
												required
											>
												<option value="" disabled>Select</option>
												{PAYMENT_OPTIONS.map(option => (
													<option key={option.value} value={option.value}>
														{option.label}
													</option>
												))}
											</select>
											{registerFormErrors.paymentType && <p className="mt-1 text-xs text-rose-500">{registerFormErrors.paymentType}</p>}
										</div>
										<div className="md:col-span-6">
											<label className="block text-sm font-medium text-slate-700">
												Payment Description / Concession Reason
											</label>
											<input
												type="text"
												value={registerForm.paymentDescription}
												onChange={e => {
													setRegisterForm(prev => ({ ...prev, paymentDescription: e.target.value }));
												}}
												className="input-base"
												placeholder="Enter details (if any)"
											/>
										</div>
									</div>
								)}

								<footer className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
									<button
										type="button"
										onClick={() => {
											setShowRegisterModal(false);
											setRegisterForm({
												fullName: '',
												dob: '',
												gender: '',
												phone: '',
												email: '',
												address: '',
												patientType: '',
												paymentType: '',
												paymentDescription: '',
											});
											setRegisterFormErrors({});
										}}
										className="btn-secondary"
									>
										Cancel
									</button>
									<button type="submit" className="btn-primary" disabled={isRegistering}>
										<i className="fas fa-user-plus text-xs mr-2" aria-hidden="true" />
										{isRegistering ? 'Registering...' : 'Register Patient'}
									</button>
								</footer>
							</form>
						</div>
					</div>
				)}

				{/* Import modal */}
				{isImportOpen && (
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6"
						onClick={() => {
							setIsImportOpen(false);
							setImportFile(null);
							setImportPreview([]);
						}}
						role="dialog"
						aria-modal="true"
					>
						<div
							className="w-full max-w-4xl max-h-[85vh] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
							onClick={e => e.stopPropagation()}
						>
							<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4 sticky top-0 bg-white z-10">
								<h2 className="text-lg font-semibold text-slate-900">Import Patients from CSV</h2>
								<button
									type="button"
									onClick={() => {
										setIsImportOpen(false);
										setImportFile(null);
										setImportPreview([]);
									}}
									className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
									aria-label="Close"
								>
									<i className="fas fa-times" aria-hidden="true" />
								</button>
							</header>

							<div className="max-h-[calc(85vh-120px)] overflow-y-auto px-6 py-6">
								<div className="space-y-4">
									<div>
										<label className="block text-sm font-medium text-slate-700 mb-2">
											Select CSV file
										</label>
										<input
											type="file"
											accept=".csv,.xlsx,.xls"
											onChange={handleFileSelect}
											className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
										/>
										{/* helper text removed as requested */}
									</div>

									{importPreview.length > 0 && (
										<div>
											<h3 className="text-sm font-semibold text-slate-800 mb-2">
												Preview (first {importPreview.length} rows)
											</h3>
											<div className="overflow-x-auto rounded-lg border border-slate-200">
												<table className="min-w-full text-xs">
													<thead className="bg-slate-50">
														<tr>
															{Object.keys(importPreview[0] || {}).map(key => (
																<th key={key} className="px-3 py-2 text-left font-semibold text-slate-700">
																	{key}
																</th>
															))}
														</tr>
													</thead>
													<tbody className="divide-y divide-slate-100">
														{importPreview.slice(0, 10).map((row, idx) => (
															<tr key={idx}>
																{Object.values(row).map((val: unknown, i) => (
																	<td key={i} className="px-3 py-2 text-slate-600">
																		{String(val || '—')}
																	</td>
																))}
															</tr>
														))}
													</tbody>
												</table>
											</div>
										</div>
									)}
								</div>
							</div>

							<footer className="flex justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4 sticky bottom-0">
								<button
									type="button"
									onClick={() => {
										setIsImportOpen(false);
										setImportFile(null);
										setImportPreview([]);
									}}
									className="btn-secondary"
								>
									Cancel
								</button>

								{/* Download template inside modal */}
								<button
									type="button"
									onClick={downloadTemplate}
									className="btn-secondary"
								>
									<i className="fas fa-download mr-2" />
									Download Template
								</button>

								<button
									type="button"
									onClick={handleImportConfirm}
									disabled={!importFile}
										className="btn-primary"
								>
									Import {importPreview.length > 0 ? `${importPreview.length} patients` : 'CSV'}
								</button>
							</footer>
						</div>
					</div>
				)}

				{/* Backup Modal */}
				{isBackupOpen && (
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6"
						onClick={() => setIsBackupOpen(false)}
						role="dialog"
						aria-modal="true"
					>
						<div
							className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl"
							onClick={e => e.stopPropagation()}
						>
							<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
								<h2 className="text-lg font-semibold text-slate-900">Backup Patient Data</h2>
								<button
									type="button"
									onClick={() => setIsBackupOpen(false)}
									className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
									aria-label="Close"
								>
									<i className="fas fa-times" aria-hidden="true" />
								</button>
							</header>

							<div className="px-6 py-6">
								<div className="space-y-4">
									<p className="text-sm text-slate-600">
										This will download a CSV backup of patient records including summary info for notes, attachments, and history.
									</p>
									<ul className="list-disc list-inside space-y-1 text-sm text-slate-600 ml-4">
										<li>Patient records</li>
										<li>Notes</li>
										<li>Attachments</li>
										<li>History</li>
									</ul>
									<p className="text-sm font-medium text-slate-700">
										Total patients: {patients.length}
									</p>
								</div>
							</div>

							<footer className="flex justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4">
								<button
									type="button"
									onClick={() => setIsBackupOpen(false)}
									className="btn-secondary"
									disabled={isBackingUp}
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={handleBackup}
									disabled={isBackingUp || patients.length === 0}
										className="btn-primary"
								>
									{isBackingUp ? (
										<>
											<div className="loading-spinner h-4 w-4" aria-hidden="true" />
											Backing up...
										</>
									) : (
										<>
											<i className="fas fa-download text-xs" aria-hidden="true" />
											Create Backup
										</>
									)}
								</button>
							</footer>
						</div>
					</div>
				)}

				{/* Restore Modal */}
				{isRestoreOpen && (
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6"
						onClick={() => {
							setIsRestoreOpen(false);
							setRestoreFile(null);
							if (restoreFileInputRef.current) {
								restoreFileInputRef.current.value = '';
							}
						}}
						role="dialog"
						aria-modal="true"
					>
						<div
							className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl"
							onClick={e => e.stopPropagation()}
						>
							<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
								<h2 className="text-lg font-semibold text-slate-900">Restore Patient Data</h2>
								<button
									type="button"
									onClick={() => {
										setIsRestoreOpen(false);
										setRestoreFile(null);
										if (restoreFileInputRef.current) {
											restoreFileInputRef.current.value = '';
										}
									}}
									className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
									aria-label="Close"
								>
									<i className="fas fa-times" aria-hidden="true" />
								</button>
							</header>

							<div className="px-6 py-6">
								<div className="space-y-4">
									<div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
										<p className="text-sm font-semibold text-amber-800 mb-2">⚠️ Warning</p>
										<p className="text-sm text-amber-700">
											Restoring will overwrite existing patient data. This action cannot be undone. Please ensure you have a current backup before proceeding.
										</p>
									</div>
									<div>
										<label className="block text-sm font-medium text-slate-700 mb-2">
											Select backup file (JSON)
										</label>
										<input
											ref={restoreFileInputRef}
											type="file"
											accept=".json"
											onChange={handleRestoreFileSelect}
											className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
										/>
										{restoreFile && (
											<p className="mt-2 text-xs text-slate-600">
												Selected: {restoreFile.name}
											</p>
										)}
									</div>
								</div>
							</div>

							<footer className="flex justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4">
								<button
									type="button"
									onClick={() => {
										setIsRestoreOpen(false);
										setRestoreFile(null);
										if (restoreFileInputRef.current) {
											restoreFileInputRef.current.value = '';
										}
									}}
									className="btn-secondary"
									disabled={isRestoring}
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={handleRestore}
									disabled={isRestoring || !restoreFile}
										className="btn-primary"
								>
									{isRestoring ? (
										<>
											<div className="loading-spinner h-4 w-4" aria-hidden="true" />
											Restoring...
										</>
									) : (
										<>
											<i className="fas fa-upload text-xs" aria-hidden="true" />
											Restore Backup
										</>
									)}
								</button>
							</footer>
						</div>
					</div>
				)}
			</div>

			{/* Delete Confirmation Modal */}
			{deleteConfirmation.patient && (
				<div
					role="dialog"
					aria-modal="true"
					className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 px-4 py-6"
					onClick={handleDeleteCancel}
				>
					<div
						className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
						onClick={event => event.stopPropagation()}
					>
						<div className="px-6 py-5 border-b border-slate-200">
							<div className="flex items-center gap-3">
								<div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-100">
									<i className="fas fa-exclamation-triangle text-rose-600 text-xl" aria-hidden="true" />
								</div>
								<div>
									<h3 className="text-lg font-semibold text-slate-900">Delete Patient</h3>
									<p className="text-sm text-slate-600">This action cannot be undone</p>
								</div>
							</div>
						</div>

						<div className="px-6 py-5 space-y-4">
							<div className="rounded-lg bg-rose-50 border border-rose-200 p-4">
								<p className="text-sm font-medium text-rose-900 mb-2">
									You are about to delete:
								</p>
								<p className="text-base font-semibold text-slate-900">
									{deleteConfirmation.patient.name}
								</p>
								<p className="text-sm text-slate-600 mt-1">
									ID: {deleteConfirmation.patient.patientId}
								</p>
							</div>

							<div>
								<label className="block text-sm font-semibold text-slate-700 mb-2">
									To confirm, please type the patient's name:
									<span className="font-mono text-blue-600 ml-2">
										{deleteConfirmation.patient.name}
									</span>
								</label>
								<input
									type="text"
									value={deleteConfirmation.nameInput}
									onChange={event => setDeleteConfirmation(prev => ({ ...prev, nameInput: event.target.value }))}
									placeholder="Enter patient name"
									className="w-full rounded-lg border-2 border-slate-300 px-4 py-3 text-sm text-slate-900 transition focus:border-rose-500 focus:outline-none focus:ring-4 focus:ring-rose-100"
									autoFocus
									onKeyDown={event => {
										if (event.key === 'Enter' && deleteConfirmation.nameInput.trim().toLowerCase() === deleteConfirmation.patient?.name.trim().toLowerCase()) {
											handleDeleteConfirm();
										}
									}}
								/>
								{deleteConfirmation.nameInput.trim() && deleteConfirmation.nameInput.trim().toLowerCase() !== deleteConfirmation.patient?.name.trim().toLowerCase() && (
									<p className="mt-2 text-sm text-rose-600 flex items-center gap-2">
										<i className="fas fa-exclamation-circle" aria-hidden="true" />
										The name you entered does not match. Please type the patient name exactly as shown.
									</p>
								)}
							</div>
						</div>

						<div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-3">
							<button
								type="button"
								onClick={handleDeleteCancel}
								className="px-4 py-2 text-sm font-semibold text-slate-700 rounded-lg border border-slate-300 hover:bg-slate-50 transition focus:outline-none focus:ring-2 focus:ring-slate-300"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleDeleteConfirm}
								disabled={
									deleteConfirmation.nameInput.trim().toLowerCase() !== deleteConfirmation.patient?.name.trim().toLowerCase()
								}
								className="px-4 py-2 text-sm font-semibold text-white rounded-lg bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-700 hover:to-rose-800 transition focus:outline-none focus:ring-4 focus:ring-rose-200 disabled:opacity-50 disabled:cursor-not-allowed"
							>
								<span className="flex items-center gap-2">
									<i className="fas fa-trash" aria-hidden="true" />
									Delete Patient
								</span>
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Booking Modal */}
			{isBookingModalOpen && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
					<div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
						<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
							<div>
								<h2 className="text-lg font-semibold text-slate-900">Book Appointment</h2>
								<p className="text-xs text-slate-500">Create a new visit for any patient</p>
							</div>
							<button
								type="button"
								onClick={closeBookingModal}
								className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:bg-slate-100 focus-visible:text-slate-600 focus-visible:outline-none"
								aria-label="Close dialog"
								disabled={bookingLoading}
							>
								<i className="fas fa-times" aria-hidden="true" />
							</button>
						</header>
						<div className="max-h-[70vh] overflow-y-auto px-6 py-4">
							<div className="space-y-4">
								<div>
									<label className="block text-sm font-medium text-slate-700">
										Patient <span className="text-rose-500">*</span>
									</label>
									<select
										value={bookingForm.patientId}
										onChange={event => setBookingForm(prev => ({ ...prev, patientId: event.target.value }))}
										className="select-base mt-2"
										required
										disabled={bookingLoading}
									>
										<option value="">{patientSelectOptions.length ? 'Select patient' : 'No patients available'}</option>
										{patientSelectOptions.map(option => (
											<option key={option.value} value={option.value}>
												{option.label}
											</option>
										))}
									</select>
								</div>

								<div>
									<label className="block text-sm font-medium text-slate-700">
										Clinician <span className="text-rose-500">*</span>
									</label>
									<select
										value={bookingForm.doctor}
										onChange={event => setBookingForm(prev => ({ ...prev, doctor: event.target.value }))}
										className="select-base mt-2"
										disabled={!bookingForm.date || !bookingForm.time || bookingLoading}
										required
									>
										<option value="">
											{!bookingForm.date || !bookingForm.time
												? 'Select date & time first'
												: doctorOptionsForBooking.length
													? 'Select clinician'
													: 'No clinicians available'}
										</option>
										{doctorOptionsForBooking.map(option => (
											<option key={option} value={option}>
												{option}
											</option>
										))}
									</select>
									{(!bookingForm.date || !bookingForm.time) && (
										<p className="mt-1 text-xs text-slate-500">Pick a date and time to view available clinicians.</p>
									)}
									{bookingForm.date && bookingForm.time && doctorOptionsForBooking.length === 0 && (
										<p className="mt-1 text-xs text-amber-600">
											No clinicians have availability for {bookingForm.date} at {bookingForm.time}.
										</p>
									)}
								</div>

								<div className="grid gap-4 sm:grid-cols-2">
									<div>
										<label className="block text-sm font-medium text-slate-700">
											Date <span className="text-rose-500">*</span>
										</label>
										<input
											type="date"
											className="input-base mt-2"
											value={bookingForm.date}
											onChange={event => setBookingForm(prev => ({ ...prev, date: event.target.value }))}
											min={new Date().toISOString().split('T')[0]}
											required
											disabled={bookingLoading}
										/>
									</div>
									<div>
										<label className="block text-sm font-medium text-slate-700">
											Time <span className="text-rose-500">*</span>
										</label>
										<input
											type="time"
											className="input-base mt-2"
											value={bookingForm.time}
											onChange={event => setBookingForm(prev => ({ ...prev, time: event.target.value }))}
											required
											disabled={bookingLoading}
										/>
									</div>
								</div>

								<div>
									<label className="block text-sm font-medium text-slate-700">Notes (optional)</label>
									<textarea
										className="input-base mt-2"
										rows={3}
										value={bookingForm.notes}
										onChange={event => setBookingForm(prev => ({ ...prev, notes: event.target.value }))}
										placeholder="Add any notes for the clinician..."
										disabled={bookingLoading}
									/>
								</div>
							</div>
						</div>
						<footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
							<button type="button" onClick={closeBookingModal} className="btn-secondary" disabled={bookingLoading}>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleCreateAppointment}
								className="btn-primary"
								disabled={
									bookingLoading ||
									!bookingForm.patientId ||
									!bookingForm.doctor ||
									!bookingForm.date ||
									!bookingForm.time
								}
							>
								{bookingLoading ? (
									<>
										<div className="mr-2 inline-flex h-4 w-4 items-center justify-center rounded-full border-2 border-white border-t-transparent animate-spin" />
										Booking...
									</>
								) : (
									<>
										<i className="fas fa-check text-xs" aria-hidden="true" />
										Create Appointment
									</>
								)}
							</button>
						</footer>
					</div>
				</div>
			)}

			{/* Report Modal */}
			<ReportModal
				isOpen={showReportModal}
				patientId={reportModalPatientId}
				initialTab="report"
				onClose={() => {
					setShowReportModal(false);
					setReportModalPatientId(null);
				}}
			/>
		</div>
	);
}
