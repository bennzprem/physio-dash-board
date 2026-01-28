'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, updateDoc, deleteDoc, addDoc, serverTimestamp, query, where, getDocs, getDoc, type QuerySnapshot, type Timestamp, deleteField } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/PageHeader';
import type { AdminAppointmentStatus, AdminPatientStatus, AdminGenderOption } from '@/lib/adminMockData';
import type { PatientRecord } from '@/lib/types';
import { sendEmailNotification } from '@/lib/email';
import { sendSMSNotification, isValidPhoneNumber } from '@/lib/sms';
import { checkAppointmentConflict } from '@/lib/appointmentUtils';
import { normalizeSessionAllowance } from '@/lib/sessionAllowance';
import { recordSessionUsageForAppointment } from '@/lib/sessionAllowanceClient';
import type { RecordSessionUsageResult } from '@/lib/sessionAllowanceClient';
import EditReportModal from '@/components/clinical-team/EditReportModal';
import { createInitialSessionAllowance } from '@/lib/sessionAllowance';
import { createDYESBilling } from '@/lib/dyesBilling';

interface FrontdeskAppointment {
	id: string;
	appointmentId: string;
	patientId: string;
	patient: string;
	doctor: string;
	staffId?: string;
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
	registeredBy?: string;
	registeredByName?: string;
	registeredByEmail?: string;
	registeredAt?: string;
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

function formatDurationLabel(minutes: number) {
	if (minutes % 60 === 0) {
		const hours = minutes / 60;
		return hours === 1 ? '1 hr' : `${hours} hrs`;
	}
	if (minutes > 60) {
		const hours = Math.floor(minutes / 60);
		const remaining = minutes % 60;
		return `${hours} hr ${remaining} min`;
	}
	return `${minutes} min`;
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

async function generatePatientId(): Promise<string> {
	const prefix = 'CSS';
	const year = new Date().getFullYear();
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

	const patientsSnapshot = await getDocs(collection(db, 'patients'));
	const existingIds = new Set(patientsSnapshot.docs.map(docSnap => docSnap.data().patientId).filter(Boolean));

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
const GENDER_OPTIONS: Array<{ value: AdminGenderOption; label: string }> = [
	{ value: '', label: 'Select' },
	{ value: 'Male', label: 'Male' },
	{ value: 'Female', label: 'Female' },
	{ value: 'Other', label: 'Other' },
];
const PATIENT_TYPE_OPTIONS: Array<{ value: 'DYES' | 'VIP' | 'GETHNA' | 'PAID' | 'OTHERS' | 'STAFF' | ''; label: string }> = [
	{ value: 'DYES', label: 'DYES' },
	{ value: 'VIP', label: 'VIP' },
	{ value: 'PAID', label: 'PAID' },
	{ value: 'GETHNA', label: 'GETHNA' },
	{ value: 'STAFF', label: 'STAFF' },
	{ value: 'OTHERS', label: 'Others' },
];

export default function Appointments() {
	const { user } = useAuth();
	const [extraTreatmentFlags, setExtraTreatmentFlags] = useState<Record<string, boolean>>({});
	const [statusChangePending, setStatusChangePending] = useState<{ appointmentId: string; status: AdminAppointmentStatus; appointment: any } | null>(null);
	const [appointments, setAppointments] = useState<FrontdeskAppointment[]>([]);
	const [patients, setPatients] = useState<PatientRecordWithSessions[]>([]);
	const [staff, setStaff] = useState<StaffMember[]>([]);
	const [loading, setLoading] = useState(true);
	const [searchTerm, setSearchTerm] = useState('');
	const [showAllAppointments, setShowAllAppointments] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [notesDraft, setNotesDraft] = useState('');
	const [updating, setUpdating] = useState<Record<string, boolean>>({});
	const [editingDateTimeId, setEditingDateTimeId] = useState<string | null>(null);
	const [dateTimeDraft, setDateTimeDraft] = useState<{ date: string; time: string }>({ date: '', time: '' });
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
	const [editingSlotTime, setEditingSlotTime] = useState<string | null>(null);
	const [editedSlotTime, setEditedSlotTime] = useState<string>('');

	const [removingPackageForPatientId, setRemovingPackageForPatientId] = useState<string | null>(null);
	const [customTimeSlots, setCustomTimeSlots] = useState<Map<string, string>>(new Map());
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
	const [showRegisterModal, setShowRegisterModal] = useState(false);
	const [registerForm, setRegisterForm] = useState({
		fullName: '',
		dob: '',
		gender: '' as AdminGenderOption,
		phone: '',
		email: '',
		address: '',
		patientType: '' as 'DYES' | 'VIP' | 'GETHNA' | 'PAID' | 'OTHERS' | 'STAFF' | '',
	});
	const [registerFormErrors, setRegisterFormErrors] = useState<Partial<Record<keyof typeof registerForm, string>>>({});
	const [registerSubmitting, setRegisterSubmitting] = useState(false);
	const [registerNotice, setRegisterNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
	const [newlyRegisteredPatientId, setNewlyRegisteredPatientId] = useState<string | null>(null);
	const [patientSearchTerm, setPatientSearchTerm] = useState('');
	const [billingRecords, setBillingRecords] = useState<Array<{ appointmentId?: string; status: 'Pending' | 'Completed' | 'Auto-Paid'; amount?: number }>>([]);

	// Load billing records from Firestore
	useEffect(() => {
		const unsubscribe = onSnapshot(
			collection(db, 'billing'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data() as Record<string, unknown>;
					return {
						appointmentId: data.appointmentId ? String(data.appointmentId) : undefined,
						status: (data.status as 'Pending' | 'Completed' | 'Auto-Paid') || 'Pending',
						amount: typeof data.amount === 'number' ? data.amount : undefined,
					};
				});
				setBillingRecords([...mapped]);
			},
			error => {
				console.error('Failed to load billing records', error);
				setBillingRecords([]);
			}
		);

		return () => unsubscribe();
	}, []);

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
						staffId: data.staffId ? String(data.staffId) : undefined,
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
				setAppointments([...mapped]);
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
					
					// Handle registeredAt - can be Timestamp, string, or undefined
					let registeredAt: string | undefined = undefined;
					const registeredAtValue = data.registeredAt;
					if (registeredAtValue) {
						if (registeredAtValue instanceof Date) {
							registeredAt = registeredAtValue.toISOString();
						} else if (typeof registeredAtValue === 'string') {
							registeredAt = registeredAtValue;
						} else if (registeredAtValue && typeof registeredAtValue === 'object' && 'toDate' in registeredAtValue) {
							// Firestore Timestamp
							const timestamp = registeredAtValue as Timestamp;
							const date = timestamp.toDate?.();
							if (date && !isNaN(date.getTime())) {
								registeredAt = date.toISOString();
							}
						} else if (registeredAtValue && typeof registeredAtValue === 'object' && 'seconds' in registeredAtValue) {
							// Firestore Timestamp with seconds property
							const timestamp = registeredAtValue as { seconds: number; nanoseconds?: number };
							const date = new Date(timestamp.seconds * 1000);
							if (!isNaN(date.getTime())) {
								registeredAt = date.toISOString();
							}
						}
					}
					
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
						registeredBy: data.registeredBy ? String(data.registeredBy) : undefined,
						registeredByName: data.registeredByName ? String(data.registeredByName) : undefined,
						registeredByEmail: data.registeredByEmail ? String(data.registeredByEmail) : undefined,
						registeredAt,
					} as PatientRecordWithSessions;
				});
				// Debug: Log registeredAt data
				if (process.env.NODE_ENV === 'development') {
					const withDates = mapped.filter(p => p.registeredAt);
					console.log('📅 Patients loaded:', {
						total: mapped.length,
						withRegisteredAt: withDates.length,
						sample: withDates.slice(0, 3).map(p => ({
							name: p.name,
							registeredAt: p.registeredAt,
							formatted: p.registeredAt ? formatDateLabel(p.registeredAt) : 'N/A'
						}))
					});
				}
				setPatients([...mapped]);
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
				setStaff([...mapped.filter(s => 
					s.status === 'Active' && 
					['Physiotherapist', 'StrengthAndConditioning', 'ClinicalTeam'].includes(s.role)
				)]);
			},
			error => {
				console.error('Failed to load staff', error);
				setStaff([]);
			}
		);

		return () => unsubscribe();
	}, []);

	// Auto-open booking modal when a newly registered patient appears in the list
	useEffect(() => {
		if (!newlyRegisteredPatientId) return;

		// Find the newly registered patient in the patients list
		const newPatient = patients.find(p => p.patientId === newlyRegisteredPatientId);
		if (newPatient) {
			// Pre-populate booking form with the new patient
			setBookingForm({
				patientIds: [newlyRegisteredPatientId],
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
			setShowBookingModal(true);
			setNewlyRegisteredPatientId(null); // Reset after opening modal
		}
	}, [patients, newlyRegisteredPatientId]);

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

	// Default availability: 9 AM to 6 PM for all days except Sunday
	const DEFAULT_START_TIME = '09:00';
	const DEFAULT_END_TIME = '18:00';
	const DEFAULT_DAY_AVAILABILITY: DayAvailability = {
		enabled: true,
		slots: [{ start: DEFAULT_START_TIME, end: DEFAULT_END_TIME }],
	};

	// Get availability for a specific date (checks date-specific, falls back to default availability)
	const getDateAvailability = (staffMember: StaffMember, dateString: string): DayAvailability | null => {
		const dateKey = formatDateKey(dateString);
		const dateObj = new Date(dateString + 'T00:00:00');
		const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
		const isSunday = dayName === 'Sunday';
		
		// Sunday is always unavailable
		if (isSunday) {
			return { enabled: false, slots: [] };
		}
		
		// Check for date-specific availability
		if (staffMember.dateSpecificAvailability?.[dateKey]) {
			const dateSpecific = staffMember.dateSpecificAvailability[dateKey];
			// If marked as unavailable (enabled: false), return it
			if (!dateSpecific.enabled) {
				return dateSpecific;
			}
			// If enabled, use the date-specific schedule
			return dateSpecific;
		}

		// No date-specific schedule exists - use default availability (9 AM - 6 PM)
		if (process.env.NODE_ENV === 'development') {
			console.log('✅ Using default availability (9 AM - 6 PM) for', dateKey);
		}
		return DEFAULT_DAY_AVAILABILITY;
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
			// Clinical team users can book appointments even if the time has passed
			let currentTime = new Date(startTime);
			while (currentTime < endTime) {
				const timeString = `${String(currentTime.getHours()).padStart(2, '0')}:${String(currentTime.getMinutes()).padStart(2, '0')}`;
				
				// Include all slots (booked or not) - we'll show patient counts
				// Note: Clinical team users can book past time slots
				slots.push(timeString);
				currentTime.setMinutes(currentTime.getMinutes() + SLOT_INTERVAL_MINUTES);
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
		const seenIds = new Set<string>();
		
		appointments.forEach(apt => {
			// Include appointments that have packageBillingId OR have sessionNumber (for package sessions)
			// This ensures all package sessions are included even if packageBillingId is missing
			const isPackageAppointment = (apt.packageBillingId && apt.patientId && apt.id) ||
				(apt.sessionNumber != null && apt.patientId && apt.id && apt.totalSessions != null);
			
			if (isPackageAppointment) {
				// Deduplicate by appointment ID
				if (seenIds.has(apt.id)) {
					return; // Skip duplicate
				}
				seenIds.add(apt.id);
				
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
				// Sort by sessionNumber first to match package view order
				if (a.sessionNumber !== undefined && b.sessionNumber !== undefined) {
					return a.sessionNumber - b.sessionNumber;
				}
				if (a.sessionNumber !== undefined) return -1;
				if (b.sessionNumber !== undefined) return 1;
				// If no sessionNumber, sort by date/time
				const aDate = new Date(`${a.date}T${a.time}`).getTime();
				const bDate = new Date(`${b.date}T${b.time}`).getTime();
				return bDate - aDate;
			});
	}, [appointments, selectedPatientId]);

	// Calculate total appointments count for header
	const totalAppointmentsCount = useMemo(() => {
		return groupedByPatient.reduce((sum, group) => sum + group.appointments.length, 0);
	}, [groupedByPatient]);

	// Show all patients to all users (no filtering by registeredBy or assignedDoctor)
	const availablePatients = useMemo(() => {
		return patients;
	}, [patients]);

	// Filter patients based on search term for booking modal and sort by latest registration
	const filteredAvailablePatients = useMemo(() => {
		let filtered = availablePatients;
		
		// Apply search filter if search term exists
		if (patientSearchTerm.trim()) {
			const query = patientSearchTerm.trim().toLowerCase();
			filtered = availablePatients.filter(patient => 
				patient.name.toLowerCase().includes(query) ||
				patient.patientId.toLowerCase().includes(query)
			);
		}
		
		// Sort by latest registration date first, then alphabetically by name
		return [...filtered].sort((a, b) => {
			// First, sort by registration date (latest first)
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
			
			// Sort by date (latest first) - use negative value for missing dates to push them to end
			if (dateA === 0 && dateB === 0) {
				// Both missing dates - sort alphabetically
				const nameA = a.name.toLowerCase().trim();
				const nameB = b.name.toLowerCase().trim();
				return nameA.localeCompare(nameB);
			} else if (dateA === 0) {
				// A has no date, B has date - B comes first
				return 1;
			} else if (dateB === 0) {
				// B has no date, A has date - A comes first
				return -1;
			} else {
				// Both have dates - latest first
				if (dateB !== dateA) {
					return dateB - dateA;
				}
				// Same date - sort alphabetically
				const nameA = a.name.toLowerCase().trim();
				const nameB = b.name.toLowerCase().trim();
				return nameA.localeCompare(nameB);
			}
		});
	}, [availablePatients, patientSearchTerm]);

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
		
		// If marking as completed for a DYES patient, check if we need to prompt for extra treatment
		if (status === 'completed' && oldStatus !== 'completed' && patientDetails) {
			const patientType = (patientDetails.patientType || '').toUpperCase();
			if (patientType === 'DYES') {
				// Check if extra treatment flag is already set, otherwise show modal
				const isExtra = extraTreatmentFlags[appointmentId] || false;
				// Continue with the existing logic but pass the flag
			}
		}

		const staffMember = staff.find(s => s.userName === appointment.doctor);
		let sessionUsageResult: RecordSessionUsageResult | null = null;

		setUpdating(prev => ({ ...prev, [appointment.id]: true }));
		try {
			const appointmentRef = doc(db, 'appointments', appointment.id);
			const isExtraTreatment = extraTreatmentFlags[appointmentId] || false;
			
			await updateDoc(appointmentRef, {
				status,
				isExtraTreatment: status === 'completed' ? isExtraTreatment : false,
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

				// Automatically create billing for DYES patients
				const patientType = (patientDetails.patientType || '').toUpperCase();
				if (patientType === 'DYES' || patientType === 'DYES') {
					try {
						await createDYESBilling({
							appointmentId: appointment.appointmentId,
							appointmentDocId: appointment.id,
							patientId: appointment.patientId,
							patientName: appointment.patient || '',
							doctorName: appointment.doctor || '',
							appointmentDate: appointment.date || '',
							createdByUserId: user?.uid || null,
							createdByUserName: user?.displayName || user?.email || null,
							isExtraTreatment: isExtraTreatment,
						});
					} catch (billingError) {
						console.error('Failed to create automatic DYES billing:', billingError);
					}
				}

				// Automatically mark payments as completed for VIP patients and set amount to 0
				if (patientType === 'VIP') {
					try {
						// Find billing records for this appointment
						const billingQuery = query(
							collection(db, 'billing'),
							where('appointmentId', '==', appointment.appointmentId)
						);
						const billingSnapshot = await getDocs(billingQuery);
						
						if (!billingSnapshot.empty) {
							// Update all billing records for this appointment to Completed with amount 0
							const updatePromises = billingSnapshot.docs.map(billingDoc => {
								const billingData = billingDoc.data();
								// Update if status is Pending or amount is not 0
								if (billingData.status === 'Pending' || billingData.amount !== 0) {
									return updateDoc(doc(db, 'billing', billingDoc.id), {
										amount: 0,
										status: 'Completed',
										paymentMode: 'Auto-Paid',
										updatedAt: serverTimestamp(),
									});
								}
								return Promise.resolve();
							});
							
							await Promise.all(updatePromises);
						}
					} catch (vipBillingError) {
						console.error('Failed to auto-complete VIP payment:', vipBillingError);
					}
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
		setEditingDateTimeId(null);
		setDateTimeDraft({ date: '', time: '' });
	};

	const handleEditDateTime = (appointment: FrontdeskAppointment) => {
		setEditingDateTimeId(appointment.appointmentId);
		setDateTimeDraft({
			date: appointment.date || '',
			time: appointment.time || '',
		});
	};

	const handleSaveDateTime = async () => {
		if (!editingDateTimeId) return;

		const appointment = appointments.find(a => a.appointmentId === editingDateTimeId);
		if (!appointment) return;

		// Validate date and time
		if (!dateTimeDraft.date || !dateTimeDraft.date.trim()) {
			alert('Please select a date.');
			return;
		}
		if (!dateTimeDraft.time || !dateTimeDraft.time.trim()) {
			alert('Please enter a time.');
			return;
		}

		setUpdating(prev => ({ ...prev, [appointment.id]: true }));
		try {
			const appointmentRef = doc(db, 'appointments', appointment.id);
			await updateDoc(appointmentRef, {
				date: dateTimeDraft.date.trim(),
				time: dateTimeDraft.time.trim(),
				updatedAt: serverTimestamp(),
			});
			setEditingDateTimeId(null);
			setDateTimeDraft({ date: '', time: '' });
		} catch (error) {
			console.error('Failed to update appointment date/time', error);
			alert(`Failed to update date/time: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setUpdating(prev => ({ ...prev, [appointment.id]: false }));
		}
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
		setNewlyRegisteredPatientId(null); // Clear newly registered patient ID when closing modal
		setPatientSearchTerm(''); // Reset patient search term
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
		setEditingSlotTime(null);
		setEditedSlotTime('');
		setCustomTimeSlots(new Map());
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
		// Exception: Allow booking if the patient was registered by the current user
		const patientsWithoutAppointments = selectedPatients.filter(patient => {
			const hasAppointments = appointments.filter(a => a.patientId === patient.patientId).length > 0;
			if (hasAppointments) return false;
			
			// Allow if patient was registered by current user
			const isRegisteredByUser = patient.registeredBy === user?.uid;
			return !isRegisteredByUser;
		});

		if (patientsWithoutAppointments.length > 0) {
			const patientNames = patientsWithoutAppointments.map(p => p.name).join(', ');
			alert(`Consultations can only be created from the Front Desk or by the clinician who registered the patient. The following patient(s) need their first appointment assigned by the frontdesk: ${patientNames}`);
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
				
				// Check if this is the patient's first appointment
				const patientExistingAppointments = appointments.filter(a => a.patientId === selectedPatient.patientId);
				const isFirstAppointment = patientExistingAppointments.length === 0;
				
				for (const apt of allAppointments) {
					for (const time of apt.times) {
						// Use custom edited time if available, otherwise use original time
						const finalTime = customTimeSlots.get(time) || time;
						
						// Generate unique appointment ID for each
						const appointmentId = `APT${baseTimestamp}${appointmentIndex}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

						await addDoc(collection(db, 'appointments'), {
							appointmentId,
							patientId: selectedPatient.patientId,
							patient: selectedPatient.name,
							doctor: selectedStaff.userName,
							staffId: selectedStaff.id,
							date: apt.date,
							time: finalTime,
							status: 'pending' as AdminAppointmentStatus,
							notes: bookingForm.notes?.trim() || null,
							isConsultation: isFirstAppointment, // Mark as consultation if it's the patient's first appointment
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

		setRegisterFormErrors(errors);
		return Object.keys(errors).length === 0;
	};

	const handleRegisterPatient = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!validateRegisterForm() || registerSubmitting) return;

		setRegisterSubmitting(true);
		try {
			// Check if patient with this phone number already exists
			const trimmedPhone = registerForm.phone.trim();
			const phoneQuery = query(collection(db, 'patients'), where('phone', '==', trimmedPhone));
			const phoneSnapshot = await getDocs(phoneQuery);
			
			if (!phoneSnapshot.empty) {
				alert('Patient with this phone number is already registered.');
				setRegisterSubmitting(false);
				return;
			}

			const patientId = await generatePatientId();
			const trimmedEmail = registerForm.email.trim();
			
			// Get clinician info for registeredBy field
			const clinicianName = user?.displayName || user?.email?.split('@')[0] || 'Clinical Team';
			const clinicianId = user?.uid || '';
			const clinicianEmail = user?.email || '';

			const patientData = {
				patientId,
				name: registerForm.fullName.trim(),
				dob: registerForm.dob,
				gender: registerForm.gender,
				phone: trimmedPhone,
				email: trimmedEmail || null,
				address: registerForm.address.trim() || null,
				complaint: '',
				status: 'pending' as AdminPatientStatus,
				registeredAt: serverTimestamp(),
				patientType: registerForm.patientType as 'DYES' | 'VIP' | 'GETHNA' | 'PAID' | 'OTHERS' | 'STAFF',
				paymentType: 'without' as 'with' | 'without',
				paymentDescription: null,
				packageAmount: null,
				sessionAllowance: registerForm.patientType === 'DYES' ? createInitialSessionAllowance() : null,
				// Add registeredBy fields
				registeredBy: clinicianId,
				registeredByName: clinicianName,
				registeredByEmail: clinicianEmail,
			};

			await addDoc(collection(db, 'patients'), patientData);

			// Send registration email if email is provided
			let emailSent = false;
			if (trimmedEmail) {
				try {
					const emailResult = await sendEmailNotification({
						to: trimmedEmail,
						subject: `Welcome to Centre For Sports Science - Patient ID: ${patientId}`,
						template: 'patient-registered',
						data: {
							patientName: registerForm.fullName.trim(),
							patientEmail: trimmedEmail,
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
			if (trimmedPhone && isValidPhoneNumber(trimmedPhone)) {
				try {
					const smsResult = await sendSMSNotification({
						to: trimmedPhone,
						template: 'patient-registered',
						data: {
							patientName: registerForm.fullName.trim(),
							patientPhone: trimmedPhone,
							patientId,
						},
					});
					smsSent = smsResult.success;
				} catch (smsError) {
					console.error('Failed to send registration SMS:', smsError);
				}
			}

			const confirmations: string[] = [];
			if (emailSent) confirmations.push('email');
			if (smsSent) confirmations.push('SMS');
			const confirmationText = confirmations.length ? ` Confirmation sent via ${confirmations.join(' and ')}.` : '';

			setRegisterNotice({
				type: 'success',
				message: `${registerForm.fullName.trim()} registered with ID ${patientId}.${confirmationText}`,
			});
			setRegisterForm({
				fullName: '',
				dob: '',
				gender: '' as AdminGenderOption,
				phone: '',
				email: '',
				address: '',
				patientType: '' as 'DYES' | 'VIP' | 'GETHNA' | 'PAID' | 'OTHERS' | 'STAFF' | '',
			});
			setRegisterFormErrors({});
			setShowRegisterModal(false);

			// Set the newly registered patient ID to trigger automatic booking modal
			setNewlyRegisteredPatientId(patientId);
		} catch (error) {
			console.error('Failed to register patient', error);
			setRegisterNotice({
				type: 'error',
				message: 'Failed to register patient. Please try again.',
			});
		} finally {
			setRegisterSubmitting(false);
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
			// Find current user's staff record to get their userName and staffId
			const currentUserStaff = staff.find(s => s.userEmail?.toLowerCase() === user?.email?.toLowerCase());
			// Fallback: try to match by displayName if email doesn't match
			const currentUserStaffByName = !currentUserStaff && user?.displayName
				? staff.find(s => normalize(s.userName) === normalize(user.displayName))
				: null;
			const assignedStaff = currentUserStaff || currentUserStaffByName;
			
			// Determine doctor name: use staff userName if found, otherwise use patient's assignedDoctor, otherwise use current user's displayName
			const doctorName = assignedStaff?.userName 
				|| selectedPatient.assignedDoctor 
				|| user?.displayName 
				|| user?.email?.split('@')[0] 
				|| 'Clinical Team';
			const staffIdForAppointments = assignedStaff?.id || '';

			// Create billing entry
			const billingId = `PKG-${selectedPatient.patientId}-${Date.now()}`;
			await addDoc(collection(db, 'billing'), {
				billingId,
				patient: selectedPatient.name,
				patientId: selectedPatient.patientId,
				doctor: doctorName,
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
					doctor: doctorName, // Auto-assign to current user or patient's assigned doctor
					staffId: staffIdForAppointments, // Auto-assign staffId if found
					date: '', // Will be scheduled later via editable fields
					time: '', // Will be scheduled later via editable fields
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

	const handleRemovePackage = async (patientId: string) => {
		const confirmRemove = window.confirm(
			'Are you sure you want to remove this package? This will delete all package sessions, related billing entries, and clear package information from the patient record.'
		);
		if (!confirmRemove) return;

		const patient = patients.find(p => p.patientId === patientId);
		if (!patient) {
			alert('Patient not found.');
			return;
		}

		try {
			setRemovingPackageForPatientId(patientId);

			// Delete all package appointments for this patient
			const appointmentsQuery = query(
				collection(db, 'appointments'),
				where('patientId', '==', patientId)
			);
			const appointmentsSnapshot = await getDocs(appointmentsQuery);

			const deletePromises: Promise<void>[] = [];

			appointmentsSnapshot.forEach(docSnap => {
				const data = docSnap.data();
				const isPackageAppointment =
					!!data.packageBillingId ||
					data.sessionNumber != null ||
					data.totalSessions != null;

				if (isPackageAppointment) {
					deletePromises.push(deleteDoc(doc(db, 'appointments', docSnap.id)));
				}
			});

			// Delete all billing entries for this patient's packages
			const billingQuery = query(
				collection(db, 'billing'),
				where('patientId', '==', patientId),
				where('packageSessions', '>', 0)
			);
			const billingSnapshot = await getDocs(billingQuery);

			billingSnapshot.forEach(docSnap => {
				deletePromises.push(deleteDoc(doc(db, 'billing', docSnap.id)));
			});

			// Clear package-related fields from patient document
			const patientRef = doc(db, 'patients', patient.id);
			deletePromises.push(
				updateDoc(patientRef, {
					totalSessionsRequired: deleteField(),
					remainingSessions: deleteField(),
					packageAmount: deleteField(),
					concessionPercent: deleteField(),
					paymentType: deleteField(),
					packageName: deleteField(),
					packageDescription: deleteField(),
					updatedAt: serverTimestamp(),
				}) as Promise<void>
			);

			await Promise.all(deletePromises);

			// Update local patient state so UI reflects removal immediately
			setPatients(prev =>
				prev.map(p =>
					p.id === patient.id
						? {
								...p,
								totalSessionsRequired: undefined,
								remainingSessions: undefined,
								packageAmount: undefined,
								concessionPercent: undefined,
								paymentType: undefined,
								packageName: undefined,
								packageDescription: undefined,
						  }
						: p
				)
			);

			alert('Package removed successfully, including all package sessions and billing entries.');
		} catch (error) {
			console.error('Failed to remove package', error);
			alert(`Failed to remove package: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setRemovingPackageForPatientId(null);
		}
	};

	return (
		<div className="min-h-svh bg-slate-50 px-6 py-10">
			<div className="mx-auto max-w-6xl space-y-10">
			<PageHeader
				title="Patient Management"
				actions={
					<div className="flex gap-2">
						<button type="button" onClick={() => setShowRegisterModal(true)} className="btn-primary">
							<i className="fas fa-user-plus text-xs" aria-hidden="true" />
							Register Patient
						</button>
						<button type="button" onClick={handleOpenBookingModal} className="btn-primary">
							<i className="fas fa-plus text-xs" aria-hidden="true" />
							Book Appointment
						</button>
					</div>
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
															{patientDetails?.packageName && patientDetails?.totalSessionsRequired && (
																<button
																	type="button"
																	onClick={() => handleRemovePackage(group.patientId)}
																	disabled={removingPackageForPatientId === group.patientId}
																	className="mt-2 inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 shadow-sm hover:bg-rose-100 hover:border-rose-400 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
																>
																	<i className="fas fa-trash-alt text-xs" aria-hidden="true" />
																	{removingPackageForPatientId === group.patientId ? 'Removing package…' : 'Remove Package'}
																</button>
															)}
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
															<div className="flex flex-wrap gap-1 mt-1">
																{Array.from({ length: patientDetails.totalSessionsRequired }, (_, i) => {
																	const sessionNumber = i + 1;
																	// Find appointment for this session number
																	// Use loose comparison to handle type mismatches (number vs string)
																	const apt = packageAppointmentsByPatient[group.patientId]?.find(
																		a => a.sessionNumber != null && Number(a.sessionNumber) === sessionNumber
																	);
																	const isCompleted = apt?.status === 'completed';
																	const hasAppointment = !!apt;
																	
																	const handleSessionClick = async () => {
																		if (hasAppointment) {
																			setReportModalPatientId(group.patientId);
																			setShowReportModal(true);
																		} else {
																			// Create missing session appointment
																			try {
																				// Find an existing package appointment to get package details
																				const existingPackageApt = packageAppointmentsByPatient[group.patientId]?.find(a => a.packageBillingId);
																				if (!existingPackageApt && packageAppointmentsByPatient[group.patientId]?.length > 0) {
																					// Use first appointment if no packageBillingId found
																					const firstApt = packageAppointmentsByPatient[group.patientId][0];
																					if (firstApt) {
																						const appointmentId = `APT-${group.patientId}-${Date.now()}-${sessionNumber}`;
																						await addDoc(collection(db, 'appointments'), {
																							appointmentId,
																							patientId: group.patientId,
																							patient: group.patientName,
																							doctor: firstApt.doctor || '',
																							staffId: firstApt.staffId,
																							date: '',
																							time: '',
																							status: 'pending' as AdminAppointmentStatus,
																							notes: null,
																							isConsultation: false,
																							sessionNumber: sessionNumber,
																							totalSessions: patientDetails.totalSessionsRequired,
																							packageBillingId: firstApt.packageBillingId,
																							packageName: patientDetails.packageName,
																							createdAt: serverTimestamp(),
																						});
																						alert(`Session ${sessionNumber} appointment created successfully!`);
																					}
																				} else if (existingPackageApt) {
																					const appointmentId = `APT-${group.patientId}-${Date.now()}-${sessionNumber}`;
																					await addDoc(collection(db, 'appointments'), {
																						appointmentId,
																						patientId: group.patientId,
																						patient: group.patientName,
																						doctor: existingPackageApt.doctor || '',
																						staffId: existingPackageApt.staffId,
																						date: '',
																						time: '',
																						status: 'pending' as AdminAppointmentStatus,
																						notes: null,
																						isConsultation: false,
																						sessionNumber: sessionNumber,
																						totalSessions: patientDetails.totalSessionsRequired,
																						packageBillingId: existingPackageApt.packageBillingId,
																						packageName: patientDetails.packageName,
																						createdAt: serverTimestamp(),
																					});
																					alert(`Session ${sessionNumber} appointment created successfully!`);
																				} else {
																					alert(`Unable to create Session ${sessionNumber}. Please ensure the patient has package details.`);
																				}
																			} catch (error) {
																				console.error(`Failed to create Session ${sessionNumber} appointment:`, error);
																				alert(`Failed to create Session ${sessionNumber} appointment. Please try again.`);
																			}
																		}
																	};

																	return (
																		<button
																			key={apt?.id || `session-${sessionNumber}`}
																			type="button"
																			onClick={handleSessionClick}
																			className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-white shadow-sm transition-all ${
																				isCompleted
																					? 'bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700'
																					: 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700'
																			} ${!hasAppointment ? 'opacity-75 hover:opacity-100' : ''}`}
																			title={hasAppointment 
																				? `Session ${sessionNumber}${apt.date ? ` - ${formatDateLabel(apt.date)}` : ' - Not scheduled'}`
																				: `Session ${sessionNumber} - Click to create missing appointment`
																			}
																		>
																			<i className="fas fa-file-medical text-xs" aria-hidden="true" />
																			Session {sessionNumber}
																		</button>
																	);
																})}
															</div>
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
									{/* Patient Search Bar */}
									{availablePatients.length > 0 && (
										<div className="mt-2 mb-2 relative">
											<div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
												<i className="fas fa-search text-slate-400 text-sm" aria-hidden="true" />
											</div>
											<input
												type="text"
												placeholder="Search patients by name or ID..."
												value={patientSearchTerm}
												onChange={(e) => setPatientSearchTerm(e.target.value)}
												className="w-full rounded-lg border border-slate-300 pl-10 pr-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
											/>
										</div>
									)}
									{availablePatients.length === 0 ? (
										<div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
											<p>No patients available.</p>
										</div>
									) : filteredAvailablePatients.length === 0 ? (
										<div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
											<p>No patients found matching "{patientSearchTerm}".</p>
										</div>
									) : (
										<div className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3">
											<div className="space-y-2">
												{filteredAvailablePatients.map(patient => {
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
															<div className="flex-1 min-w-0">
																<p className="text-sm font-medium text-slate-900">{patient.name}</p>
																<div className="flex flex-col gap-1 mt-1">
																	<p className="text-xs text-slate-500">ID: {patient.patientId}</p>
																	{patient.registeredAt ? (
																		<p className="text-xs font-semibold text-indigo-600">
																			<i className="fas fa-calendar-check mr-1" aria-hidden="true" />
																			Registered: {formatDateLabel(patient.registeredAt)}
																		</p>
																	) : (
																		<p className="text-xs text-slate-400 italic">Registration date not available</p>
																	)}
																</div>
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
												<div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
													{availableTimeSlots.map(slotData => {
														const slot = typeof slotData === 'string' ? slotData : slotData.time;
														const patientCount = typeof slotData === 'object' ? slotData.patientCount : 0;
														const isSelected = bookingForm.selectedTimes.includes(slot);
														const isEmpty = patientCount === 0;
														const displaySlot = customTimeSlots.get(slot) || slot;
														const slotEnd = minutesToTimeString(timeStringToMinutes(displaySlot) + SLOT_INTERVAL_MINUTES);
														const isEditing = editingSlotTime === slot;
														
														return (
															<div key={slot} className="relative">
																{isEditing ? (
																	<div className="rounded-xl border border-sky-500 bg-sky-50 px-3 py-2 shadow-sm">
																		<div className="flex items-center gap-2">
																			<input
																				type="time"
																				value={editedSlotTime}
																				onChange={(e) => setEditedSlotTime(e.target.value)}
																				className="flex-1 rounded border border-sky-300 px-2 py-1 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
																				autoFocus
																			/>
																			<button
																				type="button"
																				onClick={() => {
																					if (editedSlotTime) {
																						const newTime = editedSlotTime.substring(0, 5); // Get HH:MM format
																						setCustomTimeSlots(prev => {
																							const newMap = new Map(prev);
																							newMap.set(slot, newTime);
																							return newMap;
																						});
																						// Update selected times if this slot was selected
																						if (isSelected) {
																							setBookingForm(prev => {
																								const newSelectedTimes = prev.selectedTimes.map(t => t === slot ? newTime : t).sort();
																								return {
																									...prev,
																									selectedTimes: newSelectedTimes,
																									time: newSelectedTimes.length === 1 ? newSelectedTimes[0] : prev.time,
																								};
																							});
																						}
																					}
																					setEditingSlotTime(null);
																					setEditedSlotTime('');
																				}}
																				className="rounded bg-sky-600 px-2 py-1 text-xs text-white hover:bg-sky-700"
																				title="Save"
																			>
																				<i className="fas fa-check" aria-hidden="true" />
																			</button>
																			<button
																				type="button"
																				onClick={() => {
																					setEditingSlotTime(null);
																					setEditedSlotTime('');
																				}}
																				className="rounded bg-slate-300 px-2 py-1 text-xs text-white hover:bg-slate-400"
																				title="Cancel"
																			>
																				<i className="fas fa-times" aria-hidden="true" />
																			</button>
																		</div>
																	</div>
																) : (
																	<div className="relative">
																		<button
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
																			className={`rounded-xl border px-3 py-2 text-sm font-medium shadow-sm transition w-full ${
																				isSelected
																					? 'border-sky-500 bg-sky-50 text-sky-800 ring-2 ring-sky-200'
																					: isEmpty
																					? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100'
																					: 'border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50'
																			}`}
																			title={isEmpty ? 'No patients booked at this slot' : `${patientCount} patient${patientCount === 1 ? '' : 's'} booked at this slot`}
																			aria-pressed={isSelected}
																		>
																			<div className="flex items-center justify-between pr-6">
																				<div>
																					<p className="font-semibold">{displaySlot} – {slotEnd}</p>
																					<p className="text-xs text-slate-500">30 minutes</p>
																					{!isEmpty && (
																						<p className="text-xs font-medium text-slate-600 mt-0.5">
																							<i className="fas fa-users mr-1" aria-hidden="true" />
																							{patientCount} {patientCount === 1 ? 'patient' : 'patients'}
																						</p>
																					)}
																					{isEmpty && (
																						<p className="text-xs font-normal text-emerald-600 mt-0.5">
																							<i className="fas fa-circle text-[6px] mr-1" aria-hidden="true" />
																							No patients
																						</p>
																					)}
																				</div>
																				<span className={`text-xs ${isSelected ? 'text-sky-600' : 'text-slate-400'}`}>
																					<i
																						className={`fas ${isSelected ? 'fa-check-circle' : 'fa-clock'}`}
																						aria-hidden="true"
																					/>
																				</span>
																			</div>
																		</button>
																		<button
																			type="button"
																			onClick={(e) => {
																				e.stopPropagation();
																				setEditingSlotTime(slot);
																				setEditedSlotTime(displaySlot + ':00'); // Convert to HH:MM:SS format for time input
																			}}
																			className="absolute top-1 right-1 rounded p-1 text-xs text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition z-10"
																			title="Edit time"
																		>
																			<i className="fas fa-edit" aria-hidden="true" />
																		</button>
																	</div>
																)}
															</div>
														);
													})}
												</div>
												{bookingForm.selectedTimes.length > 0 && (
													<>
														<p className="mt-2 text-xs font-medium text-slate-600">
															Selected duration:{' '}
															<span className="text-slate-900">{formatDurationLabel(bookingForm.selectedTimes.length * SLOT_INTERVAL_MINUTES)}</span>
														</p>
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
													</>
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
												<th className="px-4 py-3 font-semibold">Amount</th>
												<th className="px-4 py-3 font-semibold">Notes</th>
												<th className="px-4 py-3 font-semibold text-right">Actions</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-slate-100">
											{selectedPatientAppointments.map(appointment => {
												const patientDetails = patients.find(p => p.patientId === appointment.patientId);
												const isEditing = editingId === appointment.appointmentId;
												const isUpdating = updating[appointment.id] || false;
												
												// Resolve doctor name: use appointment.doctor if available, otherwise try to get from staffId
												let doctorName = appointment.doctor && appointment.doctor.trim() 
													? appointment.doctor 
													: null;
												if (!doctorName && appointment.staffId) {
													const staffMember = staff.find(s => s.id === appointment.staffId);
													if (staffMember) {
														doctorName = staffMember.userName;
													}
												}
												if (!doctorName && patientDetails?.assignedDoctor) {
													doctorName = patientDetails.assignedDoctor;
												}
												const displayDoctorName = doctorName || 'Not assigned';

												// Get billing status for this appointment
												const billingRecord = billingRecords.find(b => b.appointmentId === appointment.appointmentId);
												const paymentStatus = billingRecord?.status || null;
												
												// Check if patient's typeOfOrganization is VIP
												const typeOfOrganization = (patientDetails as any)?.typeOfOrganization || patientDetails?.patientType || '';
												const isVIP = typeOfOrganization?.toUpperCase() === 'VIP';

												return (
													<tr key={appointment.appointmentId}>
														<td className="px-4 py-4">
															<div className="flex items-center gap-2">
																{appointment.sessionNumber !== undefined && (
																	<span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-sky-100 text-sky-700 font-semibold text-xs flex-shrink-0">
																		{appointment.sessionNumber}
																	</span>
																)}
																<div>
																	<p className="font-semibold text-slate-900">{appointment.appointmentId}</p>
																	<p className="text-xs text-slate-500">
																		Booked {formatDateLabel(appointment.createdAt)}
																	</p>
																</div>
															</div>
														</td>
														<td className="px-4 py-4 text-sm text-slate-600">
															{displayDoctorName}
														</td>
														<td className="px-4 py-4 text-sm text-slate-600">
															{editingDateTimeId === appointment.appointmentId ? (
																<div className="space-y-2">
																	<div className="flex gap-2">
																		<input
																			type="date"
																			value={dateTimeDraft.date}
																			onChange={e => setDateTimeDraft(prev => ({ ...prev, date: e.target.value }))}
																			className="input-base text-xs"
																			required
																		/>
																		<input
																			type="time"
																			value={dateTimeDraft.time}
																			onChange={e => setDateTimeDraft(prev => ({ ...prev, time: e.target.value }))}
																			className="input-base text-xs"
																			required
																		/>
																	</div>
																	<div className="flex items-center gap-2">
																		<button
																			type="button"
																			onClick={handleSaveDateTime}
																			disabled={isUpdating}
																			className="btn-primary text-xs py-1 px-2"
																		>
																			{isUpdating ? 'Saving...' : 'Save'}
																		</button>
																		<button
																			type="button"
																			onClick={handleCancelEditing}
																			disabled={isUpdating}
																			className="btn-secondary text-xs py-1 px-2"
																		>
																			Cancel
																		</button>
																	</div>
																</div>
															) : (
																<div className="space-y-1">
																	{appointment.date && appointment.date.trim() 
																		? (appointment.time && appointment.time.trim() 
																			? `${formatDateLabel(appointment.date)} at ${appointment.time}`
																			: `${formatDateLabel(appointment.date)} at —`)
																		: '— at —'
																	}
																	{appointment.packageBillingId && (
																		<button
																			type="button"
																			onClick={() => handleEditDateTime(appointment)}
																			className="text-xs font-semibold text-sky-600 hover:text-sky-500"
																		>
																			Edit date/time
																		</button>
																	)}
																</div>
															)}
														</td>
														<td className="px-4 py-4">
															<div className="space-y-2">
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
																{patientDetails?.patientType?.toUpperCase() === 'DYES' && appointment.status !== 'completed' && (
																	<label className="flex items-center gap-2 cursor-pointer" title="Mark as extra treatment before completing appointment">
																		<input
																			type="checkbox"
																			checked={extraTreatmentFlags[appointment.appointmentId] || false}
																			onChange={e => {
																				setExtraTreatmentFlags(prev => ({
																					...prev,
																					[appointment.appointmentId]: e.target.checked,
																				}));
																			}}
																			className="h-3 w-3 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
																		/>
																		<span className="text-xs text-amber-700 font-medium">
																			Extra Treatment
																		</span>
																	</label>
																)}
															</div>
														</td>
														<td className="px-4 py-4">
															{paymentStatus ? (
																<div className="flex flex-col gap-1">
																	<span
																		className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
																			paymentStatus === 'Completed' || paymentStatus === 'Auto-Paid'
																				? 'bg-green-100 text-green-800'
																				: 'bg-amber-100 text-amber-800'
																		}`}
																	>
																		{paymentStatus === 'Completed' || paymentStatus === 'Auto-Paid'
																			? 'Completed'
																			: isVIP ? 'VIP' : 'Pending'}
																	</span>
																	{(paymentStatus === 'Completed' || paymentStatus === 'Auto-Paid') && billingRecord?.amount !== undefined && (
																		<span className="text-xs font-semibold text-slate-700">
																			₹{billingRecord.amount.toFixed(2)}
																		</span>
																	)}
																</div>
															) : (
																<span className="text-xs text-slate-400">—</span>
															)}
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
									setEditingId(null);
									setNotesDraft('');
									setEditingDateTimeId(null);
									setDateTimeDraft({ date: '', time: '' });
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

			{/* Register Patient Modal */}
			{showRegisterModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
					<div className="w-full max-w-4xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
						<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
							<div>
								<h2 className="text-lg font-semibold text-slate-900">Register New Patient</h2>
								<p className="text-xs text-slate-500">Capture details and generate an ID instantly</p>
							</div>
							<button
								type="button"
								onClick={() => {
									setShowRegisterModal(false);
									setRegisterForm({
										fullName: '',
										dob: '',
										gender: '' as AdminGenderOption,
										phone: '',
										email: '',
										address: '',
										patientType: '' as 'DYES' | 'VIP' | 'GETHNA' | 'PAID' | 'OTHERS' | 'STAFF' | '',
									});
									setRegisterFormErrors({});
									setRegisterNotice(null);
								}}
								className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:bg-slate-100 focus-visible:text-slate-600 focus-visible:outline-none"
								aria-label="Close dialog"
								disabled={registerSubmitting}
							>
								<i className="fas fa-times" aria-hidden="true" />
							</button>
						</header>
						{registerNotice && (
							<div
								className={`mx-6 mt-4 flex items-start justify-between gap-4 rounded-xl border px-4 py-3 text-sm ${
									registerNotice.type === 'success'
										? 'border-emerald-200 bg-emerald-50 text-emerald-700'
										: 'border-rose-200 bg-rose-50 text-rose-700'
								}`}
							>
								<p>{registerNotice.message}</p>
								<button
									type="button"
									onClick={() => setRegisterNotice(null)}
									className="rounded-full p-2 text-current transition hover:bg-white/40 focus-visible:outline-none"
									aria-label="Dismiss message"
								>
									<i className="fas fa-times" aria-hidden="true" />
								</button>
							</div>
						)}
						<form onSubmit={handleRegisterPatient} className="max-h-[70vh] overflow-y-auto px-6 py-4 space-y-4">
							<div className="grid gap-4 md:grid-cols-12">
								<div className="md:col-span-6">
									<label className="block text-sm font-medium text-slate-700">
										Full Name <span className="text-rose-600">*</span>
									</label>
									<input
										type="text"
										value={registerForm.fullName}
										onChange={(e) => {
											setRegisterForm(prev => ({ ...prev, fullName: e.target.value }));
											setRegisterFormErrors(prev => ({ ...prev, fullName: undefined }));
										}}
										className="input-base"
										placeholder="Patient name"
										autoComplete="name"
										required
									/>
									{registerFormErrors.fullName && (
										<p className="mt-1 text-xs text-rose-500">{registerFormErrors.fullName}</p>
									)}
								</div>
								<div className="md:col-span-3">
									<label className="block text-sm font-medium text-slate-700">
										Date of Birth <span className="text-rose-600">*</span>
									</label>
									<input
										type="date"
										value={registerForm.dob}
										onChange={(e) => {
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
										onChange={(e) => {
											setRegisterForm(prev => ({ ...prev, gender: e.target.value as AdminGenderOption }));
											setRegisterFormErrors(prev => ({ ...prev, gender: undefined }));
										}}
										className="select-base"
										required
									>
										{GENDER_OPTIONS.map(option => (
											<option key={option.value} value={option.value}>
												{option.label}
											</option>
										))}
									</select>
									{registerFormErrors.gender && (
										<p className="mt-1 text-xs text-rose-500">{registerFormErrors.gender}</p>
									)}
								</div>
							</div>

							<div className="grid gap-4 md:grid-cols-12">
								<div className="md:col-span-3">
									<label className="block text-sm font-medium text-slate-700">
										Phone Number <span className="text-rose-600">*</span>
									</label>
									<input
										type="tel"
										value={registerForm.phone}
										onChange={(e) => {
											setRegisterForm(prev => ({ ...prev, phone: e.target.value }));
											setRegisterFormErrors(prev => ({ ...prev, phone: undefined }));
										}}
										className="input-base"
										placeholder="10-15 digits"
										pattern="[0-9]{10,15}"
										required
									/>
									{registerFormErrors.phone && <p className="mt-1 text-xs text-rose-500">{registerFormErrors.phone}</p>}
								</div>
								<div className="md:col-span-6">
									<label className="block text-sm font-medium text-slate-700">Email</label>
									<input
										type="email"
										value={registerForm.email}
										onChange={(e) => {
											setRegisterForm(prev => ({ ...prev, email: e.target.value }));
											setRegisterFormErrors(prev => ({ ...prev, email: undefined }));
										}}
										className="input-base"
										placeholder="name@example.com"
										autoComplete="email"
									/>
									{registerFormErrors.email && <p className="mt-1 text-xs text-rose-500">{registerFormErrors.email}</p>}
								</div>
							</div>

							<div className="grid gap-4 md:grid-cols-12">
								<div className="md:col-span-12">
									<label className="block text-sm font-medium text-slate-700">Address</label>
									<textarea
										value={registerForm.address}
										onChange={(e) => setRegisterForm(prev => ({ ...prev, address: e.target.value }))}
										className="textarea-base"
										placeholder="Street, city, postal code"
										rows={2}
										autoComplete="street-address"
									/>
								</div>
							</div>

							<div className="grid gap-4 md:grid-cols-12">
								<div className="md:col-span-12">
									<label className="block text-sm font-medium text-slate-700">
										Type of Organization <span className="text-rose-600">*</span>
									</label>
									<div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
										{PATIENT_TYPE_OPTIONS.map(type => (
											<label
												key={type.value}
												className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 transition hover:border-sky-300 hover:bg-sky-50 cursor-pointer"
											>
												<input
													type="radio"
													name="registerPatientType"
													value={type.value}
													checked={registerForm.patientType === type.value}
													onChange={() => {
														setRegisterForm(prev => ({
															...prev,
															patientType: type.value,
														}));
														setRegisterFormErrors(prev => ({
															...prev,
															patientType: undefined,
														}));
													}}
													className="h-4 w-4 border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												<span className="text-sm font-medium text-slate-700">{type.label}</span>
											</label>
										))}
									</div>
									{registerFormErrors.patientType && (
										<p className="mt-1 text-xs text-rose-500">{registerFormErrors.patientType}</p>
									)}
								</div>
							</div>

							<footer className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
								<button
									type="button"
									onClick={() => {
										setShowRegisterModal(false);
										setRegisterForm({
											fullName: '',
											dob: '',
											gender: '' as AdminGenderOption,
											phone: '',
											email: '',
											address: '',
											patientType: '' as 'DYES' | 'VIP' | 'GETHNA' | 'PAID' | 'OTHERS' | 'STAFF' | '',
										});
										setRegisterFormErrors({});
										setRegisterNotice(null);
									}}
									className="btn-secondary"
									disabled={registerSubmitting}
								>
									Cancel
								</button>
								<button type="submit" className="btn-primary" disabled={registerSubmitting}>
									{registerSubmitting ? (
										<>
											<div className="mr-2 inline-flex h-4 w-4 items-center justify-center rounded-full border-2 border-white border-t-transparent animate-spin" />
											Registering...
										</>
									) : (
										<>
											<i className="fas fa-user-plus text-xs" aria-hidden="true" />
											Register Patient
										</>
									)}
								</button>
							</footer>
						</form>
					</div>
				</div>
			)}

		</div>
	);
}

