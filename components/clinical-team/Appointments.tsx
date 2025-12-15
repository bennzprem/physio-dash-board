'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, updateDoc, deleteDoc, addDoc, serverTimestamp, query, where, getDocs, getDoc, type QuerySnapshot, type Timestamp } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/PageHeader';
import type { AdminAppointmentStatus, AdminPatientStatus } from '@/lib/adminMockData';
import type { PatientRecord } from '@/lib/types';
import { sendEmailNotification } from '@/lib/email';
import { sendSMSNotification, isValidPhoneNumber } from '@/lib/sms';
import { checkAppointmentConflict } from '@/lib/appointmentUtils';
import AppointmentTemplates from '@/components/appointments/AppointmentTemplates';
import { normalizeSessionAllowance } from '@/lib/sessionAllowance';
import { recordSessionUsageForAppointment } from '@/lib/sessionAllowanceClient';
import type { RecordSessionUsageResult } from '@/lib/sessionAllowanceClient';
import EditReportModal from '@/components/clinical-team/EditReportModal';

interface FrontdeskAppointment {
	id: string;
	appointmentId: string;
	patientId: string;
	patient: string;
	doctor: string;
	date: string;
	time: string;
	duration?: number;
	status: AdminAppointmentStatus;
	createdAt: string;
	notes?: string;
	sessionNumber?: number;
	totalSessions?: number;
	packageBillingId?: string;
	packageName?: string;
}


const STATUS_BADGES: Record<AdminAppointmentStatus, string> = {
	pending: 'status-badge-pending',
	ongoing: 'status-badge-ongoing',
	completed: 'status-badge-completed',
	cancelled: 'status-badge-cancelled',
};


interface DayAvailability {
	enabled: boolean;
	slots: Array<{ start: string; end: string }>;
}

interface DateSpecificAvailability {
	[date: string]: DayAvailability; // date in YYYY-MM-DD format
}

interface StaffMember {
	id: string;
	userName: string;
	role: string;
	status: string;
	userEmail?: string;
	availability?: {
		[day: string]: DayAvailability;
	};
	dateSpecificAvailability?: DateSpecificAvailability;
}

type DayOfWeek = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';

type PatientRecordWithSessions = PatientRecord & {
	totalSessionsRequired?: number;
	remainingSessions?: number;
	packageName?: string;
	packageAmount?: number;
	concessionPercent?: number;
	paymentType?: string;
	packageDescription?: string;
};

interface BookingForm {
	patientIds: string[]; // Array of selected patient IDs for multiple patients per slot
	staffId: string;
	date: string;
	time: string; // Keep for backward compatibility with templates
	selectedTimes: string[]; // Array of selected time slots for current date
	selectedAppointments: Map<string, string[]>; // Map of date -> array of time slots (saved selections across multiple days)
	notes?: string;
	// Package fields
	addPackage: boolean;
	packageSessions: string;
	packageAmount: string;
	withConsultation: boolean;
	consultationDiscount: string; // Percentage discount (5% to 50%)
}

const SLOT_INTERVAL_MINUTES = 30;

function timeStringToMinutes(value: string) {
	const [hours, minutes] = value.split(':').map(Number);
	if (Number.isNaN(hours) || Number.isNaN(minutes)) return 0;
	return hours * 60 + minutes;
}

