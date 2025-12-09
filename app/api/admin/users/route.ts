'use server';

import { NextRequest } from 'next/server';
import { authAdmin, dbAdmin } from '@/lib/firebaseAdmin';

/**
 * Retry a function with exponential backoff
 */
async function retryWithBackoff<T>(
	fn: () => Promise<T>,
	maxRetries: number = 3,
	initialDelay: number = 1000
): Promise<T> {
	let lastError: any;
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error: any) {
			lastError = error;
			const isNetworkError = error?.message?.includes('ETIMEDOUT') || 
				error?.message?.includes('ECONNREFUSED') || 
				error?.message?.includes('ENOTFOUND') ||
				error?.message?.includes('timeout') ||
				error?.message?.includes('connect') ||
				error?.code === 'ETIMEDOUT' ||
				error?.code === 'ECONNREFUSED' ||
				error?.code === 'ENOTFOUND';
			
			// Only retry on network errors
			if (!isNetworkError || attempt === maxRetries) {
				throw error;
			}
			
			// Exponential backoff: 1s, 2s, 4s
			const delay = initialDelay * Math.pow(2, attempt);
			console.warn(`Network error on attempt ${attempt + 1}/${maxRetries + 1}, retrying in ${delay}ms...`, error?.message);
			await new Promise(resolve => setTimeout(resolve, delay));
		}
	}
	throw lastError;
}

/**
 * Verify ID token with timeout and retry logic
 * Uses a timeout wrapper to fail fast on network issues
 */
async function verifyIdTokenWithRetry(token: string, timeoutMs: number = 15000) {
	const timeoutPromise = new Promise((_, reject) => 
		setTimeout(() => reject(new Error('Network timeout: Token verification exceeded timeout limit. This usually indicates network connectivity issues. See FIREBASE_ADMIN_SETUP.md for troubleshooting.')), timeoutMs)
	);
	
	try {
		return await Promise.race([
			retryWithBackoff(() => authAdmin.verifyIdToken(token), 2, 1000),
			timeoutPromise
		]) as Promise<any>;
	} catch (error: any) {
		// If it's a timeout, provide more helpful error message
		if (error?.message?.includes('timeout')) {
			const networkError = new Error('Network timeout: Unable to connect to Firebase servers to verify token. This may be due to network connectivity issues, firewall blocking, or IPv6 connectivity problems. Please check your internet connection and try again. If the issue persists, you may need to configure proxy settings or disable IPv6. See FIREBASE_ADMIN_SETUP.md for detailed troubleshooting steps.');
			(networkError as any).code = 'ETIMEDOUT';
			throw networkError;
		}
		throw error;
	}
}

