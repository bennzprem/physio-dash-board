import { collection, doc, addDoc, updateDoc, query, where, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { DYES_SESSION_RATE } from './sessionAllowance';

export interface CreateDYESBillingParams {
	appointmentId: string;
	appointmentDocId: string;
	patientId: string;
	patientName: string;
	doctorName: string;
	appointmentDate: string;
	createdByUserId?: string | null;
	createdByUserName?: string | null;
}

/**
 * Automatically creates a billing record for DYES patients when a session is completed.
 * Sets status to 'Completed' (Paid) and amount to Rs. 500, bypassing the 'Pending Payments' list.
 */
export async function createDYESBilling({
	appointmentId,
	appointmentDocId,
	patientId,
	patientName,
	doctorName,
	appointmentDate,
	createdByUserId,
	createdByUserName,
}: CreateDYESBillingParams): Promise<void> {
	try {
		// Check if billing record already exists for this appointment
		const existingQuery = query(collection(db, 'billing'), where('appointmentId', '==', appointmentId));
		const existingSnapshot = await getDocs(existingQuery);
		
		if (!existingSnapshot.empty) {
			// Billing record already exists, skip creation
			console.log(`Billing record already exists for appointment ${appointmentId}`);
			return;
		}

		const billingId = 'BILL-' + (appointmentId || Date.now().toString());
		const defaultBillingDate = appointmentDate || new Date().toISOString().split('T')[0];

		// Create billing record with status 'Completed' (Paid) and amount Rs. 500
		await addDoc(collection(db, 'billing'), {
			billingId,
			appointmentId,
			patient: patientName || '',
			patientId,
			doctor: doctorName || '',
			amount: DYES_SESSION_RATE, // Rs. 500 per session
			date: defaultBillingDate,
			status: 'Completed', // Mark as Paid immediately, bypassing Pending Payments
			paymentMode: 'Auto-Paid',
			utr: null,
			createdByFrontdesk: createdByUserId || null,
			createdByFrontdeskName: createdByUserName || null,
			createdAt: serverTimestamp(),
			updatedAt: serverTimestamp(),
		});

		// Also update appointment with billing info
		await updateDoc(doc(db, 'appointments', appointmentDocId), {
			billing: {
				amount: DYES_SESSION_RATE.toFixed(2),
				date: defaultBillingDate,
			},
		});

		console.log(`Automatically created billing record for DYES patient: ${patientName} (${patientId})`);
	} catch (error) {
		console.error('Failed to create automatic DYES billing:', error);
		throw error;
	}
}

