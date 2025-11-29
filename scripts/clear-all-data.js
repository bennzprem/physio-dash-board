/**
 * ⚠️ DANGER: This script will DELETE ALL DATA
 * 
 * This script will:
 * 1. Delete ALL documents from ALL Firestore collections
 * 2. Delete ALL Firebase Authentication users
 * 
 * ⚠️ THIS CANNOT BE UNDONE ⚠️
 * 
 * Usage:
 *   node scripts/clear-all-data.js
 * 
 * Make sure you have:
 * - FIREBASE_SERVICE_ACCOUNT_KEY set in environment
 * - NEXT_PUBLIC_FIREBASE_PROJECT_ID set in environment
 */

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { readFileSync, existsSync } = require('fs');
const { join } = require('path');

const isStaging = process.env.NEXT_PUBLIC_ENVIRONMENT === 'staging';
const DEFAULT_PROJECT_ID = 'centerforsportsandscience';
const DEFAULT_DATABASE_ID = 'sixs-physio';

const getAdminEnv = (key) => {
	const stagingKey = `FIREBASE_ADMIN_STAGING_${key}`;
	const prodKey = `FIREBASE_ADMIN_${key}`;
	const stagingVal = process.env[stagingKey];
	const prodVal = process.env[prodKey];
	return isStaging ? stagingVal || prodVal : prodVal || stagingVal;
};

const resolveProjectId = (serviceAccountProjectId) => {
	const stagingId =
		process.env.NEXT_PUBLIC_FIREBASE_STAGING_PROJECT_ID ||
		process.env.FIREBASE_STAGING_PROJECT_ID;
	const prodId =
		process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;

	return (
		(isStaging ? stagingId ?? prodId : prodId ?? stagingId) ||
		serviceAccountProjectId ||
		DEFAULT_PROJECT_ID
	);
};

const resolveDatabaseId = () => {
	const stagingId =
		process.env.FIREBASE_STAGING_DATABASE_ID ||
		process.env.NEXT_PUBLIC_FIREBASE_STAGING_DATABASE_ID;
	const prodId =
		process.env.FIREBASE_DATABASE_ID || process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID;
	const rawId = isStaging ? stagingId ?? prodId : prodId ?? stagingId;

	const candidate = rawId || DEFAULT_DATABASE_ID;
	if (!candidate || candidate === '(default)' || candidate.toLowerCase() === 'default') {
		return undefined;
	}
	return candidate;
};

