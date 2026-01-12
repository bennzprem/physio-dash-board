'use client';

import { useState } from 'react';
import { collection, addDoc, serverTimestamp, getDocs, query, where, deleteDoc, doc } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { migratePackageBilling } from '@/lib/migratePackageBilling';


// Dummy staff data
const dummyStaff = [
	{
		userName: 'Dr. Sarah Johnson',
		userEmail: 'sarah.johnson@clinic.com',
		role: 'Physiotherapist',
		status: 'Active',
	},
	{
		userName: 'Dr. Michael Chen',
		userEmail: 'michael.chen@clinic.com',
		role: 'Physiotherapist',
		status: 'Active',
	},
	{
		userName: 'James Wilson',
		userEmail: 'james.wilson@clinic.com',
		role: 'StrengthAndConditioning',
		status: 'Active',
	},
	{
		userName: 'Emma Davis',
		userEmail: 'emma.davis@clinic.com',
		role: 'StrengthAndConditioning',
		status: 'Active',
	},
	{
		userName: 'Dr. Robert Taylor',
		userEmail: 'robert.taylor@clinic.com',
		role: 'ClinicalTeam',
		status: 'Active',
	},
	{
		userName: 'Lisa Anderson',
		userEmail: 'lisa.anderson@clinic.com',
		role: 'FrontDesk',
		status: 'Active',
	},
	{
		userName: 'Admin User',
		userEmail: 'admin@clinic.com',
		role: 'Admin',
		status: 'Active',
	},
];

// Dummy patient data
const dummyPatients = [
	{
		patientId: 'CSS2025A1B2C3D',
		name: 'John Smith',
		dob: '1985-03-15',
		gender: 'Male',
		phone: '9876543210',
		email: 'john.smith@email.com',
		address: '123 Main Street, Bangalore',
		complaint: 'Lower back pain',
		status: 'ongoing',
		assignedDoctor: 'Dr. Sarah Johnson',
		paymentType: 'with',
		paymentDescription: 'Senior citizen concession',
	},
	{
		patientId: 'CSS2025E4F5G6H',
		name: 'Priya Sharma',
		dob: '1992-07-22',
		gender: 'Female',
		phone: '9876543211',
		email: 'priya.sharma@email.com',
		address: '456 Park Avenue, Bangalore',
		complaint: 'Knee injury from sports',
		status: 'ongoing',
		assignedDoctor: 'Dr. Michael Chen',
		paymentType: 'without',
		paymentDescription: '',
	},
	{
		patientId: 'CSS2025I7J8K9L',
		name: 'Rajesh Kumar',
		dob: '1978-11-08',
		gender: 'Male',
		phone: '9876543212',
		email: 'rajesh.kumar@email.com',
		address: '789 MG Road, Bangalore',
		complaint: 'Shoulder rehabilitation',
		status: 'ongoing',
		assignedDoctor: 'James Wilson',
		paymentType: 'with',
		paymentDescription: 'Insurance coverage',
	},
	{
		patientId: 'CSS2025M1N2O3P',
		name: 'Anita Reddy',
		dob: '1995-05-30',
		gender: 'Female',
		phone: '9876543213',
		email: 'anita.reddy@email.com',
		address: '321 Brigade Road, Bangalore',
		complaint: 'Ankle sprain',
		status: 'pending',
		assignedDoctor: '',
		paymentType: 'without',
		paymentDescription: '',
	},
	{
		patientId: 'CSS2025Q4R5S6T',
		name: 'Vikram Singh',
		dob: '1989-09-14',
		gender: 'Male',
		phone: '9876543214',
		email: 'vikram.singh@email.com',
		address: '654 Indira Nagar, Bangalore',
		complaint: 'Neck pain',
		status: 'ongoing',
		assignedDoctor: 'Emma Davis',
		paymentType: 'with',
		paymentDescription: 'Employee health scheme',
	},
	{
		patientId: 'CSS2025U7V8W9X',
		name: 'Meera Patel',
		dob: '1990-12-25',
		gender: 'Female',
		phone: '9876543215',
		email: 'meera.patel@email.com',
		address: '987 Koramangala, Bangalore',
		complaint: 'Post-surgical rehabilitation',
		status: 'ongoing',
		assignedDoctor: 'Dr. Robert Taylor',
		paymentType: 'without',
		paymentDescription: '',
	},
	{
		patientId: 'CSS2025Y1Z2A3B',
		name: 'Arjun Menon',
		dob: '1993-02-18',
		gender: 'Male',
		phone: '9876543216',
		email: 'arjun.menon@email.com',
		address: '147 Whitefield, Bangalore',
		complaint: 'Hip flexor tightness',
		status: 'pending',
		assignedDoctor: '',
		paymentType: 'without',
		paymentDescription: '',
	},
	{
		patientId: 'CSS2025C4D5E6F',
		name: 'Sneha Iyer',
		dob: '1987-06-10',
		gender: 'Female',
		phone: '9876543217',
		email: 'sneha.iyer@email.com',
		address: '258 Jayanagar, Bangalore',
		complaint: 'Tennis elbow',
		status: 'completed',
		assignedDoctor: 'Dr. Sarah Johnson',
		paymentType: 'with',
		paymentDescription: 'Corporate wellness program',
	},
	{
		patientId: 'CSS2025G7H8I9J',
		name: 'Rahul Nair',
		dob: '1991-08-05',
		gender: 'Male',
		phone: '9876543218',
		email: 'rahul.nair@email.com',
		address: '369 Malleswaram, Bangalore',
		complaint: 'Wrist injury',
		status: 'ongoing',
		assignedDoctor: 'Dr. Michael Chen',
		paymentType: 'without',
		paymentDescription: '',
	},
	{
		patientId: 'CSS2025K1L2M3N',
		name: 'Divya Rao',
		dob: '1994-04-20',
		gender: 'Female',
		phone: '9876543219',
		email: 'divya.rao@email.com',
		address: '741 Basavanagudi, Bangalore',
		complaint: 'Lower back pain',
		status: 'ongoing',
		assignedDoctor: 'James Wilson',
		paymentType: 'with',
		paymentDescription: 'Student discount',
	},
];

