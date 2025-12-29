'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { collection, doc, onSnapshot, updateDoc, deleteDoc, addDoc, serverTimestamp, query, where, getDocs, getDoc, type QuerySnapshot, type Timestamp } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import PageHeader from '@/components/PageHeader';
import type { AdminAppointmentStatus, AdminPatientStatus } from '@/lib/adminMockData';
import type { PatientRecord } from '@/lib/types';
import { sendEmailNotification } from '@/lib/email';
import { sendSMSNotification, isValidPhoneNumber } from '@/lib/sms';
import { checkAppointmentConflict, checkAvailabilityConflict } from '@/lib/appointmentUtils';
import { normalizeSessionAllowance } from '@/lib/sessionAllowance';
import { recordSessionUsageForAppointment } from '@/lib/sessionAllowanceClient';
import type { RecordSessionUsageResult } from '@/lib/sessionAllowanceClient';
import { useAuth } from '@/contexts/AuthContext';
import { createDYESBilling } from '@/lib/dyesBilling';

type AppointmentStatusFilter = 'all' | AdminAppointmentStatus;

interface FrontdeskAppointment {
	id: string;
	appointmentId: string;
	patientId: string;
	patient: string;
	doctor: string;
	date: string;
	time: string;
	status: AdminAppointmentStatus;
	createdAt: string;
	notes?: string;
}


const STATUS_BADGES: Record<AdminAppointmentStatus, string> = {
	pending: 'status-badge-pending',
	ongoing: 'status-badge-ongoing',
	completed: 'status-badge-completed',
	cancelled: 'status-badge-cancelled',
};

const STATUS_OPTIONS: Array<{ value: AppointmentStatusFilter; label: string }> = [
	{ value: 'all', label: 'All appointments' },
	{ value: 'pending', label: 'Pending' },
	{ value: 'ongoing', label: 'Ongoing' },
	{ value: 'completed', label: 'Completed' },
	{ value: 'cancelled', label: 'Cancelled' },
];

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
	registeredAt?: string;
};

interface BookingForm {
	patientId: string;
	doctor: string; // Clinician name (userName)
	date: string;
	time: string;
	notes?: string;
}

function formatDateLabel(value: string) {
	if (!value) return '—';
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return value;
	return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
}

