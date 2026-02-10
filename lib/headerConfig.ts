import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { HeaderConfig, HeaderType } from '@/components/admin/HeaderManagement';

/**
 * Get header configuration from Firestore
 * Falls back to defaults if not configured
 */
export async function getHeaderConfig(type: HeaderType): Promise<HeaderConfig | null> {
	try {
		const docRef = doc(db, 'headerConfigs', type);
		const docSnap = await getDoc(docRef);

		if (docSnap.exists()) {
			return { id: docSnap.id, ...docSnap.data() } as HeaderConfig;
		}

		return null;
	} catch (error) {
		console.error(`Failed to load header config for ${type}:`, error);
		return null;
	}
}

/**
 * Get default header configuration based on type
 */
export function getDefaultHeaderConfig(type: HeaderType): Partial<HeaderConfig> {
	if (type === 'reportDYES') {
		return {
			mainTitle: 'CENTRE FOR SPORTS SCIENCE',
			subtitle: 'PHYSIOTHERAPY CONSULTATION REPORT',
			associationText: '(In association with Department of Youth Empowerment and Sports-Govt of Karnataka)',
			govermentOrder: 'GOVT ORDER: YU SE KRIE/VI/68/2016-17',
			contactInfo: '',
		};
	} else if (type === 'reportNonDYES') {
		return {
			mainTitle: 'CENTRE FOR SPORTS SCIENCE',
			subtitle: 'PHYSIOTHERAPY CONSULTATION REPORT',
			contactInfo: 'Phone No: +91 9731128396 | Address: Sree Kanteerava Stadium Gate 8 and 10, Sampangiram Nagar, Bengaluru 560027',
			associationText: '',
			govermentOrder: '',
		};
	} else if (type === 'billing') {
		return {
			mainTitle: 'CENTRE FOR SPORTS SCIENCE',
			subtitle: 'Sports Business Solutions Pvt. Ltd.',
			contactInfo: 'Sri Kanteerava Outdoor Stadium, Bangalore | Phone: +91 97311 28396',
			associationText: '',
			govermentOrder: '',
		};
	} else if (type === 'invoice') {
		return {
			mainTitle: 'CENTRE FOR SPORTS SCIENCE',
			subtitle: 'Sports Business Solutions Pvt. Ltd.',
			contactInfo: 'Sri Kanteerava Outdoor Stadium, Bangalore | Phone: +91 97311 28396',
			associationText: '',
			govermentOrder: '',
		};
	}

	return {};
}

