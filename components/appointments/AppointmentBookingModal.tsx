'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, addDoc, updateDoc, doc, getDocs, query, where, serverTimestamp, onSnapshot, type QuerySnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { AdminAppointmentStatus } from '@/lib/adminMockData';
import { sendEmailNotification } from '@/lib/email';
import { sendSMSNotification, isValidPhoneNumber } from '@/lib/sms';
import { sendWhatsAppNotification } from '@/lib/whatsapp';

interface Patient {
	id?: string;
	patientId: string;
	name: string;
	email?: string;
	phone?: string;
}

interface DayAvailability {
	enabled: boolean;
	slots: Array<{ start: string; end: string }>;
	unavailableSlots?: Array<{ start: string; end: string }>;
}

interface DateSpecificAvailability {
	[date: string]: DayAvailability; // date in YYYY-MM-DD format
}

interface StaffMember {
	id: string;
	name: string;
	role: string;
	availability?: {
		[day: string]: DayAvailability;
	};
	dateSpecificAvailability?: DateSpecificAvailability;
}

interface Appointment {
	id?: string;
	patientId?: string;
	doctor?: string;
	date?: string;
	time?: string;
	status?: string;
	duration?: number;
	isConsultation?: boolean;
	packageBillingId?: string;
	sessionNumber?: number;
	totalSessions?: number;
	packageCategory?: 'strength' | 'physio' | 'individual';
}

interface AppointmentBookingModalProps {
	isOpen: boolean;
	onClose: () => void;
	patient: Patient | null;
	staff: StaffMember[];
	onSuccess?: () => void;
	allowConsultation?: boolean; // If false, prevents consultation booking
	defaultClinician?: string; // Pre-fill clinician (e.g., logged-in user)
	hideClinicianSelection?: boolean; // Hide clinician selection (use defaultClinician)
	appointments?: Array<{ patientId?: string; doctor: string; date: string; time: string; status: string; duration?: number; isConsultation?: boolean }>; // Existing appointments for conflict checking
	initialAppointment?: Appointment | null; // If provided, update this appointment instead of creating a new one
}

async function generateAppointmentId(): Promise<string> {
	const today = new Date();
	const year = today.getFullYear();
	const month = String(today.getMonth() + 1).padStart(2, '0');
	const day = String(today.getDate()).padStart(2, '0');
	const datePrefix = `${year}${month}${day}`;

	// Get all appointments for today
	const appointmentsQuery = query(
		collection(db, 'appointments'),
		where('appointmentId', '>=', `APT-${datePrefix}-000`),
		where('appointmentId', '<=', `APT-${datePrefix}-999`)
	);
	const snapshot = await getDocs(appointmentsQuery);

	// Find the highest sequence number
	let maxSeq = 0;
	snapshot.docs.forEach(doc => {
		const aptId = doc.data().appointmentId as string;
		const match = aptId.match(/APT-\d{8}-(\d{3})/);
		if (match) {
			const seq = parseInt(match[1], 10);
			if (seq > maxSeq) maxSeq = seq;
		}
	});

	const nextSeq = String(maxSeq + 1).padStart(3, '0');
	return `APT-${datePrefix}-${nextSeq}`;
}

const SLOT_INTERVAL_MINUTES = 30;
const MAX_BLOCK_DURATION_MINUTES = 120;

function formatDurationLabel(minutes: number) {
	if (minutes % 60 === 0) {
		const hours = minutes / 60;
		return hours === 1 ? '1 hr' : `${hours} hrs`;
	}
	if (minutes > 60) {
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		return `${hours} hr ${mins} min`;
	}
	return `${minutes} min`;
}

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

