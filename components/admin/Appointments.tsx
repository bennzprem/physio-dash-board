'use client';

import { useEffect, useMemo, useState } from 'react';
import {
	addDoc,
	collection,
	doc,
	onSnapshot,
	serverTimestamp,
	updateDoc,
	type QuerySnapshot,
	type Timestamp,
} from 'firebase/firestore';

import {
	type AdminAppointmentRecord,
	type AdminAppointmentStatus,
	type AdminPatientRecord,
} from '@/lib/adminMockData';
import { db } from '@/lib/firebase';
import PageHeader from '@/components/PageHeader';
import { sendEmailNotification } from '@/lib/email';
import { sendSMSNotification, isValidPhoneNumber } from '@/lib/sms';
import RescheduleDialog from '@/components/appointments/RescheduleDialog';
import CancelDialog from '@/components/appointments/CancelDialog';
import { checkAppointmentConflict, checkAvailabilityConflict } from '@/lib/appointmentUtils';
import { normalizeSessionAllowance } from '@/lib/sessionAllowance';
import { recordSessionUsageForAppointment } from '@/lib/sessionAllowanceClient';
import type { RecordSessionUsageResult } from '@/lib/sessionAllowanceClient';

const statusLabels: Record<AdminAppointmentStatus, string> = {
	pending: 'Pending',
	ongoing: 'Ongoing',
	completed: 'Completed',
	cancelled: 'Cancelled',
};

const statusChipClasses: Record<AdminAppointmentStatus, string> = {
	pending: 'status-badge-pending',
	ongoing: 'status-badge-ongoing',
	completed: 'status-badge-completed',
	cancelled: 'status-badge-cancelled',
};

type DateSpecificAvailability = {
	[date: string]: {
		enabled: boolean;
		slots: Array<{ start: string; end: string }>;
	};
};

interface StaffMember {
	id: string;
	userName: string;
	role: string;
	status: string;
	userEmail?: string;
	dateSpecificAvailability?: DateSpecificAvailability;
}

type FirestoreAppointmentRecord = AdminAppointmentRecord & {
	id: string;
	appointmentId?: string;
	notes?: string;
	createdAt?: string;
};

