'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { collection, doc, onSnapshot, updateDoc, addDoc, deleteDoc, query, where, orderBy, getDocs, getDoc, serverTimestamp, limit, type QuerySnapshot, type Timestamp, type QueryConstraint } from 'firebase/firestore';
import { useRouter } from 'next/navigation';

import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import type { AdminGenderOption, AdminPatientStatus } from '@/lib/adminMockData';
import { generatePhysiotherapyReportPDF, type PatientReportData, type ReportSection } from '@/lib/pdfGenerator';
import type { PatientRecordFull, Appointment } from '@/lib/types';
import { recordSessionUsageForAppointment } from '@/lib/sessionAllowanceClient';
import { getHeaderConfig, getDefaultHeaderConfig } from '@/lib/headerConfig';
import type { HeaderConfig } from '@/components/admin/HeaderManagement';
import EditReportModal from '@/components/clinical-team/EditReportModal';
import AppointmentBookingModal from '@/components/appointments/AppointmentBookingModal';
import RescheduleDialog from '@/components/appointments/RescheduleDialog';
import TransferSessionDialog from '@/components/appointments/TransferSessionDialog';
import TransferConfirmationDialog from '@/components/transfers/TransferConfirmationDialog';
import PatientProgressAnalytics from '@/components/patient/PatientProgressAnalytics';

type PaymentTypeOption = 'with' | 'without';

interface PackageOption {
	id: string;
	label: string;
	sessions: number;
	amount: number;
	category: 'strength' | 'physio' | 'individual';
}

interface PackageSetupFormState {
	clientType: 'professional' | 'student' | '';
	category: 'strength' | 'physio' | 'individual' | '';
	selectedPackage: string;
	totalNoOfSessions: string;
	paymentType: PaymentTypeOption | '';
	paymentDescription: string;
	packageAmount: string;
	concessionPercent: string;
}

const PACKAGE_FORM_INITIAL_STATE: PackageSetupFormState = {
	clientType: '',
	category: '',
	selectedPackage: '',
	totalNoOfSessions: '',
	paymentType: '',
	paymentDescription: '',
	packageAmount: '',
	concessionPercent: '',
};

const PAYMENT_OPTIONS: Array<{ value: PaymentTypeOption; label: string }> = [
	{ value: 'with', label: 'With Concession' },
	{ value: 'without', label: 'Without Concession' },
];

// Pricing Menu Structure
const PROFESSIONAL_PACKAGES: PackageOption[] = [
	// Strength & Conditioning
	{ id: 'sc-1m-12', label: 'Strength & Conditioning - 1 Month (12 Sessions)', sessions: 12, amount: 11000, category: 'strength' },
	{ id: 'sc-1m-16', label: 'Strength & Conditioning - 1 Month (16 Sessions + 4 Rehab)', sessions: 20, amount: 14600, category: 'strength' },
	{ id: 'sc-3m-36', label: 'Strength & Conditioning - 3 Month (36 Sessions)', sessions: 36, amount: 30500, category: 'strength' },
	{ id: 'sc-3m-48', label: 'Strength & Conditioning - 3 Month (48 Sessions + Rehab)', sessions: 52, amount: 40700, category: 'strength' },
	// Physiotherapy Packages
	{ id: 'phy-1m-12', label: 'Physiotherapy - 1 Month (12 Sessions)', sessions: 12, amount: 9000, category: 'physio' },
	{ id: 'phy-3m-36', label: 'Physiotherapy - 3 Month (36 Sessions)', sessions: 36, amount: 27000, category: 'physio' },
	{ id: 'phy-acute', label: 'Physiotherapy - Acute (24 Sessions/Month)', sessions: 24, amount: 18000, category: 'physio' },
	// Individual Treatments
	{ id: 'ind-consultation', label: 'Consultation', sessions: 1, amount: 1000, category: 'individual' },
	{ id: 'ind-session', label: 'Per Session', sessions: 1, amount: 800, category: 'individual' },
	{ id: 'ind-ice-bath', label: 'Ice Bath', sessions: 1, amount: 1000, category: 'individual' },
	{ id: 'ind-cold-compression', label: 'Cold Compression', sessions: 1, amount: 700, category: 'individual' },
	{ id: 'ind-em-stimulation', label: 'EM Stimulation', sessions: 1, amount: 400, category: 'individual' },
	{ id: 'ind-shockwave', label: 'Shockwave', sessions: 1, amount: 350, category: 'individual' },
	{ id: 'ind-kinesio-taping', label: 'Kinesio Taping', sessions: 1, amount: 500, category: 'individual' },
	{ id: 'ind-dry-needling', label: 'Dry Needling', sessions: 1, amount: 500, category: 'individual' },
	{ id: 'ind-myo-fascial', label: 'Myo Fascial Release', sessions: 1, amount: 500, category: 'individual' },
	{ id: 'ind-ultrasound', label: 'Ultrasound', sessions: 1, amount: 250, category: 'individual' },
	{ id: 'ind-tens', label: 'TENS', sessions: 1, amount: 250, category: 'individual' },
	{ id: 'ind-interferential', label: 'Interferential Current', sessions: 1, amount: 250, category: 'individual' },
	{ id: 'ind-electrical-stim', label: 'Electrical Stimulation', sessions: 1, amount: 250, category: 'individual' },
];

const STUDENT_PACKAGES: PackageOption[] = [
	// Strength & Conditioning
	{ id: 'sc-1m-12-student', label: 'Strength & Conditioning - 1 Month (12 Sessions)', sessions: 12, amount: 8000, category: 'strength' },
	{ id: 'sc-1m-16-student', label: 'Strength & Conditioning - 1 Month (16 Sessions + 4 Rehab)', sessions: 20, amount: 10600, category: 'strength' },
	{ id: 'sc-3m-36-student', label: 'Strength & Conditioning - 3 Month (36 Sessions)', sessions: 36, amount: 21000, category: 'strength' },
	{ id: 'sc-3m-48-student', label: 'Strength & Conditioning - 3 Month (48 Sessions + Rehab)', sessions: 52, amount: 28000, category: 'strength' },
	// Physiotherapy Packages
	{ id: 'phy-1m-12-student', label: 'Physiotherapy - 1 Month (12 Sessions)', sessions: 12, amount: 6000, category: 'physio' },
	{ id: 'phy-3m-36-student', label: 'Physiotherapy - 3 Month (36 Sessions)', sessions: 36, amount: 18000, category: 'physio' },
	{ id: 'phy-acute-student', label: 'Physiotherapy - Acute (24 Sessions/Month)', sessions: 24, amount: 12000, category: 'physio' },
	// Individual Treatments
	{ id: 'ind-consultation-student', label: 'Consultation', sessions: 1, amount: 1500, category: 'individual' },
	{ id: 'ind-session-student', label: 'Per Session', sessions: 1, amount: 950, category: 'individual' },
	{ id: 'ind-ice-bath-student', label: 'Ice Bath', sessions: 1, amount: 800, category: 'individual' },
	{ id: 'ind-cold-compression-student', label: 'Cold Compression', sessions: 1, amount: 500, category: 'individual' },
	{ id: 'ind-em-stimulation-student', label: 'EM Stimulation', sessions: 1, amount: 350, category: 'individual' },
	{ id: 'ind-shockwave-student', label: 'Shockwave', sessions: 1, amount: 300, category: 'individual' },
	{ id: 'ind-kinesio-taping-student', label: 'Kinesio Taping', sessions: 1, amount: 500, category: 'individual' },
	{ id: 'ind-dry-needling-student', label: 'Dry Needling', sessions: 1, amount: 500, category: 'individual' },
	{ id: 'ind-myo-fascial-student', label: 'Myo Fascial Release', sessions: 1, amount: 500, category: 'individual' },
	{ id: 'ind-ultrasound-student', label: 'Ultrasound', sessions: 1, amount: 200, category: 'individual' },
	{ id: 'ind-tens-student', label: 'TENS', sessions: 1, amount: 200, category: 'individual' },
	{ id: 'ind-interferential-student', label: 'Interferential Current', sessions: 1, amount: 200, category: 'individual' },
	{ id: 'ind-electrical-stim-student', label: 'Electrical Stimulation', sessions: 1, amount: 200, category: 'individual' },
];

const VAS_EMOJIS = ['😀','😁','🙂','😊','😌','😟','😣','😢','😭','😱'];
const HYDRATION_EMOJIS = ['😄','😃','🙂','😐','😕','😟','😢','😭'];

const ROM_MOTIONS: Record<string, Array<{ motion: string }>> = {
	Neck: [
		{ motion: 'Flexion' }, 
		{ motion: 'Extension' }, 
		{ motion: 'Lateral Flexion Left' }, 
		{ motion: 'Lateral Flexion Right' }
	],
	Hip: [
		{ motion: 'Flexion' },
		{ motion: 'Extension' },
		{ motion: 'Abduction' },
		{ motion: 'Adduction' },
		{ motion: 'Internal Rotation' },
		{ motion: 'External Rotation' },
	],
	Shoulder: [
		{ motion: 'Flexion' },
		{ motion: 'Extension' },
		{ motion: 'Abduction' },
		{ motion: 'Adduction' },
		{ motion: 'Internal Rotation' },
		{ motion: 'External Rotation' },
	],
	Elbow: [{ motion: 'Flexion' }, { motion: 'Extension' }],
	Forearm: [{ motion: 'Supination' }, { motion: 'Pronation' }],
	Wrist: [
		{ motion: 'Flexion' },
		{ motion: 'Extension' },
		{ motion: 'Radial Deviation' },
		{ motion: 'Ulnar Deviation' },
	],
	Knee: [{ motion: 'Flexion' }, { motion: 'Extension' }],
	Ankle: [
		{ motion: 'Dorsiflexion' },
		{ motion: 'Plantarflexion' },
		{ motion: 'Inversion' },
		{ motion: 'Eversion' },
	],
	'Tarsal Joint': [{ motion: 'Flexion' }, { motion: 'Extension' }],
	Finger: [{ motion: 'Flexion' }, { motion: 'Extension' }],
};

const ROM_HAS_SIDE: Record<string, boolean> = {
	Hip: true,
	Shoulder: true,
	Elbow: true,
	Forearm: true,
	Wrist: true,
	Knee: true,
	Ankle: true,
	'Tarsal Joint': true,
	Finger: true,
};

const ROM_JOINTS = Object.keys(ROM_MOTIONS);

const STATUS_OPTIONS: Array<{ value: AdminPatientStatus; label: string }> = [
	{ value: 'pending', label: 'Pending' },
	{ value: 'ongoing', label: 'Ongoing' },
	{ value: 'completed', label: 'Completed' },
	{ value: 'cancelled', label: 'Cancelled' },
];

const MOTION_TO_MMT: Record<string, string> = {
	Flexion: 'Flexors',
	Extension: 'Extensors',
	Abduction: 'Abductors',
	Adduction: 'Adductors',
	'Dorsiflexion': 'Dorsiflexors',
	'Plantarflexion': 'Plantarflexors',
	'Radial Deviation': 'Radial Deviators',
	'Ulnar Deviation': 'Ulnar Deviators',
	Inversion: 'Invertors',
	Eversion: 'Evertors',
	'Supination': 'Supinators',
	'Pronation': 'Pronators',
	'Internal Rotation': 'Internal Rotators',
	'External Rotation': 'External Rotators',
	'Lateral Flexion Left': 'Left Lateral Flexors',
	'Lateral Flexion Right': 'Right Lateral Flexors',
	'Flexion Left': 'Left Flexors',
	'Flexion Right': 'Right Flexors',
	'Extension Left': 'Left Extensors',
	'Extension Right': 'Right Extensors',
	FlexionLeft: 'Left Flexors',
	FlexionRight: 'Right Flexors',
	FlexionLeftRight: 'Lateral Flexors',
	FingerFlexion: 'Finger Flexors',
	FingerExtension: 'Finger Extensors',
};


function getMedicalHistoryText(p: PatientRecordFull): string {
	const items: string[] = [];
	if (p.med_xray) items.push('X RAYS');
	if (p.med_mri) items.push('MRI');
	if (p.med_report) items.push('Reports');
	if (p.med_ct) items.push('CT Scans');
	return items.join(', ') || 'N/A';
}

function getPersonalHistoryText(p: PatientRecordFull): string {
	const items: string[] = [];
	if (p.per_smoking) items.push('Smoking');
	if (p.per_drinking) items.push('Drinking');
	if (p.per_alcohol) items.push('Alcohol');
	if (p.per_drugs) {
		items.push('Drugs: ' + (p.drugsText || ''));
	}
	return items.join(', ') || 'N/A';
}

function normalize(value?: string | null) {
	return value?.trim().toLowerCase() ?? '';
}

// Calculate appointment status based on date and time
function calculateAppointmentStatus(
	appointment: {
		status?: string;
		date?: string;
		time?: string;
		duration?: number;
	}
): 'pending' | 'ongoing' | 'completed' | 'cancelled' {
	// If manually set to cancelled, keep it cancelled
	if (appointment.status === 'cancelled') {
		return 'cancelled';
	}

	// If no date or time, it's pending
	if (!appointment.date || !appointment.time || appointment.date.trim() === '' || appointment.time.trim() === '') {
		return 'pending';
	}

	const now = new Date();
	const appointmentDate = new Date(appointment.date + 'T00:00:00');
	
	// Parse time (HH:MM format)
	const [hours, minutes] = appointment.time.split(':').map(Number);
	if (isNaN(hours) || isNaN(minutes)) {
		return 'pending';
	}

	// Set appointment start time
	const appointmentStart = new Date(appointmentDate);
	appointmentStart.setHours(hours, minutes, 0, 0);

	// Calculate appointment end time (default 30 minutes if duration not provided)
	const durationMinutes = appointment.duration || 30;
	const appointmentEnd = new Date(appointmentStart.getTime() + durationMinutes * 60000);

	// If appointment has ended (current time is after end time), it's completed
	if (now > appointmentEnd) {
		return 'completed';
	}

	// If appointment is currently happening (now is between start and end), it's ongoing
	if (now >= appointmentStart && now <= appointmentEnd) {
		return 'ongoing';
	}

	// Otherwise, it's in the future, so it's pending
	return 'pending';
}

// Remove undefined values from an object (Firestore doesn't allow undefined)
function removeUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
	const cleaned: Partial<T> = {};
	for (const key in obj) {
		const value = obj[key];
		if (value !== undefined) {
			// Handle nested objects
			if (value !== null && typeof value === 'object' && !Array.isArray(value) && !((value as any) instanceof Date)) {
				const cleanedNested = removeUndefined(value);
				// Only include if nested object has at least one property
				if (Object.keys(cleanedNested).length > 0) {
					cleaned[key] = cleanedNested as any;
				}
			} else {
				cleaned[key] = value;
			}
		}
	}
	return cleaned;
}

function deriveCurrentSessionRemaining(
	totalSessionsRequired?: number,
	storedRemaining?: number
) {
	const hasValidTotal =
		typeof totalSessionsRequired === 'number' && !Number.isNaN(totalSessionsRequired);
	if (!hasValidTotal) return storedRemaining;
	// If remainingSessions is not set, set it equal to totalSessionsRequired
	if (typeof storedRemaining !== 'number' || Number.isNaN(storedRemaining)) {
		return totalSessionsRequired;
	}
	return storedRemaining;
}

function applyCurrentSessionAdjustments(patient: PatientRecordFull) {
	const adjustedRemaining = deriveCurrentSessionRemaining(
		patient.totalSessionsRequired,
		patient.remainingSessions
	);
	if (adjustedRemaining === undefined) {
		return patient;
	}
	return { ...patient, remainingSessions: adjustedRemaining };
}

async function markAppointmentCompletedForReport(
	patient: PatientRecordFull,
	reportDate?: string
) {
	if (!patient?.patientId) return;

	try {
		let appointmentDoc;
		
		if (reportDate) {
			// If we have a specific date, query with date filter (no index needed)
			const appointmentQuery = query(
				collection(db, 'appointments'),
				where('patientId', '==', patient.patientId),
				where('status', 'in', ['pending', 'ongoing']),
				where('date', '==', reportDate),
				limit(1)
			);
			const snapshot = await getDocs(appointmentQuery);
			if (!snapshot.empty) {
				appointmentDoc = snapshot.docs[0];
			}
		} else {
			// If no date specified, get all matching appointments and sort in memory
			// This avoids needing a composite index
			const appointmentQuery = query(
				collection(db, 'appointments'),
				where('patientId', '==', patient.patientId),
				where('status', 'in', ['pending', 'ongoing'])
			);
			const snapshot = await getDocs(appointmentQuery);
			if (!snapshot.empty) {
				// Sort by date and time in memory (descending)
				const sorted = snapshot.docs.sort((a, b) => {
					const aData = a.data();
					const bData = b.data();
					const aDate = aData.date || '';
					const bDate = bData.date || '';
					const aTime = aData.time || '';
					const bTime = bData.time || '';
					
					// Compare dates first
					const dateCompare = bDate.localeCompare(aDate);
					if (dateCompare !== 0) return dateCompare;
					
					// If dates are equal, compare times
					return bTime.localeCompare(aTime);
				});
				appointmentDoc = sorted[0];
			}
		}

		if (!appointmentDoc) {
			return;
		}

		await updateDoc(appointmentDoc.ref, { status: 'completed' });

		if (patient.id) {
			try {
				await recordSessionUsageForAppointment({
					patientDocId: patient.id,
					patientType: patient.patientType,
					appointmentId: appointmentDoc.id,
				});
			} catch (sessionError) {
				console.error('Failed to record session usage after report save', sessionError);
			}
		}

		// Check if all appointments for this patient are completed and update patient status
		const allAppointmentsQuery = query(
			collection(db, 'appointments'),
			where('patientId', '==', patient.patientId)
		);
		const allAppointmentsSnapshot = await getDocs(allAppointmentsQuery);
		
		if (!allAppointmentsSnapshot.empty) {
			const allAppointments = allAppointmentsSnapshot.docs.map(doc => ({
				id: doc.id,
				...doc.data()
			}));
			
			// Check if all appointments are completed or cancelled
			const allCompleted = allAppointments.every((apt: any) => 
				apt.status === 'completed' || apt.status === 'cancelled'
			);
			
			if (allCompleted && patient.status !== 'completed' && patient.id) {
				const patientRef = doc(db, 'patients', patient.id);
				await updateDoc(patientRef, {
					status: 'completed',
				});
			}
		}
	} catch (error) {
		console.error('Failed to auto-complete appointment after report save', error);
	}
}

async function refreshPatientSessionProgress(
	patient: PatientRecordFull,
	totalOverride?: number | null
) {
	if (!patient?.id || !patient.patientId) return null;

	const totalRequired =
		typeof totalOverride === 'number'
			? totalOverride
			: typeof patient.totalSessionsRequired === 'number'
				? patient.totalSessionsRequired
				: null;

	if (totalRequired === null) return null;

	try {
		const completedQuery = query(
			collection(db, 'appointments'),
			where('patientId', '==', patient.patientId),
			where('status', '==', 'completed')
		);
		const completedSnapshot = await getDocs(completedQuery);
		const completedCount = completedSnapshot.size;
		// remainingSessions starts at totalSessionsRequired - 1 and decreases with each completed appointment
		const remainingSessions = Math.max(0, totalRequired - 1 - completedCount);

		const updates: Partial<PatientRecordFull> = {
			remainingSessions,
			updatedAt: serverTimestamp(),
		};

		if (remainingSessions === 0) {
			updates.status = 'completed';
		}

		const patientRef = doc(db, 'patients', patient.id);
		await updateDoc(patientRef, updates);

		return updates;
	} catch (error) {
		console.error('Failed to refresh patient session progress', error);
		return null;
	}
}

