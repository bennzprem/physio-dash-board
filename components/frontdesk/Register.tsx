'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, addDoc, updateDoc, doc, getDocs, onSnapshot, serverTimestamp, query, where, type QuerySnapshot, type Timestamp } from 'firebase/firestore';

import {
	type AdminAppointmentStatus,
	type AdminGenderOption,
	type AdminPatientStatus,
} from '@/lib/adminMockData';
import { db } from '@/lib/firebase';
import PageHeader from '@/components/PageHeader';
import { sendEmailNotification } from '@/lib/email';
import { sendSMSNotification, isValidPhoneNumber } from '@/lib/sms';
import { sendWhatsAppNotification } from '@/lib/whatsapp';
import { createInitialSessionAllowance, normalizeSessionAllowance } from '@/lib/sessionAllowance';
import type { SessionAllowance } from '@/lib/types';

type PaymentTypeOption = 'with' | 'without';
// MODIFIED: Changed Gethhma to GETHNA
type PatientTypeOption = 'DYES' | 'VIP' | 'GETHNA' | 'PAID' | 'OTHERS' | 'STAFF' | '';

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
	assignedDoctor?: string;
	sessionAllowance?: SessionAllowance | null;
}

interface FrontdeskAppointment {
	id?: string;
	appointmentId: string;
	patientId: string;
	patient: string;
	doctor: string;
	date: string;
	time: string;
	status: AdminAppointmentStatus;
	notes?: string;
	createdAt: string;
}

interface BannerState {
	title: string;
	description: string;
	accent: 'emerald' | 'sky';
}

interface AssignmentState {
	patient: FrontdeskPatient;
	doctor: string;
	date: string;
	time: string;
	errors: Partial<Record<'doctor' | 'date' | 'time', string>>;
}



const STATUS_STYLES: Record<AdminPatientStatus, string> = {
	pending: 'status-badge-pending',
	ongoing: 'status-badge-ongoing',
	completed: 'status-badge-completed',
	cancelled: 'status-badge-cancelled',
};

const BANNER_STYLES: Record<NonNullable<BannerState['accent']>, string> = {
	emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
	sky: 'border-sky-200 bg-sky-50 text-sky-700',
};

// MODIFIED: Changed Gethhma to GETHNA
const PATIENT_TYPE_OPTIONS: Array<{ value: PatientTypeOption; label: string }> = [
	{ value: 'DYES', label: 'DYES' },
	{ value: 'VIP', label: 'VIP' },
	{ value: 'PAID', label: 'PAID' },
	{ value: 'GETHNA', label: 'GETHNA' },
	{ value: 'STAFF', label: 'STAFF' },
	{ value: 'OTHERS', label: 'Others' },
];

const PAYMENT_OPTIONS: Array<{ value: PaymentTypeOption; label: string }> = [
	{ value: 'with', label: 'With Concession' },
	{ value: 'without', label: 'Without Concession' },
];

const GENDER_OPTIONS: Array<{ value: AdminGenderOption; label: string }> = [
	{ value: '', label: 'Select' },
	{ value: 'Male', label: 'Male' },
	{ value: 'Female', label: 'Female' },
	{ value: 'Other', label: 'Other' },
];

const PHONE_REGEX = /^[0-9]{10,15}$/;

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

async function generateAppointmentId(): Promise<string> {
	const prefix = 'APT';
	const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	
	// Check existing appointment IDs in Firestore
	const appointmentsSnapshot = await getDocs(collection(db, 'appointments'));
	const existingIds = new Set(appointmentsSnapshot.docs.map(doc => doc.data().appointmentId).filter(Boolean));
	
	let candidate = '';
	do {
		let randomPart = '';
		for (let index = 0; index < 5; index += 1) {
			randomPart += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
		}
		candidate = `${prefix}-${randomPart}`;
	} while (existingIds.has(candidate));

	return candidate;
}

function formatDateLabel(value: string) {
	if (!value) return '—';
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return value;
	return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
}

