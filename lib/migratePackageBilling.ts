/**
 * Migration script to consolidate individual session billing records into package billing records
 * 
 * This script:
 * 1. Finds all patients with packages (packageAmount > 0 or totalSessionsRequired > 0)
 * 2. For each patient, finds all individual session billing records (those with appointmentId but no packageAmount)
 * 3. Consolidates them into a single package billing record
 * 4. Deletes the individual session billing records
 * 
 * Run this script once to fix existing data.
 */

import { collection, query, where, getDocs, doc, updateDoc, deleteDoc, addDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from './firebase';

interface BillingRecord {
	id: string;
	patientId: string;
	appointmentId?: string;
	packageAmount?: number;
	amount: number;
	status: string;
	date: string;
	patient: string;
	doctor?: string;
	concessionPercent?: number;
	packageSessions?: number;
}

interface PatientRecord {
	id: string;
	patientId: string;
	packageAmount?: number;
	totalSessionsRequired?: number;
	name: string;
	concessionPercent?: number;
}

export async function migratePackageBilling(): Promise<{
	success: boolean;
	patientsProcessed: number;
	billingRecordsConsolidated: number;
	billingRecordsDeleted: number;
	errors: string[];
}> {
	const results = {
		success: true,
		patientsProcessed: 0,
		billingRecordsConsolidated: 0,
		billingRecordsDeleted: 0,
		errors: [] as string[],
	};

	try {
		console.log('Starting package billing migration...');

		// Step 1: Get all patients with packages
		const patientsQuery = query(
			collection(db, 'patients'),
			where('packageAmount', '>', 0)
		);
		
		const patientsSnapshot = await getDocs(patientsQuery);
		const patientsWithPackages: PatientRecord[] = [];

		// Also check for patients with totalSessionsRequired but no packageAmount
		const allPatientsQuery = query(collection(db, 'patients'));
		const allPatientsSnapshot = await getDocs(allPatientsQuery);
		
		allPatientsSnapshot.docs.forEach(docSnap => {
			const data = docSnap.data();
			const hasPackage = (typeof data.packageAmount === 'number' && data.packageAmount > 0) ||
				(typeof data.totalSessionsRequired === 'number' && data.totalSessionsRequired > 0);
			
			if (hasPackage) {
				patientsWithPackages.push({
					id: docSnap.id,
					patientId: data.patientId || '',
					packageAmount: data.packageAmount,
					totalSessionsRequired: data.totalSessionsRequired,
					name: data.name || '',
					concessionPercent: data.concessionPercent,
				});
			}
		});

		console.log(`Found ${patientsWithPackages.length} patients with packages`);

		// Step 2: For each patient, find and consolidate individual session billing records
		for (const patient of patientsWithPackages) {
			try {
				// Find all billing records for this patient that are individual sessions (have appointmentId but no packageAmount)
				const individualBillingQuery = query(
					collection(db, 'billing'),
					where('patientId', '==', patient.patientId),
					where('appointmentId', '!=', null)
				);
				
				const billingSnapshot = await getDocs(individualBillingQuery);
				const individualBills: BillingRecord[] = billingSnapshot.docs
					.map(docSnap => ({
						id: docSnap.id,
						...docSnap.data(),
					} as BillingRecord))
					.filter(bill => !bill.packageAmount || bill.packageAmount === 0); // Only individual session bills

				if (individualBills.length === 0) {
					continue; // No individual bills to consolidate
				}

				console.log(`Patient ${patient.name} (${patient.patientId}): Found ${individualBills.length} individual billing records`);

				// Check if a package billing record already exists
				const packageBillingQuery = query(
					collection(db, 'billing'),
					where('patientId', '==', patient.patientId),
					where('packageAmount', '>', 0)
				);
				const packageBillingSnapshot = await getDocs(packageBillingQuery);

				let packageBillingId: string;
				let packageBillingExists = false;

				if (!packageBillingSnapshot.empty) {
					// Package billing record exists, use it
					packageBillingId = packageBillingSnapshot.docs[0].id;
					packageBillingExists = true;
					console.log(`Package billing record already exists for patient ${patient.name}`);
				} else {
					// Create a new package billing record
					const billingId = `PKG-${patient.patientId}-${Date.now()}`;
					const payableAmount = patient.packageAmount && patient.concessionPercent
						? Number((patient.packageAmount * (1 - patient.concessionPercent / 100)).toFixed(2))
						: (patient.packageAmount || 0);

					const packageBillingRef = await addDoc(collection(db, 'billing'), {
						billingId,
						patient: patient.name,
						patientId: patient.patientId,
						amount: payableAmount,
						packageAmount: patient.packageAmount || 0,
						concessionPercent: patient.concessionPercent || null,
						amountPaid: 0,
						date: new Date().toISOString().split('T')[0],
						status: 'Pending',
						paymentMode: null,
						utr: null,
						packageSessions: patient.totalSessionsRequired || null,
						createdAt: serverTimestamp(),
						updatedAt: serverTimestamp(),
					});
					packageBillingId = packageBillingRef.id;
					results.billingRecordsConsolidated++;
					console.log(`Created package billing record for patient ${patient.name}`);
				}

				// Delete individual session billing records in batches
				const batch = writeBatch(db);
				let batchCount = 0;
				const maxBatchSize = 500; // Firestore batch limit

				for (const bill of individualBills) {
					if (bill.id) {
						batch.delete(doc(db, 'billing', bill.id));
						batchCount++;
						results.billingRecordsDeleted++;

						// Commit batch if it reaches the limit
						if (batchCount >= maxBatchSize) {
							await batch.commit();
							batchCount = 0;
						}
					}
				}

				// Commit remaining deletes
				if (batchCount > 0) {
					await batch.commit();
				}

				results.patientsProcessed++;
				console.log(`Completed migration for patient ${patient.name}: Deleted ${individualBills.length} individual billing records`);

			} catch (error) {
				const errorMsg = `Error processing patient ${patient.name} (${patient.patientId}): ${error instanceof Error ? error.message : 'Unknown error'}`;
				console.error(errorMsg);
				results.errors.push(errorMsg);
			}
		}

		console.log('Migration completed:', results);
		return results;

	} catch (error) {
		const errorMsg = `Migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
		console.error(errorMsg);
		results.success = false;
		results.errors.push(errorMsg);
		return results;
	}
}

