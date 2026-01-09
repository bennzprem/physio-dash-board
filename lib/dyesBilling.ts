import { collection, doc, addDoc, updateDoc, query, where, getDocs, serverTimestamp, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { DYES_SESSION_RATE } from './sessionAllowance';
import { incrementDYESSessionCounter } from './dyesSessionTracker';

export interface CreateDYESBillingParams {
	appointmentId: string;
	appointmentDocId: string;
	patientId: string;
	patientName: string;
	doctorName: string;
	appointmentDate: string;
	createdByUserId?: string | null;
	createdByUserName?: string | null;
	isExtraTreatment?: boolean; // NEW: Flag for extra treatments
}

/**
 * Automatically creates a billing record for DYES patients when a session is completed.
 * Logic:
 * - First 500 sessions per calendar year: Free (amount = 0, status = 'Completed')
 * - Session 501+: Auto-Paid (status = 'Auto-Paid', amount = standard rate)
 * - Extra treatments: Patient pays (status = 'Pending', amount = standard rate)
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
	isExtraTreatment = false,
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

		// Check if appointment already has isExtraTreatment flag (in case it was set earlier)
		const appointmentDoc = await getDoc(doc(db, 'appointments', appointmentDocId));
		const appointmentData = appointmentDoc.data();
		const finalIsExtraTreatment = isExtraTreatment || appointmentData?.isExtraTreatment || false;

		const billingId = 'BILL-' + (appointmentId || Date.now().toString());
		const defaultBillingDate = appointmentDate || new Date().toISOString().split('T')[0];

		// Handle extra treatments separately - patient pays
		if (finalIsExtraTreatment) {
			await addDoc(collection(db, 'billing'), {
				billingId,
				appointmentId,
				patient: patientName || '',
				patientId,
				doctor: doctorName || '', // CRITICAL: For revenue attribution
				amount: DYES_SESSION_RATE,
				date: defaultBillingDate,
				status: 'Pending', // Patient pays for extra treatments
				paymentMode: null,
				utr: null,
				isExtraTreatment: true, // Mark as extra treatment
				createdByFrontdesk: createdByUserId || null,
				createdByFrontdeskName: createdByUserName || null,
				createdAt: serverTimestamp(),
				updatedAt: serverTimestamp(),
			});

			// Update appointment with billing info
			await updateDoc(doc(db, 'appointments', appointmentDocId), {
				billing: {
					amount: DYES_SESSION_RATE.toFixed(2),
					date: defaultBillingDate,
					status: 'Pending',
				},
				isExtraTreatment: true,
			});

			console.log(`Created billing record for DYES extra treatment: ${patientName} (${patientId})`);
			return;
		}

		// Regular treatment: Check session count
		const { newTotal, isWithinFreeCap, sessionNumber } = await incrementDYESSessionCounter();

		let billingStatus: 'Completed' | 'Auto-Paid';
		let billingAmount: number;

		if (isWithinFreeCap) {
			// First 500 sessions: Free
			billingStatus = 'Completed';
			billingAmount = 0;
		} else {
			// Session 501+: Auto-Paid
			billingStatus = 'Auto-Paid';
			billingAmount = DYES_SESSION_RATE;
		}

		// Create billing record
		await addDoc(collection(db, 'billing'), {
			billingId,
			appointmentId,
			patient: patientName || '',
			patientId,
			doctor: doctorName || '', // CRITICAL: For revenue attribution
			amount: billingAmount,
			date: defaultBillingDate,
			status: billingStatus,
			paymentMode: billingStatus === 'Auto-Paid' ? 'Auto-Paid' : null,
			utr: null,
			isExtraTreatment: false,
			dyesSessionNumber: sessionNumber, // Track which session number this was
			createdByFrontdesk: createdByUserId || null,
			createdByFrontdeskName: createdByUserName || null,
			createdAt: serverTimestamp(),
			updatedAt: serverTimestamp(),
		});

		// Update appointment with billing info
		await updateDoc(doc(db, 'appointments', appointmentDocId), {
			billing: {
				amount: billingAmount.toFixed(2),
				date: defaultBillingDate,
				status: billingStatus,
			},
			dyesSessionNumber: sessionNumber,
			isExtraTreatment: false,
		});

		console.log(
			`Created DYES billing record: ${patientName} (${patientId}) - Session #${sessionNumber} - ` +
				`${isWithinFreeCap ? 'FREE' : 'AUTO-PAID'} - Amount: ₹${billingAmount}`
		);
	} catch (error) {
		console.error('Failed to create automatic DYES billing:', error);
		throw error;
	}
}