export default function Register() {
	const [patients, setPatients] = useState<FrontdeskPatient[]>([]);
	const [loading, setLoading] = useState(true);
	const [form, setForm] = useState({
		fullName: '',
		dob: '',
		gender: '' as AdminGenderOption,
		phone: '',
		email: '',
		address: '',
		patientType: '' as PatientTypeOption,
		paymentType: '' as PaymentTypeOption | '',
		paymentDescription: '',
	});
	const [formErrors, setFormErrors] = useState<Partial<Record<keyof typeof form, string>>>({});
	const [banner, setBanner] = useState<BannerState | null>(null);
	const [assignment, setAssignment] = useState<AssignmentState | null>(null);
	const [clinicianOptions, setClinicianOptions] = useState<Array<{ name: string; role: string; id: string; availability?: Record<string, any> }>>([]);
	const [submitting, setSubmitting] = useState(false);
	const [clinicianTypeFilter, setClinicianTypeFilter] = useState<'all' | 'Physiotherapist' | 'StrengthAndConditioning'>('all');

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
						sessionAllowance: data.sessionAllowance
							? normalizeSessionAllowance(data.sessionAllowance as SessionAllowance)
							: null,
					} as FrontdeskPatient;
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

	// Load clinicians from staff collection
	useEffect(() => {
		const unsubscribe = onSnapshot(
			collection(db, 'staff'),
			(snapshot: QuerySnapshot) => {
				const clinicians = snapshot.docs
					.map(docSnap => {
						const data = docSnap.data();
						return {
							id: docSnap.id,
							name: data.userName as string,
							role: data.role as string,
							status: data.status as string,
							availability: data.availability as Record<string, any> | undefined,
						};
					})
					.filter(
						staff =>
							['Physiotherapist', 'StrengthAndConditioning', 'ClinicalTeam'].includes(staff.role || '') &&
							staff.status === 'Active' &&
							Boolean(staff.name)
					)
					.map(staff => ({
						name: staff.name,
						role: staff.role,
						id: staff.id,
						availability: staff.availability,
					}));

				setClinicianOptions(clinicians);
			},
			error => {
				console.error('Failed to load staff', error);
				setClinicianOptions([]);
			}
		);

		return () => unsubscribe();
	}, []);


	const handleFormChange = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
		let value: string;
		if (field === 'paymentType') {
			value = (event.target as HTMLSelectElement).value;
		} else {
			value = event.target.value;
		}
		setForm(current => ({
			...current,
			[field]: value,
		}));
		setFormErrors(current => ({
			...current,
			[field]: undefined,
		}));
	};

	const validateForm = () => {
		const errors: Partial<Record<keyof typeof form, string>> = {};
		if (!form.fullName.trim()) {
			errors.fullName = 'Please enter the patient\'s full name.';
		}
		if (!form.dob) {
			errors.dob = 'Please provide the date of birth.';
		}
		if (!form.gender) {
			errors.gender = 'Please select gender.';
		}
		if (!form.phone.trim()) {
			errors.phone = 'Please enter a valid phone number (10-15 digits).';
		} else if (!PHONE_REGEX.test(form.phone.trim())) {
			errors.phone = 'Please enter a valid phone number (10-15 digits).';
		}
		if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
			errors.email = 'Please enter a valid email address.';
		}
		if (!form.patientType) {
			errors.patientType = 'Please select Type of Organization.';
		}
		if (form.patientType === 'PAID' && !form.paymentType) {
			errors.paymentType = 'Please select payment type.';
		}

		setFormErrors(errors);
		return Object.keys(errors).length === 0;
	};

	const handleRegister = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!validateForm() || submitting) return;

		setSubmitting(true);
		try {
			// Check if patient with this phone number already exists
			const trimmedPhone = form.phone.trim();
			const phoneQuery = query(collection(db, 'patients'), where('phone', '==', trimmedPhone));
			const phoneSnapshot = await getDocs(phoneQuery);
			
			if (!phoneSnapshot.empty) {
				alert('Patient with this phone number is already registered.');
				setSubmitting(false);
				return;
			}

			const patientId = await generatePatientId();
			
			const patientData = {
				patientId,
				name: form.fullName.trim(),
				dob: form.dob,
				gender: form.gender,
				phone: form.phone.trim(),
				email: form.email.trim() || null,
				address: form.address.trim() || null,
				complaint: '',
				status: 'pending' as AdminPatientStatus,
				registeredAt: serverTimestamp(),
				patientType: form.patientType as PatientTypeOption,
				paymentType: form.patientType === 'PAID' ? (form.paymentType as PaymentTypeOption) : 'without' as PaymentTypeOption,
				paymentDescription: form.patientType === 'PAID' ? (form.paymentDescription.trim() || null) : null,
				sessionAllowance: form.patientType === 'DYES' ? createInitialSessionAllowance() : null,
			};

			await addDoc(collection(db, 'patients'), patientData);

			// Send registration email if email is provided
			let emailSent = false;
			if (form.email.trim()) {
				try {
					const emailResult = await sendEmailNotification({
						to: form.email.trim(),
						subject: `Welcome to Centre For Sports Science - Patient ID: ${patientId}`,
						template: 'patient-registered',
						data: {
							patientName: form.fullName.trim(),
							patientEmail: form.email.trim(),
							patientId,
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
			if (form.phone.trim() && isValidPhoneNumber(form.phone.trim())) {
				try {
					const smsResult = await sendSMSNotification({
						to: form.phone.trim(),
						template: 'patient-registered',
						data: {
							patientName: form.fullName.trim(),
							patientPhone: form.phone.trim(),
							patientId,
						},
					});
					smsSent = smsResult.success;
				} catch (smsError) {
					// Log error but don't fail registration
					console.error('Failed to send registration SMS:', smsError);
				}
			}

			setForm({
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
			// Build confirmation message
			const confirmations = [];
			if (emailSent) confirmations.push('email');
			if (smsSent) confirmations.push('SMS');
			const confirmationText = confirmations.length > 0 
				? ` Confirmation sent via ${confirmations.join(' and ')}.`
				: '';

			setBanner({
				title: 'Patient registered',
				description: `${form.fullName.trim()} has been assigned ID ${patientId}.${confirmationText}`,
				accent: 'emerald',
			});
		} catch (error) {
			console.error('Failed to register patient', error);
			setBanner({
				title: 'Registration failed',
				description: 'Failed to register patient. Please try again.',
				accent: 'sky',
			});
		} finally {
			setSubmitting(false);
		}
	};

	const filteredClinicians = useMemo(() => {
		if (clinicianTypeFilter === 'all') {
			return clinicianOptions;
		}
		return clinicianOptions.filter(clinician => clinician.role === clinicianTypeFilter);
	}, [clinicianOptions, clinicianTypeFilter]);

	const openAssignment = (patient: FrontdeskPatient) => {
		setAssignment({
			patient,
			doctor: filteredClinicians[0]?.name ?? '',
			date: '',
			time: '',
			errors: {},
		});
	};

	const handleAssignmentSubmit = async () => {
		if (!assignment || submitting) return;
		const errors: AssignmentState['errors'] = {};

		if (!assignment.doctor) {
			errors.doctor = 'Select a clinician.';
		}
		if (!assignment.date) {
			errors.date = 'Choose a date.';
		}
		if (!assignment.time) {
			errors.time = 'Choose a time.';
		}

		if (Object.keys(errors).length > 0) {
			setAssignment(current => (current ? { ...current, errors } : current));
			return;
		}

		// Check if patient has any completed appointments
		// If they do, they should book through the backend instead
		try {
			const appointmentsQuery = query(
				collection(db, 'appointments'),
				where('patientId', '==', assignment.patient.patientId),
				where('status', '==', 'completed')
			);
			const appointmentsSnapshot = await getDocs(appointmentsQuery);
			
			if (!appointmentsSnapshot.empty) {
				setBanner({
					title: 'Cannot book appointment',
					description: `This patient has ${appointmentsSnapshot.size} completed appointment(s). Subsequent appointments should be booked through the Clinical Dashboard. Please use the Clinical Dashboard to book appointments for this patient.`,
					accent: 'sky',
				});
				return;
			}
		} catch (checkError) {
			console.error('Failed to check patient appointments', checkError);
			// Continue with booking if check fails (fail open)
		}

		setSubmitting(true);
		try {
			// Check if this is the patient's first appointment (consultation)
			let isConsultation = false;
			try {
				const allAppointmentsQuery = query(
					collection(db, 'appointments'),
					where('patientId', '==', assignment.patient.patientId)
				);
				const allAppointmentsSnapshot = await getDocs(allAppointmentsQuery);
				isConsultation = allAppointmentsSnapshot.empty; // First appointment if no appointments exist
			} catch (checkError) {
				console.error('Failed to check for existing appointments', checkError);
				// Default to consultation if check fails (fail open)
				isConsultation = true;
			}

			// Generate appointment ID
			const appointmentId = await generateAppointmentId();

			// Create appointment in Firestore
			await addDoc(collection(db, 'appointments'), {
				appointmentId,
				patientId: assignment.patient.patientId,
				patient: assignment.patient.name,
				doctor: assignment.doctor,
				date: assignment.date,
				time: assignment.time,
				status: 'ongoing' as AdminAppointmentStatus,
				isConsultation: isConsultation,
				createdAt: serverTimestamp(),
			});

			// Update patient status and assigned doctor in Firestore
			if (assignment.patient.id) {
				const patientRef = doc(db, 'patients', assignment.patient.id);
				await updateDoc(patientRef, {
					status: 'ongoing',
					assignedDoctor: assignment.doctor,
				});
			}

			// Send appointment confirmation email if patient email is available
			let emailSent = false;
			if (assignment.patient.email) {
				try {
					const emailResult = await sendEmailNotification({
						to: assignment.patient.email,
						subject: `Appointment Confirmed - ${assignment.date} at ${assignment.time}`,
						template: 'appointment-created',
						data: {
							patientName: assignment.patient.name,
							patientEmail: assignment.patient.email,
							patientId: assignment.patient.patientId,
							doctor: assignment.doctor,
							date: assignment.date,
							time: assignment.time,
							appointmentId,
						},
					});
					emailSent = emailResult.success;
				} catch (emailError) {
					// Log error but don't fail appointment creation
					console.error('Failed to send appointment email:', emailError);
				}
			}

			// Send appointment confirmation SMS if patient phone is available
			let smsSent = false;
			if (assignment.patient.phone && isValidPhoneNumber(assignment.patient.phone)) {
				try {
					const smsResult = await sendSMSNotification({
						to: assignment.patient.phone,
						template: 'appointment-created',
						data: {
							patientName: assignment.patient.name,
							patientPhone: assignment.patient.phone,
							patientId: assignment.patient.patientId,
							doctor: assignment.doctor,
							date: assignment.date,
							time: assignment.time,
							appointmentId,
						},
					});
					smsSent = smsResult.success;
				} catch (smsError) {
					// Log error but don't fail appointment creation
					console.error('Failed to send appointment SMS:', smsError);
				}
			}

			// Send appointment confirmation WhatsApp if patient phone is available
			let whatsappSent = false;
			if (assignment.patient.phone && isValidPhoneNumber(assignment.patient.phone)) {
				try {
					const whatsappResult = await sendWhatsAppNotification({
						to: assignment.patient.phone,
						template: 'appointment-created',
						data: {
							patientName: assignment.patient.name,
							patientPhone: assignment.patient.phone,
							patientId: assignment.patient.patientId,
							doctor: assignment.doctor,
							date: assignment.date,
							time: assignment.time,
							appointmentId,
						},
					});
					whatsappSent = whatsappResult.success;
				} catch (whatsappError) {
					// Log error but don't fail appointment creation
					console.error('Failed to send appointment WhatsApp:', whatsappError);
				}
			}

			// Build confirmation message
			const confirmations = [];
			if (emailSent) confirmations.push('email');
			if (smsSent) confirmations.push('SMS');
			if (whatsappSent) confirmations.push('WhatsApp');
			const confirmationText = confirmations.length > 0 
				? ` Confirmation sent via ${confirmations.join(', ')}.`
				: '';

			setBanner({
				title: 'Appointment scheduled',
				description: `${assignment.patient.name} is booked with ${assignment.doctor} on ${assignment.date} at ${assignment.time}.${confirmationText}`,
				accent: 'sky',
			});

			setAssignment(null);
		} catch (error) {
			console.error('Failed to schedule appointment', error);
			setBanner({
				title: 'Scheduling failed',
				description: 'Failed to schedule appointment. Please try again.',
				accent: 'sky',
			});
		} finally {
			setSubmitting(false);
		}
	};

	const dismissBanner = () => setBanner(null);

	return (
		<div className="min-h-svh bg-slate-50 px-6 py-10">
			<div className="mx-auto max-w-6xl space-y-10">
				<PageHeader
					title="Register Patient"
				/>

				<div className="border-t border-slate-200" />

				{banner && (
					<div
						className={`flex items-start justify-between gap-4 rounded-xl border px-4 py-3 text-sm ${BANNER_STYLES[banner.accent]}`}
						role="status"
					>
						<div>
							<p className="font-semibold">{banner.title}</p>
							<p className="mt-1">{banner.description}</p>
						</div>
						<button
							type="button"
							onClick={dismissBanner}
							className="rounded-full p-2 text-current transition hover:bg-white/40 focus-visible:outline-none"
							aria-label="Dismiss message"
						>
							<i className="fas fa-times" aria-hidden="true" />
						</button>
					</div>
				)}

				<section className="section-card">
					<form onSubmit={handleRegister} className="space-y-4">
						{/* Row 1: Full Name (6 cols), DOB (3 cols), Gender (3 cols) */}
						<div className="grid gap-4 md:grid-cols-12">
							<div className="md:col-span-6">
								<label className="block text-sm font-medium text-slate-700">
									Full Name <span className="text-rose-600">*</span>
								</label>
								<input
									type="text"
									value={form.fullName}
									onChange={handleFormChange('fullName')}
									className="input-base"
									placeholder="Patient name"
									autoComplete="name"
									required
								/>
								{formErrors.fullName && <p className="mt-1 text-xs text-rose-500">{formErrors.fullName}</p>}
							</div>
							<div className="md:col-span-3">
								<label className="block text-sm font-medium text-slate-700">
									Date of Birth <span className="text-rose-600">*</span>
								</label>
								<input
									type="date"
									value={form.dob}
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
									value={form.gender}
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

						{/* Row 2: Phone (3 cols), Email (6 cols) */}
						<div className="grid gap-4 md:grid-cols-12">
							<div className="md:col-span-3">
								<label className="block text-sm font-medium text-slate-700">
									Phone Number <span className="text-rose-600">*</span>
								</label>
								<input
									type="tel"
									value={form.phone}
									onChange={handleFormChange('phone')}
									className="input-base"
									placeholder="10-15 digits"
									pattern="[0-9]{10,15}"
									required
								/>
								{formErrors.phone && <p className="mt-1 text-xs text-rose-500">{formErrors.phone}</p>}
							</div>
							<div className="md:col-span-6">
								<label className="block text-sm font-medium text-slate-700">Email</label>
								<input
									type="email"
									value={form.email}
									onChange={handleFormChange('email')}
									className="input-base"
									placeholder="name@example.com"
									autoComplete="email"
								/>
								{formErrors.email && <p className="mt-1 text-xs text-rose-500">{formErrors.email}</p>}
							</div>
						</div>

						{/* Row 3: Address (9 cols) */}
						<div className="grid gap-4 md:grid-cols-12">
							<div className="md:col-span-9">
								<label className="block text-sm font-medium text-slate-700">Address</label>
								<textarea
									value={form.address}
									onChange={handleFormChange('address')}
									className="textarea-base"
									placeholder="Street, city, postal code"
									rows={2}
									autoComplete="street-address"
								/>
							</div>
						</div>

						{/* Row 4: Type of Organization (12 cols) */}
						<div className="grid gap-4 md:grid-cols-12">
							<div className="md:col-span-12">
								<label className="block text-sm font-medium text-slate-700">
									Type of Organization <span className="text-rose-600">*</span>
								</label>
								{/* MODIFIED: Changed "Gethhma" to "GETHNA" in the radio button list */}
								<div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
									{(['DYES', 'VIP', 'GETHNA', 'PAID', 'STAFF', 'OTHERS'] as const).map(type => (
										<label key={type} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 transition hover:border-sky-300 hover:bg-sky-50 cursor-pointer">
											<input
												type="radio"
												name="patientType"
												value={type}
												checked={form.patientType === type}
												onChange={() => {
													setForm(current => ({
														...current,
														patientType: type,
														paymentType: type === 'PAID' ? current.paymentType : '',
													}));
													setFormErrors(current => ({
														...current,
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

						{/* Row 5: Payment Type (6 cols), Payment Description (6 cols) - Only visible when patientType is 'PAID' */}
						{form.patientType === 'PAID' && (
							<div className="grid gap-4 md:grid-cols-12">
								<div className="md:col-span-6">
									<label className="block text-sm font-medium text-slate-700">
										Type of Payment <span className="text-rose-600">*</span>
									</label>
									<select
										value={form.paymentType}
										onChange={handleFormChange('paymentType')}
										className="select-base"
										required
									>
										<option value="" disabled>
											Select
										</option>
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
										value={form.paymentDescription}
										onChange={handleFormChange('paymentDescription')}
										className="input-base"
										placeholder="Enter details (if any)"
									/>
								</div>
							</div>
						)}

						{/* Row 6: Submit Button */}
						<div className="flex items-center justify-start">
							<button type="submit" className="btn-primary" disabled={submitting}>
								<i className="fas fa-user-plus text-xs" aria-hidden="true" />
								{submitting ? 'Registering...' : 'Register Patient'}
							</button>
						</div>
					</form>
				</section>
			</div>

			{assignment && (
				<div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
					<div className="absolute inset-0 bg-slate-900/60" onClick={() => setAssignment(null)} />
					<div className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl">
						<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
							<div>
								<h2 className="text-lg font-semibold text-slate-900">Assign appointment</h2>
								<p className="text-xs text-slate-500">{assignment.patient.name}</p>
							</div>
							<button
								type="button"
								onClick={() => setAssignment(null)}
								className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none"
								aria-label="Close dialog"
							>
								<i className="fas fa-times" aria-hidden="true" />
							</button>
						</header>
						<div className="space-y-4 px-6 py-6">
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
									value={assignment.doctor}
									onChange={event =>
										setAssignment(current =>
											current
												? {
														...current,
														doctor: event.target.value,
														errors: { ...current.errors, doctor: undefined },
													}
												: current,
										)
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
								{assignment.errors.doctor && (
									<p className="mt-1 text-xs text-rose-500">{assignment.errors.doctor}</p>
								)}
								{filteredClinicians.length === 0 && (
									<p className="mt-1 text-xs text-amber-600">
										No {clinicianTypeFilter === 'all' ? 'clinicians' : clinicianTypeFilter.toLowerCase()} available. Please check staff management.
									</p>
								)}
							</div>
							<div className="grid gap-4 sm:grid-cols-2">
								<div>
									<label className="block text-sm font-medium text-slate-700">Date</label>
									<input
										type="date"
										value={assignment.date}
										onChange={event =>
											setAssignment(current =>
												current
													? {
															...current,
															date: event.target.value,
															errors: { ...current.errors, date: undefined },
														}
													: current,
											)
										}
										className="input-base"
									/>
									{assignment.errors.date && (
										<p className="mt-1 text-xs text-rose-500">{assignment.errors.date}</p>
									)}
								</div>
								<div>
									<label className="block text-sm font-medium text-slate-700">Time</label>
									<input
										type="time"
										value={assignment.time}
										onChange={event =>
											setAssignment(current =>
												current
													? {
															...current,
															time: event.target.value,
															errors: { ...current.errors, time: undefined },
														}
													: current,
											)
										}
										className="input-base"
									/>
									{assignment.errors.time && (
										<p className="mt-1 text-xs text-rose-500">{assignment.errors.time}</p>
									)}
								</div>
							</div>
						</div>
						<footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
							<button type="button" onClick={() => setAssignment(null)} className="btn-secondary">
								Cancel
							</button>
							<button type="button" onClick={handleAssignmentSubmit} className="btn-primary" disabled={submitting}>
								<i className="fas fa-check text-xs" aria-hidden="true" />
								{submitting ? 'Scheduling...' : 'Start appointment'}
							</button>
						</footer>
					</div>
				</div>
			)}
		</div>
	);
}