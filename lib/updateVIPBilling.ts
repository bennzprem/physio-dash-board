import { collection, query, where, getDocs, updateDoc, doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

/**
 * Updates all existing VIP patient billing records to set amount to 0
 * This function should be run once to clean up historical data
 */
export async function updateVIPBillingAmounts(): Promise<{
	success: boolean;
	recordsUpdated: number;
	errors: string[];
}> {
	const results = {
		success: true,
		recordsUpdated: 0,
		errors: [] as string[],
	};

	try {
		// Get all VIP patients
		const patientsQuery = query(collection(db, 'patients'), where('patientType', '==', 'VIP'));
		const patientsSnapshot = await getDocs(patientsQuery);
		
		if (patientsSnapshot.empty) {
			console.log('No VIP patients found');
			return results;
		}

		const vipPatientIds = patientsSnapshot.docs.map(doc => doc.data().patientId as string).filter(Boolean);
		console.log(`Found ${vipPatientIds.length} VIP patients`);

		if (vipPatientIds.length === 0) {
			return results;
		}

		// Get all billing records for VIP patients
		const billingQuery = query(collection(db, 'billing'));
		const billingSnapshot = await getDocs(billingQuery);
		
		const vipBillingRecords = billingSnapshot.docs.filter(doc => {
			const data = doc.data();
			return vipPatientIds.includes(data.patientId as string) && data.amount && data.amount > 0;
		});

		console.log(`Found ${vipBillingRecords.length} VIP billing records with amounts > 0`);

		if (vipBillingRecords.length === 0) {
			return results;
		}

		// Update in batches (Firestore batch limit is 500)
		const batchSize = 500;
		for (let i = 0; i < vipBillingRecords.length; i += batchSize) {
			const batch = writeBatch(db);
			const batchRecords = vipBillingRecords.slice(i, i + batchSize);

			for (const billingDoc of batchRecords) {
				try {
					batch.update(doc(db, 'billing', billingDoc.id), {
						amount: 0,
						updatedAt: serverTimestamp(),
					});
				} catch (error) {
					const errorMsg = `Failed to update billing record ${billingDoc.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
					console.error(errorMsg);
					results.errors.push(errorMsg);
				}
			}

			try {
				await batch.commit();
				results.recordsUpdated += batchRecords.length;
				console.log(`Updated batch ${Math.floor(i / batchSize) + 1}: ${batchRecords.length} records`);
			} catch (error) {
				const errorMsg = `Failed to commit batch ${Math.floor(i / batchSize) + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`;
				console.error(errorMsg);
				results.errors.push(errorMsg);
				results.success = false;
			}
		}

		console.log(`Successfully updated ${results.recordsUpdated} VIP billing records`);
	} catch (error) {
		const errorMsg = `Failed to update VIP billing amounts: ${error instanceof Error ? error.message : 'Unknown error'}`;
		console.error(errorMsg);
		results.errors.push(errorMsg);
		results.success = false;
	}

	return results;
}

