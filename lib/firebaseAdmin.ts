import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { App } from 'firebase-admin/app';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';

let app: App | null = null;
let authAdmin: Auth;
let dbAdmin: Firestore;

// Determine environment (staging or production)
// Note: NODE_ENV can only be 'development', 'production', or 'test', so we only check NEXT_PUBLIC_ENVIRONMENT for staging
const isStaging = process.env.NEXT_PUBLIC_ENVIRONMENT === 'staging';

const getAdminEnv = (key: string) => {
	const stagingKey = `FIREBASE_ADMIN_STAGING_${key}`;
	const prodKey = `FIREBASE_ADMIN_${key}`;
	const stagingValue = process.env[stagingKey as keyof NodeJS.ProcessEnv];
	const prodValue = process.env[prodKey as keyof NodeJS.ProcessEnv];
	return isStaging ? stagingValue ?? prodValue : prodValue ?? stagingValue;
};

const buildServiceAccountFromFragments = () => {
	const projectId = getAdminEnv('PROJECT_ID');
	const clientEmail = getAdminEnv('CLIENT_EMAIL');
	const privateKey = getAdminEnv('PRIVATE_KEY');

	if (!projectId || !clientEmail || !privateKey) {
		return null;
	}

	const normalizedKey = privateKey.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
	const clientId = getAdminEnv('CLIENT_ID') || undefined;
	const privateKeyId = getAdminEnv('PRIVATE_KEY_ID') || 'auto-generated-key';

	return {
		type: 'service_account',
		project_id: projectId,
		private_key_id: privateKeyId,
		private_key: normalizedKey,
		client_email: clientEmail,
		client_id: clientId,
		auth_uri: 'https://accounts.google.com/o/oauth2/auth',
		token_uri: 'https://oauth2.googleapis.com/token',
		auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
		client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(clientEmail)}`,
	};
};

// Debug logging (server-side)
if (process.env.NODE_ENV === 'development') {
	console.log('🔍 [ADMIN SDK] Environment Check:');
	console.log('  NEXT_PUBLIC_ENVIRONMENT:', process.env.NEXT_PUBLIC_ENVIRONMENT);
	console.log('  NODE_ENV:', process.env.NODE_ENV);
	console.log('  isStaging:', isStaging);
}

// Get project ID based on environment
const getProjectId = () => {
	if (isStaging) {
		const stagingId = process.env.NEXT_PUBLIC_FIREBASE_STAGING_PROJECT_ID || 
			process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
		if (process.env.NODE_ENV === 'development') {
			console.log('  [ADMIN SDK] Using staging project ID:', stagingId);
		}
		return stagingId;
	}
	const prodId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
	if (process.env.NODE_ENV === 'development') {
		console.log('  [ADMIN SDK] Using production project ID:', prodId);
	}
	// Fallback to sixs-physio (matching client-side config)
	return prodId || 'sixs-physio';
};

const resolveDatabaseId = () => {
	const stagingId =
		process.env.FIREBASE_STAGING_DATABASE_ID ||
		process.env.NEXT_PUBLIC_FIREBASE_STAGING_DATABASE_ID;
	const prodId =
		process.env.FIREBASE_DATABASE_ID || process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID;

	const rawId = isStaging ? stagingId ?? prodId : prodId ?? stagingId;
	if (!rawId || rawId === '(default)' || rawId.toLowerCase() === 'default') {
		return undefined;
	}
	return rawId;
};

const resolvedDatabaseId = resolveDatabaseId();

// Initialize Firebase Admin SDK
if (getApps().length === 0) {
	// Method 0: Build credentials from FIREBASE_ADMIN_* fragments
	let serviceAccountKey = buildServiceAccountFromFragments();
	if (serviceAccountKey) {
		try {
			console.log(`✅ Firebase Admin SDK: Built credentials from FIREBASE_ADMIN_${isStaging ? 'STAGING_' : ''}* variables`);
			// Use client's project ID to match tokens, even if service account has different project_id
			const clientProjectId = getProjectId() || 'sixs-physio';
			app = initializeApp({
				credential: cert(serviceAccountKey as any),
				projectId: clientProjectId,
			});
			if (serviceAccountKey.project_id && serviceAccountKey.project_id !== clientProjectId) {
				console.warn(`   ⚠️  Service account project_id (${serviceAccountKey.project_id}) differs from client project (${clientProjectId}). Using ${clientProjectId} to match client tokens.`);
			}
		} catch (error) {
			console.error('❌ Failed to initialize Firebase Admin using FIREBASE_ADMIN_* variables:', (error as Error).message);
		}
	}

	// Method 1: Try using file path (GOOGLE_APPLICATION_CREDENTIALS or default location)
	// For staging, try staging-specific file first
	const stagingCredentialsPath = isStaging 
		? (process.env.GOOGLE_APPLICATION_CREDENTIALS_STAGING || 
		   (process.cwd() ? join(process.cwd(), 'firebase-service-account-staging.json') : null))
		: null;
	
	const credentialsPath = stagingCredentialsPath || 
		process.env.GOOGLE_APPLICATION_CREDENTIALS || 
		(process.cwd() ? join(process.cwd(), 'firebase-service-account.json') : null);
	
	if (credentialsPath) {
		try {
			const filePath = credentialsPath.startsWith('/') || credentialsPath.match(/^[A-Z]:/) 
				? credentialsPath 
				: join(process.cwd(), credentialsPath);
			const serviceAccountKey = JSON.parse(readFileSync(filePath, 'utf8'));
			console.log(`✅ Firebase Admin SDK: Loaded credentials from file (${isStaging ? 'STAGING' : 'PRODUCTION'}):`, filePath);
			// Use client's project ID to match tokens, even if service account file has different project_id
			const clientProjectId = getProjectId() || 'sixs-physio';
			app = initializeApp({
				credential: cert(serviceAccountKey),
				projectId: clientProjectId,
			});
			if (serviceAccountKey.project_id && serviceAccountKey.project_id !== clientProjectId) {
				console.warn(`   ⚠️  Service account project_id (${serviceAccountKey.project_id}) differs from client project (${clientProjectId}). Using ${clientProjectId} to match client tokens.`);
			}
		} catch (error: any) {
			// File doesn't exist or can't be read - that's okay, try other methods
			if (error.code !== 'ENOENT') {
				console.error('❌ Failed to load credentials from file:', error.message);
			}
		}
	}
	
	// Method 2: Try using JSON string from environment variable
	// For staging, try staging-specific key first
	if (!app) {
		let serviceAccount = isStaging
			? (process.env.FIREBASE_SERVICE_ACCOUNT_KEY_STAGING || process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
			: process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
		
		if (serviceAccount) {
			// Remove surrounding single or double quotes if present
			serviceAccount = serviceAccount.trim();
			if ((serviceAccount.startsWith("'") && serviceAccount.endsWith("'")) || 
			    (serviceAccount.startsWith('"') && serviceAccount.endsWith('"'))) {
				serviceAccount = serviceAccount.slice(1, -1);
			}
			
			// Parse the service account key (it should be a JSON string)
			try {
				const serviceAccountKey = JSON.parse(serviceAccount);
				console.log(`✅ Firebase Admin SDK: Successfully loaded service account credentials from env var (${isStaging ? 'STAGING' : 'PRODUCTION'})`);
				// Use client's project ID to match tokens, even if service account file has different project_id
				const clientProjectId = getProjectId() || 'sixs-physio';
				app = initializeApp({
					credential: cert(serviceAccountKey),
					projectId: clientProjectId,
				});
				if (serviceAccountKey.project_id && serviceAccountKey.project_id !== clientProjectId) {
					console.warn(`   ⚠️  Service account project_id (${serviceAccountKey.project_id}) differs from client project (${clientProjectId}). Using ${clientProjectId} to match client tokens.`);
				}
			} catch (error) {
				console.error('❌ Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY:', error);
				console.error('Service account string length:', serviceAccount.length);
				console.error('First 100 chars:', serviceAccount.substring(0, 100));
			}
		}
	}
	
	// Method 3: Fallback to Application Default Credentials
	if (!app) {
		// No service account key provided - use Application Default Credentials
		// This works if running on Google Cloud or if GOOGLE_APPLICATION_CREDENTIALS is set
		console.warn('⚠️ FIREBASE_SERVICE_ACCOUNT_KEY not found. Attempting to use Application Default Credentials...');
		const projectId = getProjectId();
		if (!projectId) {
			console.error('❌ NEXT_PUBLIC_FIREBASE_PROJECT_ID is not set. Please set it in .env.local');
			console.error('   See FIREBASE_ADMIN_SETUP.md for setup instructions');
		}
		try {
			app = initializeApp({
				projectId: projectId,
			});
			console.warn('⚠️ Firebase Admin SDK initialized without explicit credentials (may fail on admin operations)');
		} catch (error) {
			console.error('❌ Failed to initialize Firebase Admin:', error);
			// Create a minimal app for development (will fail on actual admin operations)
			app = initializeApp({
				projectId: projectId || 'sixs-physio',
			}, 'admin');
			console.warn('⚠️ Created minimal Firebase Admin app (admin operations will fail)');
		}
	}
} else {
	app = getApps()[0] || null;
}

// Final safety check to satisfy TypeScript definite assignment
if (!app) {
	const fallbackProjectId = getProjectId() || 'sixs-physio';
	app = getApps()[0] || initializeApp({ projectId: fallbackProjectId });
}

// Ensure project ID is set on the app
if (app && !app.options.projectId) {
	const projectId = getProjectId() || 'sixs-physio';
	console.warn(`⚠️ Firebase Admin app missing projectId, setting to: ${projectId}`);
	// Re-initialize with project ID if missing
	try {
		app = initializeApp({
			projectId: projectId,
		}, app.name || 'admin');
	} catch (error) {
		console.error('❌ Failed to re-initialize with project ID:', error);
	}
}

authAdmin = getAuth(app as App);
dbAdmin = resolvedDatabaseId ? getFirestore(app as App, resolvedDatabaseId) : getFirestore(app as App);

// Log initialization status
const hasCredentials = !!(
	(isStaging ? process.env.FIREBASE_SERVICE_ACCOUNT_KEY_STAGING : null) ||
	process.env.FIREBASE_SERVICE_ACCOUNT_KEY || 
	(isStaging ? process.env.GOOGLE_APPLICATION_CREDENTIALS_STAGING : null) ||
	process.env.GOOGLE_APPLICATION_CREDENTIALS ||
	(process.cwd() && existsSync(join(process.cwd(), isStaging ? 'firebase-service-account-staging.json' : 'firebase-service-account.json')))
);

if (hasCredentials) {
	const actualProjectId = app?.options?.projectId || getProjectId() || 'not set';
	console.log(`✅ Firebase Admin SDK initialized successfully (${isStaging ? 'STAGING' : 'PRODUCTION'})`);
	console.log('   Project ID:', actualProjectId);
	console.log('   Database ID:', resolvedDatabaseId ?? '(default)');
	
	// Warn if project ID doesn't match expected
	if (actualProjectId !== 'sixs-physio' && actualProjectId !== 'not set') {
		console.warn(`   ⚠️  Project ID mismatch: Admin SDK is using "${actualProjectId}" but client expects "sixs-physio"`);
		console.warn('   This will cause token verification errors. Ensure your service account file has project_id: "sixs-physio"');
	}
} else {
	console.warn('⚠️ Firebase Admin SDK initialized but credentials may be missing');
	console.warn(`   Set FIREBASE_SERVICE_ACCOUNT_KEY${isStaging ? '_STAGING' : ''} or GOOGLE_APPLICATION_CREDENTIALS${isStaging ? '_STAGING' : ''} in .env.local`);
}

export { authAdmin, dbAdmin };

