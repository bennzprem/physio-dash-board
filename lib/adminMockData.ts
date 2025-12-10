export type AdminRoleOption = 'Admin' | 'FrontDesk' | 'ClinicalTeam';
export type AdminStatusOption = 'Active' | 'Inactive';

export interface AdminUserRecord {
	userName: string;
	userEmail: string;
	userPassword: string;
	userRole: AdminRoleOption;
	userStatus: AdminStatusOption;
	createdAt: string;
}

export const DEFAULT_ADMIN_USERS: AdminUserRecord[] = [
	{
		userName: 'Samantha Hyperion',
		userEmail: 'samantha.hyperion@example.com',
		userPassword: '••••••••',
		userRole: 'FrontDesk',
		userStatus: 'Active',
		createdAt: new Date('2024-02-19').toISOString(),
	},
	{
		userName: 'Martin Willow',
		userEmail: 'martin.willow@example.com',
		userPassword: '••••••••',
	userRole: 'ClinicalTeam',
		userStatus: 'Active',
		createdAt: new Date('2024-01-12').toISOString(),
	},
	{
		userName: 'Avery Collins',
		userEmail: 'avery.collins@example.com',
		userPassword: '••••••••',
		userRole: 'FrontDesk',
		userStatus: 'Inactive',
		createdAt: new Date('2023-11-02').toISOString(),
	},
];

export type AdminGenderOption = 'Male' | 'Female' | 'Other' | '';

export type AdminPatientStatus = 'pending' | 'ongoing' | 'completed' | 'cancelled';

export interface AdminPatientRecord {
	patientId: string;
	name: string;
	dob: string;
	gender: AdminGenderOption;
	phone: string;
	email: string;
	address: string;
	complaint: string;
	status: AdminPatientStatus;
	registeredAt: string;
	totalSessionsRequired?: number;
	remainingSessions?: number;
	patientType?: string;
	// Additional fields from Firestore
	id?: string;
	deleted?: boolean;
	deletedAt?: string | null;
	assignedDoctor?: string;
	transferredFromDoctor?: string;
	transferReason?: string;
	feedback?: string;
}

export const DEFAULT_ADMIN_PATIENTS: AdminPatientRecord[] = [
	{
		patientId: 'PT-2024-001',
		name: 'Liam Harper',
		dob: '1990-04-12',
		gender: 'Male',
		phone: '+1 (312) 555-0198',
		email: 'liam.harper@example.com',
		address: '451 Grove Street, Chicago, IL',
		complaint: 'Shoulder impingement',
		status: 'ongoing',
		registeredAt: new Date('2024-02-14T09:24:00Z').toISOString(),
		patientType: '',
	},
	{
		patientId: 'PT-2024-002',
		name: 'Naomi Walters',
		dob: '1985-09-02',
		gender: 'Female',
		phone: '+1 (415) 555-0102',
		email: 'naomi.walters@example.com',
		address: '92 Ocean Ave, San Francisco, CA',
		complaint: 'ACL rehab follow-up',
		status: 'pending',
		registeredAt: new Date('2024-01-27T15:45:00Z').toISOString(),
		patientType: '',
	},
	{
		patientId: 'PT-2023-118',
		name: 'Miguel Ortiz',
		dob: '1997-11-30',
		gender: 'Male',
		phone: '+1 (786) 555-0159',
		email: 'miguel.ortiz@example.com',
		address: '763 Valencia Dr, Miami, FL',
		complaint: 'Hamstring strain',
		status: 'completed',
		registeredAt: new Date('2023-12-05T13:12:00Z').toISOString(),
		patientType: '',
	},
];

export type AdminAppointmentStatus = 'pending' | 'ongoing' | 'completed' | 'cancelled';

export interface AdminAppointmentRecord {
	appointmentId?: string;
	patientId: string;
	patient: string;
	doctor: string;
	date: string;
	time: string;
	status: AdminAppointmentStatus;
	notes?: string;
	billing?: {
		amount: string;
		date: string;
	};
	createdAt?: string;
}

export const DEFAULT_ADMIN_APPOINTMENTS: AdminAppointmentRecord[] = [
	{
		patientId: 'PT-2024-001',
		patient: 'Liam Harper',
		doctor: '',
		date: '2024-03-04',
		time: '09:30 AM',
		status: 'pending',
		billing: undefined,
	},
	{
		patientId: 'PT-2024-002',
		patient: 'Naomi Walters',
		doctor: 'Martin Willow',
		date: '2024-03-05',
		time: '01:15 PM',
		status: 'ongoing',
		billing: {
			amount: '3800.00',
			date: '2024-03-02',
		},
	},
	{
		patientId: 'PT-2023-118',
		patient: 'Miguel Ortiz',
		doctor: 'Martin Willow',
		date: '2024-02-28',
		time: '11:00 AM',
		status: 'completed',
		billing: {
			amount: '2200.00',
			date: '2024-02-28',
		},
	},
];


