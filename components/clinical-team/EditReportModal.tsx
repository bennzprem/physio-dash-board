'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { collection, doc, query, where, getDocs, onSnapshot, orderBy, updateDoc, addDoc, setDoc, deleteDoc, serverTimestamp, writeBatch, type Timestamp, type QuerySnapshot } from 'firebase/firestore';
import { db, storage } from '@/lib/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useAuth } from '@/contexts/AuthContext';
import { generatePhysiotherapyReportPDF, generateStrengthConditioningPDF, generatePsychologyPDF, type StrengthConditioningData, type PsychologyReportPDFData, type ReportSection } from '@/lib/pdfGenerator';
import type { PatientRecordFull } from '@/lib/types';
import { recordSessionUsageForAppointment } from '@/lib/sessionAllowanceClient';
import { createDYESBilling } from '@/lib/dyesBilling';
import { getHeaderConfig, getDefaultHeaderConfig } from '@/lib/headerConfig';
import type { HeaderConfig } from '@/components/admin/HeaderManagement';
import ExerciseLibrarySelector from '@/components/clinical-team/ExerciseLibrarySelector';
import SpecialTestsLibrarySelector from '@/components/clinical-team/SpecialTestsLibrarySelector';
import PsychologyReport from '@/components/clinical-team/PsychologyReport';

// Constants
const VAS_EMOJIS = ['😀','😁','🙂','😊','😌','😟','😣','😢','😭','😱'];
const HYDRATION_EMOJIS = ['😄','😃','🙂','😐','😕','😟','😢','😭'];

const ROM_MOTIONS: Record<string, Array<{ motion: string }>> = {
	Neck: [
		{ motion: 'Flexion' }, 
		{ motion: 'Extension' }, 
		{ motion: 'Lateral Flexion Left' }, 
		{ motion: 'Lateral Flexion Right' }
	],
	Hip: [
		{ motion: 'Flexion' },
		{ motion: 'Extension' },
		{ motion: 'Abduction' },
		{ motion: 'Adduction' },
		{ motion: 'Internal Rotation' },
		{ motion: 'External Rotation' },
	],
	Shoulder: [
		{ motion: 'Flexion' },
		{ motion: 'Extension' },
		{ motion: 'Abduction' },
		{ motion: 'Adduction' },
		{ motion: 'Internal Rotation' },
		{ motion: 'External Rotation' },
	],
	Elbow: [{ motion: 'Flexion' }, { motion: 'Extension' }],
	Forearm: [{ motion: 'Supination' }, { motion: 'Pronation' }],
	Wrist: [
		{ motion: 'Flexion' },
		{ motion: 'Extension' },
		{ motion: 'Radial Deviation' },
		{ motion: 'Ulnar Deviation' },
	],
	Knee: [{ motion: 'Flexion' }, { motion: 'Extension' }],
	Ankle: [
		{ motion: 'Dorsiflexion' },
		{ motion: 'Plantarflexion' },
		{ motion: 'Inversion' },
		{ motion: 'Eversion' },
	],
	'Tarsal Joint': [{ motion: 'Flexion' }, { motion: 'Extension' }],
	Finger: [{ motion: 'Flexion' }, { motion: 'Extension' }],
};

const ROM_HAS_SIDE: Record<string, boolean> = {
	Hip: true,
	Shoulder: true,
	Elbow: true,
	Forearm: true,
	Wrist: true,
	Knee: true,
	Ankle: true,
	'Tarsal Joint': true,
	Finger: true,
};

const ROM_JOINTS = Object.keys(ROM_MOTIONS);

const MOTION_TO_MMT: Record<string, string> = {
	Flexion: 'Flexors',
	Extension: 'Extensors',
	Abduction: 'Abductors',
	Adduction: 'Adductors',
	'Dorsiflexion': 'Dorsiflexors',
	'Plantarflexion': 'Plantarflexors',
	'Radial Deviation': 'Radial Deviators',
	'Ulnar Deviation': 'Ulnar Deviators',
	Inversion: 'Invertors',
	Eversion: 'Evertors',
	'Supination': 'Supinators',
	'Pronation': 'Pronators',
	'Internal Rotation': 'Internal Rotators',
	'External Rotation': 'External Rotators',
	'Lateral Flexion Left': 'Left Lateral Flexors',
	'Lateral Flexion Right': 'Right Lateral Flexors',
	'Flexion Left': 'Left Flexors',
	'Flexion Right': 'Right Flexors',
	'Extension Left': 'Left Extensors',
	'Extension Right': 'Right Extensors',
	FlexionLeft: 'Left Flexors',
	FlexionRight: 'Right Flexors',
	FlexionLeftRight: 'Lateral Flexors',
	FingerFlexion: 'Finger Flexors',
	FingerExtension: 'Finger Extensors',
};

// Helper functions
function removeUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
	if (!obj || typeof obj !== 'object') {
		return obj as any;
	}
	
	const cleaned: Partial<T> = {};
	for (const key in obj) {
		if (!obj.hasOwnProperty(key)) continue;
		
		const value: any = obj[key];
		
		// Skip undefined values
		if (value === undefined) {
			continue;
		}
		
		// Handle null values (keep them)
		if (value === null) {
			cleaned[key] = null as any;
			continue;
		}
		
		// Handle arrays - clean each element if it's an object
		if (Array.isArray(value)) {
			const cleanedArray = value.map((item: any) => {
				if (item !== null && typeof item === 'object' && !(item instanceof Date)) {
					return removeUndefined(item);
				}
				return item;
			}).filter((item: any) => item !== undefined);
			if (cleanedArray.length > 0) {
				cleaned[key] = cleanedArray as any;
			}
			continue;
		}
		
		// Handle Date objects (keep them as-is)
		if (value instanceof Date) {
			cleaned[key] = value as any;
			continue;
		}
		
		// Handle nested objects recursively
		if (typeof value === 'object') {
			const cleanedNested = removeUndefined(value as Record<string, any>);
			// Only include if nested object has at least one property
			if (Object.keys(cleanedNested).length > 0) {
				cleaned[key] = cleanedNested as any;
			}
			continue;
		}
		
		// Handle primitive values
		cleaned[key] = value;
	}
	return cleaned;
}

function deriveCurrentSessionRemaining(
	totalSessionsRequired?: number,
	storedRemaining?: number
) {
	const hasValidTotal =
		typeof totalSessionsRequired === 'number' && !Number.isNaN(totalSessionsRequired);
	if (!hasValidTotal) return storedRemaining;
	if (typeof storedRemaining !== 'number' || Number.isNaN(storedRemaining)) {
		return totalSessionsRequired;
	}
	return storedRemaining;
}

function applyCurrentSessionAdjustments(patient: PatientRecordFull) {
	const adjustedRemaining = deriveCurrentSessionRemaining(
		patient.totalSessionsRequired,
		patient.remainingSessions
	);
	if (adjustedRemaining === undefined) {
		return patient;
	}
	return { ...patient, remainingSessions: adjustedRemaining };
}

async function markAppointmentCompletedForReport(
	patient: PatientRecordFull,
	reportDate?: string,
	isExtraTreatment?: boolean
) {
	if (!patient?.patientId) return;

	try {
		const constraints: any[] = [
			where('patientId', '==', patient.patientId),
			where('status', 'in', ['pending', 'ongoing']),
		];

		if (reportDate) {
			constraints.push(where('date', '==', reportDate));
		} else {
			constraints.push(orderBy('date', 'desc'), orderBy('time', 'desc'));
		}

		const appointmentQuery = query(collection(db, 'appointments'), ...constraints);
		const snapshot = await getDocs(appointmentQuery);
		if (snapshot.empty) {
			return;
		}

		const appointmentDoc = snapshot.docs[0];
		await updateDoc(appointmentDoc.ref, { 
			status: 'completed',
			isExtraTreatment: isExtraTreatment || false,
		});

		if (patient.id) {
			try {
				await recordSessionUsageForAppointment({
					patientDocId: patient.id,
					patientType: patient.patientType,
					appointmentId: appointmentDoc.id,
				});
			} catch (sessionError) {
				console.error('Failed to record session usage after report save', sessionError);
			}

			// Automatically create billing for DYES patients
			const patientType = (patient.patientType || '').toUpperCase();
			if (patientType === 'DYES' || patientType === 'DYES') {
				try {
					const appointmentData = appointmentDoc.data();
					await createDYESBilling({
						appointmentId: appointmentData.appointmentId || appointmentDoc.id,
						appointmentDocId: appointmentDoc.id,
						patientId: patient.patientId,
						patientName: patient.name || '',
						doctorName: appointmentData.doctor || '',
						appointmentDate: appointmentData.date || reportDate || '',
						createdByUserId: null,
						createdByUserName: null,
						isExtraTreatment: isExtraTreatment || false,
					});
				} catch (billingError) {
					console.error('Failed to create automatic DYES billing:', billingError);
				}
			}
		}

		// Check if all appointments for this patient are completed and update patient status
		const allAppointmentsQuery = query(
			collection(db, 'appointments'),
			where('patientId', '==', patient.patientId)
		);
		const allAppointmentsSnapshot = await getDocs(allAppointmentsQuery);
		
		if (!allAppointmentsSnapshot.empty) {
			const allAppointments = allAppointmentsSnapshot.docs.map(doc => ({
				id: doc.id,
				...doc.data()
			}));
			
			// Check if all appointments are completed or cancelled
			const allCompleted = allAppointments.every((apt: any) => 
				apt.status === 'completed' || apt.status === 'cancelled'
			);
			
			if (allCompleted && patient.status !== 'completed' && patient.id) {
				const patientRef = doc(db, 'patients', patient.id);
				await updateDoc(patientRef, {
					status: 'completed',
				});
			}
		}
	} catch (error) {
		console.error('Failed to auto-complete appointment after report save', error);
	}
}

async function refreshPatientSessionProgress(
	patient: PatientRecordFull,
	totalOverride?: number | null
) {
	if (!patient?.id || !patient.patientId) return null;

	const totalRequired =
		typeof totalOverride === 'number'
			? totalOverride
			: typeof patient.totalSessionsRequired === 'number'
				? patient.totalSessionsRequired
				: null;

	if (totalRequired === null) return null;

	try {
		const completedQuery = query(
			collection(db, 'appointments'),
			where('patientId', '==', patient.patientId),
			where('status', '==', 'completed')
		);
		const completedSnapshot = await getDocs(completedQuery);
		const completedCount = completedSnapshot.size;
		// remainingSessions = totalSessionsRequired - completedCount
		const remainingSessions = Math.max(0, totalRequired - completedCount);

		const updates: Partial<PatientRecordFull> = {
			remainingSessions,
			updatedAt: serverTimestamp(),
		};

		if (remainingSessions === 0) {
			updates.status = 'completed';
		}

		const patientRef = doc(db, 'patients', patient.id);
		await updateDoc(patientRef, updates);

		return updates;
	} catch (error) {
		console.error('Failed to refresh patient session progress', error);
		return null;
	}
}

// Helper functions for report display
function getMedicalHistoryText(p: any): string {
	const items: string[] = [];
	if (p.med_xray) items.push('X RAYS');
	if (p.med_mri) items.push('MRI');
	if (p.med_report) items.push('Reports');
	if (p.med_ct) items.push('CT Scans');
	return items.join(', ') || 'N/A';
}

function getPersonalHistoryText(p: any): string {
	const items: string[] = [];
	if (p.per_smoking) items.push('Smoking');
	if (p.per_drinking) items.push('Drinking');
	if (p.per_alcohol) items.push('Alcohol');
	if (p.per_drugs) {
		items.push('Drugs: ' + (p.drugsText || ''));
	}
	return items.join(', ') || 'N/A';
}

function renderRomView(romData: Record<string, any> | undefined) {
	if (!romData || !Object.keys(romData).length) {
		return <p className="text-sm italic text-slate-500">No ROM joints recorded.</p>;
	}

	return (
		<div className="space-y-4">
			{Object.keys(romData).map(joint => (
				<div key={joint} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
					<h6 className="mb-3 text-sm font-semibold text-sky-600">{joint}</h6>
					{renderRomTable(joint, romData[joint])}
				</div>
			))}
		</div>
	);
}