export default function Appointments() {
	const [appointments, setAppointments] = useState<FirestoreAppointmentRecord[]>([]);
	const [patients, setPatients] = useState<(AdminPatientRecord & { id?: string; patientType?: string })[]>([]);
	const [staff, setStaff] = useState<StaffMember[]>([]);

	const [isDialogOpen, setIsDialogOpen] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [formData, setFormData] = useState({
		doctor: '',
		date: '',
		time: '',
		status: 'pending' as AdminAppointmentStatus,
		notes: '',
	});
	const [rescheduleDialog, setRescheduleDialog] = useState<{ isOpen: boolean; appointment: FirestoreAppointmentRecord | null }>({
		isOpen: false,
		appointment: null,
	});
	const [cancelDialog, setCancelDialog] = useState<{ isOpen: boolean; appointment: FirestoreAppointmentRecord | null }>({
		isOpen: false,
		appointment: null,
	});
	const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
	const [showPatientAppointmentsModal, setShowPatientAppointmentsModal] = useState(false);
	const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
	const [bookingLoading, setBookingLoading] = useState(false);
	const [bookingForm, setBookingForm] = useState({
		patientId: '',
		doctor: '',
		date: '',
		time: '',
		notes: '',
	});

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
						billing: data.billing ? (data.billing as { amount?: string; date?: string }) : undefined,
						createdAt: created ? created.toISOString() : (data.createdAt as string | undefined) || new Date().toISOString(),
					} as FirestoreAppointmentRecord;
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
						gender: data.gender ? String(data.gender) : '',
						phone: data.phone ? String(data.phone) : '',
						email: data.email ? String(data.email) : '',
						address: data.address ? String(data.address) : '',
						complaint: data.complaint ? String(data.complaint) : '',
						status: (data.status as string) ?? 'pending',
						registeredAt: created ? created.toISOString() : (data.registeredAt as string | undefined) || new Date().toISOString(),
						patientType: data.patientType ? String(data.patientType) : undefined,
						sessionAllowance: data.sessionAllowance
							? normalizeSessionAllowance(data.sessionAllowance as Record<string, unknown>)
							: undefined,
					} as AdminPatientRecord & { id: string };
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
						dateSpecificAvailability: data.dateSpecificAvailability as DateSpecificAvailability | undefined,
					} as StaffMember;
				});
				setStaff(mapped);
			},
			error => {
				console.error('Failed to load staff', error);
				setStaff([]);
			}
		);

		return () => unsubscribe();
	}, []);

	const patientLookup = useMemo(() => {
		const map = new Map<string, AdminPatientRecord & { id?: string; patientType?: string }>();
		for (const patient of patients) {
			map.set(patient.patientId, patient);
		}
		return map;
	}, [patients]);

	const doctorOptions = useMemo(() => {
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

	const patientSelectOptions = useMemo(() => {
		return [...patients]
			.sort((a, b) => a.name.localeCompare(b.name))
			.map(patient => ({
				label: `${patient.name} (${patient.patientId})`,
				value: patient.patientId,
			}));
	}, [patients]);

	useEffect(() => {
		if (!bookingForm.doctor) return;
		if (!doctorOptions.includes(bookingForm.doctor)) {
			setBookingForm(prev => ({ ...prev, doctor: '' }));
		}
	}, [bookingForm.doctor, doctorOptions]);

	// Group appointments by patient
	const groupedByPatient = useMemo(() => {
		// Group by patientId
		const grouped = new Map<string, FirestoreAppointmentRecord[]>();
		appointments.forEach(appointment => {
			const key = appointment.patientId || 'unknown';
			if (!grouped.has(key)) {
				grouped.set(key, []);
			}
			grouped.get(key)!.push(appointment);
		});

		// Sort appointments within each group and convert to array
		const result: Array<{ patientId: string; patientName: string; appointments: FirestoreAppointmentRecord[] }> = [];
		grouped.forEach((appts, patientId) => {
			const sorted = appts.sort((a, b) => {
				const aDate = new Date(`${a.date}T${a.time}`).getTime();
				const bDate = new Date(`${b.date}T${b.time}`).getTime();
				return bDate - aDate;
			});
			result.push({
				patientId,
				patientName: sorted[0].patient || patientLookup.get(patientId)?.name || patientId || 'N/A',
				appointments: sorted,
			});
		});

		// Sort groups by most recent appointment
		return result.sort((a, b) => {
			const aDate = new Date(`${a.appointments[0].date}T${a.appointments[0].time}`).getTime();
			const bDate = new Date(`${b.appointments[0].date}T${b.appointments[0].time}`).getTime();
			return bDate - aDate;
		});
	}, [appointments, patientLookup]);

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

	function formatDateLabel(value: string) {
		if (!value) return '—';
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) return value;
		return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
	}

	const openDialog = (id: string) => {
		const appointment = appointments.find(a => a.id === id);
		if (!appointment) return;
		setEditingId(id);
		setFormData({
			doctor: appointment.doctor ?? '',
			date: appointment.date ?? '',
			time: appointment.time ?? '',
			status: appointment.status ?? 'pending',
			notes: (appointment as AdminAppointmentRecord & { notes?: string }).notes ?? '',
		});
		setIsDialogOpen(true);
	};

	const closeDialog = () => {
		setIsDialogOpen(false);
		setEditingId(null);
		setFormData({
			doctor: '',
			date: '',
			time: '',
			status: 'pending',
			notes: '',
		});
	};

	const resetBookingForm = () => {
		setBookingForm({
			patientId: '',
			doctor: '',
			date: '',
			time: '',
			notes: '',
		});
	};

	const closeBookingModal = () => {
		resetBookingForm();
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
			await addDoc(collection(db, 'appointments'), {
				appointmentId,
				patientId: patientRecord.patientId,
				patient: patientRecord.name,
				doctor: bookingForm.doctor,
				date: bookingForm.date,
				time: bookingForm.time,
				status: 'pending',
				notes: bookingForm.notes.trim() || null,
				isConsultation: false, // Admin cannot create consultations
				createdAt: serverTimestamp(),
			});

			if (patientRecord.id) {
				const updates: Record<string, unknown> = {
					assignedDoctor: bookingForm.doctor,
				};
				if (!patientRecord.status || patientRecord.status === 'pending') {
					updates.status = 'ongoing';
				}
				await updateDoc(doc(db, 'patients', patientRecord.id), updates);
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
							patientEmail: patientRecord.email || staffMember.userEmail,
							patientId: patientRecord.patientId,
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
			resetBookingForm();
			setIsBookingModalOpen(false);
		} catch (error) {
			console.error('Failed to create appointment', error);
			alert(`Failed to create appointment: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setBookingLoading(false);
		}
	};

	const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (editingId === null) return;

		// Validation
		if (!formData.date) {
			alert('Please select a date.');
			return;
		}
		if (!formData.time) {
			alert('Please select a time.');
			return;
		}

		try {
			const appointment = appointments.find(a => a.id === editingId);
			if (!appointment) {
				console.error(`Appointment with id ${editingId} not found in local state.`);
				alert('Unable to locate the selected appointment. Please refresh and try again.');
				return;
			}

			const oldAppointment = { ...appointment };
			const patient = appointment.patientId ? patientLookup.get(appointment.patientId) : undefined;
			const staffMember = staff.find(s => s.userName === (formData.doctor || appointment.doctor));
			let sessionUsageResult: RecordSessionUsageResult | null = null;

			const updateData: Record<string, unknown> = {
				doctor: formData.doctor || null,
				date: formData.date,
				time: formData.time,
				status: formData.status,
				notes: formData.notes.trim() || null,
			};

			await updateDoc(doc(db, 'appointments', editingId), updateData);

			const dateChanged = oldAppointment.date !== formData.date;
			const timeChanged = oldAppointment.time !== formData.time;
			const statusChanged = oldAppointment.status !== formData.status;
			const doctorChanged = oldAppointment.doctor !== formData.doctor;
			const statusCapitalized = formData.status.charAt(0).toUpperCase() + formData.status.slice(1);

			if (statusChanged && formData.status === 'completed' && patient?.id) {
				try {
					sessionUsageResult = await recordSessionUsageForAppointment({
						patientDocId: patient.id,
						patientType: patient.patientType,
						appointmentId: appointment.id,
					});
				} catch (sessionError) {
					console.error('Failed to record DYES session usage:', sessionError);
				}
			}

			// Send email notification if patient has email and details changed
			if (patient?.email && oldAppointment) {
				if (dateChanged || timeChanged || doctorChanged) {
					// Appointment details updated
					try {
						await sendEmailNotification({
							to: patient.email,
							subject: `Appointment Updated - ${formData.date} at ${formData.time}`,
							template: 'appointment-updated',
							data: {
								patientName: appointment.patient || patient.name,
								patientEmail: patient.email,
								patientId: appointment.patientId,
								doctor: formData.doctor,
								date: formData.date,
								time: formData.time,
								appointmentId: appointment.appointmentId,
								notes: formData.notes.trim() || undefined,
							},
						});
					} catch (emailError) {
						console.error('Failed to send appointment update email to patient:', emailError);
					}
				} else if (statusChanged && (formData.status === 'completed' || formData.status === 'cancelled')) {
					// Only status changed to completed or cancelled
					const template = formData.status === 'cancelled' ? 'appointment-cancelled' : 'appointment-status-changed';
					try {
						await sendEmailNotification({
							to: patient.email,
							subject: formData.status === 'cancelled'
								? `Appointment Cancelled - ${formData.date}`
								: `Appointment ${statusCapitalized} - ${formData.date}`,
							template,
							data: {
								patientName: appointment.patient || patient.name,
								patientEmail: patient.email,
								patientId: appointment.patientId,
								doctor: formData.doctor || appointment.doctor,
								date: formData.date,
								time: formData.time,
								appointmentId: appointment.appointmentId,
								status: statusCapitalized,
							},
						});
					} catch (emailError) {
						console.error('Failed to send status change email to patient:', emailError);
					}
				}
			}

			// Send notification to staff member if status changed to completed or cancelled
			if (statusChanged && (formData.status === 'completed' || formData.status === 'cancelled') && staffMember?.userEmail) {
				try {
					await sendEmailNotification({
						to: staffMember.userEmail,
						subject: `Appointment ${statusCapitalized} - ${appointment.patient || patient?.name} on ${formData.date}`,
						template: 'appointment-status-changed',
						data: {
							patientName: appointment.patient || patient?.name,
							patientEmail: staffMember.userEmail,
							patientId: appointment.patientId,
							doctor: formData.doctor || appointment.doctor,
							date: formData.date,
							time: formData.time,
							appointmentId: appointment.appointmentId,
							status: statusCapitalized,
						},
					});
				} catch (emailError) {
					console.error('Failed to send status change email to staff:', emailError);
				}
			}

			if (sessionUsageResult && !sessionUsageResult.wasFree && patient?.email) {
				try {
					await sendEmailNotification({
						to: patient.email,
						subject: `Session Balance Update - ${appointment.patient || patient.name}`,
						template: 'session-balance',
						data: {
							recipientName: appointment.patient || patient.name,
							recipientType: 'patient',
							patientName: appointment.patient || patient.name,
							patientEmail: patient.email,
							patientId: appointment.patientId,
							appointmentDate: formData.date,
							appointmentTime: formData.time,
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
						subject: `Pending Sessions Alert - ${appointment.patient || patient?.name}`,
						template: 'session-balance',
						data: {
							recipientName: staffMember.userName,
							recipientType: 'therapist',
							patientName: appointment.patient || patient?.name || 'Patient',
							patientEmail: staffMember.userEmail,
							patientId: appointment.patientId,
							appointmentDate: formData.date,
							appointmentTime: formData.time,
							freeSessionsRemaining: sessionUsageResult.remainingFreeSessions,
							pendingPaidSessions: sessionUsageResult.allowance.pendingPaidSessions,
							pendingChargeAmount: sessionUsageResult.allowance.pendingChargeAmount,
						},
					});
				} catch (sessionEmailError) {
					console.error('Failed to send session balance email to staff:', sessionEmailError);
				}
			}

			// Send SMS notification if patient has valid phone and details changed
			if (patient?.phone && isValidPhoneNumber(patient.phone) && oldAppointment) {
				const dateChanged = oldAppointment.date !== formData.date;
				const timeChanged = oldAppointment.time !== formData.time;
				const statusChanged = oldAppointment.status !== formData.status;
				const doctorChanged = oldAppointment.doctor !== formData.doctor;

				try {
					if (dateChanged || timeChanged || doctorChanged) {
						// Appointment details updated - send update SMS
						await sendSMSNotification({
							to: patient.phone,
							template: 'appointment-updated',
							data: {
								patientName: appointment.patient || patient.name,
								patientPhone: patient.phone,
								patientId: appointment.patientId,
								doctor: formData.doctor,
								date: formData.date,
								time: formData.time,
								appointmentId: appointment.appointmentId,
							},
						});
					} else if (statusChanged && formData.status === 'cancelled') {
						// Appointment cancelled - send cancellation SMS
						await sendSMSNotification({
							to: patient.phone,
							template: 'appointment-cancelled',
							data: {
								patientName: appointment.patient || patient.name,
								patientPhone: patient.phone,
								patientId: appointment.patientId,
								doctor: formData.doctor || appointment.doctor,
								date: formData.date,
								time: formData.time,
								appointmentId: appointment.appointmentId,
							},
						});
					}
				} catch (smsError) {
					// Log error but don't fail appointment update
					console.error('Failed to send appointment update SMS:', smsError);
				}
			}

			closeDialog();
		} catch (error) {
			console.error('Failed to update appointment', error);
			alert('Failed to update appointment. Please try again.');
		}
	};

	const handleReschedule = async (newDate: string, newTime: string) => {
		if (!rescheduleDialog.appointment) return;

		try {
			const appointment = rescheduleDialog.appointment;
			const patient = appointment.patientId ? patientLookup.get(appointment.patientId) : undefined;

			await updateDoc(doc(db, 'appointments', appointment.id), {
				date: newDate,
				time: newTime,
			});

			// Send notifications
			if (patient?.email) {
				try {
					await sendEmailNotification({
						to: patient.email,
						subject: `Appointment Rescheduled - ${newDate} at ${newTime}`,
						template: 'appointment-updated',
						data: {
							patientName: appointment.patient || patient.name,
							patientEmail: patient.email,
							patientId: appointment.patientId,
							doctor: appointment.doctor,
							date: newDate,
							time: newTime,
							appointmentId: appointment.appointmentId,
						},
					});
				} catch (emailError) {
					console.error('Failed to send reschedule email:', emailError);
				}
			}

			if (patient?.phone && isValidPhoneNumber(patient.phone)) {
				try {
					await sendSMSNotification({
						to: patient.phone,
						template: 'appointment-updated',
						data: {
							patientName: appointment.patient || patient.name,
							patientPhone: patient.phone,
							patientId: appointment.patientId,
							doctor: appointment.doctor,
							date: newDate,
							time: newTime,
							appointmentId: appointment.appointmentId,
						},
					});
				} catch (smsError) {
					console.error('Failed to send reschedule SMS:', smsError);
				}
			}
		} catch (error) {
			console.error('Failed to reschedule appointment', error);
			throw error;
		}
	};

	const handleCancel = async (reason: string) => {
		if (!cancelDialog.appointment) return;

		try {
			const appointment = cancelDialog.appointment;
			const patient = appointment.patientId ? patientLookup.get(appointment.patientId) : undefined;
			const staffMember = staff.find(s => s.userName === appointment.doctor);

			await updateDoc(doc(db, 'appointments', appointment.id), {
				status: 'cancelled',
				cancellationReason: reason || null,
				cancelledAt: new Date().toISOString(),
			});

			// Send notifications to patient
			if (patient?.email) {
				try {
					await sendEmailNotification({
						to: patient.email,
						subject: `Appointment Cancelled - ${appointment.date}`,
						template: 'appointment-cancelled',
						data: {
							patientName: appointment.patient || patient.name,
							patientEmail: patient.email,
							patientId: appointment.patientId,
							doctor: appointment.doctor,
							date: appointment.date,
							time: appointment.time,
							appointmentId: appointment.appointmentId,
							reason: reason || undefined,
						},
					});
				} catch (emailError) {
					console.error('Failed to send cancellation email to patient:', emailError);
				}
			}

			if (patient?.phone && isValidPhoneNumber(patient.phone)) {
				try {
					await sendSMSNotification({
						to: patient.phone,
						template: 'appointment-cancelled',
						data: {
							patientName: appointment.patient || patient.name,
							patientPhone: patient.phone,
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
						subject: `Appointment Cancelled - ${appointment.patient} on ${appointment.date}`,
						template: 'appointment-status-changed',
						data: {
							patientName: appointment.patient || patient?.name,
							patientEmail: staffMember.userEmail,
							patientId: appointment.patientId,
							doctor: appointment.doctor,
							date: appointment.date,
							time: appointment.time,
							appointmentId: appointment.appointmentId,
							status: 'Cancelled',
							reason: reason || undefined,
						},
					});
				} catch (emailError) {
					console.error('Failed to send cancellation email to staff:', emailError);
				}
			}
		} catch (error) {
			console.error('Failed to cancel appointment', error);
			throw error;
		}
	};

	return (
		<div className="px-6 py-6">
			<div className="mx-auto max-w-6xl space-y-10">
				{/* PageHeader removed - shown in parent CalendarAppointments component */}
				<div className="mb-6">
					<h2 className="text-2xl font-bold text-slate-900">Appointments</h2>
					<p className="mt-1 text-sm text-slate-600">Monitor upcoming visits and assign clinical team members to each patient.</p>
				</div>

				<div className="border-t border-slate-200" />

				<section className="rounded-2xl bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.07)]">
					<header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<h2 className="text-lg font-semibold text-slate-900">Appointment queue</h2>
							<p className="text-sm text-slate-500">
								{groupedByPatient.length} patient{groupedByPatient.length === 1 ? '' : 's'} with {totalAppointmentsCount} appointment{totalAppointmentsCount === 1 ? '' : 's'}
							</p>
						</div>
					</header>

					<div className="overflow-x-auto">
						<table className="min-w-full divide-y divide-slate-200 text-left text-sm text-slate-700">
							<thead className="bg-sky-50 text-xs uppercase tracking-wide text-sky-700">
								<tr>
									<th className="px-4 py-3 font-semibold">Patient</th>
									<th className="px-4 py-3 font-semibold">Appointments</th>
									<th className="px-4 py-3 font-semibold">Next Appointment</th>
									<th className="px-4 py-3 font-semibold">Status Summary</th>
									<th className="px-4 py-3 font-semibold text-right">Actions</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100">
								{appointments.length === 0 ? (
									<tr>
										<td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
											No appointments found.
										</td>
									</tr>
								) : (
									groupedByPatient.map(group => {
										const patient = group.patientId ? patientLookup.get(group.patientId) : undefined;
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
													{patient?.phone && (
														<p className="text-xs text-slate-500">
															Phone: {patient.phone}
														</p>
													)}
													{patient?.email && (
														<p className="text-xs text-slate-500">
															Email: {patient.email}
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
															<span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${statusChipClasses.pending}`}>
																{statusCounts.pending} Pending
															</span>
														)}
														{statusCounts.ongoing > 0 && (
															<span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${statusChipClasses.ongoing}`}>
																{statusCounts.ongoing} Ongoing
															</span>
														)}
														{statusCounts.completed > 0 && (
															<span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${statusChipClasses.completed}`}>
																{statusCounts.completed} Completed
															</span>
														)}
														{statusCounts.cancelled > 0 && (
															<span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${statusChipClasses.cancelled}`}>
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
														className="inline-flex items-center rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-500 focus-visible:bg-sky-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
													>
														<i className="fas fa-eye mr-2 text-xs" aria-hidden="true" />
														View All
													</button>
												</td>
											</tr>
										);
									})
								)}
							</tbody>
						</table>
					</div>
				</section>

			{isDialogOpen && editingId !== null && (
				<div
					role="dialog"
					aria-modal="true"
					className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6"
				>
					<div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
						<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
							<h2 className="text-lg font-semibold text-slate-900">Edit Appointment</h2>
							<button
								type="button"
								onClick={closeDialog}
								className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:bg-slate-100 focus-visible:text-slate-600 focus-visible:outline-none"
								aria-label="Close dialog"
							>
								<i className="fas fa-times" aria-hidden="true" />
							</button>
						</header>
						<form onSubmit={handleSave} className="space-y-5 px-6 py-6">
							<div>
								<label className="block text-sm font-medium text-slate-700">Patient</label>
								<div className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
									{(() => {
										const appointment = appointments.find(a => a.id === editingId);
										if (!appointment) return 'N/A';
										const patient = appointment.patientId ? patientLookup.get(appointment.patientId) : undefined;
										return appointment.patient || (patient ? patient.name : undefined) || appointment.patientId || 'N/A';
									})()}
								</div>
							</div>

							<div className="grid grid-cols-2 gap-4">
								<div>
									<label className="block text-sm font-medium text-slate-700">
										Date <span className="text-rose-500">*</span>
									</label>
									<input
										type="date"
										value={formData.date}
										onChange={event => setFormData(prev => ({ ...prev, date: event.target.value }))}
										className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
										required
									/>
								</div>
								<div>
									<label className="block text-sm font-medium text-slate-700">
										Time <span className="text-rose-500">*</span>
									</label>
									<input
										type="time"
										value={formData.time}
										onChange={event => setFormData(prev => ({ ...prev, time: event.target.value }))}
										className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
										required
									/>
								</div>
							</div>

							<div className="grid grid-cols-2 gap-4">
								<div>
									<label className="block text-sm font-medium text-slate-700">
										Clinician
									</label>
									<select
										value={formData.doctor}
										onChange={event => setFormData(prev => ({ ...prev, doctor: event.target.value }))}
										className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
									>
										<option value="">— Unassigned —</option>
										{doctorOptions.length === 0 ? (
											<option value="" disabled>
												No clinical team members available
											</option>
										) : (
											doctorOptions.map(option => (
												<option key={option} value={option}>
													{option}
												</option>
											))
										)}
									</select>
								</div>
								<div>
									<label className="block text-sm font-medium text-slate-700">
										Status <span className="text-rose-500">*</span>
									</label>
									<select
										value={formData.status}
										onChange={event => setFormData(prev => ({ ...prev, status: event.target.value as AdminAppointmentStatus }))}
										className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
										required
									>
										<option value="pending">Pending</option>
										<option value="ongoing">Ongoing</option>
										<option value="completed">Completed</option>
										<option value="cancelled">Cancelled</option>
									</select>
								</div>
							</div>

							<div>
								<label className="block text-sm font-medium text-slate-700">Notes</label>
								<textarea
									value={formData.notes}
									onChange={event => setFormData(prev => ({ ...prev, notes: event.target.value }))}
									rows={4}
									className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
									placeholder="Add appointment notes or special instructions..."
								/>
							</div>

							<footer className="flex items-center justify-end gap-3 pt-2">
								<button
									type="button"
									onClick={closeDialog}
									className="inline-flex items-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800 focus-visible:border-slate-300 focus-visible:text-slate-800 focus-visible:outline-none"
								>
									Cancel
								</button>
								<button
									type="submit"
									className="inline-flex items-center rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-500 focus-visible:bg-sky-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
								>
									<i className="fas fa-save mr-2 text-xs" aria-hidden="true" />
									Save Changes
								</button>
							</footer>
						</form>
					</div>
				</div>
			)}

			<RescheduleDialog
				isOpen={rescheduleDialog.isOpen}
				appointment={rescheduleDialog.appointment}
				onClose={() => setRescheduleDialog({ isOpen: false, appointment: null })}
				onConfirm={handleReschedule}
				allAppointments={appointments}
			/>

			<CancelDialog
				isOpen={cancelDialog.isOpen}
				appointment={cancelDialog.appointment}
				onClose={() => setCancelDialog({ isOpen: false, appointment: null })}
				onConfirm={handleCancel}
			/>

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
											onChange={event => setBookingForm(prev => ({ ...prev, date: event.target.value }))}
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
											onChange={event => setBookingForm(prev => ({ ...prev, time: event.target.value }))}
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
												<th className="px-4 py-3 font-semibold">#</th>
												<th className="px-4 py-3 font-semibold">Clinician</th>
												<th className="px-4 py-3 font-semibold">Date</th>
												<th className="px-4 py-3 font-semibold">Time</th>
												<th className="px-4 py-3 font-semibold">Status</th>
												<th className="px-4 py-3 font-semibold text-right">Actions</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-slate-100">
											{selectedPatientAppointments.map((appointment, index) => {
												const patient = appointment.patientId ? patientLookup.get(appointment.patientId) : undefined;
												return (
													<tr key={appointment.id}>
														<td className="px-4 py-4 text-sm text-slate-500">{index + 1}</td>
														<td className="px-4 py-4 text-slate-600">
															{appointment.doctor ? (
																<span className="inline-flex items-center rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">
																	<i className="fas fa-user-md mr-1 text-[11px]" aria-hidden="true" />
																	{appointment.doctor}
																</span>
															) : (
																<span className="text-sm text-slate-400">Unassigned</span>
															)}
														</td>
														<td className="px-4 py-4 text-slate-600">{formatDateLabel(appointment.date)}</td>
														<td className="px-4 py-4 text-slate-600">{appointment.time || '—'}</td>
														<td className="px-4 py-4">
															<span
																className={[
																	'inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold',
																	statusChipClasses[appointment.status],
																].join(' ')}
															>
																{statusLabels[appointment.status]}
															</span>
														</td>
														<td className="px-4 py-4 text-right text-sm">
															<div className="flex items-center justify-end gap-2">
																{appointment.status !== 'cancelled' && (
																	<>
																		<button
																			type="button"
																			onClick={() => setRescheduleDialog({ isOpen: true, appointment })}
																			className="inline-flex items-center rounded-full border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-700 transition hover:border-amber-400 hover:text-amber-800 focus-visible:border-amber-400 focus-visible:text-amber-800 focus-visible:outline-none"
																			title="Reschedule appointment"
																		>
																			<i className="fas fa-calendar-alt mr-1 text-[11px]" aria-hidden="true" />
																			Reschedule
																		</button>
																		<button
																			type="button"
																			onClick={() => setCancelDialog({ isOpen: true, appointment })}
																			className="inline-flex items-center rounded-full border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-700 transition hover:border-rose-400 hover:text-rose-800 focus-visible:border-rose-400 focus-visible:text-rose-800 focus-visible:outline-none"
																			title="Cancel appointment"
																		>
																			<i className="fas fa-times-circle mr-1 text-[11px]" aria-hidden="true" />
																			Cancel
																		</button>
																	</>
																)}
																<button
																	type="button"
																	onClick={() => {
																		setShowPatientAppointmentsModal(false);
																		openDialog(appointment.id);
																	}}
																	className="inline-flex items-center rounded-full border border-sky-200 px-3 py-1 text-xs font-semibold text-sky-700 transition hover:border-sky-400 hover:text-sky-800 focus-visible:border-sky-400 focus-visible:text-sky-800 focus-visible:outline-none"
																>
																	<i className="fas fa-pen mr-1 text-[11px]" aria-hidden="true" />
																	Edit
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
								className="inline-flex items-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800 focus-visible:border-slate-300 focus-visible:text-slate-800 focus-visible:outline-none"
							>
								Close
							</button>
						</footer>
					</div>
				</div>
			)}
			</div>
		</div>
	);
}