export default function EditReport() {
	const router = useRouter();
	const { user } = useAuth();
	const [patientIdParam, setPatientIdParam] = useState<string | null>(null);
	const [currentDate, setCurrentDate] = useState<string>('');

	// Set current date only on client to avoid hydration mismatch
	useEffect(() => {
		setCurrentDate(new Date().toLocaleDateString());
	}, []);

	const [patients, setPatients] = useState<PatientRecordFull[]>([]);
	const [selectedPatient, setSelectedPatient] = useState<PatientRecordFull | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [savedMessage, setSavedMessage] = useState(false);
	const [updatingStatus, setUpdatingStatus] = useState<Record<string, boolean>>({});
	const [searchTerm, setSearchTerm] = useState('');
	const [selectedRomJoint, setSelectedRomJoint] = useState('');
	const [selectedMmtJoint, setSelectedMmtJoint] = useState('');
	const [formData, setFormData] = useState<Partial<PatientRecordFull>>({});
	const romFileInputRef = useRef<HTMLInputElement>(null);
	const mmtFileInputRef = useRef<HTMLInputElement>(null);
	const [romImages, setRomImages] = useState<Record<string, { data: string; fileName: string }>>({});
	const [mmtImages, setMmtImages] = useState<Record<string, { data: string; fileName: string }>>({});
	const [showVersionHistory, setShowVersionHistory] = useState(false);
	const [versionHistory, setVersionHistory] = useState<Array<{
		id: string;
		version: number;
		createdAt: string;
		createdBy: string;
		data: Partial<PatientRecordFull>;
	}>>([]);
	const [loadingVersions, setLoadingVersions] = useState(false);
	const [viewingVersion, setViewingVersion] = useState<typeof versionHistory[0] | null>(null);
	const [showCrispReportModal, setShowCrispReportModal] = useState(false);
	const [showAllPatients, setShowAllPatients] = useState(false);
	const [selectedSections, setSelectedSections] = useState<ReportSection[]>([
		'patientInformation',
		'assessmentOverview',
		'painAssessment',
		'onObservation',
		'onPalpation',
		'rom',
		'mmt',
		'advancedAssessment',
		'physiotherapyManagement',
		'followUpVisits',
		'currentStatus',
		'nextFollowUp',
		'signature',
	]);
	const [headerConfig, setHeaderConfig] = useState<HeaderConfig | null>(null);
	const [showReportModal, setShowReportModal] = useState(false);
	const [reportModalPatientId, setReportModalPatientId] = useState<string | null>(null);
	const [showAnalyticsModal, setShowAnalyticsModal] = useState(false);
	const [analyticsModalPatientId, setAnalyticsModalPatientId] = useState<string | null>(null);
	const [analyticsModalPatientName, setAnalyticsModalPatientName] = useState<string | null>(null);
	const [sessionCompleted, setSessionCompleted] = useState(false);
	const [expandedPatients, setExpandedPatients] = useState<Set<string>>(new Set());
	const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
	const [showPackageModal, setShowPackageModal] = useState(false);
	const [packageModalPatient, setPackageModalPatient] = useState<PatientRecordFull | null>(null);
	const [packageForm, setPackageForm] = useState<PackageSetupFormState>(PACKAGE_FORM_INITIAL_STATE);
	const [packageFormErrors, setPackageFormErrors] = useState<Partial<Record<keyof PackageSetupFormState, string>>>({});
	const [packageSubmitting, setPackageSubmitting] = useState(false);
	
	// Booking modal state
	const [showBookingModal, setShowBookingModal] = useState(false);
	const [bookingModalPatient, setBookingModalPatient] = useState<PatientRecordFull | null>(null);
	const [showRescheduleDialog, setShowRescheduleDialog] = useState(false);
	const [rescheduleAppointment, setRescheduleAppointment] = useState<{
		id: string;
		appointmentId?: string;
		patient: string;
		doctor: string;
		date: string;
		time: string;
	} | null>(null);
	const [allAppointmentsForReschedule, setAllAppointmentsForReschedule] = useState<Array<{
		id: string;
		appointmentId?: string;
		patient: string;
		doctor: string;
		date: string;
		time: string;
		status?: string;
	}>>([]);
	const [showTransferDialog, setShowTransferDialog] = useState(false);
	const [transferAppointment, setTransferAppointment] = useState<{
		id: string;
		appointmentId?: string;
		patient: string;
		patientId?: string;
		doctor: string;
		date: string;
		time: string;
	} | null>(null);
	const [showPatientTransferDialog, setShowPatientTransferDialog] = useState(false);
	const [patientTransferPatient, setPatientTransferPatient] = useState<PatientRecordFull | null>(null);
	const [selectedTherapistForTransfer, setSelectedTherapistForTransfer] = useState<string>('');
	const [checkingPatientTransferAvailability, setCheckingPatientTransferAvailability] = useState(false);
	const [patientTransferAvailabilityCheck, setPatientTransferAvailabilityCheck] = useState<{
		appointments: Array<{ id: string; date: string; time: string; status: string; duration?: number }>;
		conflicts: Array<{ appointmentId: string; date: string; time: string; conflictReason: 'no_availability' | 'slot_unavailable' | 'already_booked' }>;
		hasConflicts: boolean;
	} | null>(null);
	const [transferringPatient, setTransferringPatient] = useState(false);
	const [allAppointmentsForTransfer, setAllAppointmentsForTransfer] = useState<Array<{
		id: string;
		appointmentId?: string;
		patient: string;
		doctor: string;
		date: string;
		time: string;
		status?: string;
		duration?: number;
	}>>([]);
	const [staff, setStaff] = useState<Array<{
		id: string;
		name: string;
		userName?: string;
		role: string;
		availability?: Record<string, { enabled: boolean; slots: Array<{ start: string; end: string }> }>;
		dateSpecificAvailability?: Record<string, { enabled: boolean; slots: Array<{ start: string; end: string }> }>;
	}>>([]);

	// Handle click outside to close dropdown
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			const target = event.target as Node;
			// Check if the click is outside any dropdown
			const dropdownElements = document.querySelectorAll('[data-dropdown-id]');
			let clickedInsideAnyDropdown = false;
			dropdownElements.forEach(element => {
				if (element.contains(target)) {
					clickedInsideAnyDropdown = true;
				}
			});
			if (!clickedInsideAnyDropdown) {
				setOpenDropdownId(null);
			}
		};

		if (openDropdownId) {
			document.addEventListener('mousedown', handleClickOutside);
		}

		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
		};
	}, [openDropdownId]);

	// Debug: Log when analytics modal state changes
	useEffect(() => {
		if (showAnalyticsModal) {
			console.log('Analytics modal should be visible. showAnalyticsModal:', showAnalyticsModal, 'patientId:', analyticsModalPatientId);
		}
	}, [showAnalyticsModal, analyticsModalPatientId]);

	const [patientAppointments, setPatientAppointments] = useState<Record<string, Array<{
		id: string;
		appointmentId?: string;
		patientId?: string;
		date: string;
		time: string;
		doctor: string;
		status: string;
		notes?: string;
		packageBillingId?: string;
		sessionNumber?: number;
		totalSessions?: number;
		isConsultation?: boolean;
		packageCategory?: string;
		duration?: number;
		transferredFrom?: string;
	}>>>({});
	const appointmentSubscriptionsRef = useRef<Record<string, () => void>>({});
	
	// Compute displayed remaining sessions based on checkbox state
	// Use the ORIGINAL value (not formData which may already be adjusted) and apply checkbox adjustment
	const displayedRemainingSessions = useMemo(() => {
		// Get the original base value from selectedPatient (before any checkbox adjustments)
		const baseRemaining = 
			typeof selectedPatient?.remainingSessions === 'number'
				? selectedPatient.remainingSessions
				: typeof selectedPatient?.totalSessionsRequired === 'number'
					? selectedPatient.totalSessionsRequired
					: undefined;
		
		if (baseRemaining === undefined) return undefined;
		
		// If checkbox is checked, decrease by 1 (only once)
		return sessionCompleted ? Math.max(0, baseRemaining - 1) : baseRemaining;
	}, [selectedPatient?.remainingSessions, selectedPatient?.totalSessionsRequired, sessionCompleted]);
	
	const vasValue = Number(formData.vasScale || '5');
	const vasEmoji = VAS_EMOJIS[Math.min(VAS_EMOJIS.length - 1, Math.max(1, vasValue) - 1)];
	const hydrationValue = Number(formData.hydration || '4');
	const hydrationEmoji =
		HYDRATION_EMOJIS[Math.min(HYDRATION_EMOJIS.length - 1, Math.max(1, hydrationValue) - 1)];

	const clinicianName = useMemo(() => normalize(user?.displayName ?? ''), [user?.displayName]);

	// Get patientId from URL on client side
	useEffect(() => {
		if (typeof window !== 'undefined') {
			const params = new URLSearchParams(window.location.search);
			setPatientIdParam(params.get('patientId'));
		}
	}, []);

	// Load patients from Firestore
	useEffect(() => {
		const unsubscribe = onSnapshot(
			collection(db, 'patients'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data() as Record<string, unknown>;
					const created = (data.registeredAt as Timestamp | undefined)?.toDate?.();
					return {
						id: docSnap.id,
						patientId: data.patientId ? String(data.patientId) : '',
						name: data.name ? String(data.name) : '',
						dob: data.dob ? String(data.dob) : '',
						gender: (data.gender as AdminGenderOption) || '',
						phone: data.phone ? String(data.phone) : undefined,
						email: data.email ? String(data.email) : undefined,
						address: data.address ? String(data.address) : undefined,
						complaint: data.complaint ? String(data.complaint) : undefined,
						status: (data.status as AdminPatientStatus) ?? 'pending',
						registeredAt: created ? created.toISOString() : (data.registeredAt as string | undefined) || new Date().toISOString(),
						// Session tracking
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
						assignedDoctor: data.assignedDoctor ? String(data.assignedDoctor) : undefined,
						reportAccessDoctors: data.reportAccessDoctors ? (data.reportAccessDoctors as string[]) : undefined,
						packageAmount: typeof data.packageAmount === 'number' ? data.packageAmount : undefined,
						concessionPercent: typeof data.concessionPercent === 'number' ? data.concessionPercent : undefined,
						paymentType: data.paymentType ? String(data.paymentType) : undefined,
						packageName: data.packageName ? String(data.packageName) : undefined,
						packageDescription: data.packageDescription ? String(data.packageDescription) : undefined,
						complaints: data.complaints ? String(data.complaints) : undefined,
						presentHistory: data.presentHistory ? String(data.presentHistory) : undefined,
						pastHistory: data.pastHistory ? String(data.pastHistory) : undefined,
						med_xray: data.med_xray === true,
						med_mri: data.med_mri === true,
						med_report: data.med_report === true,
						med_ct: data.med_ct === true,
						surgicalHistory: data.surgicalHistory ? String(data.surgicalHistory) : undefined,
						per_smoking: data.per_smoking === true,
						per_drinking: data.per_drinking === true,
						per_alcohol: data.per_alcohol === true,
						per_drugs: data.per_drugs === true,
						drugsText: data.drugsText ? String(data.drugsText) : undefined,
						sleepCycle: data.sleepCycle ? String(data.sleepCycle) : undefined,
						hydration: data.hydration ? String(data.hydration) : undefined,
						nutrition: data.nutrition ? String(data.nutrition) : undefined,
						siteSide: data.siteSide ? String(data.siteSide) : undefined,
						onset: data.onset ? String(data.onset) : undefined,
						duration: data.duration ? String(data.duration) : undefined,
						natureOfInjury: data.natureOfInjury ? String(data.natureOfInjury) : undefined,
						typeOfPain: data.typeOfPain ? String(data.typeOfPain) : undefined,
						vasScale: data.vasScale ? String(data.vasScale) : undefined,
						aggravatingFactor: data.aggravatingFactor ? String(data.aggravatingFactor) : undefined,
						relievingFactor: data.relievingFactor ? String(data.relievingFactor) : undefined,
						rom: (data.rom as Record<string, any>) || {},
						treatmentProvided: data.treatmentProvided ? String(data.treatmentProvided) : undefined,
						progressNotes: data.progressNotes ? String(data.progressNotes) : undefined,
						physioName: data.physioName ? String(data.physioName) : undefined,
						physioId: data.physioId ? String(data.physioId) : undefined,
						dateOfConsultation: data.dateOfConsultation ? String(data.dateOfConsultation) : undefined,
						referredBy: data.referredBy ? String(data.referredBy) : undefined,
						chiefComplaint: data.chiefComplaint ? String(data.chiefComplaint) : undefined,
						onsetType: data.onsetType ? String(data.onsetType) : undefined,
						mechanismOfInjury: data.mechanismOfInjury ? String(data.mechanismOfInjury) : undefined,
						painType: data.painType ? String(data.painType) : undefined,
						painIntensity: data.painIntensity ? String(data.painIntensity) : undefined,
						clinicalDiagnosis: data.clinicalDiagnosis ? String(data.clinicalDiagnosis) : undefined,
						treatmentPlan: data.treatmentPlan ? (data.treatmentPlan as Array<any>) : undefined,
						followUpVisits: data.followUpVisits ? (data.followUpVisits as Array<any>) : undefined,
						currentPainStatus: data.currentPainStatus ? String(data.currentPainStatus) : undefined,
						currentRom: data.currentRom ? String(data.currentRom) : undefined,
						currentStrength: data.currentStrength ? String(data.currentStrength) : undefined,
						currentFunctionalAbility: data.currentFunctionalAbility ? String(data.currentFunctionalAbility) : undefined,
						complianceWithHEP: data.complianceWithHEP ? String(data.complianceWithHEP) : undefined,
						recommendations: data.recommendations ? String(data.recommendations) : undefined,
						physiotherapistRemarks: data.physiotherapistRemarks ? String(data.physiotherapistRemarks) : undefined,
						built: data.built ? String(data.built) : undefined,
						posture: data.posture ? String(data.posture) : undefined,
						gaitAnalysis: data.gaitAnalysis ? String(data.gaitAnalysis) : undefined,
						mobilityAids: data.mobilityAids ? String(data.mobilityAids) : undefined,
						localObservation: data.localObservation ? String(data.localObservation) : undefined,
						swelling: data.swelling ? String(data.swelling) : undefined,
						muscleWasting: data.muscleWasting ? String(data.muscleWasting) : undefined,
						postureManualNotes: data.postureManualNotes ? String(data.postureManualNotes) : undefined,
						postureFileName: data.postureFileName ? String(data.postureFileName) : undefined,
						postureFileData: data.postureFileData ? String(data.postureFileData) : undefined,
						gaitManualNotes: data.gaitManualNotes ? String(data.gaitManualNotes) : undefined,
						gaitFileName: data.gaitFileName ? String(data.gaitFileName) : undefined,
						gaitFileData: data.gaitFileData ? String(data.gaitFileData) : undefined,
						tenderness: data.tenderness ? String(data.tenderness) : undefined,
						warmth: data.warmth ? String(data.warmth) : undefined,
						scar: data.scar ? String(data.scar) : undefined,
						crepitus: data.crepitus ? String(data.crepitus) : undefined,
						odema: data.odema ? String(data.odema) : undefined,
						mmt: (data.mmt as Record<string, any>) || {},
						specialTest: data.specialTest ? String(data.specialTest) : undefined,
						differentialDiagnosis: data.differentialDiagnosis ? String(data.differentialDiagnosis) : undefined,
						finalDiagnosis: data.finalDiagnosis ? String(data.finalDiagnosis) : undefined,
						shortTermGoals: data.shortTermGoals ? String(data.shortTermGoals) : undefined,
						longTermGoals: data.longTermGoals ? String(data.longTermGoals) : undefined,
						rehabProtocol: data.rehabProtocol ? String(data.rehabProtocol) : undefined,
						advice: data.advice ? String(data.advice) : undefined,
						managementRemarks: data.managementRemarks ? String(data.managementRemarks) : undefined,
						nextFollowUpDate: data.nextFollowUpDate ? String(data.nextFollowUpDate) : undefined,
						nextFollowUpTime: data.nextFollowUpTime ? String(data.nextFollowUpTime) : undefined,
					} as PatientRecordFull;
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

	// Load staff from Firestore
	useEffect(() => {
		if (!user?.displayName) return;

		const unsubscribe = onSnapshot(
			collection(db, 'staff'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data();
					return {
						id: docSnap.id,
						name: data.userName ? String(data.userName) : '',
						userName: data.userName ? String(data.userName) : undefined,
						userEmail: data.userEmail ? String(data.userEmail) : undefined,
						role: (data.role || data.userRole) ? String(data.role || data.userRole) : '',
						availability: data.availability as Record<string, { enabled: boolean; slots: Array<{ start: string; end: string }> }> | undefined,
						dateSpecificAvailability: data.dateSpecificAvailability as Record<string, { enabled: boolean; slots: Array<{ start: string; end: string }> }> | undefined,
					};
				});
				
				// Filter by role, but always include the current logged-in user
				const filtered = mapped.filter(s => 
					s.role === 'Physiotherapist' || 
					s.role === 'StrengthAndConditioning' || 
					s.role === 'ClinicalTeam' ||
					s.name === user.displayName
				);
				
				setStaff(filtered);
			},
			error => {
				console.error('Failed to load staff', error);
				setStaff([]);
			}
		);

		return () => unsubscribe();
	}, [user?.displayName]);

	// Select patient when patientIdParam changes
	useEffect(() => {
		if (patientIdParam && patients.length > 0 && !selectedPatient) {
			const patient = patients.find(p => p.patientId === patientIdParam);
			if (patient) {
				setSelectedPatient(patient);
				setFormData(applyCurrentSessionAdjustments(patient));
			}
		}
	}, [patientIdParam, patients, selectedPatient]);

	// Load header config based on patient type (DYES vs non-DYES)
	useEffect(() => {
		if (!selectedPatient) {
			setHeaderConfig(null);
			return;
		}

		const loadHeaderConfig = async () => {
			const patientTypeUpper = selectedPatient.patientType?.toUpperCase() || '';
			const isDYES = patientTypeUpper === 'DYES';
			const headerType = isDYES ? 'reportDYES' : 'reportNonDYES';
			
			try {
				const config = await getHeaderConfig(headerType);
				const defaultConfig = getDefaultHeaderConfig(headerType);
				
				// Merge config with defaults
				const mergedConfig: HeaderConfig = {
					id: config?.id || headerType,
					type: headerType as 'reportDYES' | 'reportNonDYES' | 'billing',
					mainTitle: config?.mainTitle || defaultConfig.mainTitle || '',
					subtitle: config?.subtitle || defaultConfig.subtitle || '',
					contactInfo: config?.contactInfo || defaultConfig.contactInfo || '',
					associationText: config?.associationText || defaultConfig.associationText || '',
					govermentOrder: config?.govermentOrder || defaultConfig.govermentOrder || '',
					leftLogo: config?.leftLogo || undefined,
					rightLogo: config?.rightLogo || undefined,
				};
				
				setHeaderConfig(mergedConfig);
			} catch (error) {
				console.error('Failed to load header config', error);
				// Use defaults on error
				const defaultConfig = getDefaultHeaderConfig(headerType);
				setHeaderConfig({
					id: headerType,
					type: headerType as 'reportDYES' | 'reportNonDYES' | 'billing',
					...defaultConfig,
				} as HeaderConfig);
			}
		};

		loadHeaderConfig();
	}, [selectedPatient]);

	const filteredPatients = useMemo(() => {
		// Debug logging in development
		if (process.env.NODE_ENV === 'development') {
			console.log('EditReport - Filtering patients:', {
				totalPatients: patients.length,
				clinicianName,
				userDisplayName: user?.displayName,
				sampleAssignedDoctors: patients.slice(0, 5).map(p => ({
					patientId: p.patientId,
					assignedDoctor: p.assignedDoctor,
					normalized: normalize(p.assignedDoctor)
				}))
			});
		}

		// Show all patients or only assigned patients based on toggle
		let assignedPatients: PatientRecordFull[] = [];
		if (showAllPatients) {
			// Show all patients when "View All Patients" is enabled
			assignedPatients = patients;
		} else if (clinicianName) {
			// Only show patients assigned to the current clinician OR have report access
			assignedPatients = patients.filter(patient => {
				// Check if assigned to current clinician
				if (normalize(patient.assignedDoctor) === clinicianName) {
					return true;
				}
				
				// Check if current clinician has report access
				const reportAccessDoctors = (patient as any).reportAccessDoctors || [];
				if (Array.isArray(reportAccessDoctors)) {
					return reportAccessDoctors.some((doctor: string) => normalize(doctor) === clinicianName);
				}
				
				return false;
			});
		}

		// Then filter by search term
		const query = searchTerm.trim().toLowerCase();
		if (!query) return assignedPatients;
		
		return assignedPatients.filter(patient => {
			return (
				(patient.name || '').toLowerCase().includes(query) ||
				(patient.patientId || '').toLowerCase().includes(query) ||
				(patient.phone || '').toLowerCase().includes(query)
			);
		});
	}, [patients, searchTerm, clinicianName, user?.displayName, showAllPatients]);

	const handleSelectPatient = (patient: PatientRecordFull) => {
		setSelectedPatient(patient);
		setFormData(applyCurrentSessionAdjustments(patient));
		router.push(`/clinical-team/edit-report?patientId=${patient.patientId}`);
	};

	const handleFieldChange = (field: keyof PatientRecordFull, value: any) => {
		setFormData(prev => ({ ...prev, [field]: value }));
	};

	const handleCheckboxChange = (field: keyof PatientRecordFull, checked: boolean) => {
		setFormData(prev => ({ ...prev, [field]: checked }));
	};

	const handleRomChange = (joint: string, motion: string, side: 'left' | 'right' | 'none', value: string) => {
		setFormData(prev => {
			const rom = { ...(prev.rom || {}) };
			if (!rom[joint]) {
				rom[joint] = ROM_HAS_SIDE[joint] ? { left: {}, right: {} } : {};
			}

			if (side === 'none') {
				rom[joint][motion] = value;
			} else {
				if (!rom[joint][side]) {
					rom[joint][side] = {};
				}
				rom[joint][side][motion] = value;
			}

			return { ...prev, rom };
		});
	};

	const handleAddRomJoint = () => {
		if (!selectedRomJoint || !formData.rom?.[selectedRomJoint]) {
			setFormData(prev => {
				const rom = { ...(prev.rom || {}) };
				if (!rom[selectedRomJoint]) {
					rom[selectedRomJoint] = ROM_HAS_SIDE[selectedRomJoint] ? { left: {}, right: {} } : {};
				}
				return { ...prev, rom };
			});
		}
		setSelectedRomJoint('');
	};

	const handleMmtChange = (joint: string, motion: string, side: 'left' | 'right' | 'none', value: string) => {
		setFormData(prev => {
			const mmt = { ...(prev.mmt || {}) };
			if (!mmt[joint]) {
				mmt[joint] = ROM_HAS_SIDE[joint] ? { left: {}, right: {} } : {};
			}

			if (side === 'none') {
				mmt[joint][motion] = value;
			} else {
				if (!mmt[joint][side]) {
					mmt[joint][side] = {};
				}
				mmt[joint][side][motion] = value;
			}

			return { ...prev, mmt };
		});
	};

	const handleAddMmtJoint = () => {
		if (!selectedMmtJoint || !formData.mmt?.[selectedMmtJoint]) {
			setFormData(prev => {
				const mmt = { ...(prev.mmt || {}) };
				if (!mmt[selectedMmtJoint]) {
					mmt[selectedMmtJoint] = ROM_HAS_SIDE[selectedMmtJoint] ? { left: {}, right: {} } : {};
				}
				return { ...prev, mmt };
			});
		}
		setSelectedMmtJoint('');
	};

	const handleRemoveRomJoint = (joint: string) => {
		setFormData(prev => {
			if (!prev.rom) return prev;
			const rom = { ...prev.rom };
			delete rom[joint];
			return { ...prev, rom };
		});
	};

	const handleRemoveMmtJoint = (joint: string) => {
		setFormData(prev => {
			if (!prev.mmt) return prev;
			const mmt = { ...prev.mmt };
			delete mmt[joint];
			return { ...prev, mmt };
		});
	};

	const handleFileUpload = (dataField: keyof PatientRecordFull, nameField: keyof PatientRecordFull, file: File | null) => {
		if (!file) {
			setFormData(prev => ({ ...prev, [dataField]: '', [nameField]: '' }));
			return;
		}

		const reader = new FileReader();
		reader.onload = event => {
			const result = event.target?.result;
			if (typeof result === 'string') {
				setFormData(prev => ({ ...prev, [dataField]: result, [nameField]: file.name }));
			}
		};
		reader.readAsDataURL(file);
	};

	const handleRomImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;

		// Validate file type
		if (!file.type.startsWith('image/') && !file.type.includes('pdf')) {
			alert('Please select an image or PDF file');
			return;
		}

		// Validate file size (max 5MB)
		if (file.size > 5 * 1024 * 1024) {
			alert('File size should be less than 5MB');
			return;
		}

		const joint = selectedRomJoint || 'general';
		const reader = new FileReader();
		reader.onload = event => {
			const result = event.target?.result;
			if (typeof result === 'string') {
				setRomImages(prev => ({
					...prev,
					[joint]: { data: result, fileName: file.name }
				}));
			}
		};
		reader.readAsDataURL(file);
	};

	const handleMmtImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;

		// Validate file type
		if (!file.type.startsWith('image/') && !file.type.includes('pdf')) {
			alert('Please select an image or PDF file');
			return;
		}

		// Validate file size (max 5MB)
		if (file.size > 5 * 1024 * 1024) {
			alert('File size should be less than 5MB');
			return;
		}

		const joint = selectedMmtJoint || 'general';
		const reader = new FileReader();
		reader.onload = event => {
			const result = event.target?.result;
			if (typeof result === 'string') {
				setMmtImages(prev => ({
					...prev,
					[joint]: { data: result, fileName: file.name }
				}));
			}
		};
		reader.readAsDataURL(file);
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
			// Update local state
			setPatients(prev => prev.map(p => p.id === patientId ? { ...p, status: newStatus } : p));
			if (selectedPatient?.id === patientId) {
				setSelectedPatient(prev => prev ? { ...prev, status: newStatus } : null);
				setFormData(prev => ({ ...prev, status: newStatus }));
			}
		} catch (error) {
			console.error('Failed to update patient status', error);
			alert(`Failed to update patient status: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setUpdatingStatus(prev => ({ ...prev, [patientId]: false }));
		}
	};

	const handleSave = async () => {
		if (!selectedPatient?.id || saving) return;
		if (!selectedPatient) return; // Additional null check for TypeScript

		setSaving(true);
		try {
			const patientRef = doc(db, 'patients', selectedPatient.id);
			const consultationDate = formData.dateOfConsultation || selectedPatient.dateOfConsultation;
			const totalSessionsValue =
				typeof formData.totalSessionsRequired === 'number'
					? formData.totalSessionsRequired
					: typeof selectedPatient.totalSessionsRequired === 'number'
						? selectedPatient.totalSessionsRequired
						: undefined;
			
			// Only save report-related fields, not patient demographics
			const reportData: Record<string, any> = {
				complaints: formData.complaints || '',
				presentHistory: formData.presentHistory || '',
				pastHistory: formData.pastHistory || '',
				med_xray: formData.med_xray || false,
				med_mri: formData.med_mri || false,
				med_report: formData.med_report || false,
				med_ct: formData.med_ct || false,
				surgicalHistory: formData.surgicalHistory || '',
				per_smoking: formData.per_smoking || false,
				per_drinking: formData.per_drinking || false,
				per_alcohol: formData.per_alcohol || false,
				per_drugs: formData.per_drugs || false,
				drugsText: formData.drugsText || '',
				sleepCycle: formData.sleepCycle || '',
				hydration: formData.hydration || '',
				nutrition: formData.nutrition || '',
				siteSide: formData.siteSide || '',
				onset: formData.onset || '',
				duration: formData.duration || '',
				natureOfInjury: formData.natureOfInjury || '',
				typeOfPain: formData.typeOfPain || '',
				vasScale: formData.vasScale || '',
				aggravatingFactor: formData.aggravatingFactor || '',
				relievingFactor: formData.relievingFactor || '',
				rom: formData.rom || {},
				treatmentProvided: formData.treatmentProvided || '',
				progressNotes: formData.progressNotes || '',
				physioName: formData.physioName || '',
				physioId: formData.physioId || '',
				dateOfConsultation: formData.dateOfConsultation || '',
				referredBy: formData.referredBy || '',
				chiefComplaint: formData.chiefComplaint || '',
				onsetType: formData.onsetType || '',
				mechanismOfInjury: formData.mechanismOfInjury || '',
				painType: formData.painType || '',
				painIntensity: formData.painIntensity || '',
				clinicalDiagnosis: formData.clinicalDiagnosis || '',
				treatmentPlan: formData.treatmentPlan || [],
				followUpVisits: formData.followUpVisits || [],
				currentPainStatus: formData.currentPainStatus || '',
				currentRom: formData.currentRom || '',
				currentStrength: formData.currentStrength || '',
				currentFunctionalAbility: formData.currentFunctionalAbility || '',
				complianceWithHEP: formData.complianceWithHEP || '',
				recommendations: formData.recommendations || '',
				physiotherapistRemarks: formData.physiotherapistRemarks || '',
				built: formData.built || '',
				posture: formData.posture || '',
				gaitAnalysis: formData.gaitAnalysis || '',
				mobilityAids: formData.mobilityAids || '',
				localObservation: formData.localObservation || '',
				swelling: formData.swelling || '',
				muscleWasting: formData.muscleWasting || '',
				postureManualNotes: formData.postureManualNotes || '',
				postureFileName: formData.postureFileName || '',
				postureFileData: formData.postureFileData || '',
				gaitManualNotes: formData.gaitManualNotes || '',
				gaitFileName: formData.gaitFileName || '',
				gaitFileData: formData.gaitFileData || '',
				tenderness: formData.tenderness || '',
				warmth: formData.warmth || '',
				scar: formData.scar || '',
				crepitus: formData.crepitus || '',
				odema: formData.odema || '',
				mmt: formData.mmt || {},
				specialTest: formData.specialTest || '',
				differentialDiagnosis: formData.differentialDiagnosis || '',
				finalDiagnosis: formData.finalDiagnosis || '',
				shortTermGoals: formData.shortTermGoals || '',
				longTermGoals: formData.longTermGoals || '',
				rehabProtocol: formData.rehabProtocol || '',
				advice: formData.advice || '',
				managementRemarks: formData.managementRemarks || '',
				nextFollowUpDate: formData.nextFollowUpDate || '',
				nextFollowUpTime: formData.nextFollowUpTime || '',
				// Session tracking
				totalSessionsRequired:
					typeof formData.totalSessionsRequired === 'number'
						? formData.totalSessionsRequired
						: formData.totalSessionsRequired
							? Number(formData.totalSessionsRequired)
							: null,
				remainingSessions: (() => {
					// If checkbox is checked, decrease by 1 from the base value
					if (sessionCompleted) {
						const baseRemaining = 
							typeof selectedPatient.remainingSessions === 'number'
								? selectedPatient.remainingSessions
								: typeof selectedPatient.totalSessionsRequired === 'number'
									? selectedPatient.totalSessionsRequired
									: null;
						
						if (baseRemaining !== null && baseRemaining > 0) {
							return Math.max(0, baseRemaining - 1);
						}
					}
					
					// If explicitly set in form, use that value
					if (typeof formData.remainingSessions === 'number') {
						return formData.remainingSessions;
					}
					if (formData.remainingSessions) {
						return Number(formData.remainingSessions);
					}
					// If not set in form, use selectedPatient value or set equal to total
					const totalValue =
						typeof formData.totalSessionsRequired === 'number'
							? formData.totalSessionsRequired
							: typeof selectedPatient.totalSessionsRequired === 'number'
								? selectedPatient.totalSessionsRequired
								: null;
					
					if (totalValue !== null) {
						// If remainingSessions is not set, set it equal to totalSessionsRequired
						const currentRemaining = 
							typeof selectedPatient.remainingSessions === 'number'
								? selectedPatient.remainingSessions
								: totalValue;
						return currentRemaining;
					}
					return null;
				})(),
				updatedAt: serverTimestamp(),
			};

			// Create report snapshot before updating
			// Get current report data from selectedPatient to create a snapshot
			const currentReportData: Partial<PatientRecordFull> = {
				complaints: selectedPatient.complaints,
				presentHistory: selectedPatient.presentHistory,
				pastHistory: selectedPatient.pastHistory,
				med_xray: selectedPatient.med_xray,
				med_mri: selectedPatient.med_mri,
				med_report: selectedPatient.med_report,
				med_ct: selectedPatient.med_ct,
				surgicalHistory: selectedPatient.surgicalHistory,
				per_smoking: selectedPatient.per_smoking,
				per_drinking: selectedPatient.per_drinking,
				per_alcohol: selectedPatient.per_alcohol,
				per_drugs: selectedPatient.per_drugs,
				drugsText: selectedPatient.drugsText,
				sleepCycle: selectedPatient.sleepCycle,
				hydration: selectedPatient.hydration,
				nutrition: selectedPatient.nutrition,
				siteSide: selectedPatient.siteSide,
				onset: selectedPatient.onset,
				duration: selectedPatient.duration,
				natureOfInjury: selectedPatient.natureOfInjury,
				typeOfPain: selectedPatient.typeOfPain,
				vasScale: selectedPatient.vasScale,
				aggravatingFactor: selectedPatient.aggravatingFactor,
				relievingFactor: selectedPatient.relievingFactor,
				rom: selectedPatient.rom,
				treatmentProvided: selectedPatient.treatmentProvided,
				progressNotes: selectedPatient.progressNotes,
				physioName: selectedPatient.physioName,
				physioId: selectedPatient.physioId,
				dateOfConsultation: selectedPatient.dateOfConsultation,
				referredBy: selectedPatient.referredBy,
				chiefComplaint: selectedPatient.chiefComplaint,
				onsetType: selectedPatient.onsetType,
				mechanismOfInjury: selectedPatient.mechanismOfInjury,
				painType: selectedPatient.painType,
				painIntensity: selectedPatient.painIntensity,
				clinicalDiagnosis: selectedPatient.clinicalDiagnosis,
				treatmentPlan: selectedPatient.treatmentPlan,
				followUpVisits: selectedPatient.followUpVisits,
				currentPainStatus: selectedPatient.currentPainStatus,
				currentRom: selectedPatient.currentRom,
				currentStrength: selectedPatient.currentStrength,
				currentFunctionalAbility: selectedPatient.currentFunctionalAbility,
				complianceWithHEP: selectedPatient.complianceWithHEP,
				recommendations: selectedPatient.recommendations,
				physiotherapistRemarks: selectedPatient.physiotherapistRemarks,
				built: selectedPatient.built,
				posture: selectedPatient.posture,
				gaitAnalysis: selectedPatient.gaitAnalysis,
				mobilityAids: selectedPatient.mobilityAids,
				localObservation: selectedPatient.localObservation,
				swelling: selectedPatient.swelling,
				muscleWasting: selectedPatient.muscleWasting,
				postureManualNotes: selectedPatient.postureManualNotes,
				postureFileName: selectedPatient.postureFileName,
				postureFileData: selectedPatient.postureFileData,
				gaitManualNotes: selectedPatient.gaitManualNotes,
				gaitFileName: selectedPatient.gaitFileName,
				gaitFileData: selectedPatient.gaitFileData,
				tenderness: selectedPatient.tenderness,
				warmth: selectedPatient.warmth,
				scar: selectedPatient.scar,
				crepitus: selectedPatient.crepitus,
				odema: selectedPatient.odema,
				mmt: selectedPatient.mmt,
				specialTest: selectedPatient.specialTest,
				differentialDiagnosis: selectedPatient.differentialDiagnosis,
				finalDiagnosis: selectedPatient.finalDiagnosis,
				shortTermGoals: selectedPatient.shortTermGoals,
				longTermGoals: selectedPatient.longTermGoals,
				rehabProtocol: selectedPatient.rehabProtocol,
				advice: selectedPatient.advice,
				managementRemarks: selectedPatient.managementRemarks,
				nextFollowUpDate: selectedPatient.nextFollowUpDate,
				nextFollowUpTime: selectedPatient.nextFollowUpTime,
				totalSessionsRequired: selectedPatient.totalSessionsRequired,
				remainingSessions: selectedPatient.remainingSessions,
			};

			// Check if there's any existing report data to save as previous report
			const hasReportData = Object.values(currentReportData).some(val => 
				val !== undefined && val !== null && val !== '' && 
				!(Array.isArray(val) && val.length === 0) &&
				!(typeof val === 'object' && Object.keys(val).length === 0)
			);

			// Create report snapshot if there's existing report data
			if (hasReportData) {
				// Get the latest report number for this patient
				const versionsQuery = query(
					collection(db, 'reportVersions'),
					where('patientId', '==', selectedPatient.patientId),
					orderBy('version', 'desc')
				);
				const versionsSnapshot = await getDocs(versionsQuery);
				const nextVersion = versionsSnapshot.docs.length > 0 
					? (versionsSnapshot.docs[0].data().version as number) + 1 
					: 1;

				// Save report snapshot (remove undefined values for Firestore)
				await addDoc(collection(db, 'reportVersions'), {
					patientId: selectedPatient.patientId,
					patientName: selectedPatient.name,
					version: nextVersion,
					reportData: removeUndefined(currentReportData),
					createdBy: user?.displayName || user?.email || 'Unknown',
					createdById: user?.uid || '',
					createdAt: serverTimestamp(),
				});
			}

			// Update the patient document with new report data
			await updateDoc(patientRef, reportData);

			// Update selectedPatient state to reflect the new data
			setSelectedPatient(prev => prev ? { ...prev, ...reportData } : null);
			setPatients(prev =>
				prev.map(p => (p.id === selectedPatient.id ? { ...p, ...reportData } : p))
			);

			await markAppointmentCompletedForReport(selectedPatient, consultationDate);
			
			// If checkbox was checked, the remainingSessions in reportData is already decreased
			// Use that value and preserve it, don't let refreshPatientSessionProgress override it
			const savedRemainingSessions = reportData.remainingSessions;
			
			const patientForProgress: PatientRecordFull = {
				...selectedPatient,
				// Preserve totalSessionsRequired - it should never change
				totalSessionsRequired: totalSessionsValue !== undefined && totalSessionsValue !== null
					? totalSessionsValue
					: selectedPatient.totalSessionsRequired,
				// Preserve the saved remainingSessions if checkbox was checked
				remainingSessions: sessionCompleted && savedRemainingSessions !== undefined 
					? savedRemainingSessions as number
					: selectedPatient.remainingSessions,
			};
			
			const sessionProgress = await refreshPatientSessionProgress(
				patientForProgress,
				totalSessionsValue ?? null
			);

			// Update with saved remainingSessions if checkbox was checked, otherwise use sessionProgress
			const finalRemainingSessions = sessionCompleted && savedRemainingSessions !== undefined
				? savedRemainingSessions as number
				: sessionProgress?.remainingSessions;

			if (finalRemainingSessions !== undefined || sessionProgress) {
				const updates = {
					...(sessionProgress || {}),
					...(finalRemainingSessions !== undefined ? { remainingSessions: finalRemainingSessions } : {}),
					// Preserve totalSessionsRequired - never change it
					totalSessionsRequired: totalSessionsValue ?? selectedPatient.totalSessionsRequired,
				};
				
				setSelectedPatient(prev => (prev ? { ...prev, ...updates } : null));
				setPatients(prev =>
					prev.map(p => (p.id === selectedPatient.id ? { ...p, ...updates } : p))
				);
				setFormData(prev => ({
					...prev,
					...(finalRemainingSessions !== undefined
						? { remainingSessions: finalRemainingSessions }
						: {}),
					...(sessionProgress?.remainingSessions !== undefined && !sessionCompleted
						? { remainingSessions: sessionProgress.remainingSessions }
						: {}),
					...(sessionProgress?.status ? { status: sessionProgress.status } : {}),
					// Preserve totalSessionsRequired in formData
					totalSessionsRequired: totalSessionsValue ?? prev.totalSessionsRequired ?? selectedPatient.totalSessionsRequired,
				}));
			}

			// Reset session completion checkbox after save (but keep the decreased remaining sessions)
			setSessionCompleted(false);

			setSavedMessage(true);
			setTimeout(() => setSavedMessage(false), 3000);
		} catch (error) {
			console.error('Failed to save report', error);
			alert('Failed to save report. Please try again.');
		} finally {
			setSaving(false);
		}
	};

	const loadVersionHistory = async () => {
		if (!selectedPatient?.patientId) return;

		setLoadingVersions(true);
		try {
			const versionsQuery = query(
				collection(db, 'reportVersions'),
				where('patientId', '==', selectedPatient.patientId),
				orderBy('version', 'desc')
			);
			const versionsSnapshot = await getDocs(versionsQuery);
			const versions = versionsSnapshot.docs.map(doc => {
					const data = doc.data();
					const createdAt = (data.createdAt as Timestamp | undefined)?.toDate?.();
					return {
						id: doc.id,
						version: data.version as number,
						createdAt: createdAt ? createdAt.toISOString() : new Date().toISOString(),
						createdBy: (data.createdBy as string) || 'Unknown',
						data: (data.reportData as Partial<PatientRecordFull>) || {},
					};
				});
			setVersionHistory(versions);
		} catch (error) {
			console.error('Failed to load report history', error);
			alert('Failed to load report history. Please try again.');
		} finally {
			setLoadingVersions(false);
		}
	};

	const handleStrengthConditioningReport = (patientId?: string) => {
		// Navigate to strength and conditioning report page
		// If patientId is provided, pass it as a query parameter
		const url = patientId 
			? `/clinical-team/strength-conditioning-report?patientId=${patientId}`
			: '/clinical-team/strength-conditioning-report';
		router.push(url);
	};

	const handleOpenReportModal = (patientId: string | undefined) => {
		if (!patientId) {
			console.error('Patient ID is required to open report modal');
			alert('Patient ID is missing. Cannot open report.');
			return;
		}
		console.log('Opening report modal for patient:', patientId);
		console.log('Current state before update - showReportModal:', showReportModal, 'reportModalPatientId:', reportModalPatientId);
		// Set both states in a single batch
		setReportModalPatientId(patientId);
		setShowReportModal(true);
		console.log('State updated - should open modal now');
	};

	const handleCloseReportModal = () => {
		setShowReportModal(false);
		setReportModalPatientId(null);
	};

	const handlePackageFormChange =
		(field: keyof PackageSetupFormState) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
			const { value } = event.target;
			setPackageForm(prev => {
				const updated = {
					...prev,
					[field]: value,
					...(field === 'paymentType' && value !== 'with' ? { concessionPercent: '' } : {}),
				};
				
				// Clear dependent fields when parent selection changes
				if (field === 'clientType') {
					updated.category = '';
					updated.selectedPackage = '';
					updated.totalNoOfSessions = '';
					updated.packageAmount = '';
				} else if (field === 'category') {
					updated.selectedPackage = '';
					updated.totalNoOfSessions = '';
					updated.packageAmount = '';
				} else if (field === 'selectedPackage') {
					// Auto-fill sessions and amount when package is selected
					if (value === 'custom') {
						// For custom package, clear values and allow manual entry
						updated.totalNoOfSessions = '';
						updated.packageAmount = '';
					} else if (value) {
						const allPackages = prev.clientType === 'professional' 
							? PROFESSIONAL_PACKAGES 
							: prev.clientType === 'student' 
							? STUDENT_PACKAGES 
							: [...PROFESSIONAL_PACKAGES, ...STUDENT_PACKAGES];
						
						const selectedPkg = allPackages.find(pkg => pkg.id === value);
						if (selectedPkg) {
							// For individual treatments, default to 1 session but allow manual entry
							// For packages, use predefined sessions
							updated.totalNoOfSessions = selectedPkg.category === 'individual' ? '1' : String(selectedPkg.sessions);
							updated.packageAmount = String(selectedPkg.amount);
						}
					} else {
						updated.totalNoOfSessions = '';
						updated.packageAmount = '';
					}
				} else if (field === 'totalNoOfSessions' && prev.selectedPackage && prev.selectedPackage !== 'custom') {
					// Recalculate amount for individual treatments when sessions change (skip for custom)
					const allPackages = prev.clientType === 'professional' 
						? PROFESSIONAL_PACKAGES 
						: prev.clientType === 'student' 
						? STUDENT_PACKAGES 
						: [...PROFESSIONAL_PACKAGES, ...STUDENT_PACKAGES];
					
					const selectedPkg = allPackages.find(pkg => pkg.id === prev.selectedPackage);
					if (selectedPkg && selectedPkg.category === 'individual') {
						const sessions = Number(value) || 1;
						const perSessionAmount = selectedPkg.amount;
						updated.packageAmount = String(sessions * perSessionAmount);
					}
				}
				
				return updated;
			});
			setPackageFormErrors(prev => ({
				...prev,
				[field]: undefined,
			}));
		};

	const validatePackageForm = () => {
		const errors: Partial<Record<keyof PackageSetupFormState, string>> = {};
		if (!packageForm.clientType) {
			errors.clientType = 'Please select a client type.';
		}
		if (!packageForm.category) {
			errors.category = 'Please select a category.';
		}
		if (!packageForm.selectedPackage) {
			errors.selectedPackage = 'Please select a package.';
		}
		const totalSessionsValue = Number(packageForm.totalNoOfSessions);
		if (!packageForm.totalNoOfSessions.trim()) {
			errors.totalNoOfSessions = 'Please enter the total number of sessions.';
		} else if (Number.isNaN(totalSessionsValue) || totalSessionsValue <= 0 || !Number.isInteger(totalSessionsValue)) {
			errors.totalNoOfSessions = 'Total number of sessions must be a positive whole number.';
		}
		if (!packageForm.paymentType) {
			errors.paymentType = 'Please select a payment type.';
		}
		const packageAmountValue = Number(packageForm.packageAmount);
		const concessionPercentValue = packageForm.concessionPercent.trim()
			? Math.min(Math.max(Number(packageForm.concessionPercent), 0), 100)
			: 0;
		if (!packageForm.packageAmount.trim()) {
			errors.packageAmount = 'Please enter the package amount.';
		} else if (Number.isNaN(packageAmountValue) || packageAmountValue <= 0) {
			errors.packageAmount = 'Package amount must be greater than 0.';
		}
		if (packageForm.concessionPercent.trim()) {
			const percentValue = Number(packageForm.concessionPercent);
			if (Number.isNaN(percentValue) || percentValue < 0 || percentValue > 100) {
				errors.concessionPercent = 'Concession % must be between 0 and 100.';
			}
		}
		setPackageFormErrors(errors);
		return Object.keys(errors).length === 0;
	};

	const handleOpenPackageModal = (patient: PatientRecordFull) => {
		setPackageModalPatient(patient);
		setPackageForm({
			clientType: '',
			category: '',
			selectedPackage: '',
			totalNoOfSessions: patient.totalSessionsRequired ? String(patient.totalSessionsRequired) : '',
			paymentType: ((patient as any).paymentType as PaymentTypeOption) ?? '',
			paymentDescription: (patient as any).paymentDescription ?? '',
			packageAmount: (patient as any).packageAmount ? String((patient as any).packageAmount) : '',
			concessionPercent: (patient as any).concessionPercent != null ? String((patient as any).concessionPercent) : '',
		});
		setPackageFormErrors({});
		setShowPackageModal(true);
		setOpenDropdownId(null);
	};

	const handleClosePackageModal = () => {
		setShowPackageModal(false);
		setPackageModalPatient(null);
		setPackageForm(PACKAGE_FORM_INITIAL_STATE);
		setPackageFormErrors({});
	};

	// Booking modal handlers
	const [bookingModalAppointment, setBookingModalAppointment] = useState<Appointment | null>(null);

	const handleOpenBookingModal = (patient: PatientRecordFull, appointment?: Appointment) => {
		setBookingModalPatient(patient);
		setBookingModalAppointment(appointment || null);
		setShowBookingModal(true);
	};

	const handleCloseBookingModal = () => {
		setShowBookingModal(false);
		setBookingModalPatient(null);
		setBookingModalAppointment(null);
	};

	// Reschedule dialog handlers
	const handleOpenRescheduleDialog = async (appointment: {
		id: string;
		appointmentId?: string;
		patient: string;
		doctor: string;
		date: string;
		time: string;
	}) => {
		setRescheduleAppointment(appointment);
		setShowRescheduleDialog(true);
		
		// Fetch all appointments for conflict checking
		try {
			const appointmentsSnapshot = await getDocs(collection(db, 'appointments'));
			const allAppts = appointmentsSnapshot.docs.map(docSnap => {
				const data = docSnap.data();
				return {
					id: docSnap.id,
					appointmentId: data.appointmentId ? String(data.appointmentId) : undefined,
					patient: data.patient ? String(data.patient) : '',
					doctor: data.doctor ? String(data.doctor) : '',
					date: data.date ? String(data.date) : '',
					time: data.time ? String(data.time) : '',
					status: data.status ? String(data.status) : undefined,
				};
			});
			setAllAppointmentsForReschedule(allAppts);
		} catch (error) {
			console.error('Failed to load appointments for conflict checking:', error);
			setAllAppointmentsForReschedule([]);
		}
	};

	const handleCloseRescheduleDialog = () => {
		setShowRescheduleDialog(false);
		setRescheduleAppointment(null);
	};

	const handleConfirmReschedule = async (newDate: string, newTime: string) => {
		if (!rescheduleAppointment) return;

		try {
			const appointmentRef = doc(db, 'appointments', rescheduleAppointment.id);
			await updateDoc(appointmentRef, {
				date: newDate,
				time: newTime,
			});
			alert('Appointment rescheduled successfully.');
		} catch (error) {
			console.error('Failed to reschedule appointment:', error);
			throw error; // Re-throw so RescheduleDialog can handle it
		}
	};

	const handleOpenTransferDialog = async (appointment: {
		id: string;
		appointmentId?: string;
		patient: string;
		patientId?: string;
		doctor: string;
		date: string;
		time: string;
	}) => {
		setTransferAppointment(appointment);
		setShowTransferDialog(true);
		
		// Fetch all appointments for conflict checking
		try {
			const appointmentsSnapshot = await getDocs(collection(db, 'appointments'));
			const allAppts = appointmentsSnapshot.docs.map(docSnap => {
				const data = docSnap.data();
				return {
					id: docSnap.id,
					appointmentId: data.appointmentId ? String(data.appointmentId) : undefined,
					patient: data.patient ? String(data.patient) : '',
					doctor: data.doctor ? String(data.doctor) : '',
					date: data.date ? String(data.date) : '',
					time: data.time ? String(data.time) : '',
					status: data.status ? String(data.status) : undefined,
					duration: typeof data.duration === 'number' ? data.duration : undefined,
				};
			});
			setAllAppointmentsForTransfer(allAppts);
		} catch (error) {
			console.error('Failed to load appointments for conflict checking:', error);
			setAllAppointmentsForTransfer([]);
		}
	};

	const handleCloseTransferDialog = () => {
		setShowTransferDialog(false);
		setTransferAppointment(null);
	};

	const handleOpenPatientTransferDialog = async (patient: PatientRecordFull) => {
		setPatientTransferPatient(patient);
		setSelectedTherapistForTransfer('');
		setPatientTransferAvailabilityCheck(null);
		setShowPatientTransferDialog(true);
		
		// Check availability for upcoming appointments
		setCheckingPatientTransferAvailability(true);
		try {
			const appointmentsQuery = query(
				collection(db, 'appointments'),
				where('patientId', '==', patient.patientId),
				where('status', 'in', ['pending', 'ongoing'])
			);
			const appointmentsSnapshot = await getDocs(appointmentsQuery);
			const appointments = appointmentsSnapshot.docs.map(docSnap => {
				const data = docSnap.data();
				return {
					id: docSnap.id,
					date: data.date ? String(data.date) : '',
					time: data.time ? String(data.time) : '',
					status: data.status ? String(data.status) : 'pending',
					duration: typeof data.duration === 'number' ? data.duration : undefined,
				};
			});
			
			setPatientTransferAvailabilityCheck({
				appointments,
				conflicts: [], // Conflicts will be checked when therapist is selected
				hasConflicts: false,
			});
		} catch (error) {
			console.error('Failed to load appointments for transfer', error);
		} finally {
			setCheckingPatientTransferAvailability(false);
		}
	};

	const handleClosePatientTransferDialog = () => {
		setShowPatientTransferDialog(false);
		setPatientTransferPatient(null);
		setSelectedTherapistForTransfer('');
		setPatientTransferAvailabilityCheck(null);
	};

	const handleConfirmPatientTransfer = async () => {
		if (!patientTransferPatient || !selectedTherapistForTransfer) {
			alert('Please select a therapist to transfer the patient to.');
			return;
		}

		const newTherapistNormalized = normalize(selectedTherapistForTransfer);
		if (newTherapistNormalized === clinicianName) {
			alert('You cannot transfer a patient to yourself. Please select a different therapist.');
			return;
		}

		setTransferringPatient(true);
		try {
			const currentStaff = staff.find(s => normalize(s.userName || s.name) === clinicianName);
			const currentStaffName = currentStaff?.userName || currentStaff?.name || user?.displayName || '';
			const currentStaffAuthId = user?.uid || currentStaff?.id || '';
			const currentStaffDocId = currentStaff?.id || null;

			const oldTherapist = patientTransferPatient.assignedDoctor;
			const oldTherapistData = staff.find(s => normalize(s.userName || s.name) === normalize(oldTherapist || ''));
			const newTherapistData = staff.find(s => normalize(s.userName || s.name) === newTherapistNormalized);

			if (!newTherapistData) {
				alert('Therapist not found. Please try again.');
				return;
			}

			// Check for an existing pending transfer request for the same patient and therapist
		const existingRequestQuery = query(
			collection(db, 'transferRequests'),
			where('patientId', '==', patientTransferPatient.patientId),
			where('toTherapist', '==', selectedTherapistForTransfer),
			where('status', '==', 'pending'),
			where('type', '==', 'patient')
		);
			const existingRequestSnapshot = await getDocs(existingRequestQuery);
			if (!existingRequestSnapshot.empty) {
				alert('A pending transfer request already exists for this patient and therapist.');
				return;
			}

			// Get Firebase Auth user IDs via users collection lookup
			let oldTherapistUserId = oldTherapistData?.id || '';
			let newTherapistUserId = newTherapistData.id;

		const resolveUserIdForStaff = async (staffMember?: { userEmail?: string; userName?: string }) => {
			if (!staffMember) return null;
			const attempts = [];
			if (staffMember.userEmail) {
				attempts.push(query(collection(db, 'users'), where('email', '==', staffMember.userEmail.toLowerCase())));
			}
			if (staffMember.userName) {
				attempts.push(query(collection(db, 'users'), where('userName', '==', staffMember.userName)));
			}
			for (const q of attempts) {
				const snapshot = await getDocs(q);
				if (!snapshot.empty) {
					return snapshot.docs[0].id;
				}
			}
			return null;
		};

		const resolvedOldId = await resolveUserIdForStaff(oldTherapistData);
			if (resolvedOldId) {
				oldTherapistUserId = resolvedOldId;
			}

		const resolvedNewId = await resolveUserIdForStaff(newTherapistData);
			if (resolvedNewId) {
				newTherapistUserId = resolvedNewId;
			}

			// Create transfer request
			const requestRef = await addDoc(collection(db, 'transferRequests'), {
				patientId: patientTransferPatient.patientId,
				patientName: patientTransferPatient.name,
				patientDocumentId: patientTransferPatient.id,
				fromTherapist: oldTherapist || null,
				fromTherapistId: oldTherapistData?.id || null,
				fromTherapistAuthId: oldTherapistUserId || null,
				toTherapist: selectedTherapistForTransfer,
				toTherapistId: newTherapistData.id,
				toTherapistAuthId: newTherapistUserId,
				requestedBy: currentStaffName,
				requestedById: currentStaffDocId,
				requestedByAuthId: currentStaffAuthId,
				status: 'pending',
				requestedAt: serverTimestamp(),
				type: 'patient',
			});

			// Create notifications
			const notificationPromises: Promise<void>[] = [];

			// Notify new therapist
			const newTherapistNotification = addDoc(collection(db, 'notifications'), {
				userId: newTherapistUserId,
				title: 'Patient Transfer Request',
				message: `${currentStaffName} has requested to transfer ${patientTransferPatient.name} (${patientTransferPatient.patientId}) to you. Please accept or reject the request.`,
				category: 'patient',
				status: 'unread',
				createdAt: serverTimestamp(),
				metadata: {
					patientId: patientTransferPatient.patientId,
					patientName: patientTransferPatient.name,
					fromTherapist: oldTherapist || null,
					toTherapist: selectedTherapistForTransfer,
					type: 'patient_transfer_request',
					requestId: requestRef.id,
				},
			});
			notificationPromises.push(newTherapistNotification.then(() => {}));

			// Notify old therapist (if exists)
			if (oldTherapist && oldTherapistData && oldTherapistUserId) {
				const oldTherapistNotification = addDoc(collection(db, 'notifications'), {
					userId: oldTherapistUserId,
					title: 'Patient Transfer Requested',
					message: `A transfer request has been sent for ${patientTransferPatient.name} (${patientTransferPatient.patientId}) to ${selectedTherapistForTransfer}. Waiting for acceptance.`,
					category: 'patient',
					status: 'unread',
					createdAt: serverTimestamp(),
					metadata: {
						patientId: patientTransferPatient.patientId,
						patientName: patientTransferPatient.name,
						fromTherapist: oldTherapist,
						toTherapist: selectedTherapistForTransfer,
						type: 'patient_transfer_request',
						requestId: requestRef.id,
					},
				});
				notificationPromises.push(oldTherapistNotification.then(() => {}));
			}

			await Promise.allSettled(notificationPromises);

			alert(`Transfer request sent to ${selectedTherapistForTransfer}. Waiting for acceptance.`);
			handleClosePatientTransferDialog();
		} catch (error) {
			console.error('Failed to create transfer request', error);
			alert(`Failed to create transfer request: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setTransferringPatient(false);
		}
	};

	const handleConfirmTransfer = async (newTherapistId: string, newTherapistName: string) => {
		if (!transferAppointment) return;

		try {
			const selectedStaff = staff.find(s => s.id === newTherapistId);
			if (!selectedStaff) {
				throw new Error('Target therapist not found');
			}

			// Get current user info
			const currentStaff = staff.find(s => normalize(s.userName || s.name) === clinicianName);
			const currentStaffAuthId = user?.uid || currentStaff?.id || '';
			const currentStaffDocId = currentStaff?.id || null;
			const currentStaffName = currentStaff?.userName || currentStaff?.name || user?.displayName || 'Unknown';

			// Create session transfer request instead of directly transferring
			const requestRef = await addDoc(collection(db, 'transferRequests'), {
				type: 'session', // Distinguish from patient transfers
				appointmentId: transferAppointment.id,
				appointmentIds: [transferAppointment.id], // Array for future multi-session transfers
				patientId: transferAppointment.patientId,
				patientName: transferAppointment.patient,
				patientDocumentId: patients.find(p => p.patientId === transferAppointment.patientId)?.id || null,
				fromTherapist: transferAppointment.doctor,
				fromTherapistId: currentStaffDocId,
				fromTherapistAuthId: currentStaffAuthId,
				toTherapist: newTherapistName,
				toTherapistId: newTherapistId,
				requestedBy: currentStaffName,
				requestedById: currentStaffDocId,
				requestedByAuthId: currentStaffAuthId,
				status: 'pending',
				requestedAt: serverTimestamp(),
				// Appointment details
				appointmentDate: transferAppointment.date,
				appointmentTime: transferAppointment.time,
			});

			// Get Firebase Auth user ID for target therapist from staff document
			const targetStaffDoc = await getDoc(doc(db, 'staff', newTherapistId));
			let targetUserId = newTherapistId; // Fallback to staff ID if userEmail not found
			if (targetStaffDoc.exists()) {
				const targetStaffData = targetStaffDoc.data();
				const targetUserEmail = targetStaffData.userEmail;
				if (targetUserEmail) {
					// Query users collection to find Firebase Auth user ID
					const usersQuery = query(collection(db, 'users'), where('email', '==', targetUserEmail.toLowerCase()));
					const usersSnapshot = await getDocs(usersQuery);
					if (!usersSnapshot.empty) {
						targetUserId = usersSnapshot.docs[0].id; // Use the document ID which is the Firebase Auth UID
					}
				}
			}

			// Create notification for target therapist
			await addDoc(collection(db, 'notifications'), {
				userId: targetUserId,
				title: 'Session Transfer Request',
				message: `${currentStaffName} has requested to transfer a session for ${transferAppointment.patient} (${transferAppointment.patientId}) on ${transferAppointment.date} at ${transferAppointment.time} to you. Please accept or reject the request.`,
				category: 'appointment',
				status: 'unread',
				createdAt: serverTimestamp(),
				metadata: {
					patientId: transferAppointment.patientId,
					patientName: transferAppointment.patient,
					appointmentId: transferAppointment.id,
					appointmentDate: transferAppointment.date,
					appointmentTime: transferAppointment.time,
					fromTherapist: transferAppointment.doctor,
					toTherapist: newTherapistName,
					type: 'session_transfer_request',
					requestId: requestRef.id,
				},
			});

			// Create notification for original therapist (if different)
			if (currentStaff?.id && currentStaff.id !== newTherapistId) {
				// Get Firebase Auth user ID for current therapist
				const currentStaffDoc = await getDoc(doc(db, 'staff', currentStaff.id));
				let currentUserId = currentStaff.id; // Fallback to staff ID if userEmail not found
				if (currentStaffDoc.exists()) {
					const currentStaffData = currentStaffDoc.data();
					const currentUserEmail = currentStaffData.userEmail;
					if (currentUserEmail) {
						// Query users collection to find Firebase Auth user ID
						const usersQuery = query(collection(db, 'users'), where('email', '==', currentUserEmail.toLowerCase()));
						const usersSnapshot = await getDocs(usersQuery);
						if (!usersSnapshot.empty) {
							currentUserId = usersSnapshot.docs[0].id; // Use the document ID which is the Firebase Auth UID
						}
					}
				}

				await addDoc(collection(db, 'notifications'), {
					userId: currentUserId,
					title: 'Session Transfer Requested',
					message: `A transfer request has been sent for ${transferAppointment.patient}'s session on ${transferAppointment.date} at ${transferAppointment.time} to ${newTherapistName}. Waiting for acceptance.`,
					category: 'appointment',
					status: 'unread',
					createdAt: serverTimestamp(),
					metadata: {
						patientId: transferAppointment.patientId,
						patientName: transferAppointment.patient,
						appointmentId: transferAppointment.id,
						appointmentDate: transferAppointment.date,
						appointmentTime: transferAppointment.time,
						fromTherapist: transferAppointment.doctor,
						toTherapist: newTherapistName,
						type: 'session_transfer_request',
						requestId: requestRef.id,
					},
				});
			}

			alert('Session transfer request sent. The target therapist will be notified and must accept the request.');
		} catch (error) {
			console.error('Failed to create transfer request:', error);
			throw error; // Re-throw so TransferSessionDialog can handle it
		}
	};

	const handleSubmitPackageSetup = async () => {
		if (!packageModalPatient || !packageModalPatient.id) {
			alert('Unable to find the patient record.');
			return;
		}

		if (!validatePackageForm() || packageSubmitting) return;

		const totalSessionsValue = Number(packageForm.totalNoOfSessions);
		const packageAmountValue = Number(packageForm.packageAmount);
		const paymentDescriptionValue = packageForm.paymentDescription.trim();
		const normalizedDescription = paymentDescriptionValue || undefined;
		const concessionPercentValue =
			packageForm.paymentType === 'with' && packageForm.concessionPercent.trim()
				? Math.min(Math.max(Number(packageForm.concessionPercent), 0), 100)
				: null;

		setPackageSubmitting(true);
		try {
			const patientRef = doc(db, 'patients', packageModalPatient.id);
			await updateDoc(patientRef, {
				totalSessionsRequired: totalSessionsValue,
				paymentType: packageForm.paymentType as PaymentTypeOption,
				paymentDescription: paymentDescriptionValue || null,
				packageAmount: packageAmountValue,
				concessionPercent: concessionPercentValue,
			});

			const billingId = `PKG-${packageModalPatient.patientId}-${Date.now()}`;
			const payableAmount =
				typeof concessionPercentValue === 'number' && concessionPercentValue > 0
					? Number((packageAmountValue * (1 - concessionPercentValue / 100)).toFixed(2))
					: packageAmountValue;

			await addDoc(collection(db, 'billing'), {
				billingId,
				patient: packageModalPatient.name,
				patientId: packageModalPatient.patientId,
				amount: payableAmount,
				packageAmount: packageAmountValue,
				concessionPercent: concessionPercentValue,
				amountPaid: 0,
				date: new Date().toISOString().split('T')[0],
				status: 'Pending',
				paymentMode: null,
				utr: null,
				createdAt: serverTimestamp(),
				updatedAt: serverTimestamp(),
			});

			// Get package category from selected package
			const allPackages = [...PROFESSIONAL_PACKAGES, ...STUDENT_PACKAGES];
			const selectedPkg = allPackages.find(pkg => pkg.id === packageForm.selectedPackage);
			const packageCategory = selectedPkg?.category || packageForm.category || 'individual';
			
			// Create appointments based on number of sessions
			const appointmentsCreated: string[] = [];
			for (let i = 1; i <= totalSessionsValue; i++) {
				const appointmentId = `APT-${packageModalPatient.patientId}-${Date.now()}-${i}`;
				await addDoc(collection(db, 'appointments'), {
					appointmentId,
					patientId: packageModalPatient.patientId,
					patient: packageModalPatient.name,
					doctor: '', // Will be assigned later
					date: '', // Will be scheduled later
					time: '', // Will be scheduled later
					status: 'pending',
					notes: null,
					isConsultation: false,
					sessionNumber: i,
					totalSessions: totalSessionsValue,
					packageBillingId: billingId,
					packageCategory: packageCategory, // Store the category
					createdAt: serverTimestamp(),
				});
				appointmentsCreated.push(appointmentId);
			}

			setPatients(prev =>
				prev.map(p =>
					p.id === packageModalPatient.id
						? {
								...p,
								totalSessionsRequired: totalSessionsValue,
								paymentType: packageForm.paymentType as PaymentTypeOption,
								paymentDescription: normalizedDescription,
								packageAmount: packageAmountValue,
								concessionPercent: concessionPercentValue ?? undefined,
						  }
						: p
				)
			);

			alert(`Package details saved. Billing entry created. ${totalSessionsValue} appointment${totalSessionsValue > 1 ? 's' : ''} created.`);
			handleClosePackageModal();
		} catch (error) {
			console.error('Failed to save package details', error);
			alert('Failed to save package information. Please try again.');
		} finally {
			setPackageSubmitting(false);
		}
	};

	const togglePatientExpanded = (patientId: string) => {
		setExpandedPatients(prev => {
			const next = new Set(prev);
			if (next.has(patientId)) {
				next.delete(patientId);
			} else {
				next.add(patientId);
			}
			return next;
		});
	};

	// Load appointments for a patient when expanded
	useEffect(() => {
		// Clean up subscriptions for patients that are no longer expanded
		Object.keys(appointmentSubscriptionsRef.current).forEach(patientDocId => {
			if (!expandedPatients.has(patientDocId)) {
				// Unsubscribe and remove
				appointmentSubscriptionsRef.current[patientDocId]?.();
				delete appointmentSubscriptionsRef.current[patientDocId];
				// Also clear appointments for this patient
				setPatientAppointments(prev => {
					const next = { ...prev };
					delete next[patientDocId];
					return next;
				});
			}
		});

		// Set up subscriptions for newly expanded patients
		expandedPatients.forEach(patientDocId => {
			// Skip if already subscribed
			if (appointmentSubscriptionsRef.current[patientDocId]) {
				console.log(`Already subscribed to appointments for patient docId: ${patientDocId}`);
				return;
			}

			const patient = patients.find(p => p.id === patientDocId);
			if (!patient?.patientId) {
				console.warn(`Patient not found or missing patientId for docId: ${patientDocId}`);
				return;
			}

			console.log(`Setting up appointment subscription for patient ${patient.patientId} (docId: ${patientDocId})`);

			try {
				// Get current staff member's userName to match against appointment.doctor field
				const currentStaff = staff.find(s => normalize(s.userName || s.name) === clinicianName);
				const currentStaffUserName = currentStaff?.userName || currentStaff?.name || user?.displayName || '';
				
				// Check if patient is transferred
				const reportAccessDoctors = (patient as any).reportAccessDoctors || [];
				const hasReportAccess = Array.isArray(reportAccessDoctors) && 
					reportAccessDoctors.some((doctor: string) => normalize(doctor) === clinicianName);
				const assignedDoctorNormalized = normalize(patient.assignedDoctor);
				const isPatientTransferred = hasReportAccess && 
					assignedDoctorNormalized !== clinicianName && 
					assignedDoctorNormalized !== '';
				
				// Check if current user is the receiving therapist (assignedDoctor matches AND has report access)
				// This means they received a transfer and should only see transferred sessions
				// The sender (original therapist) has report access but assignedDoctor doesn't match
				const isReceivingTherapist = assignedDoctorNormalized === clinicianName && 
					assignedDoctorNormalized !== '' && 
					hasReportAccess;
				
				// Check if current user is the sender (original therapist)
				// They have report access but assignedDoctor doesn't match them
				const isSender = hasReportAccess && 
					assignedDoctorNormalized !== clinicianName && 
					assignedDoctorNormalized !== '';
				
				// Debug logging
				console.log('Appointment filtering check:', {
					patientId: patient.patientId,
					clinicianName,
					assignedDoctor: patient.assignedDoctor,
					assignedDoctorNormalized,
					'clinicianName === assignedDoctorNormalized': clinicianName === assignedDoctorNormalized,
					hasReportAccess,
					isReceivingTherapist,
					isSender,
					reportAccessDoctors,
					currentStaffUserName,
					'RESULT: willFilter': isReceivingTherapist,
					'RESULT: willShowAll': isSender,
				});
				
				// Query all appointments for the patient (we'll filter after loading)
				// Sender sees all appointments, receiver only sees transferred ones
				const appointmentsQuery = query(
					collection(db, 'appointments'),
					where('patientId', '==', patient.patientId)
				);

				const unsubscribe = onSnapshot(
					appointmentsQuery,
					(snapshot: QuerySnapshot) => {
						console.log(`Appointments snapshot for patient ${patient.patientId} (docId: ${patientDocId}):`, snapshot.size, 'appointments found');
						
						if (snapshot.empty) {
							console.log(`No appointments found for patient ${patient.patientId}`);
							setPatientAppointments(prev => ({
								...prev,
								[patientDocId]: [],
							}));
							return;
						}

						let mapped = snapshot.docs.map(docSnap => {
							const data = docSnap.data();
							return {
								id: docSnap.id,
								appointmentId: data.appointmentId ? String(data.appointmentId) : undefined,
								patientId: data.patientId ? String(data.patientId) : patient.patientId,
								date: data.date ? String(data.date) : '',
								time: data.time ? String(data.time) : '',
								doctor: data.doctor ? String(data.doctor) : '',
								status: data.status ? String(data.status) : 'pending',
								notes: data.notes ? String(data.notes) : undefined,
								isConsultation: data.isConsultation === true,
								packageBillingId: data.packageBillingId ? String(data.packageBillingId) : undefined,
								sessionNumber: data.sessionNumber ? Number(data.sessionNumber) : undefined,
								totalSessions: data.totalSessions ? Number(data.totalSessions) : undefined,
								packageCategory: data.packageCategory ? String(data.packageCategory) : undefined,
								duration: typeof data.duration === 'number' ? data.duration : undefined,
								transferredFrom: data.transferredFrom ? String(data.transferredFrom) : undefined,
							};
						});

						// For session transfers, we need to check the appointment's doctor field, not patient's assignedDoctor
						// because assignedDoctor doesn't change for session transfers
						
						// Check if user is receiver: appointment's doctor matches them AND has transferredFrom
						// Check if user is sender: appointment's transferredFrom matches them OR they're in reportAccess but appointment doctor doesn't match
						
						const hasTransferredAppointments = mapped.some(apt => apt.transferredFrom !== undefined && apt.transferredFrom !== '');
						
						if (hasTransferredAppointments && hasReportAccess) {
							// Check if current user is receiver (appointment doctor matches them and has transferredFrom)
							const isReceiverForAnyAppointment = mapped.some(apt => 
								normalize(apt.doctor) === normalize(currentStaffUserName) && 
								apt.transferredFrom !== undefined && 
								apt.transferredFrom !== ''
							);
							
							// Check if current user is sender (appointment transferredFrom matches them)
							const isSenderForAnyAppointment = mapped.some(apt => 
								normalize(apt.transferredFrom || '') === normalize(currentStaffUserName)
							);
							
							if (isReceiverForAnyAppointment) {
								// Receiver: only show appointments where they are the doctor AND it was transferred
								const beforeFilter = mapped.length;
								mapped = mapped.filter(apt => {
									const doctorMatches = normalize(apt.doctor) === normalize(currentStaffUserName);
									const hasTransferredFrom = apt.transferredFrom !== undefined && apt.transferredFrom !== '';
									const isTransferred = doctorMatches && hasTransferredFrom && !apt.isConsultation;
									return isTransferred;
								});
								console.log(`Filtered appointments for RECEIVER: ${beforeFilter} -> ${mapped.length} (showing only transferred sessions)`);
							} else if (isSenderForAnyAppointment) {
								// Sender: show all appointments (they see everything)
								console.log(`Showing all ${mapped.length} appointments for SENDER (original therapist) - NO FILTERING`);
							} else {
								// Has report access but not clearly sender or receiver - show all
								console.log(`Showing all ${mapped.length} appointments (has report access but unclear role)`);
							}
						} else {
							// No transferred appointments or no report access - show all
							console.log(`Showing all ${mapped.length} appointments (no transfers or no report access)`);
						}

						console.log(`Mapped ${mapped.length} appointments for patient ${patient.patientId}:`, mapped);

						// Sort: consultation first, then appointments with dates (ascending), then appointments without dates at bottom
						mapped.sort((a, b) => {
							// Consultation appointments always come first
							if (a.isConsultation && !b.isConsultation) return -1;
							if (!a.isConsultation && b.isConsultation) return 1;
							
							// Check if appointments have dates
							const aHasDate = a.date && a.date.trim() !== '';
							const bHasDate = b.date && b.date.trim() !== '';
							
							// Appointments with dates come before appointments without dates
							if (aHasDate && !bHasDate) return -1;
							if (!aHasDate && bHasDate) return 1;
							
							// If both have dates, sort by date then time (ascending)
							if (aHasDate && bHasDate) {
								const dateCompare = a.date.localeCompare(b.date);
								if (dateCompare !== 0) return dateCompare;
								return (a.time || '').localeCompare(b.time || '');
							}
							
							// If both don't have dates, maintain original order (or sort by packageCategory if needed)
							return 0;
						});

						setPatientAppointments(prev => ({
							...prev,
							[patientDocId]: mapped,
						}));
					},
					error => {
						console.error(`Failed to load appointments for patient ${patient.patientId} (docId: ${patientDocId}):`, error);
						setPatientAppointments(prev => ({
							...prev,
							[patientDocId]: [],
						}));
					}
				);

				// Store unsubscribe function in ref
				appointmentSubscriptionsRef.current[patientDocId] = unsubscribe;
			} catch (error) {
				console.error(`Error setting up appointment query for patient ${patient.patientId} (docId: ${patientDocId}):`, error);
			}
		});

		// Cleanup function
		return () => {
			// Cleanup subscriptions when component unmounts
			Object.values(appointmentSubscriptionsRef.current).forEach(unsubscribe => unsubscribe());
			appointmentSubscriptionsRef.current = {};
		};
	}, [expandedPatients, patients]);

	const formatDateLabel = (value: string) => {
		if (!value) return '—';
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) return value;
		return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
	};

	const formatTimeLabel = (time: string) => {
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
	};

	const handleViewVersionHistory = async () => {
		setShowVersionHistory(true);
		await loadVersionHistory();
	};

	const handleDeleteVersion = async (version: typeof versionHistory[0]) => {
		if (!confirm(`Are you sure you want to delete Report #${version.version}? This action cannot be undone.`)) {
			return;
		}

		try {
			const versionRef = doc(db, 'reportVersions', version.id);
			await deleteDoc(versionRef);
			
			// Reload report history
			await loadVersionHistory();
			
			alert(`Report #${version.version} has been deleted successfully.`);
		} catch (error) {
			console.error('Failed to delete report', error);
			alert('Failed to delete report. Please try again.');
		}
	};

	const handleRestoreVersion = async (version: typeof versionHistory[0]) => {
		if (!selectedPatient?.id || !confirm(`Are you sure you want to load Report #${version.version}? This will replace the current report data and save the current state as a new report.`)) {
			return;
		}

		setSaving(true);
		try {
			const patientRef = doc(db, 'patients', selectedPatient.id);

			// Create a report snapshot of current data before loading previous report
			const currentReportData: Partial<PatientRecordFull> = {
				complaints: selectedPatient.complaints,
				presentHistory: selectedPatient.presentHistory,
				pastHistory: selectedPatient.pastHistory,
				med_xray: selectedPatient.med_xray,
				med_mri: selectedPatient.med_mri,
				med_report: selectedPatient.med_report,
				med_ct: selectedPatient.med_ct,
				surgicalHistory: selectedPatient.surgicalHistory,
				per_smoking: selectedPatient.per_smoking,
				per_drinking: selectedPatient.per_drinking,
				per_alcohol: selectedPatient.per_alcohol,
				per_drugs: selectedPatient.per_drugs,
				drugsText: selectedPatient.drugsText,
				sleepCycle: selectedPatient.sleepCycle,
				hydration: selectedPatient.hydration,
				nutrition: selectedPatient.nutrition,
				siteSide: selectedPatient.siteSide,
				onset: selectedPatient.onset,
				duration: selectedPatient.duration,
				natureOfInjury: selectedPatient.natureOfInjury,
				typeOfPain: selectedPatient.typeOfPain,
				vasScale: selectedPatient.vasScale,
				aggravatingFactor: selectedPatient.aggravatingFactor,
				relievingFactor: selectedPatient.relievingFactor,
				rom: selectedPatient.rom,
				treatmentProvided: selectedPatient.treatmentProvided,
				progressNotes: selectedPatient.progressNotes,
				physioName: selectedPatient.physioName,
				physioId: selectedPatient.physioId,
				dateOfConsultation: selectedPatient.dateOfConsultation,
				referredBy: selectedPatient.referredBy,
				chiefComplaint: selectedPatient.chiefComplaint,
				onsetType: selectedPatient.onsetType,
				mechanismOfInjury: selectedPatient.mechanismOfInjury,
				painType: selectedPatient.painType,
				painIntensity: selectedPatient.painIntensity,
				clinicalDiagnosis: selectedPatient.clinicalDiagnosis,
				treatmentPlan: selectedPatient.treatmentPlan,
				followUpVisits: selectedPatient.followUpVisits,
				currentPainStatus: selectedPatient.currentPainStatus,
				currentRom: selectedPatient.currentRom,
				currentStrength: selectedPatient.currentStrength,
				currentFunctionalAbility: selectedPatient.currentFunctionalAbility,
				complianceWithHEP: selectedPatient.complianceWithHEP,
				recommendations: selectedPatient.recommendations,
				physiotherapistRemarks: selectedPatient.physiotherapistRemarks,
				built: selectedPatient.built,
				posture: selectedPatient.posture,
				gaitAnalysis: selectedPatient.gaitAnalysis,
				mobilityAids: selectedPatient.mobilityAids,
				localObservation: selectedPatient.localObservation,
				swelling: selectedPatient.swelling,
				muscleWasting: selectedPatient.muscleWasting,
				postureManualNotes: selectedPatient.postureManualNotes,
				postureFileName: selectedPatient.postureFileName,
				postureFileData: selectedPatient.postureFileData,
				gaitManualNotes: selectedPatient.gaitManualNotes,
				gaitFileName: selectedPatient.gaitFileName,
				gaitFileData: selectedPatient.gaitFileData,
				tenderness: selectedPatient.tenderness,
				warmth: selectedPatient.warmth,
				scar: selectedPatient.scar,
				crepitus: selectedPatient.crepitus,
				odema: selectedPatient.odema,
				mmt: selectedPatient.mmt,
				specialTest: selectedPatient.specialTest,
				differentialDiagnosis: selectedPatient.differentialDiagnosis,
				finalDiagnosis: selectedPatient.finalDiagnosis,
				shortTermGoals: selectedPatient.shortTermGoals,
				longTermGoals: selectedPatient.longTermGoals,
				rehabProtocol: selectedPatient.rehabProtocol,
				advice: selectedPatient.advice,
				managementRemarks: selectedPatient.managementRemarks,
				nextFollowUpDate: selectedPatient.nextFollowUpDate,
				nextFollowUpTime: selectedPatient.nextFollowUpTime,
			};

			// Check if there's current report data to save as previous report
			const hasCurrentData = Object.values(currentReportData).some(val => 
				val !== undefined && val !== null && val !== '' && 
				!(Array.isArray(val) && val.length === 0) &&
				!(typeof val === 'object' && Object.keys(val).length === 0)
			);

			// Save current state as report before loading previous report
			if (hasCurrentData) {
				const versionsQuery = query(
					collection(db, 'reportVersions'),
					where('patientId', '==', selectedPatient.patientId),
					orderBy('version', 'desc')
				);
				const versionsSnapshot = await getDocs(versionsQuery);
				const nextVersion = versionsSnapshot.docs.length > 0 
					? (versionsSnapshot.docs[0].data().version as number) + 1 
					: 1;

				await addDoc(collection(db, 'reportVersions'), {
					patientId: selectedPatient.patientId,
					patientName: selectedPatient.name,
					version: nextVersion,
					reportData: removeUndefined(currentReportData),
					createdBy: user?.displayName || user?.email || 'Unknown',
					createdById: user?.uid || '',
					createdAt: serverTimestamp(),
					restoredFrom: version.version, // Track that this was created from a restore
				});
			}

			// Load the version data into the form
			setFormData(version.data);
			
			// Update the patient document with restored data
			const reportData: Record<string, any> = {
				...version.data,
				updatedAt: serverTimestamp(),
			};
			await updateDoc(patientRef, reportData);

			// Update selectedPatient state
			setSelectedPatient(prev => prev ? { ...prev, ...reportData } : null);

			// Reload report history to show the new report
			await loadVersionHistory();

			alert(`Report #${version.version} has been loaded successfully.`);
		} catch (error) {
			console.error('Failed to load report', error);
			alert('Failed to load report. Please try again.');
		} finally {
			setSaving(false);
		}
	};

	const formatMmtLabel = (motion: string) => {
		const direct = MOTION_TO_MMT[motion];
		if (direct) return direct;
		let label = motion;
		const replacements: Array<[RegExp, string]> = [
			[/Flexion/gi, 'Flexors'],
			[/Extension/gi, 'Extensors'],
			[/Abduction/gi, 'Abductors'],
			[/Adduction/gi, 'Adductors'],
			[/Dorsiflexion/gi, 'Dorsiflexors'],
			[/Plantarflexion/gi, 'Plantarflexors'],
		];
		replacements.forEach(([regex, replacement]) => {
			label = label.replace(regex, replacement);
		});
		return label;
	};

	const renderRomTable = (joint: string, data: any) => {
		if (!ROM_HAS_SIDE[joint] && joint !== 'Neck') {
			return (
				<div key={joint} className="relative mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
					<button
						type="button"
						onClick={() => handleRemoveRomJoint(joint)}
						className="absolute right-3 top-3 text-slate-400 transition hover:text-rose-500"
						aria-label={`Remove ${joint}`}
					>
						<i className="fas fa-times" />
					</button>
					<h6 className="mb-3 text-sm font-semibold text-sky-600">{joint}</h6>
					<table className="min-w-full divide-y divide-slate-200 border border-slate-300 text-left text-sm">
						<thead className="bg-slate-100">
							<tr>
								<th className="px-3 py-2 font-semibold text-slate-700">Motion</th>
								<th className="px-3 py-2 font-semibold text-slate-700">Value</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-200 bg-white">
							{ROM_MOTIONS[joint].map(({ motion }) => (
								<tr key={motion}>
									<td className="px-3 py-2 text-slate-700">{motion}</td>
									<td className="px-3 py-2">
										<input
											type="text"
											value={data?.[motion] || ''}
											onChange={e => handleRomChange(joint, motion, 'none', e.target.value)}
											className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											placeholder="Enter value"
											style={{ color: '#1e293b' }}
										/>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			);
		}

		// Special handling for Neck with Lateral Flexion Left/Right
		if (joint === 'Neck') {
			return (
				<div key={joint} className="relative mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
					<button
						type="button"
						onClick={() => handleRemoveRomJoint(joint)}
						className="absolute right-3 top-3 text-slate-400 transition hover:text-rose-500"
						aria-label="Remove Neck"
					>
						<i className="fas fa-times" />
					</button>
					<h6 className="mb-3 text-sm font-semibold text-sky-600">{joint}</h6>
					<table className="min-w-full divide-y divide-slate-200 border border-slate-300 text-left text-sm">
						<thead className="bg-slate-100">
							<tr>
								<th className="px-3 py-2 font-semibold text-slate-700">Motion</th>
								<th className="px-3 py-2 font-semibold text-slate-700">Value</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-200 bg-white">
							{ROM_MOTIONS[joint].map(({ motion }) => {
								if (motion.includes('Lateral Flexion')) {
									const side = motion.includes('Left') ? 'left' : 'right';
									const baseMotion = 'Lateral Flexion';
									return (
										<tr key={motion}>
											<td className="px-3 py-2 text-slate-700">{motion}</td>
											<td className="px-3 py-2">
												<input
													type="text"
													value={data?.[side]?.[baseMotion] || ''}
													onChange={e => handleRomChange(joint, baseMotion, side, e.target.value)}
													className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
													placeholder="Enter value"
												/>
											</td>
										</tr>
									);
								} else {
									return (
										<tr key={motion}>
											<td className="px-3 py-2 text-slate-700">{motion}</td>
											<td className="px-3 py-2">
												<input
													type="text"
													value={data?.[motion] || ''}
													onChange={e => handleRomChange(joint, motion, 'none', e.target.value)}
													className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
													placeholder="Enter value"
												/>
											</td>
										</tr>
									);
								}
							})}
						</tbody>
					</table>
				</div>
			);
		}

		return (
			<div key={joint} className="relative mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
				<button
					type="button"
					onClick={() => handleRemoveRomJoint(joint)}
					className="absolute right-3 top-3 text-slate-400 transition hover:text-rose-500"
					aria-label={`Remove ${joint}`}
				>
					<i className="fas fa-times" />
				</button>
				<h6 className="mb-3 text-sm font-semibold text-sky-600">{joint}</h6>
				<table className="min-w-full divide-y divide-slate-200 border border-slate-300 text-left text-sm">
					<thead className="bg-slate-100">
						<tr>
							<th colSpan={2} className="px-3 py-2 text-center font-semibold text-slate-700">
								Left
							</th>
							<th colSpan={2} className="px-3 py-2 text-center font-semibold text-slate-700">
								Right
							</th>
						</tr>
						<tr>
							<th className="px-3 py-2 font-semibold text-slate-700">Motion</th>
							<th className="px-3 py-2 font-semibold text-slate-700">Value</th>
							<th className="px-3 py-2 font-semibold text-slate-700">Motion</th>
							<th className="px-3 py-2 font-semibold text-slate-700">Value</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-200 bg-white">
						{ROM_MOTIONS[joint].map(({ motion }) => (
							<tr key={motion}>
								<td className="px-3 py-2 text-slate-700">{motion}</td>
								<td className="px-3 py-2">
									<input
										type="text"
										value={data?.left?.[motion] || ''}
										onChange={e => handleRomChange(joint, motion, 'left', e.target.value)}
										className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										placeholder="Left"
										style={{ color: '#1e293b' }}
									/>
								</td>
								<td className="px-3 py-2 text-slate-700">{motion}</td>
								<td className="px-3 py-2">
									<input
										type="text"
										value={data?.right?.[motion] || ''}
										onChange={e => handleRomChange(joint, motion, 'right', e.target.value)}
										className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										placeholder="Right"
										style={{ color: '#1e293b' }}
									/>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		);
	};

	const renderMmtTable = (joint: string, data: any) => {
		const motions = ROM_MOTIONS[joint] || [];

		if (!ROM_HAS_SIDE[joint]) {
			return (
				<div key={joint} className="relative mb-6 rounded-lg border border-violet-200 bg-violet-50/60 p-4">
					<button
						type="button"
						onClick={() => handleRemoveMmtJoint(joint)}
						className="absolute right-3 top-3 text-slate-400 transition hover:text-rose-500"
						aria-label={`Remove ${joint} MMT`}
					>
						<i className="fas fa-times" />
					</button>
					<h6 className="mb-3 text-sm font-semibold text-violet-700">{joint}</h6>
					<table className="min-w-full divide-y divide-slate-200 border border-slate-300 text-left text-sm">
						<thead className="bg-slate-100">
							<tr>
								<th className="px-3 py-2 font-semibold text-slate-700">Muscle Group</th>
								<th className="px-3 py-2 font-semibold text-slate-700">Grade</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-200 bg-white">
							{motions.map(({ motion }) => {
								const label = formatMmtLabel(motion);
								return (
									<tr key={motion}>
										<td className="px-3 py-2 text-slate-700">{label}</td>
										<td className="px-3 py-2">
											<input
												type="text"
												value={data?.[motion] || ''}
												onChange={e => handleMmtChange(joint, motion, 'none', e.target.value)}
												className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
												placeholder="Grade"
												style={{ color: '#1e293b' }}
											/>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			);
		}

		return (
			<div key={joint} className="relative mb-6 rounded-lg border border-violet-200 bg-violet-50/60 p-4">
				<button
					type="button"
					onClick={() => handleRemoveMmtJoint(joint)}
					className="absolute right-3 top-3 text-slate-400 transition hover:text-rose-500"
					aria-label={`Remove ${joint} MMT`}
				>
					<i className="fas fa-times" />
				</button>
				<h6 className="mb-3 text-sm font-semibold text-violet-700">{joint}</h6>
				<table className="min-w-full divide-y divide-slate-200 border border-slate-300 text-left text-sm">
					<thead className="bg-slate-100">
						<tr>
							<th colSpan={2} className="px-3 py-2 text-center font-semibold text-slate-700">
								Left
							</th>
							<th colSpan={2} className="px-3 py-2 text-center font-semibold text-slate-700">
								Right
							</th>
						</tr>
						<tr>
							<th className="px-3 py-2 font-semibold text-slate-700">Muscle Group</th>
							<th className="px-3 py-2 font-semibold text-slate-700">Grade</th>
							<th className="px-3 py-2 font-semibold text-slate-700">Muscle Group</th>
							<th className="px-3 py-2 font-semibold text-slate-700">Grade</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-200 bg-white">
						{motions.map(({ motion }) => {
							const label = formatMmtLabel(motion);
							return (
								<tr key={motion}>
									<td className="px-3 py-2 text-slate-700">{label}</td>
									<td className="px-3 py-2">
										<input
											type="text"
											value={data?.left?.[motion] || ''}
											onChange={e => handleMmtChange(joint, motion, 'left', e.target.value)}
											className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
											placeholder="Grade"
										/>
									</td>
									<td className="px-3 py-2 text-slate-700">{label}</td>
									<td className="px-3 py-2">
										<input
											type="text"
											value={data?.right?.[motion] || ''}
											onChange={e => handleMmtChange(joint, motion, 'right', e.target.value)}
											className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
											placeholder="Grade"
										/>
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		);
	};

	if (!selectedPatient) {
		return (
			<div className="min-h-svh bg-slate-50 px-6 py-10">
				<div className="mx-auto max-w-6xl">
					<header className="mb-8">
						<p className="text-sm font-semibold uppercase tracking-wide text-sky-600">Clinical Team</p>
						<h1 className="mt-1 text-3xl font-semibold text-slate-900">Appointments</h1>
						<p className="mt-2 text-sm text-slate-600">
							Select a patient to manage their appointments and treatment reports.
						</p>
					</header>

					<section className="section-card">
								<label className="block text-sm font-medium text-slate-700">Search patients</label>
								<input
									type="search"
									value={searchTerm}
									onChange={e => setSearchTerm(e.target.value)}
									className="input-base mt-2"
									placeholder="Search by name, ID, or phone"
								/>
					</section>

					<section className="section-card">
						<header className="mb-4">
							<h2 className="text-lg font-semibold text-slate-900">Patient queue</h2>
							<p className="text-sm text-slate-500">
								{filteredPatients.length} patient{filteredPatients.length === 1 ? '' : 's'}
							</p>
						</header>

						{loading ? (
							<div className="py-12 text-center text-sm text-slate-500">
								<div className="loading-spinner" aria-hidden="true" />
								<span className="ml-3 align-middle">Loading patients…</span>
							</div>
						) : filteredPatients.length === 0 ? (
							<div className="py-12 text-center text-sm text-slate-500">
								<p className="font-medium text-slate-700">No patients found.</p>
								<p className="mt-1">Try adjusting your search or register a new patient.</p>
							</div>
						) : (
							<div className="space-y-2">
								{filteredPatients.map(patient => {
									const isExpanded = expandedPatients.has(patient.id);
									
									// Check if patient has been transferred
									// A patient is considered transferred if:
									// 1. They have report access (meaning they were transferred)
									// 2. Their assignedDoctor doesn't match the current clinician
									const reportAccessDoctors = (patient as any).reportAccessDoctors || [];
									const hasReportAccess = Array.isArray(reportAccessDoctors) && 
										reportAccessDoctors.some((doctor: string) => normalize(doctor) === clinicianName);
									const assignedDoctorNormalized = normalize(patient.assignedDoctor);
									const isTransferred = hasReportAccess && 
										assignedDoctorNormalized !== clinicianName && 
										assignedDoctorNormalized !== '';
									
									return (
										<div
											key={patient.id}
											className="rounded-lg border border-slate-200 bg-white transition-all"
										>
											{/* Header Row - Clickable */}
											<div className="flex items-center gap-2 px-4 py-3 hover:bg-slate-50 transition-colors">
												<button
													type="button"
													onClick={() => togglePatientExpanded(patient.id)}
													className="flex items-center gap-4 flex-1 min-w-0 text-left"
												>
													<div className="flex-shrink-0">
														<i
															className={`fas fa-chevron-${isExpanded ? 'down' : 'right'} text-xs text-slate-400 transition-transform`}
															aria-hidden="true"
														/>
													</div>
													<div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0">
														<div className="min-w-0">
															<p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Patient ID</p>
															<p className="text-sm font-medium text-slate-800 truncate mt-0.5">{patient.patientId}</p>
														</div>
														<div className="min-w-0">
															<p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Name</p>
															<p className="text-sm text-slate-700 truncate mt-0.5">{patient.name}</p>
														</div>
													</div>
													{patient.totalSessionsRequired && typeof patient.totalSessionsRequired === 'number' && (
														<div className="flex-shrink-0 w-48">
															<div className="flex items-center justify-between mb-1">
																<span className="text-xs font-medium text-slate-600">Sessions</span>
																<span className="text-xs font-semibold text-slate-700">
																	{(() => {
																		const total = patient.totalSessionsRequired;
																		const remaining = typeof patient.remainingSessions === 'number' ? patient.remainingSessions : total;
																		const completed = total - remaining;
																		return `${completed} / ${total}`;
																	})()}
																</span>
															</div>
															<div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
																<div
																	className="bg-gradient-to-r from-sky-500 to-blue-600 h-2 rounded-full transition-all duration-300"
																	style={{
																		width: `${(() => {
																			const total = patient.totalSessionsRequired;
																			const remaining = typeof patient.remainingSessions === 'number' ? patient.remainingSessions : total;
																			const completed = total - remaining;
																			return total > 0 ? Math.min((completed / total) * 100, 100) : 0;
																		})()}%`
																	}}
																/>
															</div>
														</div>
													)}
												</button>
														{patient.patientId && (
													<div className="flex items-center gap-2 flex-shrink-0">
															<button
																type="button"
															onClick={(e) => {
																e.stopPropagation();
																	console.log('Report button clicked for patient:', patient.patientId);
																	handleOpenReportModal(patient.patientId);
																}}
															className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-sky-500 hover:bg-sky-50 hover:text-sky-700 focus-visible:outline-none"
															>
																<i className="fas fa-file-medical text-xs" aria-hidden="true" />
															View Report
															</button>
														<div className="relative" data-dropdown-id={`patient-${patient.id}`}>
															<button
																type="button"
																onClick={(e) => {
																	e.stopPropagation();
																	setOpenDropdownId(openDropdownId === `patient-${patient.id}` ? null : `patient-${patient.id}`);
																}}
																className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none"
																aria-label="More options"
															>
																<i className="fas fa-ellipsis-v text-xs" aria-hidden="true" />
															</button>
															{openDropdownId === `patient-${patient.id}` && (
																<div className="absolute right-0 top-full z-[9999] mt-1 w-48 rounded-lg border border-slate-200 bg-white shadow-xl">
																	<div className="py-1">
																		<button
																			type="button"
																			onClick={(e) => {
																				e.stopPropagation();
																				setOpenDropdownId(null);
																				console.log('Report button clicked for patient:', patient.patientId);
																				handleOpenReportModal(patient.patientId);
																			}}
																			className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-700 transition hover:bg-sky-50 hover:text-sky-700"
																		>
																			<i className="fas fa-file-medical text-xs" aria-hidden="true" />
																			View Report
																		</button>
																		{!patient.totalSessionsRequired && (
																			<button
																				type="button"
																				onClick={(e) => {
																					e.stopPropagation();
																					setOpenDropdownId(null);
																					handleOpenPackageModal(patient);
																				}}
																				className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-700 transition hover:bg-emerald-50 hover:text-emerald-700"
																			>
																				<i className="fas fa-wallet text-xs" aria-hidden="true" />
																				Setup Package
															</button>
														)}
																		<button
																			type="button"
																			onClick={(e) => {
																				e.stopPropagation();
																				e.preventDefault();
																				const patientId = patient.patientId;
																				const patientName = patient.name;
																				console.log('Opening Analytics modal for patient:', patientId, patientName);
																				setAnalyticsModalPatientId(patientId);
																				setAnalyticsModalPatientName(patientName);
																				setShowAnalyticsModal(true);
																				setOpenDropdownId(null);
																				console.log('Analytics modal state set - showAnalyticsModal: true, patientId:', patientId);
																			}}
																			className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-700 transition hover:bg-indigo-50 hover:text-indigo-700"
																		>
																			<i className="fas fa-chart-line text-xs" aria-hidden="true" />
																			Analytics
																		</button>
																		<button
																			type="button"
																			onClick={(e) => {
																				e.stopPropagation();
																				setOpenDropdownId(null);
																				handleOpenPatientTransferDialog(patient);
																			}}
																			className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-700 transition hover:bg-purple-50 hover:text-purple-700"
																		>
																			<i className="fas fa-exchange-alt text-xs" aria-hidden="true" />
																			Transfer Patient
																		</button>
													</div>
																</div>
														)}
													</div>
													</div>
												)}
											</div>
											
											{/* Expanded Content */}
											{isExpanded && (
												<div className="border-t border-slate-200 px-4 py-4 bg-slate-50">
													{/* Appointments Section */}
													<div>
														<p className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-3">
															Appointments
															{patientAppointments[patient.id] !== undefined && (
																<span className="ml-2 text-xs font-normal text-slate-500">
																	({patientAppointments[patient.id]?.length || 0})
																</span>
															)}
														</p>
														{patientAppointments[patient.id] === undefined ? (
															<div className="flex items-center gap-2 py-2">
																<div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" />
																<p className="text-sm text-slate-500">Loading appointments...</p>
															</div>
														) : patientAppointments[patient.id] && patientAppointments[patient.id].length > 0 ? (
															<div className="space-y-2">
																{patientAppointments[patient.id].map(appointment => {
																	// Get packageCategory from appointment or find it from other appointments in the same package
																	let displayCategory = appointment.packageCategory;
																	if (!displayCategory && appointment.packageBillingId) {
																		// Find category from other appointments in the same package
																		const packageAppointment = patientAppointments[patient.id].find(
																			apt => apt.packageBillingId === appointment.packageBillingId && apt.packageCategory
																		);
																		displayCategory = packageAppointment?.packageCategory;
																	}

																	// Check if this specific appointment has been transferred
																	// An appointment is transferred if:
																	// 1. It's not a consultation (consultations shouldn't show transferred status)
																	// 2. The appointment's doctor doesn't match the current clinician
																	// 3. The patient has report access (meaning current clinician was original therapist)
																	// 4. The appointment doctor is not empty
																	const appointmentDoctorNormalized = normalize(appointment.doctor);
																	const appointmentIsTransferred = !appointment.isConsultation && 
																		hasReportAccess && 
																		appointmentDoctorNormalized !== clinicianName && 
																		appointmentDoctorNormalized !== '';

																	return (
																		<div
																			key={appointment.id}
																			className="rounded-lg border border-slate-200 bg-white p-3 hover:bg-slate-50 transition-colors"
																		>
																			<div className="flex items-start justify-between gap-2">
																				<div className="flex-1 min-w-0">
																					<div className="flex items-center gap-2 mb-1 flex-wrap">
																						{appointment.isConsultation && (
																							<span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
																								Consultation
																							</span>
																						)}
																						{displayCategory && !appointment.isConsultation && (
																							<span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
																								displayCategory === 'strength' ? 'bg-orange-100 text-orange-700' :
																								displayCategory === 'physio' ? 'bg-green-100 text-green-700' :
																								'bg-purple-100 text-purple-700'
																							}`}>
																								{displayCategory === 'strength' ? 'S & C' :
																								 displayCategory === 'physio' ? 'Physiotherapy' :
																								 'Individual Treatment'}
																							</span>
																						)}
																						<span className="text-sm font-medium text-slate-800">
																							{formatDateLabel(appointment.date)}
																						</span>
																						<span className="text-xs text-slate-500">•</span>
																						<span className="text-sm text-slate-600">
																							{formatTimeLabel(appointment.time)}
																						</span>
																						{(() => {
																							// Show "Transferred" instead of status if appointment is transferred
																							if (appointmentIsTransferred) {
																								return (
																									<>
																										<span className="text-xs text-slate-500">•</span>
																										<span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700 border border-purple-200">
																											<i className="fas fa-exchange-alt text-xs mr-1" aria-hidden="true" />
																											Transferred
																										</span>
																									</>
																								);
																							}
																							
																							const calculatedStatus = calculateAppointmentStatus({
																								status: appointment.status,
																								date: appointment.date,
																								time: appointment.time,
																								duration: appointment.duration,
																							});
																							return calculatedStatus && (
																								<>
																									<span className="text-xs text-slate-500">•</span>
																									<span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
																										calculatedStatus === 'completed' ? 'bg-emerald-100 text-emerald-700' :
																										calculatedStatus === 'ongoing' ? 'bg-blue-100 text-blue-700' :
																										calculatedStatus === 'pending' ? 'bg-amber-100 text-amber-700' :
																										calculatedStatus === 'cancelled' ? 'bg-rose-100 text-rose-700' :
																										'bg-slate-100 text-slate-700'
																									}`}>
																										{calculatedStatus.charAt(0).toUpperCase() + calculatedStatus.slice(1)}
																									</span>
																								</>
																							);
																						})()}
																					</div>
																					{appointment.notes && (
																						<p className="text-xs text-slate-600 mt-1 line-clamp-2">
																							{appointment.notes}
																						</p>
																					)}
																				</div>
																					{patient.patientId && (
																					<div className="flex items-center gap-2 flex-shrink-0">
																						{!appointment.isConsultation && (
																							appointment.date && appointment.time && appointment.date.trim() !== '' && appointment.time.trim() !== '' ? (
																								<button
																									type="button"
																									disabled
																									className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-500 cursor-not-allowed"
																								>
																									<i className="fas fa-check-circle text-xs" aria-hidden="true" />
																									Booked
																								</button>
																							) : (
																								<button
																									type="button"
																									onClick={(e) => {
																										e.stopPropagation();
																										console.log('Book Appointment button clicked for appointment:', appointment.id, 'patient:', patient.patientId);
																										handleOpenBookingModal(patient, appointment.id ? {
																											patientId: appointment.patientId || patient.patientId,
																											patient: patient.name,
																											doctor: appointment.doctor,
																											date: appointment.date,
																											time: appointment.time,
																											status: appointment.status as 'pending' | 'ongoing' | 'completed' | 'cancelled',
																											notes: appointment.notes,
																											createdAt: new Date().toISOString(),
																											isConsultation: appointment.isConsultation,
																										} : undefined);
																									}}
																									className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-green-500 hover:bg-green-50 hover:text-green-700 focus-visible:outline-none"
																								>
																									<i className="fas fa-calendar-plus text-xs" aria-hidden="true" />
																									Book Appointment
																								</button>
																							)
																						)}
																						{!appointment.packageBillingId && !patient.totalSessionsRequired && (
																							<button
																								type="button"
																								onClick={(e) => {
																									e.stopPropagation();
																									console.log('Select Package button clicked for appointment:', appointment.id, 'patient:', patient.patientId);
																									handleOpenPackageModal(patient);
																								}}
																								className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-700 focus-visible:outline-none"
																							>
																								<i className="fas fa-box text-xs" aria-hidden="true" />
																								Select Package
																							</button>
																						)}
																						<button
																							type="button"
																							onClick={(e) => {
																								e.stopPropagation();
																								console.log('Report button clicked for appointment:', appointment.id, 'patient:', patient.patientId);
																								handleOpenReportModal(patient.patientId);
																							}}
																							className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-sky-500 hover:bg-sky-50 hover:text-sky-700 focus-visible:outline-none"
																						>
																							<i className="fas fa-file-medical text-xs" aria-hidden="true" />
																							View Report
																						</button>
																						<div className="relative" data-dropdown-id={`appointment-${appointment.id}`}>
																							<button
																								type="button"
																								onClick={(e) => {
																									e.stopPropagation();
																									const calculatedStatus = calculateAppointmentStatus({
																										status: appointment.status,
																										date: appointment.date,
																										time: appointment.time,
																										duration: appointment.duration,
																									});
																									const isBooked = appointment.id && appointment.date && appointment.time && appointment.date.trim() !== '' && appointment.time.trim() !== '';
																									const isNotCompleted = calculatedStatus !== 'completed';
																									const hasDropdownItems = isBooked && isNotCompleted;
																									
																									if (hasDropdownItems) {
																										setOpenDropdownId(openDropdownId === `appointment-${appointment.id}` ? null : `appointment-${appointment.id}`);
																									}
																								}}
																								className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none"
																								aria-label="More options"
																							>
																								<i className="fas fa-ellipsis-v text-xs" aria-hidden="true" />
																							</button>
																							{openDropdownId === `appointment-${appointment.id}` && (() => {
																								const calculatedStatus = calculateAppointmentStatus({
																									status: appointment.status,
																									date: appointment.date,
																									time: appointment.time,
																									duration: appointment.duration,
																								});
																								const isBooked = appointment.id && appointment.date && appointment.time && appointment.date.trim() !== '' && appointment.time.trim() !== '';
																								const isNotCompleted = calculatedStatus !== 'completed';
																								const hasDropdownItems = isBooked && isNotCompleted;
																								
																								if (!hasDropdownItems) return null;
																								
																								return (
																									<div className="absolute right-0 top-full z-[9999] mt-1 w-48 rounded-lg border border-slate-200 bg-white shadow-xl">
																										<div className="py-1">
																											<button
																												type="button"
																												onClick={(e) => {
																													e.stopPropagation();
																													setOpenDropdownId(null);
																													handleOpenTransferDialog({
																														id: appointment.id!,
																														appointmentId: appointment.appointmentId,
																														patient: patient.name,
																														patientId: patient.patientId,
																														doctor: appointment.doctor,
																														date: appointment.date,
																														time: appointment.time,
																													});
																												}}
																												className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-700 transition hover:bg-purple-50 hover:text-purple-700"
																											>
																												<i className="fas fa-exchange-alt text-xs" aria-hidden="true" />
																												Transfer Session
																											</button>
																											<button
																												type="button"
																												onClick={(e) => {
																													e.stopPropagation();
																													setOpenDropdownId(null);
																													handleOpenRescheduleDialog({
																														id: appointment.id!,
																														patient: patient.name,
																														doctor: appointment.doctor,
																														date: appointment.date,
																														time: appointment.time,
																													});
																												}}
																												className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-700 transition hover:bg-amber-50 hover:text-amber-700"
																											>
																												<i className="fas fa-calendar-alt text-xs" aria-hidden="true" />
																												Reschedule
																											</button>
																										</div>
																									</div>
																								);
																							})()}
																						</div>
																					</div>
																				)}
																			</div>
																		</div>
																	);
																})}
															</div>
														) : (
															<p className="text-sm text-slate-500 italic">No appointments found for this patient.</p>
														)}
													</div>
												</div>
											)}
										</div>
									);
								})}
							</div>
						)}
					</section>
				</div>

				{/* Report Modal - Always available */}
				<EditReportModal
					isOpen={showReportModal}
					patientId={reportModalPatientId}
					initialTab="report"
					onClose={handleCloseReportModal}
					editable={true}
				/>

				{/* Booking Modal */}
				<AppointmentBookingModal
					isOpen={showBookingModal}
					onClose={handleCloseBookingModal}
					patient={bookingModalPatient ? {
						id: bookingModalPatient.id,
						patientId: bookingModalPatient.patientId,
						name: bookingModalPatient.name,
						email: bookingModalPatient.email,
						phone: bookingModalPatient.phone,
					} : null}
					staff={staff.map(s => ({
						id: s.id,
						name: s.name,
						role: s.role,
						availability: s.availability,
						dateSpecificAvailability: s.dateSpecificAvailability,
					}))}
					initialAppointment={bookingModalAppointment}
					onSuccess={() => {
						// Refresh appointments or show success message
					}}
					allowConsultation={false}
					defaultClinician={user?.displayName || undefined}
					hideClinicianSelection={true}
					appointments={Object.values(patientAppointments).flat().map(apt => ({
						patientId: apt.patientId || bookingModalPatient?.patientId,
						doctor: apt.doctor,
						date: apt.date,
						time: apt.time,
						status: apt.status,
						isConsultation: apt.isConsultation,
					}))}
				/>

				{/* Reschedule Dialog */}
				<RescheduleDialog
					isOpen={showRescheduleDialog}
					appointment={rescheduleAppointment}
					onClose={handleCloseRescheduleDialog}
					onConfirm={handleConfirmReschedule}
					allAppointments={allAppointmentsForReschedule}
					staff={staff.map(s => ({
						id: s.id,
						name: s.name,
						availability: s.availability,
						dateSpecificAvailability: s.dateSpecificAvailability,
					}))}
				/>

				{/* Transfer Session Dialog */}
				<TransferSessionDialog
					isOpen={showTransferDialog}
					appointment={transferAppointment}
					onClose={handleCloseTransferDialog}
					onConfirm={handleConfirmTransfer}
					allAppointments={allAppointmentsForTransfer}
					staff={staff.map(s => ({
						id: s.id,
						name: s.name,
						userName: s.userName,
						role: s.role,
						availability: s.availability,
						dateSpecificAvailability: s.dateSpecificAvailability,
					}))}
				/>

				{/* Patient Transfer Dialog */}
				{showPatientTransferDialog && patientTransferPatient && (
					<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
						<div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl">
							<div className="p-6">
								<div className="mb-4 flex items-center justify-between">
									<h2 className="text-xl font-semibold text-slate-900">Transfer Patient</h2>
									<button
										type="button"
										onClick={handleClosePatientTransferDialog}
										className="text-slate-400 hover:text-slate-600"
										aria-label="Close"
									>
										<i className="fas fa-times" />
									</button>
								</div>

								<div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
									<p className="text-sm font-medium text-slate-700">Patient: {patientTransferPatient.name}</p>
									<p className="text-sm text-slate-600">Patient ID: {patientTransferPatient.patientId}</p>
									{patientTransferPatient.assignedDoctor && (
										<p className="text-sm text-slate-600">Current Doctor: {patientTransferPatient.assignedDoctor}</p>
									)}
								</div>

								<div className="mb-4">
									<label className="block text-sm font-medium text-slate-700 mb-1">Transfer to Therapist</label>
									<select
										value={selectedTherapistForTransfer}
										onChange={e => setSelectedTherapistForTransfer(e.target.value)}
										className="input-base"
									>
										<option value="">Select a therapist</option>
									{staff
										.filter(s => {
											const staffName = normalize(s.userName || s.name);
											const isClinicalRole = ['Physiotherapist', 'StrengthAndConditioning', 'ClinicalTeam'].includes(s.role);
											return staffName !== clinicianName && isClinicalRole;
										})
										.map(s => (
											<option key={s.id} value={s.userName || s.name}>
												{s.userName || s.name} ({s.role})
											</option>
										))}
									</select>
								</div>

								{checkingPatientTransferAvailability && (
									<div className="mb-4 text-sm text-slate-500">
										<i className="fas fa-spinner fa-spin mr-2" />
										Checking availability...
									</div>
								)}

								{patientTransferAvailabilityCheck && patientTransferAvailabilityCheck.appointments.length > 0 && (
									<div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
										<p className="text-sm font-medium text-slate-700 mb-2">
											Upcoming Appointments ({patientTransferAvailabilityCheck.appointments.length})
										</p>
										<p className="text-xs text-slate-600">
											These appointments will be transferred to the new therapist.
										</p>
									</div>
								)}

								<div className="flex gap-3 justify-end">
									<button
										type="button"
										onClick={handleClosePatientTransferDialog}
										className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
									>
										Cancel
									</button>
									<button
										type="button"
										onClick={handleConfirmPatientTransfer}
										disabled={!selectedTherapistForTransfer || transferringPatient}
										className="btn-primary"
									>
										{transferringPatient ? 'Sending Request...' : 'Request Transfer'}
									</button>
								</div>
							</div>
						</div>
					</div>
				)}

				{/* Package Setup Modal */}
				{showPackageModal && packageModalPatient && (
					<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
						<div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
							<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
								<div>
									<h2 className="text-lg font-semibold text-slate-900">Package Payment Setup</h2>
									<p className="text-xs text-slate-500">
										Configure package details for {packageModalPatient.name || 'Unnamed'} (
										{packageModalPatient.patientId || '—'})
									</p>
			</div>
								<button
									type="button"
									onClick={handleClosePackageModal}
									className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:bg-slate-100 focus-visible:text-slate-600 focus-visible:outline-none"
									aria-label="Close dialog"
									disabled={packageSubmitting}
								>
									<i className="fas fa-times" aria-hidden="true" />
								</button>
							</header>
							<div className="px-6 py-4 space-y-4">
								<div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
									<p className="font-semibold text-slate-800">Package Setup</p>
									<p>
										Record the patient's package payment details for future sessions. This will create a package billing entry (separate from consultation billing, which is handled by front desk) and update the patient record.
									</p>
								</div>

								<div className="grid gap-4 md:grid-cols-12">
									<div className="md:col-span-4">
										<label className="block text-sm font-medium text-slate-700">
											Client Type <span className="text-rose-600">*</span>
										</label>
										<select
											value={packageForm.clientType}
											onChange={handlePackageFormChange('clientType')}
											className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
											required
											disabled={packageSubmitting}
										>
											<option value="">Select client type</option>
											<option value="professional">Professionals & Elite Athletes</option>
											<option value="student">Students & Govt Employees</option>
										</select>
										{packageFormErrors.clientType && (
											<p className="mt-1 text-xs text-rose-500">{packageFormErrors.clientType}</p>
										)}
									</div>
									<div className="md:col-span-4">
										<label className="block text-sm font-medium text-slate-700">
											Category <span className="text-rose-600">*</span>
										</label>
										<select
											value={packageForm.category}
											onChange={handlePackageFormChange('category')}
											className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
											required
											disabled={packageSubmitting || !packageForm.clientType}
										>
											<option value="">Select category</option>
											<option value="strength">Strength & Conditioning</option>
											<option value="physio">Physiotherapy</option>
											<option value="individual">Individual Treatments</option>
										</select>
										{packageFormErrors.category && (
											<p className="mt-1 text-xs text-rose-500">{packageFormErrors.category}</p>
										)}
									</div>
									<div className="md:col-span-4">
										<label className="block text-sm font-medium text-slate-700">
											Select Package <span className="text-rose-600">*</span>
										</label>
										<select
											value={packageForm.selectedPackage}
											onChange={handlePackageFormChange('selectedPackage')}
											className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
											required
											disabled={packageSubmitting || !packageForm.clientType || !packageForm.category}
										>
											<option value="">Select a package</option>
											{(() => {
												const availablePackages = packageForm.clientType === 'professional'
													? PROFESSIONAL_PACKAGES
													: packageForm.clientType === 'student'
													? STUDENT_PACKAGES
													: [];
												
												const filteredPackages = availablePackages
													.filter(p => p.category === packageForm.category)
													.map(pkg => (
														<option key={pkg.id} value={pkg.id}>
															{pkg.label} - ₹{pkg.amount.toLocaleString()}{pkg.category === 'individual' ? ' per session' : ''}
														</option>
													));
												
												return (
													<>
														{filteredPackages}
														<option value="custom">Custom Package</option>
													</>
												);
											})()}
										</select>
										{packageFormErrors.selectedPackage && (
											<p className="mt-1 text-xs text-rose-500">{packageFormErrors.selectedPackage}</p>
										)}
									</div>
									<div className="md:col-span-6">
										<label className="block text-sm font-medium text-slate-700">
											Total No of Session <span className="text-rose-600">*</span>
										</label>
										{(() => {
											const allPackages = [...PROFESSIONAL_PACKAGES, ...STUDENT_PACKAGES];
											const selected = allPackages.find(p => p.id === packageForm.selectedPackage);
											const isIndividual = selected?.category === 'individual';
											const isCustom = packageForm.selectedPackage === 'custom';
											return (
												<input
													type="number"
													min="1"
													step="1"
													value={packageForm.totalNoOfSessions}
													onChange={handlePackageFormChange('totalNoOfSessions')}
													className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
													placeholder={isCustom ? 'Enter number of sessions' : isIndividual ? 'Enter number of sessions (default: 1)' : 'Auto-filled from package'}
													required
													disabled={packageSubmitting || (!!packageForm.selectedPackage && !isIndividual && !isCustom)}
												/>
											);
										})()}
										{packageFormErrors.totalNoOfSessions && (
											<p className="mt-1 text-xs text-rose-500">{packageFormErrors.totalNoOfSessions}</p>
										)}
									</div>
									<div className="md:col-span-6">
										<label className="block text-sm font-medium text-slate-700">
											Package Amount <span className="text-rose-600">*</span>
											{(() => {
												const allPackages = [...PROFESSIONAL_PACKAGES, ...STUDENT_PACKAGES];
												const selected = allPackages.find(p => p.id === packageForm.selectedPackage);
												if (selected?.category === 'individual') {
													return <span className="ml-2 text-xs font-normal text-slate-500">(calculated: {selected.amount} × sessions)</span>;
												}
												return null;
											})()}
										</label>
										<div className="relative mt-2">
											<span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-500">
												₹
											</span>
											{(() => {
												const allPackages = [...PROFESSIONAL_PACKAGES, ...STUDENT_PACKAGES];
												const selected = allPackages.find(p => p.id === packageForm.selectedPackage);
												const isIndividual = selected?.category === 'individual';
												const isCustom = packageForm.selectedPackage === 'custom';
												return (
													<input
														type="number"
														min="0"
														step="0.01"
														value={packageForm.packageAmount}
														onChange={handlePackageFormChange('packageAmount')}
														className="w-full rounded-md border border-slate-300 pl-8 pr-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
														placeholder={isCustom ? 'Enter package amount' : isIndividual ? 'Auto-calculated' : 'Auto-filled from package'}
														required
														disabled={packageSubmitting || (!!packageForm.selectedPackage && !isCustom && !isIndividual)}
													/>
												);
											})()}
										</div>
										{packageFormErrors.packageAmount && (
											<p className="mt-1 text-xs text-rose-500">{packageFormErrors.packageAmount}</p>
										)}
									</div>
									<div className="md:col-span-6">
										<label className="block text-sm font-medium text-slate-700">
											Type of Payment <span className="text-rose-600">*</span>
										</label>
										<select
											value={packageForm.paymentType}
											onChange={handlePackageFormChange('paymentType')}
											className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
											required
											disabled={packageSubmitting}
										>
											<option value="">Select</option>
											{PAYMENT_OPTIONS.map(option => (
												<option key={option.value} value={option.value}>
													{option.label}
												</option>
											))}
										</select>
										{packageFormErrors.paymentType && (
											<p className="mt-1 text-xs text-rose-500">{packageFormErrors.paymentType}</p>
										)}
									</div>
									{packageForm.paymentType === 'with' && (
										<div className="md:col-span-6">
											<label className="block text-sm font-medium text-slate-700">
												Concession (%) <span className="text-slate-500 text-xs font-normal">(optional)</span>
											</label>
											<input
												type="number"
												min="0"
												max="100"
												step="0.01"
												value={packageForm.concessionPercent ?? ''}
												onChange={handlePackageFormChange('concessionPercent')}
												className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
												placeholder="Enter percentage discount"
												disabled={packageSubmitting}
											/>
											{packageFormErrors.concessionPercent && (
												<p className="mt-1 text-xs text-rose-500">{packageFormErrors.concessionPercent}</p>
											)}
										</div>
									)}
									<div className="md:col-span-12">
										<label className="block text-sm font-medium text-slate-700">
											Payment Description / Concession Reason
										</label>
										<input
											type="text"
											value={packageForm.paymentDescription}
											onChange={handlePackageFormChange('paymentDescription')}
											className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
											placeholder="Enter details (if any)"
											disabled={packageSubmitting}
										/>
									</div>
								</div>

							</div>
							<footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
								<button
									type="button"
									onClick={handleClosePackageModal}
									className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200"
									disabled={packageSubmitting}
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={handleSubmitPackageSetup}
									className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200"
									disabled={packageSubmitting}
								>
									{packageSubmitting ? (
										<>
											<div className="mr-2 inline-flex h-4 w-4 items-center justify-center rounded-full border-2 border-white border-t-transparent animate-spin" />
											Saving...
										</>
									) : (
										<>
											<i className="fas fa-save text-xs mr-1" aria-hidden="true" />
											Save Package
										</>
									)}
								</button>
							</footer>
						</div>
					</div>
				)}
			</div>
		);
	}

	const buildReportPayload = (): PatientReportData | null => {
		if (!selectedPatient) return null;
		const age = selectedPatient.dob ? new Date().getFullYear() - new Date(selectedPatient.dob).getFullYear() : undefined;

		return {
			patientName: selectedPatient.name,
			patientId: selectedPatient.patientId,
			referredBy: selectedPatient.assignedDoctor || formData.referredBy || '',
			age: age ? String(age) : '',
			gender: selectedPatient.gender || '',
			dateOfConsultation: formData.dateOfConsultation || new Date().toISOString().split('T')[0],
			contact: selectedPatient.phone || '',
			email: selectedPatient.email || '',
			totalSessionsRequired: formData.totalSessionsRequired ?? selectedPatient.totalSessionsRequired,
			remainingSessions: formData.remainingSessions ?? selectedPatient.remainingSessions,
			complaints: formData.complaints || '',
			presentHistory: formData.presentHistory || '',
			pastHistory: formData.pastHistory || '',
			surgicalHistory: formData.surgicalHistory || '',
			medicalHistory: getMedicalHistoryText(selectedPatient),
			sleepCycle: formData.sleepCycle || '',
			hydration: formData.hydration || '4',
			nutrition: formData.nutrition || '',
			chiefComplaint: formData.chiefComplaint || formData.complaints || '',
			onsetType: formData.onsetType || '',
			duration: formData.duration || '',
			mechanismOfInjury: formData.mechanismOfInjury || '',
			painType: formData.painType || formData.typeOfPain || '',
			painIntensity: formData.painIntensity || formData.vasScale || '',
			aggravatingFactor: formData.aggravatingFactor || '',
			relievingFactor: formData.relievingFactor || '',
			siteSide: formData.siteSide || '',
			onset: formData.onset || '',
			natureOfInjury: formData.natureOfInjury || '',
			typeOfPain: formData.typeOfPain || '',
			vasScale: formData.vasScale || '5',
			rom: formData.rom || {},
			mmt: formData.mmt || {},
			built: formData.built || '',
			posture: formData.posture || '',
			postureManualNotes: formData.postureManualNotes || '',
			postureFileName: formData.postureFileName || '',
			gaitAnalysis: formData.gaitAnalysis || '',
			gaitManualNotes: formData.gaitManualNotes || '',
			gaitFileName: formData.gaitFileName || '',
			mobilityAids: formData.mobilityAids || '',
			localObservation: formData.localObservation || '',
			swelling: formData.swelling || '',
			muscleWasting: formData.muscleWasting || '',
			tenderness: formData.tenderness || '',
			warmth: formData.warmth || '',
			scar: formData.scar || '',
			crepitus: formData.crepitus || '',
			odema: formData.odema || '',
			followUpVisits: formData.followUpVisits || [],
			currentPainStatus: formData.currentPainStatus || '',
			currentRom: formData.currentRom || '',
			currentStrength: formData.currentStrength || '',
			currentFunctionalAbility: formData.currentFunctionalAbility || '',
			complianceWithHEP: formData.complianceWithHEP || '',
			specialTest: formData.specialTest || '',
			differentialDiagnosis: formData.differentialDiagnosis || '',
			finalDiagnosis: formData.finalDiagnosis || '',
			shortTermGoals: formData.shortTermGoals || '',
			longTermGoals: formData.longTermGoals || '',
			rehabProtocol: formData.rehabProtocol || '',
			advice: formData.advice || '',
			managementRemarks: formData.managementRemarks || '',
			nextFollowUpDate: formData.nextFollowUpDate || '',
			nextFollowUpTime: formData.nextFollowUpTime || '',
			physioName: formData.physioName || '',
			physioRegNo: formData.physioId || '',
			patientType: selectedPatient.patientType || '',
		} as PatientReportData;
	};

	const handleDownloadPDF = async (sections?: ReportSection[]) => {
		try {
			const payload = buildReportPayload();
			if (!payload) {
				alert('No patient selected. Please select a patient first.');
				return;
			}
			await generatePhysiotherapyReportPDF(payload, { sections });
		} catch (error) {
			console.error('Error downloading PDF:', error);
			alert('Failed to download PDF. Please try again.');
		}
	};

	const handlePrint = async (sections?: ReportSection[]) => {
		try {
			const payload = buildReportPayload();
			if (!payload) {
				alert('No patient selected. Please select a patient first.');
				return;
			}

			// Generate PDF and open print window
			await generatePhysiotherapyReportPDF(payload, { forPrint: true, sections });
		} catch (error) {
			console.error('Error printing PDF:', error);
			alert('Failed to print PDF. Please try again.');
		}
	};

	const handleCrispReport = () => {
		setShowCrispReportModal(true);
	};

	const handleCrispReportPrint = async () => {
		setShowCrispReportModal(false);
		await handlePrint(selectedSections);
	};

	const handleCrispReportDownload = async () => {
		setShowCrispReportModal(false);
		await handleDownloadPDF(selectedSections);
	};

	const allSections: Array<{ key: ReportSection; label: string }> = [
		{ key: 'patientInformation', label: 'Patient Information' },
		{ key: 'assessmentOverview', label: 'Assessment Overview' },
		{ key: 'painAssessment', label: 'Pain Assessment' },
		{ key: 'onObservation', label: 'On Observation' },
		{ key: 'onPalpation', label: 'On Palpation' },
		{ key: 'rom', label: 'ROM (Range of Motion)' },
		{ key: 'mmt', label: 'Manual Muscle Testing' },
		{ key: 'advancedAssessment', label: 'Advanced Assessment' },
		{ key: 'physiotherapyManagement', label: 'Physiotherapy Management' },
		{ key: 'followUpVisits', label: 'Follow-Up Visits' },
		{ key: 'currentStatus', label: 'Current Status' },
		{ key: 'nextFollowUp', label: 'Next Follow-Up Details' },
		{ key: 'signature', label: 'Physiotherapist Signature' },
	];

	const toggleSection = (section: ReportSection) => {
		setSelectedSections(prev =>
			prev.includes(section)
				? prev.filter(s => s !== section)
				: [...prev, section]
		);
	};

	return (
		<div className="min-h-svh bg-slate-50 px-6 py-10">
			<div className="mx-auto max-w-5xl">
				<header className="mb-8 flex items-center justify-between">
					<div>
						<p className="text-sm font-semibold uppercase tracking-wide text-sky-600">Clinical Team</p>
						<h1 className="mt-1 text-3xl font-semibold text-slate-900">Physiotherapy Report</h1>
						<p className="mt-2 text-sm text-slate-600">
							Editing report for {selectedPatient.name} ({selectedPatient.patientId})
						</p>
					</div>

					<button
						type="button"
						onClick={() => {
							setSelectedPatient(null);
							setFormData({});
							setPatientIdParam(null);
							setShowVersionHistory(false);
							router.replace('/clinical-team/edit-report');
						}}
						className="btn-secondary"
					>
						<i className="fas fa-arrow-left text-xs" aria-hidden="true" />
						Back to List
					</button>
				</header>

				{savedMessage && (
					<div className="mb-6 alert-success">
						<i className="fas fa-check mr-2" aria-hidden="true" />
						Report saved successfully!
					</div>
				)}

				<div className="section-card">
					{/* Patient Information */}
					<div className="mb-8 border-b border-slate-200 pb-6">
						<h2 className="mb-4 text-xl font-bold text-sky-600">Physiotherapy Report</h2>
						<div className="mb-4 text-right text-sm text-slate-600">
							<div>
								<b>Clinic:</b> Centre For Sports Science, Kanteerava Stadium
							</div>
							{headerConfig?.associationText && (
								<div className="mt-1 text-xs text-slate-500">
									{headerConfig.associationText}
								</div>
							)}
							{headerConfig?.govermentOrder && (
								<div className="mt-1 text-xs text-slate-500">
									{headerConfig.govermentOrder}
								</div>
							)}
							<div className="mt-1">
								<b>Date:</b> {currentDate || '—'}
							</div>
						</div>
						<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
							<div>
								<label className="block text-xs font-medium text-slate-500">Patient Name</label>
								<input
									type="text"
									value={selectedPatient.name}
									readOnly
									className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">Type of Organization</label>
								<input
									type="text"
									value={selectedPatient.patientType || '—'}
									readOnly
									className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">Patient ID</label>
								<input
									type="text"
									value={selectedPatient.patientId}
									readOnly
									className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">Date of Birth</label>
								<input
									type="date"
									value={selectedPatient.dob}
									readOnly
									className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">Total Sessions Required</label>
								<input
									type="number"
									min={0}
									value={formData.totalSessionsRequired ?? ''}
									onChange={e => {
										const raw = e.target.value;
										const numericValue = Number(raw);
										const sanitized =
											raw === '' || Number.isNaN(numericValue)
												? undefined
												: Math.max(numericValue, 0);

										setFormData(prev => {
											const total = sanitized;

											if (total === undefined) {
												return {
													...prev,
													totalSessionsRequired: undefined,
													remainingSessions: undefined,
												};
											}

											const baselineTotal =
												typeof prev.totalSessionsRequired === 'number' && !Number.isNaN(prev.totalSessionsRequired)
													? prev.totalSessionsRequired
													: typeof selectedPatient?.totalSessionsRequired === 'number'
														? selectedPatient.totalSessionsRequired
														: undefined;

											const baselineRemaining =
												typeof prev.remainingSessions === 'number' && !Number.isNaN(prev.remainingSessions)
													? prev.remainingSessions
													: typeof selectedPatient?.remainingSessions === 'number'
														? selectedPatient.remainingSessions
														: undefined;

											const completedSessions =
												typeof baselineTotal === 'number' &&
												typeof baselineRemaining === 'number'
													? Math.max(0, baselineTotal - 1 - baselineRemaining)
													: undefined;

											const nextRemaining =
												typeof completedSessions === 'number'
													? Math.max(0, total - completedSessions)
													: total; // Set equal to total initially

											return {
												...prev,
												totalSessionsRequired: total,
												remainingSessions: nextRemaining,
											};
										});
									}}
									className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">Remaining Sessions</label>
								<input
									type="number"
									min={0}
									value={displayedRemainingSessions ?? ''}
									readOnly
									className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
								/>
							</div>
						</div>

					{/* Package Information */}
					{(selectedPatient?.packageAmount || selectedPatient?.packageName) && selectedPatient && (
						<div className="mt-4 rounded-lg border-2 border-purple-200 bg-purple-50/50 p-4">
							<h4 className="mb-3 text-sm font-semibold text-purple-900">Package Information</h4>
							<div className="grid gap-3 sm:grid-cols-2">
								{selectedPatient.packageName && (
									<div>
										<label className="block text-xs font-medium text-slate-600">Package Name</label>
										<p className="mt-1 text-sm font-semibold text-slate-900">{selectedPatient.packageName}</p>
									</div>
								)}
								{typeof selectedPatient.totalSessionsRequired === 'number' && (
									<div>
										<label className="block text-xs font-medium text-slate-600">Total Sessions</label>
										<p className="mt-1 text-sm font-semibold text-slate-900">{selectedPatient.totalSessionsRequired}</p>
									</div>
								)}
								{typeof selectedPatient.remainingSessions === 'number' && (
									<div>
										<label className="block text-xs font-medium text-slate-600">Remaining Sessions</label>
										<p className="mt-1 text-sm font-semibold text-slate-900">{selectedPatient.remainingSessions}</p>
									</div>
								)}
								{typeof selectedPatient.packageAmount === 'number' && (
									<div>
										<label className="block text-xs font-medium text-slate-600">Package Amount</label>
										<p className="mt-1 text-sm font-semibold text-slate-900">₹{selectedPatient.packageAmount.toFixed(2)}</p>
									</div>
								)}
								{selectedPatient.paymentType && (
									<div>
										<label className="block text-xs font-medium text-slate-600">Consultation Type</label>
										<p className="mt-1 text-sm font-semibold text-slate-900">
											{selectedPatient.paymentType === 'with' ? 'With Consultation' : 'Without Consultation'}
										</p>
									</div>
								)}
								{typeof selectedPatient.concessionPercent === 'number' && selectedPatient.concessionPercent > 0 && (
									<div>
										<label className="block text-xs font-medium text-slate-600">Discount</label>
										<p className="mt-1 text-sm font-semibold text-green-600">{selectedPatient.concessionPercent}%</p>
									</div>
								)}
								{selectedPatient.packageDescription && (
									<div className="sm:col-span-2">
										<label className="block text-xs font-medium text-slate-600">Description</label>
										<p className="mt-1 text-sm text-slate-700">{selectedPatient.packageDescription}</p>
									</div>
								)}
							</div>
						</div>
					)}
					</div>

					{/* Assessment Section */}
					<div className="mb-8">
						<h3 className="mb-4 text-sm font-semibold text-sky-600">Assessment</h3>
						<div className="grid gap-4 sm:grid-cols-2">
							<div>
								<label className="block text-xs font-medium text-slate-500">Complaints</label>
								<textarea
									value={formData.complaints || ''}
									onChange={e => handleFieldChange('complaints', e.target.value)}
									className="textarea-base"
									rows={2}
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">Present History</label>
								<textarea
									value={formData.presentHistory || ''}
									onChange={e => handleFieldChange('presentHistory', e.target.value)}
									className="textarea-base"
									rows={2}
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">Past History</label>
								<textarea
									value={formData.pastHistory || ''}
									onChange={e => handleFieldChange('pastHistory', e.target.value)}
									className="textarea-base"
									rows={2}
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">Medical History</label>
								<div className="mt-2 space-y-2">
									<label className="flex items-center gap-2 text-sm text-slate-700">
										<input
											type="checkbox"
											checked={formData.med_xray || false}
											onChange={e => handleCheckboxChange('med_xray', e.target.checked)}
											className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
										/>
										X RAYS
									</label>
									<label className="flex items-center gap-2 text-sm text-slate-700">
										<input
											type="checkbox"
											checked={formData.med_mri || false}
											onChange={e => handleCheckboxChange('med_mri', e.target.checked)}
											className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
										/>
										MRI
									</label>
									<label className="flex items-center gap-2 text-sm text-slate-700">
										<input
											type="checkbox"
											checked={formData.med_report || false}
											onChange={e => handleCheckboxChange('med_report', e.target.checked)}
											className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
										/>
										Reports
									</label>
									<label className="flex items-center gap-2 text-sm text-slate-700">
										<input
											type="checkbox"
											checked={formData.med_ct || false}
											onChange={e => handleCheckboxChange('med_ct', e.target.checked)}
											className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
										/>
										CT Scans
									</label>
								</div>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">Surgical History</label>
								<textarea
									value={formData.surgicalHistory || ''}
									onChange={e => handleFieldChange('surgicalHistory', e.target.value)}
									className="textarea-base"
									rows={2}
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">Personal History</label>
								<div className="mt-2 space-y-2">
									<label className="flex items-center gap-2 text-sm text-slate-700">
										<input
											type="checkbox"
											checked={formData.per_smoking || false}
											onChange={e => handleCheckboxChange('per_smoking', e.target.checked)}
											className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
										/>
										Smoking
									</label>
									<label className="flex items-center gap-2 text-sm text-slate-700">
										<input
											type="checkbox"
											checked={formData.per_drinking || false}
											onChange={e => handleCheckboxChange('per_drinking', e.target.checked)}
											className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
										/>
										Drinking
									</label>
									<label className="flex items-center gap-2 text-sm text-slate-700">
										<input
											type="checkbox"
											checked={formData.per_alcohol || false}
											onChange={e => handleCheckboxChange('per_alcohol', e.target.checked)}
											className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
										/>
										Alcohol
									</label>
									<label className="flex items-center gap-2 text-sm text-slate-700">
										<input
											type="checkbox"
											checked={formData.per_drugs || false}
											onChange={e => handleCheckboxChange('per_drugs', e.target.checked)}
											className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
										/>
										Drugs
									</label>
									{formData.per_drugs && (
										<input
											type="text"
											value={formData.drugsText || ''}
											onChange={e => handleFieldChange('drugsText', e.target.value)}
											className="input-base"
											placeholder="Which drug?"
										/>
									)}
								</div>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">Sleep Cycle</label>
								<input
									type="text"
									value={formData.sleepCycle || ''}
									onChange={e => handleFieldChange('sleepCycle', e.target.value)}
									className="input-base"
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500 mb-2">Hydration</label>
								<div className="flex items-center gap-2">
									<span className="text-xs font-semibold text-slate-500">1</span>
									<input
										type="range"
										min="1"
										max="8"
										value={hydrationValue}
										onChange={e => handleFieldChange('hydration', e.target.value)}
										className="flex-1 h-2 bg-gradient-to-r from-emerald-400 via-amber-400 to-rose-500 rounded-lg appearance-none cursor-pointer"
									/>
									<span className="text-xs font-semibold text-slate-500">8</span>
								</div>
								<div className="mt-3 flex items-center justify-center gap-2">
									<span className="text-3xl transition-transform duration-200" style={{ transform: 'scale(1.2)' }}>
										{hydrationEmoji}
									</span>
									<span className="text-xs text-slate-600 font-medium">{hydrationValue}/8</span>
								</div>
								<div className="mt-2 grid grid-cols-8 text-[10px] text-center text-slate-400">
									{HYDRATION_EMOJIS.map((emoji, idx) => (
										<span
											key={`hydration-${emoji}-${idx}`}
											className={`transition-transform duration-200 ${idx + 1 === hydrationValue ? 'scale-110' : 'scale-90'}`}
										>
											{emoji}
										</span>
									))}
								</div>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">Nutrition</label>
								<input
									type="text"
									value={formData.nutrition || ''}
									onChange={e => handleFieldChange('nutrition', e.target.value)}
									className="input-base"
								/>
							</div>
						</div>
					</div>

					{/* Pain Assessment Section */}
					<div className="mb-8">
						<h3 className="mb-4 text-lg font-semibold text-sky-600 border-b border-sky-200 pb-2">Pain Assessment</h3>
						<div className="grid gap-4 sm:grid-cols-2">
							<div>
								<label className="block text-xs font-medium text-slate-500">Site and Side</label>
								<input
									type="text"
									value={formData.siteSide || ''}
									onChange={e => handleFieldChange('siteSide', e.target.value)}
									className="input-base"
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">Onset</label>
								<input
									type="text"
									value={formData.onset || ''}
									onChange={e => handleFieldChange('onset', e.target.value)}
									className="input-base"
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">Duration</label>
								<input
									type="text"
									value={formData.duration || ''}
									onChange={e => handleFieldChange('duration', e.target.value)}
									className="input-base"
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">Nature of Injury</label>
								<input
									type="text"
									value={formData.natureOfInjury || ''}
									onChange={e => handleFieldChange('natureOfInjury', e.target.value)}
									className="input-base"
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">Type of Pain</label>
								<input
									type="text"
									value={formData.typeOfPain || ''}
									onChange={e => handleFieldChange('typeOfPain', e.target.value)}
									className="input-base"
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500 mb-2">VAS Scale</label>
								<div className="flex items-center gap-2">
									<span className="text-xs font-semibold text-slate-500">1</span>
									<input
										type="range"
										min="1"
										max="10"
										value={vasValue}
										onChange={e => handleFieldChange('vasScale', e.target.value)}
										className="flex-1 h-2 bg-gradient-to-r from-emerald-400 via-amber-400 to-rose-500 rounded-lg appearance-none cursor-pointer"
									/>
									<span className="text-xs font-semibold text-slate-500">10</span>
								</div>
								<div className="mt-3 flex items-center justify-center gap-2">
									<span
										className="text-3xl transition-transform duration-200"
										style={{ transform: 'scale(1.2)' }}
										role="img"
										aria-label="Pain emoji"
									>
										{vasEmoji}
									</span>
									<span className="text-xs text-slate-600 font-medium">{vasValue}/10</span>
								</div>
								<div className="mt-2 grid grid-cols-10 text-[10px] text-center text-slate-400">
									{VAS_EMOJIS.map((emoji, idx) => (
										<span
											key={emoji + idx}
											className={`transition-transform duration-200 ${idx + 1 === vasValue ? 'scale-110' : 'scale-90'}`}
										>
											{emoji}
										</span>
									))}
								</div>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">Aggravating Factor</label>
								<input
									type="text"
									value={formData.aggravatingFactor || ''}
									onChange={e => handleFieldChange('aggravatingFactor', e.target.value)}
									className="input-base"
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">Relieving Factor</label>
								<input
									type="text"
									value={formData.relievingFactor || ''}
									onChange={e => handleFieldChange('relievingFactor', e.target.value)}
									className="input-base"
								/>
							</div>
						</div>
					</div>

					{/* On Observation Section */}
					<div className="mb-8">
						<h3 className="mb-4 text-lg font-semibold text-sky-600 border-b border-sky-200 pb-2">On Observation</h3>
						<div className="grid gap-4 sm:grid-cols-2">
							<div>
								<label className="block text-xs font-medium text-slate-500">Built</label>
								<input
									type="text"
									value={formData.built || ''}
									onChange={e => handleFieldChange('built', e.target.value)}
									className="input-base"
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500 mb-2">Posture</label>
								<div className="flex gap-4">
									<label className="flex items-center gap-2">
										<input
											type="radio"
											name="posture"
											value="Manual"
											checked={formData.posture === 'Manual'}
											onChange={e => handleFieldChange('posture', e.target.value)}
											className="text-sky-600"
										/>
										<span className="text-sm text-slate-800">Manual</span>
									</label>
									<label className="flex items-center gap-2">
										<input
											type="radio"
											name="posture"
											value="Kinetisense"
											checked={formData.posture === 'Kinetisense'}
											onChange={e => handleFieldChange('posture', e.target.value)}
											className="text-sky-600"
										/>
										<span className="text-sm text-slate-800">Kinetisense</span>
									</label>
								</div>
								{formData.posture === 'Manual' && (
									<textarea
										className="mt-2 textarea-base"
										rows={2}
										placeholder="Add manual posture notes"
										value={formData.postureManualNotes || ''}
										onChange={e => handleFieldChange('postureManualNotes', e.target.value)}
									/>
								)}
								{formData.posture === 'Kinetisense' && (
									<div className="mt-2 space-y-2">
										<input
											type="file"
											accept=".pdf,.jpg,.jpeg,.png"
											onChange={e => handleFileUpload('postureFileData', 'postureFileName', e.target.files?.[0] || null)}
											className="block w-full text-xs text-slate-600 file:mr-4 file:rounded-full file:border-0 file:bg-sky-50 file:px-3 file:py-1 file:text-sm file:font-semibold file:text-sky-700 hover:file:bg-sky-100"
										/>
										{formData.postureFileName && (
											<div className="flex items-center gap-2">
												<span className="text-xs text-slate-600">{formData.postureFileName}</span>
												<button
													type="button"
													onClick={() => {
														if (formData.postureFileData) {
															const viewWindow = window.open();
															if (viewWindow) {
																viewWindow.document.write(`
																	<html>
																		<head>
																			<title>${formData.postureFileName}</title>
																			<style>
																				body { margin: 0; padding: 0; }
																				iframe { width: 100%; height: 100vh; border: none; }
																			</style>
																		</head>
																		<body>
																			<iframe src="${formData.postureFileData}"></iframe>
																		</body>
																	</html>
																`);
																viewWindow.document.close();
															}
														}
													}}
													className="inline-flex items-center gap-1 rounded-md bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-700 transition hover:bg-sky-200"
												>
													<i className="fas fa-eye" />
													View PDF
												</button>
											</div>
										)}
									</div>
								)}
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500 mb-2">GAIT Analysis</label>
								<div className="flex gap-4">
									<label className="flex items-center gap-2">
										<input
											type="radio"
											name="gaitAnalysis"
											value="Manual"
											checked={formData.gaitAnalysis === 'Manual'}
											onChange={e => handleFieldChange('gaitAnalysis', e.target.value)}
											className="text-sky-600"
										/>
										<span className="text-sm text-slate-800">Manual</span>
									</label>
									<label className="flex items-center gap-2">
										<input
											type="radio"
											name="gaitAnalysis"
											value="OptaGAIT"
											checked={formData.gaitAnalysis === 'OptaGAIT'}
											onChange={e => handleFieldChange('gaitAnalysis', e.target.value)}
											className="text-sky-600"
										/>
										<span className="text-sm text-slate-800">OptaGAIT</span>
									</label>
								</div>
								{formData.gaitAnalysis === 'Manual' && (
									<textarea
										className="mt-2 textarea-base"
										rows={2}
										placeholder="Manual GAIT analysis notes"
										value={formData.gaitManualNotes || ''}
										onChange={e => handleFieldChange('gaitManualNotes', e.target.value)}
									/>
								)}
								{formData.gaitAnalysis === 'OptaGAIT' && (
									<div className="mt-2 space-y-2">
										<input
											type="file"
											accept=".pdf,.jpg,.jpeg,.png"
											onChange={e => handleFileUpload('gaitFileData', 'gaitFileName', e.target.files?.[0] || null)}
											className="block w-full text-xs text-slate-600 file:mr-4 file:rounded-full file:border-0 file:bg-sky-50 file:px-3 file:py-1 file:text-sm file:font-semibold file:text-sky-700 hover:file:bg-sky-100"
										/>
										{formData.gaitFileName && (
											<div className="flex items-center gap-2">
												<span className="text-xs text-slate-600">{formData.gaitFileName}</span>
												<button
													type="button"
													onClick={() => {
														if (formData.gaitFileData) {
															const viewWindow = window.open();
															if (viewWindow) {
																viewWindow.document.write(`
																	<html>
																		<head>
																			<title>${formData.gaitFileName}</title>
																			<style>
																				body { margin: 0; padding: 0; }
																				iframe { width: 100%; height: 100vh; border: none; }
																			</style>
																		</head>
																		<body>
																			<iframe src="${formData.gaitFileData}"></iframe>
																		</body>
																	</html>
																`);
																viewWindow.document.close();
															}
														}
													}}
													className="inline-flex items-center gap-1 rounded-md bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-700 transition hover:bg-sky-200"
												>
													<i className="fas fa-eye" />
													View PDF
												</button>
											</div>
										)}
									</div>
								)}
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">Mobility Aids</label>
								<input
									type="text"
									value={formData.mobilityAids || ''}
									onChange={e => handleFieldChange('mobilityAids', e.target.value)}
									className="input-base"
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">Local Observation</label>
								<textarea
									value={formData.localObservation || ''}
									onChange={e => handleFieldChange('localObservation', e.target.value)}
									className="textarea-base"
									rows={2}
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">Swelling</label>
								<input
									type="text"
									value={formData.swelling || ''}
									onChange={e => handleFieldChange('swelling', e.target.value)}
									className="input-base"
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">Muscle Wasting</label>
								<input
									type="text"
									value={formData.muscleWasting || ''}
									onChange={e => handleFieldChange('muscleWasting', e.target.value)}
									className="input-base"
								/>
							</div>
						</div>
					</div>

					{/* On Palpation Section */}
					<div className="mb-8">
						<h3 className="mb-4 text-lg font-semibold text-sky-600 border-b border-sky-200 pb-2">On Palpation</h3>
						<div className="grid gap-4 sm:grid-cols-2">
							<div>
								<label className="block text-xs font-medium text-slate-500">Tenderness</label>
								<input
									type="text"
									value={formData.tenderness || ''}
									onChange={e => handleFieldChange('tenderness', e.target.value)}
									className="input-base"
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">Warmth</label>
								<input
									type="text"
									value={formData.warmth || ''}
									onChange={e => handleFieldChange('warmth', e.target.value)}
									className="input-base"
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">Scar</label>
								<input
									type="text"
									value={formData.scar || ''}
									onChange={e => handleFieldChange('scar', e.target.value)}
									className="input-base"
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">Crepitus</label>
								<input
									type="text"
									value={formData.crepitus || ''}
									onChange={e => handleFieldChange('crepitus', e.target.value)}
									className="input-base"
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">Odema</label>
								<input
									type="text"
									value={formData.odema || ''}
									onChange={e => handleFieldChange('odema', e.target.value)}
									className="input-base"
								/>
							</div>
						</div>
					</div>

					{/* On Examination Section - ROM Assessment */}
					<div className="mb-8">
						<h3 className="mb-4 text-lg font-semibold text-sky-600 border-b border-sky-200 pb-2">On Examination</h3>
						<div className="mb-4">
							<h4 className="mb-3 text-sm font-semibold text-slate-700">i) Range of Motion Assessment</h4>
							<div className="mb-4 flex items-center gap-3">
								<select
									value={selectedRomJoint}
									onChange={e => setSelectedRomJoint(e.target.value)}
									className="select-base"
									style={{ maxWidth: '220px' }}
								>
									<option value="">--Select Joint--</option>
									{ROM_JOINTS.map(joint => (
										<option key={joint} value={joint}>
											{joint}
										</option>
									))}
								</select>
								<button
									type="button"
									onClick={handleAddRomJoint}
									className="btn-primary"
									disabled={!selectedRomJoint}
								>
									<i className="fas fa-plus text-xs" aria-hidden="true" />
									Add Joint
								</button>
								<button
									type="button"
									onClick={() => romFileInputRef.current?.click()}
									className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-green-700 focus-visible:outline-none"
									title="Upload image or file"
								>
									<i className="fas fa-upload text-xs" aria-hidden="true" />
									Upload
								</button>
								<input
									ref={romFileInputRef}
									type="file"
									accept="image/*,.pdf"
									onChange={handleRomImageUpload}
									className="hidden"
								/>
							</div>
							{formData.rom && Object.keys(formData.rom).length > 0 ? (
								<div>
									{Object.keys(formData.rom).map(joint => renderRomTable(joint, formData.rom![joint]))}
								</div>
							) : (
								<p className="text-sm italic text-slate-500">No ROM joints recorded. Select a joint and click "Add Joint" to start.</p>
							)}
						</div>
						<div className="mt-8">
							<h4 className="mb-3 text-sm font-semibold text-slate-700">ii) Manual Muscle Testing</h4>
							<div className="mb-4 flex items-center gap-3">
								<select
									value={selectedMmtJoint}
									onChange={e => setSelectedMmtJoint(e.target.value)}
									className="select-base"
									style={{ maxWidth: '220px' }}
								>
									<option value="">--Select Joint--</option>
									{ROM_JOINTS.map(joint => (
										<option key={`mmt-${joint}`} value={joint}>
											{joint}
										</option>
									))}
								</select>
								<button
									type="button"
									onClick={handleAddMmtJoint}
									className="btn-primary"
									disabled={!selectedMmtJoint}
								>
									<i className="fas fa-plus text-xs" aria-hidden="true" />
									Add Joint
								</button>
								<button
									type="button"
									onClick={() => mmtFileInputRef.current?.click()}
									className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-green-700 focus-visible:outline-none"
									title="Upload image or file"
								>
									<i className="fas fa-upload text-xs" aria-hidden="true" />
									Upload
								</button>
								<input
									ref={mmtFileInputRef}
									type="file"
									accept="image/*,.pdf"
									onChange={handleMmtImageUpload}
									className="hidden"
								/>
							</div>
							{formData.mmt && Object.keys(formData.mmt).length > 0 ? (
								<div>
									{Object.keys(formData.mmt).map(joint => renderMmtTable(joint, formData.mmt![joint]))}
								</div>
							) : (
								<p className="text-sm italic text-slate-500">
									No manual muscle testing recorded. Select a joint and click "Add Joint" to begin.
								</p>
							)}
						</div>
						<div className="mt-8 grid gap-4">
							<div>
								<h4 className="mb-2 text-sm font-semibold text-slate-700">iii) Special Tests</h4>
								<textarea
									value={formData.specialTest || ''}
									onChange={e => handleFieldChange('specialTest', e.target.value)}
									className="textarea-base"
									rows={3}
									placeholder="Describe special test findings"
								/>
							</div>
							<div>
								<h4 className="mb-2 text-sm font-semibold text-slate-700">iv) Differential Diagnosis</h4>
								<textarea
									value={formData.differentialDiagnosis || ''}
									onChange={e => handleFieldChange('differentialDiagnosis', e.target.value)}
									className="textarea-base"
									rows={3}
									placeholder="Possible differentials"
								/>
							</div>
							<div>
								<h4 className="mb-2 text-sm font-semibold text-slate-700">v) Diagnosis</h4>
								<textarea
									value={formData.finalDiagnosis || ''}
									onChange={e => handleFieldChange('finalDiagnosis', e.target.value)}
									className="textarea-base"
									rows={3}
									placeholder="Final working diagnosis"
								/>
							</div>
						</div>
					</div>

					{/* Physiotherapy Management */}
					<div className="mb-10">
						<h3 className="mb-4 text-lg font-semibold text-sky-600 border-b border-sky-200 pb-2">Physiotherapy Management</h3>
						<div className="space-y-4">
							<div>
								<label className="block text-xs font-medium text-slate-500">i) Short Term Goals</label>
								<textarea
									value={formData.shortTermGoals || ''}
									onChange={e => handleFieldChange('shortTermGoals', e.target.value)}
									className="textarea-base"
									rows={3}
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">ii) Long Term Goals</label>
								<textarea
									value={formData.longTermGoals || ''}
									onChange={e => handleFieldChange('longTermGoals', e.target.value)}
									className="textarea-base"
									rows={3}
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">iii) Rehab Protocol</label>
								<textarea
									value={formData.rehabProtocol || ''}
									onChange={e => handleFieldChange('rehabProtocol', e.target.value)}
									className="textarea-base"
									rows={3}
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">iv) Advice</label>
								<textarea
									value={formData.advice || ''}
									onChange={e => handleFieldChange('advice', e.target.value)}
									className="textarea-base"
									rows={3}
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">v) Remarks</label>
								<textarea
									value={formData.managementRemarks || ''}
									onChange={e => handleFieldChange('managementRemarks', e.target.value)}
									className="textarea-base"
									rows={3}
								/>
							</div>
						</div>
					</div>

					{/* Follow-Up Visit Summary */}
					<div className="mb-8">
						<h3 className="mb-4 text-sm font-semibold text-sky-600">Follow-Up Visit Summary</h3>
						<table className="min-w-full divide-y divide-slate-200 border border-slate-300 text-left text-sm">
							<thead className="bg-slate-100">
								<tr>
									<th className="px-3 py-2 font-semibold text-slate-700">Visit</th>
									<th className="px-3 py-2 font-semibold text-slate-700">Pain Level (VAS)</th>
									<th className="px-3 py-2 font-semibold text-slate-700">Findings / Progress</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-200 bg-white">
								{[1, 2, 3, 4].map(index => {
									const visit = formData.followUpVisits?.[index - 1] || { visitDate: '', painLevel: '', findings: '' };
									return (
										<tr key={`visit-${index}`}>
											<td className="px-3 py-2">
												<input
													type="date"
													value={visit.visitDate}
													onChange={e => {
														const newVisits = [...(formData.followUpVisits || [])];
														newVisits[index - 1] = { ...visit, visitDate: e.target.value };
														handleFieldChange('followUpVisits', newVisits);
													}}
													className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
													style={{ color: '#1e293b' }}
												/>
											</td>
											<td className="px-3 py-2">
												<input
													type="text"
													value={visit.painLevel}
													onChange={e => {
														const newVisits = [...(formData.followUpVisits || [])];
														newVisits[index - 1] = { ...visit, painLevel: e.target.value };
														handleFieldChange('followUpVisits', newVisits);
													}}
													className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
													style={{ color: '#1e293b' }}
												/>
											</td>
											<td className="px-3 py-2">
												<input
													type="text"
													value={visit.findings}
													onChange={e => {
														const newVisits = [...(formData.followUpVisits || [])];
														newVisits[index - 1] = { ...visit, findings: e.target.value };
														handleFieldChange('followUpVisits', newVisits);
													}}
													className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
													style={{ color: '#1e293b' }}
												/>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>

					{/* Current Status */}
					<div className="mb-8">
						<h3 className="mb-4 text-sm font-semibold text-sky-600">Current Status (as on last visit)</h3>
						<div className="grid gap-4 sm:grid-cols-2">
							<div>
								<label className="block text-xs font-medium text-slate-500">Pain</label>
								<select
									value={formData.currentPainStatus || ''}
									onChange={e => handleFieldChange('currentPainStatus', e.target.value)}
									className="select-base"
								>
									<option value="">Select</option>
									<option value="Improved">Improved</option>
									<option value="Same">Same</option>
									<option value="Worsened">Worsened</option>
								</select>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">ROM</label>
								<input
									type="text"
									value={formData.currentRom || ''}
									onChange={e => handleFieldChange('currentRom', e.target.value)}
									className="input-base"
									placeholder="Improved by _*"
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">Strength</label>
								<input
									type="text"
									value={formData.currentStrength || ''}
									onChange={e => handleFieldChange('currentStrength', e.target.value)}
									className="input-base"
									placeholder="_% improvement noted"
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">Functional Ability</label>
								<select
									value={formData.currentFunctionalAbility || ''}
									onChange={e => handleFieldChange('currentFunctionalAbility', e.target.value)}
									className="select-base"
								>
									<option value="">Select</option>
									<option value="Improved">Improved</option>
									<option value="Restricted">Restricted</option>
								</select>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500">Compliance with HEP</label>
								<select
									value={formData.complianceWithHEP || ''}
									onChange={e => handleFieldChange('complianceWithHEP', e.target.value)}
									className="select-base"
								>
									<option value="">Select</option>
									<option value="Excellent">Excellent</option>
									<option value="Moderate">Moderate</option>
									<option value="Poor">Poor</option>
								</select>
							</div>
							<div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
								<div>
									<label className="block text-xs font-medium text-slate-500">Next Follow-Up Date</label>
									<input
										type="date"
										value={formData.nextFollowUpDate || ''}
										onChange={e => handleFieldChange('nextFollowUpDate', e.target.value)}
										className="input-base"
									/>
								</div>
								<div>
									<label className="block text-xs font-medium text-slate-500">Next Follow-Up Time</label>
									<input
										type="time"
										value={formData.nextFollowUpTime || ''}
										onChange={e => handleFieldChange('nextFollowUpTime', e.target.value)}
										className="input-base"
									/>
								</div>
							</div>
						</div>
					</div>

					{/* Save Button */}
					<div className="flex items-center justify-between border-t border-slate-200 pt-6">
						<label className="flex items-center gap-2 cursor-pointer">
							<input
								type="checkbox"
								checked={sessionCompleted}
								onChange={e => {
									const checked = e.target.checked;
									setSessionCompleted(checked);
									// Update formData only when saving, not here
									// The displayedRemainingSessions will handle the display update
								}}
								disabled={saving || !selectedPatient}
								className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-200 disabled:opacity-50 disabled:cursor-not-allowed"
							/>
							<span className="text-sm font-medium text-slate-700">
								Completion of one session
							</span>
						</label>
						<div className="flex items-center gap-3">
							<button
								type="button"
								onClick={() => {
									setSelectedPatient(null);
									router.push('/clinical-team/edit-report');
								}}
								className="btn-secondary"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleCrispReport}
								className="btn-secondary"
								disabled={!selectedPatient}
							>
								<i className="fas fa-file-alt text-xs" aria-hidden="true" />
								Crisp Report
							</button>
							<button
								type="button"
								onClick={() => handlePrint()}
								className="btn-secondary"
								disabled={!selectedPatient}
							>
								<i className="fas fa-print text-xs" aria-hidden="true" />
								Print Report
							</button>
							<button
								type="button"
								onClick={() => handleDownloadPDF()}
								className="btn-secondary"
								disabled={!selectedPatient}
							>
								<i className="fas fa-download text-xs" aria-hidden="true" />
								Download PDF
							</button>
							<button 
								type="button" 
								onClick={handleViewVersionHistory} 
								className="btn-secondary" 
								disabled={!selectedPatient}
							>
								<i className="fas fa-history text-xs" aria-hidden="true" />
								Report History
							</button>
							<button type="button" onClick={handleSave} className="btn-primary" disabled={saving}>
								<i className="fas fa-save text-xs" aria-hidden="true" />
								{saving ? 'Saving...' : 'Save Report'}
							</button>
						</div>
					</div>
				</div>
			</div>

			{/* Crisp Report Modal */}
			{showCrispReportModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 px-4 py-6">
					<div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
						<div className="flex items-center justify-between p-6 border-b border-slate-200">
							<h2 className="text-xl font-semibold text-slate-900">Select Report Sections</h2>
							<button
								type="button"
								onClick={() => setShowCrispReportModal(false)}
								className="text-slate-400 hover:text-slate-600 transition"
								aria-label="Close"
							>
								<i className="fas fa-times text-xl" />
							</button>
						</div>
						<div className="flex-1 overflow-y-auto p-6">
							<div className="space-y-3">
								{allSections.map(section => (
									<label
										key={section.key}
										className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer"
									>
										<input
											type="checkbox"
											checked={selectedSections.includes(section.key)}
											onChange={() => toggleSection(section.key)}
											className="h-4 w-4 border-slate-300 text-sky-600 focus:ring-sky-200 rounded"
										/>
										<span className="text-sm font-medium text-slate-700">{section.label}</span>
									</label>
								))}
							</div>
						</div>
						<div className="flex items-center justify-end gap-3 border-t border-slate-200 p-6">
							<button
								type="button"
								onClick={() => setShowCrispReportModal(false)}
								className="btn-secondary"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleCrispReportDownload}
								className="btn-secondary"
								disabled={selectedSections.length === 0}
							>
								<i className="fas fa-download text-xs" aria-hidden="true" />
								Download PDF
							</button>
							<button
								type="button"
								onClick={handleCrispReportPrint}
								className="btn-primary"
								disabled={selectedSections.length === 0}
							>
								<i className="fas fa-print text-xs" aria-hidden="true" />
								Print
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Report History Modal */}
			{showVersionHistory && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 px-4 py-6">
					<div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[95vh] overflow-hidden flex flex-col">
						<div className="flex items-center justify-between p-6 border-b border-slate-200">
							<h2 className="text-xl font-semibold text-slate-900">
								Report History - {selectedPatient?.name} ({selectedPatient?.patientId})
							</h2>
							<button
								type="button"
								onClick={() => setShowVersionHistory(false)}
								className="text-slate-400 hover:text-slate-600 transition"
								aria-label="Close"
							>
								<i className="fas fa-times text-xl" />
							</button>
						</div>
						<div className="flex-1 overflow-y-auto p-6">
							{loadingVersions ? (
								<div className="text-center py-12">
									<div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-slate-900 border-r-transparent"></div>
									<p className="mt-4 text-sm text-slate-600">Loading report history...</p>
								</div>
							) : versionHistory.length === 0 ? (
								<div className="text-center py-12">
									<p className="text-slate-600">No report history available for this patient.</p>
									<p className="text-sm text-slate-500 mt-2">Previous reports will appear here when you save changes to the report.</p>
								</div>
							) : (
								<div className="space-y-4">
									{versionHistory.map((version) => (
										<div
											key={version.id}
											className="border border-slate-200 rounded-lg p-4 hover:bg-slate-50 transition"
										>
											<div className="flex items-center justify-between mb-3">
												<div>
													<div className="flex items-center gap-2">
														<span className="font-semibold text-slate-900">Report #{version.version}</span>
														{version.version === versionHistory[0]?.version && (
															<span className="px-2 py-1 text-xs font-medium bg-sky-100 text-sky-700 rounded">
																Latest
															</span>
														)}
													</div>
													<p className="text-sm text-slate-600 mt-1">
														Saved by {version.createdBy} on{' '}
														{new Date(version.createdAt).toLocaleString()}
													</p>
												</div>
											</div>
											<div className="text-xs text-slate-500 space-y-1 mb-3">
												{version.data.dateOfConsultation && (
													<p>Consultation Date: {version.data.dateOfConsultation}</p>
												)}
												{version.data.chiefComplaint && (
													<p>Chief Complaint: {version.data.chiefComplaint}</p>
												)}
												{version.data.clinicalDiagnosis && (
													<p>Diagnosis: {version.data.clinicalDiagnosis}</p>
												)}
											</div>
											<button
												type="button"
												onClick={() => setViewingVersion(version)}
												className="px-4 py-2 text-sm font-medium text-sky-600 bg-sky-50 border border-sky-200 rounded-md hover:bg-sky-100 transition"
											>
												<i className="fas fa-eye mr-2" />
												View Full Report
											</button>
										</div>
									))}
								</div>
							)}
						</div>
						<div className="flex items-center justify-end p-6 border-t border-slate-200">
							<button
								type="button"
								onClick={() => setShowVersionHistory(false)}
								className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 transition"
							>
								Close
							</button>
						</div>
					</div>
				</div>
			)}

			{/* View Report Modal */}
			{viewingVersion && selectedPatient && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 px-4 py-6">
					<div className="bg-white rounded-lg shadow-xl max-w-6xl w-full mx-4 max-h-[95vh] overflow-hidden flex flex-col">
						<div className="flex items-center justify-between p-6 border-b border-slate-200">
							<h2 className="text-xl font-semibold text-slate-900">
								Report #{viewingVersion.version} - {selectedPatient.name} ({selectedPatient.patientId})
							</h2>
							<button
								type="button"
								onClick={() => setViewingVersion(null)}
								className="text-slate-400 hover:text-slate-600 transition"
								aria-label="Close"
							>
								<i className="fas fa-times text-xl" />
							</button>
						</div>
						<div className="flex-1 overflow-y-auto p-6">
							<div className="section-card">
								{/* Patient Information */}
								<div className="mb-8 border-b border-slate-200 pb-6">
									<h2 className="mb-4 text-xl font-bold text-sky-600">Physiotherapy Report</h2>
									<div className="mb-4 text-right text-sm text-slate-600">
										<div>
											<b>Clinic:</b> Centre For Sports Science, Kanteerava Stadium
										</div>
										<div>
											<b>Report Date:</b> {viewingVersion.data.dateOfConsultation || new Date(viewingVersion.createdAt).toLocaleDateString()}
										</div>
										<div>
											<b>Saved:</b> {new Date(viewingVersion.createdAt).toLocaleString()} by {viewingVersion.createdBy}
										</div>
									</div>
									<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
										<div>
											<label className="block text-xs font-medium text-slate-500">Patient Name</label>
											<input
												type="text"
												value={selectedPatient.name}
												readOnly
												className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
											/>
										</div>
										<div>
											<label className="block text-xs font-medium text-slate-500">Patient ID</label>
											<input
												type="text"
												value={selectedPatient.patientId}
												readOnly
												className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
											/>
										</div>
										<div>
											<label className="block text-xs font-medium text-slate-500">Date of Birth</label>
											<input
												type="date"
												value={selectedPatient.dob}
												readOnly
												className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
											/>
										</div>
									</div>
								</div>

								{/* Assessment Section - Read Only */}
								<div className="space-y-6">
									{viewingVersion.data.dateOfConsultation && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">Date of Consultation</label>
											<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
												{viewingVersion.data.dateOfConsultation}
											</div>
										</div>
									)}

									{viewingVersion.data.complaints && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">Complaints</label>
											<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
												{viewingVersion.data.complaints}
											</div>
										</div>
									)}

									{viewingVersion.data.chiefComplaint && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">Chief Complaint</label>
											<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
												{viewingVersion.data.chiefComplaint}
											</div>
										</div>
									)}

									{viewingVersion.data.presentHistory && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">Present History</label>
											<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
												{viewingVersion.data.presentHistory}
											</div>
										</div>
									)}

									{viewingVersion.data.pastHistory && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">Past History</label>
											<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
												{viewingVersion.data.pastHistory}
											</div>
										</div>
									)}

									{((viewingVersion.data.med_xray || viewingVersion.data.med_mri || viewingVersion.data.med_report || viewingVersion.data.med_ct) || viewingVersion.data.surgicalHistory) && (
										<div className="grid gap-4 sm:grid-cols-2">
											{(viewingVersion.data.med_xray || viewingVersion.data.med_mri || viewingVersion.data.med_report || viewingVersion.data.med_ct) && (
												<div>
													<label className="block text-xs font-medium text-slate-500 mb-1">Medical History</label>
													<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
														{[
															viewingVersion.data.med_xray && 'X-RAYS',
															viewingVersion.data.med_mri && 'MRI',
															viewingVersion.data.med_report && 'Reports',
															viewingVersion.data.med_ct && 'CT Scans'
														].filter(Boolean).join(', ') || '—'}
													</div>
												</div>
											)}
											{viewingVersion.data.surgicalHistory && (
												<div>
													<label className="block text-xs font-medium text-slate-500 mb-1">Surgical History</label>
													<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
														{viewingVersion.data.surgicalHistory}
													</div>
												</div>
											)}
										</div>
									)}

									{((viewingVersion.data.per_smoking || viewingVersion.data.per_drinking || viewingVersion.data.per_alcohol || viewingVersion.data.per_drugs) || viewingVersion.data.sleepCycle || viewingVersion.data.hydration || viewingVersion.data.nutrition) && (
										<div className="grid gap-4 sm:grid-cols-2">
											{(viewingVersion.data.per_smoking || viewingVersion.data.per_drinking || viewingVersion.data.per_alcohol || viewingVersion.data.per_drugs) && (
												<div>
													<label className="block text-xs font-medium text-slate-500 mb-1">Personal History</label>
													<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
														{[
															viewingVersion.data.per_smoking && 'Smoking',
															viewingVersion.data.per_drinking && 'Drinking',
															viewingVersion.data.per_alcohol && 'Alcohol',
															viewingVersion.data.per_drugs && `Drugs${viewingVersion.data.drugsText ? ` (${viewingVersion.data.drugsText})` : ''}`
														].filter(Boolean).join(', ') || '—'}
													</div>
												</div>
											)}
											{viewingVersion.data.sleepCycle && (
												<div>
													<label className="block text-xs font-medium text-slate-500 mb-1">Sleep Cycle</label>
													<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
														{viewingVersion.data.sleepCycle}
													</div>
												</div>
											)}
											{viewingVersion.data.hydration && (
												<div>
													<label className="block text-xs font-medium text-slate-500 mb-1">Hydration</label>
													<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
														{viewingVersion.data.hydration}/8 {HYDRATION_EMOJIS[Math.min(HYDRATION_EMOJIS.length - 1, Math.max(1, Number(viewingVersion.data.hydration)) - 1)]}
													</div>
												</div>
											)}
											{viewingVersion.data.nutrition && (
												<div>
													<label className="block text-xs font-medium text-slate-500 mb-1">Nutrition</label>
													<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
														{viewingVersion.data.nutrition}
													</div>
												</div>
											)}
										</div>
									)}

									{(viewingVersion.data.siteSide || viewingVersion.data.onset || viewingVersion.data.duration || viewingVersion.data.natureOfInjury || viewingVersion.data.typeOfPain || viewingVersion.data.aggravatingFactor || viewingVersion.data.relievingFactor) && (
										<div>
											<h3 className="text-sm font-semibold text-sky-600 mb-3 border-b border-sky-200 pb-2">Pain Assessment</h3>
											<div className="grid gap-4 sm:grid-cols-2">
												{viewingVersion.data.siteSide && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Site and Side</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{viewingVersion.data.siteSide}
														</div>
													</div>
												)}
												{viewingVersion.data.onset && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Onset</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{viewingVersion.data.onset}
														</div>
													</div>
												)}
												{viewingVersion.data.duration && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Duration</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{viewingVersion.data.duration}
														</div>
													</div>
												)}
												{viewingVersion.data.natureOfInjury && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Nature of Injury</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{viewingVersion.data.natureOfInjury}
														</div>
													</div>
												)}
												{viewingVersion.data.typeOfPain && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Type of Pain</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{viewingVersion.data.typeOfPain}
														</div>
													</div>
												)}
												{viewingVersion.data.aggravatingFactor && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Aggravating Factor</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
															{viewingVersion.data.aggravatingFactor}
														</div>
													</div>
												)}
												{viewingVersion.data.relievingFactor && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Relieving Factor</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
															{viewingVersion.data.relievingFactor}
														</div>
													</div>
												)}
											</div>
										</div>
									)}

									{viewingVersion.data.clinicalDiagnosis && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">Clinical Diagnosis</label>
											<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
												{viewingVersion.data.clinicalDiagnosis}
											</div>
										</div>
									)}

									{viewingVersion.data.vasScale && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">VAS Scale</label>
											<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
												{viewingVersion.data.vasScale} {VAS_EMOJIS[Math.min(VAS_EMOJIS.length - 1, Math.max(1, Number(viewingVersion.data.vasScale)) - 1)]}
											</div>
										</div>
									)}

									{viewingVersion.data.rom && Object.keys(viewingVersion.data.rom).length > 0 && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-2">ROM (Range of Motion)</label>
											<div className="bg-slate-50 border border-slate-200 rounded-md p-4">
												{Object.entries(viewingVersion.data.rom).map(([joint, data]: [string, any]) => (
													<div key={joint} className="mb-4 last:mb-0">
														<h6 className="text-sm font-semibold text-sky-600 mb-2">{joint}</h6>
														{data && typeof data === 'object' && (
															<div className="text-xs text-slate-700 space-y-1 ml-4">
																{Object.entries(data).map(([motion, value]: [string, any]) => (
																	<div key={motion}>
																		<span className="font-medium">{motion}:</span> {String(value || '—')}
																	</div>
																))}
															</div>
														)}
													</div>
												))}
											</div>
										</div>
									)}

									{viewingVersion.data.mmt && Object.keys(viewingVersion.data.mmt).length > 0 && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-2">MMT (Manual Muscle Testing)</label>
											<div className="bg-slate-50 border border-slate-200 rounded-md p-4">
												{Object.entries(viewingVersion.data.mmt).map(([joint, data]: [string, any]) => (
													<div key={joint} className="mb-4 last:mb-0">
														<h6 className="text-sm font-semibold text-sky-600 mb-2">{joint}</h6>
														{data && typeof data === 'object' && (
															<div className="text-xs text-slate-700 space-y-1 ml-4">
																{Object.entries(data).map(([motion, value]: [string, any]) => (
																	<div key={motion}>
																		<span className="font-medium">{motion}:</span> {String(value || '—')}
																	</div>
																))}
															</div>
														)}
													</div>
												))}
											</div>
										</div>
									)}

									{viewingVersion.data.recommendations && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">Recommendations</label>
											<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
												{viewingVersion.data.recommendations}
											</div>
										</div>
									)}

									{viewingVersion.data.physiotherapistRemarks && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">Physiotherapist Remarks</label>
											<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
												{viewingVersion.data.physiotherapistRemarks}
											</div>
										</div>
									)}

									{viewingVersion.data.nextFollowUpDate && (
										<div className="grid gap-4 sm:grid-cols-2">
											<div>
												<label className="block text-xs font-medium text-slate-500 mb-1">Next Follow-up Date</label>
												<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
													{viewingVersion.data.nextFollowUpDate}
												</div>
											</div>
											{viewingVersion.data.nextFollowUpTime && (
												<div>
													<label className="block text-xs font-medium text-slate-500 mb-1">Next Follow-up Time</label>
													<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
														{viewingVersion.data.nextFollowUpTime}
													</div>
												</div>
											)}
										</div>
									)}
								</div>
							</div>
						</div>
						<div className="flex items-center justify-end p-6 border-t border-slate-200">
							<button
								type="button"
								onClick={() => setViewingVersion(null)}
								className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 transition"
							>
								Close
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Report Modal */}
			<EditReportModal
				isOpen={showReportModal}
				patientId={reportModalPatientId}
				initialTab="report"
				onClose={handleCloseReportModal}
			/>

			{/* Analytics Modal */}
			{showAnalyticsModal && analyticsModalPatientId && (
				<div 
					className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 px-4 py-6"
					onClick={(e) => {
						// Close modal when clicking outside
						if (e.target === e.currentTarget) {
							setShowAnalyticsModal(false);
							setAnalyticsModalPatientId(null);
							setAnalyticsModalPatientName(null);
						}
					}}
				>
					<div className="w-full max-w-6xl rounded-2xl border border-slate-200 bg-white shadow-2xl max-h-[90vh] flex flex-col">
						<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
							<div>
								<h2 className="text-lg font-semibold text-slate-900">Progress Analytics</h2>
								<p className="text-xs text-slate-500">
									{analyticsModalPatientName && `Analytics for ${analyticsModalPatientName}`}
									{analyticsModalPatientId && ` (${analyticsModalPatientId})`}
								</p>
							</div>
							<button
								type="button"
								onClick={() => {
									setShowAnalyticsModal(false);
									setAnalyticsModalPatientId(null);
									setAnalyticsModalPatientName(null);
								}}
								className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:bg-slate-100 focus-visible:text-slate-600 focus-visible:outline-none"
								aria-label="Close dialog"
							>
								<i className="fas fa-times" aria-hidden="true" />
							</button>
						</header>
						<div className="flex-1 overflow-y-auto px-6 py-4">
							<PatientProgressAnalytics 
								patientId={analyticsModalPatientId} 
								patientName={analyticsModalPatientName || undefined}
							/>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