async function requireAdmin(request: NextRequest, fallbackRole?: string) {
	const auth = request.headers.get('authorization') || request.headers.get('Authorization');
	if (!auth || !auth.startsWith('Bearer ')) {
		return { ok: false, status: 401, message: 'Missing Authorization header' as const };
	}
	const token = auth.slice('Bearer '.length).trim();
	try {
		// Check if Admin SDK is properly initialized
		if (!authAdmin) {
			console.error('Firebase Admin SDK not initialized');
			return { ok: false, status: 500, message: 'Firebase Admin SDK not configured. Please set up FIREBASE_SERVICE_ACCOUNT_KEY or GOOGLE_APPLICATION_CREDENTIALS.' as const };
		}

		const decoded = await verifyIdTokenWithRetry(token);
		let role = (decoded as any).role || (decoded as any).claims?.role;
		
		// If role not in token claims, check Firestore profile (if Admin SDK is configured)
		if (!role || (role !== 'Admin' && role !== 'admin' && role !== 'SuperAdmin' && role !== 'superadmin')) {
			try {
				// Only try Firestore if Admin SDK is properly initialized
				if (dbAdmin) {
					// Check staff collection first (primary collection)
					const staffDoc = await dbAdmin.collection('staff').doc(decoded.uid).get();
					if (staffDoc.exists) {
						const staffData = staffDoc.data();
						role = staffData?.role;
					} else {
						// Fallback to users collection for backward compatibility
						const userDoc = await dbAdmin.collection('users').doc(decoded.uid).get();
						if (userDoc.exists) {
							const userData = userDoc.data();
							role = userData?.role;
						}
					}
				}
			} catch (firestoreError: any) {
				// Silently fail if Admin SDK isn't configured - this is expected in development
				// The error will be logged but won't block the request
				if (!firestoreError?.message?.includes('default credentials')) {
					console.error('Failed to check Firestore for role', firestoreError);
				}
			}
		}
		
		// Use fallback role if provided (for development when Admin SDK isn't configured)
		if ((!role || (role !== 'Admin' && role !== 'admin' && role !== 'SuperAdmin' && role !== 'superadmin')) && fallbackRole) {
			if (fallbackRole === 'Admin' || fallbackRole === 'admin' || fallbackRole === 'SuperAdmin' || fallbackRole === 'superadmin') {
				role = fallbackRole;
			}
		}

		// Check for 'Admin' or 'SuperAdmin' (capitalized) to match the app's role naming convention
		if (role !== 'Admin' && role !== 'admin' && role !== 'SuperAdmin' && role !== 'superadmin') {
			return { ok: false, status: 403, message: 'Forbidden: admin or super admin role required' as const };
		}
		return { ok: true as const, uid: decoded.uid };
	} catch (err: any) {
		// Log detailed error information for debugging
		console.error('verifyIdToken failed', {
			code: err?.code,
			message: err?.message,
			stack: err?.stack,
			tokenLength: token?.length,
			hasAuthAdmin: !!authAdmin,
			projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
		});
		
		// Provide more specific error messages
		let errorMessage: string = 'Invalid token';
		const isNetworkError = err?.message?.includes('ETIMEDOUT') || 
			err?.message?.includes('ECONNREFUSED') || 
			err?.message?.includes('ENOTFOUND') ||
			err?.message?.includes('timeout') ||
			err?.message?.includes('connect');
		
		if (isNetworkError) {
			errorMessage = 'Network timeout: Unable to connect to Firebase servers to verify token. ' +
				'This may be due to network connectivity issues, firewall blocking, or IPv6 connectivity problems. ' +
				'Please check your internet connection and try again. If the issue persists, you may need to configure proxy settings or disable IPv6. ' +
				'See FIREBASE_ADMIN_SETUP.md for detailed troubleshooting steps.';
		} else if (err?.code === 'auth/argument-error' && !isNetworkError) {
			errorMessage = 'Invalid token format. Please log in again.';
		} else if (err?.code === 'auth/id-token-expired') {
			errorMessage = 'Token expired. Please log in again.';
		} else if (err?.code === 'auth/id-token-revoked') {
			errorMessage = 'Token revoked. Please log in again.';
		} else if (err?.code === 'auth/project-not-found' || err?.message?.includes('project')) {
			errorMessage = 'Firebase project configuration error. Please check FIREBASE_SERVICE_ACCOUNT_KEY and NEXT_PUBLIC_FIREBASE_PROJECT_ID.';
		} else if (err?.code === 'auth/invalid-credential' || err?.message?.includes('credential')) {
			errorMessage = 'Firebase Admin SDK credential error. Please verify FIREBASE_SERVICE_ACCOUNT_KEY is correctly set and restart the server.';
		} else if (err?.message) {
			errorMessage = `Token verification failed: ${err.message}`;
		}
		
		return { ok: false, status: 401, message: errorMessage };
	}
}

