import { getAnalytics } from 'firebase/analytics';
import { getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

type FirebaseConfigKey =
	| 'API_KEY'
	| 'AUTH_DOMAIN'
	| 'PROJECT_ID'
	| 'STORAGE_BUCKET'
	| 'MESSAGING_SENDER_ID'
	| 'APP_ID'
	| 'MEASUREMENT_ID'
	| 'DATABASE_ID';

const FALLBACK_CLIENT_CONFIG: FirebaseOptions = {
	apiKey: "AIzaSyA-oitYFLHjKWgTgkdz8E5WnGi5byZaYfM",
	authDomain: "sixs-physio.firebaseapp.com",
	projectId: "sixs-physio",
	storageBucket: "sixs-physio.firebasestorage.app",
	messagingSenderId: "1086337017366",
	appId: "1:1086337017366:web:a147b7adef3b351a677737",
	measurementId: "G-VCZG2DGQJG"
};

const isStaging = process.env.NEXT_PUBLIC_ENVIRONMENT === 'staging';

const getEnvValue = (key: FirebaseConfigKey): string | undefined => {
	const stagingKey = `NEXT_PUBLIC_FIREBASE_STAGING_${key}` as keyof NodeJS.ProcessEnv;
	const prodKey = `NEXT_PUBLIC_FIREBASE_${key}` as keyof NodeJS.ProcessEnv;
	const stagingValue = process.env[stagingKey];
	const prodValue = process.env[prodKey];

	return isStaging ? stagingValue ?? prodValue : prodValue ?? stagingValue;
};

const fallbackKeys: FirebaseConfigKey[] = [];
const withFallback = <K extends FirebaseConfigKey>(key: K, fallback: string | undefined) => {
	const value = getEnvValue(key);
	if (!value && fallback) {
		fallbackKeys.push(key);
	}
	return value ?? fallback;
};

const firebaseConfig: FirebaseOptions = {
	apiKey: withFallback('API_KEY', FALLBACK_CLIENT_CONFIG.apiKey),
	authDomain: withFallback('AUTH_DOMAIN', FALLBACK_CLIENT_CONFIG.authDomain),
	projectId: withFallback('PROJECT_ID', FALLBACK_CLIENT_CONFIG.projectId),
	storageBucket: withFallback('STORAGE_BUCKET', FALLBACK_CLIENT_CONFIG.storageBucket),
	messagingSenderId: withFallback('MESSAGING_SENDER_ID', FALLBACK_CLIENT_CONFIG.messagingSenderId),
	appId: withFallback('APP_ID', FALLBACK_CLIENT_CONFIG.appId),
	measurementId: withFallback('MEASUREMENT_ID', FALLBACK_CLIENT_CONFIG.measurementId),
};

const rawDatabaseId = getEnvValue('DATABASE_ID');
const DATABASE_ID =
	rawDatabaseId && rawDatabaseId !== '(default)' && rawDatabaseId.toLowerCase() !== 'default'
		? rawDatabaseId
		: undefined;

// Initialize Firebase
let app;
try {
	app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
	
	// Validate configuration
	if (!app) {
		throw new Error('Failed to initialize Firebase app');
	}
	
	// Log configuration in development
	if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
		if (fallbackKeys.length > 0) {
			console.warn(
				'⚠️ Firebase config is using hardcoded fallback values for:',
				fallbackKeys.join(', '),
				'\nEnsure the corresponding NEXT_PUBLIC_FIREBASE_* environment variables are set and restart the dev server.'
			);
		}
		console.log('✅ Firebase initialized:', {
			environment: isStaging ? 'staging' : 'production',
			projectId: firebaseConfig.projectId,
			authDomain: firebaseConfig.authDomain,
			databaseId: DATABASE_ID ?? '(default)',
		});
	}
} catch (error) {
	console.error('❌ Firebase initialization error:', error);
	throw error;
}

// Initialize Analytics (only in browser environment)
let analytics: ReturnType<typeof getAnalytics> | null = null;
if (typeof window !== 'undefined') {
	try {
		analytics = getAnalytics(app);
	} catch (error) {
		// Analytics may fail if already initialized or in certain environments
		console.warn('Firebase Analytics initialization failed:', error);
	}
}

// Initialize Auth - ensure it's initialized with the correct app
let auth: Auth;
try {
	auth = getAuth(app);
	if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
		console.log('✅ Firebase Auth initialized');
		console.log('   Auth Domain:', firebaseConfig.authDomain);
		console.log('   Project ID:', firebaseConfig.projectId);
	}
} catch (error: any) {
	console.error('❌ Firebase Auth initialization error:', error);
	if (error?.code === 'auth/configuration-not-found' || error?.message?.includes('configuration')) {
		console.error('\n⚠️  Firebase Authentication Configuration Error!');
		console.error('   This usually means:');
		console.error('   1. The Firebase project configuration is incorrect');
		console.error('   2. Authentication is not enabled in Firebase Console');
		console.error('   3. The auth domain does not match your project');
		console.error('\n   Please check:');
		console.error('   - Firebase Console → Authentication → Sign-in method (enable Email/Password)');
		console.error('   - Update lib/firebase.ts with your correct Firebase configuration');
		console.error('   - Verify the projectId and authDomain match your Firebase project');
	}
	throw error;
}

// Initialize Firestore with default database
let db: Firestore;
try {
	db = DATABASE_ID ? getFirestore(app, DATABASE_ID) : getFirestore(app);
	if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
		console.log('✅ Firebase Firestore initialized with database:', DATABASE_ID ?? '(default)');
	}
} catch (error) {
	console.error('❌ Firebase Firestore initialization error:', error);
	throw error;
}

// Initialize Storage
let storage;
try {
	storage = getStorage(app);
	if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
		console.log('✅ Firebase Storage initialized');
	}
} catch (error) {
	console.error('❌ Firebase Storage initialization error:', error);
	throw error;
}

export { auth, db, analytics, storage };