function minutesToTimeString(totalMinutes: number) {
	const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
	const hours = Math.floor(normalized / 60);
	const minutes = normalized % 60;
	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatDateLabel(value: string) {
	if (!value) return '—';
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return value;
	return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
}

function normalize(value?: string | null) {
	return value?.trim().toLowerCase() ?? '';
}

export default function Appointments() {
	const { user } = useAuth();
	const [appointments, setAppointments] = useState<FrontdeskAppointment[]>([]);
	const [patients, setPatients] = useState<PatientRecordWithSessions[]>([]);
	const [staff, setStaff] = useState<StaffMember[]>([]);
	const [loading, setLoading] = useState(true);
	const [searchTerm, setSearchTerm] = useState('');
	const [showAllAppointments, setShowAllAppointments] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [notesDraft, setNotesDraft] = useState('');
	const [updating, setUpdating] = useState<Record<string, boolean>>({});
	const [showBookingModal, setShowBookingModal] = useState(false);
	const [bookingForm, setBookingForm] = useState<BookingForm>({
		patientIds: [],
		staffId: '',
		date: '',
		time: '',
		selectedTimes: [],
		selectedAppointments: new Map(),
		notes: '',
		addPackage: false,
		packageSessions: '',
		packageAmount: '',
		withConsultation: false,
		consultationDiscount: '0',
	});
	const [bookingLoading, setBookingLoading] = useState(false);
	const [conflictWarning, setConflictWarning] = useState<string | null>(null);
	const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
	const [showPatientAppointmentsModal, setShowPatientAppointmentsModal] = useState(false);
	const [showPackageModal, setShowPackageModal] = useState(false);
	const [packagePatientId, setPackagePatientId] = useState<string | null>(null);
	const [packageForm, setPackageForm] = useState({
		packageName: '',
		totalSessions: '',
		amount: '',
		consultationType: 'without' as 'with' | 'without',
		discount: '0',
		description: '',
	});
	const [packageSubmitting, setPackageSubmitting] = useState(false);
	const [showReportModal, setShowReportModal] = useState(false);
	const [reportModalPatientId, setReportModalPatientId] = useState<string | null>(null);
	const [packageAppointments, setPackageAppointments] = useState<Record<string, FrontdeskAppointment[]>>({});

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
						duration: typeof data.duration === 'number' ? data.duration : undefined,
						status: (data.status as AdminAppointmentStatus) ?? 'pending',
						notes: data.notes ? String(data.notes) : undefined,
						createdAt: created ? created.toISOString() : (data.createdAt as string | undefined) || new Date().toISOString(),
						sessionNumber: typeof data.sessionNumber === 'number' ? data.sessionNumber : undefined,
						totalSessions: typeof data.totalSessions === 'number' ? data.totalSessions : undefined,
						packageBillingId: data.packageBillingId ? String(data.packageBillingId) : undefined,
						packageName: data.packageName ? String(data.packageName) : undefined,
					} as FrontdeskAppointment;
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

	// Load patients from Firestore for patient details
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
						phone: data.phone ? String(data.phone) : undefined,
						email: data.email ? String(data.email) : undefined,
						totalSessionsRequired:
							typeof data.totalSessionsRequired === 'number'
								? data.totalSessionsRequired
								: data.totalSessionsRequired
									? Number(data.totalSessionsRequired)
									: undefined,
						remainingSessions:
							typeof data.remainingSessions === 'number'
								? data.remainingSessions
								: data.remainingSessions
									? Number(data.remainingSessions)
									: undefined,
						status: (data.status as AdminPatientStatus) ?? 'pending',
						assignedDoctor: data.assignedDoctor ? String(data.assignedDoctor) : undefined,
						patientType: data.patientType ? String(data.patientType) : undefined,
						sessionAllowance: data.sessionAllowance
							? normalizeSessionAllowance(data.sessionAllowance as Record<string, unknown>)
							: undefined,
						packageAmount: typeof data.packageAmount === 'number' ? data.packageAmount : undefined,
						concessionPercent: typeof data.concessionPercent === 'number' ? data.concessionPercent : undefined,
						paymentType: data.paymentType ? String(data.paymentType) : undefined,
						packageName: data.packageName ? String(data.packageName) : undefined,
						packageDescription: data.packageDescription ? String(data.packageDescription) : undefined,
					} as PatientRecordWithSessions;
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
						availability: data.availability as StaffMember['availability'],
						dateSpecificAvailability: data.dateSpecificAvailability as DateSpecificAvailability | undefined,
					} as StaffMember;
				});
				// Only include clinical roles (exclude FrontDesk and Admin)
				setStaff(mapped.filter(s => 
					s.status === 'Active' && 
					['Physiotherapist', 'StrengthAndConditioning', 'ClinicalTeam'].includes(s.role)
				));
			},
			error => {
				console.error('Failed to load staff', error);
				setStaff([]);
			}
		);

		return () => unsubscribe();
	}, []);

	// Get day of week from date string
	const getDayOfWeek = (dateString: string): DayOfWeek | null => {
		if (!dateString) return null;
		const date = new Date(dateString + 'T00:00:00'); // Parse as local time to avoid timezone issues
		if (Number.isNaN(date.getTime())) return null;
		const days: DayOfWeek[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
		return days[date.getDay()];
	};

	// Helper to format date as YYYY-MM-DD in local timezone (same as Availability.tsx)
	const formatDateKey = (dateString: string): string => {
		if (!dateString) return '';
		const date = new Date(dateString + 'T00:00:00');
		if (Number.isNaN(date.getTime())) return dateString;
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	};

	// Get availability for a specific date (ONLY checks date-specific, no fallback to day-of-week)
	const getDateAvailability = (staffMember: StaffMember, dateString: string): DayAvailability | null => {
		// Only check date-specific availability - if no schedule exists for this specific date, return null
		const dateKey = formatDateKey(dateString);
		
		// Debug logging
		if (process.env.NODE_ENV === 'development') {
			console.log('🔍 Checking availability for:', {
				dateString,
				dateKey,
				hasDateSpecific: !!staffMember.dateSpecificAvailability,
				dateSpecificKeys: staffMember.dateSpecificAvailability ? Object.keys(staffMember.dateSpecificAvailability) : [],
			});
		}
		
		// Only return availability if there's a date-specific schedule for this exact date
		if (staffMember.dateSpecificAvailability?.[dateKey]) {
			const dateSpecific = staffMember.dateSpecificAvailability[dateKey];
			if (process.env.NODE_ENV === 'development') {
				console.log('✅ Using date-specific availability for', dateKey, dateSpecific);
			}
			return dateSpecific;
		}

		// No schedule exists for this specific date - return null (don't show any slots)
		if (process.env.NODE_ENV === 'development') {
			console.log('❌ No date-specific schedule found for', dateKey, '- not showing any slots');
		}
		return null;
	};

	// Generate available time slots based on staff availability and existing appointments
	const availableTimeSlots = useMemo(() => {
		if (!bookingForm.staffId || !bookingForm.date) {
			if (process.env.NODE_ENV === 'development') {
				console.log('No staff or date selected for time slots');
			}
			return [];
		}

		const selectedStaff = staff.find(s => s.id === bookingForm.staffId);
		if (!selectedStaff) {
			if (process.env.NODE_ENV === 'development') {
				console.log('Staff member not found for ID:', bookingForm.staffId);
			}
			return [];
		}

		// Get availability for this specific date (checks date-specific first, then day-of-week)
		const dayAvailability = getDateAvailability(selectedStaff, bookingForm.date);
		if (!dayAvailability) {
			if (process.env.NODE_ENV === 'development') {
				console.log('❌ No availability found for date:', bookingForm.date, 'staff:', selectedStaff.userName);
				console.log('Staff data:', {
					id: selectedStaff.id,
					userName: selectedStaff.userName,
					hasAvailability: !!selectedStaff.availability,
					hasDateSpecific: !!selectedStaff.dateSpecificAvailability,
				});
			}
			return []; // Return empty array - no slots should be shown
		}

		if (!dayAvailability.enabled) {
			if (process.env.NODE_ENV === 'development') {
				console.log('❌ Availability is disabled for date:', bookingForm.date);
			}
			return []; // Return empty array - no slots should be shown
		}

		if (!dayAvailability.slots || dayAvailability.slots.length === 0) {
			if (process.env.NODE_ENV === 'development') {
				console.log('❌ No time slots defined in availability');
			}
			return []; // Return empty array - no slots should be shown
		}

		// Get all booked appointments for this staff and date (expand by duration)
		// Count patients per slot instead of just marking as booked
		const slotPatientCounts = new Map<string, number>();
		appointments
			.filter(apt => apt.doctor === selectedStaff.userName && apt.date === bookingForm.date && apt.status !== 'cancelled')
			.forEach(apt => {
				if (!apt.time) return;
				const durationMinutes = Math.max(SLOT_INTERVAL_MINUTES, apt.duration ?? SLOT_INTERVAL_MINUTES);
				const blocks = Math.ceil(durationMinutes / SLOT_INTERVAL_MINUTES);
				const startMinutes = timeStringToMinutes(apt.time);
				for (let block = 0; block < blocks; block += 1) {
					const blockStartMinutes = startMinutes + block * SLOT_INTERVAL_MINUTES;
					const slotTime = minutesToTimeString(blockStartMinutes);
					slotPatientCounts.set(slotTime, (slotPatientCounts.get(slotTime) || 0) + 1);
				}
			});

		if (process.env.NODE_ENV === 'development') {
			console.log('📋 Availability Details:', {
				date: bookingForm.date,
				staff: selectedStaff.userName,
				enabled: dayAvailability.enabled,
				slots: dayAvailability.slots,
				slotPatientCounts: Object.fromEntries(slotPatientCounts),
			});
		}

		// Get current date and time for filtering past slots
		const now = new Date();
		const selectedDate = new Date(bookingForm.date + 'T00:00:00');
		const isToday = selectedDate.toDateString() === now.toDateString();
		const currentTimeString = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

		// Generate 30-minute slots STRICTLY from availability ranges only
		const slots: string[] = [];
		
		// Validate each slot range before processing
		dayAvailability.slots.forEach((slot, index) => {
			if (!slot.start || !slot.end) {
				if (process.env.NODE_ENV === 'development') {
					console.warn(`⚠️ Invalid slot at index ${index}: missing start or end time`, slot);
				}
				return; // Skip invalid slots
			}

			const [startHour, startMin] = slot.start.split(':').map(Number);
			const [endHour, endMin] = slot.end.split(':').map(Number);

			// Validate parsed times
			if (isNaN(startHour) || isNaN(startMin) || isNaN(endHour) || isNaN(endMin)) {
				if (process.env.NODE_ENV === 'development') {
					console.warn(`⚠️ Invalid time format in slot:`, slot);
				}
				return; // Skip invalid slots
			}

			const startTime = new Date();
			startTime.setHours(startHour, startMin, 0, 0);
			const endTime = new Date();
			endTime.setHours(endHour, endMin, 0, 0);

			// Handle case where end time is before start time (e.g., overnight)
			if (endTime < startTime) {
				endTime.setDate(endTime.getDate() + 1);
			}

			// Only generate slots within this specific availability range
			// Show ALL slots (including booked ones) - we'll display patient counts
			let currentTime = new Date(startTime);
			while (currentTime < endTime) {
				const timeString = `${String(currentTime.getHours()).padStart(2, '0')}:${String(currentTime.getMinutes()).padStart(2, '0')}`;
				
				// If it's today, filter out past time slots
				if (isToday) {
					// Compare time strings (HH:MM format) to determine if slot is in the past
					if (timeString < currentTimeString) {
						currentTime.setMinutes(currentTime.getMinutes() + 30);
						continue; // Skip past time slots
					}
				}
				
				// Include all slots (booked or not) - we'll show patient counts
				slots.push(timeString);
				currentTime.setMinutes(currentTime.getMinutes() + 30);
			}
		});

		const sortedSlots = [...new Set(slots)].sort(); // Remove duplicates and sort
		
		if (process.env.NODE_ENV === 'development') {
			console.log('📅 Generated available time slots from availability:', {
				date: bookingForm.date,
				staff: selectedStaff.userName,
				isToday,
				currentTime: currentTimeString,
				availabilityRanges: dayAvailability.slots.map(s => `${s.start}-${s.end}`),
				slotPatientCounts: Object.fromEntries(slotPatientCounts),
				generatedSlots: sortedSlots,
				totalSlots: sortedSlots.length,
				filteredPastSlots: isToday ? 'Yes - past slots filtered' : 'No - future date',
			});
		}
		
		// Return slots with patient counts attached
		return sortedSlots.map(slot => ({
			time: slot,
			patientCount: slotPatientCounts.get(slot) || 0,
		}));
	}, [bookingForm.staffId, bookingForm.date, staff, appointments]);

	// Get current user's name for filtering
	const clinicianName = useMemo(() => normalize(user?.displayName ?? ''), [user?.displayName]);

	// Group appointments by patient
	const groupedByPatient = useMemo(() => {
		const query = searchTerm.trim().toLowerCase();
		
		// Filter by user if not showing all appointments
		let userFiltered = appointments;
		if (!showAllAppointments && clinicianName) {
			userFiltered = appointments.filter(appointment => 
				normalize(appointment.doctor) === clinicianName
			);
		}
		
		const filtered = userFiltered
			.filter(appointment => {
				const matchesQuery =
					!query ||
					appointment.patient.toLowerCase().includes(query) ||
					appointment.patientId.toLowerCase().includes(query) ||
					appointment.doctor.toLowerCase().includes(query) ||
					appointment.appointmentId.toLowerCase().includes(query);
				return matchesQuery;
			});

		// Group by patientId
		const grouped = new Map<string, FrontdeskAppointment[]>();
		filtered.forEach(appointment => {
			const key = appointment.patientId;
			if (!grouped.has(key)) {
				grouped.set(key, []);
			}
			grouped.get(key)!.push(appointment);
		});

		// Sort appointments within each group and convert to array
		const result: Array<{ patientId: string; patientName: string; appointments: FrontdeskAppointment[] }> = [];
		grouped.forEach((appts, patientId) => {
			const sorted = appts.sort((a, b) => {
				const aDate = new Date(`${a.date}T${a.time}`).getTime();
				const bDate = new Date(`${b.date}T${b.time}`).getTime();
				return bDate - aDate;
			});
			result.push({
				patientId,
				patientName: sorted[0].patient,
				appointments: sorted,
			});
		});

		// Sort groups by most recent appointment
		return result.sort((a, b) => {
			const aDate = new Date(`${a.appointments[0].date}T${a.appointments[0].time}`).getTime();
			const bDate = new Date(`${b.appointments[0].date}T${b.appointments[0].time}`).getTime();
			return bDate - aDate;
		});
	}, [appointments, searchTerm, showAllAppointments, clinicianName]);

	// Group package appointments by patient
	const packageAppointmentsByPatient = useMemo(() => {
		const grouped: Record<string, FrontdeskAppointment[]> = {};
		appointments.forEach(apt => {
			if (apt.packageBillingId && apt.patientId) {
				if (!grouped[apt.patientId]) {
					grouped[apt.patientId] = [];
				}
				grouped[apt.patientId].push(apt);
			}
		});
		// Sort by session number
		Object.keys(grouped).forEach(patientId => {
			grouped[patientId].sort((a, b) => {
				const aNum = a.sessionNumber || 0;
				const bNum = b.sessionNumber || 0;
				return aNum - bNum;
			});
		});
		return grouped;
	}, [appointments]);

	// Get appointments for selected patient
	const selectedPatientAppointments = useMemo(() => {
		if (!selectedPatientId) return [];
		return appointments
			.filter(apt => apt.patientId === selectedPatientId)
			.sort((a, b) => {
				const aDate = new Date(`${a.date}T${a.time}`).getTime();
				const bDate = new Date(`${b.date}T${b.time}`).getTime();
				return bDate - aDate;
			});
	}, [appointments, selectedPatientId]);

	// Calculate total appointments count for header
	const totalAppointmentsCount = useMemo(() => {
		return groupedByPatient.reduce((sum, group) => sum + group.appointments.length, 0);
	}, [groupedByPatient]);

	// Only show patients who already have appointments (frontdesk assigns first, clinical team handles rest)
	const availablePatients = useMemo(() => {
		const patientsWithAppointments = new Set(
			appointments.map(apt => apt.patientId)
		);
		return patients.filter(patient => patientsWithAppointments.has(patient.patientId));
	}, [patients, appointments]);

	// Filter appointments based on showAllAppointments
	const filteredAppointmentsForCounts = useMemo(() => {
		if (!showAllAppointments && clinicianName) {
			return appointments.filter(appointment => normalize(appointment.doctor) === clinicianName);
		}
		return appointments;
	}, [appointments, showAllAppointments, clinicianName]);

	const pendingCount = filteredAppointmentsForCounts.filter(appointment => appointment.status === 'pending').length;
	const ongoingCount = filteredAppointmentsForCounts.filter(appointment => appointment.status === 'ongoing').length;
	const completedCount = filteredAppointmentsForCounts.filter(appointment => appointment.status === 'completed').length;

	const handleStatusChange = async (appointmentId: string, status: AdminAppointmentStatus) => {
		const appointment = appointments.find(a => a.appointmentId === appointmentId);
		if (!appointment) return;

		const oldStatus = appointment.status;
		const patientDetails = patients.find(p => p.patientId === appointment.patientId);
		const staffMember = staff.find(s => s.userName === appointment.doctor);
		let sessionUsageResult: RecordSessionUsageResult | null = null;

		setUpdating(prev => ({ ...prev, [appointment.id]: true }));
		try {
			const appointmentRef = doc(db, 'appointments', appointment.id);
			await updateDoc(appointmentRef, {
				status,
			});

			// Small delay to ensure the database update is committed
			await new Promise(resolve => setTimeout(resolve, 500));

			if (status === 'completed' && oldStatus !== 'completed' && patientDetails?.id) {
				try {
					sessionUsageResult = await recordSessionUsageForAppointment({
						patientDocId: patientDetails.id,
						patientType: patientDetails.patientType,
						appointmentId: appointment.id,
					});
				} catch (sessionError) {
					console.error('Failed to record DYES session usage:', sessionError);
				}
			}

			// Recalculate and update remaining sessions when status changes, if totalSessionsRequired is set
			if (patientDetails && typeof patientDetails.totalSessionsRequired === 'number') {
				const patientId = appointment.patientId;
				const completedAfter = appointments
					.map(a =>
						a.appointmentId === appointmentId
							? { ...a, status }
							: a
					)
					.filter(a => a.patientId === patientId && a.status === 'completed').length;

				// remainingSessions starts at totalSessionsRequired - 1 and decreases with each completed appointment
				const newRemaining = Math.max(0, patientDetails.totalSessionsRequired - 1 - completedAfter);
				const patientRef = doc(db, 'patients', patientDetails.id);
				await updateDoc(patientRef, {
					remainingSessions: newRemaining,
					updatedAt: serverTimestamp(),
				});

				setPatients(prev =>
					prev.map(p =>
						p.id === patientDetails.id ? { ...p, remainingSessions: newRemaining } : p
					)
				);
			}

			// Update patient status to 'completed' if all appointments are completed
			if (status === 'completed' && patientDetails?.id) {
				try {
					// Query database directly to get current state of all appointments for this patient
					const patientId = appointment.patientId;
					console.log(`🔍 Checking patient status for patientId: ${patientId}`);
					
					const appointmentsQuery = query(
						collection(db, 'appointments'),
						where('patientId', '==', patientId)
					);
					const appointmentsSnapshot = await getDocs(appointmentsQuery);
					
					if (!appointmentsSnapshot.empty) {
						const allPatientAppointments = appointmentsSnapshot.docs.map(doc => ({
							id: doc.id,
							...doc.data()
						}));
						
						console.log(`📋 Found ${allPatientAppointments.length} appointments for patient ${patientId}:`, 
							allPatientAppointments.map((apt: any) => ({ id: apt.id, status: apt.status, date: apt.date }))
						);
						
						// Check if all appointments are completed or cancelled
						const allCompleted = allPatientAppointments.length > 0 && 
							allPatientAppointments.every((apt: any) => 
								apt.status === 'completed' || apt.status === 'cancelled'
							);
						
						console.log(`✅ All appointments completed? ${allCompleted}`);
						console.log(`📊 Current patient status in DB: ${patientDetails.status}`);
						
						if (allCompleted && patientDetails.status !== 'completed') {
							console.log(`🔄 Updating patient ${patientDetails.patientId} status to 'completed'...`);
							const patientRef = doc(db, 'patients', patientDetails.id);
							
							try {
								await updateDoc(patientRef, {
									status: 'completed',
								});
								
								// Wait a moment for the update to propagate
								await new Promise(resolve => setTimeout(resolve, 300));
								
								// Verify the update by reading back from database
								const updatedPatientDoc = await getDoc(patientRef);
								const updatedStatus = updatedPatientDoc.data()?.status;
								
								if (updatedStatus === 'completed') {
									console.log(`✅ Patient ${patientDetails.patientId} status successfully updated to 'completed' in database`);
									
									setPatients(prev =>
										prev.map(p =>
											p.id === patientDetails.id ? { ...p, status: 'completed' } : p
										)
									);
								} else {
									console.error(`❌ Update failed! Patient status is still '${updatedStatus}' instead of 'completed'`);
									console.error(`Patient ID: ${patientDetails.id}, Patient ID (display): ${patientDetails.patientId}`);
									alert(`Warning: Patient status update may have failed. Please check Firebase console.`);
								}
							} catch (updateError) {
								console.error(`❌ Error updating patient status:`, updateError);
								console.error(`Error details:`, {
									patientId: patientDetails.patientId,
									patientDocId: patientDetails.id,
									error: updateError
								});
								alert(`Failed to update patient status: ${updateError instanceof Error ? updateError.message : 'Unknown error'}`);
							}
						} else if (!allCompleted) {
							const incompleteCount = allPatientAppointments.filter((apt: any) => 
								apt.status !== 'completed' && apt.status !== 'cancelled'
							).length;
							console.log(`⚠️ Not all appointments are completed. ${incompleteCount} appointment(s) still pending/ongoing.`);
						} else if (patientDetails.status === 'completed') {
							console.log(`ℹ️ Patient ${patientDetails.patientId} already has status 'completed'`);
						}
					} else {
						console.log(`⚠️ No appointments found for patient ${patientId}`);
					}
				} catch (error) {
					console.error('❌ Failed to check and update patient status:', error);
					console.error('Error details:', error);
				}
			}

			// Only send notifications for completed or cancelled status changes
			if (oldStatus !== status && (status === 'completed' || status === 'cancelled')) {
				const statusCapitalized = status.charAt(0).toUpperCase() + status.slice(1);
				const template = status === 'cancelled' ? 'appointment-cancelled' : 'appointment-status-changed';
				
				// Send notification to patient
				if (patientDetails?.email) {
					try {
						await sendEmailNotification({
							to: patientDetails.email,
							subject: status === 'cancelled' 
								? `Appointment Cancelled - ${appointment.date}`
								: `Appointment ${statusCapitalized} - ${appointment.date}`,
							template,
							data: {
								patientName: appointment.patient,
								patientEmail: patientDetails.email,
								patientId: appointment.patientId,
								doctor: appointment.doctor,
								date: appointment.date,
								time: appointment.time,
								appointmentId: appointment.appointmentId,
								status: statusCapitalized,
							},
						});
					} catch (emailError) {
						console.error('Failed to send status change email to patient:', emailError);
					}
				}

				// Send SMS to patient if cancelled
				if (status === 'cancelled' && patientDetails?.phone && isValidPhoneNumber(patientDetails.phone)) {
					try {
						await sendSMSNotification({
							to: patientDetails.phone,
							template: 'appointment-cancelled',
							data: {
								patientName: appointment.patient,
								patientPhone: patientDetails.phone,
								patientId: appointment.patientId,
								doctor: appointment.doctor,
								date: appointment.date,
								time: appointment.time,
								appointmentId: appointment.appointmentId,
							},
						});
					} catch (smsError) {
						console.error('Failed to send cancellation SMS to patient:', smsError);
					}
				}

				// Send notification to staff member
				if (staffMember?.userEmail) {
					try {
						await sendEmailNotification({
							to: staffMember.userEmail,
							subject: `Appointment ${statusCapitalized} - ${appointment.patient} on ${appointment.date}`,
							template: 'appointment-status-changed',
							data: {
								patientName: appointment.patient,
								patientEmail: staffMember.userEmail, // Using staff email for staff notification
								patientId: appointment.patientId,
								doctor: appointment.doctor,
								date: appointment.date,
								time: appointment.time,
								appointmentId: appointment.appointmentId,
								status: statusCapitalized,
							},
						});
					} catch (emailError) {
						console.error('Failed to send status change email to staff:', emailError);
					}
				}

				if (sessionUsageResult && !sessionUsageResult.wasFree && patientDetails?.email) {
					try {
						await sendEmailNotification({
							to: patientDetails.email,
							subject: `Session Balance Update - ${appointment.patient}`,
							template: 'session-balance',
							data: {
								recipientName: appointment.patient,
								recipientType: 'patient',
								patientName: appointment.patient,
								patientEmail: patientDetails.email,
								patientId: appointment.patientId,
								appointmentDate: appointment.date,
								appointmentTime: appointment.time,
								freeSessionsRemaining: sessionUsageResult.remainingFreeSessions,
								pendingPaidSessions: sessionUsageResult.allowance.pendingPaidSessions,
								pendingChargeAmount: sessionUsageResult.allowance.pendingChargeAmount,
							},
						});
					} catch (sessionEmailError) {
						console.error('Failed to send session balance email to patient:', sessionEmailError);
					}
				}

				if (sessionUsageResult && !sessionUsageResult.wasFree && staffMember?.userEmail) {
					try {
						await sendEmailNotification({
							to: staffMember.userEmail,
							subject: `Pending Sessions Alert - ${appointment.patient}`,
							template: 'session-balance',
							data: {
								recipientName: staffMember.userName,
								recipientType: 'therapist',
								patientName: appointment.patient,
								patientEmail: staffMember.userEmail,
								patientId: appointment.patientId,
								appointmentDate: appointment.date,
								appointmentTime: appointment.time,
								freeSessionsRemaining: sessionUsageResult.remainingFreeSessions,
								pendingPaidSessions: sessionUsageResult.allowance.pendingPaidSessions,
								pendingChargeAmount: sessionUsageResult.allowance.pendingChargeAmount,
							},
						});
					} catch (sessionEmailError) {
						console.error('Failed to send session balance email to staff:', sessionEmailError);
					}
				}
			}
		} catch (error) {
			console.error('Failed to update appointment status', error);
			alert(`Failed to update appointment status: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setUpdating(prev => ({ ...prev, [appointment.id]: false }));
		}
	};

	const handleRemove = async (appointmentId: string) => {
		if (!window.confirm('Delete this appointment? This action cannot be undone.')) return;

		const appointment = appointments.find(a => a.appointmentId === appointmentId);
		if (!appointment) return;

		setUpdating(prev => ({ ...prev, [appointment.id]: true }));
		try {
			const appointmentRef = doc(db, 'appointments', appointment.id);
			await deleteDoc(appointmentRef);
		} catch (error) {
			console.error('Failed to delete appointment', error);
			alert(`Failed to delete appointment: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setUpdating(prev => ({ ...prev, [appointment.id]: false }));
		}
	};

	const handleEditNotes = (appointment: FrontdeskAppointment) => {
		setEditingId(appointment.appointmentId);
		setNotesDraft(appointment.notes ?? '');
	};

	const handleSaveNotes = async () => {
		if (!editingId) return;

		const appointment = appointments.find(a => a.appointmentId === editingId);
		if (!appointment) return;

		setUpdating(prev => ({ ...prev, [appointment.id]: true }));
		try {
			const appointmentRef = doc(db, 'appointments', appointment.id);
			await updateDoc(appointmentRef, {
				notes: notesDraft.trim() || null,
			});
			setEditingId(null);
			setNotesDraft('');
		} catch (error) {
			console.error('Failed to update appointment notes', error);
			alert(`Failed to update notes: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setUpdating(prev => ({ ...prev, [appointment.id]: false }));
		}
	};

	const handleCancelEditing = () => {
		setEditingId(null);
		setNotesDraft('');
	};

	// Save current day's selections to the appointments map
	const saveCurrentDaySelections = () => {
		if (bookingForm.date && bookingForm.selectedTimes.length > 0) {
			setBookingForm(prev => {
				const newMap = new Map(prev.selectedAppointments);
				newMap.set(prev.date, [...prev.selectedTimes]);
				return {
					...prev,
					selectedAppointments: newMap,
				};
			});
		}
	};

	// Load saved selections for a date
	const loadSavedSelections = (date: string) => {
		const saved = bookingForm.selectedAppointments.get(date);
		if (saved && saved.length > 0) {
			setBookingForm(prev => ({
				...prev,
				selectedTimes: [...saved],
				time: saved.length === 1 ? saved[0] : prev.time,
			}));
		} else {
			setBookingForm(prev => ({
				...prev,
				selectedTimes: [],
				time: '',
			}));
		}
	};

	const handleOpenBookingModal = () => {
		setShowBookingModal(true);
		setBookingForm({
			patientIds: [],
			staffId: '',
			date: '',
			time: '',
			selectedTimes: [],
			selectedAppointments: new Map(),
			notes: '',
			addPackage: false,
			packageSessions: '',
			packageAmount: '',
			withConsultation: false,
			consultationDiscount: '0',
		});
	};

	const handleCloseBookingModal = () => {
		setShowBookingModal(false);
		setBookingForm({
			patientIds: [],
			staffId: '',
			date: '',
			time: '',
			selectedTimes: [],
			selectedAppointments: new Map(),
			notes: '',
			addPackage: false,
			packageSessions: '',
			packageAmount: '',
			withConsultation: false,
			consultationDiscount: '0',
		});
	};

	const handleCreateAppointment = async () => {
		// Save current day's selections first
		saveCurrentDaySelections();

		// Collect all appointments from all saved days
		const allAppointments: Array<{ date: string; times: string[] }> = [];
		
		// Add current day if it has selections
		if (bookingForm.date && bookingForm.selectedTimes.length > 0) {
			allAppointments.push({
				date: bookingForm.date,
				times: [...bookingForm.selectedTimes],
			});
		}

		// Add all other saved days
		bookingForm.selectedAppointments.forEach((times, date) => {
			// Skip current date as we already added it
			if (date !== bookingForm.date && times.length > 0) {
				allAppointments.push({ date, times });
			}
		});

		// Flatten to get total count
		const totalAppointments = allAppointments.reduce((sum, apt) => sum + apt.times.length, 0);

		if (bookingForm.patientIds.length === 0 || !bookingForm.staffId || totalAppointments === 0) {
			alert('Please select at least one patient, clinician, and at least one time slot across any day.');
			return;
		}

		// Validate package fields if package is enabled
		if (bookingForm.addPackage) {
			if (!bookingForm.packageSessions || Number(bookingForm.packageSessions) <= 0) {
				alert('Please enter a valid number of sessions for the package.');
				return;
			}
			if (!bookingForm.packageAmount || Number(bookingForm.packageAmount) <= 0) {
				alert('Please enter a valid package amount.');
				return;
			}
		}

		const selectedPatients = bookingForm.patientIds
			.map(pid => patients.find(p => p.patientId === pid))
			.filter((p): p is PatientRecordWithSessions => p !== undefined);
		
		const selectedStaff = staff.find(s => s.id === bookingForm.staffId);

		if (selectedPatients.length === 0 || !selectedStaff) {
			alert('Invalid patient or staff selection.');
			return;
		}

		// Check if any selected patient has no existing appointments (consultation check)
		const patientsWithoutAppointments = selectedPatients.filter(patient => {
			return appointments.filter(a => a.patientId === patient.patientId).length === 0;
		});

		if (patientsWithoutAppointments.length > 0) {
			const patientNames = patientsWithoutAppointments.map(p => p.name).join(', ');
			alert(`Consultations can only be created from the Front Desk. The following patient(s) need their first appointment assigned by the frontdesk: ${patientNames}`);
			return;
		}

		// Check for conflicts for all appointments across all days
		const allConflicts: Array<{ date: string; time: string; conflict: ReturnType<typeof checkAppointmentConflict> }> = [];
		for (const apt of allAppointments) {
			for (const time of apt.times) {
				const conflict = checkAppointmentConflict(
					appointments.map(a => ({
						id: a.id,
						appointmentId: a.appointmentId,
						patient: a.patient,
						doctor: a.doctor,
						date: a.date,
						time: a.time,
						status: a.status,
					})),
					{
						doctor: selectedStaff.userName,
						date: apt.date,
						time: time,
					},
					30
				);
				if (conflict.hasConflict) {
					allConflicts.push({ date: apt.date, time, conflict });
				}
			}
		}

		if (allConflicts.length > 0) {
			const conflictMessages = allConflicts.map(({ date, time, conflict }) => 
				`${date} at ${time}: ${conflict.conflictingAppointments.length} conflict(s)`
			).join('\n');
			const confirmMessage = `Conflict detected:\n${conflictMessages}\n\nContinue anyway?`;
			if (!window.confirm(confirmMessage)) {
				return;
			}
		}


		setBookingLoading(true);
		try {
			const createdAppointments: string[] = [];
			let appointmentIndex = 0;
			const baseTimestamp = Date.now();
			
			// Create appointments for all selected patients, all days and times
			for (const selectedPatient of selectedPatients) {
				const patientAppointments: string[] = [];
				
				for (const apt of allAppointments) {
					for (const time of apt.times) {
						// Generate unique appointment ID for each
						const appointmentId = `APT${baseTimestamp}${appointmentIndex}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

						await addDoc(collection(db, 'appointments'), {
							appointmentId,
							patientId: selectedPatient.patientId,
							patient: selectedPatient.name,
							doctor: selectedStaff.userName,
							staffId: selectedStaff.id,
							date: apt.date,
							time: time,
							status: 'pending' as AdminAppointmentStatus,
							notes: bookingForm.notes?.trim() || null,
							isConsultation: false, // Clinical team cannot create consultations
							createdAt: serverTimestamp(),
						});

						createdAppointments.push(appointmentId);
						patientAppointments.push(appointmentId);
						appointmentIndex++;
					}
				}

				// Update remaining sessions for each patient, if totalSessionsRequired is set
				if (typeof selectedPatient.totalSessionsRequired === 'number') {
					const completedCount = appointments.filter(
						a => a.patientId === selectedPatient.patientId && a.status === 'completed'
					).length;
					// remainingSessions starts at totalSessionsRequired - 1 and decreases with each completed appointment
					const newRemaining = Math.max(0, selectedPatient.totalSessionsRequired - 1 - completedCount);

					const patientRef = doc(db, 'patients', selectedPatient.id);
					await updateDoc(patientRef, {
						remainingSessions: newRemaining,
						updatedAt: serverTimestamp(),
					});

					setPatients(prev =>
						prev.map(p =>
							p.id === selectedPatient.id ? { ...p, remainingSessions: newRemaining } : p
						)
					);
				}

				// Ensure each patient's record reflects the assigned clinician and status
				if (selectedPatient.id) {
					try {
						const patientRef = doc(db, 'patients', selectedPatient.id);
						const patientUpdate: Record<string, unknown> = {
							assignedDoctor: selectedStaff.userName,
							updatedAt: serverTimestamp(),
						};
						if (!selectedPatient.status || selectedPatient.status === 'pending') {
							patientUpdate.status = 'ongoing';
						}

						await updateDoc(patientRef, patientUpdate);
					} catch (patientUpdateError) {
						console.error('Failed to update patient assignment', patientUpdateError);
					}
				}

				// Send email notification to each patient
				if (selectedPatient.email && totalAppointments > 0) {
					try {
						const datesList = allAppointments.map(apt => 
							`${formatDateLabel(apt.date)}: ${apt.times.join(', ')}`
						).join('\n');
						await sendEmailNotification({
							to: selectedPatient.email,
							subject: `${totalAppointments} Appointment(s) Scheduled`,
							template: 'appointment-created',
							data: {
								patientName: selectedPatient.name,
								patientEmail: selectedPatient.email,
								patientId: selectedPatient.patientId,
								doctor: selectedStaff.userName,
								date: allAppointments.map(a => formatDateLabel(a.date)).join(', '),
								time: allAppointments.map(a => a.times.join(', ')).join('; '),
								appointmentId: patientAppointments.join(', '),
							},
						});
					} catch (emailError) {
						console.error('Failed to send appointment confirmation email:', emailError);
					}
				}
			}

			// Handle package creation if enabled
			if (bookingForm.addPackage && bookingForm.packageSessions && bookingForm.packageAmount) {
				const packageSessionsValue = Number(bookingForm.packageSessions);
				const packageAmountValue = Number(bookingForm.packageAmount);
				const consultationDiscountValue = bookingForm.withConsultation && bookingForm.consultationDiscount
					? Number(bookingForm.consultationDiscount)
					: null;

				// Calculate total amount with discount
				const totalAmount = consultationDiscountValue && consultationDiscountValue > 0
					? Number((packageAmountValue * (1 - consultationDiscountValue / 100)).toFixed(2))
					: packageAmountValue;

				// Create package billing for each selected patient
				for (const selectedPatient of selectedPatients) {
					try {
						const billingId = `PKG-${selectedPatient.patientId}-${Date.now()}`;
						
						// Create billing entry
						await addDoc(collection(db, 'billing'), {
							billingId,
							patient: selectedPatient.name,
							patientId: selectedPatient.patientId,
							doctor: selectedStaff.userName,
							amount: totalAmount,
							packageAmount: packageAmountValue,
							concessionPercent: consultationDiscountValue,
							amountPaid: 0,
							date: new Date().toISOString().split('T')[0],
							status: 'Pending',
							paymentMode: null,
							utr: null,
							packageSessions: packageSessionsValue,
							createdAt: serverTimestamp(),
							updatedAt: serverTimestamp(),
						});

						// Update patient's totalSessionsRequired and remainingSessions
						const patientRef = doc(db, 'patients', selectedPatient.id);
						const currentTotalSessions = typeof selectedPatient.totalSessionsRequired === 'number'
							? selectedPatient.totalSessionsRequired
							: 0;
						const newTotalSessions = currentTotalSessions + packageSessionsValue;
						
						// Calculate remaining sessions (starts at total - 1)
						const completedCount = appointments.filter(
							a => a.patientId === selectedPatient.patientId && a.status === 'completed'
						).length;
						const newRemainingSessions = Math.max(0, newTotalSessions - 1 - completedCount);

						await updateDoc(patientRef, {
							totalSessionsRequired: newTotalSessions,
							remainingSessions: newRemainingSessions,
							packageAmount: packageAmountValue,
							concessionPercent: consultationDiscountValue,
							paymentType: bookingForm.withConsultation ? 'with' : 'without',
							updatedAt: serverTimestamp(),
						});

						// Update local state
						setPatients(prev =>
							prev.map(p =>
								p.id === selectedPatient.id
									? {
											...p,
											totalSessionsRequired: newTotalSessions,
											remainingSessions: newRemainingSessions,
											packageAmount: packageAmountValue,
											concessionPercent: consultationDiscountValue ?? undefined,
										}
									: p
							)
						);
					} catch (packageError) {
						console.error('Failed to create package for patient:', selectedPatient.name, packageError);
						// Continue with other patients even if one fails
					}
				}
			}

			const totalCreated = createdAppointments.length;
			const packageMessage = bookingForm.addPackage && bookingForm.packageSessions && bookingForm.packageAmount
				? ` Package(s) added and billing created.`
				: '';
			handleCloseBookingModal();
			alert(`Successfully created ${totalCreated} appointment(s) for ${selectedPatients.length} patient(s) across ${allAppointments.length} day(s)!${packageMessage}`);
		} catch (error) {
			console.error('Failed to create appointment(s)', error);
			alert(`Failed to create appointment(s): ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setBookingLoading(false);
		}
	};

	const handleAddPackage = async () => {
		if (!packagePatientId) return;

		const selectedPatient = patients.find(p => p.patientId === packagePatientId);
		if (!selectedPatient) {
			alert('Patient not found.');
			return;
		}

		// Validate form
		if (!packageForm.packageName.trim() || !packageForm.totalSessions || !packageForm.amount) {
			alert('Please fill in all required fields: Package Name, Total Sessions, and Amount.');
			return;
		}

		const totalSessionsValue = Number(packageForm.totalSessions);
		const packageAmountValue = Number(packageForm.amount);
		const consultationDiscountValue = packageForm.consultationType === 'with' && packageForm.discount
			? Number(packageForm.discount)
			: null;

		if (totalSessionsValue <= 0 || packageAmountValue <= 0) {
			alert('Total Sessions and Amount must be greater than 0.');
			return;
		}

		// Calculate total amount with discount
		const totalAmount = consultationDiscountValue && consultationDiscountValue > 0
			? Number((packageAmountValue * (1 - consultationDiscountValue / 100)).toFixed(2))
			: packageAmountValue;

		setPackageSubmitting(true);
		try {
			// Create billing entry
			const billingId = `PKG-${selectedPatient.patientId}-${Date.now()}`;
			await addDoc(collection(db, 'billing'), {
				billingId,
				patient: selectedPatient.name,
				patientId: selectedPatient.patientId,
				doctor: user?.displayName || user?.email?.split('@')[0] || 'Clinical Team',
				amount: totalAmount,
				packageAmount: packageAmountValue,
				concessionPercent: consultationDiscountValue,
				amountPaid: 0,
				date: new Date().toISOString().split('T')[0],
				status: 'Pending',
				paymentMode: null,
				utr: null,
				packageSessions: totalSessionsValue,
				packageName: packageForm.packageName.trim(),
				packageDescription: packageForm.description.trim() || null,
				createdAt: serverTimestamp(),
				updatedAt: serverTimestamp(),
			});

			// Create appointments equal to the number of sessions in the package
			const createdAppointmentIds: string[] = [];
			for (let i = 1; i <= totalSessionsValue; i++) {
				const appointmentId = `APT-${selectedPatient.patientId}-${Date.now()}-${i}`;
				await addDoc(collection(db, 'appointments'), {
					appointmentId,
					patientId: selectedPatient.patientId,
					patient: selectedPatient.name,
					doctor: '', // Will be assigned when appointment is scheduled
					date: '', // Will be scheduled later
					time: '', // Will be scheduled later
					status: 'pending' as AdminAppointmentStatus,
					notes: null,
					isConsultation: false,
					sessionNumber: i,
					totalSessions: totalSessionsValue,
					packageBillingId: billingId,
					packageName: packageForm.packageName.trim(),
					createdAt: serverTimestamp(),
				});
				createdAppointmentIds.push(appointmentId);
			}

			// Update patient's totalSessionsRequired and remainingSessions
			const patientRef = doc(db, 'patients', selectedPatient.id);
			const currentTotalSessions = typeof selectedPatient.totalSessionsRequired === 'number'
				? selectedPatient.totalSessionsRequired
				: 0;
			const newTotalSessions = currentTotalSessions + totalSessionsValue;
			
			// Calculate remaining sessions (starts at total - 1)
			const completedCount = appointments.filter(
				a => a.patientId === selectedPatient.patientId && a.status === 'completed'
			).length;
			const newRemainingSessions = Math.max(0, newTotalSessions - 1 - completedCount);

			await updateDoc(patientRef, {
				totalSessionsRequired: newTotalSessions,
				remainingSessions: newRemainingSessions,
				packageAmount: packageAmountValue,
				concessionPercent: consultationDiscountValue,
				paymentType: packageForm.consultationType === 'with' ? 'with' : 'without',
				packageName: packageForm.packageName.trim(),
				packageDescription: packageForm.description.trim() || null,
				updatedAt: serverTimestamp(),
			});

			// Update local state
			setPatients(prev =>
				prev.map(p =>
					p.id === selectedPatient.id
						? {
								...p,
								totalSessionsRequired: newTotalSessions,
								remainingSessions: newRemainingSessions,
								packageAmount: packageAmountValue,
								concessionPercent: consultationDiscountValue ?? undefined,
							}
						: p
				)
			);

			// Close modal and reset form
			setShowPackageModal(false);
			setPackagePatientId(null);
			setPackageForm({
				packageName: '',
				totalSessions: '',
				amount: '',
				consultationType: 'without',
				discount: '0',
				description: '',
			});

			alert(`Package "${packageForm.packageName}" added successfully! Billing entry created with status Pending. ${totalSessionsValue} appointment${totalSessionsValue > 1 ? 's' : ''} created. You can schedule them and add reports for each appointment.`);
		} catch (error) {
			console.error('Failed to add package', error);
			alert(`Failed to add package: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setPackageSubmitting(false);
		}
	};

	return (
		<div className="min-h-svh bg-slate-50 px-6 py-10">
			<div className="mx-auto max-w-6xl space-y-10">
				<PageHeader
					title="Patient Management"
					actions={
						<button type="button" onClick={handleOpenBookingModal} className="btn-primary">
							<i className="fas fa-plus text-xs" aria-hidden="true" />
							Book Appointment
						</button>
					}
				/>

				<div className="border-t border-slate-200" />

				<section className="card-container">
				<div className="flex w-full flex-col gap-3 md:flex-row md:items-end md:gap-4">
					<div className="flex-1">
						<label className="block text-sm font-medium text-slate-700">Search appointments</label>
						<div className="relative mt-2">
							<i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400" aria-hidden="true" />
							<input
								type="search"
								value={searchTerm}
								onChange={event => setSearchTerm(event.target.value)}
								className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm text-slate-700 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
								placeholder="Filter by patient, ID, doctor, or appointment ID"
								autoComplete="off"
							/>
						</div>
					</div>
				</div>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
					<button type="button" onClick={() => setSearchTerm('')} className="btn-secondary">
						<i className="fas fa-eraser text-xs" aria-hidden="true" />
						Clear filters
					</button>
					<span className="text-xs text-slate-500">
						Pending: <span className="font-semibold text-slate-700">{pendingCount}</span> · Ongoing:{' '}
						<span className="font-semibold text-slate-700">{ongoingCount}</span> · Completed:{' '}
						<span className="font-semibold text-slate-700">{completedCount}</span>
					</span>
				</div>
			</section>

				<section className="section-card">
					<header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<h2 className="text-lg font-semibold text-slate-900">Appointment queue</h2>
							<p className="text-sm text-slate-500">
								{groupedByPatient.length} patient{groupedByPatient.length === 1 ? '' : 's'} with {totalAppointmentsCount} appointment{totalAppointmentsCount === 1 ? '' : 's'}
								{!showAllAppointments && clinicianName && (
									<span className="ml-2 text-sky-600">(My appointments only)</span>
								)}
							</p>
						</div>
						<div className="flex items-center gap-2">
							{clinicianName && (
								<button
									type="button"
									onClick={() => setShowAllAppointments(!showAllAppointments)}
									className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
										showAllAppointments
											? 'bg-sky-600 text-white hover:bg-sky-700'
											: 'border border-sky-600 bg-white text-sky-600 hover:bg-sky-50'
									} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2`}
								>
									<i className={`fas ${showAllAppointments ? 'fa-user-slash' : 'fa-users'} text-xs`} aria-hidden="true" />
									{showAllAppointments ? 'Show My Appointments' : 'View All Appointments'}
								</button>
							)}
						</div>
					</header>

					{loading ? (
						<div className="empty-state-container">
							<div className="loading-spinner" aria-hidden="true" />
							<span className="ml-3 align-middle">Loading appointments…</span>
						</div>
					) : groupedByPatient.length === 0 ? (
						<div className="empty-state-container">
							No appointments match your filters. Try another search or create a booking from the register page.
						</div>
					) : (
						<div className="overflow-x-auto">
							<table className="min-w-full divide-y divide-slate-200 text-left text-sm text-slate-700">
								<thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
									<tr>
										<th className="px-4 py-3 font-semibold">Patient</th>
										<th className="px-4 py-3 font-semibold">Appointments</th>
										<th className="px-4 py-3 font-semibold">Next Appointment</th>
										<th className="px-4 py-3 font-semibold">Status Summary</th>
										<th className="px-4 py-3 font-semibold text-right">Actions</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100">
									{groupedByPatient.map(group => {
										const patientDetails = patients.find(p => p.patientId === group.patientId);
										const nextAppointment = group.appointments[0]; // Most recent/upcoming
										
										// Get ALL appointments for this patient (not just filtered ones)
										// Exclude package sessions (those with packageBillingId) from status counts
										const allPatientAppointments = appointments.filter(
											a => a.patientId === group.patientId && !a.packageBillingId
										);
										
										const statusCounts = {
											pending: allPatientAppointments.filter(a => a.status === 'pending').length,
											ongoing: allPatientAppointments.filter(a => a.status === 'ongoing').length,
											completed: allPatientAppointments.filter(a => a.status === 'completed').length,
											cancelled: allPatientAppointments.filter(a => a.status === 'cancelled').length,
										};

										return (
											<tr key={group.patientId}>
												<td className="px-4 py-4">
													<div className="space-y-1">
														<p className="text-sm font-medium text-slate-800">{group.patientName}</p>
														<p className="text-xs text-slate-500">
															<span className="font-semibold text-slate-600">ID:</span> {group.patientId}
														</p>
														{patientDetails?.patientType && (
															<p className="text-xs text-slate-500">
																<span className="font-semibold text-slate-600">Type:</span> {patientDetails.patientType}
															</p>
														)}
														<p className="text-xs text-slate-500">
															{patientDetails?.phone ? `Phone: ${patientDetails.phone}` : 'Phone not provided'}
														</p>
														{patientDetails?.email && (
															<p className="text-xs text-slate-500">
																Email: {patientDetails.email}
															</p>
														)}
														<div className="pt-2">
															<button
																type="button"
																onClick={() => {
																	setPackagePatientId(group.patientId);
																	setShowPackageModal(true);
																	setPackageForm({
																		packageName: '',
																		totalSessions: '',
																		amount: '',
																		consultationType: 'without',
																		discount: '0',
																		description: '',
																	});
																}}
																className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-purple-500 via-purple-600 to-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-md hover:from-purple-600 hover:via-purple-700 hover:to-indigo-700 transition-all duration-200 hover:scale-105"
															>
																<i className="fas fa-box text-xs" aria-hidden="true" />
																Add Package
															</button>
														</div>
													</div>
												</td>
												<td className="px-4 py-4">
													{(() => {
														// Count only non-completed appointments (exclude package sessions)
														const nonCompletedAppointments = allPatientAppointments.filter(
															a => a.status !== 'completed'
														);
														const appointmentCount = nonCompletedAppointments.length;
														return (
															<p className="text-sm font-semibold text-slate-900">
																{appointmentCount} appointment{appointmentCount === 1 ? '' : 's'}
															</p>
														);
													})()}
													{patientDetails?.packageName && patientDetails?.totalSessionsRequired && (
														<div className="mt-2 space-y-1">
															<p className="text-xs text-purple-600 font-medium">
																Package: {patientDetails.packageName} ({patientDetails.totalSessionsRequired} sessions)
															</p>
															{packageAppointmentsByPatient[group.patientId] && packageAppointmentsByPatient[group.patientId].length > 0 && (
																<div className="flex flex-wrap gap-1 mt-1">
																	{packageAppointmentsByPatient[group.patientId].map((apt, idx) => (
																		<button
																			key={apt.id}
																			type="button"
																			onClick={() => {
																				setReportModalPatientId(group.patientId);
																				setShowReportModal(true);
																			}}
																			className="inline-flex items-center gap-1 rounded-md bg-gradient-to-r from-blue-500 to-blue-600 px-2 py-1 text-xs font-semibold text-white shadow-sm hover:from-blue-600 hover:to-blue-700 transition-all"
																			title={`Session ${apt.sessionNumber || idx + 1}${apt.date ? ` - ${formatDateLabel(apt.date)}` : ' - Not scheduled'}`}
																		>
																			<i className="fas fa-file-medical text-xs" aria-hidden="true" />
																			Session {apt.sessionNumber || idx + 1}
																		</button>
																	))}
																</div>
															)}
														</div>
													)}
												</td>
												<td className="px-4 py-4 text-sm text-slate-600">
													{nextAppointment ? (
														<>
															<p>{formatDateLabel(nextAppointment.date)} at {nextAppointment.time || '—'}</p>
															<p className="text-xs text-slate-500">
																with {nextAppointment.doctor || 'Not assigned'}
															</p>
														</>
													) : (
														'—'
													)}
												</td>
												<td className="px-4 py-4">
													<div className="flex flex-wrap gap-1">
														{statusCounts.pending > 0 && (
															<span className="badge-base status-badge-pending px-2 py-0.5 text-xs">
																{statusCounts.pending} Pending
															</span>
														)}
														{statusCounts.ongoing > 0 && (
															<span className="badge-base status-badge-ongoing px-2 py-0.5 text-xs">
																{statusCounts.ongoing} Ongoing
															</span>
														)}
														{statusCounts.completed > 0 && (
															<span className="badge-base status-badge-completed px-2 py-0.5 text-xs">
																{statusCounts.completed} Completed
															</span>
														)}
														{statusCounts.cancelled > 0 && (
															<span className="badge-base status-badge-cancelled px-2 py-0.5 text-xs">
																{statusCounts.cancelled} Cancelled
															</span>
														)}
													</div>
												</td>
												<td className="px-4 py-4 text-right">
													<button
														type="button"
														onClick={() => {
															setSelectedPatientId(group.patientId);
															setShowPatientAppointmentsModal(true);
														}}
														className="btn-primary"
													>
														<i className="fas fa-eye text-xs" aria-hidden="true" />
														View All
													</button>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</section>
			</div>

			{/* Booking Modal */}
			{showBookingModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
					<div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
						<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
							<div>
								<h2 className="text-lg font-semibold text-slate-900">Book New Appointment</h2>
								<p className="text-xs text-slate-500">Select patient, staff, date, and available time slot</p>
							</div>
							<button
								type="button"
								onClick={handleCloseBookingModal}
								className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:bg-slate-100 focus-visible:text-slate-600 focus-visible:outline-none"
								aria-label="Close dialog"
							>
								<i className="fas fa-times" aria-hidden="true" />
							</button>
						</header>
						<div className="max-h-[600px] overflow-y-auto px-6 py-4">
							<div className="space-y-4">
								{/* Patient Selection - Multiple Patients */}
								<div>
									<label className="block text-sm font-medium text-slate-700 mb-2">
										Patients <span className="text-rose-500">*</span>
										{bookingForm.patientIds.length > 0 && (
											<span className="ml-2 text-xs font-normal text-slate-500">
												({bookingForm.patientIds.length} selected)
											</span>
										)}
									</label>
									{availablePatients.length === 0 ? (
										<div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
											<p>No patients available. Patients must have their first appointment assigned by the frontdesk before clinical team can schedule additional appointments.</p>
										</div>
									) : (
										<div className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3">
											<div className="space-y-2">
												{availablePatients.map(patient => {
													const isSelected = bookingForm.patientIds.includes(patient.patientId);
													return (
														<label
															key={patient.id}
															className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-all ${
																isSelected
																	? 'border-indigo-500 bg-indigo-50'
																	: 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
															}`}
														>
															<input
																type="checkbox"
																checked={isSelected}
																onChange={e => {
																	if (e.target.checked) {
																		setBookingForm(prev => ({
																			...prev,
																			patientIds: [...prev.patientIds, patient.patientId],
																		}));
																	} else {
																		setBookingForm(prev => ({
																			...prev,
																			patientIds: prev.patientIds.filter(id => id !== patient.patientId),
																		}));
																	}
																}}
																className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-2 focus:ring-indigo-500"
															/>
															<div className="flex-1">
																<p className="text-sm font-medium text-slate-900">{patient.name}</p>
																<p className="text-xs text-slate-500">ID: {patient.patientId}</p>
															</div>
															{isSelected && (
																<i className="fas fa-check text-indigo-600" aria-hidden="true" />
															)}
														</label>
													);
												})}
											</div>
										</div>
									)}
									{bookingForm.patientIds.length > 0 && (
										<div className="mt-2 flex flex-wrap gap-2">
											{bookingForm.patientIds.map(pid => {
												const patient = availablePatients.find(p => p.patientId === pid);
												return patient ? (
													<span
														key={pid}
														className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-3 py-1 text-xs font-medium text-indigo-700"
													>
														{patient.name}
														<button
															type="button"
															onClick={() => {
																setBookingForm(prev => ({
																	...prev,
																	patientIds: prev.patientIds.filter(id => id !== pid),
																}));
															}}
															className="ml-1 rounded-full hover:bg-indigo-200 p-0.5"
															title="Remove patient"
														>
															<i className="fas fa-times text-xs" aria-hidden="true" />
														</button>
													</span>
												) : null;
											})}
										</div>
									)}
								</div>

								{/* Staff Selection */}
								<div>
									<label className="block text-sm font-medium text-slate-700">
										Clinician <span className="text-rose-500">*</span>
									</label>
									<select
										value={bookingForm.staffId}
										onChange={e => {
											setBookingForm(prev => ({ ...prev, staffId: e.target.value, date: '', time: '' }));
										}}
										className="select-base mt-2"
										required
										disabled={bookingLoading}
									>
										<option value="">
											{staff.length === 0 ? 'No clinicians available' : 'Select a clinician'}
										</option>
										{staff.map(member => (
											<option key={member.id} value={member.id}>
												{member.userName} ({member.role === 'ClinicalTeam' ? 'Clinical Team' : member.role})
											</option>
										))}
									</select>
									{staff.length === 0 && (
										<p className="mt-1 text-xs text-amber-600">
											No active clinicians found. Please ensure staff members are added and marked as Active with roles: Physiotherapist, StrengthAndConditioning, or ClinicalTeam.
										</p>
									)}
								</div>

								{/* Appointment Templates */}
								{bookingForm.staffId && (
									<div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
										<AppointmentTemplates
											doctor={staff.find(s => s.id === bookingForm.staffId)?.userName}
											onSelectTemplate={template => {
												const selectedStaff = staff.find(s => s.userName === template.doctor);
												if (selectedStaff) {
													setBookingForm(prev => ({
														...prev,
														staffId: selectedStaff.id,
														time: template.time,
														selectedTimes: template.time ? [template.time] : [],
														notes: template.notes || prev.notes,
													}));
												}
											}}
										/>
									</div>
								)}

								{/* Date Selection */}
								{bookingForm.staffId && (
									<div>
										<label className="block text-sm font-medium text-slate-700">
											Date <span className="text-rose-500">*</span>
										</label>
										<input
											type="date"
											value={bookingForm.date}
											onChange={e => {
												const newDate = e.target.value;
												// Save current day's selections before switching
												if (bookingForm.date && bookingForm.selectedTimes.length > 0) {
													saveCurrentDaySelections();
												}
												// Load saved selections for the new date
												setBookingForm(prev => {
													const newMap = new Map(prev.selectedAppointments);
													// Save current date selections
													if (prev.date && prev.selectedTimes.length > 0) {
														newMap.set(prev.date, [...prev.selectedTimes]);
													}
													// Load new date selections
													const saved = newMap.get(newDate);
													return {
														...prev,
														date: newDate,
														selectedTimes: saved ? [...saved] : [],
														time: saved && saved.length === 1 ? saved[0] : '',
														selectedAppointments: newMap,
													};
												});
											}}
											min={new Date().toISOString().split('T')[0]}
											className="input-base mt-2"
											required
										/>
										{bookingForm.date && getDayOfWeek(bookingForm.date) && (
											<p className="mt-1 text-xs text-slate-500">
												Selected: {getDayOfWeek(bookingForm.date)}
											</p>
										)}
									</div>
								)}

								{/* Time Slot Selection */}
								{bookingForm.date && (
									<div>
										<label className="block text-sm font-medium text-slate-700">
											Available Time Slots <span className="text-rose-500">*</span>
											{bookingForm.selectedTimes.length > 0 && (
												<span className="ml-2 text-xs font-normal text-slate-500">
													({bookingForm.selectedTimes.length} selected)
												</span>
											)}
										</label>
										{availableTimeSlots.length > 0 ? (
											<>
												<div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
													{availableTimeSlots.map(slotData => {
														const slot = typeof slotData === 'string' ? slotData : slotData.time;
														const patientCount = typeof slotData === 'object' ? slotData.patientCount : 0;
														const isSelected = bookingForm.selectedTimes.includes(slot);
														const isEmpty = patientCount === 0;
														return (
															<button
																key={slot}
																type="button"
																onClick={() => {
																	setBookingForm(prev => {
																		const newSelectedTimes = isSelected
																			? prev.selectedTimes.filter(t => t !== slot)
																			: [...prev.selectedTimes, slot].sort();
																		return {
																			...prev,
																			time: newSelectedTimes.length === 1 ? newSelectedTimes[0] : prev.time,
																			selectedTimes: newSelectedTimes,
																		};
																	});
																}}
																className={`rounded-lg border px-3 py-2 text-sm font-medium transition relative ${
																	isSelected
																		? 'border-sky-500 bg-sky-50 text-sky-700 ring-2 ring-sky-200'
																		: isEmpty
																		? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:border-emerald-400 hover:bg-emerald-100'
																		: 'border-slate-300 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50'
																}`}
																title={isEmpty ? 'No patients booked at this slot' : `${patientCount} patient${patientCount === 1 ? '' : 's'} booked at this slot`}
															>
																<div className="flex flex-col items-center gap-1">
																	<span>{slot}</span>
																	{isEmpty ? (
																		<span className="text-xs font-normal text-emerald-600">
																			<i className="fas fa-circle text-[6px] mr-1" aria-hidden="true" />
																			No patients
																		</span>
																	) : (
																		<span className={`text-xs font-semibold ${
																			isSelected ? 'text-sky-600' : 'text-slate-600'
																		}`}>
																			<i className="fas fa-users mr-1" aria-hidden="true" />
																			{patientCount} {patientCount === 1 ? 'patient' : 'patients'}
																		</span>
																	)}
																</div>
																{isSelected && (
																	<i className="fas fa-check absolute top-1 right-1 text-xs" aria-hidden="true" />
																)}
															</button>
														);
													})}
												</div>
												{bookingForm.selectedTimes.length > 0 && (
													<div className="mt-3 flex items-center justify-between rounded-lg border border-sky-200 bg-sky-50 px-3 py-2">
														<span className="text-sm text-sky-700">
															Selected: {bookingForm.selectedTimes.join(', ')}
														</span>
														<div className="flex gap-2">
															<button
																type="button"
																onClick={() => {
																	saveCurrentDaySelections();
																	alert('Selections saved! You can now navigate to another day.');
																}}
																className="text-xs font-medium text-sky-600 hover:text-sky-700"
																title="Save selections for this day"
															>
																<i className="fas fa-save mr-1" aria-hidden="true" />
																Save
															</button>
															<button
																type="button"
																onClick={() => setBookingForm(prev => ({ ...prev, selectedTimes: [], time: '' }))}
																className="text-xs font-medium text-sky-600 hover:text-sky-700"
															>
																Clear
															</button>
														</div>
													</div>
												)}
											</>
										) : (
											<div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
												<i className="fas fa-calendar-times mr-2" aria-hidden="true" />
												No slots available. The clinician has not set a schedule for this date. Please select another date or ask the clinician to set their availability.
											</div>
										)}
									</div>
								)}

								{/* Saved Appointments for Other Days */}
								{bookingForm.selectedAppointments.size > 0 && (
									<div className="rounded-lg border border-sky-200 bg-sky-50 p-4">
										<div className="mb-2 flex items-center justify-between">
											<h4 className="text-sm font-semibold text-sky-900">
												Saved Appointments ({Array.from(bookingForm.selectedAppointments.values()).reduce((sum, times) => sum + times.length, 0)} total)
											</h4>
										</div>
										<div className="space-y-2">
											{Array.from(bookingForm.selectedAppointments.entries())
												.filter(([date]) => date !== bookingForm.date)
												.map(([date, times]) => (
													<div key={date} className="flex items-center justify-between rounded-md border border-sky-200 bg-white px-3 py-2">
														<div className="flex-1">
															<p className="text-sm font-medium text-slate-900">
																{formatDateLabel(date)} ({getDayOfWeek(date)})
															</p>
															<p className="text-xs text-slate-600">{times.join(', ')}</p>
														</div>
														<button
															type="button"
															onClick={() => {
																setBookingForm(prev => {
																	const newMap = new Map(prev.selectedAppointments);
																	newMap.delete(date);
																	return {
																		...prev,
																		selectedAppointments: newMap,
																	};
																});
															}}
															className="ml-2 rounded p-1 text-xs text-rose-600 hover:bg-rose-50"
															title="Remove saved appointments for this date"
														>
															<i className="fas fa-times" aria-hidden="true" />
														</button>
													</div>
												))}
										</div>
									</div>
								)}

								{/* Package Section */}
								{bookingForm.patientIds.length > 0 && (
									<div className="rounded-lg border-2 border-purple-200 bg-purple-50/50 p-4">
										<div className="mb-3 flex items-center justify-between">
											<label className="flex items-center gap-2 text-sm font-semibold text-slate-900">
												<input
													type="checkbox"
													checked={bookingForm.addPackage}
													onChange={e => {
														setBookingForm(prev => ({
															...prev,
															addPackage: e.target.checked,
															withConsultation: e.target.checked ? prev.withConsultation : false,
															consultationDiscount: e.target.checked ? prev.consultationDiscount : '0',
														}));
													}}
													className="h-4 w-4 rounded border-slate-300 text-purple-600 focus:ring-2 focus:ring-purple-500"
												/>
												<span>Add Package</span>
											</label>
										</div>

										{bookingForm.addPackage && (
											<div className="space-y-3 mt-3">
												{/* Number of Sessions */}
												<div>
													<label className="block text-xs font-medium text-slate-700 mb-1">
														Number of Sessions <span className="text-rose-500">*</span>
													</label>
													<input
														type="number"
														min="1"
														value={bookingForm.packageSessions}
														onChange={e => setBookingForm(prev => ({ ...prev, packageSessions: e.target.value }))}
														className="input-base"
														placeholder="Enter number of sessions"
														required
													/>
												</div>

												{/* Package Amount */}
												<div>
													<label className="block text-xs font-medium text-slate-700 mb-1">
														Package Amount (₹) <span className="text-rose-500">*</span>
													</label>
													<input
														type="number"
														min="0"
														step="0.01"
														value={bookingForm.packageAmount}
														onChange={e => setBookingForm(prev => ({ ...prev, packageAmount: e.target.value }))}
														className="input-base"
														placeholder="Enter package amount"
														required
													/>
												</div>

												{/* With/Without Consultation */}
												<div>
													<label className="flex items-center gap-2 text-xs font-medium text-slate-700 mb-2">
														<input
															type="checkbox"
															checked={bookingForm.withConsultation}
															onChange={e => {
																setBookingForm(prev => ({
																	...prev,
																	withConsultation: e.target.checked,
																	consultationDiscount: e.target.checked ? prev.consultationDiscount : '0',
																}));
															}}
															className="h-4 w-4 rounded border-slate-300 text-purple-600 focus:ring-2 focus:ring-purple-500"
														/>
														<span>With Consultation</span>
													</label>

													{bookingForm.withConsultation && (
														<div className="mt-2">
															<label className="block text-xs font-medium text-slate-700 mb-1">
																Consultation Discount (%)
															</label>
															<select
																value={bookingForm.consultationDiscount}
																onChange={e => setBookingForm(prev => ({ ...prev, consultationDiscount: e.target.value }))}
																className="select-base"
															>
																{[5, 10, 15, 20, 25, 30, 35, 40, 45, 50].map(percent => (
																	<option key={percent} value={percent}>
																		{percent}%
																	</option>
																))}
															</select>
														</div>
													)}
												</div>

												{/* Total Amount Display */}
												{bookingForm.packageAmount && (
													<div className="rounded-lg border border-purple-300 bg-white p-3">
														<div className="flex items-center justify-between text-sm">
															<span className="font-medium text-slate-700">Package Amount:</span>
															<span className="font-semibold text-slate-900">₹{Number(bookingForm.packageAmount).toFixed(2)}</span>
														</div>
														{bookingForm.withConsultation && Number(bookingForm.consultationDiscount) > 0 && (
															<>
																<div className="flex items-center justify-between text-xs mt-1 text-slate-600">
																	<span>Discount ({bookingForm.consultationDiscount}%):</span>
																	<span className="text-red-600">
																		-₹{((Number(bookingForm.packageAmount) * Number(bookingForm.consultationDiscount)) / 100).toFixed(2)}
																	</span>
																</div>
																<div className="flex items-center justify-between text-sm mt-2 pt-2 border-t border-slate-200">
																	<span className="font-bold text-slate-900">Total Amount:</span>
																	<span className="font-bold text-purple-600">
																		₹{(Number(bookingForm.packageAmount) * (1 - Number(bookingForm.consultationDiscount) / 100)).toFixed(2)}
																	</span>
																</div>
															</>
														)}
														{!bookingForm.withConsultation && (
															<div className="flex items-center justify-between text-sm mt-2 pt-2 border-t border-slate-200">
																<span className="font-bold text-slate-900">Total Amount:</span>
																<span className="font-bold text-purple-600">₹{Number(bookingForm.packageAmount).toFixed(2)}</span>
															</div>
														)}
													</div>
												)}
											</div>
										)}
									</div>
								)}

								{/* Notes */}
								<div>
									<label className="block text-sm font-medium text-slate-700">Notes (Optional)</label>
									<textarea
										value={bookingForm.notes}
										onChange={e => setBookingForm(prev => ({ ...prev, notes: e.target.value }))}
										className="input-base mt-2"
										rows={3}
										placeholder="Add any additional notes about this appointment..."
									/>
								</div>
							</div>
						</div>
						<footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
							<div className="flex gap-3">
								<button
									type="button"
									onClick={handleCloseBookingModal}
									className="btn-secondary"
									disabled={bookingLoading}
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={handleCreateAppointment}
									className="btn-primary"
									disabled={bookingLoading || bookingForm.patientIds.length === 0 || !bookingForm.staffId || !bookingForm.date || (bookingForm.selectedTimes.length === 0 && bookingForm.selectedAppointments.size === 0 && !bookingForm.time)}
								>
								{bookingLoading ? (
									<>
										<div className="inline-flex h-4 w-4 items-center justify-center rounded-full border-2 border-white border-t-transparent animate-spin mr-2" aria-hidden="true" />
										Creating...
									</>
								) : (
									<>
										<i className="fas fa-check text-xs" aria-hidden="true" />
										{(() => {
											const currentDayCount = bookingForm.selectedTimes.length;
											const otherDaysCount = Array.from(bookingForm.selectedAppointments.entries())
												.filter(([date]) => date !== bookingForm.date)
												.reduce((sum, [, times]) => sum + times.length, 0);
											const totalCount = currentDayCount + otherDaysCount;
											if (totalCount > 1) {
												return `Create ${totalCount} Appointments`;
											}
											return 'Create Appointment';
										})()}
									</>
								)}
							</button>
							</div>
						</footer>
					</div>
				</div>
			)}

			{/* Patient Appointments Modal */}
			{showPatientAppointmentsModal && selectedPatientId && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
					<div className="w-full max-w-5xl rounded-2xl border border-slate-200 bg-white shadow-2xl max-h-[90vh] flex flex-col">
						<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
							<div>
								<h2 className="text-lg font-semibold text-slate-900">
									{selectedPatientAppointments[0]?.patient || 'Patient'} Appointments
								</h2>
								<p className="text-xs text-slate-500">
									{selectedPatientAppointments.length} appointment{selectedPatientAppointments.length === 1 ? '' : 's'} total
								</p>
							</div>
							<button
								type="button"
								onClick={() => {
									setShowPatientAppointmentsModal(false);
									setSelectedPatientId(null);
								}}
								className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:bg-slate-100 focus-visible:text-slate-600 focus-visible:outline-none"
								aria-label="Close dialog"
							>
								<i className="fas fa-times" aria-hidden="true" />
							</button>
						</header>
						<div className="flex-1 overflow-y-auto px-6 py-4">
							{selectedPatientAppointments.length === 0 ? (
								<div className="py-8 text-center text-sm text-slate-500">
									No appointments found for this patient.
								</div>
							) : (
								<div className="overflow-x-auto">
									<table className="min-w-full divide-y divide-slate-200 text-left text-sm text-slate-700">
										<thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 sticky top-0">
											<tr>
												<th className="px-4 py-3 font-semibold">Appointment</th>
												<th className="px-4 py-3 font-semibold">Clinician</th>
												<th className="px-4 py-3 font-semibold">When</th>
												<th className="px-4 py-3 font-semibold">Status</th>
												<th className="px-4 py-3 font-semibold">Notes</th>
												<th className="px-4 py-3 font-semibold text-right">Actions</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-slate-100">
											{selectedPatientAppointments.map(appointment => {
												const patientDetails = patients.find(p => p.patientId === appointment.patientId);
												const isEditing = editingId === appointment.appointmentId;
												const isUpdating = updating[appointment.id] || false;

												return (
													<tr key={appointment.appointmentId}>
														<td className="px-4 py-4">
															<p className="font-semibold text-slate-900">{appointment.appointmentId}</p>
															<p className="text-xs text-slate-500">
																Booked {formatDateLabel(appointment.createdAt)}
															</p>
														</td>
														<td className="px-4 py-4 text-sm text-slate-600">{appointment.doctor || 'Not assigned'}</td>
														<td className="px-4 py-4 text-sm text-slate-600">
															{formatDateLabel(appointment.date)} at {appointment.time || '—'}
														</td>
														<td className="px-4 py-4">
															<select
																value={appointment.status}
																onChange={event =>
																	handleStatusChange(
																		appointment.appointmentId,
																		event.target.value as AdminAppointmentStatus,
																	)
																}
																disabled={isUpdating}
																className="select-base"
															>
																<option value="pending">Pending</option>
																<option value="ongoing">Ongoing</option>
																<option value="completed">Completed</option>
																<option value="cancelled">Cancelled</option>
															</select>
														</td>
														<td className="px-4 py-4">
															{isEditing ? (
																<div className="space-y-2">
																	<textarea
																		value={notesDraft}
																		onChange={event => setNotesDraft(event.target.value)}
																		className="input-base"
																		rows={2}
																	/>
																	<div className="flex items-center gap-2">
																		<button
																			type="button"
																			onClick={handleSaveNotes}
																			disabled={isUpdating}
																			className="btn-primary"
																		>
																			{isUpdating ? 'Saving...' : 'Save'}
																		</button>
																		<button
																			type="button"
																			onClick={handleCancelEditing}
																			disabled={isUpdating}
																			className="btn-secondary"
																		>
																			Cancel
																		</button>
																	</div>
																</div>
															) : (
																<div className="space-y-2">
																	<p className="text-sm text-slate-600">{appointment.notes || 'No notes added.'}</p>
																	<button
																		type="button"
																		onClick={() => handleEditNotes(appointment)}
																		className="text-xs font-semibold text-sky-600 hover:text-sky-500"
																	>
																		Edit notes
																	</button>
																</div>
															)}
														</td>
														<td className="px-4 py-4 text-right">
															<div className="inline-flex items-center gap-2">
																<span
																	className={`badge-base px-3 py-1 ${STATUS_BADGES[appointment.status]}`}
																>
																	{appointment.status.charAt(0).toUpperCase() + appointment.status.slice(1)}
																</span>
																<button
																	type="button"
																	onClick={() => handleRemove(appointment.appointmentId)}
																	disabled={isUpdating}
																	className="inline-flex items-center gap-1 rounded-full border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-600 transition hover:border-rose-300 hover:text-rose-700 focus-visible:border-rose-300 focus-visible:text-rose-700 focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
																>
																	<i className="fas fa-trash text-[10px]" aria-hidden="true" />
																	Delete
																</button>
															</div>
														</td>
													</tr>
												);
											})}
										</tbody>
									</table>
								</div>
							)}
						</div>
						<footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
							<button
								type="button"
								onClick={() => {
									setShowPatientAppointmentsModal(false);
									setSelectedPatientId(null);
								}}
								className="btn-secondary"
							>
								Close
							</button>
						</footer>
					</div>
				</div>
			)}

			{/* Add Package Modal */}
			{showPackageModal && packagePatientId && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
					<div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
						<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
							<div>
								<h2 className="text-lg font-semibold text-slate-900">Add Package</h2>
								<p className="text-xs text-slate-500">
									Patient: {patients.find(p => p.patientId === packagePatientId)?.name || packagePatientId}
								</p>
							</div>
							<button
								type="button"
								onClick={() => {
									setShowPackageModal(false);
									setPackagePatientId(null);
									setPackageForm({
										packageName: '',
										totalSessions: '',
										amount: '',
										consultationType: 'without',
										discount: '0',
										description: '',
									});
								}}
								className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:bg-slate-100 focus-visible:text-slate-600 focus-visible:outline-none"
								aria-label="Close dialog"
							>
								<i className="fas fa-times" aria-hidden="true" />
							</button>
						</header>
						<div className="max-h-[600px] overflow-y-auto px-6 py-4">
							<div className="space-y-4">
								{/* Package Name */}
								<div>
									<label className="block text-sm font-medium text-slate-700">
										Package Name <span className="text-rose-500">*</span>
									</label>
									<input
										type="text"
										value={packageForm.packageName}
										onChange={e => setPackageForm(prev => ({ ...prev, packageName: e.target.value }))}
										className="input-base mt-2"
										placeholder="Enter package name"
										required
									/>
								</div>

								{/* Total Sessions */}
								<div>
									<label className="block text-sm font-medium text-slate-700">
										Total Sessions <span className="text-rose-500">*</span>
									</label>
									<input
										type="number"
										min="1"
										value={packageForm.totalSessions}
										onChange={e => setPackageForm(prev => ({ ...prev, totalSessions: e.target.value }))}
										className="input-base mt-2"
										placeholder="Enter number of sessions"
										required
									/>
								</div>

								{/* Amount */}
								<div>
									<label className="block text-sm font-medium text-slate-700">
										Amount (₹) <span className="text-rose-500">*</span>
									</label>
									<input
										type="number"
										min="0"
										step="0.01"
										value={packageForm.amount}
										onChange={e => setPackageForm(prev => ({ ...prev, amount: e.target.value }))}
										className="input-base mt-2"
										placeholder="Enter package amount"
										required
									/>
								</div>

								{/* Consultation Type */}
								<div>
									<label className="block text-sm font-medium text-slate-700 mb-2">
										Consultation Type <span className="text-rose-500">*</span>
									</label>
									<select
										value={packageForm.consultationType}
										onChange={e => setPackageForm(prev => ({
											...prev,
											consultationType: e.target.value as 'with' | 'without',
											discount: e.target.value === 'without' ? '0' : prev.discount,
										}))}
										className="select-base"
									>
										<option value="without">Without Consultation</option>
										<option value="with">With Consultation</option>
									</select>
								</div>

								{/* Discount (if With Consultation) */}
								{packageForm.consultationType === 'with' && (
									<div>
										<label className="block text-sm font-medium text-slate-700 mb-2">
											Discount (%)
										</label>
										<select
											value={packageForm.discount}
											onChange={e => setPackageForm(prev => ({ ...prev, discount: e.target.value }))}
											className="select-base"
										>
											{[5, 10, 15, 20, 25, 30, 35, 40, 45, 50].map(percent => (
												<option key={percent} value={percent}>
													{percent}%
												</option>
											))}
										</select>
									</div>
								)}

								{/* Total Amount Display */}
								{packageForm.amount && (
									<div className="rounded-lg border-2 border-purple-200 bg-purple-50 p-4">
										<div className="flex items-center justify-between text-sm mb-1">
											<span className="font-medium text-slate-700">Package Amount:</span>
											<span className="font-semibold text-slate-900">₹{Number(packageForm.amount).toFixed(2)}</span>
										</div>
										{packageForm.consultationType === 'with' && Number(packageForm.discount) > 0 && (
											<>
												<div className="flex items-center justify-between text-xs mt-1 text-slate-600">
													<span>Discount ({packageForm.discount}%):</span>
													<span className="text-red-600">
														-₹{((Number(packageForm.amount) * Number(packageForm.discount)) / 100).toFixed(2)}
													</span>
												</div>
												<div className="flex items-center justify-between text-sm mt-2 pt-2 border-t border-slate-200">
													<span className="font-bold text-slate-900">Total Amount:</span>
													<span className="font-bold text-purple-600">
														₹{(Number(packageForm.amount) * (1 - Number(packageForm.discount) / 100)).toFixed(2)}
													</span>
												</div>
											</>
										)}
										{packageForm.consultationType === 'without' && (
											<div className="flex items-center justify-between text-sm mt-2 pt-2 border-t border-slate-200">
												<span className="font-bold text-slate-900">Total Amount:</span>
												<span className="font-bold text-purple-600">₹{Number(packageForm.amount).toFixed(2)}</span>
											</div>
										)}
									</div>
								)}

								{/* Description */}
								<div>
									<label className="block text-sm font-medium text-slate-700">Description (Optional)</label>
									<textarea
										value={packageForm.description}
										onChange={e => setPackageForm(prev => ({ ...prev, description: e.target.value }))}
										className="input-base mt-2"
										rows={4}
										placeholder="Enter package description..."
									/>
								</div>
							</div>
						</div>
						<footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
							<button
								type="button"
								onClick={() => {
									setShowPackageModal(false);
									setPackagePatientId(null);
									setPackageForm({
										packageName: '',
										totalSessions: '',
										amount: '',
										consultationType: 'without',
										discount: '0',
										description: '',
									});
								}}
								className="btn-secondary"
								disabled={packageSubmitting}
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleAddPackage}
								disabled={packageSubmitting || !packageForm.packageName.trim() || !packageForm.totalSessions || !packageForm.amount}
								className="btn-primary"
							>
								{packageSubmitting ? (
									<>
										<div className="inline-flex h-4 w-4 items-center justify-center rounded-full border-2 border-white border-t-transparent animate-spin mr-2" aria-hidden="true" />
										Adding...
									</>
								) : (
									<>
										<i className="fas fa-check text-xs" aria-hidden="true" />
										Add Package
									</>
								)}
							</button>
						</footer>
					</div>
				</div>
			)}

			{/* Report Modal */}
			{showReportModal && reportModalPatientId && (
				<EditReportModal
					isOpen={showReportModal}
					patientId={reportModalPatientId}
					initialTab="report"
					onClose={() => {
						setShowReportModal(false);
						setReportModalPatientId(null);
					}}
					editable={true}
				/>
			)}

		</div>
	);
}