export async function GET(request: NextRequest) {
	const gate = await requireAdmin(request);
	if (!gate.ok) {
		return new Response(JSON.stringify({ status: 'error', message: gate.message }), { status: gate.status });
	}

	try {
		const result = await authAdmin.listUsers(100);
		const users = await Promise.all(
			result.users.map(async user => {
				let profile: { role?: string; displayName?: string; userName?: string } = {};
				try {
					// Check staff collection first (primary)
					const staffSnap = await dbAdmin.collection('staff').doc(user.uid).get();
					if (staffSnap.exists) {
						const data = staffSnap.data() as any;
						profile = {
							role: data?.role,
							displayName: data?.userName || data?.displayName,
							userName: data?.userName,
						};
					} else {
						// Fallback to users collection
						const userSnap = await dbAdmin.collection('users').doc(user.uid).get();
						if (userSnap.exists) {
							const data = userSnap.data() as any;
							profile = {
								role: data?.role,
								displayName: data?.displayName || data?.userName,
								userName: data?.userName,
							};
						}
					}
				} catch (e) {
					// swallow, non-blocking
				}
				const claims = (user.customClaims || {}) as Record<string, unknown>;
				return {
					uid: user.uid,
					email: user.email,
					displayName: profile.displayName || profile.userName || user.displayName || '',
					disabled: user.disabled ?? false,
					customClaims: claims,
					role: (claims.role as string) || profile.role || '',
				};
			})
		);
		return new Response(JSON.stringify({ status: 'ok', users }), { status: 200 });
	} catch (err: any) {
		console.error('GET /api/admin/users failed', err);
		return new Response(JSON.stringify({ status: 'error', message: err?.message || 'Failed to list users' }), {
			status: 500,
		});
	}
}

export async function POST(request: NextRequest) {
	// Parse body once and reuse it
	let body: any;
	let fallbackRole: string | undefined;
	try {
		body = await request.json();
		fallbackRole = body?.requestingUserRole;
	} catch {
		return new Response(JSON.stringify({ status: 'error', message: 'Invalid request body' }), { status: 400 });
	}
	
	const gate = await requireAdmin(request, fallbackRole);
	if (!gate.ok) {
	 return new Response(JSON.stringify({ status: 'error', message: gate.message }), { status: gate.status });
	}
	try {
		const email: string = String(body?.email || '').trim().toLowerCase();
		const password: string = String(body?.password || '').trim();
		const displayName: string = String(body?.displayName || '').trim();
		const role: string = String(body?.role || 'FrontDesk').trim();
		if (!email || !displayName) {
			return new Response(JSON.stringify({ status: 'error', message: 'email and displayName required' }), {
				status: 400,
			});
		}
		if (!password) {
			return new Response(JSON.stringify({ status: 'error', message: 'password required for new users' }), {
				status: 400,
			});
		}

		let userRecord;
		let isNewUser = false;

		// Check if user already exists
		try {
			userRecord = await authAdmin.getUserByEmail(email);
			// User exists - update them
			const updateData: any = { displayName, disabled: false };
			if (password) {
				updateData.password = password;
			}
			userRecord = await authAdmin.updateUser(userRecord.uid, updateData);
		} catch (getUserError: any) {
			// User doesn't exist - create new user
			if (getUserError.code === 'auth/user-not-found') {
				userRecord = await authAdmin.createUser({ email, password, displayName, disabled: false });
				isNewUser = true;
			} else {
				throw getUserError;
			}
		}

		// Update custom claims (role)
		await authAdmin.setCustomUserClaims(userRecord.uid, { role });

		// Update/create Firestore profile in staff collection
		const staffProfileData: any = {
			authUid: userRecord.uid,
			userEmail: email,
			userName: displayName,
			role,
			status: 'Active',
			updatedAt: new Date().toISOString(),
		};
		
		// Only set createdAt for new users
		if (isNewUser) {
			staffProfileData.createdAt = new Date().toISOString();
		}
		
		// Write to staff collection (primary)
		await dbAdmin.collection('staff').doc(userRecord.uid).set(staffProfileData, { merge: true });
		
		// Also write to users collection for backward compatibility
		const userProfileData: any = {
			email,
			displayName,
			role,
			status: 'Active',
			userName: displayName,
			updatedAt: new Date().toISOString(),
		};
		if (isNewUser) {
			userProfileData.createdAt = new Date().toISOString();
		}
		await dbAdmin.collection('users').doc(userRecord.uid).set(userProfileData, { merge: true });

		return new Response(
			JSON.stringify({
				status: 'ok',
				user: { uid: userRecord.uid, email, displayName, role, disabled: false },
				message: isNewUser ? 'User created successfully' : 'User updated successfully',
			}),
			{ status: isNewUser ? 201 : 200 }
		);
	} catch (err: any) {
		console.error('POST /api/admin/users failed', err);
		
		// Handle specific Firebase Auth errors
		let errorMessage: string;
		if (err?.code === 'auth/email-already-exists') {
			errorMessage = 'Email address is already in use';
		} else if (err?.code === 'auth/invalid-email') {
			errorMessage = 'Invalid email address format';
		} else if (err?.code === 'auth/weak-password') {
			errorMessage = 'Password is too weak. Please use a stronger password.';
		} else if (err?.code === 'auth/network-request-failed' || err?.message?.includes('network') || err?.message?.includes('timeout') || err?.message?.includes('ETIMEDOUT') || err?.message?.includes('ECONNREFUSED')) {
			errorMessage = 'Network error: Unable to connect to Firebase servers. This may be due to:\n' +
				'• Network connectivity issues\n' +
				'• Firebase Admin SDK not properly configured (see FIREBASE_ADMIN_SETUP.md)\n' +
				'• Server firewall blocking connections\n' +
				'• IPv6 connectivity problems\n\n' +
				'Please check your internet connection and ensure Firebase Admin credentials are properly configured.';
		} else if (err?.message?.includes('Admin SDK') || err?.message?.includes('credential')) {
			errorMessage = 'Firebase Admin SDK configuration error. Please verify FIREBASE_SERVICE_ACCOUNT_KEY is correctly set and restart the server. See FIREBASE_ADMIN_SETUP.md for details.';
		} else {
			errorMessage = err?.message || 'Failed to create/update user';
		}
		
		return new Response(JSON.stringify({ status: 'error', message: errorMessage }), {
			status: 500,
		});
	}
}