// Dummy appointment data
const dummyAppointments = [
	{
		appointmentId: 'APT-ABC12',
		patientId: 'CSS2025A1B2C3D',
		patient: 'John Smith',
		doctor: 'Dr. Sarah Johnson',
		date: '2025-01-20',
		time: '10:00',
		status: 'ongoing',
		notes: 'Follow-up session for lower back pain',
	},
	{
		appointmentId: 'APT-DEF34',
		patientId: 'CSS2025E4F5G6H',
		patient: 'Priya Sharma',
		doctor: 'Dr. Michael Chen',
		date: '2025-01-20',
		time: '11:30',
		status: 'ongoing',
		notes: 'Knee rehabilitation session',
	},
	{
		appointmentId: 'APT-GHI56',
		patientId: 'CSS2025I7J8K9L',
		patient: 'Rajesh Kumar',
		doctor: 'James Wilson',
		date: '2025-01-20',
		time: '14:00',
		status: 'ongoing',
		notes: 'Strength training session',
	},
	{
		appointmentId: 'APT-JKL78',
		patientId: 'CSS2025U7V8W9X',
		patient: 'Meera Patel',
		doctor: 'Dr. Robert Taylor',
		date: '2025-01-21',
		time: '09:00',
		status: 'pending',
		notes: 'Post-surgical check-up',
	},
	{
		appointmentId: 'APT-MNO90',
		patientId: 'CSS2025Q4R5S6T',
		patient: 'Vikram Singh',
		doctor: 'Emma Davis',
		date: '2025-01-21',
		time: '15:30',
		status: 'pending',
		notes: 'Neck pain assessment',
	},
	{
		appointmentId: 'APT-PQR12',
		patientId: 'CSS2025G7H8I9J',
		patient: 'Rahul Nair',
		doctor: 'Dr. Michael Chen',
		date: '2025-01-19',
		time: '16:00',
		status: 'completed',
		notes: 'Wrist injury follow-up - completed',
	},
	{
		appointmentId: 'APT-STU34',
		patientId: 'CSS2025K1L2M3N',
		patient: 'Divya Rao',
		doctor: 'James Wilson',
		date: '2025-01-22',
		time: '10:30',
		status: 'pending',
		notes: 'Lower back pain initial consultation',
	},
];

