import type { AdminGenderOption, AdminPatientStatus } from './adminMockData';

export interface User {
	userName: string;
	userEmail: string;
	userPassword: string;
	userRole: 'Admin' | 'FrontDesk' | 'ClinicalTeam';
	userStatus: 'Active' | 'Inactive';
	createdAt?: string;
}

export interface Patient {
	patientId: string;
	name: string;
	dob: string;
	gender: string;
	phone: string;
	email: string;
	address: string;
	status: 'pending' | 'ongoing' | 'completed';
	registeredAt: string;
	patientType?: string;
	sessionAllowance?: SessionAllowance | null;
	assignedFrontdeskId?: string;
	assignedFrontdeskName?: string;
	assignedFrontdeskEmail?: string;
}

export interface SessionAllowance {
	annualFreeSessionCap: number;
	freeSessionsUsed: number;
	pendingPaidSessions: number;
	pendingChargeAmount: number;
	nextResetAt: string;
	lastResetAt?: string | null;
	lastUpdatedAt?: string | null;
}

export interface PatientRecord {
	id: string;
	patientId: string;
	name: string;
	phone?: string;
	email?: string;
	// Session tracking fields
	totalSessionsRequired?: number;
	remainingSessions?: number;
	status?: AdminPatientStatus;
	assignedDoctor?: string;
	patientType?: string;
	sessionAllowance?: SessionAllowance | null;
	assignedFrontdeskId?: string;
	assignedFrontdeskName?: string;
	assignedFrontdeskEmail?: string;
}

export type PatientStatus = 'pending' | 'ongoing' | 'completed' | 'cancelled' | string;

export interface PatientRecordBasic {
	id: string;
	patientId?: string;
	name?: string;
	dob?: string;
	gender?: string;
	phone?: string;
	email?: string;
	address?: string;
	complaint?: string;
	status?: PatientStatus;
	assignedDoctor?: string;
	registeredAt?: string;
	// Session tracking fields
	totalSessionsRequired?: number;
	remainingSessions?: number;
	patientType?: string;
	sessionAllowance?: SessionAllowance | null;
	assignedFrontdeskId?: string;
	assignedFrontdeskName?: string;
	assignedFrontdeskEmail?: string;
}

export interface PatientRecordTransfer {
	id: string;
	patientId: string;
	name: string;
	assignedDoctor?: string;
	status: 'pending' | 'ongoing' | 'completed' | 'cancelled';
	assignedFrontdeskId?: string;
	assignedFrontdeskName?: string;
	assignedFrontdeskEmail?: string;
}

