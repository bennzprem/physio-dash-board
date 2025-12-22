'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { collection, doc, onSnapshot, updateDoc, deleteDoc, query, where, getDocs, writeBatch, addDoc, serverTimestamp, orderBy, type QuerySnapshot, type Timestamp } from 'firebase/firestore';

import {
	type AdminGenderOption,
	type AdminPatientStatus,
	type AdminAppointmentStatus,
} from '@/lib/adminMockData';
import { db } from '@/lib/firebase';
import { generatePhysiotherapyReportPDF, generateStrengthConditioningPDF, type ReportSection } from '@/lib/pdfGenerator';
import type { PatientRecordFull } from '@/lib/types';
import PageHeader from '@/components/PageHeader';
import { sendEmailNotification } from '@/lib/email';
import { sendSMSNotification, isValidPhoneNumber } from '@/lib/sms';
import { checkAppointmentConflict } from '@/lib/appointmentUtils';
import { createInitialSessionAllowance } from '@/lib/sessionAllowance';
import { useAuth } from '@/contexts/AuthContext';
import ReportModal from '@/components/frontdesk/ReportModal';

type PaymentTypeOption = 'with' | 'without';
type PatientTypeOption = 'DYES' | 'VIP' | 'GETHNA' | 'PAID' | 'OTHERS' | '';

// ROM constants for report display
const ROM_MOTIONS: Record<string, Array<{ motion: string }>> = {
	Neck: [{ motion: 'Flexion' }, { motion: 'Extension' }, { motion: 'Lateral Flexion' }, { motion: 'Rotation' }],
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
	Toes: [{ motion: 'Flexion' }, { motion: 'Extension' }],
};

const ROM_HAS_SIDE: Record<string, boolean> = {
	Shoulder: true,
	Elbow: true,
	Forearm: true,
	Wrist: true,
	Knee: true,
	Ankle: true,
	Toes: true,
};

// Helper functions for report display
function getMedicalHistoryText(p: any): string {
	const items: string[] = [];
	if (p.med_xray) items.push('X RAYS');
	if (p.med_mri) items.push('MRI');
	if (p.med_report) items.push('Reports');
	if (p.med_ct) items.push('CT Scans');
	return items.join(', ') || 'N/A';
}

function getPersonalHistoryText(p: any): string {
	const items: string[] = [];
	if (p.per_smoking) items.push('Smoking');
	if (p.per_drinking) items.push('Drinking');
	if (p.per_alcohol) items.push('Alcohol');
	if (p.per_drugs) {
		items.push('Drugs: ' + (p.drugsText || ''));
	}
	return items.join(', ') || 'N/A';
}

function renderRomView(romData: Record<string, any> | undefined) {
	if (!romData || !Object.keys(romData).length) {
		return <p className="text-sm italic text-slate-500">No ROM joints recorded.</p>;
	}

	return (
		<div className="space-y-4">
			{Object.keys(romData).map(joint => (
				<div key={joint} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
					<h6 className="mb-3 text-sm font-semibold text-sky-600">{joint}</h6>
					{renderRomTable(joint, romData[joint])}
				</div>
			))}
		</div>
	);
}