export default function Seed() {
	const { user } = useAuth();
	const [seeding, setSeeding] = useState(false);
	const [progress, setProgress] = useState<string>('');
	const [results, setResults] = useState<{ staff: number; patients: number; appointments: number } | null>(null);
	const [testUsersCreated, setTestUsersCreated] = useState(false);
	const [testUsersError, setTestUsersError] = useState<string | null>(null);
	const [migrating, setMigrating] = useState(false);
	const [migrationResults, setMigrationResults] = useState<{
		success: boolean;
		patientsProcessed: number;
		billingRecordsConsolidated: number;
		billingRecordsDeleted: number;
		errors: string[];
	} | null>(null);

	// Test user credentials
	const testUsers = [
		{
			email: 'admin@test.com',
			password: 'admin123',
			displayName: 'Admin User',
			role: 'Admin',
		},
		{
			email: 'frontdesk@test.com',
			password: 'frontdesk123',
			displayName: 'Front Desk User',
			role: 'FrontDesk',
		},
		{
			email: 'clinical@test.com',
			password: 'clinical123',
			displayName: 'Clinical Team User',
			role: 'ClinicalTeam',
		},
	];

	const handleCreateTestUsers = async () => {
		if (!user) {
			setTestUsersError('You must be logged in as an admin to create test users.');
			return;
		}

		setSeeding(true);
		setTestUsersError(null);
		setProgress('Creating test users...');

		try {
			// Get the current user's ID token
			const token = await auth.currentUser?.getIdToken();
			if (!token) {
				throw new Error('Unable to get authentication token. Please log in again.');
			}

			const createdUsers = [];
			const errors = [];

			for (const testUser of testUsers) {
				try {
					const response = await fetch('/api/admin/users', {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							Authorization: `Bearer ${token}`,
						},
						body: JSON.stringify({
							...testUser,
							requestingUserRole: user?.role || 'Admin', // Pass the current user's role
						}),
					});

					const result = await response.json();

					if (response.ok && result.status === 'ok') {
						createdUsers.push(testUser);
					} else {
						// Check if user already exists
						if (result.message?.includes('already exists') || result.message?.includes('email')) {
							createdUsers.push(testUser); // Count as success if already exists
						} else {
							errors.push(`${testUser.email}: ${result.message || 'Failed to create'}`);
						}
					}
				} catch (error) {
					errors.push(`${testUser.email}: ${error instanceof Error ? error.message : 'Unknown error'}`);
				}
			}

			if (createdUsers.length > 0) {
				setTestUsersCreated(true);
				setProgress(`Successfully created/verified ${createdUsers.length} test users!`);
			}

			if (errors.length > 0) {
				setTestUsersError(`Some errors occurred: ${errors.join('; ')}`);
			}
		} catch (error) {
			console.error('Error creating test users:', error);
			setTestUsersError(error instanceof Error ? error.message : 'Failed to create test users');
			setProgress('');
		} finally {
			setSeeding(false);
		}
	};

	const handleSeedAll = async () => {
		setSeeding(true);
		setProgress('Starting seed process...');
		setResults(null);

		let staffCount = 0;
		let patientsCount = 0;
		let appointmentsCount = 0;

		try {
			// Seed staff
			setProgress('Seeding staff members...');
			for (const staff of dummyStaff) {
				try {
					await addDoc(collection(db, 'staff'), {
						...staff,
						createdAt: serverTimestamp(),
					});
					staffCount++;
				} catch (error) {
					console.error('Error seeding staff:', staff.userName, error);
				}
			}

			// Seed patients
			setProgress('Seeding patients...');
			for (const patient of dummyPatients) {
				try {
					await addDoc(collection(db, 'patients'), {
						...patient,
						registeredAt: serverTimestamp(),
					});
					patientsCount++;
				} catch (error) {
					console.error('Error seeding patient:', patient.name, error);
				}
			}

			// Seed appointments
			setProgress('Seeding appointments...');
			for (const appointment of dummyAppointments) {
				try {
					await addDoc(collection(db, 'appointments'), {
						...appointment,
						createdAt: serverTimestamp(),
					});
					appointmentsCount++;
				} catch (error) {
					console.error('Error seeding appointment:', appointment.appointmentId, error);
				}
			}

			setProgress('Seed process completed!');
			setResults({
				staff: staffCount,
				patients: patientsCount,
				appointments: appointmentsCount,
			});
		} catch (error) {
			console.error('Error during seed process:', error);
			setProgress(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setSeeding(false);
		}
	};

	const handleMigratePackageBilling = async () => {
		if (!user) {
			alert('You must be logged in to run migrations');
			return;
		}

		const confirmed = confirm(
			'This will consolidate individual session billing records into package billing records for all patients with packages.\n\n' +
			'This action cannot be undone. Continue?'
		);

		if (!confirmed) return;

		setMigrating(true);
		setProgress('Starting package billing migration...');
		setMigrationResults(null);

		try {
			const results = await migratePackageBilling();
			setMigrationResults(results);
			
			if (results.success) {
				setProgress(
					`Migration completed successfully!\n` +
					`- Patients processed: ${results.patientsProcessed}\n` +
					`- Package billing records created: ${results.billingRecordsConsolidated}\n` +
					`- Individual billing records deleted: ${results.billingRecordsDeleted}`
				);
			} else {
				setProgress(`Migration completed with errors. Check results below.`);
			}
		} catch (error) {
			console.error('Migration error:', error);
			setProgress(`Migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
			setMigrationResults({
				success: false,
				patientsProcessed: 0,
				billingRecordsConsolidated: 0,
				billingRecordsDeleted: 0,
				errors: [error instanceof Error ? error.message : 'Unknown error'],
			});
		} finally {
			setMigrating(false);
		}
	};

	const handleSeedStaff = async () => {
		setSeeding(true);
		setProgress('Seeding staff members...');
		let count = 0;

		try {
			for (const staff of dummyStaff) {
				try {
					await addDoc(collection(db, 'staff'), {
						...staff,
						createdAt: serverTimestamp(),
					});
					count++;
				} catch (error) {
					console.error('Error seeding staff:', staff.userName, error);
				}
			}
			setProgress(`Successfully seeded ${count} staff members!`);
		} catch (error) {
			console.error('Error seeding staff:', error);
			setProgress(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setSeeding(false);
		}
	};

	const handleSeedPatients = async () => {
		setSeeding(true);
		setProgress('Seeding patients...');
		let count = 0;

		try {
			for (const patient of dummyPatients) {
				try {
					await addDoc(collection(db, 'patients'), {
						...patient,
						registeredAt: serverTimestamp(),
					});
					count++;
				} catch (error) {
					console.error('Error seeding patient:', patient.name, error);
				}
			}
			setProgress(`Successfully seeded ${count} patients!`);
		} catch (error) {
			console.error('Error seeding patients:', error);
			setProgress(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setSeeding(false);
		}
	};

	const handleSeedAppointments = async () => {
		setSeeding(true);
		setProgress('Seeding appointments...');
		let count = 0;

		try {
			for (const appointment of dummyAppointments) {
				try {
					await addDoc(collection(db, 'appointments'), {
						...appointment,
						createdAt: serverTimestamp(),
					});
					count++;
				} catch (error) {
					console.error('Error seeding appointment:', appointment.appointmentId, error);
				}
			}
			setProgress(`Successfully seeded ${count} appointments!`);
		} catch (error) {
			console.error('Error seeding appointments:', error);
			setProgress(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setSeeding(false);
		}
	};

	const handleDeleteSampleAppointments = async () => {
		if (!window.confirm('Are you sure you want to delete all sample appointments? This action cannot be undone.')) {
			return;
		}

		setSeeding(true);
		setProgress('Searching for sample appointments...');

		try {
			// Sample patient names from seed data
			const SAMPLE_PATIENT_NAMES = [
				'John Doe',
				'Jane Smith',
				'Robert Johnson',
				'Emily Williams',
				'Michael Brown',
				'Sarah Davis',
				'David Wilson',
				'Lisa Anderson',
			];

			// Sample doctor names from seed data
			const SAMPLE_DOCTOR_NAMES = [
				'Dr. Smith',
				'Dr. Johnson',
				'Dr. Williams',
				'Dr. Brown',
				'Dr. Davis',
			];

			// Get all appointments
			const appointmentsRef = collection(db, 'appointments');
			const snapshot = await getDocs(appointmentsRef);

			if (snapshot.empty) {
				setProgress('No appointments found.');
				setSeeding(false);
				return;
			}

			const appointmentsToDelete: string[] = [];
			let checkedCount = 0;

			snapshot.forEach((docSnap) => {
				checkedCount++;
				const data = docSnap.data();
				let isSample = false;

				// Check notes for "Sample" or "testing"
				if (data.notes) {
					const notesLower = String(data.notes).toLowerCase();
					if (notesLower.includes('sample') || notesLower.includes('testing')) {
						isSample = true;
					}
				}

				// Check patient name
				if (data.patient && SAMPLE_PATIENT_NAMES.includes(data.patient)) {
					isSample = true;
				}

				// Check doctor name
				if (data.doctor && SAMPLE_DOCTOR_NAMES.includes(data.doctor)) {
					isSample = true;
				}

				// Check patient ID pattern (PAT1000-PAT9999)
				if (data.patientId && /^PAT\d{4}$/.test(data.patientId)) {
					isSample = true;
				}

				if (isSample) {
					appointmentsToDelete.push(docSnap.id);
				}
			});

			setProgress(`Found ${appointmentsToDelete.length} sample appointments out of ${checkedCount} total. Deleting...`);

			if (appointmentsToDelete.length === 0) {
				setProgress('No sample appointments found. Nothing to delete.');
				setSeeding(false);
				return;
			}

			// Delete appointments
			let deletedCount = 0;
			let errorCount = 0;

			for (const appointmentId of appointmentsToDelete) {
				try {
					await deleteDoc(doc(db, 'appointments', appointmentId));
					deletedCount++;
				} catch (error) {
					errorCount++;
					console.error('Error deleting appointment:', appointmentId, error);
				}
			}

			setProgress(`Successfully deleted ${deletedCount} sample appointments${errorCount > 0 ? ` (${errorCount} errors)` : ''}!`);
		} catch (error) {
			console.error('Error deleting sample appointments:', error);
			setProgress(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setSeeding(false);
		}
	};

	return (
		<div className="min-h-svh bg-slate-50 px-6 py-10">
			<div className="mx-auto flex max-w-4xl flex-col gap-8">
				<header className="flex flex-col gap-3">
					<div>
						<p className="text-sm font-semibold uppercase tracking-wide text-sky-600">Admin Control Center</p>
						<h1 className="mt-1 text-3xl font-semibold text-slate-900">Seed Dummy Data</h1>
						<p className="mt-2 text-sm text-slate-600">
							Populate Firestore with sample data for development and testing purposes.
						</p>
					</div>
				</header>

				<div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
					<i className="fas fa-exclamation-triangle mr-2" aria-hidden="true" />
					<strong>Warning:</strong> This will add new documents to your Firestore database. Existing documents will not be
					overwritten, but duplicate entries may be created.
				</div>

				<section className="section-card">
					<h2 className="mb-4 text-lg font-semibold text-slate-900">Seed Options</h2>

					<div className="space-y-4">
						{/* Test Users Section */}
						<div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
							<h3 className="mb-2 text-sm font-medium text-blue-900">Test User Accounts</h3>
							<p className="mb-3 text-xs text-blue-700">
								Create 3 test user accounts for accessing different dashboards. These users will be created in Firebase Authentication.
							</p>
							<div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
								<i className="fas fa-info-circle mr-2" aria-hidden="true" />
								<strong>Note:</strong> Firebase Admin SDK credentials are required. If you see credential errors, please set up Firebase Admin SDK or create users manually in Firebase Console (see TEST_USERS.md for instructions).
							</div>
							<button
								type="button"
								onClick={handleCreateTestUsers}
								disabled={seeding}
								className="btn-primary"
							>
								<i className="fas fa-user-plus text-xs" aria-hidden="true" />
								{seeding ? 'Creating...' : 'Create Test Users'}
							</button>
							{testUsersCreated && (
								<div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3">
									<h4 className="mb-2 text-xs font-semibold text-green-900">Test User Credentials:</h4>
									<div className="space-y-2 text-xs">
										{testUsers.map((user, idx) => (
											<div key={idx} className="rounded border border-green-200 bg-white p-2">
												<p className="font-semibold text-green-900">{user.displayName} ({user.role})</p>
												<p className="text-green-700">Email: <code className="bg-green-50 px-1 rounded">{user.email}</code></p>
												<p className="text-green-700">Password: <code className="bg-green-50 px-1 rounded">{user.password}</code></p>
											</div>
										))}
									</div>
								</div>
							)}
							{testUsersError && (
								<div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
									<strong>Error:</strong> {testUsersError}
									{testUsersError.includes('Credential') && (
										<div className="mt-2 rounded border border-red-300 bg-red-100 p-2">
											<p className="font-semibold">Firebase Admin SDK not configured.</p>
											<p className="mt-1">To use automated user creation, set up Firebase Admin SDK credentials. Otherwise, create users manually in Firebase Console.</p>
											<p className="mt-2">
												<strong>Quick manual setup:</strong> See <code className="bg-red-200 px-1 rounded">TEST_USERS.md</code> for step-by-step instructions.
											</p>
										</div>
									)}
								</div>
							)}
						</div>

						<div className="border-t border-slate-200 pt-4">
							<div>
								<h3 className="mb-2 text-sm font-medium text-slate-700">Seed All Data</h3>
							<p className="mb-3 text-xs text-slate-500">
								Seeds {dummyStaff.length} staff members, {dummyPatients.length} patients, and{' '}
								{dummyAppointments.length} appointments.
							</p>
							<button type="button" onClick={handleSeedAll} disabled={seeding} className="btn-primary">
								<i className="fas fa-database text-xs" aria-hidden="true" />
								{seeding ? 'Seeding...' : 'Seed All Data'}
							</button>
						</div>

						<div className="border-t border-slate-200 pt-4">
							<h3 className="mb-4 text-sm font-medium text-slate-700">Package Billing Migration</h3>
							<p className="mb-3 text-xs text-slate-500">
								Consolidates individual session billing records into single package billing records for all patients with packages. 
								This fixes existing data to match the new billing logic where packages are billed once when assigned.
							</p>
							<button
								type="button"
								onClick={handleMigratePackageBilling}
								disabled={migrating || seeding}
								className="btn-primary bg-blue-600 hover:bg-blue-700"
							>
								<i className="fas fa-sync-alt text-xs" aria-hidden="true" />
								{migrating ? 'Migrating...' : 'Migrate Package Billing'}
							</button>
							{migrationResults && (
								<div className={`mt-4 rounded-lg border p-4 ${migrationResults.success ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50'}`}>
									<h4 className="mb-2 font-semibold">{migrationResults.success ? 'Migration Successful' : 'Migration Completed with Errors'}</h4>
									<ul className="space-y-1 text-xs">
										<li>Patients processed: {migrationResults.patientsProcessed}</li>
										<li>Package billing records created: {migrationResults.billingRecordsConsolidated}</li>
										<li>Individual billing records deleted: {migrationResults.billingRecordsDeleted}</li>
									</ul>
									{migrationResults.errors.length > 0 && (
										<div className="mt-3">
											<p className="font-semibold text-red-700">Errors:</p>
											<ul className="mt-1 list-disc pl-5 text-xs text-red-600">
												{migrationResults.errors.map((error, idx) => (
													<li key={idx}>{error}</li>
												))}
											</ul>
										</div>
									)}
								</div>
							)}
						</div>

						<div className="border-t border-slate-200 pt-4">
							<h3 className="mb-4 text-sm font-medium text-slate-700">Cleanup Sample Data</h3>
							<p className="mb-3 text-xs text-slate-500">
								Delete fake/sample appointments from the calendar. This will remove appointments with sample patient names, doctor names, or notes containing "sample" or "testing".
							</p>
							<button
								type="button"
								onClick={handleDeleteSampleAppointments}
								disabled={seeding}
								className="btn-secondary border-rose-300 text-rose-700 hover:border-rose-400 hover:bg-rose-50"
							>
								<i className="fas fa-trash text-xs" aria-hidden="true" />
								{seeding ? 'Deleting...' : 'Delete Sample Appointments'}
							</button>
						</div>

						<div className="border-t border-slate-200 pt-4">
							<h3 className="mb-4 text-sm font-medium text-slate-700">Seed Individual Collections</h3>
							<div className="grid gap-4 sm:grid-cols-3">
								<div>
									<p className="mb-2 text-xs text-slate-500">Staff Members</p>
									<button
										type="button"
										onClick={handleSeedStaff}
										disabled={seeding}
										className="btn-secondary"
									>
										<i className="fas fa-users text-xs" aria-hidden="true" />
										Seed Staff ({dummyStaff.length})
									</button>
								</div>
								<div>
									<p className="mb-2 text-xs text-slate-500">Patients</p>
									<button
										type="button"
										onClick={handleSeedPatients}
										disabled={seeding}
										className="btn-secondary"
									>
										<i className="fas fa-user-injured text-xs" aria-hidden="true" />
										Seed Patients ({dummyPatients.length})
									</button>
								</div>
								<div>
									<p className="mb-2 text-xs text-slate-500">Appointments</p>
									<button
										type="button"
										onClick={handleSeedAppointments}
										disabled={seeding}
										className="btn-secondary"
									>
										<i className="fas fa-calendar-alt text-xs" aria-hidden="true" />
										Seed Appointments ({dummyAppointments.length})
									</button>
								</div>
							</div>
						</div>
					</div>
					</div>
				</section>

				{progress && (
					<div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
						<div className="flex items-center gap-3">
							{seeding && (
								<div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-sky-500" />
							)}
							<p className="text-sm text-slate-700">{progress}</p>
						</div>
					</div>
				)}

				{results && (
					<div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
						<h3 className="mb-3 text-base font-semibold text-emerald-900">Seed Results</h3>
						<div className="grid gap-3 sm:grid-cols-3">
							<div>
								<p className="text-xs text-emerald-700">Staff Members</p>
								<p className="text-2xl font-bold text-emerald-900">{results.staff}</p>
							</div>
							<div>
								<p className="text-xs text-emerald-700">Patients</p>
								<p className="text-2xl font-bold text-emerald-900">{results.patients}</p>
							</div>
							<div>
								<p className="text-xs text-emerald-700">Appointments</p>
								<p className="text-2xl font-bold text-emerald-900">{results.appointments}</p>
							</div>
						</div>
					</div>
				)}

				<section className="section-card">
					<h2 className="mb-4 text-lg font-semibold text-slate-900">Data Preview</h2>
					<div className="space-y-4">
						<div>
							<h3 className="mb-2 text-sm font-medium text-slate-700">Staff ({dummyStaff.length})</h3>
							<div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
								{dummyStaff.map((staff, idx) => (
									<div key={idx} className="mb-1">
										{staff.userName} - {staff.role}
									</div>
								))}
							</div>
						</div>
						<div>
							<h3 className="mb-2 text-sm font-medium text-slate-700">Patients ({dummyPatients.length})</h3>
							<div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
								{dummyPatients.map((patient, idx) => (
									<div key={idx} className="mb-1">
										{patient.name} ({patient.patientId}) - {patient.status}
									</div>
								))}
							</div>
						</div>
						<div>
							<h3 className="mb-2 text-sm font-medium text-slate-700">Appointments ({dummyAppointments.length})</h3>
							<div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
								{dummyAppointments.map((appointment, idx) => (
									<div key={idx} className="mb-1">
										{appointment.appointmentId}: {appointment.patient} with {appointment.doctor} on {appointment.date}
									</div>
								))}
							</div>
						</div>
					</div>
				</section>
			</div>
		</div>
	);
}

