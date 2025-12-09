'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { collection, doc, query, where, getDocs, onSnapshot, orderBy, updateDoc, addDoc, setDoc, serverTimestamp, type Timestamp, type QuerySnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { generatePhysiotherapyReportPDF, generateStrengthConditioningPDF, type StrengthConditioningData, type ReportSection } from '@/lib/pdfGenerator';
import type { PatientRecordFull } from '@/lib/types';
import { recordSessionUsageForAppointment } from '@/lib/sessionAllowanceClient';
import { getHeaderConfig, getDefaultHeaderConfig } from '@/lib/headerConfig';
import type { HeaderConfig } from '@/components/admin/HeaderManagement';

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
	const cleaned: Partial<T> = {};
	for (const key in obj) {
		const value = obj[key];
		if (value !== undefined) {
			if (value !== null && typeof value === 'object' && !Array.isArray(value) && !((value as any) instanceof Date)) {
				const cleanedNested = removeUndefined(value);
				if (Object.keys(cleanedNested).length > 0) {
					cleaned[key] = cleanedNested as any;
				}
			} else {
				cleaned[key] = value;
			}
		}
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
	reportDate?: string
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
		await updateDoc(appointmentDoc.ref, { status: 'completed' });

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
		const remainingSessions = Math.max(0, totalRequired - 1 - completedCount);

		const updates: Partial<PatientRecordFull> = {
			remainingSessions,
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
	initialTab?: 'report' | 'strength-conditioning';
	onClose: () => void;
	editable?: boolean; // If true, fields are editable; if false, read-only (for frontdesk)
}

export default function EditReportModal({ isOpen, patientId, initialTab = 'report', onClose, editable = true }: EditReportModalProps) {
	const { user } = useAuth();
	const [activeReportTab, setActiveReportTab] = useState<'report' | 'strength-conditioning'>(initialTab);
	const [reportPatientData, setReportPatientData] = useState<any>(null);
	const [strengthConditioningData, setStrengthConditioningData] = useState<any>(null);
	const [currentDate, setCurrentDate] = useState<string>('');

	// Set current date only on client to avoid hydration mismatch
	useEffect(() => {
		setCurrentDate(new Date().toLocaleDateString());
	}, []);
	const [strengthConditioningFormData, setStrengthConditioningFormData] = useState<StrengthConditioningData>({});
	const [clinicalTeamMembers, setClinicalTeamMembers] = useState<Array<{ id: string; userName: string; userEmail?: string }>>([]);
	const [loadingReport, setLoadingReport] = useState(false);
	const [loadingStrengthConditioning, setLoadingStrengthConditioning] = useState(false);
	const [savingStrengthConditioning, setSavingStrengthConditioning] = useState(false);
	const [savedStrengthConditioningMessage, setSavedStrengthConditioningMessage] = useState(false);
	const strengthConditioningUnsubscribeRef = useRef<(() => void) | null>(null);
	
	// Form state
	const [patientDocId, setPatientDocId] = useState<string | null>(null);
	const [formData, setFormData] = useState<Partial<PatientRecordFull>>({});
	const [saving, setSaving] = useState(false);
	const [savedMessage, setSavedMessage] = useState(false);
	const [selectedRomJoint, setSelectedRomJoint] = useState('');
	const [selectedMmtJoint, setSelectedMmtJoint] = useState('');
	const [sessionCompleted, setSessionCompleted] = useState(false);
	const [headerConfig, setHeaderConfig] = useState<HeaderConfig | null>(null);
	
	// Version history state
	const [showVersionHistory, setShowVersionHistory] = useState(false);
	const [versionHistory, setVersionHistory] = useState<Array<{
		id: string;
		version: number;
		createdAt: string;
		createdBy: string;
		data: Partial<PatientRecordFull>;
	}>>([]);
	const [loadingVersions, setLoadingVersions] = useState(false);
	const [viewingVersionData, setViewingVersionData] = useState<Partial<PatientRecordFull> | null>(null);
	const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null);
	
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

	// Reset state when modal closes
	useEffect(() => {
		if (!isOpen) {
			setReportPatientData(null);
			setStrengthConditioningData(null);
			setViewingVersionData(null);
			setActiveReportTab(initialTab);
			if (strengthConditioningUnsubscribeRef.current) {
				strengthConditioningUnsubscribeRef.current();
				strengthConditioningUnsubscribeRef.current = null;
			}
		}
	}, [isOpen, initialTab]);

	// Load data when modal opens
	useEffect(() => {
		if (!isOpen || !patientId) return;

		const loadData = async () => {
			setLoadingReport(true);
			setLoadingStrengthConditioning(true);
			setReportPatientData(null);
			setStrengthConditioningData(null);
			setFormData({});

			// Load regular report data
			try {
				const patientSnap = await getDocs(query(collection(db, 'patients'), where('patientId', '==', patientId)));
				if (!patientSnap.empty) {
					const patientDoc = patientSnap.docs[0];
					const patientData = patientDoc.data() as PatientRecordFull;
					setReportPatientData(patientData);
					setPatientDocId(patientDoc.id);
					
					// Initialize formData with patient data if editable
					if (editable) {
						setFormData(applyCurrentSessionAdjustments(patientData));
					}
					
					// Load header config
					const patientType = patientData.patientType || 'nonDYES';
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
			} catch (error) {
				console.error('Failed to load patient report:', error);
			} finally {
				setLoadingReport(false);
			}

			// Load strength and conditioning report
			try {
				const patientSnap = await getDocs(query(collection(db, 'patients'), where('patientId', '==', patientId)));
				if (!patientSnap.empty) {
					const patientDoc = patientSnap.docs[0];
					const documentId = patientDoc.id || patientId;
					
					const reportRef = doc(db, 'strengthConditioningReports', documentId);
					const unsubscribe = onSnapshot(reportRef, (docSnap) => {
						if (docSnap.exists()) {
							const data = docSnap.data() as StrengthConditioningData;
							setStrengthConditioningData(data);
							// Initialize formData with strength conditioning data if editable
							if (editable) {
								setStrengthConditioningFormData(data);
							}
						} else {
							setStrengthConditioningData(null);
							if (editable) {
								setStrengthConditioningFormData({});
							}
						}
						setLoadingStrengthConditioning(false);
					}, (error) => {
						console.error('Error loading strength and conditioning report:', error);
						setStrengthConditioningData(null);
						setLoadingStrengthConditioning(false);
					});
					
					strengthConditioningUnsubscribeRef.current = unsubscribe;
				}
			} catch (error) {
				console.error('Failed to load strength and conditioning report', error);
				setStrengthConditioningData(null);
				setLoadingStrengthConditioning(false);
			}
		};

		loadData();
	}, [isOpen, patientId]);

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
				setClinicalTeamMembers(mapped);
			},
			error => {
				console.error('Failed to load clinical team members', error);
				setClinicalTeamMembers([]);
			}
		);

		return () => unsubscribe();
	}, []);

	// Sync strength conditioning data with form data
	useEffect(() => {
		if (strengthConditioningData) {
			setStrengthConditioningFormData(strengthConditioningData);
		} else if (reportPatientData?.id) {
			// Initialize with current user's name if available
			const currentUserStaff = clinicalTeamMembers.find(m => m.userEmail === user?.email);
			setStrengthConditioningFormData({
				therapistName: currentUserStaff?.userName || user?.displayName || user?.email || '',
			});
		}
	}, [strengthConditioningData, reportPatientData?.id, clinicalTeamMembers, user?.displayName, user?.email]);

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
			complaints: displayData.complaints || '',
			presentHistory: displayData.presentHistory || '',
			pastHistory: displayData.pastHistory || '',
			surgicalHistory: displayData.surgicalHistory || '',
			medicalHistory: getMedicalHistoryText(displayData),
			sleepCycle: displayData.sleepCycle || '',
			hydration: displayData.hydration || '4',
			nutrition: displayData.nutrition || '',
			chiefComplaint: displayData.chiefComplaint || displayData.complaints || '',
			onsetType: displayData.onsetType || '',
			duration: displayData.duration || '',
			mechanismOfInjury: displayData.mechanismOfInjury || '',
			painType: displayData.painType || displayData.typeOfPain || '',
			painIntensity: displayData.painIntensity || displayData.vasScale || '',
			aggravatingFactor: displayData.aggravatingFactor || '',
			relievingFactor: displayData.relievingFactor || '',
			siteSide: displayData.siteSide || '',
			onset: displayData.onset || '',
			natureOfInjury: displayData.natureOfInjury || '',
			typeOfPain: displayData.typeOfPain || '',
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
			differentialDiagnosis: displayData.differentialDiagnosis || '',
			clinicalDiagnosis: displayData.clinicalDiagnosis || '',
			finalDiagnosis: displayData.finalDiagnosis || '',
			shortTermGoals: displayData.shortTermGoals || '',
			longTermGoals: displayData.longTermGoals || '',
			rehabProtocol: displayData.rehabProtocol || '',
			treatmentProvided: displayData.treatmentProvided || '',
			treatmentPlan: displayData.treatmentPlan || [],
			progressNotes: displayData.progressNotes || '',
			advice: displayData.advice || '',
			recommendations: displayData.recommendations || '',
			managementRemarks: displayData.managementRemarks || '',
			physiotherapistRemarks: displayData.physiotherapistRemarks || '',
			nextFollowUpDate: displayData.nextFollowUpDate || '',
			nextFollowUpTime: displayData.nextFollowUpTime || '',
			followUpVisits: displayData.followUpVisits || [],
			currentPainStatus: displayData.currentPainStatus || '',
			currentRom: displayData.currentRom || '',
			currentStrength: displayData.currentStrength || '',
			currentFunctionalAbility: displayData.currentFunctionalAbility || '',
			complianceWithHEP: displayData.complianceWithHEP || '',
			physioName: displayData.physioName || '',
			physioRegNo: displayData.physioId || '',
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
											className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
											placeholder="Enter value"
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
													className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
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
													className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
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
										className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
										placeholder="Left"
									/>
								</td>
								<td className="px-3 py-2 text-slate-700">{motion}</td>
								<td className="px-3 py-2">
									<input
										type="text"
										value={data?.right?.[motion] || ''}
										onChange={e => handleRomChange(joint, motion, 'right', e.target.value)}
										className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
										placeholder="Right"
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
												className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
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
											className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
											placeholder="Grade"
										/>
									</td>
									<td className="px-3 py-2 text-slate-700">{label}</td>
									<td className="px-3 py-2">
										<input
											type="text"
											value={data?.right?.[motion] || ''}
											onChange={e => handleMmtChange(joint, motion, 'right', e.target.value)}
											className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
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
	const handleFieldChangeStrengthConditioning = (field: keyof StrengthConditioningData, value: string) => {
		setStrengthConditioningFormData(prev => ({ ...prev, [field]: value }));
	};

	// Handle save for strength conditioning
	const handleSaveStrengthConditioning = async () => {
		if (!reportPatientData?.id || savingStrengthConditioning || !patientId) {
			alert('Please select a patient first');
			return;
		}

		setSavingStrengthConditioning(true);
		try {
			const docRef = doc(db, 'strengthConditioningReports', reportPatientData.id);
			await setDoc(docRef, {
				...strengthConditioningFormData,
				therapistName: strengthConditioningFormData.therapistName || user?.displayName || user?.email || '',
				patientId: reportPatientData.patientId,
				patientName: reportPatientData.name,
				updatedAt: new Date().toISOString(),
				updatedBy: user?.email || user?.displayName || 'Unknown',
			}, { merge: true });

			setSavedStrengthConditioningMessage(true);
			setTimeout(() => setSavedStrengthConditioningMessage(false), 3000);
		} catch (error) {
			console.error('Failed to save strength and conditioning report', error);
			alert('Failed to save report. Please try again.');
		} finally {
			setSavingStrengthConditioning(false);
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
			
			const reportData: Record<string, any> = {
				complaints: formData.complaints || '',
				presentHistory: formData.presentHistory || '',
				pastHistory: formData.pastHistory || '',
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
				typeOfPain: formData.typeOfPain || '',
				vasScale: formData.vasScale || '',
				aggravatingFactor: formData.aggravatingFactor || '',
				relievingFactor: formData.relievingFactor || '',
				rom: formData.rom || {},
				treatmentProvided: formData.treatmentProvided || '',
				progressNotes: formData.progressNotes || '',
				physioName: formData.physioName || '',
				physioId: formData.physioId || '',
				dateOfConsultation: formData.dateOfConsultation || '',
				referredBy: formData.referredBy || '',
				chiefComplaint: formData.chiefComplaint || '',
				onsetType: formData.onsetType || '',
				mechanismOfInjury: formData.mechanismOfInjury || '',
				painType: formData.painType || '',
				painIntensity: formData.painIntensity || '',
				clinicalDiagnosis: formData.clinicalDiagnosis || '',
				treatmentPlan: formData.treatmentPlan || [],
				followUpVisits: formData.followUpVisits || [],
				currentPainStatus: formData.currentPainStatus || '',
				currentRom: formData.currentRom || '',
				currentStrength: formData.currentStrength || '',
				currentFunctionalAbility: formData.currentFunctionalAbility || '',
				complianceWithHEP: formData.complianceWithHEP || '',
				recommendations: formData.recommendations || '',
				physiotherapistRemarks: formData.physiotherapistRemarks || '',
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
				differentialDiagnosis: formData.differentialDiagnosis || '',
				finalDiagnosis: formData.finalDiagnosis || '',
				shortTermGoals: formData.shortTermGoals || '',
				longTermGoals: formData.longTermGoals || '',
				rehabProtocol: formData.rehabProtocol || '',
				advice: formData.advice || '',
				managementRemarks: formData.managementRemarks || '',
				nextFollowUpDate: formData.nextFollowUpDate || '',
				nextFollowUpTime: formData.nextFollowUpTime || '',
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
				complaints: reportPatientData.complaints,
				presentHistory: reportPatientData.presentHistory,
				pastHistory: reportPatientData.pastHistory,
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
					const versionsQuery = query(
						collection(db, 'reportVersions'),
						where('patientId', '==', reportPatientData.patientId),
						orderBy('version', 'desc')
					);
					const versionsSnapshot = await getDocs(versionsQuery);
					const nextVersion = versionsSnapshot.docs.length > 0 
						? (versionsSnapshot.docs[0].data().version as number) + 1 
						: 1;

					await addDoc(collection(db, 'reportVersions'), {
						patientId: reportPatientData.patientId,
						patientName: reportPatientData.name,
						version: nextVersion,
						reportData: removeUndefined(currentReportData),
						createdBy: user?.displayName || user?.email || 'Unknown',
						createdById: user?.uid || '',
						createdAt: serverTimestamp(),
					});
				} catch (versionError: any) {
					// If orderBy fails (missing index), try without it
					if (versionError.code === 'failed-precondition' || versionError.message?.includes('index')) {
						console.warn('Report version index not found, saving without version history', versionError);
						// Continue without version history
					} else {
						throw versionError; // Re-throw other errors
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
			
			await markAppointmentCompletedForReport(patientForProgress, consultationDate);
			
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

	// Load version history
	const loadVersionHistory = async () => {
		if (!patientId || !reportPatientData?.patientId) return;

		setLoadingVersions(true);
		try {
			const versionsQuery = query(
				collection(db, 'reportVersions'),
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
					data: (data.reportData as Partial<PatientRecordFull>) || {},
				};
			});
			setVersionHistory(versions);
		} catch (error) {
			console.error('Failed to load report history', error);
			alert('Failed to load report history. Please try again.');
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

	// Handle restore version
	const handleRestoreVersion = async (version: typeof versionHistory[0]) => {
		if (!reportPatientData?.id || !confirm(`Are you sure you want to load Report #${version.version}? This will replace the current report data and save the current state as a new report.`)) {
			return;
		}

		setSaving(true);
		try {
			const patientRef = doc(db, 'patients', reportPatientData.id);

			// Create a report snapshot of current data before loading previous report
			const currentReportData: Partial<PatientRecordFull> = {
				complaints: reportPatientData.complaints,
				presentHistory: reportPatientData.presentHistory,
				pastHistory: reportPatientData.pastHistory,
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

			// Save current state as report before loading previous report
			if (hasCurrentData) {
				const versionsQuery = query(
					collection(db, 'reportVersions'),
					where('patientId', '==', reportPatientData.patientId),
					orderBy('version', 'desc')
				);
				const versionsSnapshot = await getDocs(versionsQuery);
				const nextVersion = versionsSnapshot.docs.length > 0 
					? (versionsSnapshot.docs[0].data().version as number) + 1 
					: 1;

				await addDoc(collection(db, 'reportVersions'), {
					patientId: reportPatientData.patientId,
					patientName: reportPatientData.name,
					version: nextVersion,
					reportData: removeUndefined(currentReportData),
					createdBy: user?.displayName || user?.email || 'Unknown',
					createdById: user?.uid || '',
					createdAt: serverTimestamp(),
					restoredFrom: version.version, // Track that this was created from a restore
				});
			}

			// Load the version data into the form
			setFormData(version.data);
			
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
	const handleFieldChange = (field: keyof PatientRecordFull, value: any) => {
		if (!editable) return;
		setFormData(prev => ({ ...prev, [field]: value }));
	};

	const handleCheckboxChange = (field: keyof PatientRecordFull, checked: boolean) => {
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
						<button
							type="button"
							onClick={() => setActiveReportTab('report')}
							className={`px-4 py-3 text-sm font-medium transition border-b-2 ${
								activeReportTab === 'report'
									? 'border-sky-600 text-sky-600'
									: 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
							}`}
						>
							<i className="fas fa-file-medical mr-2" aria-hidden="true" />
							Report
						</button>
						<button
							type="button"
							onClick={() => setActiveReportTab('strength-conditioning')}
							className={`px-4 py-3 text-sm font-medium transition border-b-2 ${
								activeReportTab === 'strength-conditioning'
									? 'border-sky-600 text-sky-600'
									: 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
							}`}
						>
							<i className="fas fa-dumbbell mr-2" aria-hidden="true" />
							Strength and Conditioning
						</button>
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

							{/* Assessment Section */}
							<div className="mb-8">
								<h3 className="mb-4 text-sm font-semibold text-sky-600">Assessment</h3>
								<div className="grid gap-4 sm:grid-cols-2">
									<div>
										<label className="block text-xs font-medium text-slate-500">Date of Consultation</label>
										<input
											type="date"
											value={formData.dateOfConsultation || ''}
											onChange={e => handleFieldChange('dateOfConsultation', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Referred By</label>
										<input
											type="text"
											value={formData.referredBy || ''}
											onChange={e => handleFieldChange('referredBy', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Chief Complaint</label>
										<textarea
											value={formData.chiefComplaint || ''}
											onChange={e => handleFieldChange('chiefComplaint', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											rows={2}
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Complaints</label>
										<textarea
											value={formData.complaints || ''}
											onChange={e => handleFieldChange('complaints', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											rows={2}
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Present History</label>
										<textarea
											value={formData.presentHistory || ''}
											onChange={e => handleFieldChange('presentHistory', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											rows={2}
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Past History</label>
										<textarea
											value={formData.pastHistory || ''}
											onChange={e => handleFieldChange('pastHistory', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											rows={2}
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Medical History</label>
										<div className="mt-2 space-y-2">
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.med_xray || false}
													onChange={e => handleCheckboxChange('med_xray', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												X RAYS
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.med_mri || false}
													onChange={e => handleCheckboxChange('med_mri', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												MRI
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.med_report || false}
													onChange={e => handleCheckboxChange('med_report', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												Reports
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.med_ct || false}
													onChange={e => handleCheckboxChange('med_ct', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												CT Scans
											</label>
										</div>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Surgical History</label>
										<textarea
											value={formData.surgicalHistory || ''}
											onChange={e => handleFieldChange('surgicalHistory', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											rows={2}
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Personal History</label>
										<div className="mt-2 space-y-2">
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.per_smoking || false}
													onChange={e => handleCheckboxChange('per_smoking', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												Smoking
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.per_drinking || false}
													onChange={e => handleCheckboxChange('per_drinking', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												Drinking
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.per_alcohol || false}
													onChange={e => handleCheckboxChange('per_alcohol', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												Alcohol
											</label>
											<label className="flex items-center gap-2 text-sm text-slate-700">
												<input
													type="checkbox"
													checked={formData.per_drugs || false}
													onChange={e => handleCheckboxChange('per_drugs', e.target.checked)}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
												Drugs
											</label>
											{formData.per_drugs && (
												<input
													type="text"
													value={formData.drugsText || ''}
													onChange={e => handleFieldChange('drugsText', e.target.value)}
													className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
													placeholder="Which drug?"
												/>
											)}
										</div>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Sleep Cycle</label>
										<input
											type="text"
											value={formData.sleepCycle || ''}
											onChange={e => handleFieldChange('sleepCycle', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500 mb-2">Hydration</label>
										<div className="flex items-center gap-2">
											<span className="text-xs font-semibold text-slate-500">1</span>
											<input
												type="range"
												min="1"
												max="8"
												value={hydrationValue}
												onChange={e => handleFieldChange('hydration', e.target.value)}
												className="flex-1 h-2 bg-gradient-to-r from-emerald-400 via-amber-400 to-rose-500 rounded-lg appearance-none cursor-pointer"
											/>
											<span className="text-xs font-semibold text-slate-500">8</span>
										</div>
										<div className="mt-3 flex items-center justify-center gap-2">
											<span className="text-3xl transition-transform duration-200" style={{ transform: 'scale(1.2)' }}>
												{hydrationEmoji}
											</span>
											<span className="text-xs text-slate-600 font-medium">{hydrationValue}/8</span>
										</div>
										<div className="mt-2 grid grid-cols-8 text-[10px] text-center text-slate-400">
											{HYDRATION_EMOJIS.map((emoji, idx) => (
												<span
													key={`hydration-${emoji}-${idx}`}
													className={`transition-transform duration-200 ${idx + 1 === hydrationValue ? 'scale-110' : 'scale-90'}`}
												>
													{emoji}
												</span>
											))}
										</div>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Nutrition</label>
										<input
											type="text"
											value={formData.nutrition || ''}
											onChange={e => handleFieldChange('nutrition', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
									</div>
								</div>
							</div>

							{/* Pain Assessment Section */}
							<div className="mb-8">
								<h3 className="mb-4 text-lg font-semibold text-sky-600 border-b border-sky-200 pb-2">Pain Assessment</h3>
								<div className="grid gap-4 sm:grid-cols-2">
									<div>
										<label className="block text-xs font-medium text-slate-500">Site and Side</label>
										<input
											type="text"
											value={formData.siteSide || ''}
											onChange={e => handleFieldChange('siteSide', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Onset</label>
										<input
											type="text"
											value={formData.onset || ''}
											onChange={e => handleFieldChange('onset', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Onset Type</label>
										<input
											type="text"
											value={formData.onsetType || ''}
											onChange={e => handleFieldChange('onsetType', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Duration</label>
										<input
											type="text"
											value={formData.duration || ''}
											onChange={e => handleFieldChange('duration', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Nature of Injury</label>
										<input
											type="text"
											value={formData.natureOfInjury || ''}
											onChange={e => handleFieldChange('natureOfInjury', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Mechanism of Injury</label>
										<input
											type="text"
											value={formData.mechanismOfInjury || ''}
											onChange={e => handleFieldChange('mechanismOfInjury', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Type of Pain</label>
										<input
											type="text"
											value={formData.typeOfPain || ''}
											onChange={e => handleFieldChange('typeOfPain', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Pain Type</label>
										<input
											type="text"
											value={formData.painType || ''}
											onChange={e => handleFieldChange('painType', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Pain Intensity</label>
										<input
											type="text"
											value={formData.painIntensity || ''}
											onChange={e => handleFieldChange('painIntensity', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500 mb-2">VAS Scale</label>
										<div className="flex items-center gap-2">
											<span className="text-xs font-semibold text-slate-500">1</span>
											<input
												type="range"
												min="1"
												max="10"
												value={vasValue}
												onChange={e => handleFieldChange('vasScale', e.target.value)}
												className="flex-1 h-2 bg-gradient-to-r from-emerald-400 via-amber-400 to-rose-500 rounded-lg appearance-none cursor-pointer"
											/>
											<span className="text-xs font-semibold text-slate-500">10</span>
										</div>
										<div className="mt-3 flex items-center justify-center gap-2">
											<span
												className="text-3xl transition-transform duration-200"
												style={{ transform: 'scale(1.2)' }}
												role="img"
												aria-label="Pain emoji"
											>
												{vasEmoji}
											</span>
											<span className="text-xs text-slate-600 font-medium">{vasValue}/10</span>
										</div>
										<div className="mt-2 grid grid-cols-10 text-[10px] text-center text-slate-400">
											{VAS_EMOJIS.map((emoji, idx) => (
												<span
													key={emoji + idx}
													className={`transition-transform duration-200 ${idx + 1 === vasValue ? 'scale-110' : 'scale-90'}`}
												>
													{emoji}
												</span>
											))}
										</div>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Aggravating Factor</label>
										<input
											type="text"
											value={formData.aggravatingFactor || ''}
											onChange={e => handleFieldChange('aggravatingFactor', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Relieving Factor</label>
										<input
											type="text"
											value={formData.relievingFactor || ''}
											onChange={e => handleFieldChange('relievingFactor', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
									</div>
								</div>
							</div>

							{/* On Observation Section */}
							<div className="mb-8">
								<h3 className="mb-4 text-lg font-semibold text-sky-600 border-b border-sky-200 pb-2">On Observation</h3>
								<div className="grid gap-4 sm:grid-cols-2">
									<div>
										<label className="block text-xs font-medium text-slate-500">Built</label>
										<input
											type="text"
											value={formData.built || ''}
											onChange={e => handleFieldChange('built', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500 mb-2">Posture</label>
										<div className="flex gap-4">
											<label className="flex items-center gap-2">
												<input
													type="radio"
													name="posture"
													value="Manual"
													checked={formData.posture === 'Manual'}
													onChange={e => handleFieldChange('posture', e.target.value)}
													className="text-sky-600"
												/>
												<span className="text-sm">Manual</span>
											</label>
											<label className="flex items-center gap-2">
												<input
													type="radio"
													name="posture"
													value="Kinetisense"
													checked={formData.posture === 'Kinetisense'}
													onChange={e => handleFieldChange('posture', e.target.value)}
													className="text-sky-600"
												/>
												<span className="text-sm">Kinetisense</span>
											</label>
										</div>
										{formData.posture === 'Manual' && (
											<textarea
												className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
												rows={2}
												placeholder="Add manual posture notes"
												value={formData.postureManualNotes || ''}
												onChange={e => handleFieldChange('postureManualNotes', e.target.value)}
											/>
										)}
										{formData.posture === 'Kinetisense' && (
											<div className="mt-2 space-y-2">
												<input
													type="file"
													accept=".pdf,.jpg,.jpeg,.png"
													onChange={e => handleFileUpload('postureFileData', 'postureFileName', e.target.files?.[0] || null)}
													className="block w-full text-xs text-slate-600 file:mr-4 file:rounded-full file:border-0 file:bg-sky-50 file:px-3 file:py-1 file:text-sm file:font-semibold file:text-sky-700 hover:file:bg-sky-100"
												/>
												{formData.postureFileName && (
													<div className="flex items-center gap-2">
														<span className="text-xs text-slate-600">{formData.postureFileName}</span>
														<button
															type="button"
															onClick={() => {
																if (formData.postureFileData) {
																	const viewWindow = window.open();
																	if (viewWindow) {
																		viewWindow.document.write(`
																			<html>
																				<head>
																					<title>${formData.postureFileName}</title>
																					<style>
																						body { margin: 0; padding: 0; }
																						iframe { width: 100%; height: 100vh; border: none; }
																					</style>
																				</head>
																				<body>
																					<iframe src="${formData.postureFileData}"></iframe>
																				</body>
																			</html>
																		`);
																		viewWindow.document.close();
																	}
																}
															}}
															className="inline-flex items-center gap-1 rounded-md bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-700 transition hover:bg-sky-200"
														>
															<i className="fas fa-eye" />
															View PDF
														</button>
													</div>
												)}
											</div>
										)}
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500 mb-2">GAIT Analysis</label>
										<div className="flex gap-4">
											<label className="flex items-center gap-2">
												<input
													type="radio"
													name="gaitAnalysis"
													value="Manual"
													checked={formData.gaitAnalysis === 'Manual'}
													onChange={e => handleFieldChange('gaitAnalysis', e.target.value)}
													className="text-sky-600"
												/>
												<span className="text-sm">Manual</span>
											</label>
											<label className="flex items-center gap-2">
												<input
													type="radio"
													name="gaitAnalysis"
													value="OptaGAIT"
													checked={formData.gaitAnalysis === 'OptaGAIT'}
													onChange={e => handleFieldChange('gaitAnalysis', e.target.value)}
													className="text-sky-600"
												/>
												<span className="text-sm">OptaGAIT</span>
											</label>
										</div>
										{formData.gaitAnalysis === 'Manual' && (
											<textarea
												className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
												rows={2}
												placeholder="Manual GAIT analysis notes"
												value={formData.gaitManualNotes || ''}
												onChange={e => handleFieldChange('gaitManualNotes', e.target.value)}
											/>
										)}
										{formData.gaitAnalysis === 'OptaGAIT' && (
											<div className="mt-2 space-y-2">
												<input
													type="file"
													accept=".pdf,.jpg,.jpeg,.png"
													onChange={e => handleFileUpload('gaitFileData', 'gaitFileName', e.target.files?.[0] || null)}
													className="block w-full text-xs text-slate-600 file:mr-4 file:rounded-full file:border-0 file:bg-sky-50 file:px-3 file:py-1 file:text-sm file:font-semibold file:text-sky-700 hover:file:bg-sky-100"
												/>
												{formData.gaitFileName && (
													<div className="flex items-center gap-2">
														<span className="text-xs text-slate-600">{formData.gaitFileName}</span>
														<button
															type="button"
															onClick={() => {
																if (formData.gaitFileData) {
																	const viewWindow = window.open();
																	if (viewWindow) {
																		viewWindow.document.write(`
																			<html>
																				<head>
																					<title>${formData.gaitFileName}</title>
																					<style>
																						body { margin: 0; padding: 0; }
																						iframe { width: 100%; height: 100vh; border: none; }
																					</style>
																				</head>
																				<body>
																					<iframe src="${formData.gaitFileData}"></iframe>
																				</body>
																			</html>
																		`);
																		viewWindow.document.close();
																	}
																}
															}}
															className="inline-flex items-center gap-1 rounded-md bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-700 transition hover:bg-sky-200"
														>
															<i className="fas fa-eye" />
															View PDF
														</button>
													</div>
												)}
											</div>
										)}
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Mobility Aids</label>
										<input
											type="text"
											value={formData.mobilityAids || ''}
											onChange={e => handleFieldChange('mobilityAids', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Local Observation</label>
										<textarea
											value={formData.localObservation || ''}
											onChange={e => handleFieldChange('localObservation', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											rows={2}
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Swelling</label>
										<input
											type="text"
											value={formData.swelling || ''}
											onChange={e => handleFieldChange('swelling', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Muscle Wasting</label>
										<input
											type="text"
											value={formData.muscleWasting || ''}
											onChange={e => handleFieldChange('muscleWasting', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
									</div>
								</div>
							</div>

							{/* On Palpation Section */}
							<div className="mb-8">
								<h3 className="mb-4 text-lg font-semibold text-sky-600 border-b border-sky-200 pb-2">On Palpation</h3>
								<div className="grid gap-4 sm:grid-cols-2">
									<div>
										<label className="block text-xs font-medium text-slate-500">Tenderness</label>
										<input
											type="text"
											value={formData.tenderness || ''}
											onChange={e => handleFieldChange('tenderness', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Warmth</label>
										<input
											type="text"
											value={formData.warmth || ''}
											onChange={e => handleFieldChange('warmth', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Scar</label>
										<input
											type="text"
											value={formData.scar || ''}
											onChange={e => handleFieldChange('scar', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Crepitus</label>
										<input
											type="text"
											value={formData.crepitus || ''}
											onChange={e => handleFieldChange('crepitus', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Odema</label>
										<input
											type="text"
											value={formData.odema || ''}
											onChange={e => handleFieldChange('odema', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
									</div>
								</div>
							</div>

							{/* On Examination Section - ROM Assessment */}
							<div className="mb-8">
								<h3 className="mb-4 text-lg font-semibold text-sky-600 border-b border-sky-200 pb-2">On Examination</h3>
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
								<div className="mt-8 grid gap-4">
									<div>
										<h4 className="mb-2 text-sm font-semibold text-slate-700">iii) Special Tests</h4>
										<textarea
											value={formData.specialTest || ''}
											onChange={e => handleFieldChange('specialTest', e.target.value)}
											className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											rows={3}
											placeholder="Describe special test findings"
										/>
									</div>
									<div>
										<h4 className="mb-2 text-sm font-semibold text-slate-700">iv) Differential Diagnosis</h4>
										<textarea
											value={formData.differentialDiagnosis || ''}
											onChange={e => handleFieldChange('differentialDiagnosis', e.target.value)}
											className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											rows={3}
											placeholder="Possible differentials"
										/>
									</div>
									<div>
										<h4 className="mb-2 text-sm font-semibold text-slate-700">v) Clinical Diagnosis</h4>
										<textarea
											value={formData.clinicalDiagnosis || ''}
											onChange={e => handleFieldChange('clinicalDiagnosis', e.target.value)}
											className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											rows={3}
											placeholder="Clinical diagnosis"
										/>
									</div>
									<div>
										<h4 className="mb-2 text-sm font-semibold text-slate-700">vi) Diagnosis</h4>
										<textarea
											value={formData.finalDiagnosis || ''}
											onChange={e => handleFieldChange('finalDiagnosis', e.target.value)}
											className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											rows={3}
											placeholder="Final working diagnosis"
										/>
									</div>
								</div>
							</div>

							{/* Physiotherapy Management */}
							<div className="mb-10">
								<h3 className="mb-4 text-lg font-semibold text-sky-600 border-b border-sky-200 pb-2">Physiotherapy Management</h3>
								<div className="space-y-4">
									<div>
										<label className="block text-xs font-medium text-slate-500">i) Short Term Goals</label>
										<textarea
											value={formData.shortTermGoals || ''}
											onChange={e => handleFieldChange('shortTermGoals', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											rows={3}
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">ii) Long Term Goals</label>
										<textarea
											value={formData.longTermGoals || ''}
											onChange={e => handleFieldChange('longTermGoals', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											rows={3}
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">iii) Rehab Protocol</label>
										<textarea
											value={formData.rehabProtocol || ''}
											onChange={e => handleFieldChange('rehabProtocol', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											rows={3}
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">iv) Treatment Provided</label>
										<textarea
											value={formData.treatmentProvided || ''}
											onChange={e => handleFieldChange('treatmentProvided', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											rows={3}
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">v) Treatment Plan</label>
										<textarea
											value={Array.isArray(formData.treatmentPlan) ? formData.treatmentPlan.join('\n') : (formData.treatmentPlan || '')}
											onChange={e => handleFieldChange('treatmentPlan', e.target.value.split('\n').filter(line => line.trim()))}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											rows={3}
											placeholder="Enter treatment plan items (one per line)"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">vi) Progress Notes</label>
										<textarea
											value={formData.progressNotes || ''}
											onChange={e => handleFieldChange('progressNotes', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											rows={3}
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">vii) Advice</label>
										<textarea
											value={formData.advice || ''}
											onChange={e => handleFieldChange('advice', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											rows={3}
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">viii) Recommendations</label>
										<textarea
											value={formData.recommendations || ''}
											onChange={e => handleFieldChange('recommendations', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											rows={3}
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">ix) Remarks</label>
										<textarea
											value={formData.managementRemarks || ''}
											onChange={e => handleFieldChange('managementRemarks', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											rows={3}
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">x) Physiotherapist Remarks</label>
										<textarea
											value={formData.physiotherapistRemarks || ''}
											onChange={e => handleFieldChange('physiotherapistRemarks', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											rows={3}
										/>
									</div>
								</div>
							</div>

							{/* Follow-Up Visit Summary */}
							<div className="mb-8">
								<h3 className="mb-4 text-sm font-semibold text-sky-600">Follow-Up Visit Summary</h3>
								<table className="min-w-full divide-y divide-slate-200 border border-slate-300 text-left text-sm">
									<thead className="bg-slate-100">
										<tr>
											<th className="px-3 py-2 font-semibold text-slate-700">Visit</th>
											<th className="px-3 py-2 font-semibold text-slate-700">Pain Level (VAS)</th>
											<th className="px-3 py-2 font-semibold text-slate-700">Findings / Progress</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-slate-200 bg-white">
										{[1, 2, 3, 4].map(index => {
											const visit = formData.followUpVisits?.[index - 1] || { visitDate: '', painLevel: '', findings: '' };
											return (
												<tr key={`visit-${index}`}>
													<td className="px-3 py-2">
														<input
															type="date"
															value={visit.visitDate}
															onChange={e => {
																const newVisits = [...(formData.followUpVisits || [])];
																newVisits[index - 1] = { ...visit, visitDate: e.target.value };
																handleFieldChange('followUpVisits', newVisits);
															}}
															className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
														/>
													</td>
													<td className="px-3 py-2">
														<input
															type="text"
															value={visit.painLevel}
															onChange={e => {
																const newVisits = [...(formData.followUpVisits || [])];
																newVisits[index - 1] = { ...visit, painLevel: e.target.value };
																handleFieldChange('followUpVisits', newVisits);
															}}
															className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
														/>
													</td>
													<td className="px-3 py-2">
														<input
															type="text"
															value={visit.findings}
															onChange={e => {
																const newVisits = [...(formData.followUpVisits || [])];
																newVisits[index - 1] = { ...visit, findings: e.target.value };
																handleFieldChange('followUpVisits', newVisits);
															}}
															className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
														/>
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>

							{/* Current Status */}
							<div className="mb-8">
								<h3 className="mb-4 text-sm font-semibold text-sky-600">Current Status (as on last visit)</h3>
								<div className="grid gap-4 sm:grid-cols-2">
									<div>
										<label className="block text-xs font-medium text-slate-500">Pain</label>
										<select
											value={formData.currentPainStatus || ''}
											onChange={e => handleFieldChange('currentPainStatus', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										>
											<option value="">Select</option>
											<option value="Improved">Improved</option>
											<option value="Same">Same</option>
											<option value="Worsened">Worsened</option>
										</select>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">ROM</label>
										<input
											type="text"
											value={formData.currentRom || ''}
											onChange={e => handleFieldChange('currentRom', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											placeholder="Improved by _*"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Strength</label>
										<input
											type="text"
											value={formData.currentStrength || ''}
											onChange={e => handleFieldChange('currentStrength', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											placeholder="_% improvement noted"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Functional Ability</label>
										<select
											value={formData.currentFunctionalAbility || ''}
											onChange={e => handleFieldChange('currentFunctionalAbility', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										>
											<option value="">Select</option>
											<option value="Improved">Improved</option>
											<option value="Restricted">Restricted</option>
										</select>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Compliance with HEP</label>
										<select
											value={formData.complianceWithHEP || ''}
											onChange={e => handleFieldChange('complianceWithHEP', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										>
											<option value="">Select</option>
											<option value="Excellent">Excellent</option>
											<option value="Moderate">Moderate</option>
											<option value="Poor">Poor</option>
										</select>
									</div>
									<div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
										<div>
											<label className="block text-xs font-medium text-slate-500">Next Follow-Up Date</label>
											<input
												type="date"
												value={formData.nextFollowUpDate || ''}
												onChange={e => handleFieldChange('nextFollowUpDate', e.target.value)}
												className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											/>
										</div>
										<div>
											<label className="block text-xs font-medium text-slate-500">Next Follow-Up Time</label>
											<input
												type="time"
												value={formData.nextFollowUpTime || ''}
												onChange={e => handleFieldChange('nextFollowUpTime', e.target.value)}
												className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
											/>
										</div>
									</div>
								</div>
							</div>

							{/* Signature Section */}
							<div className="mb-8">
								<h3 className="mb-4 text-sm font-semibold text-sky-600">Physiotherapist Signature</h3>
								<div className="grid gap-4 sm:grid-cols-2">
									<div>
										<label className="block text-xs font-medium text-slate-500">Physio Name</label>
										<input
											type="text"
											value={formData.physioName || ''}
											onChange={e => handleFieldChange('physioName', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
									</div>
									<div>
										<label className="block text-xs font-medium text-slate-500">Physio ID / Registration Number</label>
										<input
											type="text"
											value={formData.physioId || ''}
											onChange={e => handleFieldChange('physioId', e.target.value)}
											className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
										/>
									</div>
								</div>
							</div>

							{/* Save Section */}
							<div className="flex items-center justify-between border-t border-slate-200 pt-6 mt-8">
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

									{/* Injury Risk Screening */}
									<div className="mb-8">
										<h2 className="mb-4 text-lg font-semibold text-slate-900 border-b-2 border-slate-300 pb-2">
											Injury Risk Screening
										</h2>
										
										<div className="space-y-4">
											{/* Scapular dyskinesia test */}
											<div>
												<label className="block text-sm font-medium text-slate-700 mb-1">
													Scapular Dyskinesia Test
												</label>
												<input
													type="text"
													value={strengthConditioningFormData.scapularDyskinesiaTest || ''}
													onChange={e => handleFieldChangeStrengthConditioning('scapularDyskinesiaTest', e.target.value)}
													className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
													placeholder="Enter result"
												/>
											</div>

											{/* Table 1: Upper limb flexibility, Shoulder rotations */}
											<div className="overflow-x-auto">
												<table className="min-w-full divide-y divide-slate-200 border border-slate-300 text-left text-sm">
													<thead className="bg-slate-100">
														<tr>
															<th className="px-3 py-2 font-semibold text-slate-700 border border-slate-300">Fields</th>
															<th className="px-3 py-2 font-semibold text-slate-700 border border-slate-300">Right</th>
															<th className="px-3 py-2 font-semibold text-slate-700 border border-slate-300">Left</th>
														</tr>
													</thead>
													<tbody className="divide-y divide-slate-200 bg-white">
														<tr>
															<td className="px-3 py-2 border border-slate-300 font-medium">Upper Limb Flexibility</td>
															<td className="px-3 py-2 border border-slate-300">
																<input
																	type="text"
																	value={strengthConditioningFormData.upperLimbFlexibilityRight || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('upperLimbFlexibilityRight', e.target.value)}
																	className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
																	placeholder="Enter result"
																/>
															</td>
															<td className="px-3 py-2 border border-slate-300">
																<input
																	type="text"
																	value={strengthConditioningFormData.upperLimbFlexibilityLeft || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('upperLimbFlexibilityLeft', e.target.value)}
																	className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
																	placeholder="Enter result"
																/>
															</td>
														</tr>
														<tr>
															<td className="px-3 py-2 border border-slate-300 font-medium">Shoulder Internal Rotation</td>
															<td className="px-3 py-2 border border-slate-300">
																<input
																	type="text"
																	value={strengthConditioningFormData.shoulderInternalRotationRight || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('shoulderInternalRotationRight', e.target.value)}
																	className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
																	placeholder="Enter result"
																/>
															</td>
															<td className="px-3 py-2 border border-slate-300">
																<input
																	type="text"
																	value={strengthConditioningFormData.shoulderInternalRotationLeft || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('shoulderInternalRotationLeft', e.target.value)}
																	className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
																	placeholder="Enter result"
																/>
															</td>
														</tr>
														<tr>
															<td className="px-3 py-2 border border-slate-300 font-medium">Shoulder External Rotation</td>
															<td className="px-3 py-2 border border-slate-300">
																<input
																	type="text"
																	value={strengthConditioningFormData.shoulderExternalRotationRight || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('shoulderExternalRotationRight', e.target.value)}
																	className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
																	placeholder="Enter result"
																/>
															</td>
															<td className="px-3 py-2 border border-slate-300">
																<input
																	type="text"
																	value={strengthConditioningFormData.shoulderExternalRotationLeft || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('shoulderExternalRotationLeft', e.target.value)}
																	className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
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
													<label className="block text-sm font-medium text-slate-700 mb-1">
														Thoracic Rotation
													</label>
													<input
														type="text"
														value={strengthConditioningFormData.thoracicRotation || ''}
														onChange={e => handleFieldChangeStrengthConditioning('thoracicRotation', e.target.value)}
														className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
														placeholder="Enter result"
													/>
												</div>
												<div>
													<label className="block text-sm font-medium text-slate-700 mb-1">
														Sit And Reach Test
													</label>
													<input
														type="text"
														value={strengthConditioningFormData.sitAndReachTest || ''}
														onChange={e => handleFieldChangeStrengthConditioning('sitAndReachTest', e.target.value)}
														className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
														placeholder="Enter result"
													/>
												</div>
											</div>

											{/* Table 2: Lower body tests */}
											<div className="overflow-x-auto">
												<table className="min-w-full divide-y divide-slate-200 border border-slate-300 text-left text-sm">
													<thead className="bg-slate-100">
														<tr>
															<th className="px-3 py-2 font-semibold text-slate-700 border border-slate-300">Fields</th>
															<th className="px-3 py-2 font-semibold text-slate-700 border border-slate-300">Right</th>
															<th className="px-3 py-2 font-semibold text-slate-700 border border-slate-300">Left</th>
														</tr>
													</thead>
													<tbody className="divide-y divide-slate-200 bg-white">
														<tr>
															<td className="px-3 py-2 border border-slate-300 font-medium">Single Leg Squat</td>
															<td className="px-3 py-2 border border-slate-300">
																<input
																	type="text"
																	value={strengthConditioningFormData.singleLegSquatRight || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('singleLegSquatRight', e.target.value)}
																	className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
																	placeholder="Enter result"
																/>
															</td>
															<td className="px-3 py-2 border border-slate-300">
																<input
																	type="text"
																	value={strengthConditioningFormData.singleLegSquatLeft || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('singleLegSquatLeft', e.target.value)}
																	className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
																	placeholder="Enter result"
																/>
															</td>
														</tr>
														<tr>
															<td className="px-3 py-2 border border-slate-300 font-medium">Weight Bearing Lunge Test</td>
															<td className="px-3 py-2 border border-slate-300">
																<input
																	type="text"
																	value={strengthConditioningFormData.weightBearingLungeTestRight || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('weightBearingLungeTestRight', e.target.value)}
																	className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
																	placeholder="Enter result"
																/>
															</td>
															<td className="px-3 py-2 border border-slate-300">
																<input
																	type="text"
																	value={strengthConditioningFormData.weightBearingLungeTestLeft || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('weightBearingLungeTestLeft', e.target.value)}
																	className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
																	placeholder="Enter result"
																/>
															</td>
														</tr>
														<tr>
															<td className="px-3 py-2 border border-slate-300 font-medium">Hamstrings Flexibility</td>
															<td className="px-3 py-2 border border-slate-300">
																<input
																	type="text"
																	value={strengthConditioningFormData.hamstringsFlexibilityRight || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('hamstringsFlexibilityRight', e.target.value)}
																	className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
																	placeholder="Enter result"
																/>
															</td>
															<td className="px-3 py-2 border border-slate-300">
																<input
																	type="text"
																	value={strengthConditioningFormData.hamstringsFlexibilityLeft || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('hamstringsFlexibilityLeft', e.target.value)}
																	className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
																	placeholder="Enter result"
																/>
															</td>
														</tr>
														<tr>
															<td className="px-3 py-2 border border-slate-300 font-medium">Quadriceps Flexibility</td>
															<td className="px-3 py-2 border border-slate-300">
																<input
																	type="text"
																	value={strengthConditioningFormData.quadricepsFlexibilityRight || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('quadricepsFlexibilityRight', e.target.value)}
																	className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
																	placeholder="Enter result"
																/>
															</td>
															<td className="px-3 py-2 border border-slate-300">
																<input
																	type="text"
																	value={strengthConditioningFormData.quadricepsFlexibilityLeft || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('quadricepsFlexibilityLeft', e.target.value)}
																	className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
																	placeholder="Enter result"
																/>
															</td>
														</tr>
														<tr>
															<td className="px-3 py-2 border border-slate-300 font-medium">Hip External Rotation</td>
															<td className="px-3 py-2 border border-slate-300">
																<input
																	type="text"
																	value={strengthConditioningFormData.hipExternalRotationRight || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('hipExternalRotationRight', e.target.value)}
																	className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
																	placeholder="Enter result"
																/>
															</td>
															<td className="px-3 py-2 border border-slate-300">
																<input
																	type="text"
																	value={strengthConditioningFormData.hipExternalRotationLeft || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('hipExternalRotationLeft', e.target.value)}
																	className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
																	placeholder="Enter result"
																/>
															</td>
														</tr>
														<tr>
															<td className="px-3 py-2 border border-slate-300 font-medium">Hip Internal Rotation</td>
															<td className="px-3 py-2 border border-slate-300">
																<input
																	type="text"
																	value={strengthConditioningFormData.hipInternalRotationRight || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('hipInternalRotationRight', e.target.value)}
																	className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
																	placeholder="Enter result"
																/>
															</td>
															<td className="px-3 py-2 border border-slate-300">
																<input
																	type="text"
																	value={strengthConditioningFormData.hipInternalRotationLeft || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('hipInternalRotationLeft', e.target.value)}
																	className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
																	placeholder="Enter result"
																/>
															</td>
														</tr>
														<tr>
															<td className="px-3 py-2 border border-slate-300 font-medium">Hip Extension</td>
															<td className="px-3 py-2 border border-slate-300">
																<input
																	type="text"
																	value={strengthConditioningFormData.hipExtensionRight || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('hipExtensionRight', e.target.value)}
																	className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
																	placeholder="Enter result"
																/>
															</td>
															<td className="px-3 py-2 border border-slate-300">
																<input
																	type="text"
																	value={strengthConditioningFormData.hipExtensionLeft || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('hipExtensionLeft', e.target.value)}
																	className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
																	placeholder="Enter result"
																/>
															</td>
														</tr>
														<tr>
															<td className="px-3 py-2 border border-slate-300 font-medium">Active SLR</td>
															<td className="px-3 py-2 border border-slate-300">
																<input
																	type="text"
																	value={strengthConditioningFormData.activeSLRRight || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('activeSLRRight', e.target.value)}
																	className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
																	placeholder="Enter result"
																/>
															</td>
															<td className="px-3 py-2 border border-slate-300">
																<input
																	type="text"
																	value={strengthConditioningFormData.activeSLRLeft || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('activeSLRLeft', e.target.value)}
																	className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
																	placeholder="Enter result"
																/>
															</td>
														</tr>
													</tbody>
												</table>
											</div>

											{/* Prone plank */}
											<div>
												<label className="block text-sm font-medium text-slate-700 mb-1">
													Prone Plank
												</label>
												<input
													type="text"
													value={strengthConditioningFormData.pronePlank || ''}
													onChange={e => handleFieldChangeStrengthConditioning('pronePlank', e.target.value)}
													className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
													placeholder="Enter result"
												/>
											</div>

											{/* Table 3: Side Plank and Stork standing balance */}
											<div className="overflow-x-auto">
												<table className="min-w-full divide-y divide-slate-200 border border-slate-300 text-left text-sm">
													<thead className="bg-slate-100">
														<tr>
															<th className="px-3 py-2 font-semibold text-slate-700 border border-slate-300">Fields</th>
															<th className="px-3 py-2 font-semibold text-slate-700 border border-slate-300">Right</th>
															<th className="px-3 py-2 font-semibold text-slate-700 border border-slate-300">Left</th>
														</tr>
													</thead>
													<tbody className="divide-y divide-slate-200 bg-white">
														<tr>
															<td className="px-3 py-2 border border-slate-300 font-medium">Side Plank</td>
															<td className="px-3 py-2 border border-slate-300">
																<input
																	type="text"
																	value={strengthConditioningFormData.sidePlankRight || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('sidePlankRight', e.target.value)}
																	className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
																	placeholder="Enter result"
																/>
															</td>
															<td className="px-3 py-2 border border-slate-300">
																<input
																	type="text"
																	value={strengthConditioningFormData.sidePlankLeft || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('sidePlankLeft', e.target.value)}
																	className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
																	placeholder="Enter result"
																/>
															</td>
														</tr>
														<tr>
															<td className="px-3 py-2 border border-slate-300 font-medium">Stork Standing Balance Test</td>
															<td className="px-3 py-2 border border-slate-300">
																<input
																	type="text"
																	value={strengthConditioningFormData.storkStandingBalanceTestRight || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('storkStandingBalanceTestRight', e.target.value)}
																	className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
																	placeholder="Enter result"
																/>
															</td>
															<td className="px-3 py-2 border border-slate-300">
																<input
																	type="text"
																	value={strengthConditioningFormData.storkStandingBalanceTestLeft || ''}
																	onChange={e => handleFieldChangeStrengthConditioning('storkStandingBalanceTestLeft', e.target.value)}
																	className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
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
													<label className="block text-sm font-medium text-slate-700 mb-1">
														Deep Squat
													</label>
													<input
														type="text"
														value={strengthConditioningFormData.deepSquat || ''}
														onChange={e => handleFieldChangeStrengthConditioning('deepSquat', e.target.value)}
														className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
														placeholder="Enter result"
													/>
												</div>
												<div>
													<label className="block text-sm font-medium text-slate-700 mb-1">
														Pushup
													</label>
													<input
														type="text"
														value={strengthConditioningFormData.pushup || ''}
														onChange={e => handleFieldChangeStrengthConditioning('pushup', e.target.value)}
														className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
														placeholder="Enter result"
													/>
												</div>
												<div>
													<label className="block text-sm font-medium text-slate-700 mb-1">
														FMS Score
													</label>
													<input
														type="text"
														value={strengthConditioningFormData.fmsScore || ''}
														onChange={e => handleFieldChangeStrengthConditioning('fmsScore', e.target.value)}
														className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
														placeholder="Enter FMS score"
													/>
												</div>
												<div>
													<label className="block text-sm font-medium text-slate-700 mb-1">
														Total FMS Score
													</label>
													<input
														type="text"
														value={strengthConditioningFormData.totalFmsScore || ''}
														onChange={e => handleFieldChangeStrengthConditioning('totalFmsScore', e.target.value)}
														className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
														placeholder="Enter total FMS score"
													/>
												</div>
												<div>
													<label className="block text-sm font-medium text-slate-700 mb-1">
														Summary
													</label>
													<textarea
														value={strengthConditioningFormData.summary || ''}
														onChange={e => handleFieldChangeStrengthConditioning('summary', e.target.value)}
														className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
														rows={4}
														placeholder="Enter summary"
													/>
												</div>
											</div>
										</div>
									</div>
								</>
							)}
						</div>
					) : null}
				</div>
				
				{/* Footer */}
				<footer className="flex items-center justify-between border-t border-slate-200 px-6 py-4">
					{(activeReportTab === 'report' || activeReportTab === 'strength-conditioning') && reportPatientData && (
						<button
							type="button"
							onClick={activeReportTab === 'report' ? handleViewVersionHistory : () => {}}
							className="inline-flex items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
							disabled={activeReportTab === 'strength-conditioning'}
							title={activeReportTab === 'strength-conditioning' ? 'Version history not available for Strength and Conditioning reports' : 'View report versions'}
						>
							<i className="fas fa-history mr-2" aria-hidden="true" />
							View Versions
						</button>
					)}
					<div className="flex items-center gap-3">
						{editable && (reportPatientData || strengthConditioningData) && (
							<button
								type="button"
								onClick={handleSave}
								disabled={saving}
								className="inline-flex items-center rounded-lg border border-sky-600 bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
							>
								{saving ? (
									<>
										<div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
										Saving...
									</>
								) : (
									<>
										<i className="fas fa-save mr-2" aria-hidden="true" />
										Save Changes
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
									<p className="text-slate-600">No report history available for this patient.</p>
									<p className="text-sm text-slate-500 mt-2">Previous reports will appear here when you save changes to the report.</p>
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
																onClick={() => setViewingVersionData(versionData)}
																className="inline-flex items-center rounded-lg border border-sky-600 px-3 py-1.5 text-xs font-semibold text-sky-600 transition hover:bg-sky-50 focus-visible:outline-none"
															>
																<i className="fas fa-eye mr-1.5" aria-hidden="true" />
																View Full Report
															</button>
															<button
																type="button"
																onClick={() => handleRestoreVersion(version)}
																disabled={saving}
																className="inline-flex items-center rounded-lg border border-emerald-600 px-3 py-1.5 text-xs font-semibold text-emerald-600 transition hover:bg-emerald-50 focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
															>
																<i className="fas fa-undo mr-1.5" aria-hidden="true" />
																Restore
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
			{viewingVersionData && reportPatientData && (
				<div className="fixed inset-0 z-60 flex items-center justify-center bg-black bg-opacity-50 px-4 py-6">
					<div className="bg-white rounded-lg shadow-xl max-w-6xl w-full mx-4 max-h-[95vh] overflow-hidden flex flex-col">
						<div className="flex items-center justify-between p-6 border-b border-slate-200">
							<h2 className="text-xl font-semibold text-slate-900">
								Report - {reportPatientData.name} ({reportPatientData.patientId})
							</h2>
							<button
								type="button"
								onClick={() => setViewingVersionData(null)}
								className="text-slate-400 hover:text-slate-600 transition"
								aria-label="Close"
							>
								<i className="fas fa-times text-xl" />
							</button>
						</div>
						<div className="flex-1 overflow-y-auto p-6">
							<div className="section-card">
								{/* Patient Information */}
								<div className="mb-8 border-b border-slate-200 pb-6">
									<h2 className="mb-4 text-xl font-bold text-sky-600">Physiotherapy Report</h2>
									<div className="mb-4 text-right text-sm text-slate-600">
										<div>
											<b>Clinic:</b> Centre For Sports Science, Kanteerava Stadium
										</div>
										<div>
											<b>Report Date:</b> {viewingVersionData.dateOfConsultation || new Date().toLocaleDateString()}
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
									{viewingVersionData.dateOfConsultation && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">Date of Consultation</label>
											<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
												{viewingVersionData.dateOfConsultation}
											</div>
										</div>
									)}

									{viewingVersionData.complaints && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">Complaints</label>
											<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
												{viewingVersionData.complaints}
											</div>
										</div>
									)}

									{viewingVersionData.chiefComplaint && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">Chief Complaint</label>
											<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
												{viewingVersionData.chiefComplaint}
											</div>
										</div>
									)}

									{viewingVersionData.presentHistory && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">Present History</label>
											<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
												{viewingVersionData.presentHistory}
											</div>
										</div>
									)}

									{viewingVersionData.pastHistory && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">Past History</label>
											<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
												{viewingVersionData.pastHistory}
											</div>
										</div>
									)}

									{((viewingVersionData.med_xray || viewingVersionData.med_mri || viewingVersionData.med_report || viewingVersionData.med_ct) || viewingVersionData.surgicalHistory) && (
										<div className="grid gap-4 sm:grid-cols-2">
											{(viewingVersionData.med_xray || viewingVersionData.med_mri || viewingVersionData.med_report || viewingVersionData.med_ct) && (
												<div>
													<label className="block text-xs font-medium text-slate-500 mb-1">Medical History</label>
													<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
														{[
															viewingVersionData.med_xray && 'X-RAYS',
															viewingVersionData.med_mri && 'MRI',
															viewingVersionData.med_report && 'Reports',
															viewingVersionData.med_ct && 'CT Scans'
														].filter(Boolean).join(', ') || '—'}
													</div>
												</div>
											)}
											{viewingVersionData.surgicalHistory && (
												<div>
													<label className="block text-xs font-medium text-slate-500 mb-1">Surgical History</label>
													<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
														{viewingVersionData.surgicalHistory}
													</div>
												</div>
											)}
										</div>
									)}

									{((viewingVersionData.per_smoking || viewingVersionData.per_drinking || viewingVersionData.per_alcohol || viewingVersionData.per_drugs) || viewingVersionData.sleepCycle || viewingVersionData.hydration || viewingVersionData.nutrition) && (
										<div className="grid gap-4 sm:grid-cols-2">
											{(viewingVersionData.per_smoking || viewingVersionData.per_drinking || viewingVersionData.per_alcohol || viewingVersionData.per_drugs) && (
												<div>
													<label className="block text-xs font-medium text-slate-500 mb-1">Personal History</label>
													<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
														{[
															viewingVersionData.per_smoking && 'Smoking',
															viewingVersionData.per_drinking && 'Drinking',
															viewingVersionData.per_alcohol && 'Alcohol',
															viewingVersionData.per_drugs && `Drugs${viewingVersionData.drugsText ? ` (${viewingVersionData.drugsText})` : ''}`
														].filter(Boolean).join(', ') || '—'}
													</div>
												</div>
											)}
											{viewingVersionData.sleepCycle && (
												<div>
													<label className="block text-xs font-medium text-slate-500 mb-1">Sleep Cycle</label>
													<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
														{viewingVersionData.sleepCycle}
													</div>
												</div>
											)}
											{viewingVersionData.hydration && (
												<div>
													<label className="block text-xs font-medium text-slate-500 mb-1">Hydration</label>
													<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
														{viewingVersionData.hydration}/8 {HYDRATION_EMOJIS[Math.min(HYDRATION_EMOJIS.length - 1, Math.max(1, Number(viewingVersionData.hydration)) - 1)]}
													</div>
												</div>
											)}
											{viewingVersionData.nutrition && (
												<div>
													<label className="block text-xs font-medium text-slate-500 mb-1">Nutrition</label>
													<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
														{viewingVersionData.nutrition}
													</div>
												</div>
											)}
										</div>
									)}

									{(viewingVersionData.siteSide || viewingVersionData.onset || viewingVersionData.duration || viewingVersionData.natureOfInjury || viewingVersionData.typeOfPain || viewingVersionData.aggravatingFactor || viewingVersionData.relievingFactor) && (
										<div>
											<h3 className="text-sm font-semibold text-sky-600 mb-3 border-b border-sky-200 pb-2">Pain Assessment</h3>
											<div className="grid gap-4 sm:grid-cols-2">
												{viewingVersionData.siteSide && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Site and Side</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{viewingVersionData.siteSide}
														</div>
													</div>
												)}
												{viewingVersionData.onset && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Onset</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{viewingVersionData.onset}
														</div>
													</div>
												)}
												{viewingVersionData.duration && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Duration</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{viewingVersionData.duration}
														</div>
													</div>
												)}
												{viewingVersionData.natureOfInjury && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Nature of Injury</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{viewingVersionData.natureOfInjury}
														</div>
													</div>
												)}
												{viewingVersionData.typeOfPain && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Type of Pain</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
															{viewingVersionData.typeOfPain}
														</div>
													</div>
												)}
												{viewingVersionData.aggravatingFactor && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Aggravating Factor</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
															{viewingVersionData.aggravatingFactor}
														</div>
													</div>
												)}
												{viewingVersionData.relievingFactor && (
													<div>
														<label className="block text-xs font-medium text-slate-500 mb-1">Relieving Factor</label>
														<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
															{viewingVersionData.relievingFactor}
														</div>
													</div>
												)}
											</div>
										</div>
									)}

									{viewingVersionData.clinicalDiagnosis && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">Clinical Diagnosis</label>
											<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
												{viewingVersionData.clinicalDiagnosis}
											</div>
										</div>
									)}

									{viewingVersionData.vasScale && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">VAS Scale</label>
											<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
												{viewingVersionData.vasScale} {VAS_EMOJIS[Math.min(VAS_EMOJIS.length - 1, Math.max(1, Number(viewingVersionData.vasScale)) - 1)]}
											</div>
										</div>
									)}

									{viewingVersionData.rom && Object.keys(viewingVersionData.rom).length > 0 && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-2">ROM (Range of Motion)</label>
											<div className="bg-slate-50 border border-slate-200 rounded-md p-4">
												{Object.entries(viewingVersionData.rom).map(([joint, data]: [string, any]) => (
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

									{viewingVersionData.mmt && Object.keys(viewingVersionData.mmt).length > 0 && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-2">MMT (Manual Muscle Testing)</label>
											<div className="bg-slate-50 border border-slate-200 rounded-md p-4">
												{Object.entries(viewingVersionData.mmt).map(([joint, data]: [string, any]) => (
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

									{viewingVersionData.recommendations && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">Recommendations</label>
											<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
												{viewingVersionData.recommendations}
											</div>
										</div>
									)}

									{viewingVersionData.physiotherapistRemarks && (
										<div>
											<label className="block text-xs font-medium text-slate-500 mb-1">Physiotherapist Remarks</label>
											<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 whitespace-pre-wrap">
												{viewingVersionData.physiotherapistRemarks}
											</div>
										</div>
									)}

									{viewingVersionData.nextFollowUpDate && (
										<div className="grid gap-4 sm:grid-cols-2">
											<div>
												<label className="block text-xs font-medium text-slate-500 mb-1">Next Follow-up Date</label>
												<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
													{viewingVersionData.nextFollowUpDate}
												</div>
											</div>
											{viewingVersionData.nextFollowUpTime && (
												<div>
													<label className="block text-xs font-medium text-slate-500 mb-1">Next Follow-up Time</label>
													<div className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
														{viewingVersionData.nextFollowUpTime}
													</div>
												</div>
											)}
										</div>
									)}
								</div>
							</div>
						</div>
						<div className="flex items-center justify-end p-6 border-t border-slate-200">
							<button
								type="button"
								onClick={() => setViewingVersionData(null)}
								className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 transition"
							>
								Close
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