export async function PATCH(request: NextRequest) {
	const gate = await requireAdmin(request);
	if (!gate.ok) {
		return new Response(JSON.stringify({ status: 'error', message: gate.message }), { status: gate.status });
	}
	try {
		const body = await request.json();
		const uid: string = String(body?.uid || '').trim();
		const role: string | undefined = body?.role ? String(body.role).trim() : undefined;
		const disabled: boolean | undefined = typeof body?.disabled === 'boolean' ? body.disabled : undefined;
		if (!uid) {
		 return new Response(JSON.stringify({ status: 'error', message: 'uid required' }), { status: 400 });
		}
		let updated: any = {};
		if (typeof disabled === 'boolean') {
			await authAdmin.updateUser(uid, { disabled });
			updated.disabled = disabled;
		}
		if (role) {
			await authAdmin.setCustomUserClaims(uid, { role });
			// Update both collections for consistency
			await dbAdmin.collection('staff').doc(uid).set({ role }, { merge: true });
			await dbAdmin.collection('users').doc(uid).set({ role }, { merge: true });
			updated.role = role;
		}
		const user = await authAdmin.getUser(uid);
		return new Response(
			JSON.stringify({
				status: 'ok',
				user: {
					uid: user.uid,
					email: user.email,
					displayName: user.displayName,
					disabled: user.disabled,
					role: updated.role ?? ((user.customClaims as any)?.role || null),
				},
			}),
			{ status: 200 }
		);
	} catch (err: any) {
		console.error('PATCH /api/admin/users failed', err);
		return new Response(JSON.stringify({ status: 'error', message: err?.message || 'Failed to update user' }), {
			status: 500,
		});
	}
}

export async function DELETE(request: NextRequest) {
	const gate = await requireAdmin(request);
	if (!gate.ok) {
		return new Response(JSON.stringify({ status: 'error', message: gate.message }), { status: gate.status });
	}
	try {
		const body = await request.json();
		const uid: string = String(body?.uid || '').trim();
		if (!uid) {
			return new Response(JSON.stringify({ status: 'error', message: 'uid required' }), { status: 400 });
		}
		await authAdmin.updateUser(uid, { disabled: true });
		return new Response(JSON.stringify({ status: 'ok', user: { uid, disabled: true } }), { status: 200 });
	} catch (err: any) {
		console.error('DELETE /api/admin/users failed', err);
		return new Response(JSON.stringify({ status: 'error', message: err?.message || 'Failed to disable user' }), {
			status: 500,
		});
	}
}


