import { NextRequest, NextResponse } from 'next/server';
import { dbAdmin } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { requireRole } from '@/lib/authz';

interface StaffRecord {
	id: string;
	userName: string;
	userEmail: string;
	dateOfBirth?: string;
}

/**
 * API endpoint to send birthday notifications
 * 
 * Usage:
 * - GET /api/birthdays/notifications - Check for birthdays today and send notifications
 */
export async function GET(request: NextRequest) {
	// Allow Admin to trigger birthday notifications
	const gate = await requireRole(request, ['Admin']);
	if (!gate.ok) {
		return NextResponse.json({ error: gate.message }, { status: gate.status });
	}

	try {
		const today = new Date();
		const todayMonth = today.getMonth() + 1; // JavaScript months are 0-indexed
		const todayDay = today.getDate();
		const todayDateStr = `${today.getFullYear()}-${String(todayMonth).padStart(2, '0')}-${String(todayDay).padStart(2, '0')}`;

		// Get all staff members
		const staffSnapshot = await dbAdmin.collection('staff').get();
		
		const allStaff: StaffRecord[] = staffSnapshot.docs.map(doc => ({
			id: doc.id,
			userName: doc.data().userName || '',
			userEmail: doc.data().userEmail || '',
			dateOfBirth: doc.data().dateOfBirth || '',
		}));

		// Find staff members whose birthday is today
		const birthdayStaff: StaffRecord[] = allStaff.filter(staff => {
			if (!staff.dateOfBirth) return false;
			
			// Parse the date of birth (format: YYYY-MM-DD)
			const dob = new Date(staff.dateOfBirth);
			const dobMonth = dob.getMonth() + 1;
			const dobDay = dob.getDate();
			
			return dobMonth === todayMonth && dobDay === todayDay;
		});

		if (birthdayStaff.length === 0) {
			return NextResponse.json({
				success: true,
				message: 'No birthdays today',
				notificationsSent: 0,
			});
		}

		// Get all user IDs from the users collection
		const usersSnapshot = await dbAdmin.collection('users').get();
		const userEmailToIdMap = new Map<string, string>();
		
		usersSnapshot.docs.forEach(doc => {
			const data = doc.data();
			if (data.email) {
				userEmailToIdMap.set(data.email.toLowerCase(), doc.id);
			}
		});

		let notificationsSent = 0;

		// Create notifications for each birthday person and all other employees
		for (const birthdayPerson of birthdayStaff) {
			const birthdayUserId = userEmailToIdMap.get(birthdayPerson.userEmail.toLowerCase());
			
			if (!birthdayUserId) {
				console.warn(`User ID not found for ${birthdayPerson.userEmail}`);
				continue;
			}

			// Notification for the birthday person
			try {
				await dbAdmin.collection('notifications').add({
					userId: birthdayUserId,
					title: '🎉 Happy Birthday! 🎉',
					message: `Wishing you a wonderful birthday filled with joy and happiness! Have an amazing day! 🎂🎈🎁`,
					category: 'birthday',
					status: 'unread',
					createdAt: FieldValue.serverTimestamp(),
					channels: {
						inApp: true,
					},
					metadata: {
						birthdayPerson: birthdayPerson.userName,
						birthdayDate: todayDateStr,
					},
				});
				notificationsSent++;
			} catch (error) {
				console.error(`Failed to create birthday notification for ${birthdayPerson.userName}:`, error);
			}

			// Notifications for all other employees
			for (const otherStaff of allStaff) {
				if (otherStaff.userEmail === birthdayPerson.userEmail) {
					continue; // Skip the birthday person
				}

				const otherUserId = userEmailToIdMap.get(otherStaff.userEmail.toLowerCase());
				if (!otherUserId) {
					continue;
				}

				try {
					await dbAdmin.collection('notifications').add({
						userId: otherUserId,
						title: '🎂 Birthday Celebration! 🎂',
						message: `Today is ${birthdayPerson.userName}'s birthday! 🎉 Let's celebrate and wish them a wonderful day! 🎈🎁`,
						category: 'birthday',
						status: 'unread',
						createdAt: FieldValue.serverTimestamp(),
						channels: {
							inApp: true,
						},
						metadata: {
							birthdayPerson: birthdayPerson.userName,
							birthdayDate: todayDateStr,
						},
					});
					notificationsSent++;
				} catch (error) {
					console.error(`Failed to create birthday notification for ${otherStaff.userName}:`, error);
				}
			}
		}

		return NextResponse.json({
			success: true,
			message: `Birthday notifications sent for ${birthdayStaff.length} employee(s)`,
			birthdayCount: birthdayStaff.length,
			notificationsSent,
			birthdayStaff: birthdayStaff.map(s => s.userName),
		});
	} catch (error) {
		console.error('Failed to send birthday notifications:', error);
		return NextResponse.json(
			{
				success: false,
				message: 'Failed to send birthday notifications',
				error: error instanceof Error ? error.message : 'Unknown error',
			},
			{ status: 500 }
		);
	}
}