export default function Appointments() {
	const searchParams = useSearchParams();
	const { user } = useAuth();
	const [appointments, setAppointments] = useState<FrontdeskAppointment[]>([]);
	const [patients, setPatients] = useState<PatientRecordWithSessions[]>([]);
	const [staff, setStaff] = useState<StaffMember[]>([]);
	const [loading, setLoading] = useState(true);
	const [statusFilter, setStatusFilter] = useState<AppointmentStatusFilter>('all');
	const [searchTerm, setSearchTerm] = useState('');
	const [editingId, setEditingId] = useState<string | null>(null);
	const [notesDraft, setNotesDraft] = useState('');
	const [editingDoctorId, setEditingDoctorId] = useState<string | null>(null);
	const [doctorDraft, setDoctorDraft] = useState('');
	const [updating, setUpdating] = useState<Record<string, boolean>>({});
	const [showBookingModal, setShowBookingModal] = useState(false);
	const [bookingForm, setBookingForm] = useState<BookingForm>({
		patientId: '',
		doctor: '',
		date: '',
		time: '',
		notes: '',
	});
	const [bookingLoading, setBookingLoading] = useState(false);
	const [conflictWarning, setConflictWarning] = useState<string | null>(null);
	const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
	const [showPatientAppointmentsModal, setShowPatientAppointmentsModal] = useState(false);

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
						assignedFrontdeskId: data.assignedFrontdeskId ? String(data.assignedFrontdeskId) : undefined,
						assignedFrontdeskName: data.assignedFrontdeskName ? String(data.assignedFrontdeskName) : undefined,
						assignedFrontdeskEmail: data.assignedFrontdeskEmail ? String(data.assignedFrontdeskEmail) : undefined,
						registeredAt,
					} as PatientRecordWithSessions;
				});
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


	const frontdeskAssignments = useMemo(() => {
		const map = new Map<string, string | undefined>();
		patients.forEach(patient => {
			map.set(patient.patientId, patient.assignedFrontdeskId);
		});
		return map;
	}, [patients]);

	// Group appointments by patient
	const groupedByPatient = useMemo(() => {
		const query = searchTerm.trim().toLowerCase();
		const filtered = appointments
			.filter(appointment => {
				const matchesStatus = statusFilter === 'all' || appointment.status === statusFilter;
				const matchesQuery =
					!query ||
					appointment.patient.toLowerCase().includes(query) ||
					appointment.patientId.toLowerCase().includes(query) ||
					appointment.doctor.toLowerCase().includes(query) ||
					appointment.appointmentId.toLowerCase().includes(query);
				const matchesAssignment =
					!user?.uid ||
					frontdeskAssignments.get(appointment.patientId) === user.uid;
				return matchesStatus && matchesQuery && matchesAssignment;
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
	}, [appointments, searchTerm, statusFilter, frontdeskAssignments, user?.uid]);

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

	// Filter patients eligible for frontdesk booking (only first appointments)
	// Patients with completed appointments should use backend/admin system
	const eligiblePatients = useMemo(() => {
		return patients.filter(patient => {
			const hasCompletedAppointments = appointments.some(
				a => a.patientId === patient.patientId && a.status === 'completed'
			);
			return !hasCompletedAppointments;
		});
	}, [patients, appointments]);

	// Filter clinicians by availability based on selected date/time
	const doctorOptions = useMemo(() => {
		const base = staff
			.filter(member => 
				member.status === 'Active' && 
				['Physiotherapist', 'StrengthAndConditioning', 'ClinicalTeam'].includes(member.role)
			)
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

	// Get all available clinicians for editing appointments
	const availableClinicians = useMemo(() => {
		return staff
			.filter(member => 
				member.status === 'Active' && 
				['Physiotherapist', 'StrengthAndConditioning', 'ClinicalTeam'].includes(member.role)
			)
			.map(member => member.userName)
			.filter(Boolean)
			.sort((a, b) => a.localeCompare(b));
	}, [staff]);

	// Clear doctor selection if they're no longer available
	useEffect(() => {
		if (!bookingForm.doctor) return;
		if (!doctorOptions.includes(bookingForm.doctor)) {
			setBookingForm(prev => ({ ...prev, doctor: '' }));
		}
	}, [bookingForm.doctor, doctorOptions]);

	// Clear patient selection if they become ineligible (have completed appointments)
	useEffect(() => {
		if (!bookingForm.patientId) return;
		const isEligible = eligiblePatients.some(p => p.patientId === bookingForm.patientId);
		if (!isEligible) {
			setBookingForm(prev => ({ ...prev, patientId: '' }));
		}
	}, [bookingForm.patientId, eligiblePatients]);

	// Handle bookFor query parameter from patient management page
	useEffect(() => {
		const bookForPatientId = searchParams?.get('bookFor');
		if (bookForPatientId && patients.length > 0 && !showBookingModal) {
			// Check if patient exists and is eligible
			const patient = eligiblePatients.find(p => p.patientId === bookForPatientId);
			if (patient) {
				setBookingForm({
					patientId: bookForPatientId,
					doctor: '',
					date: '',
					time: '',
					notes: '',
				});
				setShowBookingModal(true);
				// Clean up URL
				window.history.replaceState({}, '', window.location.pathname);
			}
		}
	}, [searchParams, patients, eligiblePatients, showBookingModal]);

	const pendingCount = appointments.filter(appointment => appointment.status === 'pending').length;
	const ongoingCount = appointments.filter(appointment => appointment.status === 'ongoing').length;
	const completedCount = appointments.filter(appointment => appointment.status === 'completed').length;

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
							createdByUserId: null,
							createdByUserName: null,
						});
					} catch (billingError) {
						console.error('Failed to create automatic DYES billing:', billingError);
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

	const handleEditDoctor = (appointment: FrontdeskAppointment) => {
		setEditingDoctorId(appointment.appointmentId);
		setDoctorDraft(appointment.doctor || '');
	};

	const handleSaveDoctor = async () => {
		if (!editingDoctorId) return;

		const appointment = appointments.find(a => a.appointmentId === editingDoctorId);
		if (!appointment) return;

		if (!doctorDraft.trim()) {
			alert('Please select a clinician.');
			return;
		}

		const staffMember = staff.find(member => member.userName === doctorDraft.trim());
		if (!staffMember) {
			alert('Selected clinician not found. Please select a valid clinician.');
			return;
		}

		setUpdating(prev => ({ ...prev, [appointment.id]: true }));
		try {
			const appointmentRef = doc(db, 'appointments', appointment.id);
			await updateDoc(appointmentRef, {
				doctor: doctorDraft.trim(),
				staffId: staffMember.id,
			});

			// Update patient's assignedDoctor if this is the most recent appointment
			const patientDetails = patients.find(p => p.patientId === appointment.patientId);
			if (patientDetails?.id) {
				const patientAppointments = appointments
					.filter(a => a.patientId === appointment.patientId)
					.sort((a, b) => {
						const aDate = new Date(`${a.date}T${a.time}`).getTime();
						const bDate = new Date(`${b.date}T${b.time}`).getTime();
						return bDate - aDate;
					});

				// If this is the most recent appointment, update patient's assignedDoctor
				if (patientAppointments.length > 0 && patientAppointments[0].appointmentId === appointment.appointmentId) {
					const patientRef = doc(db, 'patients', patientDetails.id);
					await updateDoc(patientRef, {
						assignedDoctor: doctorDraft.trim(),
					});
				}
			}

			setEditingDoctorId(null);
			setDoctorDraft('');
		} catch (error) {
			console.error('Failed to update appointment doctor', error);
			alert(`Failed to update clinician: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setUpdating(prev => ({ ...prev, [appointment.id]: false }));
		}
	};

	const handleCancelEditingDoctor = () => {
		setEditingDoctorId(null);
		setDoctorDraft('');
	};

	const handleOpenBookingModal = () => {
		setShowBookingModal(true);
		setBookingForm({
			patientId: '',
			doctor: '',
			date: '',
			time: '',
			notes: '',
		});
	};

	const handleCloseBookingModal = () => {
		setShowBookingModal(false);
		setBookingForm({
			patientId: '',
			doctor: '',
			date: '',
			time: '',
			notes: '',
		});
	};

	const handleCreateAppointment = async () => {
		if (!bookingForm.patientId || !bookingForm.doctor || !bookingForm.date || !bookingForm.time) {
			alert('Please select patient, clinician, date, and time.');
			return;
		}

		const selectedPatient = patients.find(p => p.patientId === bookingForm.patientId);
		const staffMember = staff.find(member => member.userName === bookingForm.doctor);

		if (!selectedPatient) {
			alert('Unable to find the selected patient.');
			return;
		}

		if (!staffMember) {
			alert('Unable to find the selected clinician.');
			return;
		}

		// Check if patient has any completed appointments
		// If they do, they should book through the backend instead
		const patientCompletedAppointments = appointments.filter(
			a => a.patientId === bookingForm.patientId && a.status === 'completed'
		);

		if (patientCompletedAppointments.length > 0) {
			alert(
				`This patient has ${patientCompletedAppointments.length} completed appointment(s). ` +
				`Subsequent appointments should be booked through the Clinical Dashboard. ` +
				`Please use the Clinical Dashboard to book appointments for this patient.`
			);
			return;
		}

		const conflict = checkAppointmentConflict(
			appointments.map(appointment => ({
				id: appointment.id,
				appointmentId: appointment.appointmentId,
				patient: appointment.patient,
				doctor: appointment.doctor,
				date: appointment.date,
				time: appointment.time,
				status: appointment.status,
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

		setBookingLoading(true);
		try {
			// Check if this is the patient's first appointment (consultation)
			const patientAllAppointments = appointments.filter(
				a => a.patientId === bookingForm.patientId
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
				status: 'pending' as AdminAppointmentStatus,
				notes: bookingForm.notes?.trim() || null,
				isConsultation: isConsultation,
				createdAt: serverTimestamp(),
			});

			// Update remaining sessions for the patient, if totalSessionsRequired is set
			if (typeof selectedPatient.totalSessionsRequired === 'number') {
				const completedCount = appointments.filter(
					a => a.patientId === bookingForm.patientId && a.status === 'completed'
				).length;
				// remainingSessions starts at totalSessionsRequired - 1 and decreases with each completed appointment
				const newRemaining = Math.max(0, selectedPatient.totalSessionsRequired - 1 - completedCount);

				const patientRef = doc(db, 'patients', selectedPatient.id);
				await updateDoc(patientRef, {
					remainingSessions: newRemaining,
				});

				setPatients(prev =>
					prev.map(p =>
						p.id === selectedPatient.id ? { ...p, remainingSessions: newRemaining } : p
					)
				);
			}

			// Ensure the patient's record reflects the assigned clinician and status
			if (selectedPatient.id) {
				try {
					const patientRef = doc(db, 'patients', selectedPatient.id);
					const patientUpdate: Record<string, unknown> = {
						assignedDoctor: bookingForm.doctor,
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
				} catch (patientUpdateError) {
					console.error('Failed to update patient assignment', patientUpdateError);
				}
			}

			// Send email notification if patient has email
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

			// Send SMS notification if patient has phone
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

			// Notify staff member
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

	return (
		<div className="min-h-svh bg-slate-50 px-6 py-10">
			<div className="mx-auto max-w-6xl space-y-10">
				<PageHeader
					title="Appointments"
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
					<div className="w-full md:w-48">
						<label className="block text-sm font-medium text-slate-700">Status filter</label>
						<select
							value={statusFilter}
							onChange={event => setStatusFilter(event.target.value as AppointmentStatusFilter)}
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
							</p>
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
										const statusCounts = {
											pending: group.appointments.filter(a => a.status === 'pending').length,
											ongoing: group.appointments.filter(a => a.status === 'ongoing').length,
											completed: group.appointments.filter(a => a.status === 'completed').length,
											cancelled: group.appointments.filter(a => a.status === 'cancelled').length,
										};

										return (
											<tr key={group.patientId}>
												<td className="px-4 py-4">
													<p className="text-sm font-medium text-slate-800">{group.patientName}</p>
													<p className="text-xs text-slate-500">
														<span className="font-semibold text-slate-600">ID:</span> {group.patientId}
													</p>
													<p className="text-xs text-slate-500">
														{patientDetails?.phone ? `Phone: ${patientDetails.phone}` : 'Phone not provided'}
													</p>
													{patientDetails?.email && (
														<p className="text-xs text-slate-500">
															Email: {patientDetails.email}
														</p>
													)}
												</td>
												<td className="px-4 py-4">
													<p className="text-sm font-semibold text-slate-900">
														{group.appointments.length} appointment{group.appointments.length === 1 ? '' : 's'}
													</p>
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
					<div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
						<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
							<div>
								<h2 className="text-lg font-semibold text-slate-900">Book Appointment</h2>
								<p className="text-xs text-slate-500">Create a new visit for first-time appointments only</p>
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
								<div>
									<label className="block text-sm font-medium text-slate-700">
										Patient <span className="text-rose-500">*</span>
									</label>
									<select
										value={bookingForm.patientId}
										onChange={event => setBookingForm(prev => ({ ...prev, patientId: event.target.value }))}
										className="select-base mt-2"
										required
									>
										<option value="">
											{eligiblePatients.length 
												? 'Select patient (first appointments only)' 
												: patients.length 
													? 'No eligible patients (all have completed appointments)' 
													: 'No patients available'}
										</option>
										{eligiblePatients.map(patient => {
											const regDate = patient.registeredAt ? formatDateLabel(patient.registeredAt) : '';
											return (
												<option key={patient.id} value={patient.patientId}>
													{patient.name} ({patient.patientId}){regDate ? ` - Registered: ${regDate}` : ''}
												</option>
											);
										})}
									</select>
									{patients.length > eligiblePatients.length && (
										<p className="mt-1 text-xs text-amber-600">
											Note: {patients.length - eligiblePatients.length} patient(s) with completed appointments are not shown. 
											Please use the Clinical Dashboard to book subsequent appointments for those patients.
										</p>
									)}
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
												: doctorOptions.length
													? 'Select clinician'
													: 'No clinicians available'}
										</option>
										{doctorOptions.map(option => (
											<option key={option} value={option}>
												{option}
											</option>
										))}
									</select>
									{(!bookingForm.date || !bookingForm.time) && (
										<p className="mt-1 text-xs text-slate-500">Pick a date and time to view available clinicians.</p>
									)}
									{bookingForm.date && bookingForm.time && doctorOptions.length === 0 && (
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
											onChange={event => setBookingForm(prev => ({ ...prev, date: event.target.value, doctor: '' }))}
											min={new Date().toISOString().split('T')[0]}
											required
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
											onChange={event => setBookingForm(prev => ({ ...prev, time: event.target.value, doctor: '' }))}
											required
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
									setEditingId(null);
									setNotesDraft('');
									setEditingDoctorId(null);
									setDoctorDraft('');
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
												const isEditingDoctor = editingDoctorId === appointment.appointmentId;
												const isUpdating = updating[appointment.id] || false;

												return (
													<tr key={appointment.appointmentId}>
														<td className="px-4 py-4">
															<p className="font-semibold text-slate-900">{appointment.appointmentId}</p>
															<p className="text-xs text-slate-500">
																Booked {formatDateLabel(appointment.createdAt)}
															</p>
														</td>
														<td className="px-4 py-4 text-sm text-slate-600">
															{isEditingDoctor ? (
																<div className="space-y-2">
																	<select
																		value={doctorDraft}
																		onChange={event => setDoctorDraft(event.target.value)}
																		className="select-base"
																		disabled={isUpdating}
																	>
																		<option value="">Select clinician</option>
																		{availableClinicians.map(clinician => (
																			<option key={clinician} value={clinician}>
																				{clinician}
																			</option>
																		))}
																	</select>
																	<div className="flex items-center gap-2">
																		<button
																			type="button"
																			onClick={handleSaveDoctor}
																			disabled={isUpdating}
																			className="btn-primary"
																		>
																			{isUpdating ? 'Saving...' : 'Save'}
																		</button>
																		<button
																			type="button"
																			onClick={handleCancelEditingDoctor}
																			disabled={isUpdating}
																			className="btn-secondary"
																		>
																			Cancel
																		</button>
																	</div>
																</div>
															) : (
																<div className="space-y-2">
																	<p>{appointment.doctor || 'Not assigned'}</p>
																	<button
																		type="button"
																		onClick={() => handleEditDoctor(appointment)}
																		className="text-xs font-semibold text-sky-600 hover:text-sky-500"
																	>
																		Edit clinician
																	</button>
																</div>
															)}
														</td>
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
									setEditingId(null);
									setNotesDraft('');
									setEditingDoctorId(null);
									setDoctorDraft('');
								}}
								className="btn-secondary"
							>
								Close
							</button>
						</footer>
					</div>
				</div>
			)}

		</div>
	);
}