function renderRomTable(joint: string, data: any) {
	if (!ROM_HAS_SIDE[joint]) {
		return (
			<table className="min-w-full divide-y divide-slate-200 border border-slate-300 text-left text-sm">
				<thead className="bg-slate-100">
					<tr>
						<th className="px-3 py-2 font-semibold text-slate-700">Motion</th>
						<th className="px-3 py-2 font-semibold text-slate-700">Value</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-slate-200 bg-white">
					{ROM_MOTIONS[joint]?.map(({ motion }) => {
						const val = data[motion];
						if (!val) return null;
						return (
							<tr key={motion}>
								<td className="px-3 py-2 text-slate-700">{motion}</td>
								<td className="px-3 py-2 font-medium text-slate-900">{val}</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		);
	}

	return (
		<table className="min-w-full divide-y divide-slate-200 border border-slate-300 text-left text-sm">
			<thead className="bg-slate-100">
				<tr>
					<th colSpan={2} className="px-3 py-2 text-center font-semibold text-slate-700">
						Left
					</th>
					<th colSpan={2} className="px-3 py-2 text-center font-semibold text-slate-700">
						Right
					</th>
				</tr>
				<tr>
					<th className="px-3 py-2 font-semibold text-slate-700">Motion</th>
					<th className="px-3 py-2 font-semibold text-slate-700">Value</th>
					<th className="px-3 py-2 font-semibold text-slate-700">Motion</th>
					<th className="px-3 py-2 font-semibold text-slate-700">Value</th>
				</tr>
			</thead>
			<tbody className="divide-y divide-slate-200 bg-white">
				{ROM_MOTIONS[joint]?.map(({ motion }) => {
					const lv = data.left?.[motion] || '';
					const rv = data.right?.[motion] || '';
					if (!lv && !rv) return null;
					return (
						<tr key={motion}>
							<td className="px-3 py-2 text-slate-700">{motion}</td>
							<td className="px-3 py-2 font-medium text-slate-900">{lv}</td>
							<td className="px-3 py-2 text-slate-700">{motion}</td>
							<td className="px-3 py-2 font-medium text-slate-900">{rv}</td>
						</tr>
					);
				})}
			</tbody>
		</table>
	);
}

function renderMmtView(mmtData: Record<string, any> | undefined) {
	if (!mmtData || !Object.keys(mmtData).length) {
		return <p className="text-sm italic text-slate-500">No MMT data recorded.</p>;
	}

	return (
		<div className="space-y-4">
			{Object.keys(mmtData).map((muscle) => {
				const muscleData = mmtData[muscle];
				if (!muscleData) return null;

				if (typeof muscleData === 'object' && muscleData !== null && (muscleData.left || muscleData.right)) {
					return (
						<div key={muscle} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
							<h6 className="mb-3 text-sm font-semibold text-sky-600">{muscle}</h6>
							<div className="grid grid-cols-2 gap-4">
								<div>
									<p className="text-xs font-medium text-slate-500 mb-1">Left</p>
									<p className="text-sm text-slate-900">{muscleData.left || '—'}</p>
								</div>
								<div>
									<p className="text-xs font-medium text-slate-500 mb-1">Right</p>
									<p className="text-sm text-slate-900">{muscleData.right || '—'}</p>
								</div>
							</div>
						</div>
					);
				}

				return (
					<div key={muscle} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
						<h6 className="mb-2 text-sm font-semibold text-sky-600">{muscle}</h6>
						<p className="text-sm text-slate-900">{String(muscleData) || '—'}</p>
					</div>
				);
			})}
		</div>
	);
}

interface EditReportModalProps {
	isOpen: boolean;
	patientId: string | null;
	initialTab?: 'report' | 'strength-conditioning' | 'psychology';
	onClose: () => void;
	editable?: boolean; // If true, fields are editable; if false, read-only (for frontdesk)
}

export default function EditReportModal({ isOpen, patientId, initialTab = 'report', onClose, editable = true }: EditReportModalProps) {
	const { user } = useAuth();
	const [activeReportTab, setActiveReportTab] = useState<'report' | 'strength-conditioning' | 'psychology'>(initialTab as 'report' | 'strength-conditioning' | 'psychology');
	const [reportPatientData, setReportPatientData] = useState<any>(null);
	const [strengthConditioningData, setStrengthConditioningData] = useState<any>(null);
	const [psychologyData, setPsychologyData] = useState<any>(null);
	const [currentDate, setCurrentDate] = useState<string>('');

	// Set current date only on client to avoid hydration mismatch
	useEffect(() => {
		setCurrentDate(new Date().toLocaleDateString());
	}, []);
	const [strengthConditioningFormData, setStrengthConditioningFormData] = useState<StrengthConditioningData>({});
	const [psychologyFormData, setPsychologyFormData] = useState<any>({});
	const [clinicalTeamMembers, setClinicalTeamMembers] = useState<Array<{ id: string; userName: string; userEmail?: string }>>([]);
	const [loadingReport, setLoadingReport] = useState(false);
	const [loadingStrengthConditioning, setLoadingStrengthConditioning] = useState(false);
	const [loadingPsychology, setLoadingPsychology] = useState(false);
	const [savingStrengthConditioning, setSavingStrengthConditioning] = useState(false);
	const [savedStrengthConditioningMessage, setSavedStrengthConditioningMessage] = useState(false);
	const [savingPsychology, setSavingPsychology] = useState(false);
	const [savedPsychologyMessage, setSavedPsychologyMessage] = useState(false);
	const psychologyUnsubscribeRef = useRef<(() => void) | null>(null);
	const [uploadingPdf, setUploadingPdf] = useState(false);
	const [uploadedPdfUrl, setUploadedPdfUrl] = useState<string | null>(null);
	const strengthConditioningUnsubscribeRef = useRef<(() => void) | null>(null);
	const patientUnsubscribeRef = useRef<(() => void) | null>(null);
	const reportVersionsUnsubscribeRef = useRef<(() => void) | null>(null);
	
	// Form state
	const [patientDocId, setPatientDocId] = useState<string | null>(null);
	const [formData, setFormData] = useState<Partial<PatientRecordFull>>({});
	const [saving, setSaving] = useState(false);
	const [savedMessage, setSavedMessage] = useState(false);
	const [selectedRomJoint, setSelectedRomJoint] = useState('');
	const [selectedMmtJoint, setSelectedMmtJoint] = useState('');
	const [sessionCompleted, setSessionCompleted] = useState(false);
	const [isPhysioNameEditable, setIsPhysioNameEditable] = useState(false);
	const romFileInputRef = useRef<HTMLInputElement>(null);
	const mmtFileInputRef = useRef<HTMLInputElement>(null);
	const [romImages, setRomImages] = useState<Record<string, { data: string; fileName: string }>>({});
	const [mmtImages, setMmtImages] = useState<Record<string, { data: string; fileName: string }>>({});
	const [headerConfig, setHeaderConfig] = useState<HeaderConfig | null>(null);
	
	// Version history state
	const [showVersionHistory, setShowVersionHistory] = useState(false);
	const [versionHistory, setVersionHistory] = useState<Array<{
		id: string;
		version: number;
		createdAt: string;
		createdBy: string;
		data: Partial<PatientRecordFull> | StrengthConditioningData | any;
		isStrengthConditioning?: boolean;
		isPsychology?: boolean;
	}>>([]);
	const [loadingVersions, setLoadingVersions] = useState(false);
	const [viewingVersionData, setViewingVersionData] = useState<Partial<PatientRecordFull> | StrengthConditioningData | null>(null);
	const [viewingVersionIsStrengthConditioning, setViewingVersionIsStrengthConditioning] = useState(false);
	const [viewingVersionIsPsychology, setViewingVersionIsPsychology] = useState(false);
	const [viewingPsychologyVersionData, setViewingPsychologyVersionData] = useState<any | null>(null);
	const [psychologyFormDataKey, setPsychologyFormDataKey] = useState(0); // Key to force re-render when loading version data
	const [isEditingLoadedPsychologyVersion, setIsEditingLoadedPsychologyVersion] = useState(false); // True when form was loaded from version via Edit
	const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null);
	const [hasPsychologyVersions, setHasPsychologyVersions] = useState(false);
	const [hasPhysiotherapyVersions, setHasPhysiotherapyVersions] = useState(false);
	const [hasStrengthConditioningVersions, setHasStrengthConditioningVersions] = useState(false);
	const [isExtraTreatment, setIsExtraTreatment] = useState(false);
	
	// Crisp report state
	const [showCrispReportModal, setShowCrispReportModal] = useState(false);
	const [selectedSections, setSelectedSections] = useState<ReportSection[]>([
		'patientInformation',
		'assessmentOverview',
		'painAssessment',
		'onObservation',
		'onPalpation',
		'rom',
		'mmt',
		'advancedAssessment',
		'physiotherapyManagement',
		'followUpVisits',
		'currentStatus',
		'nextFollowUp',
		'signature',
	]);

	// Subsequent date detection state
	const [isSubsequentDatePhysio, setIsSubsequentDatePhysio] = useState(false);
	const [isSubsequentDateStrength, setIsSubsequentDateStrength] = useState(false);
	
	// Session versioning state
	const [sessionNumber, setSessionNumber] = useState<number | null>(null);
	const [firstReportDate, setFirstReportDate] = useState<string | null>(null);
	const [isEditingSession1, setIsEditingSession1] = useState(false);

	// Helper function to check if a date is on a different day than today
	const isDateOnDifferentDay = (reportDate: Date | string | null | undefined): boolean => {
		if (!reportDate) return false;
		
		const report = typeof reportDate === 'string' ? new Date(reportDate) : reportDate;
		const today = new Date();
		
		if (isNaN(report.getTime())) return false;
		
		// Set both to start of day for comparison
		report.setHours(0, 0, 0, 0);
		today.setHours(0, 0, 0, 0);
		
		// Return true if report date is after today (subsequent date scenario)
		return report.getTime() > today.getTime();
	};

	// Helper function to get session number and first report date
	const getSessionInfo = async (patientId: string): Promise<{ sessionNumber: number; firstReportDate: string | null }> => {
		try {
			// Try to get report versions with orderBy, filtered by reportType = 'physiotherapy'
			let versionsQuery = query(
				collection(db, 'reportVersions'),
				where('patientId', '==', patientId),
				where('reportType', '==', 'physiotherapy')
			);
			
			let versionsSnapshot;
			try {
				versionsQuery = query(versionsQuery, orderBy('version', 'asc'));
				versionsSnapshot = await getDocs(versionsQuery);
			} catch {
				// If orderBy or reportType filter fails, try without reportType filter (for backward compatibility)
				try {
					versionsQuery = query(
						collection(db, 'reportVersions'),
						where('patientId', '==', patientId)
					);
					try {
						versionsQuery = query(versionsQuery, orderBy('version', 'asc'));
					} catch {
						// If orderBy fails, we'll sort manually
					}
					versionsSnapshot = await getDocs(versionsQuery);
					// Filter by reportType in memory for backward compatibility
					versionsSnapshot = {
						...versionsSnapshot,
						docs: versionsSnapshot.docs.filter(doc => {
							const data = doc.data();
							return data.reportType === 'physiotherapy' || !data.reportType;
						})
					} as QuerySnapshot;
				} catch (fallbackError) {
					// If everything fails, return session 1
					return { sessionNumber: 1, firstReportDate: null };
				}
			}
			
			if (versionsSnapshot.empty) {
				// No reports exist - this will be Session 1
				return { sessionNumber: 1, firstReportDate: null };
			}
			
			// Get all versions and sort by version number (for retroactive compatibility)
			const versions = versionsSnapshot.docs.map(doc => {
				const data = doc.data();
				const reportData = data.reportData || {};
				const createdAt = (data.createdAt as Timestamp | undefined)?.toDate?.();
				return {
					version: (data.version as number) || 0,
					dateOfConsultation: reportData.dateOfConsultation as string | undefined,
					createdAt: createdAt ? createdAt.toISOString() : null,
				};
			});
			
			// Sort by version number (ascending)
			versions.sort((a, b) => a.version - b.version);
			
			// Find the first report (Session 1) - look for version 1 or the oldest by date
			let firstReport = versions.find(v => v.version === 1);
			if (!firstReport && versions.length > 0) {
				// Retroactive compatibility: Find oldest report by date
				const versionsWithDates = versions
					.map(v => ({
						...v,
						date: v.dateOfConsultation || v.createdAt,
					}))
					.filter(v => v.date)
					.sort((a, b) => {
						const dateA = new Date(a.date!).getTime();
						const dateB = new Date(b.date!).getTime();
						return dateA - dateB;
					});
				
				if (versionsWithDates.length > 0) {
					firstReport = versionsWithDates[0];
				} else {
					firstReport = versions[0];
				}
			}
			
			const firstReportDate = firstReport?.dateOfConsultation || firstReport?.createdAt?.split('T')[0] || null;
			
			// Get the highest session number
			const maxSessionNumber = Math.max(...versions.map(v => v.version || 0), 0);
			
			// Next session number
			const nextSessionNumber = maxSessionNumber + 1;
			
			return { sessionNumber: nextSessionNumber, firstReportDate };
		} catch (error) {
			console.error('Error getting session info:', error);
			// Default to Session 1 if there's an error
			return { sessionNumber: 1, firstReportDate: null };
		}
	};

	// Computed values
	const displayedRemainingSessions = useMemo(() => {
		const baseRemaining = 
			typeof reportPatientData?.remainingSessions === 'number'
				? reportPatientData.remainingSessions
				: typeof reportPatientData?.totalSessionsRequired === 'number'
					? reportPatientData.totalSessionsRequired
					: undefined;
		
		if (baseRemaining === undefined) return undefined;
		
		return sessionCompleted ? Math.max(0, baseRemaining - 1) : baseRemaining;
	}, [reportPatientData?.remainingSessions, reportPatientData?.totalSessionsRequired, sessionCompleted]);
	
	const vasValue = Number(formData.vasScale || '5');
	const vasEmoji = VAS_EMOJIS[Math.min(VAS_EMOJIS.length - 1, Math.max(1, vasValue) - 1)];
	const hydrationValue = Number(formData.hydration || '4');
	const hydrationEmoji =
		HYDRATION_EMOJIS[Math.min(HYDRATION_EMOJIS.length - 1, Math.max(1, hydrationValue) - 1)];

	// Update active tab when initialTab changes (when modal opens with different tab)
	useEffect(() => {
		if (isOpen) {
			// Always update the tab when modal opens or initialTab changes
			const tabToSet = (initialTab || 'report') as 'report' | 'strength-conditioning' | 'psychology';
			setActiveReportTab(tabToSet);
		}
	}, [isOpen, initialTab]);

		// Reset state when modal closes
		useEffect(() => {
			if (!isOpen) {
				setReportPatientData(null);
				setStrengthConditioningData(null);
				setPsychologyData(null);
				setViewingVersionData(null);
				setViewingVersionIsPsychology(false);
				setViewingPsychologyVersionData(null);
				setPsychologyFormDataKey(0);
				setIsEditingLoadedPsychologyVersion(false);
				setActiveReportTab(initialTab);
				setIsSubsequentDatePhysio(false);
				setIsSubsequentDateStrength(false);
				setSessionCompleted(false);
				setSessionNumber(null);
				setFirstReportDate(null);
				setIsEditingSession1(false);
				setLoadingReport(false);
				setLoadingStrengthConditioning(false);
				setLoadingPsychology(false);
				if (strengthConditioningUnsubscribeRef.current) {
					strengthConditioningUnsubscribeRef.current();
					strengthConditioningUnsubscribeRef.current = null;
				}
				if (psychologyUnsubscribeRef.current) {
					psychologyUnsubscribeRef.current();
					psychologyUnsubscribeRef.current = null;
				}
				if (patientUnsubscribeRef.current) {
					patientUnsubscribeRef.current();
					patientUnsubscribeRef.current = null;
				}
				if (reportVersionsUnsubscribeRef.current) {
					reportVersionsUnsubscribeRef.current();
					reportVersionsUnsubscribeRef.current = null;
				}
			}
		}, [isOpen, initialTab]);

	// Load data when modal opens
	useEffect(() => {
		if (!isOpen || !patientId) return;

		const loadData = async () => {
			setLoadingReport(true);
			setLoadingStrengthConditioning(true);
			setLoadingPsychology(true);
			setReportPatientData(null);
			setStrengthConditioningData(null);
			setPsychologyData(null);
			setFormData({});

			// Get patient document ID first (single query)
			let patientDocId: string | null = null;
			let documentId: string | null = null;
			
			try {
				const patientSnap = await getDocs(query(collection(db, 'patients'), where('patientId', '==', patientId)));
				if (!patientSnap.empty) {
					const patientDoc = patientSnap.docs[0];
					patientDocId = patientDoc.id;
					documentId = patientDocId || patientId;
					setPatientDocId(patientDocId);
					
					// Set up real-time listener for patient document
					const patientRef = doc(db, 'patients', patientDocId);
					
					// Set initial patient data from the snapshot we already have
					const initialPatientData = patientDoc.data() as PatientRecordFull;
					setReportPatientData(initialPatientData);
					setLoadingReport(false);
					
					const unsubscribePatient = onSnapshot(patientRef, (docSnap) => {
						try {
							if (docSnap.exists()) {
								const patientData = docSnap.data() as PatientRecordFull;
								
								// Only update if user is not actively editing (formData is empty or matches current data)
								// This prevents overwriting user's unsaved changes
								const isUserEditing = Object.keys(formData).length > 0 && 
									JSON.stringify(formData) !== JSON.stringify(reportPatientData);
								
								if (!isUserEditing || !editable) {
									setReportPatientData(patientData);
									
									// Check if it's a subsequent date for Physiotherapy report
									if (patientData.dateOfConsultation) {
										setIsSubsequentDatePhysio(isDateOnDifferentDay(patientData.dateOfConsultation));
									} else if (patientData.updatedAt) {
										const updatedDate = (patientData.updatedAt as any)?.toDate ? (patientData.updatedAt as any).toDate() : new Date(patientData.updatedAt);
										if (!isNaN(updatedDate.getTime())) {
											setIsSubsequentDatePhysio(isDateOnDifferentDay(updatedDate));
										} else {
											setIsSubsequentDatePhysio(false);
										}
									} else {
										setIsSubsequentDatePhysio(false);
									}
									
									// Initialize formData with patient data if editable and form is empty
									if (editable && Object.keys(formData).length === 0) {
										const adjustedData = applyCurrentSessionAdjustments(patientData);
										if (!adjustedData.dateOfConsultation) {
											adjustedData.dateOfConsultation = new Date().toISOString().split('T')[0];
										}
										if (!adjustedData.physioName && clinicalTeamMembers.length > 0) {
											const currentUserStaff = clinicalTeamMembers.find(m => m.userEmail === user?.email);
											adjustedData.physioName = currentUserStaff?.userName || user?.displayName || user?.email || '';
										}
										setFormData(adjustedData);
										setIsPhysioNameEditable(false);
									}
								}
							} else {
								setReportPatientData(null);
							}
						} catch (err) {
							console.error('Error processing patient data:', err);
						}
					}, (error) => {
						console.error('Error loading patient report:', error);
						setReportPatientData(null);
						setLoadingReport(false);
					});
					
					patientUnsubscribeRef.current = unsubscribePatient;
					
					// Load session info (use the data we already have)
					if (initialPatientData.patientId) {
						// Check for existing physiotherapy report versions first
						let hasPhysioVersions = false;
						try {
							let physioVersionsQuery = query(
								collection(db, 'reportVersions'),
								where('patientId', '==', initialPatientData.patientId),
								where('reportType', '==', 'physiotherapy')
							);
							try {
								const physioVersionsSnapshot = await getDocs(physioVersionsQuery);
								hasPhysioVersions = physioVersionsSnapshot.docs.length > 0;
								setHasPhysiotherapyVersions(hasPhysioVersions);
							} catch {
								// If reportType filter fails, try without it
								const fallbackQuery = query(
									collection(db, 'reportVersions'),
									where('patientId', '==', initialPatientData.patientId)
								);
								const fallbackSnapshot = await getDocs(fallbackQuery);
								hasPhysioVersions = fallbackSnapshot.docs.some(doc => {
									const data = doc.data();
									return data.reportType === 'physiotherapy' || !data.reportType;
								});
								setHasPhysiotherapyVersions(hasPhysioVersions);
							}
						} catch (err) {
							console.error('Error checking physiotherapy report versions:', err);
							setHasPhysiotherapyVersions(false);
						}
						
						const sessionInfo = await getSessionInfo(initialPatientData.patientId);
						setSessionNumber(sessionInfo.sessionNumber);
						setFirstReportDate(sessionInfo.firstReportDate);
						
						// Determine if we're editing Session 1
						// If no versions exist, it's Session 1
						if (!hasPhysioVersions && sessionInfo.sessionNumber === 1) {
							setIsEditingSession1(true);
							setSessionNumber(1);
						} else {
							const currentDate = initialPatientData.dateOfConsultation || new Date().toISOString().split('T')[0];
							if (sessionInfo.firstReportDate && currentDate === sessionInfo.firstReportDate) {
								setIsEditingSession1(true);
								setSessionNumber(1);
							} else if (!sessionInfo.firstReportDate && !hasPhysioVersions) {
								// No reports exist, this is Session 1
								setIsEditingSession1(true);
								setSessionNumber(1);
							} else {
								setIsEditingSession1(false);
							}
						}
						
						// Set up real-time listener for report versions
						// Only set up real-time listener for physiotherapy reports (activeReportTab === 'report')
						// Psychology and Strength & Conditioning have their own collections
						if (activeReportTab === 'report') {
							let versionsQuery = query(
								collection(db, 'reportVersions'),
								where('patientId', '==', initialPatientData.patientId),
								where('reportType', '==', 'physiotherapy')
							);
							
							try {
								versionsQuery = query(versionsQuery, orderBy('version', 'desc'));
							} catch {
								// If orderBy fails, continue without it
							}
							
							const unsubscribeVersions = onSnapshot(
								versionsQuery,
								(snapshot) => {
									const versions = snapshot.docs.map(doc => {
										const data = doc.data();
										const createdAt = (data.createdAt as Timestamp | undefined)?.toDate?.();
										return {
											id: doc.id,
											version: data.version as number,
											createdAt: createdAt ? createdAt.toISOString() : new Date().toISOString(),
											createdBy: (data.createdBy as string) || 'Unknown',
											data: (data.reportData as Partial<PatientRecordFull>) || {},
											isStrengthConditioning: false,
											isPsychology: false,
										};
									});
									
									// Only update if version history is currently being viewed
									if (showVersionHistory && activeReportTab === 'report') {
										setVersionHistory(versions);
									}
								},
								(error) => {
									// If orderBy or reportType filter fails (missing index), try without reportType filter
									if (error.code === 'failed-precondition' || error.message?.includes('index')) {
										const versionsQueryNoOrder = query(
											collection(db, 'reportVersions'),
											where('patientId', '==', initialPatientData.patientId)
										);
										
										onSnapshot(
											versionsQueryNoOrder,
											(snapshot) => {
												// Filter by reportType in memory for backward compatibility
												const versions = snapshot.docs
													.map(doc => {
														const data = doc.data();
														const createdAt = (data.createdAt as Timestamp | undefined)?.toDate?.();
														return {
															id: doc.id,
															version: data.version as number,
															createdAt: createdAt ? createdAt.toISOString() : new Date().toISOString(),
															createdBy: (data.createdBy as string) || 'Unknown',
															data: (data.reportData as Partial<PatientRecordFull>) || {},
															isStrengthConditioning: false,
															isPsychology: false,
															reportType: data.reportType || 'physiotherapy',
														};
													})
													.filter(v => v.reportType === 'physiotherapy' || !v.reportType); // Include old records without reportType
												versions.sort((a, b) => b.version - a.version);
												
												if (showVersionHistory && activeReportTab === 'report') {
													setVersionHistory(versions);
												}
											},
											(err) => console.error('Error loading report versions:', err)
										);
									} else {
										console.error('Error loading report versions:', error);
									}
								}
							);
							
							reportVersionsUnsubscribeRef.current = unsubscribeVersions;
						}
						
						// Load header config (one-time load)
						const patientType = initialPatientData.patientType || 'nonDYES';
						const headerType = patientType === 'DYES' ? 'reportDYES' : 'reportNonDYES';
						try {
							const config = await getHeaderConfig(headerType);
							const defaultConfig = getDefaultHeaderConfig(headerType);
							const mergedConfig: HeaderConfig = {
								id: headerType,
								type: headerType as 'reportDYES' | 'reportNonDYES' | 'billing',
								mainTitle: config?.mainTitle || defaultConfig.mainTitle || '',
								subtitle: config?.subtitle || defaultConfig.subtitle || '',
								contactInfo: config?.contactInfo || defaultConfig.contactInfo || '',
								associationText: config?.associationText || defaultConfig.associationText || '',
								govermentOrder: config?.govermentOrder || defaultConfig.govermentOrder || '',
								leftLogo: config?.leftLogo || undefined,
								rightLogo: config?.rightLogo || undefined,
							};
							setHeaderConfig(mergedConfig);
						} catch (error) {
							console.error('Failed to load header config', error);
							const defaultConfig = getDefaultHeaderConfig(headerType);
							setHeaderConfig({
								id: headerType,
								type: headerType as 'reportDYES' | 'reportNonDYES' | 'billing',
								...defaultConfig,
							} as HeaderConfig);
						}
					}

					// Load strength and conditioning report (using documentId from first query)
					if (documentId) {
						// Check for existing strength & conditioning report versions
						if (initialPatientData.patientId) {
							const scVersionsQuery = query(
								collection(db, 'strengthConditioningReportVersions'),
								where('patientId', '==', initialPatientData.patientId)
							);
							getDocs(scVersionsQuery).then((snapshot) => {
								setHasStrengthConditioningVersions(snapshot.docs.length > 0);
							}).catch((err) => {
								console.error('Error checking strength & conditioning report versions:', err);
								setHasStrengthConditioningVersions(false);
							});
						}
						
						const reportRef = doc(db, 'strengthConditioningReports', documentId);
						const unsubscribe = onSnapshot(reportRef, (docSnap) => {
							if (docSnap.exists()) {
								const data = docSnap.data() as StrengthConditioningData;
								setStrengthConditioningData(data);
								
								// Check if it's a subsequent date for Strength & Conditioning report
								if (data.assessmentDate) {
									setIsSubsequentDateStrength(isDateOnDifferentDay(data.assessmentDate));
								} else if ((data as any).updatedAt) {
									// If no assessment date, check updatedAt
									const updatedDate = typeof (data as any).updatedAt === 'string' ? new Date((data as any).updatedAt) : ((data as any).updatedAt as any)?.toDate ? ((data as any).updatedAt as any).toDate() : new Date();
									if (!isNaN(updatedDate.getTime())) {
										setIsSubsequentDateStrength(isDateOnDifferentDay(updatedDate));
									} else {
										setIsSubsequentDateStrength(false);
									}
								} else {
									setIsSubsequentDateStrength(false);
								}
								
								// Initialize formData with strength conditioning data if editable
								if (editable) {
									const formDataWithDate = { ...data };
									// Set assessmentDate to today's date if it's not already set
									if (!formDataWithDate.assessmentDate) {
										formDataWithDate.assessmentDate = new Date().toISOString().split('T')[0];
									}
									setStrengthConditioningFormData(formDataWithDate);
									// Set uploaded PDF URL if it exists
									if (data.uploadedPdfUrl) {
										setUploadedPdfUrl(data.uploadedPdfUrl);
									}
								}
							} else {
								setStrengthConditioningData(null);
								setIsSubsequentDateStrength(false);
								if (editable) {
									// Set assessmentDate to today's date for new reports
									setStrengthConditioningFormData({
										assessmentDate: new Date().toISOString().split('T')[0]
									});
									setUploadedPdfUrl(null);
								}
							}
							setLoadingStrengthConditioning(false);
						}, (error) => {
							console.error('Error loading strength and conditioning report:', error);
							setStrengthConditioningData(null);
							setIsSubsequentDateStrength(false);
							setLoadingStrengthConditioning(false);
						});
						
						strengthConditioningUnsubscribeRef.current = unsubscribe;
					} else {
						setLoadingStrengthConditioning(false);
					}

					// Load psychology data (always load, not just when tab is active)
					if (documentId) {
						try {
							// Check for existing psychology report versions
							if (initialPatientData.patientId) {
								const versionsQuery = query(
									collection(db, 'psychologyReportVersions'),
									where('patientId', '==', initialPatientData.patientId)
								);
								getDocs(versionsQuery).then((snapshot) => {
									setHasPsychologyVersions(snapshot.docs.length > 0);
								}).catch((err) => {
									console.error('Error checking psychology report versions:', err);
									setHasPsychologyVersions(false);
								});
							}
							
							const psychologyRef = doc(db, 'psychologyReports', documentId);
							const unsubscribe = onSnapshot(psychologyRef, (docSnap) => {
								try {
									if (docSnap.exists()) {
										const data = docSnap.data();
										setPsychologyData(data);
										if (editable) {
											setPsychologyFormData(data);
										}
									} else {
										setPsychologyData(null);
										if (editable) {
											setPsychologyFormData({});
										}
									}
								} catch (err) {
									console.error('Error processing psychology report data:', err);
								} finally {
									setLoadingPsychology(false);
								}
							}, (error) => {
								console.error('Error loading psychology report:', error);
								setPsychologyData(null);
								if (editable) {
									setPsychologyFormData({});
								}
								setLoadingPsychology(false);
							});
							
							psychologyUnsubscribeRef.current = unsubscribe;
						} catch (err) {
							console.error('Failed to set up psychology report listener:', err);
							setPsychologyData(null);
							if (editable) {
								setPsychologyFormData({});
							}
							setLoadingPsychology(false);
						}
					} else {
						setLoadingPsychology(false);
					}
				} else {
					setLoadingReport(false);
					setLoadingStrengthConditioning(false);
					setLoadingPsychology(false);
				}
			} catch (error) {
				console.error('Failed to load patient report:', error);
				setLoadingReport(false);
				setLoadingStrengthConditioning(false);
				setLoadingPsychology(false);
			}
		};

		loadData();
	}, [isOpen, patientId, activeReportTab]);

	// Load clinical team members
	useEffect(() => {
		const unsubscribe = onSnapshot(
			collection(db, 'staff'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs
					.map(docSnap => {
						const data = docSnap.data() as Record<string, unknown>;
						return {
							id: docSnap.id,
							userName: data.userName ? String(data.userName) : '',
							userEmail: data.userEmail ? String(data.userEmail) : undefined,
							role: data.role ? String(data.role) : '',
							status: data.status ? String(data.status) : '',
						};
					})
					.filter(s => 
						s.status === 'Active' && 
						['Physiotherapist', 'StrengthAndConditioning', 'ClinicalTeam'].includes(s.role)
					)
					.map(s => ({
						id: s.id,
						userName: s.userName,
						userEmail: s.userEmail,
					}))
					.sort((a, b) => a.userName.localeCompare(b.userName));
				setClinicalTeamMembers([...mapped]);
			},
			error => {
				console.error('Failed to load clinical team members', error);
				setClinicalTeamMembers([]);
			}
		);

		return () => unsubscribe();
	}, []);

	// Initialize therapist name on initial load if form is empty
	// Note: The onSnapshot listener handles all Firestore data updates to prevent overwriting user edits
	useEffect(() => {
		// Only initialize therapist name on first load when form is completely empty
		if (!strengthConditioningData && reportPatientData && Object.keys(strengthConditioningFormData).length === 0 && clinicalTeamMembers.length > 0) {
			const currentUserStaff = clinicalTeamMembers.find(m => m.userEmail === user?.email);
			setStrengthConditioningFormData({
				therapistName: currentUserStaff?.userName || user?.displayName || user?.email || '',
			});
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [reportPatientData?.patientId, clinicalTeamMembers.length]); // Only on initial patient/clinical team load

	// Auto-populate physio name when clinical team members are loaded and formData is empty or physioName is not set
	useEffect(() => {
		if (editable && clinicalTeamMembers.length > 0 && reportPatientData && (!formData.physioName || formData.physioName === '')) {
			const currentUserStaff = clinicalTeamMembers.find(m => m.userEmail === user?.email);
			const physioName = currentUserStaff?.userName || user?.displayName || user?.email || '';
			if (physioName) {
				setFormData(prev => ({ ...prev, physioName }));
			}
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [clinicalTeamMembers.length, user?.email, user?.displayName, reportPatientData?.patientId]);

	// Handle PDF download for report
	// Helper function to build report data
	const buildReportData = () => {
		// Use formData if editable and not viewing a version, otherwise use reportPatientData
		const displayData = (editable && Object.keys(formData).length > 0 && !viewingVersionData) ? { ...reportPatientData, ...formData } : reportPatientData;
		if (!displayData) return null;
		
		const age = displayData.dob ? new Date().getFullYear() - new Date(displayData.dob).getFullYear() : undefined;
		return {
			patientName: displayData.name,
			patientId: displayData.patientId,
			referredBy: displayData.assignedDoctor || displayData.referredBy || '',
			age: age ? String(age) : '',
			gender: displayData.gender || '',
			dateOfConsultation: displayData.dateOfConsultation || new Date().toISOString().split('T')[0],
			contact: displayData.phone || '',
			email: displayData.email || '',
			totalSessionsRequired: displayData.totalSessionsRequired,
			remainingSessions: displayData.remainingSessions,
			history: displayData.history || (displayData.presentHistory || '') + (displayData.pastHistory ? '\n' + displayData.pastHistory : ''),
			surgicalHistory: displayData.surgicalHistory || '',
			medicalHistory: getMedicalHistoryText(displayData),
			sleepCycle: displayData.sleepCycle || '',
			hydration: displayData.hydration || '4',
			nutrition: displayData.nutrition || '',
			chiefComplaint: displayData.chiefComplaint || displayData.complaints || '',
			duration: displayData.duration || '',
			mechanismOfInjury: displayData.mechanismOfInjury || '',
			painIntensity: displayData.painIntensity || displayData.vasScale || '',
			painType: displayData.painType || '',
			aggravatingFactor: displayData.aggravatingFactor || '',
			relievingFactor: displayData.relievingFactor || '',
			siteSide: displayData.siteSide || '',
			onset: displayData.onset || '',
			natureOfInjury: displayData.natureOfInjury || '',
			vasScale: displayData.vasScale || '5',
			rom: displayData.rom || {},
			mmt: displayData.mmt || {},
			built: displayData.built || '',
			posture: displayData.posture || '',
			postureManualNotes: displayData.postureManualNotes || '',
			postureFileName: displayData.postureFileName || '',
			gaitAnalysis: displayData.gaitAnalysis || '',
			gaitManualNotes: displayData.gaitManualNotes || '',
			gaitFileName: displayData.gaitFileName || '',
			mobilityAids: displayData.mobilityAids || '',
			localObservation: displayData.localObservation || '',
			swelling: displayData.swelling || '',
			muscleWasting: displayData.muscleWasting || '',
			tenderness: displayData.tenderness || '',
			warmth: displayData.warmth || '',
			scar: displayData.scar || '',
			crepitus: displayData.crepitus || '',
			odema: displayData.odema || '',
			specialTest: displayData.specialTest || '',
			differentialDiagnosis: displayData.differentialDiagnosis || displayData.clinicalDiagnosis || '',
			finalDiagnosis: displayData.finalDiagnosis || '',
			shortTermGoals: displayData.shortTermGoals || '',
			longTermGoals: displayData.longTermGoals || '',
			treatment: displayData.treatment || displayData.treatmentProvided || '',
			treatmentProvided: displayData.treatmentProvided || '',
			advice: displayData.advice || '',
			nextFollowUpDate: displayData.nextFollowUpDate || '',
			nextFollowUpTime: displayData.nextFollowUpTime || '',
			followUpVisits: displayData.followUpVisits || [],
			followUpAssessment: displayData.followUpAssessment || '',
			currentPainStatus: displayData.currentPainStatus || '',
			currentRom: displayData.currentRom || '',
			currentStrength: displayData.currentStrength || '',
			currentFunctionalAbility: displayData.currentFunctionalAbility || '',
			complianceWithHEP: displayData.complianceWithHEP || '',
			physioName: displayData.physioName || '',
			patientType: displayData.patientType || '',
		};
	};

	const handleRomChange = (joint: string, motion: string, side: 'left' | 'right' | 'none', value: string) => {
		setFormData(prev => {
			const rom = { ...(prev.rom || {}) };
			if (!rom[joint]) {
				rom[joint] = ROM_HAS_SIDE[joint] ? { left: {}, right: {} } : {};
			}

			if (side === 'none') {
				rom[joint][motion] = value;
			} else {
				if (!rom[joint][side]) {
					rom[joint][side] = {};
				}
				rom[joint][side][motion] = value;
			}

			return { ...prev, rom };
		});
	};

	const handleAddRomJoint = () => {
		if (!selectedRomJoint || !formData.rom?.[selectedRomJoint]) {
			setFormData(prev => {
				const rom = { ...(prev.rom || {}) };
				if (!rom[selectedRomJoint]) {
					rom[selectedRomJoint] = ROM_HAS_SIDE[selectedRomJoint] ? { left: {}, right: {} } : {};
				}
				return { ...prev, rom };
			});
		}
		setSelectedRomJoint('');
	};

	const handleMmtChange = (joint: string, motion: string, side: 'left' | 'right' | 'none', value: string) => {
		setFormData(prev => {
			const mmt = { ...(prev.mmt || {}) };
			if (!mmt[joint]) {
				mmt[joint] = ROM_HAS_SIDE[joint] ? { left: {}, right: {} } : {};
			}

			if (side === 'none') {
				mmt[joint][motion] = value;
			} else {
				if (!mmt[joint][side]) {
					mmt[joint][side] = {};
				}
				mmt[joint][side][motion] = value;
			}

			return { ...prev, mmt };
		});
	};

	const handleAddMmtJoint = () => {
		if (!selectedMmtJoint || !formData.mmt?.[selectedMmtJoint]) {
			setFormData(prev => {
				const mmt = { ...(prev.mmt || {}) };
				if (!mmt[selectedMmtJoint]) {
					mmt[selectedMmtJoint] = ROM_HAS_SIDE[selectedMmtJoint] ? { left: {}, right: {} } : {};
				}
				return { ...prev, mmt };
			});
		}
		setSelectedMmtJoint('');
	};

	const handleRemoveRomJoint = (joint: string) => {
		setFormData(prev => {
			if (!prev.rom) return prev;
			const rom = { ...prev.rom };
			delete rom[joint];
			return { ...prev, rom };
		});
	};

	const handleRemoveMmtJoint = (joint: string) => {
		setFormData(prev => {
			if (!prev.mmt) return prev;
			const mmt = { ...prev.mmt };
			delete mmt[joint];
			return { ...prev, mmt };
		});
	};

	const handleFileUpload = (dataField: keyof PatientRecordFull, nameField: keyof PatientRecordFull, file: File | null) => {
		if (!file) {
			setFormData(prev => ({ ...prev, [dataField]: '', [nameField]: '' }));
			return;
		}

		const reader = new FileReader();
		reader.onload = event => {
			const result = event.target?.result;
			if (typeof result === 'string') {
				setFormData(prev => ({ ...prev, [dataField]: result, [nameField]: file.name }));
			}
		};
		reader.readAsDataURL(file);
	};

	const handleRomImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;

		// Validate file type
		if (!file.type.startsWith('image/') && !file.type.includes('pdf')) {
			alert('Please select an image or PDF file');
			return;
		}

		// Validate file size (max 5MB)
		if (file.size > 5 * 1024 * 1024) {
			alert('File size should be less than 5MB');
			return;
		}

		const joint = selectedRomJoint || 'general';
		const reader = new FileReader();
		reader.onload = event => {
			const result = event.target?.result;
			if (typeof result === 'string') {
				setRomImages(prev => ({
					...prev,
					[joint]: { data: result, fileName: file.name }
				}));
			}
		};
		reader.readAsDataURL(file);
	};

	const handleMmtImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;

		// Validate file type
		if (!file.type.startsWith('image/') && !file.type.includes('pdf')) {
			alert('Please select an image or PDF file');
			return;
		}

		// Validate file size (max 5MB)
		if (file.size > 5 * 1024 * 1024) {
			alert('File size should be less than 5MB');
			return;
		}

		const joint = selectedMmtJoint || 'general';
		const reader = new FileReader();
		reader.onload = event => {
			const result = event.target?.result;
			if (typeof result === 'string') {
				setMmtImages(prev => ({
					...prev,
					[joint]: { data: result, fileName: file.name }
				}));
			}
		};
		reader.readAsDataURL(file);
	};

	const formatMmtLabel = (motion: string) => {
		const direct = MOTION_TO_MMT[motion];
		if (direct) return direct;
		let label = motion;
		const replacements: Array<[RegExp, string]> = [
			[/Flexion/gi, 'Flexors'],
			[/Extension/gi, 'Extensors'],
			[/Abduction/gi, 'Abductors'],
			[/Adduction/gi, 'Adductors'],
			[/Dorsiflexion/gi, 'Dorsiflexors'],
			[/Plantarflexion/gi, 'Plantarflexors'],
		];
		replacements.forEach(([regex, replacement]) => {
			label = label.replace(regex, replacement);
		});
		return label;
	};

	const renderRomTable = (joint: string, data: any) => {
		if (!ROM_HAS_SIDE[joint] && joint !== 'Neck') {
			return (
				<div key={joint} className="relative mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
					<button
						type="button"
						onClick={() => handleRemoveRomJoint(joint)}
						className="absolute right-3 top-3 text-slate-400 transition hover:text-rose-500"
						aria-label={`Remove ${joint}`}
					>
						<i className="fas fa-times" />
					</button>
					<h6 className="mb-3 text-sm font-semibold text-sky-600">{joint}</h6>
					<table className="min-w-full divide-y divide-slate-200 border border-slate-300 text-left text-sm">
						<thead className="bg-slate-100">
							<tr>
								<th className="px-3 py-2 font-semibold text-slate-700">Motion</th>
								<th className="px-3 py-2 font-semibold text-slate-700">Value</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-200 bg-white">
							{ROM_MOTIONS[joint].map(({ motion }) => (
								<tr key={motion}>
									<td className="px-3 py-2 text-slate-700">{motion}</td>
									<td className="px-3 py-2">
										<input
											type="text"
											value={data?.[motion] || ''}
											onChange={e => handleRomChange(joint, motion, 'none', e.target.value)}
											className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											placeholder="Enter value"
											style={{ color: '#1e293b' }}
										/>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			);
		}

		if (joint === 'Neck') {
			return (
				<div key={joint} className="relative mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
					<button
						type="button"
						onClick={() => handleRemoveRomJoint(joint)}
						className="absolute right-3 top-3 text-slate-400 transition hover:text-rose-500"
						aria-label="Remove Neck"
					>
						<i className="fas fa-times" />
					</button>
					<h6 className="mb-3 text-sm font-semibold text-sky-600">{joint}</h6>
					<table className="min-w-full divide-y divide-slate-200 border border-slate-300 text-left text-sm">
						<thead className="bg-slate-100">
							<tr>
								<th className="px-3 py-2 font-semibold text-slate-700">Motion</th>
								<th className="px-3 py-2 font-semibold text-slate-700">Value</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-200 bg-white">
							{ROM_MOTIONS[joint].map(({ motion }) => {
								if (motion.includes('Lateral Flexion')) {
									const side = motion.includes('Left') ? 'left' : 'right';
									const baseMotion = 'Lateral Flexion';
									return (
										<tr key={motion}>
											<td className="px-3 py-2 text-slate-700">{motion}</td>
											<td className="px-3 py-2">
												<input
													type="text"
													value={data?.[side]?.[baseMotion] || ''}
													onChange={e => handleRomChange(joint, baseMotion, side, e.target.value)}
													className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
													placeholder="Enter value"
												/>
											</td>
										</tr>
									);
								} else {
									return (
										<tr key={motion}>
											<td className="px-3 py-2 text-slate-700">{motion}</td>
											<td className="px-3 py-2">
												<input
													type="text"
													value={data?.[motion] || ''}
													onChange={e => handleRomChange(joint, motion, 'none', e.target.value)}
													className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
													placeholder="Enter value"
												/>
											</td>
										</tr>
									);
								}
							})}
						</tbody>
					</table>
				</div>
			);
		}

		return (
			<div key={joint} className="relative mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
				<button
					type="button"
					onClick={() => handleRemoveRomJoint(joint)}
					className="absolute right-3 top-3 text-slate-400 transition hover:text-rose-500"
					aria-label={`Remove ${joint}`}
				>
					<i className="fas fa-times" />
				</button>
				<h6 className="mb-3 text-sm font-semibold text-sky-600">{joint}</h6>
				<table className="min-w-full divide-y divide-slate-200 border border-slate-300 text-left text-sm">
					<thead className="bg-slate-100">
						<tr>
							<th colSpan={2} className="px-3 py-2 text-center font-semibold text-slate-700">
								Left
							</th>
							<th colSpan={2} className="px-3 py-2 text-center font-semibold text-slate-700">
								Right
							</th>
						</tr>
						<tr>
							<th className="px-3 py-2 font-semibold text-slate-700">Motion</th>
							<th className="px-3 py-2 font-semibold text-slate-700">Value</th>
							<th className="px-3 py-2 font-semibold text-slate-700">Motion</th>
							<th className="px-3 py-2 font-semibold text-slate-700">Value</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-200 bg-white">
						{ROM_MOTIONS[joint].map(({ motion }) => (
							<tr key={motion}>
								<td className="px-3 py-2 text-slate-700">{motion}</td>
								<td className="px-3 py-2">
									<input
										type="text"
										value={data?.left?.[motion] || ''}
										onChange={e => handleRomChange(joint, motion, 'left', e.target.value)}
										className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										placeholder="Left"
										style={{ color: '#1e293b' }}
									/>
								</td>
								<td className="px-3 py-2 text-slate-700">{motion}</td>
								<td className="px-3 py-2">
									<input
										type="text"
										value={data?.right?.[motion] || ''}
										onChange={e => handleRomChange(joint, motion, 'right', e.target.value)}
										className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										placeholder="Right"
										style={{ color: '#1e293b' }}
									/>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		);
	};

	const renderMmtTable = (joint: string, data: any) => {
		const motions = ROM_MOTIONS[joint] || [];

		if (!ROM_HAS_SIDE[joint]) {
			return (
				<div key={joint} className="relative mb-6 rounded-lg border border-violet-200 bg-violet-50/60 p-4">
					<button
						type="button"
						onClick={() => handleRemoveMmtJoint(joint)}
						className="absolute right-3 top-3 text-slate-400 transition hover:text-rose-500"
						aria-label={`Remove ${joint} MMT`}
					>
						<i className="fas fa-times" />
					</button>
					<h6 className="mb-3 text-sm font-semibold text-violet-700">{joint}</h6>
					<table className="min-w-full divide-y divide-slate-200 border border-slate-300 text-left text-sm">
						<thead className="bg-slate-100">
							<tr>
								<th className="px-3 py-2 font-semibold text-slate-700">Muscle Group</th>
								<th className="px-3 py-2 font-semibold text-slate-700">Grade</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-200 bg-white">
							{motions.map(({ motion }) => {
								const label = formatMmtLabel(motion);
								return (
									<tr key={motion}>
										<td className="px-3 py-2 text-slate-700">{label}</td>
										<td className="px-3 py-2">
											<input
												type="text"
												value={data?.[motion] || ''}
												onChange={e => handleMmtChange(joint, motion, 'none', e.target.value)}
												className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
												placeholder="Grade"
												style={{ color: '#1e293b' }}
											/>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			);
		}

		return (
			<div key={joint} className="relative mb-6 rounded-lg border border-violet-200 bg-violet-50/60 p-4">
				<button
					type="button"
					onClick={() => handleRemoveMmtJoint(joint)}
					className="absolute right-3 top-3 text-slate-400 transition hover:text-rose-500"
					aria-label={`Remove ${joint} MMT`}
				>
					<i className="fas fa-times" />
				</button>
				<h6 className="mb-3 text-sm font-semibold text-violet-700">{joint}</h6>
				<table className="min-w-full divide-y divide-slate-200 border border-slate-300 text-left text-sm">
					<thead className="bg-slate-100">
						<tr>
							<th colSpan={2} className="px-3 py-2 text-center font-semibold text-slate-700">
								Left
							</th>
							<th colSpan={2} className="px-3 py-2 text-center font-semibold text-slate-700">
								Right
							</th>
						</tr>
						<tr>
							<th className="px-3 py-2 font-semibold text-slate-700">Muscle Group</th>
							<th className="px-3 py-2 font-semibold text-slate-700">Grade</th>
							<th className="px-3 py-2 font-semibold text-slate-700">Muscle Group</th>
							<th className="px-3 py-2 font-semibold text-slate-700">Grade</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-slate-200 bg-white">
						{motions.map(({ motion }) => {
							const label = formatMmtLabel(motion);
							return (
								<tr key={motion}>
									<td className="px-3 py-2 text-slate-700">{label}</td>
									<td className="px-3 py-2">
										<input
											type="text"
											value={data?.left?.[motion] || ''}
											onChange={e => handleMmtChange(joint, motion, 'left', e.target.value)}
											className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											placeholder="Grade"
										/>
									</td>
									<td className="px-3 py-2 text-slate-700">{label}</td>
									<td className="px-3 py-2">
										<input
											type="text"
											value={data?.right?.[motion] || ''}
											onChange={e => handleMmtChange(joint, motion, 'right', e.target.value)}
											className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											placeholder="Grade"
										/>
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		);
	};

	const handleDownloadReportPDF = async (sections?: ReportSection[]) => {
		try {
			const reportData = buildReportData();
			if (!reportData) {
				alert('No patient data available. Please try again.');
				return;
			}
			await generatePhysiotherapyReportPDF(reportData, sections ? { sections } : undefined);
		} catch (error) {
			console.error('Error downloading PDF:', error);
			alert('Failed to download PDF. Please try again.');
		}
	};

	// Handle field change for strength conditioning
	// Helper function to calculate duration in hours from time range string
	const calculateDurationHours = (timeRange: string): number => {
		if (!timeRange) return 0;
		// Try to parse format like "10:00 am to 11:00 am" or "10:00 to 11:00"
		const timePattern = /(\d{1,2}):(\d{2})\s*(am|pm)?/gi;
		const matches = [...timeRange.matchAll(timePattern)];
		if (matches.length >= 2) {
			const startMatch = matches[0];
			const endMatch = matches[1];
			
			const startHour = parseInt(startMatch[1]);
			const startMin = parseInt(startMatch[2]);
			const startPeriod = startMatch[3]?.toLowerCase();
			const endHour = parseInt(endMatch[1]);
			const endMin = parseInt(endMatch[2]);
			const endPeriod = endMatch[3]?.toLowerCase();
			
			// Convert to 24-hour format
			let start24 = startHour;
			if (startPeriod === 'pm' && startHour !== 12) start24 += 12;
			if (startPeriod === 'am' && startHour === 12) start24 = 0;
			
			let end24 = endHour;
			if (endPeriod === 'pm' && endHour !== 12) end24 += 12;
			if (endPeriod === 'am' && endHour === 12) end24 = 0;
			
			// Calculate difference in hours
			const startMinutes = start24 * 60 + startMin;
			const endMinutes = end24 * 60 + endMin;
			let diffMinutes = endMinutes - startMinutes;
			if (diffMinutes < 0) diffMinutes += 24 * 60; // Handle next day
			
			return diffMinutes / 60;
		}
		return 0;
	};

	// Auto-calculate daily workload from RPE and Total Duration
	// Total Duration = Skill Training Duration + Strength & Conditioning Duration
	const calculatedDailyWorkload = useMemo(() => {
		if (strengthConditioningFormData.scRPEPlanned) {
			// Calculate total duration: Skill Training Duration + Strength & Conditioning Duration
			const skillDur = typeof strengthConditioningFormData.skillDuration === 'number' 
				? strengthConditioningFormData.skillDuration 
				: Number(strengthConditioningFormData.skillDuration) || 0;
			const scDur = typeof strengthConditioningFormData.scDuration === 'number' 
				? strengthConditioningFormData.scDuration 
				: Number(strengthConditioningFormData.scDuration) || 0;
			const totalDuration = skillDur + scDur;
			
			if (totalDuration > 0 && typeof strengthConditioningFormData.scRPEPlanned === 'number') {
				return strengthConditioningFormData.scRPEPlanned * totalDuration;
			}
		}
		return undefined;
	}, [strengthConditioningFormData.scRPEPlanned, strengthConditioningFormData.skillDuration, strengthConditioningFormData.scDuration]);

	// Auto-calculate ACWR ratio
	const calculatedACWR = useMemo(() => {
		if (strengthConditioningFormData.acuteWorkload && strengthConditioningFormData.chronicWorkload && strengthConditioningFormData.chronicWorkload > 0) {
			return strengthConditioningFormData.acuteWorkload / strengthConditioningFormData.chronicWorkload;
		}
		return undefined;
	}, [strengthConditioningFormData.acuteWorkload, strengthConditioningFormData.chronicWorkload]);

	// Update form data when calculated values change
	useEffect(() => {
		if (calculatedDailyWorkload !== undefined) {
			setStrengthConditioningFormData(prev => ({ ...prev, dailyWorkload: calculatedDailyWorkload }));
		}
	}, [calculatedDailyWorkload]);

	useEffect(() => {
		if (calculatedACWR !== undefined) {
			setStrengthConditioningFormData(prev => ({ ...prev, acwrRatio: calculatedACWR }));
		}
	}, [calculatedACWR]);

	// Validate and normalize duration to time-based decimal format
	// Format: 0.10 (10 min), 0.15 (15 min), 0.20 (20 min), ..., 0.55 (55 min)
	// After 0.55, rolls over to 1.0 (1 hour), then 1.10 (1h 10m), 1.15 (1h 15m), etc.
	// Examples: 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 1.0, 1.10, 1.15, ..., 1.55, 2.0, 2.10, etc.
	const validateDuration = (value: number | string | undefined): number | undefined => {
		if (value === undefined || value === null || value === '') return undefined;
		
		const numValue = typeof value === 'string' ? parseFloat(value) : value;
		if (isNaN(numValue) || numValue < 0) return undefined;
		
		const hours = Math.floor(numValue);
		const decimalPart = numValue - hours;
		
		// Valid decimal values: 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55
		// These represent 10, 15, 20, 25, 30, 35, 40, 45, 50, 55 minutes
		const validDecimals = [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55];
		
		// If decimal part is 0 (or very close to 0), it's a whole hour - valid as is
		if (Math.abs(decimalPart) < 0.001) {
			return numValue;
		}
		
		// If decimal > 0.55, roll over to next hour (e.g., 0.60 becomes 1.0, 1.60 becomes 2.0)
		if (decimalPart > 0.55) {
			return hours + 1;
		}
		
		// Round to nearest 0.05 increment first
		const roundedTo005 = Math.round(decimalPart * 20) / 20; // Round to nearest 0.05
		
		// Normalize to two decimal places for comparison (0.1 becomes 0.10, 0.2 becomes 0.20, etc.)
		const normalizedRounded = Math.round(roundedTo005 * 100) / 100;
		
		// Check if rounded value is in valid list
		const isValidRounded = validDecimals.some(valid => Math.abs(normalizedRounded - valid) < 0.001);
		
		if (isValidRounded) {
			return hours + normalizedRounded;
		}
		
		// If rounded value is not in valid list, find the closest valid decimal
		let closestDecimal = 0.10;
		let minDiff = Math.abs(decimalPart - 0.10);
		
		for (const validDec of validDecimals) {
			const diff = Math.abs(decimalPart - validDec);
			if (diff < minDiff) {
				minDiff = diff;
				closestDecimal = validDec;
			}
		}
		
		return hours + closestDecimal;
	};

	const handleFieldChangeStrengthConditioning = (field: keyof StrengthConditioningData, value: any) => {
		// Validate duration fields (skillDuration, scDuration, sleepDuration)
		if ((field === 'skillDuration' || field === 'scDuration' || field === 'sleepDuration') && value !== undefined && value !== '') {
			const validated = validateDuration(value);
			setStrengthConditioningFormData(prev => ({ ...prev, [field]: validated }));
		} else {
			setStrengthConditioningFormData(prev => ({ ...prev, [field]: value }));
		}
		
		// Update subsequent date state when assessmentDate changes
		if (field === 'assessmentDate') {
			setIsSubsequentDateStrength(isDateOnDifferentDay(value));
		}
	};

	// Handle save for strength conditioning
	const handleSaveStrengthConditioning = async () => {
		if (!editable || !reportPatientData || savingStrengthConditioning || !patientId) {
			if (!editable) {
				console.log('Save blocked: not editable');
				return;
			}
			alert('Please select a patient first');
			return;
		}

		// Preserve current form data to prevent it from being cleared
		const dataToSave = removeUndefined({
			...strengthConditioningFormData,
			uploadedPdfUrl: uploadedPdfUrl || strengthConditioningFormData.uploadedPdfUrl || null,
			therapistName: strengthConditioningFormData.therapistName || user?.displayName || user?.email || '',
			patientId: reportPatientData.patientId,
			patientName: reportPatientData.name || '',
			updatedAt: new Date().toISOString(),
			updatedBy: user?.email || user?.displayName || 'Unknown',
		});

		setSavingStrengthConditioning(true);
		try {
			// Get patient document ID (use stored patientDocId if available, otherwise fetch it)
			let documentIdToUse = patientDocId;
			if (!documentIdToUse) {
				const patientSnap = await getDocs(query(collection(db, 'patients'), where('patientId', '==', patientId)));
				if (patientSnap.empty) {
					alert('Patient not found. Please try again.');
					setSavingStrengthConditioning(false);
					return;
				}
				documentIdToUse = patientSnap.docs[0].id;
				setPatientDocId(documentIdToUse); // Store it for future use
			}
			const docRef = doc(db, 'strengthConditioningReports', documentIdToUse);
			
			// Create version history before updating
			// Get current data to save as version
			const currentReportData = removeUndefined({
				...strengthConditioningFormData,
				therapistName: strengthConditioningFormData.therapistName || user?.displayName || user?.email || '',
				patientId: reportPatientData.patientId,
				patientName: reportPatientData.name,
			});

			const hasReportData = Object.values(currentReportData).some(val => 
				val !== undefined && val !== null && val !== '' && 
				!(Array.isArray(val) && val.length === 0) &&
				!(typeof val === 'object' && Object.keys(val).length === 0)
			);

			if (hasReportData) {
				try {
					const versionsQuery = query(
						collection(db, 'strengthConditioningReportVersions'),
						where('patientId', '==', reportPatientData.patientId),
						orderBy('version', 'desc')
					);
					const versionsSnapshot = await getDocs(versionsQuery);
					const nextVersion = versionsSnapshot.docs.length > 0 
						? (versionsSnapshot.docs[0].data().version as number) + 1 
						: 1;

					const versionData = removeUndefined({
						patientId: reportPatientData.patientId,
						patientName: reportPatientData.name || '',
						version: nextVersion,
						reportData: currentReportData,
						createdBy: user?.displayName || user?.email || 'Unknown',
						createdById: user?.uid || '',
						createdAt: serverTimestamp(),
					});
					await addDoc(collection(db, 'strengthConditioningReportVersions'), versionData);
					// Update hasStrengthConditioningVersions since we just saved a version
					setHasStrengthConditioningVersions(true);
				} catch (versionError: any) {
					// If orderBy fails (missing index), try without it
					if (versionError.code === 'failed-precondition' || versionError.message?.includes('index')) {
						console.warn('Strength conditioning version index not found, saving without version history', versionError);
						// Try saving without orderBy
						try {
							const versionsQuery = query(
								collection(db, 'strengthConditioningReportVersions'),
								where('patientId', '==', reportPatientData.patientId)
							);
							const versionsSnapshot = await getDocs(versionsQuery);
							const nextVersion = versionsSnapshot.docs.length > 0 
								? Math.max(...versionsSnapshot.docs.map(d => d.data().version as number)) + 1
								: 1;

							const versionDataRetry = removeUndefined({
								patientId: reportPatientData.patientId,
								patientName: reportPatientData.name || '',
								version: nextVersion,
								reportData: currentReportData,
								createdBy: user?.displayName || user?.email || 'Unknown',
								createdById: user?.uid || '',
								createdAt: serverTimestamp(),
							});
							await addDoc(collection(db, 'strengthConditioningReportVersions'), versionDataRetry);
							// Update hasStrengthConditioningVersions since we just saved a version
							setHasStrengthConditioningVersions(true);
						} catch (retryError) {
							console.warn('Failed to save strength conditioning version history', retryError);
							// Continue without version history
						}
					} else {
						console.warn('Failed to save strength conditioning version history', versionError);
						// Continue without version history
					}
				}
			}

			await setDoc(docRef, dataToSave, { merge: true });

			// Explicitly update form data with saved data to ensure it persists
			// This prevents any timing issues with onSnapshot
			setStrengthConditioningFormData(dataToSave);

			// Handle session completion if checkbox is checked
			if (sessionCompleted && reportPatientData) {
				try {
					const patientRef = doc(db, 'patients', documentIdToUse);
					const totalSessionsValue =
						typeof reportPatientData.totalSessionsRequired === 'number'
							? reportPatientData.totalSessionsRequired
							: null;

					// Calculate remaining sessions
					const baseRemaining = 
						typeof reportPatientData.remainingSessions === 'number'
							? reportPatientData.remainingSessions
							: totalSessionsValue !== null
								? totalSessionsValue
								: null;

					if (baseRemaining !== null && baseRemaining > 0) {
						const newRemainingSessions = Math.max(0, baseRemaining - 1);

						// Update patient's remaining sessions
						await updateDoc(patientRef, {
							remainingSessions: newRemainingSessions,
							updatedAt: serverTimestamp(),
						});

						// Update reportPatientData state
						setReportPatientData((prev: any) => prev ? { ...prev, remainingSessions: newRemainingSessions } : null);

						// Mark appointment as completed
						const patientForProgress: PatientRecordFull = {
							...reportPatientData,
							id: documentIdToUse,
							totalSessionsRequired: totalSessionsValue ?? reportPatientData.totalSessionsRequired,
							remainingSessions: newRemainingSessions,
						};

						const consultationDate = strengthConditioningFormData.assessmentDate || reportPatientData.dateOfConsultation || new Date().toISOString().split('T')[0];
						await markAppointmentCompletedForReport(patientForProgress, consultationDate, isExtraTreatment);

						// Refresh patient session progress
						const sessionProgress = await refreshPatientSessionProgress(
							patientForProgress,
							totalSessionsValue ?? null
						);

						if (sessionProgress) {
							setReportPatientData((prev: any) => (prev ? { ...prev, ...sessionProgress } : null));
						}
					}
				} catch (sessionError) {
					console.error('Failed to handle session completion for strength conditioning report', sessionError);
					// Don't block the save if session completion fails
				}
			}

			setSessionCompleted(false);
			setSavedStrengthConditioningMessage(true);
			setTimeout(() => setSavedStrengthConditioningMessage(false), 3000);
		} catch (error) {
			console.error('Failed to save strength and conditioning report', error);
			alert('Failed to save report. Please try again.');
		} finally {
			setSavingStrengthConditioning(false);
		}
	};

	const handleSavePsychology = async () => {
		if (!editable || !reportPatientData || savingPsychology || !patientId) {
			if (!editable) {
				console.log('Save blocked: not editable');
				return;
			}
			alert('Please select a patient first');
			return;
		}

		const dataToSave = {
			...psychologyFormData,
			patientId: reportPatientData.patientId,
			patientName: reportPatientData.name || '',
			updatedAt: new Date().toISOString(),
			updatedBy: user?.email || user?.displayName || 'Unknown',
		};

		setSavingPsychology(true);
		try {
			let documentIdToUse = patientDocId;
			if (!documentIdToUse) {
				const patientSnap = await getDocs(query(collection(db, 'patients'), where('patientId', '==', patientId)));
				if (patientSnap.empty) {
					alert('Patient not found. Please try again.');
					setSavingPsychology(false);
					return;
				}
				documentIdToUse = patientSnap.docs[0].id;
				setPatientDocId(documentIdToUse);
			}
			const docRef = doc(db, 'psychologyReports', documentIdToUse);
			await setDoc(docRef, dataToSave, { merge: true });
			
			// Save psychology report version
			try {
				// First, renumber versions sequentially if needed
				await renumberVersionsSequentially('psychologyReportVersions', reportPatientData.patientId);
				
				// Get the next version number
				let versionsQuery = query(
					collection(db, 'psychologyReportVersions'),
					where('patientId', '==', reportPatientData.patientId),
					orderBy('version', 'desc')
				);
				let versionsSnapshot: QuerySnapshot;
				try {
					versionsSnapshot = await getDocs(versionsQuery);
				} catch (queryError: any) {
					// If orderBy fails, try without it
					if (queryError.code === 'failed-precondition' || queryError.message?.includes('index')) {
						const fallbackQuery = query(
							collection(db, 'psychologyReportVersions'),
							where('patientId', '==', reportPatientData.patientId)
						);
						const fallbackSnapshot = await getDocs(fallbackQuery);
						const versions = fallbackSnapshot.docs.map(doc => ({
							version: (doc.data().version as number) || 0,
							doc: doc,
						}));
						versions.sort((a, b) => b.version - a.version);
						// Use the sorted docs
						versionsSnapshot = {
							...fallbackSnapshot,
							docs: versions.map(v => v.doc)
						} as QuerySnapshot;
					} else {
						throw queryError;
					}
				}
				const nextVersion = versionsSnapshot.docs.length > 0 
					? (versionsSnapshot.docs[0].data().version as number) + 1 
					: 1;

				await addDoc(collection(db, 'psychologyReportVersions'), {
					patientId: reportPatientData.patientId,
					patientName: reportPatientData.name,
					version: nextVersion,
					reportType: 'psychology',
					reportData: removeUndefined(dataToSave),
					createdBy: user?.displayName || user?.email || 'Unknown',
					createdById: user?.uid || '',
					createdAt: serverTimestamp(),
				});
				// Update hasPsychologyVersions since we just saved a version
				setHasPsychologyVersions(true);
			} catch (versionError: any) {
				console.error('Failed to save psychology report version:', versionError);
				// Don't block the main save operation if version saving fails
			}
			
			setSavedPsychologyMessage(true);
			setTimeout(() => setSavedPsychologyMessage(false), 3000);
			setIsEditingLoadedPsychologyVersion(false); // After save, no longer "editing loaded version"
		} catch (error) {
			console.error('Failed to save psychology report:', error);
			alert('Failed to save psychology report. Please try again.');
		} finally {
			setSavingPsychology(false);
		}
	};

	// Handle PDF upload for strength and conditioning
	const handlePdfUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (!file || !patientId) {
			return;
		}

		// Validate file type
		if (file.type !== 'application/pdf') {
			alert('Please upload a PDF file only.');
			return;
		}

		// Validate file size (max 10MB)
		if (file.size > 10 * 1024 * 1024) {
			alert('File size must be less than 10MB.');
			return;
		}

		setUploadingPdf(true);
		try {
			const timestamp = Date.now();
			const fileName = `strength-conditioning-${patientId}-${timestamp}.pdf`;
			const storageRef = ref(storage, `strength-conditioning-reports/${patientId}/${fileName}`);
			
			await uploadBytes(storageRef, file);
			const downloadURL = await getDownloadURL(storageRef);
			
			setUploadedPdfUrl(downloadURL);
			setStrengthConditioningFormData(prev => ({
				...prev,
				uploadedPdfUrl: downloadURL,
			}));
			
			alert('PDF uploaded successfully!');
		} catch (error) {
			console.error('Failed to upload PDF:', error);
			alert('Failed to upload PDF. Please try again.');
		} finally {
			setUploadingPdf(false);
			// Reset input
			if (event.target) {
				event.target.value = '';
			}
		}
	};

	// Handle PDF download for strength and conditioning
	const handleDownloadStrengthConditioningPDF = async () => {
		try {
			if (!reportPatientData || !strengthConditioningFormData) {
				alert('No patient or strength conditioning data available. Please try again.');
				return;
			}
			
			await generateStrengthConditioningPDF({
				patient: {
					name: reportPatientData.name,
					patientId: reportPatientData.patientId,
					dob: reportPatientData.dob || '',
					gender: reportPatientData.gender || '',
					phone: reportPatientData.phone || '',
					email: reportPatientData.email || '',
				},
				formData: strengthConditioningFormData as StrengthConditioningData,
				uploadedPdfUrl: uploadedPdfUrl || strengthConditioningFormData.uploadedPdfUrl || null,
			});
		} catch (error) {
			console.error('Error downloading PDF:', error);
			alert('Failed to download PDF. Please try again.');
		}
	};

	// Handle save
	const handleSave = async () => {
		if (!editable || !reportPatientData || saving || !patientId) {
			console.log('Save blocked:', { editable, hasReportData: !!reportPatientData, saving, patientId });
			return;
		}

		setSaving(true);
		try {
			// Get patient document ID (use stored patientDocId if available, otherwise fetch it)
			let patientDocIdToUse = patientDocId;
			if (!patientDocIdToUse) {
				const patientSnap = await getDocs(query(collection(db, 'patients'), where('patientId', '==', patientId)));
				if (patientSnap.empty) {
					alert('Patient not found. Please try again.');
					setSaving(false);
					return;
				}
				patientDocIdToUse = patientSnap.docs[0].id;
				setPatientDocId(patientDocIdToUse); // Store it for future use
			}
			const patientRef = doc(db, 'patients', patientDocIdToUse);
			
			const consultationDate = formData.dateOfConsultation || reportPatientData.dateOfConsultation;
			const totalSessionsValue =
				typeof formData.totalSessionsRequired === 'number'
					? formData.totalSessionsRequired
					: typeof reportPatientData.totalSessionsRequired === 'number'
						? reportPatientData.totalSessionsRequired
						: undefined;
			
			// Get session number for this report
			let sessionNum = sessionNumber;
			if (!sessionNum) {
				const sessionInfo = await getSessionInfo(reportPatientData.patientId);
				sessionNum = sessionInfo.sessionNumber;
			}
			if (isEditingSession1) {
				sessionNum = 1;
			}
			
			const reportData: Record<string, any> = {
				history: formData.history || '',
				med_xray: formData.med_xray || false,
				med_mri: formData.med_mri || false,
				med_report: formData.med_report || false,
				med_ct: formData.med_ct || false,
				surgicalHistory: formData.surgicalHistory || '',
				per_smoking: formData.per_smoking || false,
				per_drinking: formData.per_drinking || false,
				per_alcohol: formData.per_alcohol || false,
				per_drugs: formData.per_drugs || false,
				drugsText: formData.drugsText || '',
				sleepCycle: formData.sleepCycle || '',
				hydration: formData.hydration || '',
				nutrition: formData.nutrition || '',
				siteSide: formData.siteSide || '',
				onset: formData.onset || '',
				duration: formData.duration || '',
				natureOfInjury: formData.natureOfInjury || '',
				vasScale: formData.vasScale || '',
				aggravatingFactor: formData.aggravatingFactor || '',
				relievingFactor: formData.relievingFactor || '',
				rom: formData.rom || {},
				treatmentProvided: formData.treatmentProvided || '',
				physioName: formData.physioName || '',
				dateOfConsultation: formData.dateOfConsultation || '',
				referredBy: formData.referredBy || '',
				chiefComplaint: formData.chiefComplaint || '',
				mechanismOfInjury: formData.mechanismOfInjury || '',
				painIntensity: formData.painIntensity || '',
				differentialDiagnosis: formData.differentialDiagnosis || formData.clinicalDiagnosis || '',
				followUpVisits: formData.followUpVisits || [],
				followUpAssessment: formData.followUpAssessment || '',
				currentPainStatus: formData.currentPainStatus || '',
				currentRom: formData.currentRom || '',
				currentStrength: formData.currentStrength || '',
				currentFunctionalAbility: formData.currentFunctionalAbility || '',
				complianceWithHEP: formData.complianceWithHEP || '',
				built: formData.built || '',
				posture: formData.posture || '',
				gaitAnalysis: formData.gaitAnalysis || '',
				mobilityAids: formData.mobilityAids || '',
				localObservation: formData.localObservation || '',
				swelling: formData.swelling || '',
				muscleWasting: formData.muscleWasting || '',
				postureManualNotes: formData.postureManualNotes || '',
				postureFileName: formData.postureFileName || '',
				postureFileData: formData.postureFileData || '',
				gaitManualNotes: formData.gaitManualNotes || '',
				gaitFileName: formData.gaitFileName || '',
				gaitFileData: formData.gaitFileData || '',
				tenderness: formData.tenderness || '',
				warmth: formData.warmth || '',
				scar: formData.scar || '',
				crepitus: formData.crepitus || '',
				odema: formData.odema || '',
				mmt: formData.mmt || {},
				specialTest: formData.specialTest || '',
				finalDiagnosis: formData.finalDiagnosis || '',
				shortTermGoals: formData.shortTermGoals || '',
				longTermGoals: formData.longTermGoals || '',
				treatment: formData.treatment || formData.treatmentProvided || '',
				advice: formData.advice || '',
				managementRemarks: formData.managementRemarks || '',
				nextFollowUpDate: formData.nextFollowUpDate || '',
				nextFollowUpTime: formData.nextFollowUpTime || '',
				sessionNumber: sessionNum, // Add session number to patient record
				totalSessionsRequired:
					typeof formData.totalSessionsRequired === 'number'
						? formData.totalSessionsRequired
						: formData.totalSessionsRequired
							? Number(formData.totalSessionsRequired)
							: null,
				remainingSessions: (() => {
					if (sessionCompleted) {
						const baseRemaining = 
							typeof reportPatientData.remainingSessions === 'number'
								? reportPatientData.remainingSessions
								: typeof reportPatientData.totalSessionsRequired === 'number'
									? reportPatientData.totalSessionsRequired
									: null;
						
						if (baseRemaining !== null && baseRemaining > 0) {
							return Math.max(0, baseRemaining - 1);
						}
					}
					
					if (typeof formData.remainingSessions === 'number') {
						return formData.remainingSessions;
					}
					if (formData.remainingSessions) {
						return Number(formData.remainingSessions);
					}
					const totalValue =
						typeof formData.totalSessionsRequired === 'number'
							? formData.totalSessionsRequired
							: typeof reportPatientData.totalSessionsRequired === 'number'
								? reportPatientData.totalSessionsRequired
								: null;
					
					if (totalValue !== null) {
						const currentRemaining = 
							typeof reportPatientData.remainingSessions === 'number'
								? reportPatientData.remainingSessions
								: totalValue;
						return currentRemaining;
					}
					return null;
				})(),
				updatedAt: serverTimestamp(),
			};

			// Create report snapshot before updating
			const currentReportData: Partial<PatientRecordFull> = {
				history: reportPatientData.history || (reportPatientData.presentHistory || '') + (reportPatientData.pastHistory ? '\n' + reportPatientData.pastHistory : ''),
				med_xray: reportPatientData.med_xray,
				med_mri: reportPatientData.med_mri,
				med_report: reportPatientData.med_report,
				med_ct: reportPatientData.med_ct,
				surgicalHistory: reportPatientData.surgicalHistory,
				per_smoking: reportPatientData.per_smoking,
				per_drinking: reportPatientData.per_drinking,
				per_alcohol: reportPatientData.per_alcohol,
				per_drugs: reportPatientData.per_drugs,
				drugsText: reportPatientData.drugsText,
				sleepCycle: reportPatientData.sleepCycle,
				hydration: reportPatientData.hydration,
				nutrition: reportPatientData.nutrition,
				siteSide: reportPatientData.siteSide,
				onset: reportPatientData.onset,
				duration: reportPatientData.duration,
				natureOfInjury: reportPatientData.natureOfInjury,
				typeOfPain: reportPatientData.typeOfPain,
				vasScale: reportPatientData.vasScale,
				aggravatingFactor: reportPatientData.aggravatingFactor,
				relievingFactor: reportPatientData.relievingFactor,
				rom: reportPatientData.rom,
				treatmentProvided: reportPatientData.treatmentProvided,
				progressNotes: reportPatientData.progressNotes,
				physioName: reportPatientData.physioName,
				physioId: reportPatientData.physioId,
				dateOfConsultation: reportPatientData.dateOfConsultation,
				referredBy: reportPatientData.referredBy,
				chiefComplaint: reportPatientData.chiefComplaint,
				onsetType: reportPatientData.onsetType,
				mechanismOfInjury: reportPatientData.mechanismOfInjury,
				painType: reportPatientData.painType,
				painIntensity: reportPatientData.painIntensity,
				clinicalDiagnosis: reportPatientData.clinicalDiagnosis,
				treatmentPlan: reportPatientData.treatmentPlan,
				followUpVisits: reportPatientData.followUpVisits,
				followUpAssessment: reportPatientData.followUpAssessment,
				currentPainStatus: reportPatientData.currentPainStatus,
				currentRom: reportPatientData.currentRom,
				currentStrength: reportPatientData.currentStrength,
				currentFunctionalAbility: reportPatientData.currentFunctionalAbility,
				complianceWithHEP: reportPatientData.complianceWithHEP,
				recommendations: reportPatientData.recommendations,
				physiotherapistRemarks: reportPatientData.physiotherapistRemarks,
				built: reportPatientData.built,
				posture: reportPatientData.posture,
				gaitAnalysis: reportPatientData.gaitAnalysis,
				mobilityAids: reportPatientData.mobilityAids,
				localObservation: reportPatientData.localObservation,
				swelling: reportPatientData.swelling,
				muscleWasting: reportPatientData.muscleWasting,
				postureManualNotes: reportPatientData.postureManualNotes,
				postureFileName: reportPatientData.postureFileName,
				postureFileData: reportPatientData.postureFileData,
				gaitManualNotes: reportPatientData.gaitManualNotes,
				gaitFileName: reportPatientData.gaitFileName,
				gaitFileData: reportPatientData.gaitFileData,
				tenderness: reportPatientData.tenderness,
				warmth: reportPatientData.warmth,
				scar: reportPatientData.scar,
				crepitus: reportPatientData.crepitus,
				odema: reportPatientData.odema,
				mmt: reportPatientData.mmt,
				specialTest: reportPatientData.specialTest,
				differentialDiagnosis: reportPatientData.differentialDiagnosis,
				finalDiagnosis: reportPatientData.finalDiagnosis,
				shortTermGoals: reportPatientData.shortTermGoals,
				longTermGoals: reportPatientData.longTermGoals,
				rehabProtocol: reportPatientData.rehabProtocol,
				advice: reportPatientData.advice,
				managementRemarks: reportPatientData.managementRemarks,
				nextFollowUpDate: reportPatientData.nextFollowUpDate,
				nextFollowUpTime: reportPatientData.nextFollowUpTime,
				totalSessionsRequired: reportPatientData.totalSessionsRequired,
				remainingSessions: reportPatientData.remainingSessions,
			};

			const hasReportData = Object.values(currentReportData).some(val => 
				val !== undefined && val !== null && val !== '' && 
				!(Array.isArray(val) && val.length === 0) &&
				!(typeof val === 'object' && Object.keys(val).length === 0)
			);

			if (hasReportData) {
				try {
					// Get session number - use current session number or calculate it
					let sessionNum = sessionNumber;
					if (!sessionNum) {
						const sessionInfo = await getSessionInfo(reportPatientData.patientId);
						sessionNum = sessionInfo.sessionNumber;
					}
					
					// If editing Session 1, use session 1, otherwise use calculated session number
					if (isEditingSession1) {
						sessionNum = 1;
					}
					
					// Query only physiotherapy versions to get the next version number
					let versionsQuery = query(
						collection(db, 'reportVersions'),
						where('patientId', '==', reportPatientData.patientId),
						where('reportType', '==', 'physiotherapy'),
						orderBy('version', 'desc')
					);
					let versionsSnapshot;
					try {
						versionsSnapshot = await getDocs(versionsQuery);
					} catch (queryError: any) {
						// If reportType filter fails, try without it and filter in memory
						if (queryError.code === 'failed-precondition' || queryError.message?.includes('index')) {
							const fallbackQuery = query(
								collection(db, 'reportVersions'),
								where('patientId', '==', reportPatientData.patientId),
								orderBy('version', 'desc')
							);
							versionsSnapshot = await getDocs(fallbackQuery);
							// Filter by reportType in memory
							versionsSnapshot = {
								...versionsSnapshot,
								docs: versionsSnapshot.docs.filter(doc => {
									const data = doc.data();
									return data.reportType === 'physiotherapy' || !data.reportType;
								})
							} as any;
						} else {
							throw queryError;
						}
					}
					const nextVersion = versionsSnapshot.docs.length > 0 
						? (versionsSnapshot.docs[0].data().version as number) + 1 
						: 1;

					await addDoc(collection(db, 'reportVersions'), {
						patientId: reportPatientData.patientId,
						patientName: reportPatientData.name,
						version: nextVersion,
						sessionNumber: sessionNum, // Add session number
						reportType: 'physiotherapy', // Add report type to distinguish from psychology
						reportData: removeUndefined(currentReportData),
						createdBy: user?.displayName || user?.email || 'Unknown',
						createdById: user?.uid || '',
						createdAt: serverTimestamp(),
					});
					// Update hasPhysiotherapyVersions since we just saved a version
					setHasPhysiotherapyVersions(true);
				} catch (versionError: any) {
					// If orderBy fails (missing index), try without it
					if (versionError.code === 'failed-precondition' || versionError.message?.includes('index')) {
						console.warn('Report version index not found, retrying without orderBy', versionError);
						try {
							// Retry query without orderBy, but still filter by reportType
							let versionsQueryWithoutOrder = query(
								collection(db, 'reportVersions'),
								where('patientId', '==', reportPatientData.patientId)
							);
							
							// Try to add reportType filter
							try {
								versionsQueryWithoutOrder = query(versionsQueryWithoutOrder, where('reportType', '==', 'physiotherapy'));
							} catch {
								// If reportType filter fails, filter in memory
							}
							
							const versionsSnapshot = await getDocs(versionsQueryWithoutOrder);
							
							// Manually sort by version number and filter by reportType if needed
							let versions = versionsSnapshot.docs.map(doc => ({
								id: doc.id,
								version: (doc.data().version as number) || 0,
								data: doc.data(),
								reportType: doc.data().reportType as string | undefined,
							}));
							
							// Filter by reportType in memory if not already filtered
							versions = versions.filter(v => v.reportType === 'physiotherapy' || (!v.reportType && v.reportType === undefined));
							versions.sort((a, b) => b.version - a.version);
							
							const nextVersion = versions.length > 0 
								? versions[0].version + 1 
								: 1;

							// Get session number
							let sessionNum = sessionNumber;
							if (!sessionNum) {
								const sessionInfo = await getSessionInfo(reportPatientData.patientId);
								sessionNum = sessionInfo.sessionNumber;
							}
							if (isEditingSession1) {
								sessionNum = 1;
							}
							
							// Save report snapshot
							await addDoc(collection(db, 'reportVersions'), {
								patientId: reportPatientData.patientId,
								patientName: reportPatientData.name,
								version: nextVersion,
								sessionNumber: sessionNum, // Add session number
								reportType: 'physiotherapy', // Add report type to distinguish from psychology
								reportData: removeUndefined(currentReportData),
								createdBy: user?.displayName || user?.email || 'Unknown',
								createdById: user?.uid || '',
								createdAt: serverTimestamp(),
							});
							// Update hasPhysiotherapyVersions since we just saved a version
							setHasPhysiotherapyVersions(true);
						} catch (retryError: any) {
							console.error('Failed to save report version even with fallback:', retryError);
							// Still continue - don't block the main save operation
						}
					} else {
						console.error('Failed to save report version:', versionError);
						// Still continue - don't block the main save operation
					}
				}
			}

			await updateDoc(patientRef, reportData);
			setReportPatientData((prev: any) => prev ? { ...prev, ...reportData } : null);
			
			const patientForProgress: PatientRecordFull = {
				...reportPatientData,
				id: patientDocIdToUse, // Add the document ID which is required by refreshPatientSessionProgress
				totalSessionsRequired: totalSessionsValue !== undefined && totalSessionsValue !== null
					? totalSessionsValue
					: reportPatientData.totalSessionsRequired,
				remainingSessions: sessionCompleted && reportData.remainingSessions !== undefined 
					? reportData.remainingSessions as number
					: reportPatientData.remainingSessions,
			};
			
			await markAppointmentCompletedForReport(patientForProgress, consultationDate, isExtraTreatment);
			
			const sessionProgress = await refreshPatientSessionProgress(
				patientForProgress,
				totalSessionsValue ?? null
			);

			const finalRemainingSessions = sessionCompleted && reportData.remainingSessions !== undefined
				? reportData.remainingSessions as number
				: sessionProgress?.remainingSessions;

			if (finalRemainingSessions !== undefined || sessionProgress) {
				const updates = {
					...(sessionProgress || {}),
					...(finalRemainingSessions !== undefined ? { remainingSessions: finalRemainingSessions } : {}),
					totalSessionsRequired: totalSessionsValue ?? reportPatientData.totalSessionsRequired,
				};
				
				setReportPatientData((prev: any) => (prev ? { ...prev, ...updates } : null));
				setFormData(prev => ({
					...prev,
					...(finalRemainingSessions !== undefined
						? { remainingSessions: finalRemainingSessions }
						: {}),
					...(sessionProgress?.remainingSessions !== undefined && !sessionCompleted
						? { remainingSessions: sessionProgress.remainingSessions }
						: {}),
					totalSessionsRequired: totalSessionsValue ?? prev.totalSessionsRequired ?? reportPatientData.totalSessionsRequired,
				}));
			}

			setSessionCompleted(false);
			setSavedMessage(true);
			setTimeout(() => setSavedMessage(false), 3000);
		} catch (error: any) {
			console.error('Failed to save report', error);
			const errorMessage = error?.message || 'Unknown error occurred';
			console.error('Error details:', {
				message: errorMessage,
				code: error?.code,
				stack: error?.stack,
			});
			alert(`Failed to save report: ${errorMessage}. Please check the console for more details.`);
		} finally {
			setSaving(false);
		}
	};

	// Handle print - generates and prints the same PDF that gets downloaded
	const handlePrintReport = async (sections?: ReportSection[]) => {
		try {
			if (activeReportTab === 'report') {
				const reportData = buildReportData();
				if (!reportData) {
					alert('No patient data available. Please try again.');
					return;
				}
				
				// Generate PDF and open print window
				await generatePhysiotherapyReportPDF(reportData, { forPrint: true, sections });
			} else if (activeReportTab === 'strength-conditioning') {
				if (!reportPatientData || !strengthConditioningFormData) {
					alert('No patient or strength conditioning data available. Please try again.');
					return;
				}
				
				await generateStrengthConditioningPDF({
					patient: {
						name: reportPatientData.name,
						patientId: reportPatientData.patientId,
						dob: reportPatientData.dob || '',
						gender: reportPatientData.gender || '',
						phone: reportPatientData.phone || '',
						email: reportPatientData.email || '',
					},
					formData: strengthConditioningFormData as StrengthConditioningData,
				}, { forPrint: true });
			}
		} catch (error) {
			console.error('Error printing PDF:', error);
			alert('Failed to print PDF. Please try again.');
		}
	};

	// Helper function to renumber versions sequentially
	const renumberVersionsSequentially = async (collectionName: string, patientId: string, reportType?: string): Promise<void> => {
		try {
			// Try with orderBy first
			try {
				const versionsQuery = query(
					collection(db, collectionName),
					where('patientId', '==', patientId),
					orderBy('version', 'asc')
				);
				const versionsSnapshot = await getDocs(versionsQuery);
				
				if (versionsSnapshot.docs.length === 0) return;
				
				// Check if versions are already sequential
				let needsRenumbering = false;
				versionsSnapshot.docs.forEach((docSnap, index) => {
					const currentVersion = docSnap.data().version as number;
					if (currentVersion !== index + 1) {
						needsRenumbering = true;
					}
				});
				
				if (needsRenumbering) {
					const batch = writeBatch(db);
					versionsSnapshot.docs.forEach((docSnap, index) => {
						const newVersionNumber = index + 1;
						const currentVersion = docSnap.data().version as number;
						if (currentVersion !== newVersionNumber) {
							batch.update(docSnap.ref, { version: newVersionNumber });
						}
					});
					await batch.commit();
				}
			} catch (orderByError: any) {
				// If orderBy fails, try without it and sort manually
				if (orderByError.code === 'failed-precondition' || orderByError.message?.includes('index')) {
					const versionsQuery = query(
						collection(db, collectionName),
						where('patientId', '==', patientId)
					);
					const versionsSnapshot = await getDocs(versionsQuery);
					const versions = versionsSnapshot.docs.map(docSnap => ({
						id: docSnap.id,
						ref: docSnap.ref,
						version: docSnap.data().version as number,
					})).sort((a, b) => a.version - b.version);
					
					if (versions.length === 0) return;
					
					// Check if versions are already sequential
					let needsRenumbering = false;
					versions.forEach((v, index) => {
						if (v.version !== index + 1) {
							needsRenumbering = true;
						}
					});
					
					if (needsRenumbering) {
						const batch = writeBatch(db);
						versions.forEach((v, index) => {
							const newVersionNumber = index + 1;
							if (v.version !== newVersionNumber) {
								batch.update(v.ref, { version: newVersionNumber });
							}
						});
						await batch.commit();
					}
				} else {
					throw orderByError;
				}
			}
		} catch (error) {
			console.warn('Failed to renumber versions sequentially', error);
			// Don't throw - continue loading versions even if renumbering fails
		}
	};

	// Load version history
	const loadVersionHistory = async () => {
		if (!patientId) return;

		setLoadingVersions(true);
		try {
			// Check if we're viewing strength conditioning or regular report
			if (activeReportTab === 'strength-conditioning') {
				// For strength conditioning, load from strengthConditioningReportVersions collection
				if (!reportPatientData?.patientId) {
					console.warn('Cannot load version history: reportPatientData.patientId is missing');
					setVersionHistory([]);
					return;
				}
				try {
					// First, renumber versions sequentially if needed
					await renumberVersionsSequentially('strengthConditioningReportVersions', reportPatientData.patientId);
					
					// Then load the renumbered versions
					const versionsQuery = query(
						collection(db, 'strengthConditioningReportVersions'),
						where('patientId', '==', reportPatientData.patientId),
						orderBy('version', 'desc')
					);
					const versionsSnapshot = await getDocs(versionsQuery);
					console.log(`Found ${versionsSnapshot.docs.length} strength conditioning versions for patient ${reportPatientData.patientId}`);
					const versions = versionsSnapshot.docs.map(doc => {
						const data = doc.data();
						const createdAt = (data.createdAt as Timestamp | undefined)?.toDate?.();
						return {
							id: doc.id,
							version: data.version as number,
							createdAt: createdAt ? createdAt.toISOString() : new Date().toISOString(),
							createdBy: (data.createdBy as string) || 'Unknown',
							data: (data.reportData as any) || {},
							isStrengthConditioning: true,
						};
					});
					setVersionHistory(versions);
				} catch (scError: any) {
					// If orderBy fails (missing index), try without it
					if (scError.code === 'failed-precondition' || scError.message?.includes('index')) {
						try {
							// First, renumber versions sequentially if needed
							await renumberVersionsSequentially('strengthConditioningReportVersions', reportPatientData.patientId);
							
							// Then load the renumbered versions
							const versionsQuery = query(
								collection(db, 'strengthConditioningReportVersions'),
								where('patientId', '==', reportPatientData.patientId)
							);
							const versionsSnapshot = await getDocs(versionsQuery);
							const versions = versionsSnapshot.docs.map(doc => {
								const data = doc.data();
								const createdAt = (data.createdAt as Timestamp | undefined)?.toDate?.();
								return {
									id: doc.id,
									version: data.version as number,
									createdAt: createdAt ? createdAt.toISOString() : new Date().toISOString(),
									createdBy: (data.createdBy as string) || 'Unknown',
									data: (data.reportData as any) || {},
									isStrengthConditioning: true,
								};
							});
							// Sort by version descending manually
							versions.sort((a, b) => b.version - a.version);
							setVersionHistory(versions);
						} catch (retryError: any) {
							console.error('Strength conditioning version history error:', retryError);
							// Don't show alert for missing index, just set empty array
							if (retryError.code !== 'failed-precondition' && !retryError.message?.includes('index')) {
								console.warn('Failed to load strength conditioning version history:', retryError);
							}
							setVersionHistory([]);
						}
					} else {
						console.error('Strength conditioning version history error:', scError);
						// Only show error if it's not a permission issue
						if (scError.code !== 'permission-denied') {
							console.warn('Failed to load strength conditioning version history:', scError);
						}
						setVersionHistory([]);
					}
				}
			} else if (activeReportTab === 'psychology') {
				// Psychology report version history - use psychologyReportVersions collection
				if (!reportPatientData?.patientId) {
					setVersionHistory([]);
					return;
				}
				try {
					// First, renumber versions sequentially if needed
					await renumberVersionsSequentially('psychologyReportVersions', reportPatientData.patientId);
					
					// Then load the renumbered versions
					const versionsQuery = query(
						collection(db, 'psychologyReportVersions'),
						where('patientId', '==', reportPatientData.patientId),
						orderBy('version', 'desc')
					);
					const versionsSnapshot = await getDocs(versionsQuery);
					const versions = versionsSnapshot.docs.map(doc => {
						const data = doc.data();
						const createdAt = (data.createdAt as Timestamp | undefined)?.toDate?.();
						return {
							id: doc.id,
							version: data.version as number,
							createdAt: createdAt ? createdAt.toISOString() : new Date().toISOString(),
							createdBy: (data.createdBy as string) || 'Unknown',
							data: (data.reportData as any) || {},
							isPsychology: true,
						};
					});
					setVersionHistory(versions);
				} catch (psychError: any) {
					// If orderBy fails (missing index), try without it
					if (psychError.code === 'failed-precondition' || psychError.message?.includes('index')) {
						try {
							await renumberVersionsSequentially('psychologyReportVersions', reportPatientData.patientId);
							const versionsQuery = query(
								collection(db, 'psychologyReportVersions'),
								where('patientId', '==', reportPatientData.patientId)
							);
							const versionsSnapshot = await getDocs(versionsQuery);
							const versions = versionsSnapshot.docs.map(doc => {
								const data = doc.data();
								const createdAt = (data.createdAt as Timestamp | undefined)?.toDate?.();
								return {
									id: doc.id,
									version: data.version as number,
									createdAt: createdAt ? createdAt.toISOString() : new Date().toISOString(),
									createdBy: (data.createdBy as string) || 'Unknown',
									data: (data.reportData as any) || {},
									isPsychology: true,
								};
							});
							versions.sort((a, b) => b.version - a.version);
							setVersionHistory(versions);
						} catch (retryError: any) {
							console.error('Psychology version history error:', retryError);
							if (retryError.code !== 'failed-precondition' && !retryError.message?.includes('index')) {
								console.warn('Failed to load psychology version history:', retryError);
							}
							setVersionHistory([]);
						}
					} else {
						console.error('Psychology version history error:', psychError);
						if (psychError.code !== 'permission-denied') {
							console.warn('Failed to load psychology version history:', psychError);
						}
						setVersionHistory([]);
					}
				}
			} else {
				// Physiotherapy report version history - filter by reportType
				if (!reportPatientData?.patientId) {
					setVersionHistory([]);
					return;
				}
				// First, renumber versions sequentially if needed (only for physiotherapy)
				await renumberVersionsSequentially('reportVersions', reportPatientData.patientId, 'physiotherapy');
				
				// Then load the renumbered versions - filter by reportType = 'physiotherapy'
				try {
					const versionsQuery = query(
						collection(db, 'reportVersions'),
						where('patientId', '==', reportPatientData.patientId),
						where('reportType', '==', 'physiotherapy'),
						orderBy('version', 'desc')
					);
					const versionsSnapshot = await getDocs(versionsQuery);
					const versions = versionsSnapshot.docs.map(doc => {
						const data = doc.data();
						const createdAt = (data.createdAt as Timestamp | undefined)?.toDate?.();
						return {
							id: doc.id,
							version: data.version as number,
							createdAt: createdAt ? createdAt.toISOString() : new Date().toISOString(),
							createdBy: (data.createdBy as string) || 'Unknown',
							data: (data.reportData as Partial<PatientRecordFull>) || {},
							isStrengthConditioning: false,
							isPsychology: false,
						};
					});
					setVersionHistory(versions);
				} catch (error: any) {
					// If orderBy fails or reportType filter fails, try without reportType filter (for backward compatibility)
					if (error.code === 'failed-precondition' || error.message?.includes('index')) {
						try {
							await renumberVersionsSequentially('reportVersions', reportPatientData.patientId, 'physiotherapy');
							const versionsQuery = query(
								collection(db, 'reportVersions'),
								where('patientId', '==', reportPatientData.patientId)
							);
							const versionsSnapshot = await getDocs(versionsQuery);
							// Filter by reportType in memory for backward compatibility
							const versions = versionsSnapshot.docs
								.map(doc => {
									const data = doc.data();
									const createdAt = (data.createdAt as Timestamp | undefined)?.toDate?.();
									return {
										id: doc.id,
										version: data.version as number,
										createdAt: createdAt ? createdAt.toISOString() : new Date().toISOString(),
										createdBy: (data.createdBy as string) || 'Unknown',
										data: (data.reportData as Partial<PatientRecordFull>) || {},
										isStrengthConditioning: false,
										isPsychology: false,
										reportType: data.reportType || 'physiotherapy', // Default to physiotherapy for old records
									};
								})
								.filter(v => v.reportType === 'physiotherapy' || !v.reportType); // Include old records without reportType
							versions.sort((a, b) => b.version - a.version);
							setVersionHistory(versions);
						} catch (retryError: any) {
							console.error('Failed to load physiotherapy version history:', retryError);
							setVersionHistory([]);
						}
					} else {
						console.error('Failed to load physiotherapy version history:', error);
						setVersionHistory([]);
					}
				}
			}
		} catch (error) {
			console.error('Failed to load report history', error);
			alert('Failed to load report history. Please try again.');
			setVersionHistory([]);
		} finally {
			setLoadingVersions(false);
		}
	};

	// Handle view version history
	const handleViewVersionHistory = async () => {
		setShowVersionHistory(true);
		setViewingVersionData(null);
		await loadVersionHistory();
	};

	// Toggle expanded version
	const toggleVersionExpansion = (versionId: string) => {
		setExpandedVersionId(expandedVersionId === versionId ? null : versionId);
	};

	// Handle delete version
	const handleDeleteVersion = async (version: typeof versionHistory[0]) => {
		if (!confirm(`Are you sure you want to delete Report #${version.version}? This action cannot be undone.`)) {
			return;
		}

		try {
			// Determine which collection to delete from based on report type
			const collectionName = activeReportTab === 'strength-conditioning' 
				? 'strengthConditioningReportVersions' 
				: activeReportTab === 'psychology'
				? 'psychologyReportVersions'
				: 'reportVersions';
			
			const versionRef = doc(db, collectionName, version.id);
			await deleteDoc(versionRef);
			
			// Get all remaining versions and renumber them sequentially
			try {
				let versionsQuery = query(
					collection(db, collectionName),
					where('patientId', '==', reportPatientData?.patientId)
				);
				
				// Add reportType filter for physiotherapy reports
				if (activeReportTab === 'report' && collectionName === 'reportVersions') {
					try {
						versionsQuery = query(versionsQuery, where('reportType', '==', 'physiotherapy'));
					} catch {
						// If reportType filter fails, filter in memory
					}
				}
				
				versionsQuery = query(versionsQuery, orderBy('version', 'asc'));
				const versionsSnapshot = await getDocs(versionsQuery);
				
				// Filter by reportType in memory if needed (for backward compatibility)
				let versionsToRenumber = versionsSnapshot.docs;
				if (activeReportTab === 'report' && collectionName === 'reportVersions') {
					versionsToRenumber = versionsSnapshot.docs.filter(docSnap => {
						const data = docSnap.data();
						return data.reportType === 'physiotherapy' || !data.reportType;
					});
				}
				
				if (versionsToRenumber.length > 0) {
					const batch = writeBatch(db);
					versionsToRenumber.forEach((docSnap, index) => {
						const newVersionNumber = index + 1;
						const currentVersion = docSnap.data().version as number;
						if (currentVersion !== newVersionNumber) {
							batch.update(docSnap.ref, { version: newVersionNumber });
						}
					});
					await batch.commit();
				}
			} catch (renumberError: any) {
				// If orderBy fails, try without it and sort manually
				if (renumberError.code === 'failed-precondition' || renumberError.message?.includes('index')) {
					try {
						let versionsQuery = query(
							collection(db, collectionName),
							where('patientId', '==', reportPatientData?.patientId)
						);
						
						// Add reportType filter for physiotherapy reports
						if (activeReportTab === 'report' && collectionName === 'reportVersions') {
							try {
								versionsQuery = query(versionsQuery, where('reportType', '==', 'physiotherapy'));
							} catch {
								// If reportType filter fails, filter in memory
							}
						}
						
						const versionsSnapshot = await getDocs(versionsQuery);
						let versions = versionsSnapshot.docs.map(docSnap => ({
							id: docSnap.id,
							ref: docSnap.ref,
							version: docSnap.data().version as number,
							reportType: docSnap.data().reportType as string | undefined,
						}));
						
						// Filter by reportType in memory if needed
						if (activeReportTab === 'report' && collectionName === 'reportVersions') {
							versions = versions.filter(v => v.reportType === 'physiotherapy' || !v.reportType);
						}
						
						versions.sort((a, b) => a.version - b.version);
						
						if (versions.length > 0) {
							const batch = writeBatch(db);
							versions.forEach((v, index) => {
								const newVersionNumber = index + 1;
								if (v.version !== newVersionNumber) {
									batch.update(v.ref, { version: newVersionNumber });
								}
							});
							await batch.commit();
						}
					} catch (retryError) {
						console.warn('Failed to renumber versions after deletion', retryError);
						// Continue anyway - versions will still be deleted
					}
				} else {
					console.warn('Failed to renumber versions after deletion', renumberError);
					// Continue anyway - versions will still be deleted
				}
			}
			
			// Reload version history
			await loadVersionHistory();
			
			// Update version flags after deletion
			if (reportPatientData?.patientId) {
				if (activeReportTab === 'psychology') {
					const versionsQuery = query(
						collection(db, 'psychologyReportVersions'),
						where('patientId', '==', reportPatientData.patientId)
					);
					getDocs(versionsQuery).then((snapshot) => {
						setHasPsychologyVersions(snapshot.docs.length > 0);
					}).catch((err) => {
						console.error('Error checking psychology report versions after delete:', err);
					});
				} else if (activeReportTab === 'strength-conditioning') {
					const versionsQuery = query(
						collection(db, 'strengthConditioningReportVersions'),
						where('patientId', '==', reportPatientData.patientId)
					);
					getDocs(versionsQuery).then((snapshot) => {
						setHasStrengthConditioningVersions(snapshot.docs.length > 0);
					}).catch((err) => {
						console.error('Error checking strength & conditioning report versions after delete:', err);
					});
				} else if (activeReportTab === 'report') {
					let physioVersionsQuery = query(
						collection(db, 'reportVersions'),
						where('patientId', '==', reportPatientData.patientId),
						where('reportType', '==', 'physiotherapy')
					);
					getDocs(physioVersionsQuery).then((snapshot) => {
						setHasPhysiotherapyVersions(snapshot.docs.length > 0);
					}).catch(() => {
						// If reportType filter fails, try without it
						const fallbackQuery = query(
							collection(db, 'reportVersions'),
							where('patientId', '==', reportPatientData.patientId)
						);
						getDocs(fallbackQuery).then((snapshot) => {
							const hasVersions = snapshot.docs.some(doc => {
								const data = doc.data();
								return data.reportType === 'physiotherapy' || !data.reportType;
							});
							setHasPhysiotherapyVersions(hasVersions);
						}).catch((err) => {
							console.error('Error checking physiotherapy report versions after delete:', err);
						});
					});
				}
			}
		} catch (error) {
			console.error('Failed to delete version', error);
			alert(`Failed to delete version: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	};

	// Handle restore version
	const handleRestoreVersion = async (version: typeof versionHistory[0]) => {
		if (!reportPatientData?.id || !confirm(`Are you sure you want to load Report #${version.version}? This will replace the current report data and save the current state as a new report.`)) {
			return;
		}

		// Determine which save function to use based on report type
		if (version.isStrengthConditioning || activeReportTab === 'strength-conditioning') {
			// Handle strength conditioning restore
			if (strengthConditioningFormData && Object.keys(strengthConditioningFormData).length > 0) {
				// Save current state first
				await handleSaveStrengthConditioning();
			}
			setStrengthConditioningFormData(version.data as StrengthConditioningData);
			alert(`Strength & Conditioning Report #${version.version} has been loaded successfully.`);
			return;
		}
		
		if (version.isPsychology || activeReportTab === 'psychology') {
			// Handle psychology restore
			if (psychologyFormData && Object.keys(psychologyFormData).length > 0) {
				// Save current state first
				await handleSavePsychology();
			}
			setPsychologyFormData(version.data as any);
			alert(`Psychology Report #${version.version} has been loaded successfully.`);
			return;
		}

		setSaving(true);
		try {
			const patientRef = doc(db, 'patients', reportPatientData.id);

			// Create a report snapshot of current data before loading previous report (physiotherapy only)
			const currentReportData: Partial<PatientRecordFull> = {
				history: reportPatientData.history || (reportPatientData.presentHistory || '') + (reportPatientData.pastHistory ? '\n' + reportPatientData.pastHistory : ''),
				med_xray: reportPatientData.med_xray,
				med_mri: reportPatientData.med_mri,
				med_report: reportPatientData.med_report,
				med_ct: reportPatientData.med_ct,
				surgicalHistory: reportPatientData.surgicalHistory,
				per_smoking: reportPatientData.per_smoking,
				per_drinking: reportPatientData.per_drinking,
				per_alcohol: reportPatientData.per_alcohol,
				per_drugs: reportPatientData.per_drugs,
				drugsText: reportPatientData.drugsText,
				sleepCycle: reportPatientData.sleepCycle,
				hydration: reportPatientData.hydration,
				nutrition: reportPatientData.nutrition,
				siteSide: reportPatientData.siteSide,
				onset: reportPatientData.onset,
				duration: reportPatientData.duration,
				natureOfInjury: reportPatientData.natureOfInjury,
				typeOfPain: reportPatientData.typeOfPain,
				vasScale: reportPatientData.vasScale,
				aggravatingFactor: reportPatientData.aggravatingFactor,
				relievingFactor: reportPatientData.relievingFactor,
				rom: reportPatientData.rom,
				treatmentProvided: reportPatientData.treatmentProvided,
				progressNotes: reportPatientData.progressNotes,
				physioName: reportPatientData.physioName,
				physioId: reportPatientData.physioId,
				dateOfConsultation: reportPatientData.dateOfConsultation,
				referredBy: reportPatientData.referredBy,
				chiefComplaint: reportPatientData.chiefComplaint,
				onsetType: reportPatientData.onsetType,
				mechanismOfInjury: reportPatientData.mechanismOfInjury,
				painType: reportPatientData.painType,
				painIntensity: reportPatientData.painIntensity,
				clinicalDiagnosis: reportPatientData.clinicalDiagnosis,
				treatmentPlan: reportPatientData.treatmentPlan,
				followUpVisits: reportPatientData.followUpVisits,
				followUpAssessment: reportPatientData.followUpAssessment,
				currentPainStatus: reportPatientData.currentPainStatus,
				currentRom: reportPatientData.currentRom,
				currentStrength: reportPatientData.currentStrength,
				currentFunctionalAbility: reportPatientData.currentFunctionalAbility,
				complianceWithHEP: reportPatientData.complianceWithHEP,
				recommendations: reportPatientData.recommendations,
				physiotherapistRemarks: reportPatientData.physiotherapistRemarks,
				built: reportPatientData.built,
				posture: reportPatientData.posture,
				gaitAnalysis: reportPatientData.gaitAnalysis,
				mobilityAids: reportPatientData.mobilityAids,
				localObservation: reportPatientData.localObservation,
				swelling: reportPatientData.swelling,
				muscleWasting: reportPatientData.muscleWasting,
				postureManualNotes: reportPatientData.postureManualNotes,
				postureFileName: reportPatientData.postureFileName,
				postureFileData: reportPatientData.postureFileData,
				gaitManualNotes: reportPatientData.gaitManualNotes,
				gaitFileName: reportPatientData.gaitFileName,
				gaitFileData: reportPatientData.gaitFileData,
				tenderness: reportPatientData.tenderness,
				warmth: reportPatientData.warmth,
				scar: reportPatientData.scar,
				crepitus: reportPatientData.crepitus,
				odema: reportPatientData.odema,
				mmt: reportPatientData.mmt,
				specialTest: reportPatientData.specialTest,
				differentialDiagnosis: reportPatientData.differentialDiagnosis,
				finalDiagnosis: reportPatientData.finalDiagnosis,
				shortTermGoals: reportPatientData.shortTermGoals,
				longTermGoals: reportPatientData.longTermGoals,
				rehabProtocol: reportPatientData.rehabProtocol,
				advice: reportPatientData.advice,
				managementRemarks: reportPatientData.managementRemarks,
				nextFollowUpDate: reportPatientData.nextFollowUpDate,
				nextFollowUpTime: reportPatientData.nextFollowUpTime,
			};

			// Check if there's current report data to save as previous report
			const hasCurrentData = Object.values(currentReportData).some(val => 
				val !== undefined && val !== null && val !== '' && 
				!(Array.isArray(val) && val.length === 0) &&
				!(typeof val === 'object' && Object.keys(val).length === 0)
			);

			// Save current state as report before loading previous report (physiotherapy only)
			if (hasCurrentData) {
				// Query only physiotherapy versions to get the next version number
				let versionsQuery = query(
					collection(db, 'reportVersions'),
					where('patientId', '==', reportPatientData.patientId),
					where('reportType', '==', 'physiotherapy'),
					orderBy('version', 'desc')
				);
				let versionsSnapshot;
				try {
					versionsSnapshot = await getDocs(versionsQuery);
				} catch (queryError: any) {
					// If reportType filter fails, try without it and filter in memory
					if (queryError.code === 'failed-precondition' || queryError.message?.includes('index')) {
						const fallbackQuery = query(
							collection(db, 'reportVersions'),
							where('patientId', '==', reportPatientData.patientId),
							orderBy('version', 'desc')
						);
						versionsSnapshot = await getDocs(fallbackQuery);
						// Filter by reportType in memory
						versionsSnapshot = {
							...versionsSnapshot,
							docs: versionsSnapshot.docs.filter(doc => {
								const data = doc.data();
								return data.reportType === 'physiotherapy' || !data.reportType;
							})
						} as any;
					} else {
						throw queryError;
					}
				}
				const nextVersion = versionsSnapshot.docs.length > 0 
					? (versionsSnapshot.docs[0].data().version as number) + 1 
					: 1;

				await addDoc(collection(db, 'reportVersions'), {
					patientId: reportPatientData.patientId,
					patientName: reportPatientData.name,
					version: nextVersion,
					reportType: 'physiotherapy',
					reportData: removeUndefined(currentReportData),
					createdBy: user?.displayName || user?.email || 'Unknown',
					createdById: user?.uid || '',
					createdAt: serverTimestamp(),
					restoredFrom: version.version, // Track that this was created from a restore
				});
			}

			// Load the version data into the form (physiotherapy only)
			setFormData(version.data as Partial<PatientRecordFull>);
			
			// Update the patient document with restored data
			const reportData: Record<string, any> = {
				...version.data,
				updatedAt: serverTimestamp(),
			};
			await updateDoc(patientRef, reportData);

			// Reload report history to show the new report
			await loadVersionHistory();

			alert(`Report #${version.version} has been loaded successfully.`);
		} catch (error) {
			console.error('Failed to load report', error);
			alert('Failed to load report. Please try again.');
		} finally {
			setSaving(false);
		}
	};

	// Crisp report handlers
	const handleCrispReport = () => {
		setShowCrispReportModal(true);
	};

	const handleCrispReportPrint = async () => {
		setShowCrispReportModal(false);
		await handlePrintReport(selectedSections);
	};

	const handleCrispReportDownload = async () => {
		if (!reportPatientData) return;
		setShowCrispReportModal(false);
		await handleDownloadReportPDF(selectedSections);
	};

	const allSections: Array<{ key: ReportSection; label: string }> = [
		{ key: 'patientInformation', label: 'Patient Information' },
		{ key: 'assessmentOverview', label: 'Assessment Overview' },
		{ key: 'painAssessment', label: 'Pain Assessment' },
		{ key: 'onObservation', label: 'On Observation' },
		{ key: 'onPalpation', label: 'On Palpation' },
		{ key: 'rom', label: 'ROM (Range of Motion)' },
		{ key: 'mmt', label: 'Manual Muscle Testing' },
		{ key: 'advancedAssessment', label: 'Advanced Assessment' },
		{ key: 'physiotherapyManagement', label: 'Physiotherapy Management' },
		{ key: 'followUpVisits', label: 'Follow-Up Visits' },
		{ key: 'currentStatus', label: 'Current Status' },
		{ key: 'nextFollowUp', label: 'Next Follow-Up Details' },
		{ key: 'signature', label: 'Physiotherapist Signature' },
	];

	const toggleSection = (section: ReportSection) => {
		setSelectedSections(prev =>
			prev.includes(section)
				? prev.filter(s => s !== section)
				: [...prev, section]
		);
	};

	// Field change handlers for report form
	const handleFieldChange = (field: keyof PatientRecordFull | string, value: any) => {
		if (!editable) return;
		setFormData(prev => ({ ...prev, [field]: value }));
		
		// Update subsequent date state when dateOfConsultation changes
		if (field === 'dateOfConsultation') {
			setIsSubsequentDatePhysio(isDateOnDifferentDay(value));
			
			// Check if selected date matches first report date (Session 1)
			if (value && firstReportDate) {
				const selectedDate = new Date(value).toISOString().split('T')[0];
				const firstDate = new Date(firstReportDate).toISOString().split('T')[0];
				
				if (selectedDate === firstDate) {
					// Switch to Session 1 edit mode
					setIsEditingSession1(true);
					setSessionNumber(1);
					// Load the first report data if available
					if (reportPatientData && reportPatientData.dateOfConsultation === firstDate) {
						// Already have the data, just switch mode
					}
				} else {
					// Not Session 1, use calculated session number
					setIsEditingSession1(false);
				}
			} else if (!firstReportDate) {
				// No first report exists yet, this will be Session 1
				setIsEditingSession1(true);
				setSessionNumber(1);
			}
		}
	};

	const handleCheckboxChange = (field: keyof PatientRecordFull | string, checked: boolean) => {
		if (!editable) return;
		setFormData(prev => ({ ...prev, [field]: checked }));
	};

	// Field change handler for strength conditioning form
	const handleStrengthConditioningChange = (field: keyof StrengthConditioningData, value: any) => {
		if (!editable) return;
		setStrengthConditioningFormData(prev => ({ ...prev, [field]: value }));
	};


	const handleClose = () => {
		setViewingVersionData(null);
		if (strengthConditioningUnsubscribeRef.current) {
			strengthConditioningUnsubscribeRef.current();
			strengthConditioningUnsubscribeRef.current = null;
		}
		onClose();
	};

	if (!isOpen || !patientId) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
			<div className="flex w-full max-w-5xl max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
				<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
					<h2 className="text-lg font-semibold text-slate-900">Edit Patient Report</h2>
					<button
						type="button"
						onClick={handleClose}
						className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none"
						aria-label="Close"
					>
						<i className="fas fa-times" aria-hidden="true" />
					</button>
				</header>
				
				{/* Tab Navigation */}
				<div className="border-b border-slate-200 px-6">
					<nav className="flex gap-4" aria-label="Report tabs">
						{activeReportTab === 'report' && (
							<button
								type="button"
								onClick={() => {
									setActiveReportTab('report');
									setSessionCompleted(false);
									setIsEditingLoadedPsychologyVersion(false);
								}}
								className={`px-4 py-3 text-sm font-medium transition border-b-2 ${
									activeReportTab === 'report'
										? 'border-sky-600 text-sky-600'
										: 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
								}`}
							>
								<i className="fas fa-file-medical mr-2" aria-hidden="true" />
								Physiotherapy
							</button>
						)}
						{activeReportTab === 'strength-conditioning' && (
							<button
								type="button"
								onClick={() => {
									setActiveReportTab('strength-conditioning');
									setSessionCompleted(false);
									setIsEditingLoadedPsychologyVersion(false);
								}}
								className={`px-4 py-3 text-sm font-medium transition border-b-2 ${
									activeReportTab === 'strength-conditioning'
										? 'border-sky-600 text-sky-600'
										: 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
								}`}
							>
								<i className="fas fa-dumbbell mr-2" aria-hidden="true" />
								Strength & Conditioning
							</button>
						)}
						{activeReportTab === 'psychology' && (
							<button
								type="button"
								onClick={() => {
									setActiveReportTab('psychology');
									setSessionCompleted(false);
								}}
								className={`px-4 py-3 text-sm font-medium transition border-b-2 ${
									activeReportTab === 'psychology'
										? 'border-sky-600 text-sky-600'
										: 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
								}`}
							>
								<i className="fas fa-brain mr-2" aria-hidden="true" />
								Psychology
							</button>
						)}
					</nav>
				</div>

				<div className="flex-1 overflow-y-auto px-6 py-6">
					{loadingReport ? (
						<div className="text-center py-12">
							<div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-slate-900 border-r-transparent"></div>
							<p className="mt-4 text-sm text-slate-600">Loading report data...</p>
						</div>
					) : reportPatientData && activeReportTab === 'report' ? (
						<div className="space-y-6">
							{savedMessage && (
								<div className="mb-6 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3">
									<div className="flex items-center">
										<i className="fas fa-check text-emerald-600 mr-2" aria-hidden="true" />
										<p className="text-sm font-medium text-emerald-800">Report saved successfully!</p>
									</div>
								</div>
							)}

							{/* Patient Information */}
							<div className="mb-8 border-b border-slate-200 pb-6">
								<h2 className="mb-4 text-xl font-bold text-sky-600">Physiotherapy Report</h2>
								<div className="mb-4 text-right text-sm text-slate-600">
									<div>
										<b>Clinic:</b> Centre For Sports Science, Kanteerava Stadium
									</div>
									{headerConfig?.associationText && (
										<div className="mt-1 text-xs text-slate-500">
											{headerConfig.associationText}
										</div>
									)}
									{headerConfig?.govermentOrder && (
										<div className="mt-1 text-xs text-slate-500">
											{headerConfig.govermentOrder}
										</div>
									)}
									<div className="mt-1">
										<b>Date:</b> {currentDate || '—'}
									</div>
								</div>
								<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
									<div>
										<label className="block text-xs font-medium text-slate-500">Patient Name</label>
										<input
											type="text"
											value={reportPatientData.name || ''}
											readOnly
											className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Type of Organization</label>
										<input
											type="text"
											value={reportPatientData.patientType || '—'}
											readOnly
											className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Patient ID</label>
										<input
											type="text"
											value={reportPatientData.patientId || ''}
											readOnly
											className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Date of Birth</label>
										<input
											type="date"
											value={reportPatientData.dob || ''}
											readOnly
											className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Total Sessions Required</label>
										<input
											type="number"
											min={0}
											value={formData.totalSessionsRequired ?? ''}
											onChange={e => {
												const raw = e.target.value;
												const numericValue = Number(raw);
												const sanitized =
													raw === '' || Number.isNaN(numericValue)
														? undefined
														: Math.max(numericValue, 0);

												setFormData(prev => {
													const total = sanitized;

													if (total === undefined) {
														return {
															...prev,
															totalSessionsRequired: undefined,
															remainingSessions: undefined,
														};
													}

													const baselineTotal =
														typeof prev.totalSessionsRequired === 'number' && !Number.isNaN(prev.totalSessionsRequired)
															? prev.totalSessionsRequired
															: typeof reportPatientData?.totalSessionsRequired === 'number'
																? reportPatientData.totalSessionsRequired
																: undefined;

													const baselineRemaining =
														typeof prev.remainingSessions === 'number' && !Number.isNaN(prev.remainingSessions)
															? prev.remainingSessions
															: typeof reportPatientData?.remainingSessions === 'number'
																? reportPatientData.remainingSessions
																: undefined;

													const completedSessions =
														typeof baselineTotal === 'number' &&
														typeof baselineRemaining === 'number'
															? Math.max(0, baselineTotal - 1 - baselineRemaining)
															: undefined;

													const nextRemaining =
														typeof completedSessions === 'number'
															? Math.max(0, total - completedSessions)
															: total;

													return {
														...prev,
														totalSessionsRequired: total,
														remainingSessions: nextRemaining,
													};
												});
											}}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Remaining Sessions</label>
										<input
											type="number"
											min={0}
											value={displayedRemainingSessions ?? ''}
											readOnly
											className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
										/>
									</div>
								</div>

								{/* Package Information */}
								{(reportPatientData?.packageAmount || reportPatientData?.packageName) && (
									<div className="mt-4 rounded-lg border-2 border-purple-200 bg-purple-50/50 p-4">
										<h4 className="mb-3 text-sm font-semibold text-purple-900">Package Information</h4>
										<div className="grid gap-3 sm:grid-cols-2">
											{reportPatientData.packageName && (
												<div>
													<label className="block text-xs font-medium text-slate-600">Package Name</label>
													<p className="mt-1 text-sm font-semibold text-slate-900">{reportPatientData.packageName}</p>
												</div>
											)}
											{typeof reportPatientData.totalSessionsRequired === 'number' && (
												<div>
													<label className="block text-xs font-medium text-slate-600">Total Sessions</label>
													<p className="mt-1 text-sm font-semibold text-slate-900">{reportPatientData.totalSessionsRequired}</p>
												</div>
											)}
											{typeof reportPatientData.remainingSessions === 'number' && (
												<div>
													<label className="block text-xs font-medium text-slate-600">Remaining Sessions</label>
													<p className="mt-1 text-sm font-semibold text-slate-900">{reportPatientData.remainingSessions}</p>
												</div>
											)}
											{typeof reportPatientData.packageAmount === 'number' && (
												<div>
													<label className="block text-xs font-medium text-slate-600">Package Amount</label>
													<p className="mt-1 text-sm font-semibold text-slate-900">₹{reportPatientData.packageAmount.toFixed(2)}</p>
												</div>
											)}
											{reportPatientData.paymentType && (
												<div>
													<label className="block text-xs font-medium text-slate-600">Consultation Type</label>
													<p className="mt-1 text-sm font-semibold text-slate-900">
														{reportPatientData.paymentType === 'with' ? 'With Consultation' : 'Without Consultation'}
													</p>
												</div>
											)}
											{typeof reportPatientData.concessionPercent === 'number' && reportPatientData.concessionPercent > 0 && (
												<div>
													<label className="block text-xs font-medium text-slate-600">Discount</label>
													<p className="mt-1 text-sm font-semibold text-green-600">{reportPatientData.concessionPercent}%</p>
												</div>
											)}
											{reportPatientData.packageDescription && (
												<div className="sm:col-span-2">
													<label className="block text-xs font-medium text-slate-600">Description</label>
													<p className="mt-1 text-sm text-slate-700">{reportPatientData.packageDescription}</p>
												</div>
											)}
										</div>
									</div>
								)}
							</div>

							{/* Date of Consultation - Always visible */}
							<div className="mb-8 border-b border-slate-200 pb-4">
								<div className="flex items-center justify-between mb-4">
									<h3 className="text-sm font-semibold text-sky-600">Report Date</h3>
									{sessionNumber && (
										<div className="px-3 py-1 rounded-full bg-sky-100 text-sky-700 text-xs font-semibold">
											{isEditingSession1 ? 'Session 1 - Initial Assessment' : `Session ${sessionNumber} - Follow-up Assessment`}
										</div>
									)}
								</div>
								<div className="grid gap-4 sm:grid-cols-2">
									<div>
										<label className="block text-xs font-medium text-slate-500">Date of Consultation</label>
										<input
											type="date"
											value={formData.dateOfConsultation || new Date().toISOString().split('T')[0]}
											onChange={e => handleFieldChange('dateOfConsultation', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
										{firstReportDate && (
											<p className="mt-1 text-xs text-slate-500">
												First report date: {new Date(firstReportDate).toLocaleDateString()}
											</p>
										)}
									</div>
								</div>
							</div>

							{/* Show Follow-up form only if NOT editing Session 1 AND it's a subsequent date */}
							{!isEditingSession1 && (isSubsequentDatePhysio || (sessionNumber && sessionNumber > 1)) ? (
								<>
									{/* Simplified Follow-Up Form for Subsequent Dates */}
									<div className="mb-8">
										<div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
											<p className="text-sm text-blue-800">
												<i className="fas fa-info-circle mr-2" aria-hidden="true" />
												This is a follow-up visit. Please update the follow-up assessment, progress, and treatment details.
											</p>
										</div>

										{/* Follow-up Assessment */}
										<div className="mb-8">
											<h3 className="mb-4 text-sm font-semibold text-sky-600">Follow-up Assessment</h3>
											<textarea
												value={formData.followUpAssessment || ''}
												onChange={e => handleFieldChange('followUpAssessment', e.target.value)}
												className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
												rows={5}
												placeholder="Enter follow-up assessment details..."
											/>
										</div>


										{/* Treatment */}
										<div className="mb-8">
											<div className="flex items-center justify-between mb-2">
												<h3 className="text-sm font-semibold text-sky-600">Treatment</h3>
												<ExerciseLibrarySelector
													onSelectExercises={(exercises) => {
														const currentValue = formData.treatmentProvided || '';
														handleFieldChange('treatmentProvided', currentValue ? `${currentValue}\n\n${exercises}` : exercises);
													}}
													currentValue={formData.treatmentProvided}
													mode="treatment-provided"
												/>
											</div>
											<textarea
												value={formData.treatmentProvided || ''}
												onChange={e => handleFieldChange('treatmentProvided', e.target.value)}
												className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
												rows={6}
												placeholder="Enter treatment provided or use Exercise Library to select exercises..."
											/>
										</div>
									</div>
								</>
							) : (
								<>
							{/* Assessment Section */}
							<div className="mb-8">
								<h3 className="mb-4 text-sm font-semibold text-sky-600">Assessment</h3>
								<div className="grid gap-4 sm:grid-cols-2">
									<div>
										<label className="block text-xs font-medium text-slate-500">Referred by</label>
										<input
											type="text"
											value={formData.referredBy || ''}
											onChange={e => handleFieldChange('referredBy', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											placeholder="Enter referring doctor or source"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Chief complaints</label>
										<textarea
											value={formData.chiefComplaint || ''}
											onChange={e => handleFieldChange('chiefComplaint', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											rows={3}
											placeholder="Enter chief complaints"
										/>
									</div>
								</div>
							</div>

							{/* 1. Subjective Assessment - History of Present Illness (HOPI) */}
							<div className="mb-8">
								<h3 className="mb-4 text-sm font-semibold text-sky-600">1. Subjective Assessment</h3>
								<div>
									<label className="block text-xs font-medium text-slate-500 mb-2">History of Present Illness (HOPI)</label>
									<p className="text-xs text-slate-500 mb-2">Please describe the history of the present condition detailedly.</p>
									<textarea
										value={formData.historyOfPresentIllness || formData.history || ''}
										onChange={e => handleFieldChange('historyOfPresentIllness', e.target.value)}
										className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										rows={6}
										placeholder="Enter detailed history of present illness..."
									/>
								</div>
							</div>

							{/* 2. Pain Assessment Section */}
							<div className="mb-8">
								<h3 className="mb-4 text-sm font-semibold text-sky-600">2. Pain Assessment</h3>
								
								{/* Pain Mapping System */}
								<div className="mb-4">
									<label className="block text-xs font-medium text-slate-500 mb-2">Pain Mapping System</label>
									<p className="text-xs text-slate-500 mb-2">Mark the area of pain:</p>
									<input
										type="text"
										value={formData.painLocation || formData.siteSide || ''}
										onChange={e => handleFieldChange('painLocation', e.target.value)}
										className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										placeholder="Enter location description of pain"
									/>
								</div>

								{/* Pain Characteristics */}
								<div className="mb-4">
									<label className="block text-xs font-medium text-slate-500 mb-2">Pain Characteristics</label>
									<div className="grid gap-4 sm:grid-cols-2">
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">Type of Pain</label>
											<select
												value={formData.painType || ''}
												onChange={e => handleFieldChange('painType', e.target.value)}
												className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											>
												<option value="">Select type</option>
												<option value="Sharp">Sharp</option>
												<option value="Dull">Dull</option>
												<option value="Throbbing">Throbbing</option>
												<option value="Burning">Burning</option>
												<option value="Aching">Aching</option>
												<option value="Radiating">Radiating</option>
												<option value="Numbness">Numbness</option>
												<option value="Other">Other</option>
											</select>
										</div>
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-2">VAS Scale (Visual Analog Scale)</label>
											<div className="flex items-center gap-2">
												<span className="text-xs font-semibold text-slate-500">0</span>
												<input
													type="range"
													min="0"
													max="10"
													value={vasValue}
													onChange={e => handleFieldChange('vasScale', e.target.value)}
													className="flex-1 h-2 bg-gradient-to-r from-emerald-400 via-amber-400 to-rose-500 rounded-lg appearance-none cursor-pointer"
												/>
												<span className="text-xs font-semibold text-slate-500">10</span>
											</div>
											<div className="mt-2 text-center">
												<span className="text-xs text-slate-600 font-medium">{vasValue}/10 {vasValue === 0 ? '(No Pain)' : vasValue === 10 ? '(Worst Pain)' : ''}</span>
											</div>
										</div>
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">Aggravating Factors</label>
											<p className="text-xs text-slate-500 mb-1">What makes the pain worse?</p>
											<input
												type="text"
												value={formData.aggravatingFactor || ''}
												onChange={e => handleFieldChange('aggravatingFactor', e.target.value)}
												className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
												placeholder="Enter aggravating factors"
											/>
										</div>
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">Relieving Factors</label>
											<p className="text-xs text-slate-500 mb-1">What makes the pain better?</p>
											<input
												type="text"
												value={formData.relievingFactor || ''}
												onChange={e => handleFieldChange('relievingFactor', e.target.value)}
												className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
												placeholder="Enter relieving factors"
											/>
										</div>
									</div>
								</div>
							</div>

							{/* 3. Medical History */}
							<div className="mb-8">
								<h3 className="mb-4 text-sm font-semibold text-sky-600">3. Medical History</h3>
								<div className="grid gap-4 sm:grid-cols-1">
									<div>
										<label className="block text-xs font-medium text-slate-500 mb-2">Past Medical History</label>
										<textarea
											value={formData.pastMedicalHistory || ''}
											onChange={e => handleFieldChange('pastMedicalHistory', e.target.value)}
											className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											rows={4}
											placeholder="Enter past medical history"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500 mb-2">Past Surgical History</label>
										<textarea
											value={formData.surgicalHistory || ''}
											onChange={e => handleFieldChange('surgicalHistory', e.target.value)}
											className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											rows={4}
											placeholder="Enter past surgical history"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500 mb-2">Relevant History</label>
										<textarea
											value={formData.relevantHistory || ''}
											onChange={e => handleFieldChange('relevantHistory', e.target.value)}
											className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											rows={4}
											placeholder="Enter any other relevant history"
										/>
									</div>
								</div>
							</div>

							{/* 4. Objective Assessment - Observation */}
							<div className="mb-8">
								<h3 className="mb-4 text-sm font-semibold text-sky-600">4. Objective Assessment - Observation</h3>
								
								{/* Local Observation (Area of Pain) */}
								<div className="mb-4">
									<label className="block text-xs font-medium text-slate-500 mb-2">Local Observation (Area of Pain)</label>
									<p className="text-xs text-slate-500 mb-2">Please enter details below</p>
									<div className="space-y-2">
										<input
											type="text"
											value={formData.localObservation1 || ''}
											onChange={e => handleFieldChange('localObservation1', e.target.value)}
											className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											placeholder="Local observation detail 1"
										/>
										<input
											type="text"
											value={formData.localObservation2 || ''}
											onChange={e => handleFieldChange('localObservation2', e.target.value)}
											className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											placeholder="Local observation detail 2"
										/>
										<input
											type="text"
											value={formData.localObservation3 || ''}
											onChange={e => handleFieldChange('localObservation3', e.target.value)}
											className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											placeholder="Local observation detail 3"
										/>
										<input
											type="text"
											value={formData.localObservation4 || ''}
											onChange={e => handleFieldChange('localObservation4', e.target.value)}
											className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											placeholder="Local observation detail 4"
										/>
									</div>
								</div>

								{/* Systemic Observation */}
								<div className="grid gap-4 sm:grid-cols-2">
									<div>
										<label className="block text-xs font-medium text-slate-500 mb-1">Posture</label>
										<input
											type="text"
											value={formData.posture || ''}
											onChange={e => handleFieldChange('posture', e.target.value)}
											className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											placeholder="Enter posture observation"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500 mb-1">Gait</label>
										<input
											type="text"
											value={formData.gait || formData.gaitAnalysis || ''}
											onChange={e => handleFieldChange('gait', e.target.value)}
											className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											placeholder="Enter gait observation"
										/>
									</div>
								</div>
							</div>

							{/* 5. Objective Assessment - Palpation */}
							<div className="mb-8">
								<h3 className="mb-4 text-sm font-semibold text-sky-600">5. Objective Assessment - Palpation</h3>
								<div className="space-y-4">
									<div>
										<label className="block text-xs font-medium text-slate-500 mb-2">Tenderness</label>
										<input
											type="text"
											value={formData.tenderness1 || formData.tenderness || ''}
											onChange={e => handleFieldChange('tenderness1', e.target.value)}
											className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 mb-2"
											placeholder="Tenderness detail 1"
										/>
										<input
											type="text"
											value={formData.tenderness2 || ''}
											onChange={e => handleFieldChange('tenderness2', e.target.value)}
											className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											placeholder="Tenderness detail 2"
										/>
									</div>
									<div className="grid gap-4 sm:grid-cols-2">
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">Temperature</label>
											<input
												type="text"
												value={formData.temperature || formData.warmth || ''}
												onChange={e => handleFieldChange('temperature', e.target.value)}
												className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
												placeholder="e.g., Normal, Elevated"
											/>
										</div>
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">ADIMA / Edema</label>
											<input
												type="text"
												value={formData.adimaEdema || formData.odema || ''}
												onChange={e => handleFieldChange('adimaEdema', e.target.value)}
												className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
												placeholder="Enter ADIMA/Edema details"
											/>
										</div>
										<div className="sm:col-span-2">
											<label className="block text-xs font-medium text-slate-500 mb-1">Other Signs of Inflammation</label>
											<input
												type="text"
												value={formData.otherSignsOfInflammation || ''}
												onChange={e => handleFieldChange('otherSignsOfInflammation', e.target.value)}
												className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
												placeholder="Enter other signs of inflammation"
											/>
										</div>
									</div>
								</div>
							</div>

							{/* 6. On Examination */}
							<div className="mb-8">
								<h3 className="mb-4 text-sm font-semibold text-sky-600">6. On Examination</h3>
								<div className="mb-4">
									<h4 className="mb-3 text-sm font-semibold text-slate-700">i) Range of Motion Assessment</h4>
									<div className="mb-4 flex items-center gap-3">
										<select
											value={selectedRomJoint}
											onChange={e => setSelectedRomJoint(e.target.value)}
											className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											style={{ maxWidth: '220px' }}
										>
											<option value="">--Select Joint--</option>
											{ROM_JOINTS.map(joint => (
												<option key={joint} value={joint}>
													{joint}
												</option>
											))}
										</select>
										<button
											type="button"
											onClick={handleAddRomJoint}
											className="inline-flex items-center rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 focus-visible:outline-none disabled:opacity-50"
											disabled={!selectedRomJoint}
										>
											<i className="fas fa-plus text-xs mr-1" aria-hidden="true" />
											Add Joint
										</button>
										<button
											type="button"
											onClick={() => romFileInputRef.current?.click()}
											className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-green-700 focus-visible:outline-none"
											title="Upload image or file"
										>
											<i className="fas fa-upload text-xs" aria-hidden="true" />
											Upload
										</button>
										<input
											ref={romFileInputRef}
											type="file"
											accept="image/*,.pdf"
											onChange={handleRomImageUpload}
											className="hidden"
										/>
									</div>
									{formData.rom && Object.keys(formData.rom).length > 0 ? (
										<div>
											{Object.keys(formData.rom).map(joint => renderRomTable(joint, formData.rom![joint]))}
										</div>
									) : (
										<p className="text-sm italic text-slate-500">No ROM joints recorded. Select a joint and click "Add Joint" to start.</p>
									)}
								</div>
								<div className="mt-8">
									<h4 className="mb-3 text-sm font-semibold text-slate-700">ii) Manual Muscle Testing</h4>
									<div className="mb-4 flex items-center gap-3">
										<select
											value={selectedMmtJoint}
											onChange={e => setSelectedMmtJoint(e.target.value)}
											className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											style={{ maxWidth: '220px' }}
										>
											<option value="">--Select Joint--</option>
											{ROM_JOINTS.map(joint => (
												<option key={`mmt-${joint}`} value={joint}>
													{joint}
												</option>
											))}
										</select>
										<button
											type="button"
											onClick={handleAddMmtJoint}
											className="inline-flex items-center rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 focus-visible:outline-none disabled:opacity-50"
											disabled={!selectedMmtJoint}
										>
											<i className="fas fa-plus text-xs mr-1" aria-hidden="true" />
											Add Joint
										</button>
										<button
											type="button"
											onClick={() => mmtFileInputRef.current?.click()}
											className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-green-700 focus-visible:outline-none"
											title="Upload image or file"
										>
											<i className="fas fa-upload text-xs" aria-hidden="true" />
											Upload
										</button>
										<input
											ref={mmtFileInputRef}
											type="file"
											accept="image/*,.pdf"
											onChange={handleMmtImageUpload}
											className="hidden"
										/>
									</div>
									{formData.mmt && Object.keys(formData.mmt).length > 0 ? (
										<div>
											{Object.keys(formData.mmt).map(joint => renderMmtTable(joint, formData.mmt![joint]))}
										</div>
									) : (
										<p className="text-sm italic text-slate-500">
											No manual muscle testing recorded. Select a joint and click "Add Joint" to begin.
										</p>
									)}
								</div>
								<div className="mt-8 space-y-4">
									<div>
										<label className="block text-xs font-medium text-slate-500 mb-2">Joint Play Movement</label>
										<input
											type="text"
											value={formData.jointPlayMovement || ''}
											onChange={e => handleFieldChange('jointPlayMovement', e.target.value)}
											className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											placeholder="Enter joint play movement details"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500 mb-2">Accessory Joint Movement</label>
										<input
											type="text"
											value={formData.accessoryJointMovement || ''}
											onChange={e => handleFieldChange('accessoryJointMovement', e.target.value)}
											className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											placeholder="Enter accessory joint movement details"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500 mb-2">Additional Notes</label>
										<input
											type="text"
											value={formData.examinationAdditionalNotes || ''}
											onChange={e => handleFieldChange('examinationAdditionalNotes', e.target.value)}
											className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											placeholder="Enter any additional examination notes"
										/>
									</div>
								</div>
							</div>

							{/* 7. Diagnosis & Investigation */}
							<div className="mb-8">
								<h3 className="mb-4 text-sm font-semibold text-sky-600">7. Diagnosis & Investigation</h3>
								<div className="space-y-4">
									<div>
										<div className="flex items-center justify-between mb-2">
											<label className="block text-xs font-medium text-slate-500">Special Tests</label>
											<SpecialTestsLibrarySelector
												onSelectTests={(tests) => {
													const currentValue = formData.specialTest || '';
													handleFieldChange('specialTest', currentValue ? `${currentValue}\n\n${tests}` : tests);
												}}
												currentValue={formData.specialTest}
											/>
										</div>
										<textarea
											value={formData.specialTest || ''}
											onChange={e => handleFieldChange('specialTest', e.target.value)}
											className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											rows={6}
											placeholder="Describe special test findings or use Special Tests Library to select tests..."
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500 mb-2">Differential Diagnosis</label>
										<textarea
											value={formData.differentialDiagnosis || formData.clinicalDiagnosis || ''}
											onChange={e => handleFieldChange('differentialDiagnosis', e.target.value)}
											className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											rows={4}
											placeholder="Enter differential diagnosis"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500 mb-2">Investigations</label>
										<p className="text-xs text-slate-500 mb-2">Check available reports:</p>
										<div className="grid gap-2 sm:grid-cols-2 mb-4">
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.investigationXray || formData.med_xray || false}
													onChange={e => handleCheckboxChange('investigationXray', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												X-ray
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.investigationMRI || formData.med_mri || false}
													onChange={e => handleCheckboxChange('investigationMRI', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												MRI
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.investigationCTScan || formData.med_ct || false}
													onChange={e => handleCheckboxChange('investigationCTScan', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												CT-Scan
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.investigationBlood || false}
													onChange={e => handleCheckboxChange('investigationBlood', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												Blood Investigation
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.investigationOthers || false}
													onChange={e => handleCheckboxChange('investigationOthers', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												Others
											</label>
										</div>
										<div className="mb-4">
											<label className="block text-xs font-medium text-slate-500 mb-2">Upload Image</label>
											<input
												type="file"
												accept="image/*,.pdf"
												onChange={e => {
													const file = e.target.files?.[0];
													if (file) {
														const reader = new FileReader();
														reader.onloadend = () => {
															handleFieldChange('investigationImage', reader.result as string);
															handleFieldChange('investigationImageName', file.name);
														};
														reader.readAsDataURL(file);
													}
												}}
												className="block w-full text-xs text-slate-600 file:mr-4 file:rounded-full file:border-0 file:bg-sky-50 file:px-3 file:py-1 file:text-sm file:font-semibold file:text-sky-700 hover:file:bg-sky-100"
											/>
										</div>
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-2">Assessment of Investigation</label>
											<textarea
												value={formData.assessmentOfInvestigation || ''}
												onChange={e => handleFieldChange('assessmentOfInvestigation', e.target.value)}
												className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
												rows={4}
												placeholder="Enter assessment of investigation"
											/>
										</div>
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-2">Final Diagnosis</label>
											<input
												type="text"
												value={formData.finalDiagnosis || ''}
												onChange={e => handleFieldChange('finalDiagnosis', e.target.value)}
												className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
												placeholder="Enter final diagnosis"
											/>
										</div>
									</div>
								</div>
							</div>

							{/* 8. Physiotherapy Management */}
							<div className="mb-8">
								<h3 className="mb-4 text-sm font-semibold text-sky-600">8. Physiotherapy Management</h3>
								<div className="space-y-6">
									{/* Patient Education */}
									<div>
										<label className="block text-xs font-medium text-slate-500 mb-2">Patient Education (Select all that apply)</label>
										<div className="space-y-2">
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.patientEducationCondition || false}
													onChange={e => handleCheckboxChange('patientEducationCondition', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												Explained the condition in detail
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.patientEducationGoals || false}
													onChange={e => handleCheckboxChange('patientEducationGoals', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												Explained the outcome of short-term and long-term goals
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.patientEducationAdvantages || false}
													onChange={e => handleCheckboxChange('patientEducationAdvantages', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												Explained the advantages and complications of the condition
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.patientEducationOthers || false}
													onChange={e => handleCheckboxChange('patientEducationOthers', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												Others: 
												<input
													type="text"
													value={formData.patientEducationOthersText || ''}
													onChange={e => handleFieldChange('patientEducationOthersText', e.target.value)}
													className="ml-2 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
													placeholder="Specify other education"
													disabled={!formData.patientEducationOthers}
												/>
											</label>
										</div>
									</div>

									{/* Short Term Goals */}
									<div>
										<label className="block text-xs font-medium text-slate-500 mb-2">Short Term Goals (Select all that apply)</label>
										<div className="space-y-2">
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.shortTermGoalReducePain || false}
													onChange={e => handleCheckboxChange('shortTermGoalReducePain', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												Reduce pain
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.shortTermGoalImproveROM || false}
													onChange={e => handleCheckboxChange('shortTermGoalImproveROM', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												Improve ROM
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.shortTermGoalImproveStrength || false}
													onChange={e => handleCheckboxChange('shortTermGoalImproveStrength', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												Improve & Maintain Strength
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.shortTermGoalOthers || false}
													onChange={e => handleCheckboxChange('shortTermGoalOthers', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												Others: 
												<input
													type="text"
													value={formData.shortTermGoalOthersText || ''}
													onChange={e => handleFieldChange('shortTermGoalOthersText', e.target.value)}
													className="ml-2 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
													placeholder="Specify other short-term goals"
													disabled={!formData.shortTermGoalOthers}
												/>
											</label>
										</div>
									</div>

									{/* Treatment Given */}
									<div>
										<label className="block text-xs font-medium text-slate-500 mb-2">Treatment Given (Select all that apply)</label>
										<div className="grid gap-2 sm:grid-cols-2">
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.treatmentCryotherapy || false}
													onChange={e => handleCheckboxChange('treatmentCryotherapy', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												Cryotherapy
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.treatmentIFT || false}
													onChange={e => handleCheckboxChange('treatmentIFT', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												IFT (Interferential Therapy)
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.treatmentTENS || false}
													onChange={e => handleCheckboxChange('treatmentTENS', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												TENS
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.treatmentLaser || false}
													onChange={e => handleCheckboxChange('treatmentLaser', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												Laser
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.treatmentSWT || false}
													onChange={e => handleCheckboxChange('treatmentSWT', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												SWT (Shockwave Therapy)
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.treatmentHotTherapy || false}
													onChange={e => handleCheckboxChange('treatmentHotTherapy', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												Hot Therapy
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.treatmentManualTherapy || false}
													onChange={e => handleCheckboxChange('treatmentManualTherapy', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												Manual Therapy
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.treatmentSoftTissueManipulation || false}
													onChange={e => handleCheckboxChange('treatmentSoftTissueManipulation', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												Soft Tissue Manipulation
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.treatmentDryNeedling || false}
													onChange={e => handleCheckboxChange('treatmentDryNeedling', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												Dry Needling
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.treatmentCuppingTherapy || false}
													onChange={e => handleCheckboxChange('treatmentCuppingTherapy', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												Cupping Therapy
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.treatmentOthers || false}
													onChange={e => handleCheckboxChange('treatmentOthers', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												Others: 
												<input
													type="text"
													value={formData.treatmentOthersText || ''}
													onChange={e => handleFieldChange('treatmentOthersText', e.target.value)}
													className="ml-2 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
													placeholder="Specify other treatment"
													disabled={!formData.treatmentOthers}
												/>
											</label>
										</div>
									</div>

									{/* Treatment (keep as is) */}
									<div>
										<div className="flex items-center justify-between mb-2">
											<label className="block text-xs font-medium text-slate-500">Treatment</label>
											<ExerciseLibrarySelector
												onSelectExercises={(exercises) => {
													const currentValue = formData.treatment || '';
													handleFieldChange('treatment', currentValue ? `${currentValue}\n\n${exercises}` : exercises);
												}}
												currentValue={formData.treatment}
												mode="rehab-protocol"
											/>
										</div>
										<textarea
											value={formData.treatment || formData.treatmentProvided || ''}
											onChange={e => handleFieldChange('treatment', e.target.value)}
											className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											rows={6}
											placeholder="Enter treatment or use Exercise Library to select exercises..."
										/>
									</div>

									{/* Long Term Goals */}
									<div>
										<label className="block text-xs font-medium text-slate-500 mb-2">Long Term Goals (Select all that apply)</label>
										<div className="space-y-2">
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.longTermGoalReducePain || false}
													onChange={e => handleCheckboxChange('longTermGoalReducePain', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												Reduce pain & Maintain pain-free movement
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.longTermGoalImproveROM || false}
													onChange={e => handleCheckboxChange('longTermGoalImproveROM', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												Improve & Maintain ROM
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.longTermGoalImproveStrength || false}
													onChange={e => handleCheckboxChange('longTermGoalImproveStrength', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												Improve & Maintain Strength
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.longTermGoalImproveStability || false}
													onChange={e => handleCheckboxChange('longTermGoalImproveStability', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												Improve stability
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.longTermGoalRTP || false}
													onChange={e => handleCheckboxChange('longTermGoalRTP', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												RTP (Return to Play) plan
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.longTermGoalOthers || false}
													onChange={e => handleCheckboxChange('longTermGoalOthers', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												Others: 
												<input
													type="text"
													value={formData.longTermGoalOthersText || ''}
													onChange={e => handleFieldChange('longTermGoalOthersText', e.target.value)}
													className="ml-2 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
													placeholder="Specify other long-term goals"
													disabled={!formData.longTermGoalOthers}
												/>
											</label>
										</div>
									</div>

									{/* Home Advice */}
									<div>
										<label className="block text-xs font-medium text-slate-500 mb-2">Home Advice</label>
										<textarea
											value={formData.advice || formData.homeAdvice || ''}
											onChange={e => handleFieldChange('homeAdvice', e.target.value)}
											className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											rows={4}
											placeholder="Enter home advice"
										/>
									</div>
								</div>
							</div>



							{/* Signature Section */}
							<div className="mb-8">
								<h3 className="mb-4 text-sm font-semibold text-sky-600">Physiotherapist Signature</h3>
								<div className="grid gap-4 sm:grid-cols-2">
									<div>
										<div className="flex items-center justify-between mb-1">
											<label className="block text-xs font-medium text-slate-500">Physio Name</label>
											{!isPhysioNameEditable && (
												<button
													type="button"
													onClick={() => setIsPhysioNameEditable(true)}
													className="text-xs text-sky-600 hover:text-sky-700 font-medium flex items-center gap-1"
												>
													<svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
														<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
													</svg>
													Edit
												</button>
											)}
											{isPhysioNameEditable && (
												<button
													type="button"
													onClick={() => setIsPhysioNameEditable(false)}
													className="text-xs text-slate-600 hover:text-slate-700 font-medium flex items-center gap-1"
												>
													<svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
														<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
													</svg>
													Cancel
												</button>
											)}
										</div>
										<input
											type="text"
											value={formData.physioName || ''}
											onChange={e => handleFieldChange('physioName', e.target.value)}
											readOnly={!isPhysioNameEditable}
											className={`mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 ${
												isPhysioNameEditable ? 'bg-white' : 'bg-slate-50 cursor-not-allowed'
											}`}
										/>
									</div>
								</div>
							</div>

								</>
							)}

							{/* Save Section */}
							<div className="space-y-4 border-t border-slate-200 pt-6 mt-8">
								<div className="flex items-center justify-between">
									<label className="flex items-center gap-2 cursor-pointer">
										<input
											type="checkbox"
											checked={sessionCompleted}
											onChange={e => setSessionCompleted(e.target.checked)}
											disabled={saving || !reportPatientData}
											className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-200 disabled:opacity-50 disabled:cursor-not-allowed"
										/>
										<span className="text-sm font-medium text-slate-700">
											Completion of one session
										</span>
									</label>
									<button 
										type="button" 
										onClick={handleSave} 
										className="inline-flex items-center rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 focus-visible:outline-none disabled:opacity-50"
										disabled={saving || !reportPatientData}
									>
										<i className="fas fa-save text-xs mr-2" aria-hidden="true" />
										{saving ? 'Saving...' : 'Save Report'}
									</button>
								</div>
								{reportPatientData?.patientType?.toUpperCase() === 'DYES' && sessionCompleted && (
									<div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
										<label className="flex items-start gap-2 cursor-pointer">
											<input
												type="checkbox"
												checked={isExtraTreatment}
												onChange={e => setIsExtraTreatment(e.target.checked)}
												disabled={saving || !reportPatientData}
												className="mt-0.5 h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
											/>
											<div>
												<span className="text-sm font-medium text-amber-900">
													Extra Treatment
												</span>
												<p className="text-xs text-amber-700 mt-1">
													Patient will pay separately for this treatment (not covered by DYES free sessions)
												</p>
											</div>
										</label>
									</div>
								)}
							</div>
						</div>
					) : reportPatientData && activeReportTab === 'strength-conditioning' ? (
						<div className="space-y-6">
							{loadingStrengthConditioning ? (
						<div className="text-center py-12">
									<div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-slate-900 border-r-transparent"></div>
									<p className="mt-4 text-sm text-slate-600">Loading strength and conditioning data...</p>
								</div>
							) : (
								<>
									{savedStrengthConditioningMessage && (
										<div className="mb-6 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3">
											<div className="flex items-center">
												<i className="fas fa-check text-emerald-600 mr-2" aria-hidden="true" />
												<p className="text-sm font-medium text-emerald-800">Report saved successfully!</p>
											</div>
										</div>
									)}

									{/* Patient Information */}
									<div className="mb-8 border-b border-slate-200 pb-6">
										<h2 className="mb-4 text-xl font-bold text-sky-600">Strength and Conditioning Assessment</h2>
										<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
											<div>
												<label className="block text-xs font-medium text-slate-500 mb-1">Patient Name</label>
												<p className="text-sm font-medium text-slate-900">{reportPatientData.name || '—'}</p>
											</div>
											<div>
												<label className="block text-xs font-medium text-slate-500 mb-1">Patient ID</label>
												<p className="text-sm font-medium text-slate-900">{reportPatientData.patientId || '—'}</p>
											</div>
											<div>
												<label className="block text-xs font-medium text-slate-500 mb-1">Date of Birth</label>
												<p className="text-sm font-medium text-slate-900">{reportPatientData.dob || '—'}</p>
											</div>
											<div>
												<label className="block text-xs font-medium text-slate-500 mb-1">Gender</label>
												<p className="text-sm font-medium text-slate-900">{reportPatientData.gender || '—'}</p>
											</div>
											<div>
												<label className="block text-xs font-medium text-slate-500 mb-1">Phone</label>
												<p className="text-sm font-medium text-slate-900">{reportPatientData.phone || '—'}</p>
											</div>
											<div>
												<label className="block text-xs font-medium text-slate-500 mb-1">Email</label>
												<p className="text-sm font-medium text-slate-900">{reportPatientData.email || '—'}</p>
											</div>
										</div>
									</div>

									{/* Date - Always visible and editable */}
									<div className="mb-6 border-b border-slate-200 pb-4">
										<label className="block text-sm font-semibold text-slate-700 mb-2">
											Report Date
										</label>
										<input
											type="date"
											value={strengthConditioningFormData.assessmentDate || new Date().toISOString().split('T')[0]}
											onChange={e => handleFieldChangeStrengthConditioning('assessmentDate', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
									</div>

									{/* Therapist Name */}
									<div className="mb-6">
										<label className="block text-sm font-semibold text-slate-700 mb-2">
											Therapist Name
										</label>
										<select
											value={strengthConditioningFormData.therapistName || ''}
											onChange={e => handleFieldChangeStrengthConditioning('therapistName', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										>
											<option value="">-- Select therapist --</option>
											{clinicalTeamMembers.map(member => (
												<option key={member.id} value={member.userName}>
													{member.userName}
												</option>
											))}
										</select>
									</div>

									{/* PDF Upload */}
									<div className="mb-6">
										<label className="block text-sm font-semibold text-slate-700 mb-2">
											Upload PDF Document
										</label>
										<div className="flex items-center gap-3">
											<label className="inline-flex items-center rounded-lg border border-sky-600 bg-white px-4 py-2 text-sm font-semibold text-sky-600 transition hover:bg-sky-50 cursor-pointer">
												<i className="fas fa-upload mr-2" aria-hidden="true" />
												{uploadingPdf ? 'Uploading...' : 'Upload PDF'}
												<input
													type="file"
													accept=".pdf"
													onChange={handlePdfUpload}
													disabled={uploadingPdf}
													className="hidden"
												/>
											</label>
											{uploadedPdfUrl || strengthConditioningFormData.uploadedPdfUrl ? (
												<div className="flex items-center gap-2 text-sm text-emerald-600">
													<i className="fas fa-check-circle" aria-hidden="true" />
													<span>PDF uploaded</span>
													<a
														href={(uploadedPdfUrl || strengthConditioningFormData.uploadedPdfUrl) || undefined}
														target="_blank"
														rel="noopener noreferrer"
														className="text-sky-600 hover:text-sky-700 underline"
													>
														View
													</a>
												</div>
											) : (
												<span className="text-sm text-slate-500">No PDF uploaded</span>
											)}
										</div>
										<p className="mt-1 text-xs text-slate-500">
											Upload a PDF document that will be included in the downloaded report. Maximum file size: 10MB
										</p>
									</div>

									{/* Athlete Profile */}
									<div className="mb-8 border-t border-slate-200 pt-6">
										<h2 className="mb-4 text-lg font-semibold text-slate-900 border-b-2 border-slate-300 pb-2">
											Athlete Profile
										</h2>
										<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
											<div>
												<label className="block text-sm font-medium text-slate-700 mb-1">Sports</label>
												<input
													type="text"
													value={strengthConditioningFormData.sports || ''}
													onChange={e => handleFieldChangeStrengthConditioning('sports', e.target.value)}
													className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
													placeholder="Enter sport"
												/>
											</div>
											<div>
												<label className="block text-sm font-medium text-slate-700 mb-1">Training Age (years)</label>
												<input
													type="number"
													value={strengthConditioningFormData.trainingAge || ''}
													onChange={e => handleFieldChangeStrengthConditioning('trainingAge', e.target.value)}
													className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
													placeholder="Enter years"
												/>
											</div>
											<div>
												<label className="block text-sm font-medium text-slate-700 mb-1">Competition Level</label>
												<input
													type="text"
													value={strengthConditioningFormData.competitionLevel || ''}
													onChange={e => handleFieldChangeStrengthConditioning('competitionLevel', e.target.value)}
													className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
													placeholder="Enter competition level"
												/>
											</div>
											<div>
												<label className="block text-sm font-medium text-slate-700 mb-1">Injury History</label>
												<textarea
													value={strengthConditioningFormData.injuryHistory || ''}
													onChange={e => handleFieldChangeStrengthConditioning('injuryHistory', e.target.value)}
													className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
													rows={2}
													placeholder="Enter injury history"
												/>
											</div>
											<div>
												<label className="block text-sm font-medium text-slate-700 mb-1">Dominant Side</label>
												<select
													value={strengthConditioningFormData.dominantSide || ''}
													onChange={e => handleFieldChangeStrengthConditioning('dominantSide', e.target.value as 'Right' | 'Left')}
													className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
												>
													<option value="">-- Select --</option>
													<option value="Right">Right</option>
													<option value="Left">Left</option>
												</select>
											</div>
										</div>
									</div>

									{/* Periodization */}
									<div className="mb-8 border-t border-slate-200 pt-6">
										<h2 className="mb-4 text-lg font-semibold text-slate-900 border-b-2 border-slate-300 pb-2">
											Season Periodization
										</h2>
										<div>
											<label className="block text-sm font-medium text-slate-700 mb-2">Season Phase</label>
											<div className="flex gap-4">
												<label className="flex items-center">
													<input
														type="radio"
														name="seasonPhase"
														value="Off-Season"
														checked={strengthConditioningFormData.seasonPhase === 'Off-Season'}
														onChange={e => handleFieldChangeStrengthConditioning('seasonPhase', e.target.value as 'Off-Season' | 'On-Season' | 'Competition')}
														className="mr-2 h-4 w-4 text-sky-600 focus:ring-sky-500"
													/>
													<span className="text-sm text-slate-700">Off-Season</span>
												</label>
												<label className="flex items-center">
													<input
														type="radio"
														name="seasonPhase"
														value="On-Season"
														checked={strengthConditioningFormData.seasonPhase === 'On-Season'}
														onChange={e => handleFieldChangeStrengthConditioning('seasonPhase', e.target.value as 'Off-Season' | 'On-Season' | 'Competition')}
														className="mr-2 h-4 w-4 text-sky-600 focus:ring-sky-500"
													/>
													<span className="text-sm text-slate-700">On-Season</span>
												</label>
												<label className="flex items-center">
													<input
														type="radio"
														name="seasonPhase"
														value="Competition"
														checked={strengthConditioningFormData.seasonPhase === 'Competition'}
														onChange={e => handleFieldChangeStrengthConditioning('seasonPhase', e.target.value as 'Off-Season' | 'On-Season' | 'Competition')}
														className="mr-2 h-4 w-4 text-sky-600 focus:ring-sky-500"
													/>
													<span className="text-sm text-slate-700">Competition</span>
												</label>
											</div>
										</div>
									</div>

									{/* List of Matches */}
									<div className="mb-8 border-t border-slate-200 pt-6">
										<h2 className="mb-4 text-lg font-semibold text-slate-900 border-b-2 border-slate-300 pb-2">
											List of Matches
										</h2>
										<div className="space-y-4">
											{(strengthConditioningFormData.matchDates && strengthConditioningFormData.matchDates.length > 0 
												? strengthConditioningFormData.matchDates 
												: ['']).map((matchDate, idx) => (
												<div key={idx} className="flex items-center gap-2">
													<label className="block text-sm font-medium text-slate-700 flex-1">
														Match Date {idx + 1}
														<input
															type="date"
															value={matchDate || ''}
															onChange={e => {
																const matchDates = [...(strengthConditioningFormData.matchDates || [])];
																if (!matchDates[idx]) matchDates[idx] = '';
																matchDates[idx] = e.target.value;
																handleFieldChangeStrengthConditioning('matchDates', matchDates);
															}}
															className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
														/>
													</label>
													{idx === (strengthConditioningFormData.matchDates?.length || 1) - 1 && (
														<button
															type="button"
															onClick={() => {
																const matchDates = [...(strengthConditioningFormData.matchDates || ['']), ''];
																handleFieldChangeStrengthConditioning('matchDates', matchDates);
															}}
															className="mt-6 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700 transition hover:bg-sky-100"
															title="Add another match date"
														>
															<i className="fas fa-plus" aria-hidden="true" />
														</button>
													)}
													{(strengthConditioningFormData.matchDates && strengthConditioningFormData.matchDates.length > 1) && (
														<button
															type="button"
															onClick={() => {
																const matchDates = [...(strengthConditioningFormData.matchDates || [])];
																matchDates.splice(idx, 1);
																handleFieldChangeStrengthConditioning('matchDates', matchDates.length > 0 ? matchDates : undefined);
															}}
															className="mt-6 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100"
															title="Remove this match date"
														>
															<i className="fas fa-times" aria-hidden="true" />
														</button>
													)}
												</div>
											))}
											{(!strengthConditioningFormData.matchDates || strengthConditioningFormData.matchDates.length === 0) && (
												<p className="text-xs text-slate-500 italic">No match dates added yet. Click the + button to add a match date.</p>
											)}
										</div>
									</div>

									{/* Skill Training - Hidden on subsequent dates */}
									{!isSubsequentDateStrength && (
									<div className="mb-8 border-t border-slate-200 pt-6">
										<h2 className="mb-4 text-lg font-semibold text-slate-900 border-b-2 border-slate-300 pb-2">
											1. Skill Training
										</h2>
										<div className="space-y-4">
											<div>
												<label className="block text-sm font-medium text-slate-700 mb-2">Type</label>
												<div className="flex gap-4">
													<label className="flex items-center">
														<input
															type="radio"
															name="skillType"
															value="Sports specific"
															checked={strengthConditioningFormData.skillType === 'Sports specific'}
															onChange={e => handleFieldChangeStrengthConditioning('skillType', e.target.value as 'Sports specific' | 'Fitness specific')}
															className="mr-2 h-4 w-4 text-sky-600 focus:ring-sky-500"
														/>
														<span className="text-sm text-slate-700">Sports specific</span>
													</label>
													<label className="flex items-center">
														<input
															type="radio"
															name="skillType"
															value="Fitness specific"
															checked={strengthConditioningFormData.skillType === 'Fitness specific'}
															onChange={e => handleFieldChangeStrengthConditioning('skillType', e.target.value as 'Sports specific' | 'Fitness specific')}
															className="mr-2 h-4 w-4 text-sky-600 focus:ring-sky-500"
														/>
														<span className="text-sm text-slate-700">Fitness specific</span>
													</label>
												</div>
											</div>
											<div>
												<label className="block text-sm font-medium text-slate-700 mb-1">Duration (Hours)</label>
												<input
													type="number"
													step="0.05"
													min="0"
													value={strengthConditioningFormData.skillDuration || ''}
													onChange={e => {
														const value = e.target.value;
														if (value === '') {
															handleFieldChangeStrengthConditioning('skillDuration', undefined);
														} else {
															handleFieldChangeStrengthConditioning('skillDuration', value);
														}
													}}
													onBlur={e => {
														// Validate on blur to ensure proper format
														const value = e.target.value;
														if (value) {
															const validated = validateDuration(value);
															if (validated !== undefined) {
																handleFieldChangeStrengthConditioning('skillDuration', validated);
															}
														}
													}}
													className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
													placeholder="e.g., 0.10, 0.15, 0.55, 1.0, 1.10, 1.15, 1.55, 2.0"
												/>
												<p className="mt-1 text-xs text-slate-500">
													Valid formats: 0.10 (10m), 0.15 (15m), 0.20 (20m), ..., 0.55 (55m), 1.0 (1h), 1.10 (1h 10m), ..., 1.55 (1h 55m), 2.0 (2h), etc.
												</p>
											</div>
											<div className="grid gap-4 sm:grid-cols-2">
												<div>
													<label className="block text-sm font-medium text-slate-700 mb-1">RPE - Planned (/10)</label>
													<input
														type="number"
														min="1"
														max="10"
														value={strengthConditioningFormData.skillRPEPlanned || ''}
														onChange={e => handleFieldChangeStrengthConditioning('skillRPEPlanned', e.target.value ? Number(e.target.value) : undefined)}
														className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
														placeholder="1-10"
													/>
												</div>
												<div>
													<label className="block text-sm font-medium text-slate-700 mb-1">PRPE - Perceived (/10)</label>
													<input
														type="number"
														min="1"
														max="10"
														value={strengthConditioningFormData.skillPRPEPerceived || ''}
														onChange={e => handleFieldChangeStrengthConditioning('skillPRPEPerceived', e.target.value ? Number(e.target.value) : undefined)}
														className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
														placeholder="1-10"
													/>
												</div>
											</div>
										</div>
									</div>
									)}

									{/* Strength & Conditioning - Only show when on strength-conditioning tab */}
									{activeReportTab === 'strength-conditioning' && (
										<>
											<div className="mb-8 border-t border-slate-200 pt-6">
										<h2 className="mb-4 text-lg font-semibold text-slate-900 border-b-2 border-slate-300 pb-2">
											Strength & Conditioning
										</h2>
										<div className="space-y-4">
											<div>
												<label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
												<select
													value={strengthConditioningFormData.scType || ''}
													onChange={e => handleFieldChangeStrengthConditioning('scType', e.target.value as any)}
													className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
												>
													<option value="">-- Select Type --</option>
													<option value="Strength">Strength</option>
													<option value="Endurance">Endurance</option>
													<option value="Speed & Power">Speed & Power</option>
													<option value="Agility">Agility</option>
													<option value="Mobility">Mobility</option>
													<option value="Prehab">Prehab</option>
													<option value="Recovery">Recovery</option>
												</select>
											</div>
											<div>
												<label className="block text-sm font-medium text-slate-700 mb-1">Duration (Hours)</label>
												<input
													type="number"
													step="0.05"
													min="0"
													value={strengthConditioningFormData.scDuration || ''}
													onChange={e => {
														const value = e.target.value;
														if (value === '') {
															handleFieldChangeStrengthConditioning('scDuration', undefined);
														} else {
															handleFieldChangeStrengthConditioning('scDuration', value);
														}
													}}
													onBlur={e => {
														// Validate on blur to ensure proper format
														const value = e.target.value;
														if (value) {
															const validated = validateDuration(value);
															if (validated !== undefined) {
																handleFieldChangeStrengthConditioning('scDuration', validated);
															}
														}
													}}
													className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
													placeholder="e.g., 0.10, 0.15, 0.55, 1.0, 1.10, 1.15, 1.55, 2.0"
												/>
												<p className="mt-1 text-xs text-slate-500">
													Valid formats: 0.10 (10m), 0.15 (15m), 0.20 (20m), ..., 0.55 (55m), 1.0 (1h), 1.10 (1h 10m), ..., 1.55 (1h 55m), 2.0 (2h), etc.
												</p>
											</div>
											<div className="grid gap-4 sm:grid-cols-2">
												<div>
													<label className="block text-sm font-medium text-slate-700 mb-1">RPE - Planned (/10)</label>
													<input
														type="number"
														min="1"
														max="10"
														value={strengthConditioningFormData.scRPEPlanned || ''}
														onChange={e => handleFieldChangeStrengthConditioning('scRPEPlanned', e.target.value ? Number(e.target.value) : undefined)}
														className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
														placeholder="1-10"
													/>
												</div>
												<div>
													<label className="block text-sm font-medium text-slate-700 mb-1">PRPE - Perceived (/10)</label>
													<input
														type="number"
														min="1"
														max="10"
														value={strengthConditioningFormData.scPRPEPerceived || ''}
														onChange={e => handleFieldChangeStrengthConditioning('scPRPEPerceived', e.target.value ? Number(e.target.value) : undefined)}
														className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
														placeholder="1-10"
													/>
												</div>
											</div>
											{/* Auto-calculated Duration */}
											<div>
												<label className="block text-sm font-medium text-slate-700 mb-1">Total Duration (Hours) <span className="text-xs text-slate-500 font-normal">(Auto-calculated)</span></label>
												<input
													type="number"
													step="0.5"
													min="0"
													value={(() => {
														const skillDur = typeof strengthConditioningFormData.skillDuration === 'number' 
															? strengthConditioningFormData.skillDuration 
															: Number(strengthConditioningFormData.skillDuration) || 0;
														const scDur = typeof strengthConditioningFormData.scDuration === 'number' 
															? strengthConditioningFormData.scDuration 
															: Number(strengthConditioningFormData.scDuration) || 0;
														return skillDur + scDur;
													})()}
													readOnly
													className="mt-1 w-full rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-600 cursor-not-allowed"
													placeholder="Auto-calculated"
												/>
												<p className="mt-1 text-xs text-slate-500">
													Skill Training Duration + Strength & Conditioning Duration
												</p>
											</div>
											{/* Exercise Log Table */}
											<div>
												<label className="block text-sm font-medium text-slate-700 mb-2">Exercise Log</label>
												<div className="overflow-x-auto">
													<table className="min-w-full divide-y divide-slate-200 border border-slate-300 text-left text-sm">
														<thead className="bg-slate-100">
															<tr>
																<th className="px-3 py-2 font-semibold text-slate-700 border border-slate-300">Exercise Name</th>
																<th className="px-3 py-2 font-semibold text-slate-700 border border-slate-300">Sets</th>
																<th className="px-3 py-2 font-semibold text-slate-700 border border-slate-300">Reps</th>
																<th className="px-3 py-2 font-semibold text-slate-700 border border-slate-300">Load (kg/Body Weight)</th>
																<th className="px-3 py-2 font-semibold text-slate-700 border border-slate-300">Rest (sec)</th>
																<th className="px-3 py-2 font-semibold text-slate-700 border border-slate-300">Distance</th>
																<th className="px-3 py-2 font-semibold text-slate-700 border border-slate-300">Heart Rate</th>
																<th className="px-3 py-2 font-semibold text-slate-700 border border-slate-300 w-12">Action</th>
															</tr>
														</thead>
														<tbody className="divide-y divide-slate-200 bg-white">
															{((strengthConditioningFormData.exercises && strengthConditioningFormData.exercises.length > 0) ? strengthConditioningFormData.exercises : [{}, {}, {}]).map((exercise, idx) => (
																<tr key={idx}>
																	<td className="px-3 py-2 border border-slate-300 bg-white">
																		<input
																			type="text"
																			value={exercise.exerciseName || ''}
																			onChange={e => {
																				const exercises = [...(strengthConditioningFormData.exercises || [])];
																				if (!exercises[idx]) exercises[idx] = {};
																				exercises[idx].exerciseName = e.target.value;
																				handleFieldChangeStrengthConditioning('exercises', exercises);
																			}}
																			className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																			placeholder="Exercise name"
																		/>
																	</td>
																	<td className="px-3 py-2 border border-slate-300 bg-white">
																		<input
																			type="number"
																			value={exercise.sets || ''}
																			onChange={e => {
																				const exercises = [...(strengthConditioningFormData.exercises || [])];
																				if (!exercises[idx]) exercises[idx] = {};
																				exercises[idx].sets = e.target.value ? Number(e.target.value) : undefined;
																				handleFieldChangeStrengthConditioning('exercises', exercises);
																			}}
																			className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																			placeholder="Sets"
																		/>
																	</td>
																	<td className="px-3 py-2 border border-slate-300 bg-white">
																		<input
																			type="number"
																			value={exercise.reps || ''}
																			onChange={e => {
																				const exercises = [...(strengthConditioningFormData.exercises || [])];
																				if (!exercises[idx]) exercises[idx] = {};
																				exercises[idx].reps = e.target.value ? Number(e.target.value) : undefined;
																				handleFieldChangeStrengthConditioning('exercises', exercises);
																			}}
																			className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																			placeholder="Reps"
																		/>
																	</td>
																	<td className="px-3 py-2 border border-slate-300 bg-white">
																		<input
																			type="number"
																			value={exercise.load || ''}
																			onChange={e => {
																				const exercises = [...(strengthConditioningFormData.exercises || [])];
																				if (!exercises[idx]) exercises[idx] = {};
																				exercises[idx].load = e.target.value ? Number(e.target.value) : undefined;
																				handleFieldChangeStrengthConditioning('exercises', exercises);
																			}}
																			className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																			placeholder="Load"
																		/>
																	</td>
																	<td className="px-3 py-2 border border-slate-300 bg-white">
																		<input
																			type="number"
																			value={exercise.rest || ''}
																			onChange={e => {
																				const exercises = [...(strengthConditioningFormData.exercises || [])];
																				if (!exercises[idx]) exercises[idx] = {};
																				exercises[idx].rest = e.target.value ? Number(e.target.value) : undefined;
																				handleFieldChangeStrengthConditioning('exercises', exercises);
																			}}
																			className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																			placeholder="Rest"
																		/>
																	</td>
																	<td className="px-3 py-2 border border-slate-300 bg-white">
																		<input
																			type="number"
																			value={exercise.distance || ''}
																			onChange={e => {
																				const exercises = [...(strengthConditioningFormData.exercises || [])];
																				if (!exercises[idx]) exercises[idx] = {};
																				exercises[idx].distance = e.target.value ? Number(e.target.value) : undefined;
																				handleFieldChangeStrengthConditioning('exercises', exercises);
																			}}
																			className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																			placeholder="Distance"
																		/>
																	</td>
																	<td className="px-3 py-2 border border-slate-300 bg-white">
																		<input
																			type="number"
																			value={exercise.avgHR || ''}
																			onChange={e => {
																				const exercises = [...(strengthConditioningFormData.exercises || [])];
																				if (!exercises[idx]) exercises[idx] = {};
																				exercises[idx].avgHR = e.target.value ? Number(e.target.value) : undefined;
																				handleFieldChangeStrengthConditioning('exercises', exercises);
																			}}
																			className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																			placeholder="HR"
																		/>
																	</td>
																	<td className="px-3 py-2 border border-slate-300 bg-white text-center">
																		<button
																			type="button"
																			onClick={() => {
																				const exercises = [...(strengthConditioningFormData.exercises || [])];
																				exercises.splice(idx, 1);
																				handleFieldChangeStrengthConditioning('exercises', exercises);
																			}}
																			className="inline-flex items-center justify-center w-7 h-7 rounded-full text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1"
																			title="Remove exercise"
																		>
																			<i className="fas fa-times text-sm" aria-hidden="true" />
																		</button>
																	</td>
																</tr>
															))}
														</tbody>
													</table>
												</div>
												<button
													type="button"
													onClick={() => {
														const exercises = [...(strengthConditioningFormData.exercises || []), {}];
														handleFieldChangeStrengthConditioning('exercises', exercises);
													}}
													className="mt-2 rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:bg-sky-100"
												>
													<i className="fas fa-plus mr-1" aria-hidden="true" />
													Add Exercise
												</button>
											</div>
										</div>
									</div>

											{/* Wellness Score */}
											<div className="mb-8 border-t border-slate-200 pt-6">
										<h2 className="mb-4 text-lg font-semibold text-slate-900 border-b-2 border-slate-300 pb-2">
											Wellness Score
										</h2>
										<div className="space-y-4">
											<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
												<div>
													<label className="block text-sm font-medium text-slate-700 mb-1">Sleep Duration (hours)</label>
													<input
														type="number"
														step="0.05"
														min="0"
														value={strengthConditioningFormData.sleepDuration || ''}
														onChange={e => {
															const value = e.target.value;
															if (value === '') {
																handleFieldChangeStrengthConditioning('sleepDuration', undefined);
															} else {
																handleFieldChangeStrengthConditioning('sleepDuration', value);
															}
														}}
														onBlur={e => {
															// Validate on blur to ensure proper format
															const value = e.target.value;
															if (value) {
																const validated = validateDuration(value);
																if (validated !== undefined) {
																	handleFieldChangeStrengthConditioning('sleepDuration', validated);
																}
															}
														}}
														className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
														placeholder="e.g., 0.10, 0.15, 0.55, 1.0, 1.10, 1.15, 1.55, 2.0"
													/>
													<p className="mt-1 text-xs text-slate-500">
														Valid formats: 0.10 (10m), 0.15 (15m), 0.20 (20m), ..., 0.55 (55m), 1.0 (1h), 1.10 (1h 10m), ..., 1.55 (1h 55m), 2.0 (2h), etc.
													</p>
												</div>
												<div>
													<label className="block text-sm font-medium text-slate-700 mb-1">Sleep Quality (1-10)</label>
													<input
														type="number"
														min="1"
														max="10"
														value={strengthConditioningFormData.sleepQuality || ''}
														onChange={e => handleFieldChangeStrengthConditioning('sleepQuality', e.target.value ? Number(e.target.value) : undefined)}
														className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
														placeholder="1-10"
													/>
												</div>
												<div>
													<label className="block text-sm font-medium text-slate-700 mb-1">Stress Level (1-10)</label>
													<input
														type="number"
														min="1"
														max="10"
														value={strengthConditioningFormData.stressLevel || ''}
														onChange={e => handleFieldChangeStrengthConditioning('stressLevel', e.target.value ? Number(e.target.value) : undefined)}
														className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
														placeholder="1-10"
													/>
												</div>
												<div>
													<label className="block text-sm font-medium text-slate-700 mb-1">Muscle Soreness (1-10)</label>
													<input
														type="number"
														min="1"
														max="10"
														value={strengthConditioningFormData.muscleSoreness || ''}
														onChange={e => handleFieldChangeStrengthConditioning('muscleSoreness', e.target.value ? Number(e.target.value) : undefined)}
														className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
														placeholder="1-10"
													/>
												</div>
											</div>
											<div>
												<label className="block text-sm font-medium text-slate-700 mb-2">Mood State</label>
												<div className="flex gap-4">
													<label className="flex items-center">
														<input
															type="radio"
															name="moodState"
															value="Highly Motivated"
															checked={strengthConditioningFormData.moodState === 'Highly Motivated'}
															onChange={e => handleFieldChangeStrengthConditioning('moodState', e.target.value as 'Highly Motivated' | 'Normal / OK' | 'Demotivated')}
															className="mr-2 h-4 w-4 text-sky-600 focus:ring-sky-500"
														/>
														<span className="text-sm text-slate-700">Highly Motivated</span>
													</label>
													<label className="flex items-center">
														<input
															type="radio"
															name="moodState"
															value="Normal / OK"
															checked={strengthConditioningFormData.moodState === 'Normal / OK'}
															onChange={e => handleFieldChangeStrengthConditioning('moodState', e.target.value as 'Highly Motivated' | 'Normal / OK' | 'Demotivated')}
															className="mr-2 h-4 w-4 text-sky-600 focus:ring-sky-500"
														/>
														<span className="text-sm text-slate-700">Normal / OK</span>
													</label>
													<label className="flex items-center">
														<input
															type="radio"
															name="moodState"
															value="Demotivated"
															checked={strengthConditioningFormData.moodState === 'Demotivated'}
															onChange={e => handleFieldChangeStrengthConditioning('moodState', e.target.value as 'Highly Motivated' | 'Normal / OK' | 'Demotivated')}
															className="mr-2 h-4 w-4 text-sky-600 focus:ring-sky-500"
														/>
														<span className="text-sm text-slate-700">Demotivated</span>
													</label>
												</div>
											</div>
										</div>
									</div>

									{/* Wellness Visualization */}
									<div className="mb-8 border-t border-slate-200 pt-6">
										<div className="space-y-4">
											<div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center">
												<p className="text-sm font-semibold text-slate-900 mb-2">Wellness Visualization</p>
												<div className="flex items-center justify-center gap-2 text-xs text-slate-600 mb-4">
													<span className="font-medium">SD: Sleep Duration</span>
													<span>•</span>
													<span className="font-medium">SQ: Sleep Quality</span>
													<span>•</span>
													<span className="font-medium">SL: Stress Level</span>
													<span>•</span>
													<span className="font-medium">MS: Muscle Soreness</span>
												</div>
												<div className="mt-4 flex items-center justify-center">
													{(() => {
														const sleepDuration = strengthConditioningFormData.sleepDuration || 0;
														const sleepQuality = strengthConditioningFormData.sleepQuality || 0;
														const stressLevel = strengthConditioningFormData.stressLevel || 0;
														const muscleSoreness = strengthConditioningFormData.muscleSoreness || 0;
														
														// Check if we have any data to display
														const hasData = sleepDuration > 0 || sleepQuality > 0 || stressLevel > 0 || muscleSoreness > 0;
														
														if (!hasData) {
															return (
																<div className="w-32 h-32 rounded-full border-4 border-slate-300 flex items-center justify-center bg-white">
																	<span className="text-xs text-slate-400">Enter wellness data</span>
																</div>
															);
														}
														
														// Normalize values for pie chart
														// Sleep Duration: normalize to 0-10 hours scale (max 10h = 100)
														// Sleep Quality, Stress Level, Muscle Soreness: already 0-10 scale
														const sdNormalized = Math.min((sleepDuration / 10) * 100, 100);
														const sqNormalized = (sleepQuality / 10) * 100;
														const slNormalized = (stressLevel / 10) * 100;
														const msNormalized = (muscleSoreness / 10) * 100;
														
														const total = sdNormalized + sqNormalized + slNormalized + msNormalized;
														
														// Calculate angles for pie chart segments (proportional to their values)
														const sdAngle = total > 0 ? (sdNormalized / total) * 360 : 0;
														const sqAngle = total > 0 ? (sqNormalized / total) * 360 : 0;
														const slAngle = total > 0 ? (slNormalized / total) * 360 : 0;
														const msAngle = total > 0 ? (msNormalized / total) * 360 : 0;
														
														let currentAngle = -90; // Start from top
														
														const size = 140;
														const radius = size / 2 - 10;
														const center = size / 2;
														
														// Helper to create path for pie segment
														const createPieSegment = (angle: number, color: string, key: string) => {
															if (angle <= 0) return null;
															const startAngle = (currentAngle * Math.PI) / 180;
															const endAngle = ((currentAngle + angle) * Math.PI) / 180;
															const prevAngle = currentAngle;
															currentAngle += angle;
															
															const x1 = center + radius * Math.cos(startAngle);
															const y1 = center + radius * Math.sin(startAngle);
															const x2 = center + radius * Math.cos(endAngle);
															const y2 = center + radius * Math.sin(endAngle);
															
															const largeArc = angle > 180 ? 1 : 0;
															
															return (
																<path
																	key={key}
																	d={`M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`}
																	fill={color}
																	stroke="white"
																	strokeWidth="2"
																/>
															);
														};
														
														return (
															<svg width={size} height={size} className="mx-auto" viewBox={`0 0 ${size} ${size}`}>
																{createPieSegment(sdAngle, '#3b82f6', 'sd')} {/* SD - Blue */}
																{createPieSegment(sqAngle, '#10b981', 'sq')} {/* SQ - Green */}
																{createPieSegment(slAngle, '#f59e0b', 'sl')} {/* SL - Amber */}
																{createPieSegment(msAngle, '#ef4444', 'ms')} {/* MS - Red */}
																{/* Center circle for donut effect */}
																<circle cx={center} cy={center} r={radius * 0.5} fill="white" />
																<text x={center} y={center - 5} textAnchor="middle" className="text-xs font-semibold fill-slate-700">
																	Wellness
																</text>
																<text x={center} y={center + 8} textAnchor="middle" className="text-[10px] fill-slate-500">
																	Score
																</text>
															</svg>
														);
													})()}
												</div>
												<div className="mt-4 grid grid-cols-2 gap-2 text-xs">
													<div className="flex items-center justify-center gap-1">
														<div className="w-3 h-3 rounded bg-blue-500"></div>
														<span className="text-slate-600">SD: {strengthConditioningFormData.sleepDuration || 0}h</span>
													</div>
													<div className="flex items-center justify-center gap-1">
														<div className="w-3 h-3 rounded bg-green-500"></div>
														<span className="text-slate-600">SQ: {strengthConditioningFormData.sleepQuality || 0}/10</span>
													</div>
													<div className="flex items-center justify-center gap-1">
														<div className="w-3 h-3 rounded bg-amber-500"></div>
														<span className="text-slate-600">SL: {strengthConditioningFormData.stressLevel || 0}/10</span>
													</div>
													<div className="flex items-center justify-center gap-1">
														<div className="w-3 h-3 rounded bg-red-500"></div>
														<span className="text-slate-600">MS: {strengthConditioningFormData.muscleSoreness || 0}/10</span>
													</div>
												</div>
											</div>
										</div>
									</div>

									{/* ACWR */}
									<div className="mb-8 border-t border-slate-200 pt-6">
										<h2 className="mb-4 text-lg font-semibold text-slate-900 border-b-2 border-slate-300 pb-2">
											ACWR (Acute:Chronic Workload Ratio)
										</h2>
										<div className="space-y-4">
											<div>
												<label className="block text-sm font-medium text-slate-700 mb-1">
													Daily Workload (A.U.) = RPE × Duration (Automatically Calculated)
												</label>
												<input
													type="number"
													step="0.01"
													value={calculatedDailyWorkload !== undefined ? calculatedDailyWorkload.toFixed(2) : (strengthConditioningFormData.dailyWorkload || '')}
													readOnly
													className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 focus:outline-none"
													placeholder="Auto-calculated: RPE × Duration"
												/>
												<p className="mt-1 text-xs text-slate-500">
													Daily Workload = RPE × Total Duration (Skill Training Duration + Strength & Conditioning Duration)
													{calculatedDailyWorkload !== undefined && (() => {
														const skillDur = typeof strengthConditioningFormData.skillDuration === 'number' 
															? strengthConditioningFormData.skillDuration 
															: Number(strengthConditioningFormData.skillDuration) || 0;
														const scDur = typeof strengthConditioningFormData.scDuration === 'number' 
															? strengthConditioningFormData.scDuration 
															: Number(strengthConditioningFormData.scDuration) || 0;
														const totalDuration = skillDur + scDur;
														return (
															<span className="ml-2 text-sky-600">
																= {strengthConditioningFormData.scRPEPlanned || 0} × {totalDuration.toFixed(1)}h = {calculatedDailyWorkload.toFixed(2)}
															</span>
														);
													})()}
												</p>
											</div>
											<div className="grid gap-4 sm:grid-cols-2">
												<div>
													<label className="block text-sm font-medium text-slate-700 mb-1">Acute Workload (Last 7 Days Total)</label>
													<input
														type="number"
														step="0.01"
														value={strengthConditioningFormData.acuteWorkload || ''}
														onChange={e => {
															const value = e.target.value ? Number(e.target.value) : undefined;
															handleFieldChangeStrengthConditioning('acuteWorkload', value);
															// Auto-calculate ACWR
															if (value && strengthConditioningFormData.chronicWorkload && strengthConditioningFormData.chronicWorkload > 0) {
																handleFieldChangeStrengthConditioning('acwrRatio', value / strengthConditioningFormData.chronicWorkload);
															}
														}}
														className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
														placeholder="Enter acute workload"
													/>
												</div>
												<div>
													<label className="block text-sm font-medium text-slate-700 mb-1">Chronic Workload (Last 28 Days Avg)</label>
													<input
														type="number"
														step="0.01"
														value={strengthConditioningFormData.chronicWorkload || ''}
														onChange={e => {
															const value = e.target.value ? Number(e.target.value) : undefined;
															handleFieldChangeStrengthConditioning('chronicWorkload', value);
															// Auto-calculate ACWR
															if (value && value > 0 && strengthConditioningFormData.acuteWorkload) {
																handleFieldChangeStrengthConditioning('acwrRatio', strengthConditioningFormData.acuteWorkload / value);
															}
														}}
														className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
														placeholder="Enter chronic workload"
													/>
												</div>
											</div>
											<div>
												<label className="block text-sm font-medium text-slate-700 mb-1">ACWR Ratio (Automatically Calculated)</label>
												<input
													type="number"
													step="0.01"
													value={calculatedACWR !== undefined ? calculatedACWR.toFixed(2) : (strengthConditioningFormData.acwrRatio || '')}
													readOnly
													className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 focus:outline-none"
													placeholder="Auto-calculated: Acute / Chronic"
												/>
												<p className="mt-1 text-xs text-slate-500">
													ACWR = Acute / Chronic (automatically calculated)
													{calculatedACWR !== undefined && (
														<span className="ml-2 text-sky-600">
															= {strengthConditioningFormData.acuteWorkload || 0} / {strengthConditioningFormData.chronicWorkload || 0} = {calculatedACWR.toFixed(2)}
														</span>
													)}
												</p>
											</div>
										</div>
									</div>

									{/* Injury Risk Screening - Hidden on subsequent dates */}
									{!isSubsequentDateStrength && (
									<div className="mb-8">
										<h2 className="mb-4 text-lg font-semibold text-slate-900 border-b-2 border-slate-300 pb-2">
											Injury Risk Screening
										</h2>
										
										<div className="space-y-4">
											{/* Scapular dyskinesia test */}
											<div>
												<label className="block text-sm font-medium text-slate-900 mb-1">
													Scapular Dyskinesia Test
												</label>
												<input
													type="text"
													value={strengthConditioningFormData.scapularDyskinesiaTest || ''}
													onChange={e => handleFieldChangeStrengthConditioning('scapularDyskinesiaTest', e.target.value)}
													className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
													placeholder="Enter result"
												/>
											</div>

											{/* Table 1: Upper limb flexibility, Shoulder rotations */}
											<div className="overflow-x-auto">
												<table className="min-w-full divide-y divide-slate-200 border border-slate-300 text-left text-sm">
													<thead className="bg-slate-100">
														<tr>
															<th className="px-3 py-2 font-semibold text-slate-900 border border-slate-300 bg-slate-200">Fields</th>
															<th className="px-3 py-2 font-semibold text-slate-900 border border-slate-300 bg-slate-200">Right</th>
															<th className="px-3 py-2 font-semibold text-slate-900 border border-slate-300 bg-slate-200">Left</th>
														</tr>
													</thead>
													<tbody className="divide-y divide-slate-200 bg-white">
														<tr>
															<td className="px-3 py-2 border border-slate-300 font-medium text-slate-900 bg-white">Upper Limb Flexibility</td>
															<td className="px-3 py-2 border border-slate-300 bg-white">
																<input
																	type="text"
																	value={strengthConditioningFormData.upperLimbFlexibilityRight || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('upperLimbFlexibilityRight', e.target.value)}
																	className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																	placeholder="Enter result"
																/>
															</td>
															<td className="px-3 py-2 border border-slate-300 bg-white">
																<input
																	type="text"
																	value={strengthConditioningFormData.upperLimbFlexibilityLeft || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('upperLimbFlexibilityLeft', e.target.value)}
																	className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																	placeholder="Enter result"
																/>
															</td>
														</tr>
														<tr>
															<td className="px-3 py-2 border border-slate-300 font-medium text-slate-900 bg-white">Shoulder Internal Rotation</td>
															<td className="px-3 py-2 border border-slate-300 bg-white">
																<input
																	type="text"
																	value={strengthConditioningFormData.shoulderInternalRotationRight || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('shoulderInternalRotationRight', e.target.value)}
																	className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																	placeholder="Enter result"
																/>
															</td>
															<td className="px-3 py-2 border border-slate-300 bg-white">
																<input
																	type="text"
																	value={strengthConditioningFormData.shoulderInternalRotationLeft || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('shoulderInternalRotationLeft', e.target.value)}
																	className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																	placeholder="Enter result"
																/>
															</td>
														</tr>
														<tr>
															<td className="px-3 py-2 border border-slate-300 font-medium text-slate-900 bg-white">Shoulder External Rotation</td>
															<td className="px-3 py-2 border border-slate-300 bg-white">
																<input
																	type="text"
																	value={strengthConditioningFormData.shoulderExternalRotationRight || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('shoulderExternalRotationRight', e.target.value)}
																	className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																	placeholder="Enter result"
																/>
															</td>
															<td className="px-3 py-2 border border-slate-300 bg-white">
																<input
																	type="text"
																	value={strengthConditioningFormData.shoulderExternalRotationLeft || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('shoulderExternalRotationLeft', e.target.value)}
																	className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																	placeholder="Enter result"
																/>
															</td>
														</tr>
													</tbody>
												</table>
											</div>

											{/* Thoracic Rotation and Sit and Reach test */}
											<div className="grid gap-4 sm:grid-cols-2">
												<div>
													<label className="block text-sm font-medium text-slate-900 mb-1">
														Thoracic Rotation
													</label>
													<input
														type="text"
														value={strengthConditioningFormData.thoracicRotation || ''}
														onChange={e => handleFieldChangeStrengthConditioning('thoracicRotation', e.target.value)}
														className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
														placeholder="Enter result"
													/>
												</div>
												<div>
													<label className="block text-sm font-medium text-slate-900 mb-1">
														Sit And Reach Test
													</label>
													<input
														type="text"
														value={strengthConditioningFormData.sitAndReachTest || ''}
														onChange={e => handleFieldChangeStrengthConditioning('sitAndReachTest', e.target.value)}
														className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
														placeholder="Enter result"
													/>
												</div>
											</div>

											{/* Table 2: Lower body tests */}
											<div className="overflow-x-auto">
												<table className="min-w-full divide-y divide-slate-200 border border-slate-300 text-left text-sm">
													<thead className="bg-slate-100">
														<tr>
															<th className="px-3 py-2 font-semibold text-slate-900 border border-slate-300 bg-slate-200">Fields</th>
															<th className="px-3 py-2 font-semibold text-slate-900 border border-slate-300 bg-slate-200">Right</th>
															<th className="px-3 py-2 font-semibold text-slate-900 border border-slate-300 bg-slate-200">Left</th>
														</tr>
													</thead>
													<tbody className="divide-y divide-slate-200 bg-white">
														<tr>
															<td className="px-3 py-2 border border-slate-300 font-medium text-slate-900 bg-white">Single Leg Squat</td>
															<td className="px-3 py-2 border border-slate-300 bg-white">
																<input
																	type="text"
																	value={strengthConditioningFormData.singleLegSquatRight || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('singleLegSquatRight', e.target.value)}
																	className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																	placeholder="Enter result"
																/>
															</td>
															<td className="px-3 py-2 border border-slate-300 bg-white">
																<input
																	type="text"
																	value={strengthConditioningFormData.singleLegSquatLeft || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('singleLegSquatLeft', e.target.value)}
																	className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																	placeholder="Enter result"
																/>
															</td>
														</tr>
														<tr>
															<td className="px-3 py-2 border border-slate-300 font-medium text-slate-900 bg-white">Weight Bearing Lunge Test</td>
															<td className="px-3 py-2 border border-slate-300 bg-white">
																<input
																	type="text"
																	value={strengthConditioningFormData.weightBearingLungeTestRight || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('weightBearingLungeTestRight', e.target.value)}
																	className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																	placeholder="Enter result"
																/>
															</td>
															<td className="px-3 py-2 border border-slate-300 bg-white">
																<input
																	type="text"
																	value={strengthConditioningFormData.weightBearingLungeTestLeft || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('weightBearingLungeTestLeft', e.target.value)}
																	className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																	placeholder="Enter result"
																/>
															</td>
														</tr>
														<tr>
															<td className="px-3 py-2 border border-slate-300 font-medium text-slate-900 bg-white">Hamstrings Flexibility</td>
															<td className="px-3 py-2 border border-slate-300 bg-white">
																<input
																	type="text"
																	value={strengthConditioningFormData.hamstringsFlexibilityRight || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('hamstringsFlexibilityRight', e.target.value)}
																	className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																	placeholder="Enter result"
																/>
															</td>
															<td className="px-3 py-2 border border-slate-300 bg-white">
																<input
																	type="text"
																	value={strengthConditioningFormData.hamstringsFlexibilityLeft || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('hamstringsFlexibilityLeft', e.target.value)}
																	className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																	placeholder="Enter result"
																/>
															</td>
														</tr>
														<tr>
															<td className="px-3 py-2 border border-slate-300 font-medium text-slate-900 bg-white">Quadriceps Flexibility</td>
															<td className="px-3 py-2 border border-slate-300 bg-white">
																<input
																	type="text"
																	value={strengthConditioningFormData.quadricepsFlexibilityRight || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('quadricepsFlexibilityRight', e.target.value)}
																	className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																	placeholder="Enter result"
																/>
															</td>
															<td className="px-3 py-2 border border-slate-300 bg-white">
																<input
																	type="text"
																	value={strengthConditioningFormData.quadricepsFlexibilityLeft || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('quadricepsFlexibilityLeft', e.target.value)}
																	className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																	placeholder="Enter result"
																/>
															</td>
														</tr>
														<tr>
															<td className="px-3 py-2 border border-slate-300 font-medium text-slate-900 bg-white">Hip External Rotation</td>
															<td className="px-3 py-2 border border-slate-300 bg-white">
																<input
																	type="text"
																	value={strengthConditioningFormData.hipExternalRotationRight || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('hipExternalRotationRight', e.target.value)}
																	className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																	placeholder="Enter result"
																/>
															</td>
															<td className="px-3 py-2 border border-slate-300 bg-white">
																<input
																	type="text"
																	value={strengthConditioningFormData.hipExternalRotationLeft || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('hipExternalRotationLeft', e.target.value)}
																	className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																	placeholder="Enter result"
																/>
															</td>
														</tr>
														<tr>
															<td className="px-3 py-2 border border-slate-300 font-medium text-slate-900 bg-white">Hip Internal Rotation</td>
															<td className="px-3 py-2 border border-slate-300 bg-white">
																<input
																	type="text"
																	value={strengthConditioningFormData.hipInternalRotationRight || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('hipInternalRotationRight', e.target.value)}
																	className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																	placeholder="Enter result"
																/>
															</td>
															<td className="px-3 py-2 border border-slate-300 bg-white">
																<input
																	type="text"
																	value={strengthConditioningFormData.hipInternalRotationLeft || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('hipInternalRotationLeft', e.target.value)}
																	className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																	placeholder="Enter result"
																/>
															</td>
														</tr>
														<tr>
															<td className="px-3 py-2 border border-slate-300 font-medium text-slate-900 bg-white">Hip Extension</td>
															<td className="px-3 py-2 border border-slate-300 bg-white">
																<input
																	type="text"
																	value={strengthConditioningFormData.hipExtensionRight || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('hipExtensionRight', e.target.value)}
																	className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																	placeholder="Enter result"
																/>
															</td>
															<td className="px-3 py-2 border border-slate-300 bg-white">
																<input
																	type="text"
																	value={strengthConditioningFormData.hipExtensionLeft || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('hipExtensionLeft', e.target.value)}
																	className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																	placeholder="Enter result"
																/>
															</td>
														</tr>
														<tr>
															<td className="px-3 py-2 border border-slate-300 font-medium text-slate-900 bg-white">Active SLR</td>
															<td className="px-3 py-2 border border-slate-300 bg-white">
																<input
																	type="text"
																	value={strengthConditioningFormData.activeSLRRight || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('activeSLRRight', e.target.value)}
																	className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																	placeholder="Enter result"
																/>
															</td>
															<td className="px-3 py-2 border border-slate-300 bg-white">
																<input
																	type="text"
																	value={strengthConditioningFormData.activeSLRLeft || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('activeSLRLeft', e.target.value)}
																	className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																	placeholder="Enter result"
																/>
															</td>
														</tr>
													</tbody>
												</table>
											</div>

											{/* Prone plank */}
											<div>
												<label className="block text-sm font-medium text-slate-900 mb-1">
													Prone Plank
												</label>
												<input
													type="text"
													value={strengthConditioningFormData.pronePlank || ''}
													onChange={e => handleFieldChangeStrengthConditioning('pronePlank', e.target.value)}
													className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
													placeholder="Enter result"
												/>
											</div>

											{/* Table 3: Side Plank and Stork standing balance */}
											<div className="overflow-x-auto">
												<table className="min-w-full divide-y divide-slate-200 border border-slate-300 text-left text-sm">
													<thead className="bg-slate-100">
														<tr>
															<th className="px-3 py-2 font-semibold text-slate-900 border border-slate-300 bg-slate-200">Fields</th>
															<th className="px-3 py-2 font-semibold text-slate-900 border border-slate-300 bg-slate-200">Right</th>
															<th className="px-3 py-2 font-semibold text-slate-900 border border-slate-300 bg-slate-200">Left</th>
														</tr>
													</thead>
													<tbody className="divide-y divide-slate-200 bg-white">
														<tr>
															<td className="px-3 py-2 border border-slate-300 font-medium text-slate-900 bg-white">Side Plank</td>
															<td className="px-3 py-2 border border-slate-300 bg-white">
																<input
																	type="text"
																	value={strengthConditioningFormData.sidePlankRight || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('sidePlankRight', e.target.value)}
																	className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																	placeholder="Enter result"
																/>
															</td>
															<td className="px-3 py-2 border border-slate-300 bg-white">
																<input
																	type="text"
																	value={strengthConditioningFormData.sidePlankLeft || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('sidePlankLeft', e.target.value)}
																	className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																	placeholder="Enter result"
																/>
															</td>
														</tr>
														<tr>
															<td className="px-3 py-2 border border-slate-300 font-medium text-slate-900 bg-white">Stork Standing Balance Test</td>
															<td className="px-3 py-2 border border-slate-300 bg-white">
																<input
																	type="text"
																	value={strengthConditioningFormData.storkStandingBalanceTestRight || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('storkStandingBalanceTestRight', e.target.value)}
																	className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																	placeholder="Enter result"
																/>
															</td>
															<td className="px-3 py-2 border border-slate-300 bg-white">
																<input
																	type="text"
																	value={strengthConditioningFormData.storkStandingBalanceTestLeft || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('storkStandingBalanceTestLeft', e.target.value)}
																	className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-sky-500"
																	placeholder="Enter result"
																/>
															</td>
														</tr>
													</tbody>
												</table>
											</div>

											{/* Additional fields */}
											<div className="space-y-4">
												<div>
													<label className="block text-sm font-medium text-slate-900 mb-1">
														Deep Squat
													</label>
													<input
														type="text"
														value={strengthConditioningFormData.deepSquat || ''}
														onChange={e => handleFieldChangeStrengthConditioning('deepSquat', e.target.value)}
														className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
														placeholder="Enter result"
													/>
												</div>
												<div>
													<label className="block text-sm font-medium text-slate-900 mb-1">
														Pushup
													</label>
													<input
														type="text"
														value={strengthConditioningFormData.pushup || ''}
														onChange={e => handleFieldChangeStrengthConditioning('pushup', e.target.value)}
														className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
														placeholder="Enter result"
													/>
												</div>
												<div>
													<label className="block text-sm font-medium text-slate-900 mb-1">
														FMS Score
													</label>
													<input
														type="text"
														value={strengthConditioningFormData.fmsScore || ''}
														onChange={e => handleFieldChangeStrengthConditioning('fmsScore', e.target.value)}
														className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
														placeholder="Enter FMS score"
													/>
												</div>
												<div>
													<label className="block text-sm font-medium text-slate-900 mb-1">
														Total FMS Score
													</label>
													<input
														type="text"
														value={strengthConditioningFormData.totalFmsScore || ''}
														onChange={e => handleFieldChangeStrengthConditioning('totalFmsScore', e.target.value)}
														className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
														placeholder="Enter total FMS score"
													/>
												</div>
												<div>
													<label className="block text-sm font-medium text-slate-900 mb-1">
														Summary
													</label>
													<textarea
														value={strengthConditioningFormData.summary || ''}
														onChange={e => handleFieldChangeStrengthConditioning('summary', e.target.value)}
														className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
														rows={4}
														placeholder="Enter summary"
													/>
												</div>
											</div>
										</div>
									</div>
									)}
										</>
									)}

									{/* Save Section with Session Completion Checkbox */}
									{activeReportTab === 'strength-conditioning' && (
										<div className="space-y-4 border-t border-slate-200 pt-6 mt-8">
											<div className="flex items-center justify-between">
												<label className="flex items-center gap-2 cursor-pointer">
													<input
														type="checkbox"
														checked={sessionCompleted}
														onChange={e => setSessionCompleted(e.target.checked)}
														disabled={savingStrengthConditioning || !reportPatientData}
														className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-200 disabled:opacity-50 disabled:cursor-not-allowed"
													/>
													<span className="text-sm font-medium text-slate-700">
														Completion of one session
													</span>
												</label>
											</div>
											{reportPatientData?.patientType?.toUpperCase() === 'DYES' && sessionCompleted && (
												<div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
													<label className="flex items-start gap-2 cursor-pointer">
														<input
															type="checkbox"
															checked={isExtraTreatment}
															onChange={e => setIsExtraTreatment(e.target.checked)}
															disabled={savingStrengthConditioning || !reportPatientData}
															className="mt-0.5 h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
														/>
														<div>
															<span className="text-sm font-medium text-amber-900">
																Extra Treatment
															</span>
															<p className="text-xs text-amber-700 mt-1">
																Patient will pay separately for this treatment (not covered by DYES free sessions)
															</p>
														</div>
													</label>
												</div>
											)}
										</div>
									)}
								</>
							)}
						</div>
					) : activeReportTab === 'psychology' ? (
						<div className="space-y-6">
							{loadingPsychology ? (
								<div className="text-center py-12">
									<div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-slate-900 border-r-transparent"></div>
									<p className="mt-4 text-sm text-slate-600">Loading psychology data...</p>
								</div>
							) : !reportPatientData ? (
								<div className="text-center py-12">
									<div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-slate-900 border-r-transparent"></div>
									<p className="mt-4 text-sm text-slate-600">Loading patient data...</p>
								</div>
							) : (
								<>
									{/* Viewing Version Indicator */}
									{viewingVersionIsPsychology && viewingPsychologyVersionData && (
										<div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
											<div className="flex items-center justify-between">
												<div className="flex items-center gap-2">
													<i className="fas fa-eye text-amber-600" aria-hidden="true" />
													<p className="text-sm font-medium text-amber-900">
														Viewing saved report version (read-only)
													</p>
												</div>
												<button
													type="button"
													onClick={() => {
														setViewingVersionIsPsychology(false);
														setViewingPsychologyVersionData(null);
													}}
													className="inline-flex items-center rounded-lg border border-amber-600 bg-white px-3 py-1.5 text-xs font-semibold text-amber-600 transition hover:bg-amber-50 focus-visible:outline-none"
												>
													<i className="fas fa-times mr-1.5" aria-hidden="true" />
													Exit View Mode
												</button>
											</div>
										</div>
									)}
									
									{/* Patient Information */}
									<div className="mb-8 border-b border-slate-200 pb-6">
										<h2 className="mb-4 text-xl font-bold text-indigo-600">Brain Training / Sports Psychology</h2>
										<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
											<div>
												<label className="block text-xs font-medium text-slate-500 mb-1">Patient Name</label>
												<p className="text-sm font-medium text-slate-900">{reportPatientData.name || '—'}</p>
											</div>
											<div>
												<label className="block text-xs font-medium text-slate-500 mb-1">Patient ID</label>
												<p className="text-sm font-medium text-slate-900">{reportPatientData.patientId || '—'}</p>
											</div>
											<div>
												<label className="block text-xs font-medium text-slate-500 mb-1">Date of Birth</label>
												<p className="text-sm font-medium text-slate-900">{reportPatientData.dob || '—'}</p>
											</div>
											<div>
												<label className="block text-xs font-medium text-slate-500 mb-1">Gender</label>
												<p className="text-sm font-medium text-slate-900">{reportPatientData.gender || '—'}</p>
											</div>
											<div>
												<label className="block text-xs font-medium text-slate-500 mb-1">Phone</label>
												<p className="text-sm font-medium text-slate-900">{reportPatientData.phone || '—'}</p>
											</div>
											<div>
												<label className="block text-xs font-medium text-slate-500 mb-1">Email</label>
												<p className="text-sm font-medium text-slate-900">{reportPatientData.email || '—'}</p>
											</div>
										</div>
									</div>

									{/* Psychology Report Component */}
									<PsychologyReport
										key={viewingVersionIsPsychology ? `viewing-${viewingPsychologyVersionData?.dateOfAssessment || 'version'}` : `editing-${psychologyFormDataKey}`}
										patientData={reportPatientData}
										formData={viewingVersionIsPsychology && viewingPsychologyVersionData ? viewingPsychologyVersionData : psychologyFormData}
										onChange={setPsychologyFormData}
										editable={editable && !viewingVersionIsPsychology}
										hasExistingVersions={hasPsychologyVersions}
										isViewingSavedVersion={viewingVersionIsPsychology}
										isEditingLoadedVersion={isEditingLoadedPsychologyVersion}
									/>
								</>
							)}
						</div>
					) : null}
				</div>
				
				{/* Footer */}
				<footer className="flex items-center justify-between border-t border-slate-200 px-6 py-4">
					{(activeReportTab === 'report' || activeReportTab === 'strength-conditioning' || activeReportTab === 'psychology') && reportPatientData && (
						<button
							type="button"
							onClick={activeReportTab === 'report' ? handleViewVersionHistory : handleViewVersionHistory}
							className="inline-flex items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none"
							title="View report versions"
						>
							<i className="fas fa-history mr-2" aria-hidden="true" />
							View Versions
						</button>
					)}
					<div className="flex items-center gap-3">
						{editable && (reportPatientData || strengthConditioningData || psychologyData) && (
							<button
								type="button"
								onClick={
									activeReportTab === 'strength-conditioning' 
										? handleSaveStrengthConditioning 
										: activeReportTab === 'psychology'
										? handleSavePsychology
										: handleSave
								}
								disabled={
									activeReportTab === 'strength-conditioning' 
										? savingStrengthConditioning 
										: activeReportTab === 'psychology'
										? savingPsychology
										: saving
								}
								className="inline-flex items-center rounded-lg border border-sky-600 bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
							>
								{(activeReportTab === 'strength-conditioning' 
									? savingStrengthConditioning 
									: activeReportTab === 'psychology'
									? savingPsychology
									: saving) ? (
									<>
										<div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
										Saving...
									</>
								) : (
									<>
										<i className="fas fa-save mr-2" aria-hidden="true" />
										{activeReportTab === 'psychology' ? 'Save Report' : 'Save Changes'}
									</>
								)}
							</button>
						)}
						{activeReportTab === 'report' && (reportPatientData || viewingVersionData) && (
							<>
								<button
									type="button"
									onClick={handleCrispReport}
									className="inline-flex items-center rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none"
								>
									<i className="fas fa-file-alt mr-2" aria-hidden="true" />
									Crisp Report
								</button>
								<button
									type="button"
									onClick={() => handleDownloadReportPDF()}
									className="inline-flex items-center rounded-lg border border-sky-600 px-4 py-2 text-sm font-semibold text-sky-600 transition hover:bg-sky-50 focus-visible:outline-none"
								>
									<i className="fas fa-download mr-2" aria-hidden="true" />
									Download PDF
								</button>
								<button
									type="button"
									onClick={() => handlePrintReport()}
									className="inline-flex items-center rounded-lg border border-sky-600 px-4 py-2 text-sm font-semibold text-sky-600 transition hover:bg-sky-50 focus-visible:outline-none"
								>
									<i className="fas fa-print mr-2" aria-hidden="true" />
									Print Report
								</button>
							</>
						)}
						{activeReportTab === 'strength-conditioning' && reportPatientData && (
							<>
								<button
									type="button"
									onClick={handleSaveStrengthConditioning}
									className="inline-flex items-center rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 focus-visible:outline-none disabled:opacity-50"
									disabled={savingStrengthConditioning}
								>
									<i className="fas fa-save mr-2" aria-hidden="true" />
									{savingStrengthConditioning ? 'Saving...' : 'Save Report'}
								</button>
								<button
									type="button"
									onClick={() => {}}
									className="inline-flex items-center rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
									disabled={true}
									title="Crisp Report not available for Strength and Conditioning reports"
								>
									<i className="fas fa-file-alt mr-2" aria-hidden="true" />
									Crisp Report
								</button>
								<button
									type="button"
									onClick={handleDownloadStrengthConditioningPDF}
									className="inline-flex items-center rounded-lg border border-sky-600 px-4 py-2 text-sm font-semibold text-sky-600 transition hover:bg-sky-50 focus-visible:outline-none disabled:opacity-50"
									disabled={!strengthConditioningFormData || Object.keys(strengthConditioningFormData).length === 0}
								>
									<i className="fas fa-download mr-2" aria-hidden="true" />
									Download PDF
								</button>
								<button
									type="button"
									onClick={() => handlePrintReport()}
									className="inline-flex items-center rounded-lg border border-sky-600 px-4 py-2 text-sm font-semibold text-sky-600 transition hover:bg-sky-50 focus-visible:outline-none disabled:opacity-50"
									disabled={!strengthConditioningFormData || Object.keys(strengthConditioningFormData).length === 0}
								>
									<i className="fas fa-print mr-2" aria-hidden="true" />
									Print Report
								</button>
							</>
						)}
						<button
							type="button"
							onClick={handleClose}
							className="inline-flex items-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800 focus-visible:outline-none"
						>
							Close
						</button>
					</div>
				</footer>
			</div>
			
			{/* Crisp Report Modal */}
			{showCrispReportModal && (
				<div className="fixed inset-0 z-60 flex items-center justify-center bg-black bg-opacity-50 px-4 py-6">
					<div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
						<div className="flex items-center justify-between p-6 border-b border-slate-200">
							<h2 className="text-xl font-semibold text-slate-900">Select Report Sections</h2>
							<button
								type="button"
								onClick={() => setShowCrispReportModal(false)}
								className="text-slate-400 hover:text-slate-600 transition"
								aria-label="Close"
							>
								<i className="fas fa-times text-xl" />
							</button>
						</div>
						<div className="flex-1 overflow-y-auto p-6">
							<div className="space-y-3">
								{allSections.map(section => (
									<label
										key={section.key}
										className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer"
									>
										<input
											type="checkbox"
											checked={selectedSections.includes(section.key)}
											onChange={() => toggleSection(section.key)}
											className="h-4 w-4 border-slate-300 text-sky-600 focus:ring-sky-200 rounded"
										/>
										<span className="text-sm font-medium text-slate-700">{section.label}</span>
									</label>
								))}
							</div>
						</div>
						<div className="flex items-center justify-end gap-3 border-t border-slate-200 p-6">
							<button
								type="button"
								onClick={() => setShowCrispReportModal(false)}
								className="inline-flex items-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800 focus-visible:outline-none"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleCrispReportDownload}
								className="inline-flex items-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800 focus-visible:outline-none"
								disabled={selectedSections.length === 0 || !reportPatientData}
							>
								<i className="fas fa-download text-xs mr-2" aria-hidden="true" />
								Download PDF
							</button>
							<button
								type="button"
								onClick={handleCrispReportPrint}
								className="inline-flex items-center rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 focus-visible:outline-none"
								disabled={selectedSections.length === 0 || !reportPatientData}
							>
								<i className="fas fa-print text-xs mr-2" aria-hidden="true" />
								Print
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Version History Modal - Same structure as ReportModal */}
			{showVersionHistory && reportPatientData && (
				<div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/60 px-4 py-6">
					<div className="flex w-full max-w-4xl max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
						<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
							<h2 className="text-lg font-semibold text-slate-900">
								Report Versions - {reportPatientData.name} ({reportPatientData.patientId})
							</h2>
							<button
								type="button"
								onClick={() => {
									setShowVersionHistory(false);
									setViewingVersionData(null);
								}}
								className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none"
								aria-label="Close"
							>
								<i className="fas fa-times" aria-hidden="true" />
							</button>
						</header>
						<div className="flex-1 overflow-y-auto p-6">
							{loadingVersions ? (
								<div className="text-center py-12">
									<div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-slate-900 border-r-transparent"></div>
									<p className="mt-4 text-sm text-slate-600">Loading report history...</p>
								</div>
							) : versionHistory.length === 0 ? (
								<div className="text-center py-12">
									<p className="text-slate-600">
										{activeReportTab === 'strength-conditioning' 
											? 'No Strength and Conditioning report history available for this patient.'
											: 'No report history available for this patient.'}
									</p>
									<p className="text-sm text-slate-500 mt-2">
										Previous reports will appear here when you save changes to the report.
									</p>
									{activeReportTab === 'strength-conditioning' && (
										<p className="text-xs text-slate-400 mt-3">
											Make sure to click "Save Report" on the Strength and Conditioning tab to create version history.
										</p>
									)}
								</div>
							) : (
								<div className="space-y-4">
									{versionHistory.map((version) => {
										const isExpanded = expandedVersionId === version.id;
										const versionData = reportPatientData ? { ...reportPatientData, ...version.data } : version.data;
										return (
											<div
												key={version.id}
												className="border border-slate-200 rounded-lg overflow-hidden"
											>
												<div className="p-4 hover:bg-slate-50 transition">
													<div className="flex items-center justify-between">
														<div className="flex-1">
															<div className="flex items-center gap-2">
																<span className="font-semibold text-slate-900">Report #{version.version}</span>
																{version.version === versionHistory[0]?.version && (
																	<span className="px-2 py-1 text-xs font-medium bg-sky-100 text-sky-700 rounded">
																		Latest
																	</span>
																)}
															</div>
															<p className="text-sm text-slate-600 mt-1">
																Saved by {version.createdBy} on{' '}
																{new Date(version.createdAt).toLocaleString()}
															</p>
														</div>
														<div className="ml-4 flex gap-2">
															<button
																type="button"
																onClick={() => {
																	if (version.isPsychology) {
																		// Handle psychology version viewing
																		setViewingVersionIsPsychology(true);
																		setViewingVersionIsStrengthConditioning(false);
																		setViewingVersionData(null);
																		// Ensure we're using the reportData from the version
																		// version.data should already contain the reportData from the mapping
																		const psychologyData = version.data && typeof version.data === 'object' && Object.keys(version.data).length > 0 
																			? version.data 
																			: {};
																		setViewingPsychologyVersionData(psychologyData);
																		setActiveReportTab('psychology');
																		// Close version history modal to show the report
																		setShowVersionHistory(false);
																	} else {
																		// Handle physiotherapy or strength & conditioning version viewing
																		setViewingVersionIsStrengthConditioning(version.isStrengthConditioning || false);
																		setViewingVersionIsPsychology(false);
																		setViewingPsychologyVersionData(null);
																		setViewingVersionData(versionData);
																	}
																}}
																className="inline-flex items-center rounded-lg border border-sky-600 px-3 py-1.5 text-xs font-semibold text-sky-600 transition hover:bg-sky-50 focus-visible:outline-none"
															>
																<i className="fas fa-eye mr-1.5" aria-hidden="true" />
																View Full Report
															</button>
															<button
																type="button"
																onClick={async () => {
																	try {
																		const versionData = reportPatientData ? { ...reportPatientData, ...version.data } : version.data;
																		
																		// Check if this is a Psychology version
																		if (version.isPsychology) {
																			// Generate Psychology PDF
																			const psychologyData = version.data && typeof version.data === 'object' ? version.data : {};
																			await generatePsychologyPDF({
																				patient: {
																					name: reportPatientData.name,
																					patientId: reportPatientData.patientId,
																					dob: reportPatientData.dob || '',
																					gender: reportPatientData.gender || '',
																					phone: reportPatientData.phone || '',
																					email: reportPatientData.email || '',
																				},
																				formData: psychologyData as PsychologyReportPDFData['formData'],
																			});
																			return;
																		}
																		
																		// Check if this is a Strength and Conditioning version
																		if (version.isStrengthConditioning || activeReportTab === 'strength-conditioning') {
																			// Generate Strength and Conditioning PDF
																			await generateStrengthConditioningPDF({
																				patient: {
																					name: reportPatientData.name,
																					patientId: reportPatientData.patientId,
																					dob: reportPatientData.dob || '',
																					gender: reportPatientData.gender || '',
																					phone: reportPatientData.phone || '',
																					email: reportPatientData.email || '',
																				},
																				formData: versionData as StrengthConditioningData,
																			});
																		} else {
																			// Generate regular Physiotherapy PDF
																			const age = versionData.dob ? new Date().getFullYear() - new Date(versionData.dob).getFullYear() : undefined;
																			const reportData = {
																				patientName: versionData.name || reportPatientData.name,
																				patientId: versionData.patientId || reportPatientData.patientId,
																				referredBy: versionData.assignedDoctor || versionData.referredBy || '',
																				age: age ? String(age) : '',
																				gender: versionData.gender || reportPatientData.gender || '',
																				dateOfConsultation: versionData.dateOfConsultation || new Date().toISOString().split('T')[0],
																				contact: versionData.phone || reportPatientData.phone || '',
																				email: versionData.email || reportPatientData.email || '',
																				totalSessionsRequired: versionData.totalSessionsRequired,
																				remainingSessions: versionData.remainingSessions,
																				history: versionData.history || (versionData.presentHistory || '') + (versionData.pastHistory ? '\n' + versionData.pastHistory : ''),
																				surgicalHistory: versionData.surgicalHistory || '',
																				medicalHistory: getMedicalHistoryText(versionData),
																				sleepCycle: versionData.sleepCycle || '',
																				hydration: versionData.hydration || '4',
																				nutrition: versionData.nutrition || '',
																				chiefComplaint: versionData.chiefComplaint || versionData.complaints || '',
																				onsetType: versionData.onsetType || '',
																				duration: versionData.duration || '',
																				mechanismOfInjury: versionData.mechanismOfInjury || '',
																				painType: versionData.painType || versionData.typeOfPain || '',
																				painIntensity: versionData.painIntensity || versionData.vasScale || '',
																				aggravatingFactor: versionData.aggravatingFactor || '',
																				relievingFactor: versionData.relievingFactor || '',
																				siteSide: versionData.siteSide || '',
																				onset: versionData.onset || '',
																				natureOfInjury: versionData.natureOfInjury || '',
																				typeOfPain: versionData.typeOfPain || '',
																				vasScale: versionData.vasScale || '5',
																				rom: versionData.rom || {},
																				mmt: versionData.mmt || {},
																				built: versionData.built || '',
																				posture: versionData.posture || '',
																				postureManualNotes: versionData.postureManualNotes || '',
																				postureFileName: versionData.postureFileName || '',
																				gaitAnalysis: versionData.gaitAnalysis || '',
																				gaitManualNotes: versionData.gaitManualNotes || '',
																				gaitFileName: versionData.gaitFileName || '',
																				mobilityAids: versionData.mobilityAids || '',
																				localObservation: versionData.localObservation || '',
																				swelling: versionData.swelling || '',
																				muscleWasting: versionData.muscleWasting || '',
																				tenderness: versionData.tenderness || '',
																				warmth: versionData.warmth || '',
																				scar: versionData.scar || '',
																				crepitus: versionData.crepitus || '',
																				odema: versionData.odema || '',
																				specialTest: versionData.specialTest || '',
																				differentialDiagnosis: versionData.differentialDiagnosis || versionData.clinicalDiagnosis || '',
																				finalDiagnosis: versionData.finalDiagnosis || '',
																				shortTermGoals: versionData.shortTermGoals || '',
																				longTermGoals: versionData.longTermGoals || '',
																				treatment: versionData.treatment || versionData.treatmentProvided || '',
																				treatmentProvided: versionData.treatmentProvided || '',
																				advice: versionData.advice || '',
																				nextFollowUpDate: versionData.nextFollowUpDate || '',
																				nextFollowUpTime: versionData.nextFollowUpTime || '',
																				followUpVisits: versionData.followUpVisits || [],
																				currentPainStatus: versionData.currentPainStatus || '',
																				currentRom: versionData.currentRom || '',
																				currentStrength: versionData.currentStrength || '',
																				currentFunctionalAbility: versionData.currentFunctionalAbility || '',
																				complianceWithHEP: versionData.complianceWithHEP || '',
																				physioName: versionData.physioName || '',
																				patientType: versionData.patientType || '',
																			};
																			await generatePhysiotherapyReportPDF(reportData);
																		}
																	} catch (error) {
																		console.error('Error downloading PDF:', error);
																		alert('Failed to download PDF. Please try again.');
																	}
																}}
																className="inline-flex items-center rounded-lg border border-sky-600 px-3 py-1.5 text-xs font-semibold text-sky-600 transition hover:bg-sky-50 focus-visible:outline-none"
															>
																<i className="fas fa-download mr-1.5" aria-hidden="true" />
																Download Report
															</button>
															<button
																type="button"
																onClick={() => {
																	// Load version data into form for editing
																	if (version.isPsychology) {
																		// Handle psychology version editing
																		// Ensure we're using the reportData from the version
																		let psychologyData: any = {};
																		if (version.data && typeof version.data === 'object') {
																			psychologyData = { ...version.data };
																		}
																		
																		if (Object.keys(psychologyData).length === 0) {
																			alert('The saved version appears to be empty. Please check the version data.');
																			return;
																		}
																		
																		// Close version history modal first
																		setShowVersionHistory(false);
																		
																		// Clear viewing state
																		setViewingVersionIsPsychology(false);
																		setViewingPsychologyVersionData(null);
																		setViewingVersionData(null);
																		
																		// Mark that we're editing a loaded version (so follow-up visibility uses form data)
																		setIsEditingLoadedPsychologyVersion(true);
																		
																		// Switch to psychology tab
																		setActiveReportTab('psychology');
																		
																		// Set the form data with the version data
																		setPsychologyFormData(JSON.parse(JSON.stringify(psychologyData)));
																		
																		// Update key to force component re-render with new data
																		setPsychologyFormDataKey(prev => prev + 1);
																	} else if (version.isStrengthConditioning || activeReportTab === 'strength-conditioning') {
																		setStrengthConditioningFormData(version.data as StrengthConditioningData);
																		setActiveReportTab('strength-conditioning');
																		setShowVersionHistory(false);
																		setViewingVersionData(null);
																	} else {
																		setFormData(version.data as Partial<PatientRecordFull>);
																		setActiveReportTab('report');
																		setShowVersionHistory(false);
																		setViewingVersionData(null);
																	}
																}}
																className="inline-flex items-center rounded-lg border border-emerald-600 px-3 py-1.5 text-xs font-semibold text-emerald-600 transition hover:bg-emerald-50 focus-visible:outline-none"
																title="Edit this version"
															>
																<i className="fas fa-edit mr-1.5" aria-hidden="true" />
																Edit
															</button>
															<button
																type="button"
																onClick={() => handleDeleteVersion(version)}
																className="inline-flex items-center rounded-lg border border-rose-600 px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 focus-visible:outline-none"
																title="Delete this version"
															>
																<i className="fas fa-trash mr-1.5" aria-hidden="true" />
																Delete
															</button>
														</div>
													</div>
												</div>
											</div>
										);
									})}
								</div>
							)}
						</div>
						<footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
							<button
								type="button"
								onClick={() => {
									setShowVersionHistory(false);
									setViewingVersionData(null);
								}}
								className="inline-flex items-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800 focus-visible:outline-none"
							>
								Close
							</button>
						</footer>
					</div>
				</div>
			)}

			{/* View Full Report Modal */}
			{viewingVersionData && reportPatientData && (() => {
				// Check if this is a Strength and Conditioning report
				const isSCReport = viewingVersionIsStrengthConditioning || 
					'sports' in viewingVersionData || 
					'trainingAge' in viewingVersionData || 
					'competitionLevel' in viewingVersionData ||
					'scRPEPlanned' in viewingVersionData;
				
				return (
					<div className="fixed inset-0 z-60 flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={(e) => e.target === e.currentTarget && setViewingVersionData(null)}>
						<div className="bg-white rounded-lg shadow-xl max-w-6xl w-full h-[95vh] max-h-[95vh] flex flex-col overflow-hidden">
							<div className="flex items-center justify-between p-6 border-b border-slate-200 flex-shrink-0 bg-white">
							<h2 className="text-xl font-semibold text-slate-900">
								{isSCReport ? 'Strength and Conditioning' : 'Physiotherapy'} Report - {reportPatientData.name} ({reportPatientData.patientId})
							</h2>
							<button
								type="button"
								onClick={() => {
									setViewingVersionData(null);
									setViewingVersionIsStrengthConditioning(false);
								}}
								className="text-slate-400 hover:text-slate-600 transition"
								aria-label="Close"
							>
								<i className="fas fa-times text-xl" />
							</button>
						</div>
						<div className="flex-1 overflow-y-auto overflow-x-hidden p-6 bg-white">
							<div className="space-y-6">
								{(() => {
									if (isSCReport) {
										return (
											// Strength and Conditioning Report View
											<>
										{/* Patient Information */}
										<div className="mb-8 border-b border-slate-200 pb-6">
											<h2 className="mb-4 text-xl font-bold text-sky-600">Strength and Conditioning Assessment</h2>
											<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
												<div>
													<label className="block text-xs font-medium text-slate-500">Patient Name</label>
													<div className="mt-1 text-sm text-slate-800">{reportPatientData.name || '—'}</div>
												</div>
												<div>
													<label className="block text-xs font-medium text-slate-500">Patient ID</label>
													<div className="mt-1 text-sm text-slate-800">{reportPatientData.patientId || '—'}</div>
												</div>
												<div>
													<label className="block text-xs font-medium text-slate-500">Date of Birth</label>
													<div className="mt-1 text-sm text-slate-800">{reportPatientData.dob || '—'}</div>
												</div>
												<div>
													<label className="block text-xs font-medium text-slate-500">Gender</label>
													<div className="mt-1 text-sm text-slate-800">{reportPatientData.gender || '—'}</div>
												</div>
											</div>
										</div>

										{/* Assessment Date */}
										{(viewingVersionData as any).assessmentDate && (
											<div>
												<label className="block text-xs font-medium text-slate-500 mb-1">Assessment Date</label>
												<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
													{(viewingVersionData as any).assessmentDate}
												</div>
											</div>
										)}

										{/* Therapist Name */}
										{(viewingVersionData as any).therapistName && (
											<div>
												<label className="block text-xs font-medium text-slate-500 mb-1">Therapist Name</label>
												<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
													{(viewingVersionData as any).therapistName}
												</div>
											</div>
										)}

										{/* Athlete Profile */}
										{((viewingVersionData as any).sports || (viewingVersionData as any).trainingAge || (viewingVersionData as any).competitionLevel || (viewingVersionData as any).injuryHistory || (viewingVersionData as any).dominantSide) && (
											<div>
												<h3 className="text-sm font-semibold text-sky-600 mb-3 border-b border-sky-200 pb-2">Athlete Profile</h3>
												<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
													{(viewingVersionData as any).sports && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Sports</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).sports}
															</div>
														</div>
													)}
													{(viewingVersionData as any).trainingAge && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Training Age (years)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).trainingAge}
															</div>
														</div>
													)}
													{(viewingVersionData as any).competitionLevel && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Competition Level</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).competitionLevel}
															</div>
														</div>
													)}
													{(viewingVersionData as any).injuryHistory && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Injury History</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
																{(viewingVersionData as any).injuryHistory}
															</div>
														</div>
													)}
													{(viewingVersionData as any).dominantSide && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Dominant Side</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).dominantSide}
															</div>
														</div>
													)}
												</div>
											</div>
										)}

										{/* Periodization */}
										{((viewingVersionData as any).seasonPhase || ((viewingVersionData as any).matchDates && Array.isArray((viewingVersionData as any).matchDates) && (viewingVersionData as any).matchDates.length > 0)) && (
											<div>
												<h3 className="text-sm font-semibold text-sky-600 mb-3 border-b border-sky-200 pb-2">Periodization</h3>
												<div className="grid gap-4 sm:grid-cols-2">
													{(viewingVersionData as any).seasonPhase && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Season Phase</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).seasonPhase}
															</div>
														</div>
													)}
													{((viewingVersionData as any).matchDates && Array.isArray((viewingVersionData as any).matchDates) && (viewingVersionData as any).matchDates.length > 0) && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">List of Matches</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																<ul className="list-disc list-inside space-y-1">
																	{(viewingVersionData as any).matchDates.map((date: string, idx: number) => (
																		<li key={idx}>{date}</li>
																	))}
																</ul>
															</div>
														</div>
													)}
												</div>
											</div>
										)}

										{/* Skill Training */}
										{((viewingVersionData as any).skillType || (viewingVersionData as any).skillDuration || (viewingVersionData as any).skillRPEPlanned || (viewingVersionData as any).skillPRPEPerceived) && (
											<div>
												<h3 className="text-sm font-semibold text-sky-600 mb-3 border-b border-sky-200 pb-2">Skill Training</h3>
												<div className="grid gap-4 sm:grid-cols-2">
													{(viewingVersionData as any).skillType && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Type</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).skillType}
															</div>
														</div>
													)}
													{(viewingVersionData as any).skillDuration && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Duration</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).skillDuration}
															</div>
														</div>
													)}
													{(viewingVersionData as any).skillRPEPlanned && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">RPE Planned</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).skillRPEPlanned}
															</div>
														</div>
													)}
													{(viewingVersionData as any).skillPRPEPerceived && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">PRPE Perceived</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).skillPRPEPerceived}
															</div>
														</div>
													)}
												</div>
											</div>
										)}

										{/* Strength & Conditioning */}
										{((viewingVersionData as any).scType || (viewingVersionData as any).scDuration || (viewingVersionData as any).scRPEPlanned || (viewingVersionData as any).scPRPEPerceived) && (
											<div>
												<h3 className="text-sm font-semibold text-sky-600 mb-3 border-b border-sky-200 pb-2">Strength & Conditioning</h3>
												<div className="grid gap-4 sm:grid-cols-2">
													{(viewingVersionData as any).scType && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Type</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).scType}
															</div>
														</div>
													)}
													{(viewingVersionData as any).scDuration && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Duration</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).scDuration}
															</div>
														</div>
													)}
													{(viewingVersionData as any).scRPEPlanned && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">RPE Planned</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).scRPEPlanned}
															</div>
														</div>
													)}
													{(viewingVersionData as any).scPRPEPerceived && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">PRPE Perceived</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).scPRPEPerceived}
															</div>
														</div>
													)}
												</div>
											</div>
										)}

										{/* Total Duration and Daily Workload */}
										{((viewingVersionData as any).skillDuration || (viewingVersionData as any).scDuration || (viewingVersionData as any).scRPEPlanned) && (() => {
											const skillDur = typeof (viewingVersionData as any).skillDuration === 'number' 
												? (viewingVersionData as any).skillDuration 
												: parseFloat(String((viewingVersionData as any).skillDuration || 0)) || 0;
											const scDur = typeof (viewingVersionData as any).scDuration === 'number' 
												? (viewingVersionData as any).scDuration 
												: parseFloat(String((viewingVersionData as any).scDuration || 0)) || 0;
											const totalDuration = skillDur + scDur;
											const rpe = typeof (viewingVersionData as any).scRPEPlanned === 'number' 
												? (viewingVersionData as any).scRPEPlanned 
												: parseFloat(String((viewingVersionData as any).scRPEPlanned || 0)) || 0;
											const dailyWorkload = totalDuration > 0 && rpe > 0 ? rpe * totalDuration : 0;
											
											return (
												<div>
													<h3 className="text-sm font-semibold text-sky-600 mb-3 border-b border-sky-200 pb-2">Calculated Values</h3>
													<div className="grid gap-4 sm:grid-cols-2">
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Total Duration (Hours)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{totalDuration.toFixed(2)}
															</div>
														</div>
														{dailyWorkload > 0 && (
															<div>
																<label className="block text-xs font-medium text-slate-500 mb-1">Daily Workload (A.U.)</label>
																<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																	{dailyWorkload.toFixed(2)} (RPE × Total Duration)
																</div>
															</div>
														)}
													</div>
												</div>
											);
										})()}

										{/* Exercise Log */}
										{((viewingVersionData as any).exercises && Array.isArray((viewingVersionData as any).exercises) && (viewingVersionData as any).exercises.length > 0) && (
											<div>
												<h3 className="text-sm font-semibold text-sky-600 mb-3 border-b border-sky-200 pb-2">Exercise Log</h3>
												<div className="overflow-x-auto">
													<table className="min-w-full divide-y divide-slate-200 border border-slate-300">
														<thead className="bg-slate-100">
															<tr>
																<th className="px-3 py-2 text-left text-xs font-semibold text-slate-700">Exercise</th>
																<th className="px-3 py-2 text-left text-xs font-semibold text-slate-700">Sets</th>
																<th className="px-3 py-2 text-left text-xs font-semibold text-slate-700">Reps</th>
																<th className="px-3 py-2 text-left text-xs font-semibold text-slate-700">Load (kg)</th>
																<th className="px-3 py-2 text-left text-xs font-semibold text-slate-700">Rest (s)</th>
																<th className="px-3 py-2 text-left text-xs font-semibold text-slate-700">Distance</th>
																<th className="px-3 py-2 text-left text-xs font-semibold text-slate-700">Avg HR</th>
															</tr>
														</thead>
														<tbody className="bg-white divide-y divide-slate-200">
															{(viewingVersionData as any).exercises.map((exercise: any, idx: number) => (
																<tr key={idx}>
																	<td className="px-3 py-2 text-xs text-slate-700">{exercise.exerciseName || '—'}</td>
																	<td className="px-3 py-2 text-xs text-slate-700">{exercise.sets || '—'}</td>
																	<td className="px-3 py-2 text-xs text-slate-700">{exercise.reps || '—'}</td>
																	<td className="px-3 py-2 text-xs text-slate-700">{exercise.load || '—'}</td>
																	<td className="px-3 py-2 text-xs text-slate-700">{exercise.rest || '—'}</td>
																	<td className="px-3 py-2 text-xs text-slate-700">{exercise.distance || '—'}</td>
																	<td className="px-3 py-2 text-xs text-slate-700">{exercise.avgHR || '—'}</td>
																</tr>
															))}
														</tbody>
													</table>
												</div>
											</div>
										)}

										{/* Wellness Score */}
										{((viewingVersionData as any).sleepDuration || (viewingVersionData as any).sleepQuality || (viewingVersionData as any).stressLevel || (viewingVersionData as any).muscleSoreness || (viewingVersionData as any).moodState) && (
											<div>
												<h3 className="text-sm font-semibold text-sky-600 mb-3 border-b border-sky-200 pb-2">Wellness Score</h3>
												<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
													{(viewingVersionData as any).sleepDuration && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Sleep Duration (hours)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).sleepDuration}
															</div>
														</div>
													)}
													{(viewingVersionData as any).sleepQuality && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Sleep Quality (1-10)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).sleepQuality}
															</div>
														</div>
													)}
													{(viewingVersionData as any).stressLevel && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Stress Level (1-10)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).stressLevel}
															</div>
														</div>
													)}
													{(viewingVersionData as any).muscleSoreness && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Muscle Soreness (1-10)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).muscleSoreness}
															</div>
														</div>
													)}
													{(viewingVersionData as any).moodState && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Mood State</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).moodState}
															</div>
														</div>
													)}
												</div>
											</div>
										)}

										{/* ACWR */}
										{((viewingVersionData as any).dailyWorkload || (viewingVersionData as any).acuteWorkload || (viewingVersionData as any).chronicWorkload || (viewingVersionData as any).acwrRatio) && (
											<div>
												<h3 className="text-sm font-semibold text-sky-600 mb-3 border-b border-sky-200 pb-2">ACWR (Acute:Chronic Workload Ratio)</h3>
												<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
													{(viewingVersionData as any).dailyWorkload && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Daily Workload (A.U.)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).dailyWorkload}
															</div>
														</div>
													)}
													{(viewingVersionData as any).acuteWorkload && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Acute Workload (7 days)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).acuteWorkload}
															</div>
														</div>
													)}
													{(viewingVersionData as any).chronicWorkload && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Chronic Workload (28 days avg)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).chronicWorkload}
															</div>
														</div>
													)}
													{(viewingVersionData as any).acwrRatio && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">ACWR Ratio</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).acwrRatio}
															</div>
														</div>
													)}
												</div>
											</div>
										)}

										{/* Functional Movement Screen */}
										{((viewingVersionData as any).scapularDyskinesiaTest || (viewingVersionData as any).upperLimbFlexibilityRight || (viewingVersionData as any).fmsScore) && (
											<div>
												<h3 className="text-sm font-semibold text-sky-600 mb-3 border-b border-sky-200 pb-2">Functional Movement Screen</h3>
												<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
													{(viewingVersionData as any).scapularDyskinesiaTest && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Scapular Dyskinesia Test</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).scapularDyskinesiaTest}
															</div>
														</div>
													)}
													{(viewingVersionData as any).upperLimbFlexibilityRight && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Upper Limb Flexibility (Right)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).upperLimbFlexibilityRight}
															</div>
														</div>
													)}
													{(viewingVersionData as any).upperLimbFlexibilityLeft && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Upper Limb Flexibility (Left)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).upperLimbFlexibilityLeft}
															</div>
														</div>
													)}
													{(viewingVersionData as any).shoulderInternalRotationRight && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Shoulder Internal Rotation (Right)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).shoulderInternalRotationRight}
															</div>
														</div>
													)}
													{(viewingVersionData as any).shoulderInternalRotationLeft && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Shoulder Internal Rotation (Left)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).shoulderInternalRotationLeft}
															</div>
														</div>
													)}
													{(viewingVersionData as any).shoulderExternalRotationRight && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Shoulder External Rotation (Right)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).shoulderExternalRotationRight}
															</div>
														</div>
													)}
													{(viewingVersionData as any).shoulderExternalRotationLeft && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Shoulder External Rotation (Left)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).shoulderExternalRotationLeft}
															</div>
														</div>
													)}
													{(viewingVersionData as any).thoracicRotation && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Thoracic Rotation</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).thoracicRotation}
															</div>
														</div>
													)}
													{(viewingVersionData as any).sitAndReachTest && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Sit and Reach Test</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).sitAndReachTest}
															</div>
														</div>
													)}
													{(viewingVersionData as any).singleLegSquatRight && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Single Leg Squat (Right)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).singleLegSquatRight}
															</div>
														</div>
													)}
													{(viewingVersionData as any).singleLegSquatLeft && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Single Leg Squat (Left)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).singleLegSquatLeft}
															</div>
														</div>
													)}
													{(viewingVersionData as any).weightBearingLungeTestRight && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Weight Bearing Lunge Test (Right)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).weightBearingLungeTestRight}
															</div>
														</div>
													)}
													{(viewingVersionData as any).weightBearingLungeTestLeft && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Weight Bearing Lunge Test (Left)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).weightBearingLungeTestLeft}
															</div>
														</div>
													)}
													{(viewingVersionData as any).hamstringsFlexibilityRight && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Hamstrings Flexibility (Right)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).hamstringsFlexibilityRight}
															</div>
														</div>
													)}
													{(viewingVersionData as any).hamstringsFlexibilityLeft && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Hamstrings Flexibility (Left)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).hamstringsFlexibilityLeft}
															</div>
														</div>
													)}
													{(viewingVersionData as any).quadricepsFlexibilityRight && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Quadriceps Flexibility (Right)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).quadricepsFlexibilityRight}
															</div>
														</div>
													)}
													{(viewingVersionData as any).quadricepsFlexibilityLeft && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Quadriceps Flexibility (Left)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).quadricepsFlexibilityLeft}
															</div>
														</div>
													)}
													{(viewingVersionData as any).hipExternalRotationRight && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Hip External Rotation (Right)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).hipExternalRotationRight}
															</div>
														</div>
													)}
													{(viewingVersionData as any).hipExternalRotationLeft && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Hip External Rotation (Left)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).hipExternalRotationLeft}
															</div>
														</div>
													)}
													{(viewingVersionData as any).hipInternalRotationRight && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Hip Internal Rotation (Right)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).hipInternalRotationRight}
															</div>
														</div>
													)}
													{(viewingVersionData as any).hipInternalRotationLeft && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Hip Internal Rotation (Left)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).hipInternalRotationLeft}
															</div>
														</div>
													)}
													{(viewingVersionData as any).hipExtensionRight && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Hip Extension (Right)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).hipExtensionRight}
															</div>
														</div>
													)}
													{(viewingVersionData as any).hipExtensionLeft && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Hip Extension (Left)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).hipExtensionLeft}
															</div>
														</div>
													)}
													{(viewingVersionData as any).activeSLRRight && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Active SLR (Right)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).activeSLRRight}
															</div>
														</div>
													)}
													{(viewingVersionData as any).activeSLRLeft && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Active SLR (Left)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).activeSLRLeft}
															</div>
														</div>
													)}
													{(viewingVersionData as any).pronePlank && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Prone Plank</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).pronePlank}
															</div>
														</div>
													)}
													{(viewingVersionData as any).sidePlankRight && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Side Plank (Right)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).sidePlankRight}
															</div>
														</div>
													)}
													{(viewingVersionData as any).sidePlankLeft && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Side Plank (Left)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).sidePlankLeft}
															</div>
														</div>
													)}
													{(viewingVersionData as any).storkStandingBalanceTestRight && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Stork Standing Balance Test (Right)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).storkStandingBalanceTestRight}
															</div>
														</div>
													)}
													{(viewingVersionData as any).storkStandingBalanceTestLeft && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Stork Standing Balance Test (Left)</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).storkStandingBalanceTestLeft}
															</div>
														</div>
													)}
													{(viewingVersionData as any).deepSquat && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Deep Squat</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).deepSquat}
															</div>
														</div>
													)}
													{(viewingVersionData as any).pushup && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Push-up</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).pushup}
															</div>
														</div>
													)}
													{(viewingVersionData as any).fmsScore && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">FMS Score</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).fmsScore}
															</div>
														</div>
													)}
													{(viewingVersionData as any).totalFmsScore && (
														<div>
															<label className="block text-xs font-medium text-slate-500 mb-1">Total FMS Score</label>
															<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
																{(viewingVersionData as any).totalFmsScore}
															</div>
														</div>
													)}
												</div>
											</div>
										)}

										{/* Summary */}
										{(viewingVersionData as any).summary && (
											<div>
												<h3 className="text-sm font-semibold text-sky-600 mb-3 border-b border-sky-200 pb-2">Summary</h3>
												<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
													{(viewingVersionData as any).summary}
												</div>
											</div>
										)}
											</>
										);
									} else {
										// Type assertion: we know this is a physiotherapy report in this branch
										const physioData = viewingVersionData as Partial<PatientRecordFull>;
										return (
											<>
											{/* Patient Information */}
											<div className="mb-8 border-b border-slate-200 pb-6">
												<h2 className="mb-4 text-xl font-bold text-sky-600">Physiotherapy Report</h2>
												<div className="mb-4 text-right text-sm text-slate-600">
													<div>
														<b>Clinic:</b> Centre For Sports Science, Kanteerava Stadium
													</div>
													<div>
														<b>Report Date:</b> {physioData.dateOfConsultation || new Date().toLocaleDateString()}
													</div>
												</div>
												<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
													<div>
														<label className="block text-xs font-medium text-slate-500">Patient Name</label>
														<input
															type="text"
															value={reportPatientData.name || ''}
															readOnly
															className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
														/>
													</div>
													<div>
														<label className="block text-xs font-medium text-slate-500">Patient ID</label>
														<input
															type="text"
															value={reportPatientData.patientId || ''}
															readOnly
															className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
														/>
													</div>
													<div>
														<label className="block text-xs font-medium text-slate-500">Date of Birth</label>
														<input
															type="date"
															value={reportPatientData.dob || ''}
															readOnly
															className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
														/>
													</div>
												</div>
											</div>

											{/* Assessment Section - Read Only */}
											<div className="space-y-6">
												{physioData.dateOfConsultation && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">Date of Consultation</label>
											<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
												{physioData.dateOfConsultation}
											</div>
										</div>
									)}

									{physioData.chiefComplaint && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">Chief Complaint</label>
											<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
												{physioData.chiefComplaint}
											</div>
										</div>
									)}

									{(physioData.history || physioData.presentHistory || physioData.pastHistory) && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">History</label>
											<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
												{physioData.history || (physioData.presentHistory || '') + (physioData.pastHistory ? '\n' + physioData.pastHistory : '')}
											</div>
										</div>
									)}

									{((physioData.med_xray || physioData.med_mri || physioData.med_report || physioData.med_ct) || physioData.surgicalHistory) && (
										<div className="grid gap-4 sm:grid-cols-2">
											{(physioData.med_xray || physioData.med_mri || physioData.med_report || physioData.med_ct) && (
												<div>
													<label className="block text-xs font-medium text-slate-500 mb-1">Medical History</label>
													<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
														{[
															physioData.med_xray && 'X-RAYS',
															physioData.med_mri && 'MRI',
															physioData.med_report && 'Reports',
															physioData.med_ct && 'CT Scans'
														].filter(Boolean).join(', ') || '—'}
													</div>
												</div>
											)}
											{physioData.surgicalHistory && (
												<div>
													<label className="block text-xs font-medium text-slate-500 mb-1">Surgical History</label>
													<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
														{physioData.surgicalHistory}
													</div>
												</div>
											)}
										</div>
									)}

									{((physioData.per_smoking || physioData.per_drinking || physioData.per_alcohol || physioData.per_drugs) || physioData.sleepCycle || physioData.hydration || physioData.nutrition) && (
										<div className="grid gap-4 sm:grid-cols-2">
											{(physioData.per_smoking || physioData.per_drinking || physioData.per_alcohol || physioData.per_drugs) && (
												<div>
													<label className="block text-xs font-medium text-slate-500 mb-1">Personal History</label>
													<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
														{[
															physioData.per_smoking && 'Smoking',
															physioData.per_drinking && 'Drinking',
															physioData.per_alcohol && 'Alcohol',
															physioData.per_drugs && `Drugs${physioData.drugsText ? ` (${physioData.drugsText})` : ''}`
														].filter(Boolean).join(', ') || '—'}
													</div>
												</div>
											)}
											{physioData.sleepCycle && (
												<div>
													<label className="block text-xs font-medium text-slate-500 mb-1">Sleep Cycle</label>
													<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
														{physioData.sleepCycle}
													</div>
												</div>
											)}
											{physioData.hydration && (
												<div>
													<label className="block text-xs font-medium text-slate-500 mb-1">Hydration</label>
													<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
														{physioData.hydration}/8 {HYDRATION_EMOJIS[Math.min(HYDRATION_EMOJIS.length - 1, Math.max(1, Number(physioData.hydration)) - 1)]}
													</div>
												</div>
											)}
											{physioData.nutrition && (
												<div>
													<label className="block text-xs font-medium text-slate-500 mb-1">Nutrition</label>
													<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
														{physioData.nutrition}
													</div>
												</div>
											)}
										</div>
									)}

									{(physioData.siteSide || physioData.onset || physioData.duration || physioData.natureOfInjury || physioData.typeOfPain || physioData.aggravatingFactor || physioData.relievingFactor) && (
										<div>
											<h3 className="text-sm font-semibold text-sky-600 mb-3 border-b border-sky-200 pb-2">Pain Assessment</h3>
											<div className="grid gap-4 sm:grid-cols-2">
												{physioData.siteSide && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Site and Side</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{physioData.siteSide}
														</div>
													</div>
												)}
												{physioData.onset && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Onset</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{physioData.onset}
														</div>
													</div>
												)}
												{physioData.duration && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Duration</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{physioData.duration}
														</div>
													</div>
												)}
												{physioData.natureOfInjury && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Nature of Injury</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{physioData.natureOfInjury}
														</div>
													</div>
												)}
												{physioData.aggravatingFactor && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Aggravating Factor</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
															{physioData.aggravatingFactor}
														</div>
													</div>
												)}
												{physioData.relievingFactor && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Relieving Factor</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
															{physioData.relievingFactor}
														</div>
													</div>
												)}
											</div>
										</div>
									)}

									{(physioData.differentialDiagnosis || physioData.clinicalDiagnosis) && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">Differential Diagnosis</label>
											<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
												{physioData.differentialDiagnosis || physioData.clinicalDiagnosis}
											</div>
										</div>
									)}

									{physioData.vasScale && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">VAS Scale</label>
											<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
												{physioData.vasScale} {VAS_EMOJIS[Math.min(VAS_EMOJIS.length - 1, Math.max(1, Number(physioData.vasScale)) - 1)]}
											</div>
										</div>
									)}

									{physioData.rom && Object.keys(physioData.rom).length > 0 && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-2">ROM (Range of Motion)</label>
											<div className="bg-slate-50 border border-slate-200 rounded-md p-4">
												{Object.entries(physioData.rom).map(([joint, data]: [string, any]) => (
													<div key={joint} className="mb-4 last:mb-0">
														<h6 className="text-sm font-semibold text-sky-600 mb-2">{joint}</h6>
														{data && typeof data === 'object' && (
															<div className="text-xs text-slate-700 space-y-1 ml-4">
																{Object.entries(data).map(([motion, value]: [string, any]) => (
																	<div key={motion}>
																		<span className="font-medium">{motion}:</span> {String(value || '—')}
																	</div>
																))}
															</div>
														)}
													</div>
												))}
											</div>
										</div>
									)}

									{physioData.mmt && Object.keys(physioData.mmt).length > 0 && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-2">MMT (Manual Muscle Testing)</label>
											<div className="bg-slate-50 border border-slate-200 rounded-md p-4">
												{Object.entries(physioData.mmt).map(([joint, data]: [string, any]) => (
													<div key={joint} className="mb-4 last:mb-0">
														<h6 className="text-sm font-semibold text-sky-600 mb-2">{joint}</h6>
														{data && typeof data === 'object' && (
															<div className="text-xs text-slate-700 space-y-1 ml-4">
																{Object.entries(data).map(([motion, value]: [string, any]) => (
																	<div key={motion}>
																		<span className="font-medium">{motion}:</span> {String(value || '—')}
																	</div>
																))}
															</div>
														)}
													</div>
												))}
											</div>
										</div>
									)}

									{/* On Observation Section */}
									{(physioData.built || physioData.posture || physioData.gaitAnalysis || physioData.mobilityAids) && (
										<div>
											<h3 className="text-sm font-semibold text-sky-600 mb-3 border-b border-sky-200 pb-2">On Observation</h3>
											<div className="grid gap-4 sm:grid-cols-2">
												{physioData.built && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Built</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{physioData.built}
														</div>
													</div>
												)}
												{physioData.posture && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Posture</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{physioData.posture}
														</div>
													</div>
												)}
												{physioData.gaitAnalysis && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Gait Analysis</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{physioData.gaitAnalysis}
														</div>
													</div>
												)}
												{physioData.mobilityAids && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Mobility Aids</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{physioData.mobilityAids}
														</div>
													</div>
												)}
											</div>
										</div>
									)}

									{/* On Palpation Section */}
									{(physioData.localObservation || physioData.swelling || physioData.muscleWasting || physioData.tenderness || physioData.warmth || physioData.scar || physioData.crepitus || physioData.odema) && (
										<div>
											<h3 className="text-sm font-semibold text-sky-600 mb-3 border-b border-sky-200 pb-2">On Palpation</h3>
											<div className="grid gap-4 sm:grid-cols-2">
												{physioData.localObservation && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Local Observation</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
															{physioData.localObservation}
														</div>
													</div>
												)}
												{physioData.swelling && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Swelling</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{physioData.swelling}
														</div>
													</div>
												)}
												{physioData.muscleWasting && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Muscle Wasting</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{physioData.muscleWasting}
														</div>
													</div>
												)}
												{physioData.tenderness && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Tenderness</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{physioData.tenderness}
														</div>
													</div>
												)}
												{physioData.warmth && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Warmth</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{physioData.warmth}
														</div>
													</div>
												)}
												{physioData.scar && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Scar</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{physioData.scar}
														</div>
													</div>
												)}
												{physioData.crepitus && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Crepitus</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{physioData.crepitus}
														</div>
													</div>
												)}
												{physioData.odema && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Oedema</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{physioData.odema}
														</div>
													</div>
												)}
											</div>
										</div>
									)}

									{/* Advanced Assessment */}
									{(physioData.specialTest || physioData.differentialDiagnosis || physioData.finalDiagnosis) && (
										<div>
											<h3 className="text-sm font-semibold text-sky-600 mb-3 border-b border-sky-200 pb-2">Advanced Assessment</h3>
											<div className="space-y-4">
												{physioData.specialTest && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Special Test</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
															{physioData.specialTest}
														</div>
													</div>
												)}
												{physioData.differentialDiagnosis && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Differential Diagnosis</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
															{physioData.differentialDiagnosis}
														</div>
													</div>
												)}
												{physioData.finalDiagnosis && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Final Diagnosis</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
															{physioData.finalDiagnosis}
														</div>
													</div>
												)}
											</div>
										</div>
									)}

									{/* Treatment Plan & Management */}
									<div>
										<h3 className="text-sm font-semibold text-sky-600 mb-3 border-b border-sky-200 pb-2">Physiotherapy Management</h3>
										<div className="space-y-4">
												{physioData.shortTermGoals && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Short Term Goals</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
															{physioData.shortTermGoals}
														</div>
													</div>
												)}
												{physioData.longTermGoals && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Long Term Goals</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
															{physioData.longTermGoals}
														</div>
													</div>
												)}
												{(physioData.treatment || physioData.treatmentProvided) && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Treatment</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
															{physioData.treatment || physioData.treatmentProvided}
														</div>
													</div>
												)}
												{physioData.treatmentPlan && Array.isArray(physioData.treatmentPlan) && physioData.treatmentPlan.length > 0 && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Treatment Plan</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															<ul className="list-disc list-inside space-y-1">
																{physioData.treatmentPlan.map((item: any, index: number) => (
																	<li key={index}>
																		{typeof item === 'string' ? item : `${item.therapy || ''} - ${item.frequency || ''} - ${item.remarks || ''}`}
																	</li>
																))}
															</ul>
														</div>
													</div>
												)}
												{physioData.progressNotes && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Progress Notes</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
															{physioData.progressNotes}
														</div>
													</div>
												)}
												{physioData.advice && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Advice</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
															{physioData.advice}
														</div>
													</div>
												)}
												{!physioData.shortTermGoals && !physioData.longTermGoals && !physioData.treatment && !physioData.treatmentProvided && (!physioData.treatmentPlan || (Array.isArray(physioData.treatmentPlan) && physioData.treatmentPlan.length === 0)) && !physioData.progressNotes && !physioData.advice && (
													<div className="text-sm text-slate-500 italic py-4 text-center">
														No management information available for this report.
													</div>
												)}
											</div>
										</div>

									{/* Follow-Up Visits */}
									{physioData.followUpVisits && Array.isArray(physioData.followUpVisits) && physioData.followUpVisits.length > 0 && (
										<div>
											<h3 className="text-sm font-semibold text-sky-600 mb-3 border-b border-sky-200 pb-2">Follow-Up Visits</h3>
											<div className="overflow-x-auto">
												<table className="min-w-full divide-y divide-slate-200 border border-slate-300">
													<thead className="bg-slate-100">
														<tr>
															<th className="px-3 py-2 text-left text-xs font-semibold text-slate-700">Visit #</th>
															<th className="px-3 py-2 text-left text-xs font-semibold text-slate-700">Date</th>
															<th className="px-3 py-2 text-left text-xs font-semibold text-slate-700">Pain Level</th>
															<th className="px-3 py-2 text-left text-xs font-semibold text-slate-700">Findings</th>
														</tr>
													</thead>
													<tbody className="bg-white divide-y divide-slate-200">
														{physioData.followUpVisits.map((visit: any, index: number) => (
															<tr key={index}>
																<td className="px-3 py-2 text-xs text-slate-700">{index + 1}</td>
																<td className="px-3 py-2 text-xs text-slate-700">{visit.visitDate || '—'}</td>
																<td className="px-3 py-2 text-xs text-slate-700">{visit.painLevel || '—'}</td>
																<td className="px-3 py-2 text-xs text-slate-700">{visit.findings || '—'}</td>
															</tr>
														))}
													</tbody>
												</table>
											</div>
										</div>
									)}

									{/* Current Status */}
									{(physioData.currentPainStatus || physioData.currentRom || physioData.currentStrength || physioData.currentFunctionalAbility || physioData.complianceWithHEP) && (
										<div>
											<h3 className="text-sm font-semibold text-sky-600 mb-3 border-b border-sky-200 pb-2">Current Status</h3>
											<div className="grid gap-4 sm:grid-cols-2">
												{physioData.currentPainStatus && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Current Pain Status</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{physioData.currentPainStatus}
														</div>
													</div>
												)}
												{physioData.currentRom && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Current ROM</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{physioData.currentRom}
														</div>
													</div>
												)}
												{physioData.currentStrength && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Current Strength</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{physioData.currentStrength}
														</div>
													</div>
												)}
												{physioData.currentFunctionalAbility && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Current Functional Ability</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{physioData.currentFunctionalAbility}
														</div>
													</div>
												)}
												{physioData.complianceWithHEP && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Compliance with HEP</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{physioData.complianceWithHEP}
														</div>
													</div>
												)}
											</div>
										</div>
									)}

									{physioData.recommendations && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">Recommendations</label>
											<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
												{physioData.recommendations}
											</div>
										</div>
									)}

									{physioData.managementRemarks && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">Management Remarks</label>
											<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
												{physioData.managementRemarks}
											</div>
										</div>
									)}

									{/* Physiotherapist Information */}
									{physioData.physioName && (
										<div>
											<h3 className="text-sm font-semibold text-sky-600 mb-3 border-b border-sky-200 pb-2">Physiotherapist Information</h3>
											<div className="grid gap-4 sm:grid-cols-2">
												<div>
													<label className="block text-xs font-medium text-slate-500 mb-1">Physiotherapist Name</label>
													<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
														{physioData.physioName}
													</div>
												</div>
											</div>
										</div>
									)}

									{physioData.nextFollowUpDate && (
										<div className="grid gap-4 sm:grid-cols-2">
											<div>
												<label className="block text-xs font-medium text-slate-500 mb-1">Next Follow-up Date</label>
												<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
													{physioData.nextFollowUpDate}
												</div>
											</div>
											{physioData.nextFollowUpTime && (
												<div>
													<label className="block text-xs font-medium text-slate-500 mb-1">Next Follow-up Time</label>
													<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
														{physioData.nextFollowUpTime}
													</div>
												</div>
											)}
										</div>
									)}
											</div>
										</>
									) as React.ReactElement;
									}
									return null as React.ReactElement | null;
								})()}
							</div>
						</div>
						<div className="flex items-center justify-end gap-3 p-6 border-t border-slate-200 flex-shrink-0 bg-white">
							<button
								type="button"
								onClick={async () => {
									try {
										const versionData = reportPatientData ? { ...reportPatientData, ...viewingVersionData } : viewingVersionData;
										
										// Check if this is a Strength and Conditioning report
										const isSCReport = viewingVersionIsStrengthConditioning || 
											'sports' in viewingVersionData || 
											'trainingAge' in viewingVersionData || 
											'competitionLevel' in viewingVersionData ||
											'scRPEPlanned' in viewingVersionData;
										
										if (isSCReport) {
											// Generate Strength and Conditioning PDF
											await generateStrengthConditioningPDF({
												patient: {
													name: reportPatientData.name,
													patientId: reportPatientData.patientId,
													dob: reportPatientData.dob || '',
													gender: reportPatientData.gender || '',
													phone: reportPatientData.phone || '',
													email: reportPatientData.email || '',
												},
												formData: versionData as StrengthConditioningData,
											});
										} else {
											// Generate regular Physiotherapy PDF
											const age = versionData.dob ? new Date().getFullYear() - new Date(versionData.dob).getFullYear() : undefined;
											const reportData = {
											patientName: versionData.name || reportPatientData.name,
											patientId: versionData.patientId || reportPatientData.patientId,
											referredBy: versionData.assignedDoctor || versionData.referredBy || '',
											age: age ? String(age) : '',
											gender: versionData.gender || reportPatientData.gender || '',
											dateOfConsultation: versionData.dateOfConsultation || new Date().toISOString().split('T')[0],
											contact: versionData.phone || reportPatientData.phone || '',
											email: versionData.email || reportPatientData.email || '',
											totalSessionsRequired: versionData.totalSessionsRequired,
											remainingSessions: versionData.remainingSessions,
											history: versionData.history || (versionData.presentHistory || '') + (versionData.pastHistory ? '\n' + versionData.pastHistory : ''),
											surgicalHistory: versionData.surgicalHistory || '',
											medicalHistory: getMedicalHistoryText(versionData),
											sleepCycle: versionData.sleepCycle || '',
											hydration: versionData.hydration || '4',
											nutrition: versionData.nutrition || '',
											chiefComplaint: versionData.chiefComplaint || versionData.complaints || '',
											onsetType: versionData.onsetType || '',
											duration: versionData.duration || '',
											mechanismOfInjury: versionData.mechanismOfInjury || '',
											painType: versionData.painType || versionData.typeOfPain || '',
											painIntensity: versionData.painIntensity || versionData.vasScale || '',
											aggravatingFactor: versionData.aggravatingFactor || '',
											relievingFactor: versionData.relievingFactor || '',
											siteSide: versionData.siteSide || '',
											onset: versionData.onset || '',
											natureOfInjury: versionData.natureOfInjury || '',
											typeOfPain: versionData.typeOfPain || '',
											vasScale: versionData.vasScale || '5',
											rom: versionData.rom || {},
											mmt: versionData.mmt || {},
											built: versionData.built || '',
											posture: versionData.posture || '',
											postureManualNotes: versionData.postureManualNotes || '',
											postureFileName: versionData.postureFileName || '',
											gaitAnalysis: versionData.gaitAnalysis || '',
											gaitManualNotes: versionData.gaitManualNotes || '',
											gaitFileName: versionData.gaitFileName || '',
											mobilityAids: versionData.mobilityAids || '',
											localObservation: versionData.localObservation || '',
											swelling: versionData.swelling || '',
											muscleWasting: versionData.muscleWasting || '',
											tenderness: versionData.tenderness || '',
											warmth: versionData.warmth || '',
											scar: versionData.scar || '',
											crepitus: versionData.crepitus || '',
											odema: versionData.odema || '',
											specialTest: versionData.specialTest || '',
											differentialDiagnosis: versionData.differentialDiagnosis || '',
											clinicalDiagnosis: versionData.clinicalDiagnosis || '',
											finalDiagnosis: versionData.finalDiagnosis || '',
											shortTermGoals: versionData.shortTermGoals || '',
											longTermGoals: versionData.longTermGoals || '',
											rehabProtocol: versionData.rehabProtocol || '',
											treatmentProvided: versionData.treatmentProvided || '',
											advice: versionData.advice || '',
											nextFollowUpDate: versionData.nextFollowUpDate || '',
											nextFollowUpTime: versionData.nextFollowUpTime || '',
											followUpVisits: versionData.followUpVisits || [],
											currentPainStatus: versionData.currentPainStatus || '',
											currentRom: versionData.currentRom || '',
											currentStrength: versionData.currentStrength || '',
											currentFunctionalAbility: versionData.currentFunctionalAbility || '',
											complianceWithHEP: versionData.complianceWithHEP || '',
											physioName: versionData.physioName || '',
											physioRegNo: versionData.physioId || '',
											patientType: versionData.patientType || '',
										};
										await generatePhysiotherapyReportPDF(reportData);
										}
									} catch (error) {
										console.error('Error downloading PDF:', error);
										alert('Failed to download PDF. Please try again.');
									}
								}}
								className="inline-flex items-center rounded-lg border border-sky-600 px-4 py-2 text-sm font-medium text-sky-600 transition hover:bg-sky-50 focus-visible:outline-none"
							>
								<i className="fas fa-download mr-2" aria-hidden="true" />
								Download PDF
							</button>
							<button
								type="button"
								onClick={() => {
									setViewingVersionData(null);
									setViewingVersionIsStrengthConditioning(false);
								}}
								className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 transition"
							>
								Close
							</button>
						</div>
					</div>
				</div>
				);
			})()}
		</div>
	);
}

