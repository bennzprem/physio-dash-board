import { NextRequest, NextResponse } from 'next/server';
import { authAdmin, dbAdmin } from '@/lib/firebaseAdmin';
import { sendEmailNotification } from '@/lib/email';
import { randomBytes } from 'crypto';

export async function POST(request: NextRequest) {
	try {
		let body;
		try {
			body = await request.json();
		} catch (jsonError) {
			console.error('Invalid JSON in request:', jsonError);
			return NextResponse.json(
				{ error: 'Invalid request format' },
				{ status: 400 }
			);
		}

		const email = String(body?.email || '').trim().toLowerCase();

		if (!email) {
			return NextResponse.json(
				{ error: 'Email is required' },
				{ status: 400 }
			);
		}

		// Validate email format
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(email)) {
			return NextResponse.json(
				{ error: 'Invalid email address' },
				{ status: 400 }
			);
		}

		// First, check if email exists in staff collection (custom email or userEmail)
		let staffDoc = null;
		let userRecord = null;
		let authEmail = email; // Default to the email provided
		let customEmail = null;

		try {
			// Query staff collection for matching email (check both userEmail and custom email fields)
			const staffQuery = await dbAdmin.collection('staff')
				.where('userEmail', '==', email)
				.limit(1)
				.get();

			if (staffQuery.empty) {
				// Try checking custom email fields (personalEmail, customEmail, alternateEmail)
				const customEmailQuery = await dbAdmin.collection('staff')
					.where('personalEmail', '==', email)
					.limit(1)
					.get();
				
				if (!customEmailQuery.empty) {
					staffDoc = customEmailQuery.docs[0];
					customEmail = email;
					authEmail = staffDoc.data()?.userEmail || email;
				} else {
					// Try customEmail field
					const customEmailQuery2 = await dbAdmin.collection('staff')
						.where('customEmail', '==', email)
						.limit(1)
						.get();
					
					if (!customEmailQuery2.empty) {
						staffDoc = customEmailQuery2.docs[0];
						customEmail = email;
						authEmail = staffDoc.data()?.userEmail || email;
					}
				}
			} else {
				staffDoc = staffQuery.docs[0];
				// Check if staff has a custom email field
				const staffData = staffDoc.data();
				customEmail = staffData?.personalEmail || staffData?.customEmail || staffData?.alternateEmail || null;
			}
		} catch (error) {
			console.warn('Could not query staff collection:', error);
		}

		// Now find the Firebase Auth user by the auth email (userEmail from staff)
		try {
			userRecord = await authAdmin.getUserByEmail(authEmail);
		} catch (error: any) {
			// User doesn't exist in Firebase Auth - don't reveal this for security
			// Return success anyway to prevent email enumeration
			return NextResponse.json({
				success: true,
				message: 'If an account exists for that email, a reset link has been sent.'
			});
		}

		// Get user profile from Firestore for display name
		let userName = 'User';
		try {
			// First try staff collection
			if (staffDoc) {
				const staffData = staffDoc.data();
				userName = staffData?.userName || userName;
			} else {
				// Fallback to users collection
				const userDoc = await dbAdmin.collection('users').doc(userRecord.uid).get();
				if (userDoc.exists) {
					const userData = userDoc.data();
					userName = userData?.displayName || userData?.userName || 'User';
				}
			}
		} catch (error) {
			// Continue with default name if Firestore lookup fails
			console.warn('Could not fetch user profile:', error);
		}

		// Determine which email to send the reset link to
		// Priority: custom email > auth email
		const emailToSend = customEmail || authEmail;

		// Generate secure reset token
		const resetToken = randomBytes(32).toString('hex');
		const expiresAt = new Date();
		expiresAt.setHours(expiresAt.getHours() + 1); // Token expires in 1 hour

		// Store token in Firestore
		await dbAdmin.collection('passwordResets').doc(resetToken).set({
			uid: userRecord.uid,
			email: authEmail, // Store the auth email (for password reset)
			customEmail: customEmail, // Store custom email if used
			requestedEmail: email, // Store the email that was requested (for tracking)
			expiresAt: expiresAt,
			createdAt: new Date(),
			used: false,
		});

		// Generate reset link
		const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 
			(process.env.NODE_ENV === 'production' 
				? 'https://yourdomain.com' 
				: 'http://localhost:3000');
		const resetLink = `${baseUrl}/reset-password?token=${resetToken}`;

		// Send email via Resend to the custom email (if available) or auth email
		const emailResult = await sendEmailNotification({
			to: emailToSend,
			template: 'password-reset',
			subject: 'Reset Your Password - Centre For Sports Science',
			data: {
				userName,
				userEmail: emailToSend,
				resetLink,
			},
		});

		if (!emailResult.success) {
			console.error('Failed to send password reset email:', emailResult.error);
			// Still return success to prevent email enumeration
			return NextResponse.json({
				success: true,
				message: 'If an account exists for that email, a reset link has been sent.'
			});
		}

		return NextResponse.json({
			success: true,
			message: 'If an account exists for that email, a reset link has been sent.'
		});
	} catch (error) {
		console.error('Password reset request error:', error);
		// Return success to prevent email enumeration
		return NextResponse.json({
			success: true,
			message: 'If an account exists for that email, a reset link has been sent.'
		});
	}
}