function renderRomTable(joint: string, data: any) {
	if (!ROM_HAS_SIDE[joint]) {
		return (
			<table className="min-w-full divide-y divide-slate-200 border border-slate-300 text-left text-sm">
				<thead className="bg-slate-100">
					<tr>
						<th className="px-3 py-2 font-semibold text-slate-700">Motion</th>
						<th className="px-3 py-2 font-semibold text-slate-700">Value</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-slate-200 bg-white">
					{ROM_MOTIONS[joint]?.map(({ motion }) => {
						const val = data[motion];
						if (!val) return null;
						return (
							<tr key={motion}>
								<td className="px-3 py-2 text-slate-700">{motion}</td>
								<td className="px-3 py-2 font-medium text-slate-900">{val}</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		);
	}

	return (
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
				{ROM_MOTIONS[joint]?.map(({ motion }) => {
					const lv = data.left?.[motion] || '';
					const rv = data.right?.[motion] || '';
					if (!lv && !rv) return null;
					return (
						<tr key={motion}>
							<td className="px-3 py-2 text-slate-700">{motion}</td>
							<td className="px-3 py-2 font-medium text-slate-900">{lv}</td>
							<td className="px-3 py-2 text-slate-700">{motion}</td>
							<td className="px-3 py-2 font-medium text-slate-900">{rv}</td>
						</tr>
					);
				})}
			</tbody>
		</table>
	);
}

interface FrontdeskPatient {
	id?: string;
	patientId: string;
	name: string;
	dob: string;
	gender: AdminGenderOption;
	phone: string;
	email?: string;
	address?: string;
	complaint?: string;
	status: AdminPatientStatus;
	registeredAt: string;
	patientType: PatientTypeOption;
	paymentType: PaymentTypeOption;
	paymentDescription?: string;
	concessionPercent?: number | null;
	assignedDoctor?: string;
	totalSessionsRequired?: number;
	remainingSessions?: number;
	assignedFrontdeskId?: string;
	assignedFrontdeskName?: string;
	assignedFrontdeskEmail?: string;
	packageAmount?: number | null;
	readyForNewAppointment?: boolean;
	registeredBy?: string;
	registeredByName?: string;
	registeredByEmail?: string;
}

interface DayAvailability {
	enabled: boolean;
	slots: Array<{ start: string; end: string }>;
	unavailableSlots?: Array<{ start: string; end: string }>;
}

interface DateSpecificAvailability {
	[date: string]: DayAvailability;
}

interface StaffMember {
	id: string;
	userName: string;
	role: string;
	status: string;
	userEmail?: string;
	availability?: Record<string, DayAvailability>;
	dateSpecificAvailability?: DateSpecificAvailability;
}

interface AppointmentRecord {
	id: string;
	appointmentId: string;
	patientId: string;
	patient?: string;
	doctor: string;
	date: string;
	time: string;
	duration?: number;
	status: AdminAppointmentStatus;
}

interface BillingRecord {
	id?: string;
	billingId: string;
	appointmentId?: string;
	patient: string;
	patientId: string;
	doctor?: string;
	amount: number;
	date: string;
	status: 'Pending' | 'Completed';
	paymentMode?: string;
	utr?: string;
	packageAmount?: number | null;
	concessionPercent?: number | null;
	amountPaid?: number;
}

interface BookingFormState {
	patientId: string;
	doctor: string;
	date: string;
	time: string;
	duration: number;
	notes?: string;
}

interface RegisterFormState {
	fullName: string;
	dob: string;
	gender: AdminGenderOption;
	phone: string;
	email: string;
	address: string;
	patientType: PatientTypeOption;
}

interface PackageSetupFormState {
	totalNoOfSessions: string;
	paymentType: PaymentTypeOption | '';
	paymentDescription: string;
	packageAmount: string;
	concessionPercent: string;
}

interface RegisterNotice {
	type: 'success' | 'error';
	message: string;
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

const STATUS_FILTER_OPTIONS: Array<{ value: 'all' | AdminPatientStatus; label: string }> = [
	{ value: 'all', label: 'All statuses' },
	...STATUS_OPTIONS,
];

const GENDER_OPTIONS: Array<{ value: AdminGenderOption; label: string }> = [
	{ value: '', label: 'Select' },
	{ value: 'Male', label: 'Male' },
	{ value: 'Female', label: 'Female' },
	{ value: 'Other', label: 'Other' },
];

const PATIENT_TYPE_OPTIONS: Array<{ value: PatientTypeOption; label: string }> = [
	{ value: 'DYES', label: 'DYES' },
	{ value: 'VIP', label: 'VIP' },
	{ value: 'PAID', label: 'PAID' },
	{ value: 'GETHNA', label: 'GETHNA' },
	{ value: 'OTHERS', label: 'Others' },
];

const PAYMENT_OPTIONS: Array<{ value: PaymentTypeOption; label: string }> = [
	{ value: 'with', label: 'With Concession' },
	{ value: 'without', label: 'Without Concession' },
];

const PHONE_REGEX = /^[0-9]{10,15}$/;
const SLOT_INTERVAL_MINUTES = 30;
const MAX_BLOCK_DURATION_MINUTES = 120;
const APPOINTMENT_BOOKING_CHARGE = 1500;

function hasSixMonthsElapsed(dateString?: string | null): boolean {
	if (!dateString) return false;
	const date = new Date(dateString);
	if (Number.isNaN(date.getTime())) return false;
	const sixMonthsLater = new Date(date);
	sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);
	return new Date() >= sixMonthsLater;
}

const REGISTER_FORM_INITIAL_STATE: RegisterFormState = {
	fullName: '',
	dob: '',
	gender: '' as AdminGenderOption,
	phone: '',
	email: '',
	address: '',
	patientType: '' as PatientTypeOption,
};

const PACKAGE_FORM_INITIAL_STATE: PackageSetupFormState = {
	totalNoOfSessions: '',
	paymentType: '',
	paymentDescription: '',
	packageAmount: '',
	concessionPercent: '',
};

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

function formatDateLabel(value: string) {
	if (!value) return '—';
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return value;
	return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
}

function timeStringToMinutes(time: string) {
	const [hours, minutes] = time.split(':').map(Number);
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

export default function Patients() {
	const { user } = useAuth();
	const [patients, setPatients] = useState<FrontdeskPatient[]>([]);
	const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
	const [staff, setStaff] = useState<StaffMember[]>([]);
	const [loading, setLoading] = useState(true);
	const [searchTerm, setSearchTerm] = useState('');
	const [statusFilter, setStatusFilter] = useState<'all' | AdminPatientStatus>('all');
	const [editingId, setEditingId] = useState<string | null>(null);
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const [isDialogOpen, setIsDialogOpen] = useState(false);
	const [showDeletedPatients, setShowDeletedPatients] = useState(false);
	const [deleteConfirmation, setDeleteConfirmation] = useState<{ patient: FrontdeskPatient | null; nameInput: string }>({ patient: null, nameInput: '' });
	const [formState, setFormState] = useState<Omit<FrontdeskPatient, 'id' | 'registeredAt'>>({
		patientId: '',
		name: '',
		dob: '',
		gender: '',
		phone: '',
		email: '',
		address: '',
		complaint: '',
		status: 'pending',
		patientType: '',
		paymentType: 'without',
		paymentDescription: '',
		assignedDoctor: '',
	});
	const [formErrors, setFormErrors] = useState<Partial<Record<keyof typeof formState, string>>>({});
	const [originalDoctor, setOriginalDoctor] = useState<string>('');
	const [bookingForm, setBookingForm] = useState<BookingFormState>({
		patientId: '',
		doctor: '',
		date: '',
		time: '',
		duration: 0,
		notes: '',
	});
	const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
	const [bookingLoading, setBookingLoading] = useState(false);
	const [showBookingModal, setShowBookingModal] = useState(false);
	const [showRegisterModal, setShowRegisterModal] = useState(false);
	const [registerForm, setRegisterForm] = useState<RegisterFormState>(REGISTER_FORM_INITIAL_STATE);
	const [registerFormErrors, setRegisterFormErrors] = useState<Partial<Record<keyof RegisterFormState, string>>>({});
	const [registerSubmitting, setRegisterSubmitting] = useState(false);
	const [registerNotice, setRegisterNotice] = useState<RegisterNotice | null>(null);
	const [bookAppointment, setBookAppointment] = useState(false);
	const [registerAppointmentForm, setRegisterAppointmentForm] = useState({
		doctor: '',
		date: '',
		time: '',
		duration: 0,
		notes: '',
	});
	const [registerSelectedSlots, setRegisterSelectedSlots] = useState<string[]>([]);
	const [openMenuId, setOpenMenuId] = useState<string | null>(null);
	const [viewingPatient, setViewingPatient] = useState<FrontdeskPatient | null>(null);
	const [billing, setBilling] = useState<BillingRecord[]>([]);
	const [showPaymentModal, setShowPaymentModal] = useState(false);
	const [selectedPaymentBill, setSelectedPaymentBill] = useState<BillingRecord | null>(null);
	const [paymentMode, setPaymentMode] = useState('Cash');
	const [utr, setUtr] = useState('');
	const [processingPayment, setProcessingPayment] = useState(false);
	const [showPackageModal, setShowPackageModal] = useState(false);
	const [packageModalPatient, setPackageModalPatient] = useState<FrontdeskPatient | null>(null);
	const [packageForm, setPackageForm] = useState<PackageSetupFormState>(PACKAGE_FORM_INITIAL_STATE);
	const [packageFormErrors, setPackageFormErrors] = useState<
		Partial<Record<keyof PackageSetupFormState, string>>
	>({});
	const [packageSubmitting, setPackageSubmitting] = useState(false);
	
	// Report viewing state
	const [showReportModal, setShowReportModal] = useState(false);
	const [reportModalPatientId, setReportModalPatientId] = useState<string | null>(null);
	const [reportModalInitialTab, setReportModalInitialTab] = useState<'report' | 'strength-conditioning'>('report');
	
	// Version history state
	const [showVersionHistory, setShowVersionHistory] = useState(false);
	const [versionHistory, setVersionHistory] = useState<Array<{
		id: string;
		version: number;
		createdAt: string;
		createdBy: string;
		data: Partial<PatientRecordFull>;
	}>>([]);
	const [loadingVersions, setLoadingVersions] = useState(false);
	const [viewingVersionData, setViewingVersionData] = useState<Partial<PatientRecordFull> | null>(null);
	

	useEffect(() => {
		function handleGlobalClick(event: MouseEvent) {
			const target = event.target as HTMLElement | null;
			if (!target?.closest('[data-patient-actions]')) {
				setOpenMenuId(null);
			}
		}

		document.addEventListener('mousedown', handleGlobalClick);
		return () => document.removeEventListener('mousedown', handleGlobalClick);
	}, []);

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
						email: data.email ? String(data.email) : undefined,
						address: data.address ? String(data.address) : undefined,
						complaint: data.complaint ? String(data.complaint) : undefined,
						status: (data.status as AdminPatientStatus) ?? 'pending',
						registeredAt: created ? created.toISOString() : (data.registeredAt as string | undefined) || new Date().toISOString(),
						patientType: (data.patientType as PatientTypeOption) || '',
						paymentType: (data.paymentType as PaymentTypeOption) || 'without',
						paymentDescription: data.paymentDescription ? String(data.paymentDescription) : undefined,
						assignedDoctor: data.assignedDoctor ? String(data.assignedDoctor) : undefined,
						assignedFrontdeskId: data.assignedFrontdeskId ? String(data.assignedFrontdeskId) : undefined,
						assignedFrontdeskName: data.assignedFrontdeskName ? String(data.assignedFrontdeskName) : undefined,
						assignedFrontdeskEmail: data.assignedFrontdeskEmail ? String(data.assignedFrontdeskEmail) : undefined,
						packageAmount:
							typeof data.packageAmount === 'number'
								? data.packageAmount
								: data.packageAmount
									? Number(data.packageAmount)
									: null,
						concessionPercent:
							typeof data.concessionPercent === 'number'
								? data.concessionPercent
								: data.concessionPercent
									? Number(data.concessionPercent)
									: null,
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
						readyForNewAppointment: data.readyForNewAppointment === true,
						deleted: data.deleted === true,
						deletedAt: deleted ? deleted.toISOString() : (data.deletedAt as string | undefined) || null,
						registeredBy: data.registeredBy ? String(data.registeredBy) : undefined,
						registeredByName: data.registeredByName ? String(data.registeredByName) : undefined,
						registeredByEmail: data.registeredByEmail ? String(data.registeredByEmail) : undefined,
					} as FrontdeskPatient & { deleted?: boolean; deletedAt?: string | null };
				});
				setPatients(mapped);
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

	// Load appointments to check which patients have appointments
	useEffect(() => {
		const unsubscribe = onSnapshot(
			collection(db, 'appointments'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data();
					return {
						id: docSnap.id,
						appointmentId: data.appointmentId ? String(data.appointmentId) : '',
						patientId: data.patientId ? String(data.patientId) : '',
						patient: data.patient ? String(data.patient) : undefined,
						doctor: data.doctor ? String(data.doctor) : '',
						date: data.date ? String(data.date) : '',
						time: data.time ? String(data.time) : '',
						duration: typeof data.duration === 'number' ? data.duration : undefined,
						status: (data.status as AdminAppointmentStatus) ?? 'pending',
					} as AppointmentRecord;
				});
				setAppointments(mapped);
			},
			error => {
				console.error('Failed to load appointments', error);
				setAppointments([]);
			}
		);

		return () => unsubscribe();
	}, []);

	// Load staff for booking options
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
						availability: data.availability as Record<string, DayAvailability> | undefined,
						dateSpecificAvailability: data.dateSpecificAvailability as DateSpecificAvailability | undefined,
					} as StaffMember;
				});
				setStaff(
					mapped.filter(
						member =>
							member.status === 'Active' &&
							['Physiotherapist', 'StrengthAndConditioning', 'ClinicalTeam'].includes(member.role)
					)
				);
			},
			error => {
				console.error('Failed to load staff', error);
				setStaff([]);
			}
		);

		return () => unsubscribe();
	}, []);

	// Load billing records
	useEffect(() => {
		const unsubscribe = onSnapshot(
			collection(db, 'billing'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data();
					return {
						id: docSnap.id,
						billingId: data.billingId ? String(data.billingId) : '',
						appointmentId: data.appointmentId ? String(data.appointmentId) : undefined,
						patient: data.patient ? String(data.patient) : '',
						patientId: data.patientId ? String(data.patientId) : '',
						doctor: data.doctor ? String(data.doctor) : undefined,
						amount: typeof data.amount === 'number' ? data.amount : Number(data.amount) || 0,
						date: data.date ? String(data.date) : '',
						status: (data.status as 'Pending' | 'Completed') || 'Pending',
						paymentMode: data.paymentMode ? String(data.paymentMode) : undefined,
						utr: data.utr ? String(data.utr) : undefined,
						packageAmount:
							typeof data.packageAmount === 'number'
								? data.packageAmount
								: data.packageAmount
									? Number(data.packageAmount)
									: null,
						amountPaid:
							typeof data.amountPaid === 'number'
								? data.amountPaid
								: data.amountPaid
									? Number(data.amountPaid)
									: 0,
					} as BillingRecord;
				});
				setBilling(mapped);
			},
			error => {
				console.error('Failed to load billing', error);
				setBilling([]);
			}
		);

		return () => unsubscribe();
	}, []);

	const filteredPatients = useMemo(() => {
		const query = searchTerm.trim().toLowerCase();
		return patients.filter(patient => {
			// Filter by deleted status
			const isDeleted = (patient as any).deleted === true;
			if (showDeletedPatients && !isDeleted) return false;
			if (!showDeletedPatients && isDeleted) return false;

			const matchesSearch =
				!query ||
				(patient.name || '').toLowerCase().includes(query) ||
				(patient.patientId || '').toLowerCase().includes(query) ||
				(patient.phone || '').toLowerCase().includes(query) ||
				(patient.email || '').toLowerCase().includes(query);
			
			// Status filter: explicitly exclude completed patients when filtering for ongoing
			let matchesStatus = true;
			if (statusFilter === 'ongoing') {
				// When filtering for ongoing, only show patients with status 'ongoing'
				// Explicitly exclude completed patients
				matchesStatus = patient.status === 'ongoing';
			} else if (statusFilter !== 'all') {
				// For other status filters, match exactly
				matchesStatus = patient.status === statusFilter;
			}
			
			return matchesSearch && matchesStatus;
		});
	}, [patients, searchTerm, statusFilter, showDeletedPatients]);

	// Check if patient has any appointments (for first booking check)
	// Button should only show for patients who haven't done their first booking
	const patientHasAppointments = (patientId: string) => {
		return appointments.some(apt => apt.patientId === patientId);
	};

	// Check if patient has a pending consultation (not completed)
	const hasPendingConsultation = (patientId: string): boolean => {
		const consultationBill = getConsultationBill(patientId);
		return consultationBill?.status === 'Pending';
	};

	// Check if patient can book a new consultation
	// Only allow if no consultation exists, or if patient has been reset / waiting period elapsed
	const canBookNewConsultation = (patientId: string, patient?: FrontdeskPatient): boolean => {
		const isDYES = (patient?.patientType || '').toUpperCase() === 'DYES';
		const consultationBill = getConsultationBill(patientId);
		// If no consultation bill exists, can book
		if (!consultationBill) return true;
		
		// DYES patients: no paywall, but must wait six months between consultations
		if (isDYES) {
			if (patient?.readyForNewAppointment === true) return true;
			if (hasSixMonthsElapsed(consultationBill.date)) return true;
			return false;
		}
		
		// If consultation is completed, only allow booking if patient was reset or six months have elapsed
		if (consultationBill.status === 'Completed') {
			if (patient?.readyForNewAppointment === true) {
				return true;
			}

			if (hasSixMonthsElapsed(consultationBill.date)) {
				return true;
			}

			// Consultation completed but waiting period not finished
			return false;
		}
		
		// If consultation is pending, can't book
		return false;
	};

	const getConsultationBill = (patientId: string): BillingRecord | null => {
		// First, try to find a pending consultation bill (most recent)
		const pendingConsultationBills = billing
			.filter(
				bill =>
					bill.patientId === patientId &&
					bill.amount === APPOINTMENT_BOOKING_CHARGE &&
					bill.status === 'Pending'
			)
			.sort((a, b) => {
				// Sort by date, most recent first
				const dateA = new Date(a.date ?? '').getTime();
				const dateB = new Date(b.date ?? '').getTime();
				return dateB - dateA;
			});

		if (pendingConsultationBills.length > 0) {
			return pendingConsultationBills[0];
		}

		// If no pending bills, find the most recent completed consultation bill
		const completedConsultationBills = billing
			.filter(
				bill =>
					bill.patientId === patientId &&
					bill.amount === APPOINTMENT_BOOKING_CHARGE &&
					bill.status === 'Completed'
			)
			.sort((a, b) => {
				// Sort by date, most recent first
				const dateA = new Date(a.date ?? '').getTime();
				const dateB = new Date(b.date ?? '').getTime();
				return dateB - dateA;
			});

		if (completedConsultationBills.length > 0) {
			return completedConsultationBills[0];
		}

		// Fallback: find by first appointment (for backward compatibility)
		const patientAppointments = appointments.filter(apt => apt.patientId === patientId);
		if (patientAppointments.length === 0) return null;

		const sortedAppointments = [...patientAppointments].sort((a, b) => {
			const dateA = new Date(`${a.date ?? ''}T${a.time ?? '00:00'}`).getTime();
			const dateB = new Date(`${b.date ?? ''}T${b.time ?? '00:00'}`).getTime();
			return dateA - dateB;
		});

		const firstAppointment = sortedAppointments[0];
		if (!firstAppointment.appointmentId) return null;

		const consultationBill =
			billing.find(
				bill =>
					bill.appointmentId === firstAppointment.appointmentId &&
					bill.patientId === patientId &&
					bill.amount === APPOINTMENT_BOOKING_CHARGE
			) ?? null;

		return consultationBill;
	};

	// Check if patient has pending consultation payment
	const getPendingConsultationBill = (patientId: string): BillingRecord | null => {
		const consultationBill = getConsultationBill(patientId);
		if (consultationBill && consultationBill.status === 'Pending') {
			return consultationBill;
		}
		return null;
	};

	const patientHasPackagePlan = (patientId: string, patient?: FrontdeskPatient) => {
		// Check if patient has package fields set (current cycle)
		// After an automatic reset, package fields are cleared, so this will return false even if old bills exist
		// This is the primary check - if patient has packageAmount set, they have a package plan
		if (patient && (patient.packageAmount != null && patient.packageAmount > 0)) {
			return true;
		}
		// If patient object is provided and packageAmount is explicitly null/0, they don't have a package plan
		// (even if old bills exist from previous cycles)
		if (patient && (patient.packageAmount == null || patient.packageAmount === 0)) {
			return false;
		}
		// Fallback: if patient object not available, check if there are any package bills
		// This is only for backward compatibility when patient object is not passed
		return billing.some(
			bill => bill.patientId === patientId && typeof bill.packageAmount === 'number' && bill.packageAmount > 0
		);
	};

	useEffect(() => {
		if (!patients.length) return;

		const autoResetEligiblePatients = patients.filter(patient => {
			if (!patient.id) return false;
			if (patient.readyForNewAppointment) return false;

			const consultationBill = getConsultationBill(patient.patientId);
			if (!consultationBill) return false;

			const isDYES = (patient.patientType || '').toUpperCase() === 'DYES';

			if (isDYES) {
				return hasSixMonthsElapsed(consultationBill.date);
			}

			if (consultationBill.status !== 'Completed') return false;

			return hasSixMonthsElapsed(consultationBill.date);
		});

		if (autoResetEligiblePatients.length === 0) {
			return;
		}

		const autoResetPatients = async () => {
			for (const patient of autoResetEligiblePatients) {
				if (!patient.id) continue;
				try {
					const patientRef = doc(db, 'patients', patient.id);
					await updateDoc(patientRef, {
						paymentType: 'without' as PaymentTypeOption,
						paymentDescription: null,
						packageAmount: null,
						concessionPercent: null,
						readyForNewAppointment: true,
					});

					setPatients(prev =>
						prev.map(p =>
							p.id === patient.id
								? {
										...p,
										paymentType: 'without' as PaymentTypeOption,
										paymentDescription: undefined,
										packageAmount: null,
										concessionPercent: null,
										readyForNewAppointment: true,
								  }
								: p
						)
					);
				} catch (error) {
					console.error('Failed to auto-reset patient for new appointment', error);
				}
			}
		};

		void autoResetPatients();
	}, [patients, billing]);

	// Reset patient for new appointment cycle
	const handleResetForNewAppointment = async (patient: FrontdeskPatient) => {
		if (!patient.id) return;

		if (
			!confirm(
				`Reset ${patient.name} for a new appointment cycle? This will clear their package information and allow booking a new consultation.`
			)
		) {
			return;
		}

		try {
			const patientRef = doc(db, 'patients', patient.id);
			await updateDoc(patientRef, {
				paymentType: 'without' as PaymentTypeOption,
				paymentDescription: null,
				packageAmount: null,
				concessionPercent: null,
				readyForNewAppointment: true,
			});

			setPatients(prev =>
				prev.map(p =>
					p.id === patient.id
						? {
								...p,
								paymentType: 'without' as PaymentTypeOption,
								paymentDescription: undefined,
								packageAmount: null,
								concessionPercent: null,
								readyForNewAppointment: true,
						  }
						: p
				)
			);

			alert(`${patient.name} has been reset for a new appointment cycle. You can now book a new consultation.`);
		} catch (error) {
			console.error('Failed to reset patient for new appointment', error);
			alert('Failed to reset patient. Please try again.');
		}
	};

	// Check if patient has pending package payment
	const getPendingPackageBill = (patientId: string, patient?: FrontdeskPatient): BillingRecord | null => {
		// If patient has no package fields set, don't show package buttons
		if (patient && (patient.packageAmount == null || patient.packageAmount === 0)) {
			return null;
		}

		// Find all pending package bills and return the most recent one
		const pendingPackageBills = billing
			.filter(bill => {
				if (
					bill.patientId === patientId &&
					bill.billingId.startsWith('PKG-') &&
					bill.packageAmount != null &&
					typeof bill.packageAmount === 'number' &&
					bill.packageAmount > 0
				) {
					return bill.status === 'Pending';
				}
				return false;
			})
			.sort((a, b) => {
				// Sort by date, most recent first
				const dateA = new Date(a.date ?? '').getTime();
				const dateB = new Date(b.date ?? '').getTime();
				return dateB - dateA;
			});

		return pendingPackageBills.length > 0 ? pendingPackageBills[0] : null;
	};

	// Check if patient has a fully paid package
	const getPaidPackageBill = (patientId: string, patient?: FrontdeskPatient): BillingRecord | null => {
		// If patient has no package fields set, don't show package buttons
		if (patient && (patient.packageAmount == null || patient.packageAmount === 0)) {
			return null;
		}

		// Find all paid package bills and return the most recent one
		const paidPackageBills = billing
			.filter(bill => {
				if (
					bill.patientId === patientId &&
					bill.billingId.startsWith('PKG-') &&
					bill.packageAmount != null &&
					typeof bill.packageAmount === 'number' &&
					bill.packageAmount > 0
				) {
					return bill.status === 'Completed';
				}
				return false;
			})
			.sort((a, b) => {
				// Sort by date, most recent first
				const dateA = new Date(a.date ?? '').getTime();
				const dateB = new Date(b.date ?? '').getTime();
				return dateB - dateA;
			});

		return paidPackageBills.length > 0 ? paidPackageBills[0] : null;
	};

	const handlePayConsultation = (patient: FrontdeskPatient) => {
		const pendingBill = getPendingConsultationBill(patient.patientId);
		if (!pendingBill) {
			alert('No pending consultation payment found for this patient.');
			return;
		}
		setSelectedPaymentBill(pendingBill);
		setPaymentMode('Cash');
		setUtr('');
		setShowPaymentModal(true);
		setOpenMenuId(null);
	};

	const handlePayPackage = (patient: FrontdeskPatient) => {
		const pendingBill = getPendingPackageBill(patient.patientId);
		if (!pendingBill) {
			alert('No pending package payment found for this patient.');
			return;
		}
		setSelectedPaymentBill(pendingBill);
		setPaymentMode('Cash');
		setUtr('');
		setShowPaymentModal(true);
		setOpenMenuId(null);
	};

	const handleClosePaymentModal = () => {
		setShowPaymentModal(false);
		setSelectedPaymentBill(null);
		setPaymentMode('Cash');
		setUtr('');
	};

	const handleSubmitPayment = async () => {
		if (!selectedPaymentBill || !selectedPaymentBill.id) return;

		if (paymentMode === 'UPI/Card' && !utr.trim()) {
			alert('Please enter UTR/Transaction ID for UPI/Card payment.');
			return;
		}

		setProcessingPayment(true);
		try {
			const billingRef = doc(db, 'billing', selectedPaymentBill.id);
			
				await updateDoc(billingRef, {
					status: 'Completed',
					paymentMode,
					utr: paymentMode === 'UPI/Card' ? utr.trim() : null,
				amountPaid: selectedPaymentBill.amount,
					updatedAt: serverTimestamp(),
				});
				alert('Payment processed successfully!');
			
			handleClosePaymentModal();
		} catch (error) {
			console.error('Failed to process payment', error);
			alert(`Failed to process payment: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setProcessingPayment(false);
		}
	};

	const handleOpenPackageModal = (patient: FrontdeskPatient) => {
		setPackageModalPatient(patient);
		setPackageForm({
			totalNoOfSessions: patient.totalSessionsRequired ? String(patient.totalSessionsRequired) : '',
			paymentType: patient.paymentType ?? '',
			paymentDescription: patient.paymentDescription ?? '',
			packageAmount: patient.packageAmount ? String(patient.packageAmount) : '',
			concessionPercent: patient.concessionPercent != null ? String(patient.concessionPercent) : '',
		});
		setPackageFormErrors({});
		setShowPackageModal(true);
	};

	const handleClosePackageModal = () => {
		setShowPackageModal(false);
		setPackageModalPatient(null);
		setPackageForm(PACKAGE_FORM_INITIAL_STATE);
		setPackageFormErrors({});
	};

	const handlePackageFormChange =
		(field: keyof PackageSetupFormState) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
			const { value } = event.target;
			setPackageForm(prev => ({
				...prev,
				[field]: value,
				...(field === 'paymentType' && value !== 'with' ? { concessionPercent: '' } : {}),
			}));
			setPackageFormErrors(prev => ({
				...prev,
				[field]: undefined,
			}));
		};

	const validatePackageForm = () => {
		const errors: Partial<Record<keyof PackageSetupFormState, string>> = {};
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

			setPatients(prev =>
				prev.map(p =>
					p.id === packageModalPatient.id
						? {
								...p,
								totalSessionsRequired: totalSessionsValue,
								paymentType: packageForm.paymentType as PaymentTypeOption,
								paymentDescription: normalizedDescription,
								packageAmount: packageAmountValue,
								concessionPercent: concessionPercentValue,
						  }
						: p
				)
			);

			setPackageModalPatient(prev =>
				prev
					? {
							...prev,
							totalSessionsRequired: totalSessionsValue,
							paymentType: packageForm.paymentType as PaymentTypeOption,
							paymentDescription: normalizedDescription,
							packageAmount: packageAmountValue,
							concessionPercent: concessionPercentValue,
					  }
					: prev
			);

			alert('Package details saved. Billing entry created.');
			handleClosePackageModal();
		} catch (error) {
			console.error('Failed to save package details', error);
			alert('Failed to save package information. Please try again.');
		} finally {
			setPackageSubmitting(false);
		}
	};

	const handleViewPatientDetails = (patient: FrontdeskPatient) => {
		setViewingPatient(patient);
		setOpenMenuId(null);
	};

	const handleClosePatientDetails = () => {
		setViewingPatient(null);
	};

	const selectedBookingPatient = useMemo(() => {
		if (!bookingForm.patientId) return null;
		return patients.find(patient => patient.patientId === bookingForm.patientId) ?? null;
	}, [patients, bookingForm.patientId]);

	const doctorOptions = useMemo(() => {
		return staff
			.filter(
				member =>
					member.status === 'Active' &&
					['Physiotherapist', 'StrengthAndConditioning', 'ClinicalTeam'].includes(member.role)
			)
			.map(member => member.userName)
			.filter(Boolean)
			.sort((a, b) => a.localeCompare(b));
	}, [staff]);

	const availableSlots = useMemo<string[]>(() => {
		if (!bookingForm.date || !bookingForm.doctor) {
			return [];
		}

		const staffMember = staff.find(member => member.userName === bookingForm.doctor);
		if (!staffMember) {
			return [];
		}

		// Default availability: 9 AM to 6 PM for all days except Sunday
		const DEFAULT_START_TIME = '09:00';
		const DEFAULT_END_TIME = '18:00';
		const dateObj = new Date(bookingForm.date + 'T00:00:00');
		const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
		const isSunday = dayName === 'Sunday';
		
		// Sunday is always unavailable
		if (isSunday) {
			return [];
		}

		// Check for date-specific availability
		let dayAvailability = staffMember.dateSpecificAvailability?.[bookingForm.date];
		
		// If date-specific availability exists and is marked as unavailable, return empty
		if (dayAvailability && !dayAvailability.enabled) {
			return [];
		}
		
		// If no date-specific availability or it's enabled, use default
		if (!dayAvailability || !dayAvailability.slots || dayAvailability.slots.length === 0) {
			dayAvailability = {
				enabled: true,
				slots: [{ start: DEFAULT_START_TIME, end: DEFAULT_END_TIME }],
			};
		}

		const relevantAppointments = appointments.filter(
			appointment =>
				appointment.doctor === bookingForm.doctor &&
				appointment.date === bookingForm.date &&
				appointment.status !== 'cancelled'
		);

		const bookedSlotSet = new Set<string>();
		relevantAppointments.forEach(appointment => {
			if (!appointment.time) return;
			const durationMinutes = Math.max(SLOT_INTERVAL_MINUTES, appointment.duration ?? SLOT_INTERVAL_MINUTES);
			const blocks = Math.ceil(durationMinutes / SLOT_INTERVAL_MINUTES);
			const startMinutes = timeStringToMinutes(appointment.time);
			for (let block = 0; block < blocks; block += 1) {
				const blockStartMinutes = startMinutes + block * SLOT_INTERVAL_MINUTES;
				bookedSlotSet.add(minutesToTimeString(blockStartMinutes));
			}
		});

		const now = new Date();
		const selectedDate = new Date(`${bookingForm.date}T00:00:00`);
		const isToday = selectedDate.toDateString() === now.toDateString();
		const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();

		// Get unavailable slots for this date
		const unavailableSlots = dayAvailability.unavailableSlots || [];

		const slots: string[] = [];

		dayAvailability.slots.forEach(slot => {
			if (!slot.start || !slot.end) return;

			const [startHour, startMinute] = slot.start.split(':').map(Number);
			const [endHour, endMinute] = slot.end.split(':').map(Number);

			if ([startHour, startMinute, endHour, endMinute].some(value => Number.isNaN(value))) {
				return;
			}

			const slotStart = new Date(selectedDate);
			slotStart.setHours(startHour, startMinute, 0, 0);
			const slotEnd = new Date(selectedDate);
			slotEnd.setHours(endHour, endMinute, 0, 0);

			if (slotEnd <= slotStart) {
				slotEnd.setDate(slotEnd.getDate() + 1);
			}

			const current = new Date(slotStart);
			while (current < slotEnd) {
				const timeString = `${String(current.getHours()).padStart(2, '0')}:${String(current.getMinutes()).padStart(2, '0')}`;

				if (bookedSlotSet.has(timeString)) {
					current.setMinutes(current.getMinutes() + SLOT_INTERVAL_MINUTES);
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
					current.setMinutes(current.getMinutes() + SLOT_INTERVAL_MINUTES);
					continue;
				}

				if (isToday) {
					const minutesFromMidnight = current.getHours() * 60 + current.getMinutes();
					if (minutesFromMidnight < currentTimeMinutes) {
						current.setMinutes(current.getMinutes() + SLOT_INTERVAL_MINUTES);
						continue;
					}
				}

				slots.push(timeString);
				current.setMinutes(current.getMinutes() + SLOT_INTERVAL_MINUTES);
			}
		});

		return [...new Set(slots)].sort();
	}, [appointments, bookingForm.date, bookingForm.doctor, staff]);

	// Available slots for registration appointment form
	const registerAvailableSlots = useMemo<string[]>(() => {
		if (!registerAppointmentForm.date || !registerAppointmentForm.doctor) {
			return [];
		}

		const staffMember = staff.find(member => member.userName === registerAppointmentForm.doctor);
		if (!staffMember) {
			return [];
		}

		// Default availability: 9 AM to 6 PM for all days except Sunday
		const DEFAULT_START_TIME = '09:00';
		const DEFAULT_END_TIME = '18:00';
		const dateObj = new Date(registerAppointmentForm.date + 'T00:00:00');
		const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
		const isSunday = dayName === 'Sunday';
		
		// Sunday is always unavailable
		if (isSunday) {
			return [];
		}

		// Check for date-specific availability
		let dayAvailability = staffMember.dateSpecificAvailability?.[registerAppointmentForm.date];
		
		// If date-specific availability exists and is marked as unavailable, return empty
		if (dayAvailability && !dayAvailability.enabled) {
			return [];
		}
		
		// If no date-specific availability or it's enabled, use default
		if (!dayAvailability || !dayAvailability.slots || dayAvailability.slots.length === 0) {
			dayAvailability = {
				enabled: true,
				slots: [{ start: DEFAULT_START_TIME, end: DEFAULT_END_TIME }],
			};
		}

		const relevantAppointments = appointments.filter(
			appointment =>
				appointment.doctor === registerAppointmentForm.doctor &&
				appointment.date === registerAppointmentForm.date &&
				appointment.status !== 'cancelled'
		);

		const bookedSlotSet = new Set<string>();
		relevantAppointments.forEach(appointment => {
			if (!appointment.time) return;
			const durationMinutes = Math.max(SLOT_INTERVAL_MINUTES, appointment.duration ?? SLOT_INTERVAL_MINUTES);
			const blocks = Math.ceil(durationMinutes / SLOT_INTERVAL_MINUTES);
			const startMinutes = timeStringToMinutes(appointment.time);
			for (let block = 0; block < blocks; block += 1) {
				const blockStartMinutes = startMinutes + block * SLOT_INTERVAL_MINUTES;
				bookedSlotSet.add(minutesToTimeString(blockStartMinutes));
			}
		});

		const now = new Date();
		const selectedDate = new Date(`${registerAppointmentForm.date}T00:00:00`);
		const isToday = selectedDate.toDateString() === now.toDateString();
		const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();

		// Get unavailable slots for this date
		const unavailableSlots = dayAvailability.unavailableSlots || [];

		const slots: string[] = [];

		dayAvailability.slots.forEach(slot => {
			if (!slot.start || !slot.end) return;

			const [startHour, startMinute] = slot.start.split(':').map(Number);
			const [endHour, endMinute] = slot.end.split(':').map(Number);

			if ([startHour, startMinute, endHour, endMinute].some(value => Number.isNaN(value))) {
				return;
			}

			const slotStart = new Date(selectedDate);
			slotStart.setHours(startHour, startMinute, 0, 0);
			const slotEnd = new Date(selectedDate);
			slotEnd.setHours(endHour, endMinute, 0, 0);

			if (slotEnd <= slotStart) {
				slotEnd.setDate(slotEnd.getDate() + 1);
			}

			const current = new Date(slotStart);
			while (current < slotEnd) {
				const timeString = `${String(current.getHours()).padStart(2, '0')}:${String(current.getMinutes()).padStart(2, '0')}`;

				if (bookedSlotSet.has(timeString)) {
					current.setMinutes(current.getMinutes() + SLOT_INTERVAL_MINUTES);
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
					current.setMinutes(current.getMinutes() + SLOT_INTERVAL_MINUTES);
					continue;
				}

				if (isToday) {
					const minutesFromMidnight = current.getHours() * 60 + current.getMinutes();
					if (minutesFromMidnight < currentTimeMinutes) {
						current.setMinutes(current.getMinutes() + SLOT_INTERVAL_MINUTES);
						continue;
					}
				}

				slots.push(timeString);
				current.setMinutes(current.getMinutes() + SLOT_INTERVAL_MINUTES);
			}
		});

		return [...new Set(slots)].sort();
	}, [appointments, registerAppointmentForm.date, registerAppointmentForm.doctor, staff]);

	useEffect(() => {
		if (!bookingForm.doctor) return;
		if (!doctorOptions.includes(bookingForm.doctor)) {
			setBookingForm(prev => ({ ...prev, doctor: '', date: '', time: '', duration: 0 }));
			setSelectedSlots([]);
		}
	}, [bookingForm.doctor, doctorOptions]);

	useEffect(() => {
		setSelectedSlots(prevSelected => {
			if (prevSelected.length === 0) return prevSelected;
			const filtered = prevSelected.filter(slot => availableSlots.includes(slot));
			if (filtered.length === prevSelected.length) return prevSelected;
			setBookingForm(prev => ({
				...prev,
				time: filtered[0] ?? '',
				duration: filtered.length > 0 ? filtered.length * SLOT_INTERVAL_MINUTES : 0,
			}));
			return filtered;
		});
	}, [availableSlots]);

	useEffect(() => {
		setRegisterSelectedSlots(prevSelected => {
			if (prevSelected.length === 0) return prevSelected;
			const filtered = prevSelected.filter(slot => registerAvailableSlots.includes(slot));
			if (filtered.length === prevSelected.length) return prevSelected;
			setRegisterAppointmentForm(prev => ({
				...prev,
				time: filtered[0] ?? '',
				duration: filtered.length > 0 ? filtered.length * SLOT_INTERVAL_MINUTES : 0,
			}));
			return filtered;
		});
	}, [registerAvailableSlots]);

	const handleSlotToggle = (slot: string) => {
		setSelectedSlots(prevSelected => {
			let nextSelection: string[];
			if (prevSelected.includes(slot)) {
				nextSelection = prevSelected.filter(item => item !== slot);
			} else {
				nextSelection = [...prevSelected, slot];
			}

			nextSelection = [...nextSelection].sort((a, b) => a.localeCompare(b));

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

			const maxSlots = Math.max(1, Math.floor(MAX_BLOCK_DURATION_MINUTES / SLOT_INTERVAL_MINUTES));
			if (nextSelection.length > maxSlots) {
				nextSelection = nextSelection.slice(-maxSlots);
			}

			setBookingForm(prev => ({
				...prev,
				time: nextSelection[0] ?? '',
				duration: nextSelection.length > 0 ? nextSelection.length * SLOT_INTERVAL_MINUTES : 0,
			}));

			return nextSelection;
		});
	};

	const handleRegisterSlotToggle = (slot: string) => {
		setRegisterSelectedSlots(prevSelected => {
			let nextSelection: string[];
			if (prevSelected.includes(slot)) {
				nextSelection = prevSelected.filter(item => item !== slot);
			} else {
				nextSelection = [...prevSelected, slot];
			}

			nextSelection = [...nextSelection].sort((a, b) => a.localeCompare(b));

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

			const maxSlots = Math.max(1, Math.floor(MAX_BLOCK_DURATION_MINUTES / SLOT_INTERVAL_MINUTES));
			if (nextSelection.length > maxSlots) {
				nextSelection = nextSelection.slice(-maxSlots);
			}

			setRegisterAppointmentForm(prev => ({
				...prev,
				time: nextSelection[0] ?? '',
				duration: nextSelection.length > 0 ? nextSelection.length * SLOT_INTERVAL_MINUTES : 0,
			}));

			return nextSelection;
		});
	};

	const handleBookFirstAppointment = (patientId: string) => {
		const patient = patients.find(p => p.patientId === patientId);
		const isDYES = ((patient?.patientType || '') as string).toUpperCase() === 'DYES';
		
		// DYES patients: No paywall - skip payment checks
		if (!isDYES) {
		// Check if there's a pending consultation - if so, don't allow new booking
		if (hasPendingConsultation(patientId)) {
			alert(
				'This patient has a pending consultation payment. Please complete the payment before booking a new consultation.'
			);
			return;
		}

		// Allow booking only if no consultation exists or patient has been reset via "New Appointment"
		if (!canBookNewConsultation(patientId, patient)) {
			alert(
				'This patient already has a consultation. Please use "New Appointment" from the dropdown menu to reset for a new appointment cycle.'
			);
			return;
			}
		}
		setBookingForm({
			patientId,
			doctor: '',
			date: '',
			time: '',
			duration: 0,
			notes: '',
		});
		setSelectedSlots([]);
		setShowBookingModal(true);
		setOpenMenuId(null);
	};

	const handleCloseBookingModal = () => {
		setShowBookingModal(false);
		setBookingForm({
			patientId: '',
			doctor: '',
			date: '',
			time: '',
			duration: 0,
			notes: '',
		});
		setSelectedSlots([]);
	};

const handleOpenRegisterModal = () => {
	setRegisterForm(REGISTER_FORM_INITIAL_STATE);
	setRegisterFormErrors({});
	setBookAppointment(false);
	setRegisterAppointmentForm({
		doctor: '',
		date: '',
		time: '',
		duration: 0,
		notes: '',
	});
	setRegisterSelectedSlots([]);
	setShowRegisterModal(true);
};

const handleCloseRegisterModal = () => {
	setShowRegisterModal(false);
	setRegisterFormErrors({});
	setBookAppointment(false);
	setRegisterAppointmentForm({
		doctor: '',
		date: '',
		time: '',
		duration: 0,
		notes: '',
	});
	setRegisterSelectedSlots([]);
};

const handleRegisterFormChange =
	(field: keyof RegisterFormState) =>
	(event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
		const value = event.target.value;
		setRegisterForm(prev => ({
			...prev,
			[field]: value,
		}));
		setRegisterFormErrors(prev => ({
			...prev,
			[field]: undefined,
		}));
	};

const validateRegisterForm = () => {
	const errors: Partial<Record<keyof RegisterFormState, string>> = {};
	if (!registerForm.fullName.trim()) {
		errors.fullName = "Please enter the patient's full name.";
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
	if (registerForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(registerForm.email.trim())) {
		errors.email = 'Please enter a valid email address.';
	}
	if (!registerForm.patientType) {
		errors.patientType = 'Please select Type of Organization.';
	}
	if (bookAppointment) {
		if (!registerAppointmentForm.doctor) {
			alert('Please select a clinician for the appointment.');
			return false;
		}
		if (!registerAppointmentForm.date) {
			alert('Please select a date for the appointment.');
			return false;
		}
		if (!registerAppointmentForm.time || !registerAppointmentForm.duration) {
			alert('Please select a time slot for the appointment.');
			return false;
		}
	}

	setRegisterFormErrors(errors);
	return Object.keys(errors).length === 0;
};

const handleRegisterPatient = async (event: React.FormEvent<HTMLFormElement>) => {
	event.preventDefault();
	if (!validateRegisterForm() || registerSubmitting) return;

	setRegisterSubmitting(true);
	try {
		const patientId = await generatePatientId();
		const trimmedEmail = registerForm.email.trim();
		const trimmedPhone = registerForm.phone.trim();
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
			patientType: registerForm.patientType as PatientTypeOption,
			paymentType: 'without' as PaymentTypeOption,
			paymentDescription: null,
			packageAmount: null,
			sessionAllowance: registerForm.patientType === 'DYES' ? createInitialSessionAllowance() : null,
		};

		await addDoc(collection(db, 'patients'), patientData);

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

		// If booking appointment is enabled, create the appointment
		if (bookAppointment && registerAppointmentForm.doctor && registerAppointmentForm.date && registerAppointmentForm.time && registerAppointmentForm.duration) {
			try {
				const staffMember = staff.find(member => member.userName === registerAppointmentForm.doctor);
				if (staffMember) {
					const appointmentId = `APT${Date.now()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
					await addDoc(collection(db, 'appointments'), {
						appointmentId,
						patientId,
						patient: registerForm.fullName.trim(),
						doctor: registerAppointmentForm.doctor,
						staffId: staffMember.id,
						date: registerAppointmentForm.date,
						time: registerAppointmentForm.time,
						duration: registerAppointmentForm.duration,
						status: 'pending' as AdminAppointmentStatus,
						notes: registerAppointmentForm.notes?.trim() || null,
						isConsultation: true, // First appointment is always a consultation
						createdAt: serverTimestamp(),
					});

					try {
						const billingId = `BILL-${appointmentId}`;
						await addDoc(collection(db, 'billing'), {
							billingId,
							appointmentId,
							patient: registerForm.fullName.trim(),
							patientId,
							doctor: registerAppointmentForm.doctor,
							amount: APPOINTMENT_BOOKING_CHARGE,
							amountPaid: 0,
							date: registerAppointmentForm.date,
							status: 'Pending',
							paymentMode: null,
							utr: null,
							createdAt: serverTimestamp(),
							updatedAt: serverTimestamp(),
						});
					} catch (billingError) {
						console.error('Failed to create booking charge', billingError);
					}

					// Update patient with assigned doctor
					const patientQuery = query(collection(db, 'patients'), where('patientId', '==', patientId));
					const patientSnapshot = await getDocs(patientQuery);
					if (!patientSnapshot.empty) {
						const patientDocRef = doc(db, 'patients', patientSnapshot.docs[0].id);
						await updateDoc(patientDocRef, {
							assignedDoctor: registerAppointmentForm.doctor,
							status: 'ongoing' as AdminPatientStatus,
							readyForNewAppointment: false,
						});
					}

					// Send appointment confirmation emails/SMS
					if (trimmedEmail) {
						try {
							await sendEmailNotification({
								to: trimmedEmail,
								subject: `Appointment Scheduled - ${registerAppointmentForm.date}`,
								template: 'appointment-created',
								data: {
									patientName: registerForm.fullName.trim(),
									patientEmail: trimmedEmail,
									patientId,
									doctor: registerAppointmentForm.doctor,
									date: registerAppointmentForm.date,
									time: registerAppointmentForm.time,
									appointmentId,
								},
							});
						} catch (emailError) {
							console.error('Failed to send appointment confirmation email:', emailError);
						}
					}

					if (trimmedPhone && isValidPhoneNumber(trimmedPhone)) {
						try {
							await sendSMSNotification({
								to: trimmedPhone,
								template: 'appointment-created',
								data: {
									patientName: registerForm.fullName.trim(),
									patientPhone: trimmedPhone,
									patientId,
									doctor: registerAppointmentForm.doctor,
									date: registerAppointmentForm.date,
									time: registerAppointmentForm.time,
									appointmentId,
								},
							});
						} catch (smsError) {
							console.error('Failed to send appointment confirmation SMS:', smsError);
						}
					}

					if (staffMember.userEmail) {
						try {
							await sendEmailNotification({
								to: staffMember.userEmail,
								subject: `New Appointment - ${registerForm.fullName.trim()} on ${registerAppointmentForm.date}`,
								template: 'appointment-created',
								data: {
									patientName: registerForm.fullName.trim(),
									patientEmail: trimmedEmail || staffMember.userEmail,
									patientId,
									doctor: registerAppointmentForm.doctor,
									date: registerAppointmentForm.date,
									time: registerAppointmentForm.time,
									appointmentId,
								},
							});
						} catch (emailError) {
							console.error('Failed to notify staff member:', emailError);
						}
					}
				}
			} catch (appointmentError) {
				console.error('Failed to create appointment during registration', appointmentError);
				// Don't fail the registration if appointment creation fails
			}
		}

		setRegisterNotice({
			type: 'success',
			message: `${registerForm.fullName.trim()} registered with ID ${patientId}.${bookAppointment ? ' Appointment booked successfully.' : ''}${confirmationText}`,
		});
		setRegisterForm(REGISTER_FORM_INITIAL_STATE);
		handleCloseRegisterModal();
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

	const handleCreateAppointment = async () => {
		if (
			!bookingForm.patientId ||
			!bookingForm.doctor ||
			!bookingForm.date ||
			!bookingForm.time ||
			!bookingForm.duration
		) {
			alert('Please select clinician, date, and a time slot duration for the appointment.');
			return;
		}

		const selectedPatient = patients.find(p => p.patientId === bookingForm.patientId);
		const staffMember = staff.find(member => member.userName === bookingForm.doctor);

		if (!selectedPatient) {
			alert('Unable to find the selected patient.');
			return;
		}

		const isDYES = ((selectedPatient.patientType || '') as string).toUpperCase() === 'DYES';
		
		// DYES patients: No paywall - skip payment checks
		if (!isDYES) {
		// Check if there's a pending consultation - if so, don't allow new booking
		if (hasPendingConsultation(selectedPatient.patientId)) {
			alert('This patient has a pending consultation payment. Please complete the payment before booking a new consultation.');
			return;
		}

		// Allow booking only if no consultation exists or patient has been reset via "New Appointment"
		if (!canBookNewConsultation(selectedPatient.patientId, selectedPatient)) {
			alert('This patient already has a consultation. Please use "New Appointment" from the dropdown menu to reset for a new appointment cycle.');
			return;
			}
		}

		if (!staffMember) {
			alert('Unable to find the selected clinician.');
			return;
		}

		const conflict = checkAppointmentConflict(
			appointments.map(appointment => ({
				id: appointment.id,
				appointmentId: appointment.appointmentId,
				patient: appointment.patient || '',
				doctor: appointment.doctor,
				date: appointment.date,
				time: appointment.time,
				duration: appointment.duration,
				status: appointment.status,
			})),
			{
				doctor: bookingForm.doctor,
				date: bookingForm.date,
				time: bookingForm.time,
				duration: bookingForm.duration,
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

		setBookingLoading(true);
		let updatedPatientState: FrontdeskPatient | null = null;
		let newRemainingValue: number | undefined = selectedPatient.remainingSessions;
		try {
			// Check if this is the patient's first appointment (consultation)
			const patientAllAppointments = appointments.filter(
				a => a.patientId === selectedPatient.patientId
			);
			const isConsultation = patientAllAppointments.length === 0; // First appointment if no appointments exist

			const appointmentId = `APT${Date.now()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
			await addDoc(collection(db, 'appointments'), {
				appointmentId,
				patientId: selectedPatient.patientId,
				patient: selectedPatient.name,
				doctor: bookingForm.doctor,
				staffId: staffMember.id,
				date: bookingForm.date,
				time: bookingForm.time,
				duration: bookingForm.duration,
				status: 'pending' as AdminAppointmentStatus,
				notes: bookingForm.notes?.trim() || null,
				isConsultation: isConsultation,
				createdAt: serverTimestamp(),
			});

			try {
				const billingId = `BILL-${appointmentId}`;
				await addDoc(collection(db, 'billing'), {
					billingId,
					appointmentId,
					patient: selectedPatient.name,
					patientId: selectedPatient.patientId,
					doctor: bookingForm.doctor,
					amount: APPOINTMENT_BOOKING_CHARGE,
					amountPaid: 0,
					date: bookingForm.date,
					status: 'Pending',
					paymentMode: null,
					utr: null,
					createdAt: serverTimestamp(),
					updatedAt: serverTimestamp(),
				});
			} catch (billingError) {
				console.error('Failed to create booking charge', billingError);
			}

			if (typeof selectedPatient.totalSessionsRequired === 'number') {
				const completedCount = appointments.filter(
					a => a.patientId === bookingForm.patientId && a.status === 'completed'
				).length;
				const newRemaining = Math.max(0, selectedPatient.totalSessionsRequired - 1 - completedCount);

				if (selectedPatient.id) {
					const patientRef = doc(db, 'patients', selectedPatient.id);
					await updateDoc(patientRef, {
						remainingSessions: newRemaining,
					});
				}

			newRemainingValue = newRemaining;
			}

			if (selectedPatient.id) {
				try {
					const patientRef = doc(db, 'patients', selectedPatient.id);
					const patientUpdate: Record<string, unknown> = {
						assignedDoctor: bookingForm.doctor,
						readyForNewAppointment: false, // Clear the flag when new appointment is created
					};
					if (!selectedPatient.status || selectedPatient.status === 'pending') {
						patientUpdate.status = 'ongoing';
					}

					if (user?.uid && !selectedPatient.assignedFrontdeskId) {
						patientUpdate.assignedFrontdeskId = user.uid;
						patientUpdate.assignedFrontdeskName = user.displayName || user.email || 'Front Desk';
						patientUpdate.assignedFrontdeskEmail = user.email ?? null;
					}

					await updateDoc(patientRef, patientUpdate);
					
					const updatedStatus =
						selectedPatient.status && selectedPatient.status !== 'pending'
							? selectedPatient.status
							: 'ongoing';

					updatedPatientState = {
						...selectedPatient,
						assignedDoctor: bookingForm.doctor,
						readyForNewAppointment: false,
						status: updatedStatus,
						remainingSessions: newRemainingValue,
					};

					setPatients(prev =>
						prev.map(p => (p.id === selectedPatient.id ? updatedPatientState! : p))
					);
				} catch (patientUpdateError) {
					console.error('Failed to update patient assignment', patientUpdateError);
				}
			} else {
			const updatedStatus =
				selectedPatient.status && selectedPatient.status !== 'pending'
					? selectedPatient.status
					: 'ongoing';

			updatedPatientState = {
				...selectedPatient,
				assignedDoctor: bookingForm.doctor,
				readyForNewAppointment: false,
				status: updatedStatus,
				remainingSessions: newRemainingValue,
			};

			setPatients(prev =>
				prev.map(p =>
					p.patientId === selectedPatient.patientId ? updatedPatientState! : p
				)
			);
			}

			if (selectedPatient.email) {
				try {
					await sendEmailNotification({
						to: selectedPatient.email,
						subject: `Appointment Scheduled - ${bookingForm.date}`,
						template: 'appointment-created',
						data: {
							patientName: selectedPatient.name,
							patientEmail: selectedPatient.email,
							patientId: selectedPatient.patientId,
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

			if (selectedPatient.phone && isValidPhoneNumber(selectedPatient.phone)) {
				try {
					await sendSMSNotification({
						to: selectedPatient.phone,
						template: 'appointment-created',
						data: {
							patientName: selectedPatient.name,
							patientPhone: selectedPatient.phone,
							patientId: selectedPatient.patientId,
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
						subject: `New Appointment - ${selectedPatient.name} on ${bookingForm.date}`,
						template: 'appointment-created',
						data: {
							patientName: selectedPatient.name,
							patientEmail: selectedPatient.email || staffMember.userEmail,
							patientId: selectedPatient.patientId,
							doctor: bookingForm.doctor,
							date: bookingForm.date,
							time: bookingForm.time,
							appointmentId,
						},
					});
				} catch (emailError) {
					console.error('Failed to notify staff member:', emailError);
				}
			}

			alert('Appointment booked successfully.');
			handleCloseBookingModal();
		} catch (error) {
			console.error('Failed to create appointment', error);
			alert(`Failed to create appointment: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setBookingLoading(false);
		}
	};

	const openDialogForEdit = (id: string) => {
		const patient = patients.find(p => p.id === id);
		if (!patient) return;
		setEditingId(id);
		const currentDoctor = patient.assignedDoctor || '';
		setOriginalDoctor(currentDoctor);
		setFormState({
			patientId: patient.patientId,
			name: patient.name,
			dob: patient.dob,
			gender: patient.gender,
			phone: patient.phone,
			email: patient.email || '',
			address: patient.address || '',
			complaint: patient.complaint || '',
			status: patient.status,
			patientType: patient.patientType,
			paymentType: patient.paymentType,
			paymentDescription: patient.paymentDescription || '',
			assignedDoctor: currentDoctor,
		});
		setFormErrors({});
		setIsDialogOpen(true);
	};

	const closeDialog = () => {
		setIsDialogOpen(false);
		setEditingId(null);
		setOriginalDoctor('');
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
			patientType: '',
			paymentType: 'without',
			paymentDescription: '',
			assignedDoctor: '',
		});
		setFormErrors({});
	};

	const validateForm = () => {
		const errors: Partial<Record<keyof typeof formState, string>> = {};
		if (!formState.name.trim()) {
			errors.name = 'Please enter the patient\'s full name.';
		}
		if (!formState.dob) {
			errors.dob = 'Please provide the date of birth.';
		}
		if (!formState.gender) {
			errors.gender = 'Please select gender.';
		}
		if (!formState.phone.trim()) {
			errors.phone = 'Please enter a valid phone number (10-15 digits).';
		} else if (!PHONE_REGEX.test(formState.phone.trim())) {
			errors.phone = 'Please enter a valid phone number (10-15 digits).';
		}
		if (formState.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formState.email)) {
			errors.email = 'Please enter a valid email address.';
		}
		if (!formState.patientType) {
			errors.patientType = 'Please select Type of Organization.';
		}
		if (formState.patientType === 'PAID' && !formState.paymentType) {
			errors.paymentType = 'Please select payment type.';
		}

		setFormErrors(errors);
		return Object.keys(errors).length === 0;
	};

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!validateForm() || !editingId) return;

		try {
			const newDoctor = formState.assignedDoctor?.trim() || null;
			const doctorChanged = newDoctor !== originalDoctor;

			// If doctor changed, validate the new doctor exists
			if (doctorChanged && newDoctor) {
				const newStaffMember = staff.find(member => member.userName === newDoctor);
				if (!newStaffMember) {
					alert('Selected clinician not found. Please select a valid clinician.');
					return;
				}
			}

			const patientData = {
				patientId: formState.patientId.trim(),
				name: formState.name.trim(),
				dob: formState.dob,
				gender: formState.gender,
				phone: formState.phone.trim(),
				email: formState.email?.trim() || null,
				address: formState.address?.trim() || null,
				complaint: formState.complaint?.trim() || null,
				status: formState.status,
				patientType: formState.patientType,
				paymentType: formState.patientType === 'PAID' ? formState.paymentType : 'without',
				paymentDescription: formState.patientType === 'PAID' ? (formState.paymentDescription?.trim() || null) : null,
				assignedDoctor: newDoctor,
			};

			// Update patient record
			await updateDoc(doc(db, 'patients', editingId), patientData);

			// If doctor changed, update all appointments for this patient
			if (doctorChanged && newDoctor) {
				const newStaffMember = staff.find(member => member.userName === newDoctor);
				if (newStaffMember) {
					const patient = patients.find(p => p.id === editingId);
					if (patient) {
						// Query all appointments for this patient
						const appointmentsQuery = query(
							collection(db, 'appointments'),
							where('patientId', '==', patient.patientId)
						);
						const appointmentsSnapshot = await getDocs(appointmentsQuery);

						if (appointmentsSnapshot.docs.length > 0) {
							// Update all appointments in a batch
							const batch = writeBatch(db);
							appointmentsSnapshot.docs.forEach(appointmentDoc => {
								batch.update(appointmentDoc.ref, {
									doctor: newDoctor,
									staffId: newStaffMember.id,
								});
							});
							await batch.commit();
							console.log(`Updated ${appointmentsSnapshot.docs.length} appointment(s) for patient ${patient.patientId} to new doctor ${newDoctor}`);
						}
					}
				}
			}

			closeDialog();
			alert(`Patient "${formState.name.trim()}" has been updated successfully!${doctorChanged ? ' All appointments have been reassigned to the new clinician.' : ''}`);
		} catch (error) {
			console.error('Failed to update patient', error);
			alert(`Failed to update patient: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	};

	const handleDeleteClick = (id: string) => {
		const patient = patients.find(p => p.id === id);
		if (!patient) return;
		setDeleteConfirmation({ patient, nameInput: '' });
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

		setDeletingId(patientId);
		setDeleteConfirmation({ patient: null, nameInput: '' });

		try {
			// First, delete all appointments for this patient
			const appointmentsQuery = query(
				collection(db, 'appointments'),
				where('patientId', '==', patient.patientId)
			);
			const appointmentsSnapshot = await getDocs(appointmentsQuery);
			
			if (appointmentsSnapshot.docs.length > 0) {
				const batch = writeBatch(db);
				appointmentsSnapshot.docs.forEach(appointmentDoc => {
					batch.delete(appointmentDoc.ref);
				});
				await batch.commit();
				console.log(`Deleted ${appointmentsSnapshot.docs.length} appointment(s) for patient ${patient.patientId}`);
			}

			// Soft delete the patient (set deleted flag instead of actually deleting)
			await updateDoc(doc(db, 'patients', patientId), {
				deleted: true,
				deletedAt: serverTimestamp(),
				status: 'cancelled',
			});

			// Create app notification
			const deletedByName = user?.displayName || user?.email || 'Unknown';
			await addDoc(collection(db, 'appNotifications'), {
				type: 'patient_deleted',
				title: '🏥 Patient Deleted',
				message: `${patient.name} (ID: ${patient.patientId}) has been deleted from the system.`,
				createdAt: serverTimestamp(),
				read: false,
				metadata: {
					patientId: patient.patientId,
					patientName: patient.name,
					deletedBy: user?.uid || '',
					deletedByName: deletedByName,
				},
			});

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
			alert(`❌ Failed to delete patient: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setDeletingId(null);
		}
	};

	const handleDeleteCancel = () => {
		setDeleteConfirmation({ patient: null, nameInput: '' });
	};

	// Handle opening report modal
	const handleOpenReportModal = (patientId: string, initialTab: 'report' | 'strength-conditioning' = 'report') => {
		if (!patientId) {
			console.error('Cannot open report: patientId is empty');
			return;
		}
		
		setReportModalPatientId(patientId);
		setReportModalInitialTab(initialTab);
		setShowReportModal(true);
	};

	// Handle closing report modal
	const handleCloseReportModal = () => {
		setShowReportModal(false);
		setReportModalPatientId(null);
	};

	// Handle PDF download for report
	const handleDownloadReportPDF = async (sections?: ReportSection[]) => {
		if (!reportModalPatientId) return;
		
		const reportPatientData = patients.find(p => p.patientId === reportModalPatientId) as any;
		if (!reportPatientData) return;
		
		const age = reportPatientData.dob ? new Date().getFullYear() - new Date(reportPatientData.dob).getFullYear() : undefined;
		await generatePhysiotherapyReportPDF({
			patientName: reportPatientData.name,
			patientId: reportPatientData.patientId,
			referredBy: reportPatientData.assignedDoctor || (reportPatientData as any).referredBy || '',
			age: age ? String(age) : '',
			gender: reportPatientData.gender || '',
			dateOfConsultation: reportPatientData.dateOfConsultation || new Date().toISOString().split('T')[0],
			contact: reportPatientData.phone || '',
			email: reportPatientData.email || '',
			complaints: reportPatientData.complaints || '',
			presentHistory: reportPatientData.presentHistory || '',
			pastHistory: reportPatientData.pastHistory || '',
			surgicalHistory: reportPatientData.surgicalHistory || '',
			medicalHistory: getMedicalHistoryText(reportPatientData),
			sleepCycle: reportPatientData.sleepCycle || '',
			hydration: reportPatientData.hydration || '4',
			nutrition: reportPatientData.nutrition || '',
			chiefComplaint: reportPatientData.chiefComplaint || reportPatientData.complaints || '',
			onsetType: reportPatientData.onsetType || '',
			duration: reportPatientData.duration || '',
			mechanismOfInjury: reportPatientData.mechanismOfInjury || '',
			painType: reportPatientData.painType || reportPatientData.typeOfPain || '',
			painIntensity: reportPatientData.painIntensity || reportPatientData.vasScale || '',
			aggravatingFactor: reportPatientData.aggravatingFactor || '',
			relievingFactor: reportPatientData.relievingFactor || '',
			siteSide: reportPatientData.siteSide || '',
			onset: reportPatientData.onset || '',
			natureOfInjury: reportPatientData.natureOfInjury || '',
			typeOfPain: reportPatientData.typeOfPain || '',
			vasScale: reportPatientData.vasScale || '5',
			rom: reportPatientData.rom || {},
			mmt: reportPatientData.mmt || {},
			built: reportPatientData.built || '',
			posture: reportPatientData.posture || '',
			postureManualNotes: reportPatientData.postureManualNotes || '',
			gaitAnalysis: reportPatientData.gaitAnalysis || '',
			gaitManualNotes: reportPatientData.gaitManualNotes || '',
			mobilityAids: reportPatientData.mobilityAids || '',
			localObservation: reportPatientData.localObservation || '',
			swelling: reportPatientData.swelling || '',
			muscleWasting: reportPatientData.muscleWasting || '',
			tenderness: reportPatientData.tenderness || '',
			warmth: reportPatientData.warmth || '',
			scar: reportPatientData.scar || '',
			crepitus: reportPatientData.crepitus || '',
			odema: reportPatientData.odema || '',
			physioName: reportPatientData.physioName || '',
			physioRegNo: reportPatientData.physioId || reportPatientData.physioRegNo || '',
		}, sections ? { sections } : undefined);
	};

	// Handle PDF download for strength and conditioning
	const handleDownloadStrengthConditioningPDF = async () => {
		if (!reportModalPatientId) return;
		
		// Note: This function requires strengthConditioningData from Firestore
		// The ReportModal component handles this functionality properly
		// This function is kept for API compatibility but should not be used directly
		console.warn('Strength conditioning PDF generation should be handled through ReportModal component');
		return;
	};

	// Handle print
	const handlePrintReport = (sections?: ReportSection[]) => {
		window.print();
	};

	// Load version history
	const loadVersionHistory = async () => {
		if (!reportModalPatientId) return;

		setLoadingVersions(true);
		try {
			const versionsQuery = query(
				collection(db, 'reportVersions'),
				where('patientId', '==', reportModalPatientId),
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

	// Handle view version history
	const handleViewVersionHistory = async () => {
		setShowVersionHistory(true);
		setViewingVersionData(null);
		await loadVersionHistory();
	};

	// Handle view version
	const handleViewVersion = (version: typeof versionHistory[0]) => {
		setViewingVersionData(version.data);
		setShowVersionHistory(false);
	};


	const handleFormChange = (field: keyof typeof formState) => (
		event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
	) => {
		const value = event.target.value;
		setFormState(prev => ({
			...prev,
			[field]: value,
		}));
		setFormErrors(prev => ({
			...prev,
			[field]: undefined,
		}));
	};

	return (
		<div className="min-h-svh bg-slate-50 px-6 py-10">
			<div className="mx-auto max-w-6xl space-y-10">
				<PageHeader
					title="Patient Management"
					actions={
						<div className="flex w-full justify-center mt-12 md:mt-0">
							<button type="button" onClick={handleOpenRegisterModal} className="btn-primary">
								<i className="fas fa-user-plus text-xs" aria-hidden="true" />
								Register Patient
							</button>
						</div>
					}
				/>

				<div className="border-t border-slate-200" />

				<section className="card-container">
					<div className="flex w-full flex-col gap-3 md:flex-row md:items-end md:gap-4">
						<div className="flex-1">
							<label className="block text-sm font-medium text-slate-700">Search patients</label>
							<div className="relative mt-2">
								<i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400" aria-hidden="true" />
								<input
									type="search"
									value={searchTerm}
									onChange={event => setSearchTerm(event.target.value)}
									className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm text-slate-700 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
									placeholder="Filter by name, ID, phone, or email"
									autoComplete="off"
								/>
							</div>
						</div>
						<div className="w-full md:w-48">
							<label className="block text-sm font-medium text-slate-700">Status filter</label>
							<select
								value={statusFilter}
								onChange={event => setStatusFilter(event.target.value as 'all' | AdminPatientStatus)}
								className="select-base"
							>
								{STATUS_FILTER_OPTIONS.map(option => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
						</div>
					</div>
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
							<button type="button" onClick={() => { setSearchTerm(''); setStatusFilter('all'); }} className="btn-secondary">
								<i className="fas fa-eraser text-xs" aria-hidden="true" />
								Clear filters
							</button>
						</div>
						<span className="text-xs text-slate-500">
							Showing <span className="font-semibold text-slate-700">{filteredPatients.length}</span> of{' '}
							<span className="font-semibold text-slate-700">{patients.length}</span> patients
						</span>
					</div>
				</section>

				{registerNotice && (
					<div
						className={`flex items-start justify-between gap-4 rounded-xl border px-4 py-3 text-sm ${
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

				<section className="section-card">
					<header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<h2 className="text-lg font-semibold text-slate-900">Patient List</h2>
							<p className="text-sm text-slate-500">
								{filteredPatients.length} patient{filteredPatients.length === 1 ? '' : 's'} found
							</p>
						</div>
					</header>

					{loading ? (
						<div className="empty-state-container">
							<div className="loading-spinner" aria-hidden="true" />
							<span className="ml-3 align-middle">Loading patients…</span>
						</div>
					) : filteredPatients.length === 0 ? (
						<div className="empty-state-container">
							No patients match your filters. Try adjusting your search or status filter.
						</div>
					) : (
						<div className="overflow-x-auto">
							<table className="min-w-full divide-y divide-slate-200 text-left text-sm text-slate-700">
								<thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
									<tr>
										<th className="px-4 py-3 font-semibold">Patient ID</th>
										<th className="px-4 py-3 font-semibold">Name</th>
										<th className="px-4 py-3 font-semibold">Type</th>
										<th className="px-4 py-3 font-semibold">Therapist</th>
										<th className="px-4 py-3 font-semibold">Registered</th>
										<th className="px-4 py-3 font-semibold text-right">Actions</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100">
									{filteredPatients.map(patient => {
										const isDyesPatient = (patient.patientType || '').toUpperCase() === 'DYES';
										const consultationBill = getConsultationBill(patient.patientId);
										const pendingConsultationBill =
											!isDyesPatient && consultationBill?.status === 'Pending'
												? consultationBill
												: null;
										const consultationPaid = consultationBill?.status === 'Completed';
										const canBook = canBookNewConsultation(patient.patientId, patient);
										const pendingPackageBill = getPendingPackageBill(patient.patientId, patient);
										const paidPackageBill = getPaidPackageBill(patient.patientId, patient);
										// Show "Setup Package" button whenever no active package exists
										const showPackageSetupButton =
											!canBook &&
											!patientHasPackagePlan(patient.patientId, patient) &&
											(isDyesPatient || (!pendingConsultationBill && consultationPaid));
										const bookingButtonClasses = [
											'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold',
											!canBook || pendingConsultationBill
												? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
												: 'border-emerald-200 bg-emerald-50 text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100 focus-visible:border-emerald-300 focus-visible:bg-emerald-100 focus-visible:outline-none',
										].join(' ');

										return (
											<tr key={patient.id}>
											<td className="px-4 py-4 text-sm font-medium text-slate-800">{patient.patientId || '—'}</td>
											<td className="px-4 py-4">
												<div className="space-y-1">
													<p className="text-sm text-slate-700">{patient.name || 'Unnamed'}</p>
													{patient.registeredByName && (
														<span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
															<i className="fas fa-user-md text-[10px]" aria-hidden="true" />
															Registered by {patient.registeredByName}
														</span>
													)}
												</div>
											</td>
											<td className="px-4 py-4 text-sm text-slate-600">{patient.patientType || '—'}</td>
											<td className="px-4 py-4 text-sm text-slate-600">{patient.assignedDoctor || '—'}</td>
											<td className="px-4 py-4 text-xs text-slate-500">{formatDateLabel(patient.registeredAt)}</td>
											<td className="px-4 py-4 text-right">
												<div className="flex items-center justify-end gap-2" data-patient-actions>
													<button
														type="button"
														onClick={() => handleBookFirstAppointment(patient.patientId)}
														className={bookingButtonClasses}
														disabled={!canBook || (!!pendingConsultationBill && !isDyesPatient)}
													>
														<i className="fas fa-calendar-plus text-[10px]" aria-hidden="true" />
														{canBook && !pendingConsultationBill ? 'Book' : 'Booked'}
													</button>
													{pendingConsultationBill && (
														<button
															type="button"
															onClick={() => handlePayConsultation(patient)}
															className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 transition hover:border-amber-300 hover:bg-amber-100 focus-visible:border-amber-300 focus-visible:bg-amber-100 focus-visible:outline-none"
														>
															<i className="fas fa-money-bill-wave text-[10px]" aria-hidden="true" />
															Pay
														</button>
													)}
													{pendingPackageBill && !isDyesPatient && (
														<button
															type="button"
															onClick={() => handlePayPackage(patient)}
															className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-3 py-1 text-xs font-semibold text-purple-700 transition hover:border-purple-300 hover:bg-purple-100 focus-visible:border-purple-300 focus-visible:bg-purple-100 focus-visible:outline-none"
														>
															<i className="fas fa-money-bill-wave text-[10px]" aria-hidden="true" />
															Pay Package
														</button>
													)}
													{paidPackageBill && (
														<span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
															<i className="fas fa-check-circle text-[10px]" aria-hidden="true" />
															Paid
														</span>
													)}
													<button
														type="button"
														onClick={() => handleOpenReportModal(patient.patientId, 'report')}
														className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 focus-visible:border-slate-300 focus-visible:bg-slate-100 focus-visible:outline-none"
													>
														<i className="fas fa-file-medical text-[10px]" aria-hidden="true" />
														Report
													</button>
													<div className="relative">
														<button
															type="button"
															onClick={event => {
																event.stopPropagation();
																setOpenMenuId(current => (current === patient.id ? null : patient.id ?? null));
															}}
															className="inline-flex items-center justify-center rounded-full border border-slate-200 p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-700 focus-visible:border-sky-300 focus-visible:text-slate-700 focus-visible:outline-none"
															aria-haspopup="menu"
															aria-expanded={openMenuId === patient.id}
															aria-label="More actions"
														>
															<svg
																xmlns="http://www.w3.org/2000/svg"
																viewBox="0 0 20 20"
																fill="currentColor"
																className="h-4 w-4"
															>
																<path d="M6 10a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm5.5 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM17 10a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" />
															</svg>
														</button>
														{openMenuId === patient.id && (
															<div className="absolute right-0 z-20 mt-2 w-44 rounded-lg border border-slate-200 bg-white py-2 text-left text-sm shadow-lg">
																<button
																	type="button"
																	onClick={event => {
																		event.stopPropagation();
																		handleViewPatientDetails(patient);
																	}}
																	className="flex w-full items-center gap-2 px-4 py-2 text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
																>
																	<i className="fas fa-eye text-xs" aria-hidden="true" />
																	View all data
																</button>
																<button
																	type="button"
																	onClick={event => {
																		event.stopPropagation();
																		setOpenMenuId(null);
																		openDialogForEdit(patient.id!);
																	}}
																	className="flex w-full items-center gap-2 px-4 py-2 text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
																>
																	<i className="fas fa-edit text-xs" aria-hidden="true" />
																	Edit
																</button>
																{!canBookNewConsultation(patient.patientId, patient) && (
																	<button
																		type="button"
																		onClick={event => {
																			event.stopPropagation();
																			setOpenMenuId(null);
																			handleResetForNewAppointment(patient);
																		}}
																		className="flex w-full items-center gap-2 px-4 py-2 text-sky-600 transition hover:bg-sky-50 hover:text-sky-700"
																	>
																		<i className="fas fa-calendar-plus text-xs" aria-hidden="true" />
																		New Appointment
																	</button>
																)}
																<button
																	type="button"
																	onClick={event => {
																		event.stopPropagation();
																		setOpenMenuId(null);
																		handleDeleteClick(patient.id!);
																	}}
																	disabled={deletingId === patient.id}
																	className="flex w-full items-center gap-2 px-4 py-2 text-rose-600 transition hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
																>
																	<i className="fas fa-trash text-xs" aria-hidden="true" />
																	{deletingId === patient.id ? 'Deleting…' : 'Delete'}
																</button>
															</div>
														)}
													</div>
												</div>
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

			{/* Register Patient Modal */}
			{showRegisterModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
					<div className="w-full max-w-4xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
						<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
							<div>
								<h2 className="text-lg font-semibold text-slate-900">Register Patient</h2>
								<p className="text-xs text-slate-500">Capture details and generate an ID instantly</p>
							</div>
							<button
								type="button"
								onClick={handleCloseRegisterModal}
								className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:bg-slate-100 focus-visible:text-slate-600 focus-visible:outline-none"
								aria-label="Close dialog"
								disabled={registerSubmitting}
							>
								<i className="fas fa-times" aria-hidden="true" />
							</button>
						</header>
						<form onSubmit={handleRegisterPatient} className="max-h-[70vh] overflow-y-auto px-6 py-4 space-y-4">
							<div className="grid gap-4 md:grid-cols-12">
								<div className="md:col-span-6">
									<label className="block text-sm font-medium text-slate-700">
										Full Name <span className="text-rose-600">*</span>
									</label>
									<input
										type="text"
										value={registerForm.fullName}
										onChange={handleRegisterFormChange('fullName')}
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
										onChange={handleRegisterFormChange('dob')}
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
										onChange={handleRegisterFormChange('gender')}
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
										onChange={handleRegisterFormChange('phone')}
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
										onChange={handleRegisterFormChange('email')}
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
										onChange={handleRegisterFormChange('address')}
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
										{(['DYES', 'VIP', 'GETHNA', 'PAID', 'OTHERS'] as const).map(type => (
											<label
												key={type}
												className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 transition hover:border-sky-300 hover:bg-sky-50 cursor-pointer"
											>
												<input
													type="radio"
													name="registerPatientType"
													value={type}
													checked={registerForm.patientType === type}
													onChange={() => {
														setRegisterForm(prev => ({
															...prev,
															patientType: type,
														}));
														setRegisterFormErrors(prev => ({
															...prev,
															patientType: undefined,
														}));
													}}
													className="h-4 w-4 border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												<span className="text-sm font-medium text-slate-700">{type}</span>
											</label>
										))}
									</div>
									{registerFormErrors.patientType && (
										<p className="mt-1 text-xs text-rose-500">{registerFormErrors.patientType}</p>
									)}
								</div>
							</div>

							{/* Book Appointment Option */}
							<div className="grid gap-4 md:grid-cols-12">
								<div className="md:col-span-12">
									<label className="flex items-center gap-2 cursor-pointer">
										<input
											type="checkbox"
											checked={bookAppointment}
											onChange={(e) => {
												setBookAppointment(e.target.checked);
												if (!e.target.checked) {
													setRegisterAppointmentForm({
														doctor: '',
														date: '',
														time: '',
														duration: 0,
														notes: '',
													});
													setRegisterSelectedSlots([]);
												}
											}}
											className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-200"
											disabled={registerSubmitting}
										/>
										<span className="text-sm font-medium text-slate-700">
											Book appointment after registration
										</span>
									</label>
								</div>
							</div>

							{/* Appointment Booking Fields */}
							{bookAppointment && (
								<div className="rounded-xl border border-sky-200 bg-sky-50 p-4 space-y-4">
									<h3 className="text-sm font-semibold text-slate-900">Appointment Details</h3>
									
									<div className="grid gap-4 sm:grid-cols-2">
										<div>
											<label className="block text-sm font-medium text-slate-700">
												Clinician <span className="text-rose-500">*</span>
											</label>
											<select
												value={registerAppointmentForm.doctor}
												onChange={(e) => {
													setRegisterAppointmentForm(prev => ({
														...prev,
														doctor: e.target.value,
														time: '',
														duration: 0,
													}));
													setRegisterSelectedSlots([]);
												}}
												className="select-base mt-2"
												disabled={registerSubmitting}
												required={bookAppointment}
											>
												<option value="">{doctorOptions.length ? 'Select clinician' : 'No clinicians available'}</option>
												{doctorOptions.map(option => (
													<option key={option} value={option}>
														{option}
													</option>
												))}
											</select>
										</div>
										<div>
											<label className="block text-sm font-medium text-slate-700">
												Date <span className="text-rose-500">*</span>
											</label>
											<input
												type="date"
												className="input-base mt-2"
												value={registerAppointmentForm.date}
												onChange={(e) => {
													setRegisterAppointmentForm(prev => ({
														...prev,
														date: e.target.value,
														time: '',
														duration: 0,
													}));
													setRegisterSelectedSlots([]);
												}}
												min={new Date().toISOString().split('T')[0]}
												disabled={registerSubmitting}
												required={bookAppointment}
											/>
										</div>
									</div>

									<div>
										<label className="block text-sm font-medium text-slate-700">
											Time Slot <span className="text-rose-500">*</span>
										</label>
										{!registerAppointmentForm.doctor && !registerAppointmentForm.date ? (
											<p className="mt-2 text-xs text-slate-500">Select a clinician and date to view available time slots.</p>
										) : !registerAppointmentForm.doctor ? (
											<p className="mt-2 text-xs text-slate-500">Select a clinician to view available time slots.</p>
										) : !registerAppointmentForm.date ? (
											<p className="mt-2 text-xs text-slate-500">Select a date to view available time slots.</p>
										) : registerAvailableSlots.length === 0 ? (
											<div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
												No slots available for {registerAppointmentForm.doctor} on {registerAppointmentForm.date}. Pick another date or clinician.
											</div>
										) : (
											<div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
												{registerAvailableSlots.map(slot => {
													const slotEnd = minutesToTimeString(timeStringToMinutes(slot) + SLOT_INTERVAL_MINUTES);
													const isSelected = registerSelectedSlots.includes(slot);
													return (
														<button
															type="button"
															key={slot}
															onClick={() => handleRegisterSlotToggle(slot)}
															className={`rounded-xl border px-3 py-2 text-sm font-medium shadow-sm transition ${
																isSelected
																	? 'border-sky-500 bg-sky-50 text-sky-800 ring-2 ring-sky-200'
																	: 'border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50'
															}`}
															aria-pressed={isSelected}
															disabled={registerSubmitting}
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
										)}
										{registerSelectedSlots.length > 0 && (
											<p className="mt-2 text-xs font-medium text-slate-600">
												Selected duration:{' '}
												<span className="text-slate-900">{formatDurationLabel(registerSelectedSlots.length * SLOT_INTERVAL_MINUTES)}</span>
											</p>
										)}
									</div>

									<div>
										<label className="block text-sm font-medium text-slate-700">Notes (optional)</label>
										<textarea
											className="input-base mt-2"
											rows={3}
											value={registerAppointmentForm.notes}
											onChange={(e) => setRegisterAppointmentForm(prev => ({ ...prev, notes: e.target.value }))}
											placeholder="Add any notes for the clinician..."
											disabled={registerSubmitting}
										/>
									</div>
								</div>
							)}

							<footer className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
								<button type="button" onClick={handleCloseRegisterModal} className="btn-secondary" disabled={registerSubmitting}>
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

			{/* View Patient Details Modal */}
			{viewingPatient && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
					<div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
						<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
							<div>
								<h2 className="text-lg font-semibold text-slate-900">View All Data</h2>
								<p className="text-xs text-slate-500">
									Complete record for {viewingPatient.name || 'Unnamed'} ({viewingPatient.patientId || '—'})
								</p>
							</div>
							<button
								type="button"
								onClick={handleClosePatientDetails}
								className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:bg-slate-100 focus-visible:text-slate-600 focus-visible:outline-none"
								aria-label="Close dialog"
							>
								<i className="fas fa-times" aria-hidden="true" />
							</button>
						</header>
						<div className="max-h-[70vh] overflow-y-auto px-6 py-4 space-y-6">
							<section>
								<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Basic Details</p>
								<div className="mt-3 grid gap-4 sm:grid-cols-2">
									<div>
										<p className="text-xs text-slate-500">Patient ID</p>
										<p className="text-sm font-medium text-slate-900">{viewingPatient.patientId || '—'}</p>
									</div>
									<div>
										<p className="text-xs text-slate-500">Status</p>
										<span className={`badge-base inline-flex px-3 py-1 ${STATUS_BADGES[viewingPatient.status]}`}>
											{viewingPatient.status.charAt(0).toUpperCase() + viewingPatient.status.slice(1)}
										</span>
									</div>
									<div>
										<p className="text-xs text-slate-500">Registered</p>
										<p className="text-sm font-medium text-slate-900">{formatDateLabel(viewingPatient.registeredAt)}</p>
									</div>
									<div>
										<p className="text-xs text-slate-500">Patient Type</p>
										<p className="text-sm font-medium text-slate-900">{viewingPatient.patientType || '—'}</p>
									</div>
								</div>
							</section>

							<section>
								<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Personal Information</p>
								<div className="mt-3 grid gap-4 sm:grid-cols-2">
									<div>
										<p className="text-xs text-slate-500">Full Name</p>
										<p className="text-sm font-medium text-slate-900">{viewingPatient.name || '—'}</p>
									</div>
									<div>
										<p className="text-xs text-slate-500">Date of Birth</p>
										<p className="text-sm font-medium text-slate-900">
											{viewingPatient.dob ? formatDateLabel(viewingPatient.dob) : '—'}
										</p>
									</div>
									<div>
										<p className="text-xs text-slate-500">Gender</p>
										<p className="text-sm font-medium text-slate-900">{viewingPatient.gender || '—'}</p>
									</div>
									<div>
										<p className="text-xs text-slate-500">Assigned Doctor</p>
										<p className="text-sm font-medium text-slate-900">{viewingPatient.assignedDoctor || '—'}</p>
									</div>
								</div>
							</section>

							<section>
								<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contact & Assignment</p>
								<div className="mt-3 grid gap-4 sm:grid-cols-2">
									<div>
										<p className="text-xs text-slate-500">Phone</p>
										<p className="text-sm font-medium text-slate-900">{viewingPatient.phone || '—'}</p>
									</div>
									<div>
										<p className="text-xs text-slate-500">Email</p>
										<p className="text-sm font-medium text-slate-900">{viewingPatient.email || '—'}</p>
									</div>
									<div className="sm:col-span-2">
										<p className="text-xs text-slate-500">Address</p>
										<p className="text-sm font-medium text-slate-900">{viewingPatient.address || '—'}</p>
									</div>
									<div>
										<p className="text-xs text-slate-500">Frontdesk Owner</p>
										<p className="text-sm font-medium text-slate-900">
											{viewingPatient.assignedFrontdeskName || '—'}
										</p>
										<p className="text-xs text-slate-500">{viewingPatient.assignedFrontdeskEmail || '—'}</p>
									</div>
									<div>
										<p className="text-xs text-slate-500">Frontdesk ID</p>
										<p className="text-sm font-medium text-slate-900">{viewingPatient.assignedFrontdeskId || '—'}</p>
									</div>
								</div>
							</section>

							<section>
								<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sessions & Package</p>
								<div className="mt-3 grid gap-4 sm:grid-cols-2">
									<div>
										<p className="text-xs text-slate-500">Total Sessions</p>
										<p className="text-sm font-medium text-slate-900">
											{typeof viewingPatient.totalSessionsRequired === 'number'
												? viewingPatient.totalSessionsRequired
												: '—'}
										</p>
									</div>
									<div>
										<p className="text-xs text-slate-500">Remaining Sessions</p>
										<p className="text-sm font-medium text-slate-900">
											{typeof viewingPatient.remainingSessions === 'number'
												? viewingPatient.remainingSessions
												: '—'}
										</p>
									</div>
									<div>
										<p className="text-xs text-slate-500">Package Amount</p>
										<p className="text-sm font-medium text-slate-900">
											{typeof viewingPatient.packageAmount === 'number'
												? viewingPatient.packageAmount.toLocaleString()
												: '—'}
										</p>
									</div>
									<div>
										<p className="text-xs text-slate-500">Payment Type</p>
										<p className="text-sm font-medium text-slate-900">{viewingPatient.paymentType || '—'}</p>
									</div>
									<div>
										<p className="text-xs text-slate-500">Payment Notes</p>
										<p className="text-sm font-medium text-slate-900">{viewingPatient.paymentDescription || '—'}</p>
									</div>
									<div>
										<p className="text-xs text-slate-500">Concession %</p>
										<p className="text-sm font-medium text-slate-900">
											{typeof viewingPatient.concessionPercent === 'number'
												? `${viewingPatient.concessionPercent}%`
												: '—'}
										</p>
									</div>
								</div>
							</section>

							<section>
								<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Complaint / Notes</p>
								<div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
									{viewingPatient.complaint || 'No complaint recorded.'}
								</div>
							</section>
						</div>
						<footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
							<button type="button" onClick={handleClosePatientDetails} className="btn-primary">
								Close
							</button>
						</footer>
					</div>
				</div>
			)}

			{/* Booking Modal */}
			{showBookingModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
					<div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
						<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
							<div>
								<h2 className="text-lg font-semibold text-slate-900">Book Appointment</h2>
								{selectedBookingPatient ? (
									<p className="text-xs text-slate-500">
										Booking first appointment for {selectedBookingPatient.name} (
										{selectedBookingPatient.patientId})
									</p>
								) : (
									<p className="text-xs text-rose-500">Selected patient is no longer available.</p>
								)}
							</div>
							<button
								type="button"
								onClick={handleCloseBookingModal}
								className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:bg-slate-100 focus-visible:text-slate-600 focus-visible:outline-none"
								aria-label="Close dialog"
								disabled={bookingLoading}
							>
								<i className="fas fa-times" aria-hidden="true" />
							</button>
						</header>
						<div className="max-h-[70vh] overflow-y-auto px-6 py-4">
							<div className="space-y-4">
								<div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
									<p className="font-semibold text-slate-800">Patient Details</p>
									<p>{selectedBookingPatient?.name ?? 'Not available'}</p>
									<p>ID: {selectedBookingPatient?.patientId ?? '—'}</p>
									<p>Phone: {selectedBookingPatient?.phone ?? '—'}</p>
									<p>Email: {selectedBookingPatient?.email ?? '—'}</p>
								</div>

								<div className="grid gap-4 sm:grid-cols-2">
								<div>
									<label className="block text-sm font-medium text-slate-700">
										Clinician <span className="text-rose-500">*</span>
									</label>
									<select
										value={bookingForm.doctor}
											onChange={event => {
												setBookingForm(prev => ({
													...prev,
													doctor: event.target.value,
													time: '',
													duration: 0,
												}));
												setSelectedSlots([]);
											}}
										className="select-base mt-2"
											disabled={bookingLoading}
										required
									>
										<option value="">{doctorOptions.length ? 'Select clinician' : 'No clinicians available'}</option>
										{doctorOptions.map(option => (
											<option key={option} value={option}>
												{option}
											</option>
										))}
									</select>
										{doctorOptions.length === 0 && (
											<p className="mt-1 text-xs text-amber-600">No active clinicians are available right now.</p>
									)}
								</div>
									<div>
										<label className="block text-sm font-medium text-slate-700">
											Date <span className="text-rose-500">*</span>
										</label>
										<input
											type="date"
											className="input-base mt-2"
											value={bookingForm.date}
											onChange={event => {
												setBookingForm(prev => ({
													...prev,
													date: event.target.value,
													time: '',
													duration: 0,
												}));
												setSelectedSlots([]);
											}}
											min={new Date().toISOString().split('T')[0]}
											disabled={bookingLoading}
											required
										/>
									</div>
								</div>

									<div>
										<label className="block text-sm font-medium text-slate-700">
										Time Slot <span className="text-rose-500">*</span>
										</label>
									{!bookingForm.doctor && !bookingForm.date ? (
										<p className="mt-2 text-xs text-slate-500">Select a clinician and date to view available time slots.</p>
									) : !bookingForm.doctor ? (
										<p className="mt-2 text-xs text-slate-500">Select a clinician to view available time slots.</p>
									) : !bookingForm.date ? (
										<p className="mt-2 text-xs text-slate-500">Select a date to view available time slots.</p>
									) : availableSlots.length === 0 ? (
										<div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
											No slots available for {bookingForm.doctor} on {bookingForm.date}. Pick another date or clinician.
										</div>
									) : (
										<div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
											{availableSlots.map(slot => {
												const slotEnd = minutesToTimeString(timeStringToMinutes(slot) + SLOT_INTERVAL_MINUTES);
												const isSelected = selectedSlots.includes(slot);
												return (
													<button
														type="button"
														key={slot}
														onClick={() => handleSlotToggle(slot)}
														className={`rounded-xl border px-3 py-2 text-sm font-medium shadow-sm transition ${
															isSelected
																? 'border-sky-500 bg-sky-50 text-sky-800 ring-2 ring-sky-200'
																: 'border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50'
														}`}
														aria-pressed={isSelected}
														disabled={bookingLoading}
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
									)}
									{selectedSlots.length > 0 && (
										<p className="mt-2 text-xs font-medium text-slate-600">
											Selected duration:{' '}
											<span className="text-slate-900">{formatDurationLabel(selectedSlots.length * SLOT_INTERVAL_MINUTES)}</span>
										</p>
									)}
									{selectedSlots.length <= 1 && (
										<p className="mt-1 text-xs text-slate-500">
											Select consecutive slots to automatically combine them into longer appointments.
										</p>
									)}
								</div>

								<div>
									<label className="block text-sm font-medium text-slate-700">Notes (optional)</label>
									<textarea
										className="input-base mt-2"
										rows={3}
										value={bookingForm.notes}
										onChange={event => setBookingForm(prev => ({ ...prev, notes: event.target.value }))}
										placeholder="Add any notes for the clinician..."
									/>
								</div>
							</div>
						</div>
						<footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
							<button type="button" onClick={handleCloseBookingModal} className="btn-secondary" disabled={bookingLoading}>
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
									!bookingForm.time ||
									!bookingForm.duration ||
									!selectedBookingPatient
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

			{/* Edit Dialog */}
			{isDialogOpen && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
					<div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl max-h-[90vh] overflow-hidden flex flex-col">
						<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
							<div>
								<h2 className="text-lg font-semibold text-slate-900">Edit Patient</h2>
								<p className="text-xs text-slate-500">Update patient information</p>
							</div>
							<button
								type="button"
								onClick={closeDialog}
								className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:bg-slate-100 focus-visible:text-slate-600 focus-visible:outline-none"
								aria-label="Close dialog"
							>
								<i className="fas fa-times" aria-hidden="true" />
							</button>
						</header>
						<form id="patient-edit-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-4">
							<div className="space-y-4">
								{/* Row 1: Full Name (6 cols), DOB (3 cols), Gender (3 cols) */}
								<div className="grid gap-4 md:grid-cols-12">
									<div className="md:col-span-6">
										<label className="block text-sm font-medium text-slate-700">
											Full Name <span className="text-rose-600">*</span>
										</label>
										<input
											type="text"
											value={formState.name}
											onChange={handleFormChange('name')}
											className="input-base"
											placeholder="Patient name"
											required
										/>
										{formErrors.name && <p className="mt-1 text-xs text-rose-500">{formErrors.name}</p>}
									</div>
									<div className="md:col-span-3">
										<label className="block text-sm font-medium text-slate-700">
											Date of Birth <span className="text-rose-600">*</span>
										</label>
										<input
											type="date"
											value={formState.dob}
											onChange={handleFormChange('dob')}
											className="input-base"
											required
										/>
										{formErrors.dob && <p className="mt-1 text-xs text-rose-500">{formErrors.dob}</p>}
									</div>
									<div className="md:col-span-3">
										<label className="block text-sm font-medium text-slate-700">
											Gender <span className="text-rose-600">*</span>
										</label>
										<select
											value={formState.gender}
											onChange={handleFormChange('gender')}
											className="select-base"
											required
										>
											{GENDER_OPTIONS.map(option => (
												<option key={option.value} value={option.value}>
													{option.label}
												</option>
											))}
										</select>
										{formErrors.gender && <p className="mt-1 text-xs text-rose-500">{formErrors.gender}</p>}
									</div>
								</div>

								{/* Row 2: Phone (3 cols), Email (6 cols), Status (3 cols) */}
								<div className="grid gap-4 md:grid-cols-12">
									<div className="md:col-span-3">
										<label className="block text-sm font-medium text-slate-700">
											Phone Number <span className="text-rose-600">*</span>
										</label>
										<input
											type="tel"
											value={formState.phone}
											onChange={handleFormChange('phone')}
											className="input-base"
											placeholder="10-15 digits"
											required
										/>
										{formErrors.phone && <p className="mt-1 text-xs text-rose-500">{formErrors.phone}</p>}
									</div>
									<div className="md:col-span-6">
										<label className="block text-sm font-medium text-slate-700">Email</label>
										<input
											type="email"
											value={formState.email}
											onChange={handleFormChange('email')}
											className="input-base"
											placeholder="name@example.com"
										/>
										{formErrors.email && <p className="mt-1 text-xs text-rose-500">{formErrors.email}</p>}
									</div>
									<div className="md:col-span-3">
										<label className="block text-sm font-medium text-slate-700">Status</label>
										<select
											value={formState.status}
											onChange={handleFormChange('status')}
											className="select-base"
										>
											{STATUS_OPTIONS.map(option => (
												<option key={option.value} value={option.value}>
													{option.label}
												</option>
											))}
										</select>
									</div>
								</div>

								{/* Row 3: Address */}
								<div className="grid gap-4 md:grid-cols-12">
									<div className="md:col-span-12">
										<label className="block text-sm font-medium text-slate-700">Address</label>
										<textarea
											value={formState.address}
											onChange={handleFormChange('address')}
											className="textarea-base"
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
														checked={formState.patientType === type}
														onChange={() => {
															setFormState(prev => ({
																...prev,
																patientType: type,
																paymentType: type === 'PAID' ? prev.paymentType : 'without',
															}));
															setFormErrors(prev => ({
																...prev,
																patientType: undefined,
															}));
														}}
														className="h-4 w-4 border-slate-300 text-sky-600 focus:ring-sky-200"
													/>
													<span className="text-sm font-medium text-slate-700">{type}</span>
												</label>
											))}
										</div>
										{formErrors.patientType && <p className="mt-1 text-xs text-rose-500">{formErrors.patientType}</p>}
									</div>
								</div>

								{/* Row 5: Payment Type and Description - Only visible when patientType is 'PAID' */}
								{formState.patientType === 'PAID' && (
									<div className="grid gap-4 md:grid-cols-12">
										<div className="md:col-span-6">
											<label className="block text-sm font-medium text-slate-700">
												Type of Payment <span className="text-rose-600">*</span>
											</label>
											<select
												value={formState.paymentType}
												onChange={handleFormChange('paymentType')}
												className="select-base"
												required
											>
												{PAYMENT_OPTIONS.map(option => (
													<option key={option.value} value={option.value}>
														{option.label}
													</option>
												))}
											</select>
											{formErrors.paymentType && <p className="mt-1 text-xs text-rose-500">{formErrors.paymentType}</p>}
										</div>
										<div className="md:col-span-6">
											<label className="block text-sm font-medium text-slate-700">
												Payment Description / Concession Reason
											</label>
											<input
												type="text"
												value={formState.paymentDescription}
												onChange={handleFormChange('paymentDescription')}
												className="input-base"
												placeholder="Enter details (if any)"
											/>
										</div>
									</div>
								)}

								{/* Row 6: Complaint */}
								<div className="grid gap-4 md:grid-cols-12">
									<div className="md:col-span-12">
										<label className="block text-sm font-medium text-slate-700">Complaint</label>
										<textarea
											value={formState.complaint}
											onChange={handleFormChange('complaint')}
											className="textarea-base"
											placeholder="Patient complaint or notes"
											rows={3}
										/>
									</div>
								</div>

								{/* Row 7: Assigned Doctor */}
								<div className="grid gap-4 md:grid-cols-12">
									<div className="md:col-span-6">
										<label className="block text-sm font-medium text-slate-700">Assigned Doctor</label>
										<select
											value={formState.assignedDoctor}
											onChange={handleFormChange('assignedDoctor')}
											className="select-base"
										>
											<option value="">No doctor assigned</option>
											{doctorOptions.map(option => (
												<option key={option} value={option}>
													{option}
												</option>
											))}
										</select>
										{formState.assignedDoctor && formState.assignedDoctor !== originalDoctor && (
											<p className="mt-1 text-xs text-amber-600">
												All appointments for this patient will be reassigned to the new clinician.
											</p>
										)}
									</div>
								</div>
							</div>
						</form>
						<footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
							<button type="button" onClick={closeDialog} className="btn-secondary">
								Cancel
							</button>
							<button type="submit" form="patient-edit-form" className="btn-primary">
								<i className="fas fa-save text-xs" aria-hidden="true" />
								Save Changes
							</button>
						</footer>
					</div>
				</div>
			)}

			{/* Payment Modal */}
			{showPaymentModal && selectedPaymentBill && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
					<div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
						<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
							<div>
								<h2 className="text-lg font-semibold text-slate-900">Process Payment</h2>
								<p className="text-xs text-slate-500">
									{selectedPaymentBill.billingId.startsWith('PKG-') ? 'Package Payment' : 'Consultation Payment'}
								</p>
							</div>
							<button
								type="button"
								onClick={handleClosePaymentModal}
								className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:bg-slate-100 focus-visible:text-slate-600 focus-visible:outline-none"
								aria-label="Close dialog"
								disabled={processingPayment}
							>
								<i className="fas fa-times" aria-hidden="true" />
							</button>
						</header>
						<div className="px-6 py-4 space-y-4">
							<div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
								<div className="flex justify-between items-center mb-2">
									<span className="text-slate-500">Bill ID:</span>
									<span className="font-semibold text-slate-900">{selectedPaymentBill.billingId}</span>
								</div>
								<div className="flex justify-between items-center mb-2">
									<span className="text-slate-500">Patient:</span>
									<span className="font-medium text-slate-900">{selectedPaymentBill.patient}</span>
								</div>
								{(() => {
									const isPackagePayment = selectedPaymentBill.billingId.startsWith('PKG-');
									const totalAmount = isPackagePayment
										? selectedPaymentBill.packageAmount ?? selectedPaymentBill.amount
										: selectedPaymentBill.amount;
									const amountPaid =
										selectedPaymentBill.amountPaid ??
										(selectedPaymentBill.status === 'Completed' ? totalAmount : 0);
									const amountDue = Math.max(totalAmount - amountPaid, 0);
										
										return (
											<>
												<div className="flex justify-between items-center mb-2">
												<span className="text-slate-500">
													{isPackagePayment ? 'Package Amount:' : 'Amount:'}
												</span>
													<span className="font-medium text-slate-900">₹{totalAmount}</span>
												</div>
											{isPackagePayment && selectedPaymentBill.concessionPercent ? (
												<div className="flex justify-between items-center mb-2">
													<span className="text-slate-500">Concession:</span>
													<span className="font-medium text-slate-900">
														{selectedPaymentBill.concessionPercent}% (
														₹{Number((totalAmount - selectedPaymentBill.amount).toFixed(2))} off)
													</span>
												</div>
											) : null}
											{amountPaid > 0 && (
												<div className="flex justify-between items-center mb-2">
													<span className="text-slate-500">Amount Paid:</span>
													<span className="font-medium text-slate-900">₹{amountPaid}</span>
												</div>
											)}
												<div className="flex justify-between items-center border-t border-slate-300 pt-2 mt-2">
												<span className="text-slate-700 font-semibold">Amount Due:</span>
												<span className="font-bold text-lg text-slate-900">₹{amountDue}</span>
												</div>
											</>
										);
								})()}
							</div>

							<div>
								<label className="block text-sm font-medium text-slate-700 mb-2">
									Payment Mode <span className="text-rose-600">*</span>
								</label>
								<select
									value={paymentMode}
									onChange={e => setPaymentMode(e.target.value)}
									className="select-base"
									disabled={processingPayment}
									required
								>
									<option value="Cash">Cash</option>
									<option value="UPI/Card">UPI/Card</option>
									<option value="Cheque">Cheque</option>
									<option value="Bank Transfer">Bank Transfer</option>
								</select>
							</div>

							{paymentMode === 'UPI/Card' && (
								<div>
									<label className="block text-sm font-medium text-slate-700 mb-2">
										UTR/Transaction ID <span className="text-rose-600">*</span>
									</label>
									<input
										type="text"
										value={utr}
										onChange={e => setUtr(e.target.value)}
										className="input-base"
										placeholder="Enter UTR or Transaction ID"
										disabled={processingPayment}
										required
									/>
								</div>
							)}

							{(paymentMode === 'Cheque' || paymentMode === 'Bank Transfer') && (
								<div>
									<label className="block text-sm font-medium text-slate-700 mb-2">
										Reference Number (Optional)
									</label>
									<input
										type="text"
										value={utr}
										onChange={e => setUtr(e.target.value)}
										className="input-base"
										placeholder="Enter reference number"
										disabled={processingPayment}
									/>
								</div>
							)}
						</div>
						<footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
							<button
								type="button"
								onClick={handleClosePaymentModal}
								className="btn-secondary"
								disabled={processingPayment}
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleSubmitPayment}
								className="btn-primary"
								disabled={processingPayment}
							>
								{processingPayment ? (
									<>
										<div className="mr-2 inline-flex h-4 w-4 items-center justify-center rounded-full border-2 border-white border-t-transparent animate-spin" />
										Processing...
									</>
								) : (
									<>
										<i className="fas fa-check text-xs" aria-hidden="true" />
										Process Payment
									</>
								)}
							</button>
						</footer>
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
								<p className="font-semibold text-slate-800">Consultation completed</p>
								<p>
									Record the patient's package payment details. This will create a billing entry and update the patient
									record.
								</p>
							</div>

							<div className="grid gap-4 md:grid-cols-12">
								<div className="md:col-span-6">
									<label className="block text-sm font-medium text-slate-700">
										Total No of Session <span className="text-rose-600">*</span>
									</label>
									<input
										type="number"
										min="1"
										step="1"
										value={packageForm.totalNoOfSessions}
										onChange={handlePackageFormChange('totalNoOfSessions')}
										className="input-base mt-2"
										placeholder="Enter total number of sessions"
										required
										disabled={packageSubmitting}
									/>
									{packageFormErrors.totalNoOfSessions && (
										<p className="mt-1 text-xs text-rose-500">{packageFormErrors.totalNoOfSessions}</p>
									)}
								</div>
								<div className="md:col-span-6">
									<label className="block text-sm font-medium text-slate-700">
										Type of Payment <span className="text-rose-600">*</span>
									</label>
									<select
										value={packageForm.paymentType}
										onChange={handlePackageFormChange('paymentType')}
										className="select-base mt-2"
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
								<div className="md:col-span-6">
									<label className="block text-sm font-medium text-slate-700">
										Payment Description / Concession Reason
									</label>
									<input
										type="text"
										value={packageForm.paymentDescription}
										onChange={handlePackageFormChange('paymentDescription')}
										className="input-base mt-2"
										placeholder="Enter details (if any)"
										disabled={packageSubmitting}
									/>
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
											className="input-base mt-2"
											placeholder="Enter percentage discount"
											disabled={packageSubmitting}
										/>
										{packageFormErrors.concessionPercent && (
											<p className="mt-1 text-xs text-rose-500">{packageFormErrors.concessionPercent}</p>
										)}
									</div>
								)}
							</div>

							<div className="grid gap-4 md:grid-cols-12">
								<div className="md:col-span-6">
									<label className="block text-sm font-medium text-slate-700">
										Package Amount <span className="text-rose-600">*</span>
									</label>
									<div className="relative mt-2">
										<span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-500">
											₹
										</span>
										<input
											type="number"
											min="0"
											step="0.01"
											value={packageForm.packageAmount}
											onChange={handlePackageFormChange('packageAmount')}
											className="input-base pl-8"
											placeholder="0.00"
											required
											disabled={packageSubmitting}
										/>
									</div>
									{packageFormErrors.packageAmount && (
										<p className="mt-1 text-xs text-rose-500">{packageFormErrors.packageAmount}</p>
									)}
								</div>
							</div>
						</div>
						<footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
							<button
								type="button"
								onClick={handleClosePackageModal}
								className="btn-secondary"
								disabled={packageSubmitting}
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleSubmitPackageSetup}
								className="btn-primary"
								disabled={packageSubmitting}
							>
								{packageSubmitting ? (
									<>
										<div className="mr-2 inline-flex h-4 w-4 items-center justify-center rounded-full border-2 border-white border-t-transparent animate-spin" />
										Saving...
									</>
								) : (
									<>
										<i className="fas fa-save text-xs" aria-hidden="true" />
										Save Package
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
				initialTab={reportModalInitialTab}
				onClose={handleCloseReportModal}
			/>

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

		</div>
	);
}
