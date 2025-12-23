/**
 * Utility functions for creating role-based notifications
 */

import { collection, query, where, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export type UserRole = 'Admin' | 'FrontDesk' | 'ClinicalTeam';

interface StaffMember {
	id: string;
	userEmail: string;
	userName: string;
	role: string;
}

/**
 * Get all user IDs for a specific role (excluding the current user)
 */
export async function getUserIdsByRole(
	roles: UserRole[],
	excludeUserId?: string
): Promise<string[]> {
	try {
		// Get all staff members with the specified roles
		const staffQuery = query(
			collection(db, 'staff'),
			where('status', '==', 'Active')
		);
		
		const staffSnapshot = await getDocs(staffQuery);
		const staffMembers: StaffMember[] = staffSnapshot.docs
			.map(doc => ({
				id: doc.id,
				userEmail: doc.data().userEmail || '',
				userName: doc.data().userName || '',
				role: doc.data().role || '',
			}))
			.filter(staff => roles.includes(staff.role as UserRole));

		// Map staff emails to user IDs from users collection
		const userIds: string[] = [];
		const userEmailToIdMap = new Map<string, string>();

		// Get all users to map emails to IDs
		const usersSnapshot = await getDocs(collection(db, 'users'));
		usersSnapshot.docs.forEach(userDoc => {
			const userData = userDoc.data();
			if (userData.email) {
				userEmailToIdMap.set(userData.email.toLowerCase(), userDoc.id);
			}
		});

		// Get user IDs for staff members
		for (const staff of staffMembers) {
			const userId = userEmailToIdMap.get(staff.userEmail.toLowerCase());
			if (userId && userId !== excludeUserId) {
				userIds.push(userId);
			}
		}

		return [...new Set(userIds)]; // Remove duplicates
	} catch (error) {
		console.error('Failed to get user IDs by role:', error);
		return [];
	}
}

/**
 * Send in-app notification to users by role
 */
export async function sendNotificationToRoles(
	roles: UserRole[],
	title: string,
	message: string,
	category: string = 'activity',
	metadata?: Record<string, any>,
	excludeUserId?: string
): Promise<void> {
	try {
		const userIds = await getUserIdsByRole(roles, excludeUserId);
		
		const notificationPromises = userIds.map(userId =>
			addDoc(collection(db, 'notifications'), {
				userId,
				title,
				message,
				category,
				status: 'unread',
				createdAt: serverTimestamp(),
				channels: {
					inApp: true,
				},
				metadata: metadata || {},
			})
		);

		await Promise.allSettled(notificationPromises);
	} catch (error) {
		console.error('Failed to send notifications to roles:', error);
	}
}

/**
 * Send notification to all admins (excluding the current user)
 */
export async function notifyAdmins(
	title: string,
	message: string,
	category: string = 'admin_activity',
	metadata?: Record<string, any>,
	excludeUserId?: string
): Promise<void> {
	await sendNotificationToRoles(['Admin'], title, message, category, metadata, excludeUserId);
}

/**
 * Send notification to all frontdesk users
 */
export async function notifyFrontdesk(
	title: string,
	message: string,
	category: string = 'frontdesk_activity',
	metadata?: Record<string, any>,
	excludeUserId?: string
): Promise<void> {
	await sendNotificationToRoles(['FrontDesk'], title, message, category, metadata, excludeUserId);
}

/**
 * Send notification to all clinicians
 */
export async function notifyClinicians(
	title: string,
	message: string,
	category: string = 'clinical_activity',
	metadata?: Record<string, any>,
	excludeUserId?: string
): Promise<void> {
	await sendNotificationToRoles(['ClinicalTeam'], title, message, category, metadata, excludeUserId);
}

/**
 * Send notification to admins, frontdesk, and clinicians (all roles)
 * Use this for Front Desk and Clinician actions
 */
export async function notifyAllRoles(
	title: string,
	message: string,
	category: string = 'activity',
	metadata?: Record<string, any>,
	excludeUserId?: string
): Promise<void> {
	await sendNotificationToRoles(['Admin', 'FrontDesk', 'ClinicalTeam'], title, message, category, metadata, excludeUserId);
}