export interface PatientRecordFull {
	id: string;
	patientId: string;
	name: string;
	dob: string;
	gender: AdminGenderOption;
	phone?: string;
	email?: string;
	address?: string;
	complaint?: string;
	status: AdminPatientStatus;
	registeredAt: string;
	assignedDoctor?: string;
	patientType?: string;
	sessionAllowance?: SessionAllowance | null;
	assignedFrontdeskId?: string;
	assignedFrontdeskName?: string;
	assignedFrontdeskEmail?: string;
	// Report fields
	complaints?: string;
	presentHistory?: string;
	pastHistory?: string;
	med_xray?: boolean;
	med_mri?: boolean;
	med_report?: boolean;
	med_ct?: boolean;
	surgicalHistory?: string;
	per_smoking?: boolean;
	per_drinking?: boolean;
	per_alcohol?: boolean;
	per_drugs?: boolean;
	drugsText?: string;
	sleepCycle?: string;
	hydration?: string;
	nutrition?: string;
	siteSide?: string;
	onset?: string;
	duration?: string;
	natureOfInjury?: string;
	typeOfPain?: string;
	vasScale?: string;
	aggravatingFactor?: string;
	relievingFactor?: string;
	rom?: Record<string, any>;
	treatmentProvided?: string;
	progressNotes?: string;
	physioName?: string;
	physioId?: string;
	// New fields from the image form
	dateOfConsultation?: string;
	referredBy?: string;
	chiefComplaint?: string;
	onsetType?: 'Acute' | 'Chronic' | 'Post-surgical' | 'Traumatic';
	mechanismOfInjury?: string;
	painType?: string; // Sharp/Dull/Burning
	painIntensity?: string; // VAS/NPRS
	clinicalDiagnosis?: string;
	// Treatment Plan (table data)
	treatmentPlan?: Array<{
		therapy: string;
		frequency: string;
		remarks: string;
	}>;
	// Follow-Up Visits (table data)
	followUpVisits?: Array<{
		visitDate: string;
		painLevel: string;
		findings: string;
	}>;
	// Current Status
	currentPainStatus?: 'Improved' | 'Same' | 'Worsened';
	currentRom?: string; // "Improved by _*"
	currentStrength?: string; // "_% improvement noted"
	currentFunctionalAbility?: 'Improved' | 'Restricted';
	complianceWithHEP?: 'Excellent' | 'Moderate' | 'Poor';
	// Recommendations
	recommendations?: string;
	physiotherapistRemarks?: string;
	// New fields for On Observation
	built?: string;
	posture?: 'Manual' | 'Kinetisense';
	gaitAnalysis?: 'Manual' | 'OptaGAIT';
	mobilityAids?: string;
	localObservation?: string;
	swelling?: string;
	muscleWasting?: string;
	postureManualNotes?: string;
	postureFileName?: string;
	postureFileData?: string;
	gaitManualNotes?: string;
	gaitFileName?: string;
	gaitFileData?: string;
	// New fields for On Palpation
	tenderness?: string;
	warmth?: string;
	scar?: string;
	crepitus?: string;
	odema?: string;
	// Manual Muscle Testing
	mmt?: Record<string, any>;
	// Special assessments & diagnoses
	specialTest?: string;
	differentialDiagnosis?: string;
	finalDiagnosis?: string;
	// Physiotherapy management
	shortTermGoals?: string;
	longTermGoals?: string;
	rehabProtocol?: string;
	advice?: string;
	managementRemarks?: string;
	nextFollowUpDate?: string;
	nextFollowUpTime?: string;
	// Session tracking fields
	totalSessionsRequired?: number;
	remainingSessions?: number;
}

export interface Appointment {
	patientId: string;
	patient: string;
	doctor: string;
	date: string;
	time: string;
	status: 'pending' | 'ongoing' | 'completed' | 'cancelled';
	notes?: string;
	createdAt: string;
	isConsultation?: boolean; // True for the first appointment, only created from front desk
}

export interface BillingRecord {
	billingId: string;
	appointmentId: string;
	patient: string;
	amount: number;
	packageAmount?: number;
	concessionPercent?: number;
	amountPaid?: number;
	status: 'pending' | 'completed';
	date: string;
}

export type NotificationCategory =
	| 'appointment'
	| 'reminder'
	| 'system'
	| 'patient'
	| 'billing'
	| 'birthday'
	| 'feedback'
	| 'other';

export type NotificationStatus = 'unread' | 'read';

export interface NotificationChannelSettings {
	email: boolean;
	sms: boolean;
	whatsapp: boolean;
	inApp: boolean;
}

export interface NotificationMessage {
	id: string;
	senderId: string;
	senderName: string;
	message: string;
	createdAt: string;
}

export interface NotificationRecord {
	id: string;
	userId: string;
	title: string;
	message: string;
	category: NotificationCategory;
	status: NotificationStatus;
	createdAt: string;
	readAt?: string | null;
	metadata?: Record<string, unknown>;
	channels?: Partial<NotificationChannelSettings>;
	acknowledgedBy?: string[];
	source?: string;
	threadId?: string; // For grouping messages in a conversation
	messages?: NotificationMessage[]; // Array of messages in the thread
	fromUserId?: string; // ID of the user who sent the initial message
	fromUserName?: string; // Name of the user who sent the initial message
}

export interface NotificationPreference {
	userId: string;
	channels: NotificationChannelSettings;
	reminderLeadTimeHours: number;
	digestEnabled: boolean;
	updatedAt: string;
}