function formatDateKey(dateString: string): string {
	if (!dateString) return '';
	const date = new Date(dateString + 'T00:00:00');
	if (Number.isNaN(date.getTime())) return dateString;
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function getDayOfWeek(dateString: string): string {
	if (!dateString) return '';
	const date = new Date(dateString + 'T00:00:00');
	if (Number.isNaN(date.getTime())) return '';
	const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
	return days[date.getDay()];
}

export default function AppointmentBookingModal({
	isOpen,
	onClose,
	patient,
	staff,
	onSuccess,
	allowConsultation = true,
	defaultClinician,
	hideClinicianSelection = false,
	appointments = [],
	initialAppointment = null,
}: AppointmentBookingModalProps) {
	const [form, setForm] = useState({
		doctor: defaultClinician || '',
		date: '',
		time: '',
		notes: '',
	});
	const [errors, setErrors] = useState<Partial<Record<'doctor' | 'date' | 'time', string>>>({});
	const [submitting, setSubmitting] = useState(false);
	const [clinicianTypeFilter, setClinicianTypeFilter] = useState<'all' | 'Physiotherapist' | 'StrengthAndConditioning'>('all');
	const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
	const [allClinicianAppointments, setAllClinicianAppointments] = useState<Array<{ id?: string; doctor: string; date: string; time: string; status: string; duration?: number }>>([]);

	const filteredClinicians = useMemo(() => {
		if (clinicianTypeFilter === 'all') {
			return staff;
		}
		return staff.filter(clinician => clinician.role === clinicianTypeFilter);
	}, [staff, clinicianTypeFilter]);

	// Initialize form from initialAppointment if provided
	useEffect(() => {
		if (isOpen && initialAppointment) {
			setForm({
				doctor: initialAppointment.doctor || defaultClinician || '',
				date: initialAppointment.date || '',
				time: initialAppointment.time || '',
				notes: '', // Don't pre-fill notes
			});
			// Pre-select time slot if time exists
			if (initialAppointment.time) {
				setSelectedSlots([initialAppointment.time]);
			} else {
				setSelectedSlots([]);
			}
		} else if (isOpen && !initialAppointment) {
			// Reset form when opening for new appointment
			setForm({
				doctor: defaultClinician || '',
				date: '',
				time: '',
				notes: '',
			});
			setSelectedSlots([]);
		}
	}, [isOpen, initialAppointment, defaultClinician]);

	// Fetch all appointments for the selected clinician (across all dates to find latest appointment)
	useEffect(() => {
		if (!isOpen) {
			setAllClinicianAppointments([]);
			return;
		}

		// Use defaultClinician if hideClinicianSelection is true, otherwise use form.doctor
		const doctorName = hideClinicianSelection && defaultClinician ? defaultClinician : form.doctor;
		
		if (!doctorName) {
			setAllClinicianAppointments([]);
			return;
		}

		// Fetch all appointments for this clinician (not just the selected date)
		// This allows us to find the latest appointment across all dates
		const appointmentsQuery = query(
			collection(db, 'appointments'),
			where('doctor', '==', doctorName)
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
				if (process.env.NODE_ENV === 'development') {
					console.log('📅 Loaded appointments for slot filtering:', {
						doctorName,
						formDate: form.date,
						count: mapped.length,
						appointments: mapped.map(apt => ({ 
							id: apt.id, 
							time: apt.time, 
							status: apt.status, 
							date: apt.date,
							duration: apt.duration,
							timeMinutes: apt.time ? timeStringToMinutes(apt.time) : null,
						})),
					});
				}
				setAllClinicianAppointments(mapped);
			},
			error => {
				console.error('Failed to load appointments for slot filtering', error);
				setAllClinicianAppointments([]);
			}
		);

		return () => unsubscribe();
	}, [isOpen, form.doctor, hideClinicianSelection, defaultClinician]);

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
		
		// First, check for date-specific availability
		if (staffMember.dateSpecificAvailability?.[dateKey]) {
			const dateSpecific = staffMember.dateSpecificAvailability[dateKey];
			// If marked as unavailable (enabled: false), return it
			if (!dateSpecific.enabled) {
				return dateSpecific;
			}
			// If enabled but has no slots or empty slots, fall back to default availability
			if (!dateSpecific.slots || dateSpecific.slots.length === 0) {
				return DEFAULT_DAY_AVAILABILITY;
			}
			// If enabled and has slots, use the date-specific schedule
			return dateSpecific;
		}
		
		// No date-specific schedule exists - use default availability (9 AM - 6 PM)
		return DEFAULT_DAY_AVAILABILITY;
	};

	// Generate available time slots based on staff availability and existing appointments
	const availableTimeSlots = useMemo(() => {
		// Use defaultClinician if hideClinicianSelection is true, otherwise use form.doctor
		const doctorName = hideClinicianSelection && defaultClinician ? defaultClinician : form.doctor;
		
		if (!doctorName || !form.date) {
			return [];
		}

		const selectedStaff = staff.find(s => s.name === doctorName);
		if (!selectedStaff) {
			if (process.env.NODE_ENV === 'development') {
				console.log('🔍 Staff lookup failed:', {
					doctorName,
					staffNames: staff.map(s => s.name),
					hideClinicianSelection,
					defaultClinician,
					formDoctor: form.doctor,
				});
			}
			return [];
		}

		if (process.env.NODE_ENV === 'development') {
			console.log('🔍 Finding slots for:', {
				doctorName,
				date: form.date,
				hasAvailability: !!selectedStaff.availability,
				hasDateSpecific: !!selectedStaff.dateSpecificAvailability,
				availabilityKeys: selectedStaff.availability ? Object.keys(selectedStaff.availability) : [],
				dateSpecificKeys: selectedStaff.dateSpecificAvailability ? Object.keys(selectedStaff.dateSpecificAvailability) : [],
			});
		}

		const dayAvailability = getDateAvailability(selectedStaff, form.date);
		if (process.env.NODE_ENV === 'development') {
			console.log('📅 Day availability result:', {
				date: form.date,
				dayAvailability,
				enabled: dayAvailability?.enabled,
				slotsCount: dayAvailability?.slots?.length || 0,
				unavailableSlotsCount: dayAvailability?.unavailableSlots?.length || 0,
			});
		}
		if (!dayAvailability || !dayAvailability.enabled || !dayAvailability.slots || dayAvailability.slots.length === 0) {
			return [];
		}

		// Get unavailable slots for this date
		const unavailableSlots = dayAvailability.unavailableSlots || [];

		// Get all booked appointments for this staff and date
		// Use allClinicianAppointments (fetched from Firestore) instead of just the appointments prop
		// This ensures we filter out ALL appointments for this clinician, not just the current patient's
		const bookedSlotSet = new Set<string>();
		const normalizedFormDate = formatDateKey(form.date);
		allClinicianAppointments
			.filter(apt => {
				// Filter by status (exclude cancelled)
				if (apt.status === 'cancelled') {
					return false;
				}
				// Only consider appointments on the selected date for booked slots
				// Normalize dates for comparison
				if (!apt.date || formatDateKey(apt.date) !== normalizedFormDate) {
					return false;
				}
				// Exclude the appointment we're currently updating (if initialAppointment exists)
				if (initialAppointment?.id && apt.id === initialAppointment.id) {
					return false;
				}
				return true;
			})
			.forEach(apt => {
				if (!apt.time) return;
				const durationMinutes = Math.max(SLOT_INTERVAL_MINUTES, apt.duration ?? SLOT_INTERVAL_MINUTES);
				const blocks = Math.ceil(durationMinutes / SLOT_INTERVAL_MINUTES);
				const startMinutes = timeStringToMinutes(apt.time);
				for (let block = 0; block < blocks; block += 1) {
					const blockStartMinutes = startMinutes + block * SLOT_INTERVAL_MINUTES;
					bookedSlotSet.add(minutesToTimeString(blockStartMinutes));
				}
			});
		const bookedSlots = [...bookedSlotSet];
		
		// Find the latest (last) appointment across ALL dates
		// If there's an appointment on or before the selected date, filter out slots at or before its end time on the selected date
		const appointmentsWithDates = allClinicianAppointments
			.filter(apt => {
				if (apt.status === 'cancelled') return false;
				if (initialAppointment?.id && apt.id === initialAppointment.id) return false;
				return apt.time && apt.date;
			})
			.map(apt => {
				const durationMinutes = Math.max(SLOT_INTERVAL_MINUTES, apt.duration ?? SLOT_INTERVAL_MINUTES);
				const startMinutes = timeStringToMinutes(apt.time!);
				const endMinutes = startMinutes + durationMinutes;
				return {
					date: apt.date!,
					time: apt.time!,
					duration: durationMinutes,
					endTime: minutesToTimeString(endMinutes),
				};
			})
			.sort((a, b) => {
				// Sort by date first, then by end time (to find the chronologically latest appointment)
				const dateCompare = a.date.localeCompare(b.date);
				if (dateCompare !== 0) return dateCompare;
				return a.endTime.localeCompare(b.endTime);
			});
		
		// Find the latest appointment that is on or before the selected date
		// Normalize dates for comparison (ensure YYYY-MM-DD format)
		// normalizedFormDate is already defined above for booked slots filtering
		const latestAppointment = appointmentsWithDates
			.filter(apt => {
				const normalizedAptDate = formatDateKey(apt.date);
				return normalizedAptDate <= normalizedFormDate;
			})
			.pop() || null;
		
		// Only filter by latest appointment end time if the latest appointment is on the same date
		// We use end time to ensure slots after the appointment ends are available
		const latestAppointmentEndTime = latestAppointment && formatDateKey(latestAppointment.date) === normalizedFormDate ? latestAppointment.endTime : null;
		
		if (process.env.NODE_ENV === 'development') {
			const sortedBookedSlots = [...bookedSlots].sort();
			console.log('🔍 Slot filtering:', {
				doctorName: selectedStaff.name,
				date: form.date,
				totalAppointments: allClinicianAppointments.length,
				bookedSlotsCount: bookedSlots.length,
				bookedSlotsArray: sortedBookedSlots,
				bookedSlotsString: sortedBookedSlots.join(', '),
				latestAppointmentEndTime: latestAppointmentEndTime,
				latestAppointment: latestAppointment ? { date: latestAppointment.date, time: latestAppointment.time, endTime: latestAppointment.endTime, duration: latestAppointment.duration } : null,
				appointmentTimes: appointmentsWithDates,
				appointments: allClinicianAppointments.map(apt => ({ 
					id: apt.id, 
					time: apt.time, 
					status: apt.status, 
					duration: apt.duration,
					excluded: initialAppointment?.id === apt.id,
					blocks: apt.time ? Math.ceil((Math.max(SLOT_INTERVAL_MINUTES, apt.duration ?? SLOT_INTERVAL_MINUTES)) / SLOT_INTERVAL_MINUTES) : 0,
				})),
			});
		}

		// Get current date and time for filtering past slots
		const now = new Date();
		const selectedDate = new Date(form.date + 'T00:00:00');
		const isToday = selectedDate.toDateString() === now.toDateString();
		const currentTimeString = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

		// Removed consultation filtering - all booked slots (including consultations) are filtered out

		// Generate 30-minute slots from availability ranges
		const slots: string[] = [];
		
		dayAvailability.slots.forEach((slot) => {
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
				
				// Filter out booked slots
				const isBooked = bookedSlots.includes(timeString);
				if (isBooked) {
					if (process.env.NODE_ENV === 'development') {
						console.log(`⛔ Filtering out booked slot: ${timeString}`);
					}
					currentTime.setMinutes(currentTime.getMinutes() + SLOT_INTERVAL_MINUTES);
					continue;
				}

				// Filter out slots that overlap with unavailable time ranges
				const slotStartMinutes = timeStringToMinutes(timeString);
				const slotEndMinutes = slotStartMinutes + SLOT_INTERVAL_MINUTES;
				const isUnavailable = unavailableSlots.some(unavailSlot => {
					const unavailStart = timeStringToMinutes(unavailSlot.start);
					const unavailEnd = timeStringToMinutes(unavailSlot.end);
					// Check if slot overlaps with unavailable range (overlap: slotStart < unavailEnd && unavailStart < slotEnd)
					return slotStartMinutes < unavailEnd && unavailStart < slotEndMinutes;
				});
				if (isUnavailable) {
					if (process.env.NODE_ENV === 'development') {
						console.log(`⛔ Filtering out unavailable slot: ${timeString}`);
					}
					currentTime.setMinutes(currentTime.getMinutes() + SLOT_INTERVAL_MINUTES);
					continue;
				}

				// Filter out slots at or before the latest (last) appointment's end time
				// This ensures the next appointment is booked after the last existing appointment ends
				if (latestAppointmentEndTime && timeString <= latestAppointmentEndTime) {
					if (process.env.NODE_ENV === 'development') {
						console.log(`⛔ Filtering out slot at or before latest appointment end time: ${timeString} (latest end: ${latestAppointmentEndTime})`);
					}
					currentTime.setMinutes(currentTime.getMinutes() + SLOT_INTERVAL_MINUTES);
					continue;
				}

				// Filter out past slots for today
				if (isToday && timeString < currentTimeString) {
					currentTime.setMinutes(currentTime.getMinutes() + SLOT_INTERVAL_MINUTES);
					continue;
				}
				
				slots.push(timeString);
				currentTime.setMinutes(currentTime.getMinutes() + SLOT_INTERVAL_MINUTES);
			}
		});

		const finalSlots = [...new Set(slots)].sort();
		
		if (process.env.NODE_ENV === 'development') {
			console.log('✅ Final available slots:', {
				date: form.date,
				totalSlots: finalSlots.length,
				slots: finalSlots,
				bookedSlotsWere: bookedSlots.length > 0 ? [...bookedSlots].sort() : [],
			});
		}
		
		return finalSlots;
	}, [form.doctor, form.date, staff, allClinicianAppointments, hideClinicianSelection, defaultClinician, initialAppointment]);

	// Removed consultation blocker - slots are filtered instead

	function formatDateLabel(value: string) {
		if (!value) return '—';
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) return value;
		return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
	}

	function formatTimeLabel(time: string) {
		if (!time) return '—';
		// If time is in HH:MM format, format it nicely
		if (time.match(/^\d{1,2}:\d{2}$/)) {
			const [hours, minutes] = time.split(':');
			const hour = parseInt(hours, 10);
			const ampm = hour >= 12 ? 'PM' : 'AM';
			const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
			return `${displayHour}:${minutes} ${ampm}`;
		}
		return time;
	}

	// Reset form when modal opens/closes or patient changes
	useEffect(() => {
		if (isOpen && patient) {
			const firstClinician = filteredClinicians[0]?.name ?? '';
			setForm({
				doctor: defaultClinician || firstClinician,
				date: '',
				time: '',
				notes: '',
			});
			setSelectedSlots([]);
			setErrors({});
		}
	}, [isOpen, patient, defaultClinician, staff, clinicianTypeFilter]);

	// Update form when selectedSlots change
	useEffect(() => {
		if (selectedSlots.length > 0) {
			setForm(prev => ({
				...prev,
				time: selectedSlots[0], // Use first slot as the appointment time
			}));
		} else {
			setForm(prev => ({
				...prev,
				time: '',
			}));
		}
	}, [selectedSlots]);

	// Handle slot toggle with consecutive validation
	const handleSlotToggle = (slot: string) => {
		setSelectedSlots(prevSelected => {
			let nextSelection: string[];
			if (prevSelected.includes(slot)) {
				nextSelection = prevSelected.filter(item => item !== slot);
			} else {
				nextSelection = [...prevSelected, slot];
			}

			nextSelection = [...nextSelection].sort((a, b) => a.localeCompare(b));

			// Validate that selected slots are consecutive
			if (nextSelection.length > 1) {
				const isContiguous = nextSelection.every((time, index) => {
					if (index === 0) return true;
					const previousTime = nextSelection[index - 1];
					return (
						timeStringToMinutes(time) - timeStringToMinutes(previousTime) === SLOT_INTERVAL_MINUTES
					);
				});

				if (!isContiguous) {
					nextSelection = [slot];
				}
			}

			// Limit to max duration
			const maxSlots = Math.max(1, Math.floor(MAX_BLOCK_DURATION_MINUTES / SLOT_INTERVAL_MINUTES));
			if (nextSelection.length > maxSlots) {
				nextSelection = nextSelection.slice(-maxSlots);
			}

			return nextSelection;
		});
	};

	const handleSubmit = async () => {
		if (!patient || submitting) return;

		const newErrors: Partial<Record<'doctor' | 'date' | 'time', string>> = {};
		if (!hideClinicianSelection && !form.doctor) {
			newErrors.doctor = 'Select a clinician.';
		}
		if (!form.date) {
			newErrors.date = 'Choose a date.';
		}
		if (selectedSlots.length === 0 && !form.time) {
			newErrors.time = 'Choose a time slot.';
		}

		// Removed consultation blocker - slots are filtered instead

		if (Object.keys(newErrors).length > 0) {
			setErrors(newErrors);
			return;
		}

		// Use defaultClinician if hideClinicianSelection is true, and use selectedSlots if available
		const selectedDoctor = hideClinicianSelection && defaultClinician ? defaultClinician : form.doctor;
		const selectedTime = selectedSlots.length > 0 ? selectedSlots[0] : form.time;
		const duration = selectedSlots.length > 0 ? selectedSlots.length * SLOT_INTERVAL_MINUTES : 30;

		// Check if patient has any appointments to determine if this would be a consultation
		// On clinical side (allowConsultation=false), only block if patient has NO appointments at all (would be consultation)
		if (!allowConsultation) {
			try {
				const allAppointmentsQuery = query(
					collection(db, 'appointments'),
					where('patientId', '==', patient.patientId)
				);
				const allAppointmentsSnapshot = await getDocs(allAppointmentsQuery);
				
				// If patient has no appointments at all, this would be a consultation - block it
				if (allAppointmentsSnapshot.empty) {
					alert('This patient has no appointments. Consultation appointments can only be created from the Front Desk.');
					return;
				}
			} catch (checkError) {
				console.error('Failed to check patient appointments', checkError);
				// Allow booking if check fails (fail open)
			}
		}

		setSubmitting(true);
		try {
			let appointmentId: string | undefined;
			
			// If initialAppointment has an id, update the existing appointment
			if (initialAppointment?.id) {
				// Update existing appointment, preserving package-related fields
				await updateDoc(doc(db, 'appointments', initialAppointment.id), {
					doctor: selectedDoctor,
					date: form.date,
					time: selectedTime,
					duration: duration,
					status: 'pending' as AdminAppointmentStatus,
					notes: form.notes?.trim() || null,
					updatedAt: serverTimestamp(),
					// Preserve package-related fields
					packageBillingId: initialAppointment.packageBillingId || null,
					sessionNumber: initialAppointment.sessionNumber || null,
					totalSessions: initialAppointment.totalSessions || null,
					packageCategory: initialAppointment.packageCategory || null,
					isConsultation: initialAppointment.isConsultation || false,
				});
			} else {
				// Check if this is the patient's first appointment (consultation)
				let isConsultation = false;
				if (allowConsultation) {
					try {
						const allAppointmentsQuery = query(
							collection(db, 'appointments'),
							where('patientId', '==', patient.patientId)
						);
						const allAppointmentsSnapshot = await getDocs(allAppointmentsQuery);
						isConsultation = allAppointmentsSnapshot.empty; // First appointment if no appointments exist
					} catch (checkError) {
						console.error('Failed to check for existing appointments', checkError);
						isConsultation = true; // Default to consultation if check fails (fail open)
					}
				}

				// Generate appointment ID
				appointmentId = await generateAppointmentId();

				// Create appointment in Firestore
				await addDoc(collection(db, 'appointments'), {
					appointmentId,
					patientId: patient.patientId,
					patient: patient.name,
					doctor: selectedDoctor,
					date: form.date,
					time: selectedTime,
					duration: duration,
					status: (allowConsultation ? 'ongoing' : 'pending') as AdminAppointmentStatus,
					notes: form.notes?.trim() || null,
					isConsultation: isConsultation,
					createdAt: serverTimestamp(),
				});
			}

			// Send appointment confirmation notifications (only for new appointments, not updates)
			if (!initialAppointment?.id && appointmentId) {
				// Send appointment confirmation email if patient email is available
				if (patient.email) {
					try {
						await sendEmailNotification({
							to: patient.email,
							subject: `Appointment Confirmed - ${form.date} at ${form.time}`,
							template: 'appointment-created',
							data: {
								patientName: patient.name,
								patientEmail: patient.email,
								patientId: patient.patientId,
								doctor: selectedDoctor,
								date: form.date,
								time: selectedTime,
								appointmentId: appointmentId,
							},
						});
					} catch (emailError) {
						console.error('Failed to send appointment email:', emailError);
					}
				}

				// Send appointment confirmation SMS if patient phone is available
				if (patient.phone && isValidPhoneNumber(patient.phone)) {
					try {
						await sendSMSNotification({
							to: patient.phone,
							template: 'appointment-created',
							data: {
								patientName: patient.name,
								patientPhone: patient.phone,
								patientId: patient.patientId,
								doctor: selectedDoctor,
								date: form.date,
								time: selectedTime,
								appointmentId: appointmentId,
							},
						});
					} catch (smsError) {
						console.error('Failed to send appointment SMS:', smsError);
					}
				}

				// Send WhatsApp notification if phone is available
				if (patient.phone && isValidPhoneNumber(patient.phone)) {
					try {
						await sendWhatsAppNotification({
							to: patient.phone,
							template: 'appointment-created',
							data: {
								patientName: patient.name,
								patientPhone: patient.phone,
								patientId: patient.patientId,
								doctor: selectedDoctor,
								date: form.date,
								time: selectedTime,
								appointmentId: appointmentId,
							},
						});
					} catch (whatsappError) {
						console.error('Failed to send WhatsApp notification:', whatsappError);
					}
				}
			}

			// Reset form and close modal
			setForm({ doctor: '', date: '', time: '', notes: '' });
			setSelectedSlots([]);
			setErrors({});
			onSuccess?.();
			onClose();
		} catch (error) {
			console.error('Failed to create appointment', error);
			alert('Failed to create appointment. Please try again.');
		} finally {
			setSubmitting(false);
		}
	};

	if (!isOpen || !patient) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
			<div className="absolute inset-0 bg-slate-900/60" onClick={onClose} />
			<div className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl">
				<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
					<div>
						<h2 className="text-lg font-semibold text-slate-900">{allowConsultation ? 'Assign appointment' : 'Book Appointment'}</h2>
						<p className="text-xs text-slate-500">{patient.name}</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none"
						aria-label="Close dialog"
						disabled={submitting}
					>
						<i className="fas fa-times" aria-hidden="true" />
					</button>
				</header>
				<div className="space-y-4 px-6 py-6">
					{!hideClinicianSelection && (
						<>
							<div>
								<label className="block text-sm font-medium text-slate-700">Clinician Type</label>
								<select
									value={clinicianTypeFilter}
									onChange={event =>
										setClinicianTypeFilter(event.target.value as 'all' | 'Physiotherapist' | 'StrengthAndConditioning')
									}
									className="select-base"
								>
									<option value="all">All Types</option>
									<option value="Physiotherapist">Physiotherapist</option>
									<option value="StrengthAndConditioning">Strength & Conditioning</option>
								</select>
							</div>
							<div>
								<label className="block text-sm font-medium text-slate-700">Clinician</label>
								<select
									value={form.doctor}
									onChange={event =>
										setForm(prev => ({
											...prev,
											doctor: event.target.value,
										}))
									}
									className="select-base"
								>
									<option value="">Select a clinician</option>
									{filteredClinicians.map(clinician => (
										<option key={clinician.id} value={clinician.name}>
											{clinician.name} ({clinician.role === 'ClinicalTeam' ? 'Clinical Team' : clinician.role})
										</option>
									))}
								</select>
								{errors.doctor && (
									<p className="mt-1 text-xs text-rose-500">{errors.doctor}</p>
								)}
								{filteredClinicians.length === 0 && (
									<p className="mt-1 text-xs text-amber-600">
										No {clinicianTypeFilter === 'all' ? 'clinicians' : clinicianTypeFilter.toLowerCase()} available. Please check staff management.
									</p>
								)}
							</div>
						</>
					)}
					<div>
						<label className="block text-sm font-medium text-slate-700">Date</label>
						<input
							type="date"
							value={form.date}
							onChange={event => {
								setForm(prev => ({
									...prev,
									date: event.target.value,
								}));
								setSelectedSlots([]);
							}}
							min={new Date().toISOString().split('T')[0]}
							className="input-base"
						/>
						{errors.date && (
							<p className="mt-1 text-xs text-rose-500">{errors.date}</p>
						)}
					</div>
					{form.date && (form.doctor || (hideClinicianSelection && defaultClinician)) && (
						<div>
							<label className="block text-sm font-medium text-slate-700">
								Available Time Slots <span className="text-rose-500">*</span>
							</label>
							{availableTimeSlots.length > 0 ? (
								<div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
									{availableTimeSlots.map(slot => {
										const slotEnd = minutesToTimeString(timeStringToMinutes(slot) + SLOT_INTERVAL_MINUTES);
										const isSelected = selectedSlots.includes(slot);
										return (
											<button
												key={slot}
												type="button"
												onClick={() => handleSlotToggle(slot)}
												className={`rounded-xl border px-3 py-2 text-sm font-medium shadow-sm transition ${
													isSelected
														? 'border-sky-500 bg-sky-50 text-sky-800 ring-2 ring-sky-200'
														: 'border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50'
												}`}
												aria-pressed={isSelected}
											>
												<div className="flex items-center justify-between">
													<div>
														<p className="font-semibold">{slot} – {slotEnd}</p>
														<p className="text-xs text-slate-500">30 minutes</p>
													</div>
													<span className={`text-xs ${isSelected ? 'text-sky-600' : 'text-slate-400'}`}>
														<i
															className={`fas ${isSelected ? 'fa-check-circle' : 'fa-clock'}`}
															aria-hidden="true"
														/>
													</span>
												</div>
											</button>
										);
									})}
								</div>
							) : (
								<div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
									<i className="fas fa-calendar-times mr-2" aria-hidden="true" />
									No slots available. The clinician has not set a schedule for this date. Please select another date or ask the clinician to set their availability.
								</div>
							)}
							{selectedSlots.length > 0 && (
								<p className="mt-2 text-xs font-medium text-slate-600">
									Selected duration:{' '}
									<span className="text-slate-900">{formatDurationLabel(selectedSlots.length * SLOT_INTERVAL_MINUTES)}</span>
								</p>
							)}
							{selectedSlots.length <= 1 && availableTimeSlots.length > 0 && (
								<p className="mt-1 text-xs text-slate-500">
									Select consecutive slots to automatically combine them into longer appointments.
								</p>
							)}
							{errors.time && (
								<p className="mt-1 text-xs text-rose-500">{errors.time}</p>
							)}
						</div>
					)}
					{form.notes !== undefined && (
						<div>
							<label className="block text-sm font-medium text-slate-700">Notes (optional)</label>
							<textarea
								value={form.notes}
								onChange={event =>
									setForm(prev => ({
										...prev,
										notes: event.target.value,
									}))
								}
								rows={3}
								className="input-base"
								placeholder="Add any additional notes..."
							/>
						</div>
					)}
				</div>
				<footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
					<button type="button" onClick={onClose} className="btn-secondary" disabled={submitting}>
						Cancel
					</button>
					<button type="button" onClick={handleSubmit} className="btn-primary" disabled={submitting}>
						<i className="fas fa-check text-xs" aria-hidden="true" />
						{submitting ? 'Scheduling...' : allowConsultation ? 'Start appointment' : 'Book appointment'}
					</button>
				</footer>
			</div>
		</div>
	);
}

