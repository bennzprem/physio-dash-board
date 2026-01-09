import { doc, runTransaction, serverTimestamp, getDoc } from 'firebase/firestore';
import { db } from './firebase';

const DYES_FREE_SESSIONS_CAP = 500;

interface DYESSessionCounter {
	year: number;
	totalSessions: number;
	lastUpdated: any; // Firestore Timestamp
}

/**
 * Gets the current calendar year
 */
function getCurrentYear(): number {
	return new Date().getFullYear();
}

/**
 * Increments the DYES session counter and returns the new total
 */
export async function incrementDYESSessionCounter(): Promise<{
	newTotal: number;
	isWithinFreeCap: boolean;
	sessionNumber: number;
}> {
	const year = getCurrentYear();
	const counterRef = doc(db, 'dyesSessionCounter', year.toString());

	return runTransaction(db, async transaction => {
		const counterSnap = await transaction.get(counterRef);

		let currentTotal = 0;
		if (counterSnap.exists()) {
			const data = counterSnap.data() as DYESSessionCounter;
			currentTotal = data.totalSessions || 0;
		}

		const newTotal = currentTotal + 1;
		const isWithinFreeCap = newTotal <= DYES_FREE_SESSIONS_CAP;

		transaction.set(
			counterRef,
			{
				year,
				totalSessions: newTotal,
				lastUpdated: serverTimestamp(),
			},
			{ merge: true }
		);

		return {
			newTotal,
			isWithinFreeCap,
			sessionNumber: newTotal,
		};
	});
}

/**
 * Gets the current DYES session count for the year
 */
export async function getCurrentDYESSessionCount(): Promise<number> {
	const year = getCurrentYear();
	const counterRef = doc(db, 'dyesSessionCounter', year.toString());

	try {
		const counterSnap = await getDoc(counterRef);
		if (counterSnap.exists()) {
			const data = counterSnap.data() as DYESSessionCounter;
			return data.totalSessions || 0;
		}
		return 0;
	} catch (error) {
		console.error('Failed to get DYES session count:', error);
		return 0;
	}
}

