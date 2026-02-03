import { NextRequest, NextResponse } from 'next/server';
import { collection, query, where, getDocs, updateDoc, doc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { sendEmailNotification } from '@/lib/email';
import { sendSMSNotification, isValidPhoneNumber } from '@/lib/sms';
import { sendWhatsAppNotification } from '@/lib/whatsapp';
import type { AdminAppointmentRecord } from '@/lib/adminMockData';

type AppointmentWithReminderMeta = AdminAppointmentRecord & {
	id: string;
	reminderSent?: Timestamp | Date | string | null;
};

/**
 * API endpoint to send appointment reminders
 * Should be called daily (e.g., via cron job) to send reminders for appointments tomorrow
 * 
 * Usage:
 * - GET /api/reminders - Send reminders for appointments scheduled tomorrow
 * - Optional query param: ?date=YYYY-MM-DD to check a specific date
 */
export async function GET(request: NextRequest) {
	try {
		// Get date to check (default: tomorrow)
		const searchParams = request.nextUrl.searchParams;
		const targetDateParam = searchParams.get('date');
		
		let targetDate: Date;
		if (targetDateParam) {
			targetDate = new Date(targetDateParam);
			if (isNaN(targetDate.getTime())) {
				return NextResponse.json(
					{ error: 'Invalid date format. Use YYYY-MM-DD' },
					{ status: 400 }
				);
			}
		} else {
			// Default to tomorrow
			targetDate = new Date();
			targetDate.setDate(targetDate.getDate() + 1);
		}

		// Format date as YYYY-MM-DD for comparison
		const targetDateStr = targetDate.toISOString().split('T')[0];

		// Query appointments for the target date
		const appointmentsRef = collection(db, 'appointments');
		const q = query(
			appointmentsRef,
			where('date', '==', targetDateStr),
			where('status', 'in', ['pending', 'confirmed', 'ongoing'])
		);

		const appointmentsSnapshot = await getDocs(q);
		const appointments = appointmentsSnapshot.docs.map(docSnap => ({
			id: docSnap.id,
			...(docSnap.data() as AdminAppointmentRecord),
		})) as AppointmentWithReminderMeta[];

		if (appointments.length === 0) {
			return NextResponse.json({
				success: true,
				message: `No appointments found for ${targetDateStr}`,
				remindersSent: 0,
			});
		}

		// Get all patient IDs
		const patientIds = [...new Set(appointments.map(apt => apt.patientId).filter(Boolean))];
		
		// Fetch all patients at once (more efficient)
		const patientsMap = new Map();
		if (patientIds.length > 0) {
			try {
				const patientsRef = collection(db, 'patients');
				// Firestore 'in' query supports up to 10 items, so we may need to batch
				const batches = [];
				for (let i = 0; i < patientIds.length; i += 10) {
					const batch = patientIds.slice(i, i + 10);
					batches.push(batch);
				}

				for (const batch of batches) {
					const patientQuery = query(patientsRef, where('patientId', 'in', batch));
					const patientSnapshot = await getDocs(patientQuery);
					
					patientSnapshot.docs.forEach(docSnap => {
						const patientData = docSnap.data();
						patientsMap.set(patientData.patientId, patientData);
					});
				}
			} catch (error) {
				console.error('Failed to fetch patients:', error);
				// Fallback: fetch individually if 'in' query fails
				for (const patientId of patientIds) {
					try {
						const patientsRef = collection(db, 'patients');
						const patientQuery = query(patientsRef, where('patientId', '==', patientId));
						const patientSnapshot = await getDocs(patientQuery);
						
						if (!patientSnapshot.empty) {
							const patientData = patientSnapshot.docs[0].data();
							patientsMap.set(patientId, patientData);
						}
					} catch (individualError) {
						console.error(`Failed to fetch patient ${patientId}:`, individualError);
					}
				}
			}
		}

		// Send reminders
		const results = {
			success: 0,
			failed: 0,
			skipped: 0,
			details: [] as Array<{ appointmentId: string; patient: string; status: string; reason?: string }>,
		};

		for (const appointment of appointments) {
			const patient = patientsMap.get(appointment.patientId);
			
			// Skip if no patient found or no email
			if (!patient) {
				results.skipped++;
				results.details.push({
					appointmentId: appointment.appointmentId || appointment.id,
					patient: appointment.patient || 'Unknown',
					status: 'skipped',
					reason: 'Patient not found',
				});
				continue;
			}

			if (!patient.email) {
				results.skipped++;
				results.details.push({
					appointmentId: appointment.appointmentId || appointment.id,
					patient: appointment.patient || patient.name || 'Unknown',
					status: 'skipped',
					reason: 'No email address',
				});
				continue;
			}

			// Check if reminder already sent today
			const existingReminderSent = appointment.reminderSent;
			if (existingReminderSent) {
				let reminderDate: Date;
				if (existingReminderSent instanceof Timestamp) {
					reminderDate = existingReminderSent.toDate();
				} else if (
					typeof (existingReminderSent as unknown as { toDate?: () => Date }).toDate === 'function'
				) {
					reminderDate = (existingReminderSent as unknown as { toDate: () => Date }).toDate();
				} else if (existingReminderSent instanceof Date) {
					reminderDate = existingReminderSent;
				} else {
					reminderDate = new Date(existingReminderSent);
				}

				const today = new Date();
				if (
					reminderDate.getDate() === today.getDate() &&
					reminderDate.getMonth() === today.getMonth() &&
					reminderDate.getFullYear() === today.getFullYear()
				) {
					results.skipped++;
					results.details.push({
						appointmentId: appointment.appointmentId || appointment.id,
						patient: appointment.patient || patient.name || 'Unknown',
						status: 'skipped',
						reason: 'Reminder already sent today',
					});
					continue;
				}
			}

			// Send reminder email, SMS, and WhatsApp
			let emailSent = false;
			let smsSent = false;
			let whatsappSent = false;
			let reminderSent = false;

			// Send email reminder
			if (patient.email) {
				try {
					const emailResult = await sendEmailNotification({
						to: patient.email,
						subject: `Appointment Reminder - Tomorrow at ${appointment.time}`,
						template: 'appointment-reminder',
						data: {
							patientName: appointment.patient || patient.name || 'Patient',
							patientEmail: patient.email,
							patientId: appointment.patientId,
							doctor: appointment.doctor || 'Your clinician',
							date: appointment.date,
							time: appointment.time,
							appointmentId: appointment.appointmentId,
							notes: appointment.notes,
						},
					});
					emailSent = emailResult.success;
				} catch (error) {
					console.error('Failed to send reminder email:', error);
				}
			}

			// Send SMS reminder
			if (patient.phone && isValidPhoneNumber(patient.phone)) {
				try {
					const smsResult = await sendSMSNotification({
						to: patient.phone,
						template: 'appointment-reminder',
						data: {
							patientName: appointment.patient || patient.name || 'Patient',
							patientPhone: patient.phone,
							patientId: appointment.patientId,
							doctor: appointment.doctor || 'Your clinician',
							date: appointment.date,
							time: appointment.time,
							appointmentId: appointment.appointmentId,
						},
					});
					smsSent = smsResult.success;
				} catch (error) {
					console.error('Failed to send reminder SMS:', error);
				}
			}

			// Send WhatsApp reminder
			if (patient.phone && isValidPhoneNumber(patient.phone)) {
				try {
					const whatsappResult = await sendWhatsAppNotification({
						to: patient.phone,
						template: 'appointment-reminder',
						data: {
							patientName: appointment.patient || patient.name || 'Patient',
							patientPhone: patient.phone,
							patientId: appointment.patientId,
							doctor: appointment.doctor || 'Your clinician',
							date: appointment.date,
							time: appointment.time,
							appointmentId: appointment.appointmentId,
						},
					});
					whatsappSent = whatsappResult.success;
				} catch (error) {
					console.error('Failed to send reminder WhatsApp:', error);
				}
			}

			// Mark reminder as sent if at least one notification was sent
			if (emailSent || smsSent || whatsappSent) {
				reminderSent = true;
				try {
					const appointmentRef = doc(db, 'appointments', appointment.id);
					await updateDoc(appointmentRef, {
						reminderSent: Timestamp.now(),
					});
				} catch (updateError) {
					console.error('Failed to update reminderSent field:', updateError);
				}
			}

			// Record results
			if (reminderSent) {
				const methods = [];
				if (emailSent) methods.push('email');
				if (smsSent) methods.push('SMS');
				if (whatsappSent) methods.push('WhatsApp');
				
				results.success++;
				results.details.push({
					appointmentId: appointment.appointmentId || appointment.id,
					patient: appointment.patient || patient.name || 'Unknown',
					status: 'sent',
					reason: `Sent via ${methods.join(', ')}`,
				});
			} else {
				results.failed++;
				results.details.push({
					appointmentId: appointment.appointmentId || appointment.id,
					patient: appointment.patient || patient.name || 'Unknown',
					status: 'failed',
					reason: 'All notification methods failed or not available',
				});
			}
		}

		return NextResponse.json({
			success: true,
			date: targetDateStr,
			totalAppointments: appointments.length,
			remindersSent: results.success,
			remindersFailed: results.failed,
			remindersSkipped: results.skipped,
			details: results.details,
		});
	} catch (error) {
		console.error('Reminder API error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Internal server error',
			},
			{ status: 500 }
		);
	}
}

/**
 * POST endpoint to manually trigger reminders (useful for testing)
 */
export async function POST(request: NextRequest) {
	try {
		const body = await request.json().catch(() => ({}));
		const targetDate = body.date;

		// Create a new request with the date as query param
		const url = new URL(request.url);
		if (targetDate) {
			url.searchParams.set('date', targetDate);
		}

		const newRequest = new NextRequest(url, {
			method: 'GET',
			headers: request.headers,
		});

		return GET(newRequest);
	} catch (error) {
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Internal server error',
			},
			{ status: 500 }
		);
	}
}