const buildServiceAccountFromFragments = () => {
	const projectId = getAdminEnv('PROJECT_ID');
	const clientEmail = getAdminEnv('CLIENT_EMAIL');
	const privateKey = getAdminEnv('PRIVATE_KEY');

	if (!projectId || !clientEmail || !privateKey) {
		return null;
	}

	const normalizedKey = privateKey.replace(/\\n/g, '\n').replace(/\\r/g, '\r');

	return {
		type: 'service_account',
		project_id: projectId,
		private_key: normalizedKey,
		private_key_id: getAdminEnv('PRIVATE_KEY_ID') || 'auto-generated-key',
		client_email: clientEmail,
		client_id: getAdminEnv('CLIENT_ID'),
		auth_uri: 'https://accounts.google.com/o/oauth2/auth',
		token_uri: 'https://oauth2.googleapis.com/token',
		auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
		client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(clientEmail)}`,
	};
};

// Color codes for console output
const colors = {
	reset: '\x1b[0m',
	red: '\x1b[31m',
	green: '\x1b[32m',
	yellow: '\x1b[33m',
	blue: '\x1b[34m',
	magenta: '\x1b[35m',
	cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
	console.log(`${colors[color]}${message}${colors.reset}`);
}

function initializeFirebaseAdmin() {
	// Check if already initialized
	if (getApps().length > 0) {
		return getApps()[0];
	}

	// Try to load service account credentials
	let serviceAccountKey = null;

	// Method 0: Build from FIREBASE_ADMIN_* fragments
	serviceAccountKey = buildServiceAccountFromFragments();
	if (serviceAccountKey) {
		log('✅ Loaded service account from FIREBASE_ADMIN_* fragments', 'green');
	}

	// Method 1: From environment variable
	if (!serviceAccountKey) {
		const serviceAccountKeyEnv = isStaging
			? (process.env.FIREBASE_SERVICE_ACCOUNT_KEY_STAGING || process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
			: process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
		
		if (serviceAccountKeyEnv) {
			try {
				// Remove surrounding quotes if present
				let cleaned = serviceAccountKeyEnv.trim();
				if ((cleaned.startsWith("'") && cleaned.endsWith("'")) || 
				    (cleaned.startsWith('"') && cleaned.endsWith('"'))) {
					cleaned = cleaned.slice(1, -1);
				}
				serviceAccountKey = JSON.parse(cleaned);
				log('✅ Loaded service account from FIREBASE_SERVICE_ACCOUNT_KEY', 'green');
			} catch (error) {
				log('❌ Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY', 'red');
			}
		}
	}

	// Method 2: From file
	if (!serviceAccountKey) {
		const stagingCredentialsPath = isStaging 
			? (process.env.GOOGLE_APPLICATION_CREDENTIALS_STAGING || 
			   (process.cwd() ? join(process.cwd(), 'firebase-service-account-staging.json') : null))
			: null;
		
		const credentialsPath = stagingCredentialsPath || 
			process.env.GOOGLE_APPLICATION_CREDENTIALS || 
			(process.cwd() ? join(process.cwd(), 'firebase-service-account.json') : null);
		
		if (credentialsPath && existsSync(credentialsPath)) {
			try {
				const filePath = credentialsPath.startsWith('/') || credentialsPath.match(/^[A-Z]:/) 
					? credentialsPath 
					: join(process.cwd(), credentialsPath);
				serviceAccountKey = JSON.parse(readFileSync(filePath, 'utf8'));
				log('✅ Loaded service account from file', 'green');
			} catch (error) {
				log('❌ Failed to load service account from file', 'red');
			}
		}
	}

	if (!serviceAccountKey) {
		throw new Error(
			'Firebase Admin SDK credentials not found. Set FIREBASE_SERVICE_ACCOUNT_KEY or GOOGLE_APPLICATION_CREDENTIALS'
		);
	}

	const projectId = resolveProjectId(serviceAccountKey.project_id);
	const databaseId = resolveDatabaseId();

	log(`   Project ID: ${projectId}`, 'cyan');
	if (databaseId) {
		log(`   Database ID: ${databaseId}`, 'cyan');
	} else {
		log(`   Database ID: (default)`, 'cyan');
	}

	return initializeApp({
		credential: cert(serviceAccountKey),
		projectId: projectId || serviceAccountKey.project_id,
	});
}

async function deleteAllFirestoreCollections() {
	const app = initializeFirebaseAdmin();
	const databaseId = resolveDatabaseId();
	const db = databaseId ? getFirestore(app, databaseId) : getFirestore(app);
	
	log('\n🗑️  Starting Firestore collection deletion...', 'yellow');
	
	try {
		// Get all collections
		const collections = await db.listCollections();
		const collectionNames = collections.map(col => col.id);
		
		if (collectionNames.length === 0) {
			log('   No collections found. Firestore is already empty.', 'cyan');
			return;
		}
		
		log(`   Found ${collectionNames.length} collection(s): ${collectionNames.join(', ')}`, 'cyan');
		
		// Delete all documents in each collection
		for (const collectionName of collectionNames) {
			log(`\n   📂 Deleting collection: ${collectionName}`, 'blue');
			
			const collectionRef = db.collection(collectionName);
			const snapshot = await collectionRef.get();
			
			if (snapshot.empty) {
				log(`      ✓ Collection "${collectionName}" is already empty`, 'green');
				continue;
			}
			
			log(`      Found ${snapshot.size} document(s)`, 'cyan');
			
			// Delete in batches (Firestore batch limit is 500)
			const batchSize = 500;
			const docs = snapshot.docs;
			let deletedCount = 0;
			
			for (let i = 0; i < docs.length; i += batchSize) {
				const batch = db.batch();
				const batchDocs = docs.slice(i, i + batchSize);
				
				batchDocs.forEach(doc => {
					batch.delete(doc.ref);
				});
				
				await batch.commit();
				deletedCount += batchDocs.length;
				log(`      Deleted ${deletedCount}/${docs.length} documents...`, 'cyan');
			}
			
			log(`      ✅ Deleted all ${deletedCount} document(s) from "${collectionName}"`, 'green');
		}
		
		log('\n✅ All Firestore collections cleared!', 'green');
	} catch (error) {
		log(`\n❌ Error deleting Firestore collections: ${error.message}`, 'red');
		throw error;
	}
}

async function deleteAllAuthUsers() {
	const app = initializeFirebaseAdmin();
	const auth = getAuth(app);
	
	log('\n🗑️  Starting Firebase Auth user deletion...', 'yellow');
	
	try {
		// List all users (in batches of 1000)
		let allUsers = [];
		let nextPageToken;
		
		do {
			const listUsersResult = await auth.listUsers(1000, nextPageToken);
			allUsers = allUsers.concat(listUsersResult.users);
			nextPageToken = listUsersResult.pageToken;
		} while (nextPageToken);
		
		if (allUsers.length === 0) {
			log('   No users found. Firebase Auth is already empty.', 'cyan');
			return;
		}
		
		log(`   Found ${allUsers.length} user(s)`, 'cyan');
		
		// Delete users in batches (Firebase Admin SDK can delete up to 1000 at a time)
		const batchSize = 1000;
		let deletedCount = 0;
		
		for (let i = 0; i < allUsers.length; i += batchSize) {
			const batch = allUsers.slice(i, i + batchSize);
			const uids = batch.map(user => user.uid);
			
			await auth.deleteUsers(uids);
			deletedCount += batch.length;
			log(`   Deleted ${deletedCount}/${allUsers.length} users...`, 'cyan');
		}
		
		log(`\n✅ Deleted all ${deletedCount} Firebase Auth user(s)!`, 'green');
	} catch (error) {
		log(`\n❌ Error deleting Firebase Auth users: ${error.message}`, 'red');
		throw error;
	}
}

async function main() {
	log('\n' + '='.repeat(60), 'red');
	log('⚠️  DANGER: DATA DELETION SCRIPT ⚠️', 'red');
	log('='.repeat(60), 'red');
	log('\nThis script will DELETE:', 'yellow');
	log('  1. ALL documents from ALL Firestore collections', 'yellow');
	log('  2. ALL Firebase Authentication users', 'yellow');
	log('\n⚠️  THIS CANNOT BE UNDONE! ⚠️', 'red');
	
	// Require confirmation
	const readline = require('readline');
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	
	return new Promise((resolve, reject) => {
		rl.question('\nType "DELETE ALL" to confirm: ', async (answer) => {
			rl.close();
			
			if (answer !== 'DELETE ALL') {
				log('\n❌ Deletion cancelled. You must type exactly "DELETE ALL" to proceed.', 'red');
				process.exit(0);
			}
			
			try {
				log('\n🚀 Starting deletion process...\n', 'magenta');
				
				// Delete Firestore collections
				await deleteAllFirestoreCollections();
				
				// Delete Auth users
				await deleteAllAuthUsers();
				
				log('\n' + '='.repeat(60), 'green');
				log('✅ ALL DATA DELETED SUCCESSFULLY!', 'green');
				log('='.repeat(60), 'green');
				log('\nYou can now start fresh with new data.', 'cyan');
				
				resolve();
			} catch (error) {
				log('\n' + '='.repeat(60), 'red');
				log('❌ DELETION FAILED', 'red');
				log('='.repeat(60), 'red');
				log(`\nError: ${error.message}`, 'red');
				log('\nSome data may have been deleted. Check Firebase Console for details.', 'yellow');
				reject(error);
			}
		});
	});
}

// Run the script
if (require.main === module) {
	main()
		.then(() => {
			process.exit(0);
		})
		.catch(error => {
			console.error(error);
			process.exit(1);
		});
}

module.exports = { deleteAllFirestoreCollections, deleteAllAuthUsers };

