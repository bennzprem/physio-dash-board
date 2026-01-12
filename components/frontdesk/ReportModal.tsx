'use client';

import { useEffect, useState, useRef } from 'react';
import { collection, doc, query, where, getDocs, onSnapshot, orderBy, type Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { generatePhysiotherapyReportPDF, generateStrengthConditioningPDF, type StrengthConditioningData, type ReportSection } from '@/lib/pdfGenerator';
import type { PatientRecordFull } from '@/lib/types';

// ROM constants for report display
const ROM_MOTIONS: Record<string, Array<{ motion: string }>> = {
	Neck: [{ motion: 'Flexion' }, { motion: 'Extension' }, { motion: 'Lateral Flexion' }, { motion: 'Rotation' }],
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
	Toes: [{ motion: 'Flexion' }, { motion: 'Extension' }],
};

const ROM_HAS_SIDE: Record<string, boolean> = {
	Shoulder: true,
	Elbow: true,
	Forearm: true,
	Wrist: true,
	Knee: true,
	Ankle: true,
	Toes: true,
};

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

interface ReportModalProps {
	isOpen: boolean;
	patientId: string | null;
	initialTab?: 'report' | 'strength-conditioning';
	onClose: () => void;
}

export default function ReportModal({ isOpen, patientId, initialTab = 'report', onClose }: ReportModalProps) {
	const [activeReportTab, setActiveReportTab] = useState<'report' | 'strength-conditioning'>(initialTab);
	const [reportPatientData, setReportPatientData] = useState<any>(null);
	const [strengthConditioningData, setStrengthConditioningData] = useState<any>(null);
	const [loadingReport, setLoadingReport] = useState(false);
	const [loadingStrengthConditioning, setLoadingStrengthConditioning] = useState(false);
	const strengthConditioningUnsubscribeRef = useRef<(() => void) | null>(null);
	const patientUnsubscribeRef = useRef<(() => void) | null>(null);
	const reportVersionsUnsubscribeRef = useRef<(() => void) | null>(null);
	
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
			setReportPatientData(null);
			setStrengthConditioningData(null);

			// Load regular report data with real-time listener
			try {
				const patientSnap = await getDocs(query(collection(db, 'patients'), where('patientId', '==', patientId)));
				if (!patientSnap.empty) {
					const patientDoc = patientSnap.docs[0];
					const patientDocId = patientDoc.id;
					
					// Set up real-time listener for patient document
					const patientRef = doc(db, 'patients', patientDocId);
					const unsubscribePatient = onSnapshot(patientRef, (docSnap) => {
						if (docSnap.exists()) {
							const patientData = docSnap.data();
							setReportPatientData(patientData);
						} else {
							setReportPatientData(null);
						}
						setLoadingReport(false);
					}, (error) => {
						console.error('Error loading patient report:', error);
						setLoadingReport(false);
					});
					
					patientUnsubscribeRef.current = unsubscribePatient;
					
					// Set up real-time listener for report versions
					const initialPatientData = patientDoc.data();
					if (initialPatientData.patientId) {
						const versionsQuery = query(
							collection(db, 'reportVersions'),
							where('patientId', '==', initialPatientData.patientId),
							orderBy('version', 'desc')
						);
						
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
									};
								});
								
								// Only update if version history is currently being viewed
								if (showVersionHistory) {
									setVersionHistory(versions);
								}
							},
							(error) => {
								// If orderBy fails (missing index), try without it
								if (error.code === 'failed-precondition' || error.message?.includes('index')) {
									const versionsQueryNoOrder = query(
										collection(db, 'reportVersions'),
										where('patientId', '==', initialPatientData.patientId)
									);
									
									onSnapshot(
										versionsQueryNoOrder,
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
												};
											});
											versions.sort((a, b) => b.version - a.version);
											
											if (showVersionHistory) {
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
				} else {
					setLoadingReport(false);
				}
			} catch (error) {
				console.error('Failed to load patient report:', error);
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
							setStrengthConditioningData(docSnap.data());
						} else {
							setStrengthConditioningData(null);
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

	// Handle PDF download for report
	// Helper function to build report data
	const buildReportData = () => {
		if (!reportPatientData) return null;
		
		const age = reportPatientData.dob ? new Date().getFullYear() - new Date(reportPatientData.dob).getFullYear() : undefined;
		return {
			patientName: reportPatientData.name,
			patientId: reportPatientData.patientId,
			referredBy: reportPatientData.assignedDoctor || reportPatientData.referredBy || '',
			age: age ? String(age) : '',
			gender: reportPatientData.gender || '',
			dateOfConsultation: reportPatientData.dateOfConsultation || new Date().toISOString().split('T')[0],
			contact: reportPatientData.phone || '',
			email: reportPatientData.email || '',
			totalSessionsRequired: reportPatientData.totalSessionsRequired,
			remainingSessions: reportPatientData.remainingSessions,
			history: reportPatientData.history || (reportPatientData.presentHistory || '') + (reportPatientData.pastHistory ? '\n' + reportPatientData.pastHistory : ''),
			surgicalHistory: reportPatientData.surgicalHistory || '',
			medicalHistory: getMedicalHistoryText(reportPatientData),
			sleepCycle: reportPatientData.sleepCycle || '',
			hydration: reportPatientData.hydration || '4',
			nutrition: reportPatientData.nutrition || '',
			chiefComplaint: reportPatientData.chiefComplaint || reportPatientData.complaints || '',
			duration: reportPatientData.duration || '',
			mechanismOfInjury: reportPatientData.mechanismOfInjury || '',
			painIntensity: reportPatientData.painIntensity || reportPatientData.vasScale || '',
			painType: reportPatientData.painType || '',
			aggravatingFactor: reportPatientData.aggravatingFactor || '',
			relievingFactor: reportPatientData.relievingFactor || '',
			siteSide: reportPatientData.siteSide || '',
			onset: reportPatientData.onset || '',
			natureOfInjury: reportPatientData.natureOfInjury || '',
			vasScale: reportPatientData.vasScale || '5',
			rom: reportPatientData.rom || {},
			mmt: reportPatientData.mmt || {},
			built: reportPatientData.built || '',
			posture: reportPatientData.posture || '',
			postureManualNotes: reportPatientData.postureManualNotes || '',
			postureFileName: reportPatientData.postureFileName || '',
			gaitAnalysis: reportPatientData.gaitAnalysis || '',
			gaitManualNotes: reportPatientData.gaitManualNotes || '',
			gaitFileName: reportPatientData.gaitFileName || '',
			mobilityAids: reportPatientData.mobilityAids || '',
			localObservation: reportPatientData.localObservation || '',
			swelling: reportPatientData.swelling || '',
			muscleWasting: reportPatientData.muscleWasting || '',
			tenderness: reportPatientData.tenderness || '',
			warmth: reportPatientData.warmth || '',
			scar: reportPatientData.scar || '',
			crepitus: reportPatientData.crepitus || '',
			odema: reportPatientData.odema || '',
			specialTest: reportPatientData.specialTest || '',
			finalDiagnosis: reportPatientData.finalDiagnosis || '',
			shortTermGoals: reportPatientData.shortTermGoals || '',
			longTermGoals: reportPatientData.longTermGoals || '',
			treatment: reportPatientData.treatment || reportPatientData.treatmentProvided || reportPatientData.rehabProtocol || '',
			advice: reportPatientData.advice || '',
			managementRemarks: reportPatientData.managementRemarks || '',
			nextFollowUpDate: reportPatientData.nextFollowUpDate || '',
			nextFollowUpTime: reportPatientData.nextFollowUpTime || '',
			followUpVisits: reportPatientData.followUpVisits || [],
			currentPainStatus: reportPatientData.currentPainStatus || '',
			currentRom: reportPatientData.currentRom || '',
			currentStrength: reportPatientData.currentStrength || '',
			currentFunctionalAbility: reportPatientData.currentFunctionalAbility || '',
			complianceWithHEP: reportPatientData.complianceWithHEP || '',
			physioName: reportPatientData.physioName || '',
			patientType: reportPatientData.patientType || '',
		};
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

	// Handle PDF download for strength and conditioning
	const handleDownloadStrengthConditioningPDF = async () => {
		try {
			if (!reportPatientData || !strengthConditioningData) {
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
				formData: strengthConditioningData as StrengthConditioningData,
			});
		} catch (error) {
			console.error('Error downloading PDF:', error);
			alert('Failed to download PDF. Please try again.');
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
				if (!reportPatientData || !strengthConditioningData) {
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
					formData: strengthConditioningData as StrengthConditioningData,
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
					<h2 className="text-lg font-semibold text-slate-900">Patient Reports</h2>
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
					{activeReportTab === 'report' ? (
						loadingReport ? (
							<div className="text-center py-12">
								<div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-slate-900 border-r-transparent"></div>
								<p className="mt-4 text-sm text-slate-600">Loading report data...</p>
							</div>
						) : reportPatientData ? (
							<div className="section-card">
								{(() => {
									const displayData = viewingVersionData ? { ...reportPatientData, ...viewingVersionData } : reportPatientData;
									return (
										<>
											<div className="mb-6 flex items-start justify-between border-b border-slate-200 pb-4">
												<div className="flex-1">
													<div className="flex items-center gap-3">
														{viewingVersionData && (
															<button
																type="button"
																onClick={() => {
																	setViewingVersionData(null);
																	setShowVersionHistory(true);
																}}
																className="inline-flex items-center rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none"
															>
																<i className="fas fa-arrow-left mr-1.5" aria-hidden="true" />
																Back to Versions
															</button>
														)}
														<h3 className="text-xl font-bold text-sky-600">Physiotherapy Report</h3>
													</div>
													{viewingVersionData && (
														<p className="text-sm text-slate-500 mt-1">
															Viewing historical version - This is a read-only view
														</p>
													)}
												</div>
												<div className="text-right text-sm text-slate-600">
													<div>
														<b>Clinic:</b> Centre For Sports Science, Kanteerava Stadium
													</div>
													<div>
														<b>Date:</b> {new Date().toLocaleDateString()}
													</div>
												</div>
											</div>

											<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
												<div>
													<label className="block text-xs font-medium text-slate-500">Patient Name</label>
													<input
														type="text"
														value={displayData.name || ''}
														readOnly
														className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
													/>
												</div>
												<div>
													<label className="block text-xs font-medium text-slate-500">Patient ID</label>
													<input
														type="text"
														value={displayData.patientId || ''}
														readOnly
														className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
													/>
												</div>
												<div>
													<label className="block text-xs font-medium text-slate-500">Date of Birth</label>
													<input
														type="date"
														value={displayData.dob || ''}
														readOnly
														className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
													/>
												</div>
												<div>
													<label className="block text-xs font-medium text-slate-500">Assigned Doctor</label>
													<input
														type="text"
														value={displayData.assignedDoctor || ''}
														readOnly
														className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
													/>
												</div>
												<div>
													<label className="block text-xs font-medium text-slate-500">Total Sessions Required</label>
													<input
														type="text"
														value={
															typeof displayData.totalSessionsRequired === 'number'
																? String(displayData.totalSessionsRequired)
																: ''
														}
														readOnly
														className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
													/>
												</div>
												<div>
													<label className="block text-xs font-medium text-slate-500">Remaining Sessions</label>
													<input
														type="text"
														value={
															typeof displayData.remainingSessions === 'number'
																? String(displayData.remainingSessions)
																: ''
														}
														readOnly
														className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
													/>
												</div>
											</div>

											<div className="mt-6">
												<p className="text-sm font-semibold text-sky-600">Assessment</p>
												<div className="mt-4 grid gap-4 sm:grid-cols-2">
													<div>
														<label className="block text-xs font-medium text-slate-500">History</label>
														<textarea
															value={displayData.history || (displayData.presentHistory || '') + (displayData.pastHistory ? '\n' + displayData.pastHistory : '')}
															readOnly
															rows={3}
															className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
														/>
													</div>
													<div>
														<label className="block text-xs font-medium text-slate-500">Medical History</label>
														<input
															type="text"
															value={getMedicalHistoryText(displayData)}
															readOnly
															className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
														/>
													</div>
													<div>
														<label className="block text-xs font-medium text-slate-500">Surgical History</label>
														<input
															type="text"
															value={displayData.surgicalHistory || ''}
															readOnly
															className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
														/>
													</div>
													<div>
														<label className="block text-xs font-medium text-slate-500">Personal History</label>
														<input
															type="text"
															value={getPersonalHistoryText(displayData)}
															readOnly
															className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
														/>
													</div>
													<div>
														<label className="block text-xs font-medium text-slate-500">Sleep Cycle</label>
														<input
															type="text"
															value={displayData.sleepCycle || ''}
															readOnly
															className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
														/>
													</div>
													<div>
														<label className="block text-xs font-medium text-slate-500">Hydration</label>
														<input
															type="text"
															value={displayData.hydration || ''}
															readOnly
															className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
														/>
													</div>
													<div>
														<label className="block text-xs font-medium text-slate-500">Nutrition</label>
														<input
															type="text"
															value={displayData.nutrition || ''}
															readOnly
															className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
														/>
													</div>
												</div>
											</div>

											{/* Pain Assessment */}
											<div className="mt-6">
												<h4 className="mb-4 text-base font-semibold text-sky-600">Pain Assessment</h4>
												<div className="grid gap-4 sm:grid-cols-2">
													<div>
														<label className="block text-xs font-medium text-slate-500">Site and Side</label>
														<input
															type="text"
															value={displayData.siteSide || ''}
															readOnly
															className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
														/>
													</div>
													<div>
														<label className="block text-xs font-medium text-slate-500">Onset</label>
														<input
															type="text"
															value={displayData.onset || ''}
															readOnly
															className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
														/>
													</div>
													<div>
														<label className="block text-xs font-medium text-slate-500">Duration</label>
														<input
															type="text"
															value={displayData.duration || ''}
															readOnly
															className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
														/>
													</div>
													<div>
														<label className="block text-xs font-medium text-slate-500">Nature of Injury</label>
														<input
															type="text"
															value={displayData.natureOfInjury || ''}
															readOnly
															className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
														/>
													</div>
													<div>
														<label className="block text-xs font-medium text-slate-500">Pain Type</label>
														<input
															type="text"
															value={displayData.painType || ''}
															readOnly
															className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
														/>
													</div>
													<div>
														<label className="block text-xs font-medium text-slate-500">Pain Intensity</label>
														<input
															type="text"
															value={displayData.painIntensity || ''}
															readOnly
															className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
														/>
													</div>
													<div>
														<label className="block text-xs font-medium text-slate-500">VAS Scale</label>
														<input
															type="text"
															value={displayData.vasScale || ''}
															readOnly
															className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
														/>
													</div>
													<div>
														<label className="block text-xs font-medium text-slate-500">Aggravating Factor</label>
														<input
															type="text"
															value={displayData.aggravatingFactor || ''}
															readOnly
															className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
														/>
													</div>
													<div>
														<label className="block text-xs font-medium text-slate-500">Relieving Factor</label>
														<input
															type="text"
															value={displayData.relievingFactor || ''}
															readOnly
															className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
														/>
													</div>
												</div>
											</div>

											{/* On Observation */}
											<div className="mt-6">
												<h4 className="mb-4 text-base font-semibold text-sky-600">On Observation</h4>
												<div className="grid gap-4 sm:grid-cols-2">
													<div>
														<label className="block text-xs font-medium text-slate-500">Built</label>
														<input
															type="text"
															value={displayData.built || ''}
															readOnly
															className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
														/>
													</div>
													<div>
														<label className="block text-xs font-medium text-slate-500">Posture</label>
														<div className="mt-1">
															<input
																type="text"
																value={displayData.posture || ''}
																readOnly
																className="mb-2 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
															/>
															{displayData.posture === 'Manual' && displayData.postureManualNotes && (
																<textarea
																	value={displayData.postureManualNotes}
																	readOnly
																	rows={2}
																	className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
																/>
															)}
															{displayData.posture === 'Kinetisense' && displayData.postureFileName && displayData.postureFileData && (
																<div className="flex items-center gap-2">
																	<span className="text-xs text-slate-600">{displayData.postureFileName}</span>
																	<button
																		type="button"
																		onClick={() => {
																			if (displayData.postureFileData) {
																				const viewWindow = window.open();
																				if (viewWindow) {
																					viewWindow.document.write(`
																						<html>
																							<head>
																								<title>${displayData.postureFileName}</title>
																								<style>
																									body { margin: 0; padding: 0; }
																									iframe { width: 100%; height: 100vh; border: none; }
																								</style>
																							</head>
																							<body>
																								<iframe src="${displayData.postureFileData}"></iframe>
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
													</div>
													<div>
														<label className="block text-xs font-medium text-slate-500">GAIT Analysis</label>
														<div className="mt-1">
															<input
																type="text"
																value={displayData.gaitAnalysis || ''}
																readOnly
																className="mb-2 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
															/>
															{displayData.gaitAnalysis === 'Manual' && displayData.gaitManualNotes && (
																<textarea
																	value={displayData.gaitManualNotes}
																	readOnly
																	rows={2}
																	className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
																/>
															)}
															{displayData.gaitAnalysis === 'OptaGAIT' && displayData.gaitFileName && displayData.gaitFileData && (
																<div className="flex items-center gap-2">
																	<span className="text-xs text-slate-600">{displayData.gaitFileName}</span>
																	<button
																		type="button"
																		onClick={() => {
																			if (displayData.gaitFileData) {
																				const viewWindow = window.open();
																				if (viewWindow) {
																					viewWindow.document.write(`
																						<html>
																							<head>
																								<title>${displayData.gaitFileName}</title>
																								<style>
																									body { margin: 0; padding: 0; }
																									iframe { width: 100%; height: 100vh; border: none; }
																								</style>
																							</head>
																							<body>
																								<iframe src="${displayData.gaitFileData}"></iframe>
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
													</div>
													<div>
														<label className="block text-xs font-medium text-slate-500">Mobility Aids</label>
														<input
															type="text"
															value={displayData.mobilityAids || ''}
															readOnly
															className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
														/>
													</div>
													<div>
														<label className="block text-xs font-medium text-slate-500">Local Observation</label>
														<textarea
															value={displayData.localObservation || ''}
															readOnly
															rows={2}
															className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
														/>
													</div>
													<div>
														<label className="block text-xs font-medium text-slate-500">Swelling</label>
														<input
															type="text"
															value={displayData.swelling || ''}
															readOnly
															className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
														/>
													</div>
													<div>
														<label className="block text-xs font-medium text-slate-500">Muscle Wasting</label>
														<input
															type="text"
															value={displayData.muscleWasting || ''}
															readOnly
															className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
														/>
													</div>
												</div>
											</div>

											{/* On Palpation */}
											<div className="mt-6">
												<h4 className="mb-4 text-base font-semibold text-sky-600">On Palpation</h4>
												<div className="grid gap-4 sm:grid-cols-2">
													<div>
														<label className="block text-xs font-medium text-slate-500">Tenderness</label>
														<input
															type="text"
															value={displayData.tenderness || ''}
															readOnly
															className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
														/>
													</div>
													<div>
														<label className="block text-xs font-medium text-slate-500">Warmth</label>
														<input
															type="text"
															value={displayData.warmth || ''}
															readOnly
															className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
														/>
													</div>
													<div>
														<label className="block text-xs font-medium text-slate-500">Scar</label>
														<input
															type="text"
															value={displayData.scar || ''}
															readOnly
															className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
														/>
													</div>
													<div>
														<label className="block text-xs font-medium text-slate-500">Crepitus</label>
														<input
															type="text"
															value={displayData.crepitus || ''}
															readOnly
															className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
														/>
													</div>
													<div>
														<label className="block text-xs font-medium text-slate-500">Odema</label>
														<input
															type="text"
															value={displayData.odema || ''}
															readOnly
															className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
														/>
													</div>
												</div>
											</div>

											<div className="mt-6">
												<p className="text-sm font-semibold text-sky-600">Range of Motion (ROM) Assessed</p>
												<div className="mt-4">{renderRomView(displayData.rom)}</div>
											</div>

											{/* Manual Muscle Testing (MMT) */}
											<div className="mt-6">
												<p className="text-sm font-semibold text-sky-600">Manual Muscle Testing (MMT)</p>
												<div className="mt-4">
													{displayData.mmt && Object.keys(displayData.mmt).length > 0 ? (
														<div className="space-y-4">
															{Object.keys(displayData.mmt).map((muscle) => (
																<div key={muscle} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
																	<h6 className="mb-3 text-sm font-semibold text-sky-600">{muscle}</h6>
																	{typeof displayData.mmt[muscle] === 'object' && displayData.mmt[muscle] !== null ? (
																		<div className="grid gap-2 sm:grid-cols-2">
																			{Object.keys(displayData.mmt[muscle]).map((side) => (
																				<div key={side} className="text-sm">
																					<span className="font-medium text-slate-700">{side}:</span>{' '}
																					<span className="text-slate-900">{displayData.mmt[muscle][side] || '—'}</span>
																				</div>
																			))}
																		</div>
																	) : (
																		<p className="text-sm text-slate-900">{String(displayData.mmt[muscle]) || '—'}</p>
																	)}
																</div>
															))}
														</div>
													) : (
														<p className="text-sm italic text-slate-500">No MMT data recorded.</p>
													)}
												</div>
											</div>

											{/* Advanced Assessment */}
											<div className="mt-6">
												<h4 className="mb-4 text-base font-semibold text-sky-600">Advanced Assessment</h4>
												<div className="grid gap-4 sm:grid-cols-2">
													{displayData.specialTest && (
														<div>
															<label className="block text-xs font-medium text-slate-500">Special Test</label>
															<textarea
																value={displayData.specialTest}
																readOnly
																rows={3}
																className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
															/>
														</div>
													)}
													{displayData.finalDiagnosis && (
														<div className="sm:col-span-2">
															<label className="block text-xs font-medium text-slate-500">Final Diagnosis</label>
															<textarea
																value={displayData.finalDiagnosis}
																readOnly
																rows={3}
																className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
															/>
														</div>
													)}
												</div>
											</div>

											{/* Physiotherapy Management */}
											<div className="mt-6">
												<h4 className="mb-4 text-base font-semibold text-sky-600">Physiotherapy Management</h4>
												<div className="grid gap-4 sm:grid-cols-2">
													{displayData.shortTermGoals && (
														<div>
															<label className="block text-xs font-medium text-slate-500">Short Term Goals</label>
															<textarea
																value={displayData.shortTermGoals}
																readOnly
																rows={3}
																className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
															/>
														</div>
													)}
													{displayData.longTermGoals && (
														<div>
															<label className="block text-xs font-medium text-slate-500">Long Term Goals</label>
															<textarea
																value={displayData.longTermGoals}
																readOnly
																rows={3}
																className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
															/>
														</div>
													)}
													{(displayData.treatment || displayData.treatmentProvided || displayData.rehabProtocol) && (
														<div>
															<label className="block text-xs font-medium text-slate-500">Treatment</label>
															<textarea
																value={displayData.treatment || displayData.treatmentProvided || displayData.rehabProtocol || ''}
																readOnly
																rows={3}
																className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
															/>
														</div>
													)}
													{displayData.advice && (
														<div>
															<label className="block text-xs font-medium text-slate-500">Advice</label>
															<textarea
																value={displayData.advice}
																readOnly
																rows={3}
																className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
															/>
														</div>
													)}
													{displayData.managementRemarks && (
														<div className="sm:col-span-2">
															<label className="block text-xs font-medium text-slate-500">Management Remarks</label>
															<textarea
																value={displayData.managementRemarks}
																readOnly
																rows={3}
																className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
															/>
														</div>
													)}
												</div>
											</div>

											{/* Current Status */}
											{(displayData.currentPainStatus || displayData.currentRom || displayData.currentStrength || displayData.currentFunctionalAbility || displayData.complianceWithHEP) && (
												<div className="mt-6">
													<h4 className="mb-4 text-base font-semibold text-sky-600">Current Status</h4>
													<div className="grid gap-4 sm:grid-cols-2">
														{displayData.currentPainStatus && (
															<div>
																<label className="block text-xs font-medium text-slate-500">Current Pain Status</label>
																<input
																	type="text"
																	value={displayData.currentPainStatus}
																	readOnly
																	className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
																/>
															</div>
														)}
														{displayData.currentRom && (
															<div>
																<label className="block text-xs font-medium text-slate-500">Current ROM</label>
																<input
																	type="text"
																	value={displayData.currentRom}
																	readOnly
																	className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
																/>
															</div>
														)}
														{displayData.currentStrength && (
															<div>
																<label className="block text-xs font-medium text-slate-500">Current Strength</label>
																<input
																	type="text"
																	value={displayData.currentStrength}
																	readOnly
																	className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
																/>
															</div>
														)}
														{displayData.currentFunctionalAbility && (
															<div>
																<label className="block text-xs font-medium text-slate-500">Current Functional Ability</label>
																<input
																	type="text"
																	value={displayData.currentFunctionalAbility}
																	readOnly
																	className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
																/>
															</div>
														)}
														{displayData.complianceWithHEP && (
															<div className="sm:col-span-2">
																<label className="block text-xs font-medium text-slate-500">Compliance with HEP</label>
																<input
																	type="text"
																	value={displayData.complianceWithHEP}
																	readOnly
																	className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
																/>
															</div>
														)}
													</div>
												</div>
											)}

											{/* Next Follow-Up Details */}
											{(displayData.nextFollowUpDate || displayData.nextFollowUpTime) && (
												<div className="mt-6">
													<h4 className="mb-4 text-base font-semibold text-sky-600">Next Follow-Up Details</h4>
													<div className="grid gap-4 sm:grid-cols-2">
														{displayData.nextFollowUpDate && (
															<div>
																<label className="block text-xs font-medium text-slate-500">Next Follow-Up Date</label>
																<input
																	type="text"
																	value={displayData.nextFollowUpDate}
																	readOnly
																	className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
																/>
															</div>
														)}
														{displayData.nextFollowUpTime && (
															<div>
																<label className="block text-xs font-medium text-slate-500">Next Follow-Up Time</label>
																<input
																	type="text"
																	value={displayData.nextFollowUpTime}
																	readOnly
																	className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
																/>
															</div>
														)}
													</div>
												</div>
											)}

											<div className="mt-6">
												<p className="text-sm font-semibold text-sky-600">Treatment Provided</p>
												<textarea
													value={displayData.treatmentProvided || ''}
													readOnly
													rows={3}
													className="mt-2 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
												/>
											</div>

											<div className="mt-6">
											</div>

											<div className="mt-6 grid gap-4 sm:grid-cols-2">
												<div>
													<label className="block text-xs font-medium text-slate-500">Physio Name</label>
													<input
														type="text"
														value={displayData.physioName || ''}
														readOnly
														className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
													/>
												</div>
												<div>
													<label className="block text-xs font-medium text-slate-500">Date of Consultation</label>
													<input
														type="text"
														value={displayData.dateOfConsultation || ''}
														readOnly
														className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
													/>
												</div>
											</div>
										</>
									);
								})()}
							</div>
						) : (
							<div className="text-center py-12">
								<p className="text-slate-600">No report data available for this patient.</p>
							</div>
						)
					) : (
						loadingStrengthConditioning ? (
							<div className="text-center py-12">
								<div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-slate-900 border-r-transparent"></div>
								<p className="mt-4 text-sm text-slate-600">Loading strength and conditioning data...</p>
							</div>
						) : strengthConditioningData && Object.keys(strengthConditioningData).length > 0 ? (
							<div className="space-y-6">
								{/* Patient Information */}
								<div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
									<h3 className="mb-3 text-sm font-semibold text-slate-900">Patient Information</h3>
									<div className="grid gap-3 sm:grid-cols-2">
										<div>
											<span className="text-xs text-slate-500">Name:</span>
											<p className="text-sm font-medium text-slate-900">{reportPatientData?.name || '—'}</p>
										</div>
										<div>
											<span className="text-xs text-slate-500">Patient ID:</span>
											<p className="text-sm font-medium text-slate-900">{reportPatientData?.patientId || '—'}</p>
										</div>
										<div>
											<span className="text-xs text-slate-500">Date of Birth:</span>
											<p className="text-sm font-medium text-slate-900">{reportPatientData?.dob || '—'}</p>
										</div>
										<div>
											<span className="text-xs text-slate-500">Gender:</span>
											<p className="text-sm font-medium text-slate-900">{reportPatientData?.gender || '—'}</p>
										</div>
										<div>
											<span className="text-xs text-slate-500">Phone:</span>
											<p className="text-sm font-medium text-slate-900">{reportPatientData?.phone || '—'}</p>
										</div>
										<div>
											<span className="text-xs text-slate-500">Email:</span>
											<p className="text-sm font-medium text-slate-900">{reportPatientData?.email || '—'}</p>
										</div>
									</div>
									{strengthConditioningData.therapistName && (
										<div className="mt-3">
											<span className="text-xs text-slate-500">Therapist:</span>
											<p className="text-sm font-medium text-slate-900">{strengthConditioningData.therapistName}</p>
										</div>
									)}
								</div>

								{/* Injury Risk Screening */}
								<div>
									<h3 className="mb-3 text-base font-semibold text-slate-900">Injury Risk Screening</h3>
									<div className="space-y-4">
										{strengthConditioningData.scapularDyskinesiaTest && (
											<div>
												<span className="text-xs font-medium text-slate-600">Scapular Dyskinesia Test:</span>
												<p className="text-sm text-slate-900">{strengthConditioningData.scapularDyskinesiaTest}</p>
											</div>
										)}

										{/* Upper Body Table */}
										{(strengthConditioningData.upperLimbFlexibilityRight || strengthConditioningData.upperLimbFlexibilityLeft ||
											strengthConditioningData.shoulderInternalRotationRight || strengthConditioningData.shoulderInternalRotationLeft ||
											strengthConditioningData.shoulderExternalRotationRight || strengthConditioningData.shoulderExternalRotationLeft) && (
											<div className="overflow-x-auto">
												<table className="min-w-full divide-y divide-slate-200 border border-slate-300 text-sm">
													<thead className="bg-slate-100">
														<tr>
															<th className="px-3 py-2 text-left font-semibold text-slate-700">Fields</th>
															<th className="px-3 py-2 text-left font-semibold text-slate-700">Right</th>
															<th className="px-3 py-2 text-left font-semibold text-slate-700">Left</th>
														</tr>
													</thead>
													<tbody className="divide-y divide-slate-200 bg-white">
														{(strengthConditioningData.upperLimbFlexibilityRight || strengthConditioningData.upperLimbFlexibilityLeft) && (
															<tr>
																<td className="px-3 py-2 font-medium">Upper Limb Flexibility</td>
																<td className="px-3 py-2">{strengthConditioningData.upperLimbFlexibilityRight || '—'}</td>
																<td className="px-3 py-2">{strengthConditioningData.upperLimbFlexibilityLeft || '—'}</td>
															</tr>
														)}
														{(strengthConditioningData.shoulderInternalRotationRight || strengthConditioningData.shoulderInternalRotationLeft) && (
															<tr>
																<td className="px-3 py-2 font-medium">Shoulder Internal Rotation</td>
																<td className="px-3 py-2">{strengthConditioningData.shoulderInternalRotationRight || '—'}</td>
																<td className="px-3 py-2">{strengthConditioningData.shoulderInternalRotationLeft || '—'}</td>
															</tr>
														)}
														{(strengthConditioningData.shoulderExternalRotationRight || strengthConditioningData.shoulderExternalRotationLeft) && (
															<tr>
																<td className="px-3 py-2 font-medium">Shoulder External Rotation</td>
																<td className="px-3 py-2">{strengthConditioningData.shoulderExternalRotationRight || '—'}</td>
																<td className="px-3 py-2">{strengthConditioningData.shoulderExternalRotationLeft || '—'}</td>
															</tr>
														)}
													</tbody>
												</table>
											</div>
										)}

										{strengthConditioningData.thoracicRotation && (
											<div>
												<span className="text-xs font-medium text-slate-600">Thoracic Rotation:</span>
												<p className="text-sm text-slate-900">{strengthConditioningData.thoracicRotation}</p>
											</div>
										)}

										{strengthConditioningData.sitAndReachTest && (
											<div>
												<span className="text-xs font-medium text-slate-600">Sit And Reach Test:</span>
												<p className="text-sm text-slate-900">{strengthConditioningData.sitAndReachTest}</p>
											</div>
										)}

										{/* Lower Body Table */}
										{(strengthConditioningData.singleLegSquatRight || strengthConditioningData.singleLegSquatLeft ||
											strengthConditioningData.weightBearingLungeTestRight || strengthConditioningData.weightBearingLungeTestLeft ||
											strengthConditioningData.hamstringsFlexibilityRight || strengthConditioningData.hamstringsFlexibilityLeft ||
											strengthConditioningData.quadricepsFlexibilityRight || strengthConditioningData.quadricepsFlexibilityLeft ||
											strengthConditioningData.hipExternalRotationRight || strengthConditioningData.hipExternalRotationLeft ||
											strengthConditioningData.hipInternalRotationRight || strengthConditioningData.hipInternalRotationLeft ||
											strengthConditioningData.hipExtensionRight || strengthConditioningData.hipExtensionLeft ||
											strengthConditioningData.activeSLRRight || strengthConditioningData.activeSLRLeft) && (
											<div className="overflow-x-auto">
												<table className="min-w-full divide-y divide-slate-200 border border-slate-300 text-sm">
													<thead className="bg-slate-100">
														<tr>
															<th className="px-3 py-2 text-left font-semibold text-slate-700">Fields</th>
															<th className="px-3 py-2 text-left font-semibold text-slate-700">Right</th>
															<th className="px-3 py-2 text-left font-semibold text-slate-700">Left</th>
														</tr>
													</thead>
													<tbody className="divide-y divide-slate-200 bg-white">
														{(strengthConditioningData.singleLegSquatRight || strengthConditioningData.singleLegSquatLeft) && (
															<tr>
																<td className="px-3 py-2 font-medium">Single Leg Squat</td>
																<td className="px-3 py-2">{strengthConditioningData.singleLegSquatRight || '—'}</td>
																<td className="px-3 py-2">{strengthConditioningData.singleLegSquatLeft || '—'}</td>
															</tr>
														)}
														{(strengthConditioningData.weightBearingLungeTestRight || strengthConditioningData.weightBearingLungeTestLeft) && (
															<tr>
																<td className="px-3 py-2 font-medium">Weight Bearing Lunge Test</td>
																<td className="px-3 py-2">{strengthConditioningData.weightBearingLungeTestRight || '—'}</td>
																<td className="px-3 py-2">{strengthConditioningData.weightBearingLungeTestLeft || '—'}</td>
															</tr>
														)}
														{(strengthConditioningData.hamstringsFlexibilityRight || strengthConditioningData.hamstringsFlexibilityLeft) && (
															<tr>
																<td className="px-3 py-2 font-medium">Hamstrings Flexibility</td>
																<td className="px-3 py-2">{strengthConditioningData.hamstringsFlexibilityRight || '—'}</td>
																<td className="px-3 py-2">{strengthConditioningData.hamstringsFlexibilityLeft || '—'}</td>
															</tr>
														)}
														{(strengthConditioningData.quadricepsFlexibilityRight || strengthConditioningData.quadricepsFlexibilityLeft) && (
															<tr>
																<td className="px-3 py-2 font-medium">Quadriceps Flexibility</td>
																<td className="px-3 py-2">{strengthConditioningData.quadricepsFlexibilityRight || '—'}</td>
																<td className="px-3 py-2">{strengthConditioningData.quadricepsFlexibilityLeft || '—'}</td>
															</tr>
														)}
														{(strengthConditioningData.hipExternalRotationRight || strengthConditioningData.hipExternalRotationLeft) && (
															<tr>
																<td className="px-3 py-2 font-medium">Hip External Rotation</td>
																<td className="px-3 py-2">{strengthConditioningData.hipExternalRotationRight || '—'}</td>
																<td className="px-3 py-2">{strengthConditioningData.hipExternalRotationLeft || '—'}</td>
															</tr>
														)}
														{(strengthConditioningData.hipInternalRotationRight || strengthConditioningData.hipInternalRotationLeft) && (
															<tr>
																<td className="px-3 py-2 font-medium">Hip Internal Rotation</td>
																<td className="px-3 py-2">{strengthConditioningData.hipInternalRotationRight || '—'}</td>
																<td className="px-3 py-2">{strengthConditioningData.hipInternalRotationLeft || '—'}</td>
															</tr>
														)}
														{(strengthConditioningData.hipExtensionRight || strengthConditioningData.hipExtensionLeft) && (
															<tr>
																<td className="px-3 py-2 font-medium">Hip Extension</td>
																<td className="px-3 py-2">{strengthConditioningData.hipExtensionRight || '—'}</td>
																<td className="px-3 py-2">{strengthConditioningData.hipExtensionLeft || '—'}</td>
															</tr>
														)}
														{(strengthConditioningData.activeSLRRight || strengthConditioningData.activeSLRLeft) && (
															<tr>
																<td className="px-3 py-2 font-medium">Active SLR</td>
																<td className="px-3 py-2">{strengthConditioningData.activeSLRRight || '—'}</td>
																<td className="px-3 py-2">{strengthConditioningData.activeSLRLeft || '—'}</td>
															</tr>
														)}
													</tbody>
												</table>
											</div>
										)}

										{strengthConditioningData.pronePlank && (
											<div>
												<span className="text-xs font-medium text-slate-600">Prone Plank:</span>
												<p className="text-sm text-slate-900">{strengthConditioningData.pronePlank}</p>
											</div>
										)}

										{/* Balance Table */}
										{(strengthConditioningData.sidePlankRight || strengthConditioningData.sidePlankLeft ||
											strengthConditioningData.storkStandingBalanceTestRight || strengthConditioningData.storkStandingBalanceTestLeft) && (
											<div className="overflow-x-auto">
												<table className="min-w-full divide-y divide-slate-200 border border-slate-300 text-sm">
													<thead className="bg-slate-100">
														<tr>
															<th className="px-3 py-2 text-left font-semibold text-slate-700">Fields</th>
															<th className="px-3 py-2 text-left font-semibold text-slate-700">Right</th>
															<th className="px-3 py-2 text-left font-semibold text-slate-700">Left</th>
														</tr>
													</thead>
													<tbody className="divide-y divide-slate-200 bg-white">
														{(strengthConditioningData.sidePlankRight || strengthConditioningData.sidePlankLeft) && (
															<tr>
																<td className="px-3 py-2 font-medium">Side Plank</td>
																<td className="px-3 py-2">{strengthConditioningData.sidePlankRight || '—'}</td>
																<td className="px-3 py-2">{strengthConditioningData.sidePlankLeft || '—'}</td>
															</tr>
														)}
														{(strengthConditioningData.storkStandingBalanceTestRight || strengthConditioningData.storkStandingBalanceTestLeft) && (
															<tr>
																<td className="px-3 py-2 font-medium">Stork Standing Balance Test</td>
																<td className="px-3 py-2">{strengthConditioningData.storkStandingBalanceTestRight || '—'}</td>
																<td className="px-3 py-2">{strengthConditioningData.storkStandingBalanceTestLeft || '—'}</td>
															</tr>
														)}
													</tbody>
												</table>
											</div>
										)}

										{strengthConditioningData.deepSquat && (
											<div>
												<span className="text-xs font-medium text-slate-600">Deep Squat:</span>
												<p className="text-sm text-slate-900">{strengthConditioningData.deepSquat}</p>
											</div>
										)}

										{strengthConditioningData.pushup && (
											<div>
												<span className="text-xs font-medium text-slate-600">Pushup:</span>
												<p className="text-sm text-slate-900">{strengthConditioningData.pushup}</p>
											</div>
										)}

										{strengthConditioningData.fmsScore && (
											<div>
												<span className="text-xs font-medium text-slate-600">FMS Score:</span>
												<p className="text-sm text-slate-900">{strengthConditioningData.fmsScore}</p>
											</div>
										)}

										{strengthConditioningData.totalFmsScore && (
											<div>
												<span className="text-xs font-medium text-slate-600">Total FMS Score:</span>
												<p className="text-sm text-slate-900">{strengthConditioningData.totalFmsScore}</p>
											</div>
										)}

										{strengthConditioningData.summary && (
											<div>
												<span className="text-xs font-medium text-slate-600">Summary:</span>
												<p className="text-sm text-slate-900 whitespace-pre-wrap">{strengthConditioningData.summary}</p>
											</div>
										)}
									</div>
								</div>
							</div>
						) : (
							<div className="text-center py-12">
								<p className="text-slate-600">No strength and conditioning report data available for this patient.</p>
							</div>
						)
					)}
				</div>
				
				{/* Footer */}
				<footer className="flex items-center justify-between border-t border-slate-200 px-6 py-4">
					{activeReportTab === 'report' && reportPatientData && (
						<button
							type="button"
							onClick={handleViewVersionHistory}
							className="inline-flex items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none"
						>
							<i className="fas fa-history mr-2" aria-hidden="true" />
							View Versions
						</button>
					)}
					<div className="flex items-center gap-3">
						{activeReportTab === 'report' && reportPatientData && (
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
						{activeReportTab === 'strength-conditioning' && strengthConditioningData && Object.keys(strengthConditioningData).length > 0 && (
							<>
								<button
									type="button"
									onClick={handleDownloadStrengthConditioningPDF}
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

			{/* Version History Modal */}
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
														<div className="ml-4">
															<button
																type="button"
																onClick={() => toggleVersionExpansion(version.id)}
																className="inline-flex items-center rounded-lg border border-sky-600 px-3 py-1.5 text-xs font-semibold text-sky-600 transition hover:bg-sky-50 focus-visible:outline-none"
															>
																<i className={`fas ${isExpanded ? 'fa-chevron-up' : 'fa-chevron-down'} mr-1.5`} aria-hidden="true" />
																{isExpanded ? 'Hide Report' : 'Show Full Report'}
															</button>
														</div>
													</div>
												</div>
												{isExpanded && (
													<div className="border-t border-slate-200 bg-slate-50 p-6 max-h-[70vh] overflow-y-auto">
														{(() => {
															const displayData = versionData;
															return (
																<div className="space-y-6">
																	{/* Report Header */}
																	<div className="flex items-start justify-between border-b border-slate-200 pb-4">
																		<div className="flex-1">
																			<h3 className="text-xl font-bold text-sky-600">Physiotherapy Report - Version #{version.version}</h3>
																			<p className="text-sm text-slate-500 mt-1">
																				Saved on {new Date(version.createdAt).toLocaleString()} by {version.createdBy}
																			</p>
																		</div>
																		<div className="text-right text-sm text-slate-600">
																			<div>
																				<b>Clinic:</b> Centre For Sports Science, Kanteerava Stadium
																			</div>
																			<div>
																				<b>Date:</b> {new Date(version.createdAt).toLocaleDateString()}
																			</div>
																		</div>
																	</div>

																	{/* Patient Information */}
																	<div>
																		<h4 className="mb-4 text-base font-semibold text-sky-600">Patient Information</h4>
																		<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
																			<div>
																				<label className="block text-xs font-medium text-slate-500">Patient Name</label>
																				<div className="mt-1 text-sm text-slate-800">{displayData.name || '—'}</div>
																			</div>
																			<div>
																				<label className="block text-xs font-medium text-slate-500">Patient ID</label>
																				<div className="mt-1 text-sm text-slate-800">{displayData.patientId || '—'}</div>
																			</div>
																			<div>
																				<label className="block text-xs font-medium text-slate-500">Date of Birth</label>
																				<div className="mt-1 text-sm text-slate-800">{displayData.dob || '—'}</div>
																			</div>
																			<div>
																				<label className="block text-xs font-medium text-slate-500">Gender</label>
																				<div className="mt-1 text-sm text-slate-800">{displayData.gender || '—'}</div>
																			</div>
																			<div>
																				<label className="block text-xs font-medium text-slate-500">Assigned Doctor</label>
																				<div className="mt-1 text-sm text-slate-800">{displayData.assignedDoctor || '—'}</div>
																			</div>
																			<div>
																				<label className="block text-xs font-medium text-slate-500">Phone</label>
																				<div className="mt-1 text-sm text-slate-800">{displayData.phone || '—'}</div>
																			</div>
																			<div>
																				<label className="block text-xs font-medium text-slate-500">Email</label>
																				<div className="mt-1 text-sm text-slate-800">{displayData.email || '—'}</div>
																			</div>
																			<div>
																				<label className="block text-xs font-medium text-slate-500">Date of Consultation</label>
																				<div className="mt-1 text-sm text-slate-800">{displayData.dateOfConsultation || '—'}</div>
																			</div>
																		</div>
																	</div>

																	{/* Assessment */}
																	<div>
																		<h4 className="mb-4 text-base font-semibold text-sky-600">Assessment</h4>
																		<div className="grid gap-4 sm:grid-cols-2">
																			<div>
																				<label className="block text-xs font-medium text-slate-500">Complaints</label>
																				<div className="mt-1 text-sm text-slate-800 whitespace-pre-wrap">{displayData.complaints || '—'}</div>
																			</div>
																			<div>
																				<label className="block text-xs font-medium text-slate-500">Present History</label>
																				<div className="mt-1 text-sm text-slate-800 whitespace-pre-wrap">{displayData.presentHistory || '—'}</div>
																			</div>
																			<div>
																				<label className="block text-xs font-medium text-slate-500">Past History</label>
																				<div className="mt-1 text-sm text-slate-800 whitespace-pre-wrap">{displayData.pastHistory || '—'}</div>
																			</div>
																			<div>
																				<label className="block text-xs font-medium text-slate-500">Medical History</label>
																				<div className="mt-1 text-sm text-slate-800">{getMedicalHistoryText(displayData) || '—'}</div>
																			</div>
																			<div>
																				<label className="block text-xs font-medium text-slate-500">Surgical History</label>
																				<div className="mt-1 text-sm text-slate-800 whitespace-pre-wrap">{displayData.surgicalHistory || '—'}</div>
																			</div>
																			<div>
																				<label className="block text-xs font-medium text-slate-500">Personal History</label>
																				<div className="mt-1 text-sm text-slate-800">{getPersonalHistoryText(displayData) || '—'}</div>
																			</div>
																		</div>
																	</div>

																	{/* Pain Assessment */}
																	{displayData.siteSide || displayData.onset || displayData.duration || displayData.painIntensity || displayData.painType || displayData.vasScale ? (
																		<div>
																			<h4 className="mb-4 text-base font-semibold text-sky-600">Pain Assessment</h4>
																			<div className="grid gap-4 sm:grid-cols-2">
																				{displayData.siteSide && (
																					<div>
																						<label className="block text-xs font-medium text-slate-500">Site and Side</label>
																						<div className="mt-1 text-sm text-slate-800">{displayData.siteSide}</div>
																					</div>
																				)}
																				{displayData.onset && (
																					<div>
																						<label className="block text-xs font-medium text-slate-500">Onset</label>
																						<div className="mt-1 text-sm text-slate-800">{displayData.onset}</div>
																					</div>
																				)}
																				{displayData.duration && (
																					<div>
																						<label className="block text-xs font-medium text-slate-500">Duration</label>
																						<div className="mt-1 text-sm text-slate-800">{displayData.duration}</div>
																					</div>
																				)}
																				{displayData.painType && (
																					<div>
																						<label className="block text-xs font-medium text-slate-500">Pain Type</label>
																						<div className="mt-1 text-sm text-slate-800">{displayData.painType}</div>
																					</div>
																				)}
																				{displayData.painIntensity && (
																					<div>
																						<label className="block text-xs font-medium text-slate-500">Pain Intensity</label>
																						<div className="mt-1 text-sm text-slate-800">{displayData.painIntensity}</div>
																					</div>
																				)}
																				{displayData.vasScale && (
																					<div>
																						<label className="block text-xs font-medium text-slate-500">VAS Scale</label>
																						<div className="mt-1 text-sm text-slate-800">{displayData.vasScale}</div>
																					</div>
																				)}
																			</div>
																		</div>
																	) : null}

																	{/* ROM */}
																	{displayData.rom && Object.keys(displayData.rom).length > 0 && (
																		<div>
																			<h4 className="mb-4 text-base font-semibold text-sky-600">Range of Motion (ROM)</h4>
																			{renderRomView(displayData.rom)}
																		</div>
																	)}

																	{/* MMT */}
																	{displayData.mmt && Object.keys(displayData.mmt).length > 0 && (
																		<div>
																			<h4 className="mb-4 text-base font-semibold text-sky-600">Manual Muscle Testing (MMT)</h4>
																			{renderMmtView(displayData.mmt)}
																		</div>
																	)}

																	{/* Additional sections can be added here as needed */}
																	{(displayData.specialTest || displayData.finalDiagnosis) && (
																		<div>
																			<h4 className="mb-4 text-base font-semibold text-sky-600">Advanced Assessment</h4>
																			<div className="grid gap-4 sm:grid-cols-2">
																				{displayData.specialTest && (
																					<div>
																						<label className="block text-xs font-medium text-slate-500">Special Test</label>
																						<div className="mt-1 text-sm text-slate-800 whitespace-pre-wrap">{displayData.specialTest}</div>
																					</div>
																				)}
																				{displayData.finalDiagnosis && (
																					<div>
																						<label className="block text-xs font-medium text-slate-500">Final Diagnosis</label>
																						<div className="mt-1 text-sm text-slate-800 whitespace-pre-wrap">{displayData.finalDiagnosis}</div>
																					</div>
																				)}
																			</div>
																		</div>
																	)}

																	{(displayData.shortTermGoals || displayData.longTermGoals || displayData.treatment || displayData.treatmentProvided || displayData.rehabProtocol || displayData.advice) && (
																		<div>
																			<h4 className="mb-4 text-base font-semibold text-sky-600">Physiotherapy Management</h4>
																			<div className="grid gap-4 sm:grid-cols-2">
																				{displayData.shortTermGoals && (
																					<div>
																						<label className="block text-xs font-medium text-slate-500">Short Term Goals</label>
																						<div className="mt-1 text-sm text-slate-800 whitespace-pre-wrap">{displayData.shortTermGoals}</div>
																					</div>
																				)}
																				{displayData.longTermGoals && (
																					<div>
																						<label className="block text-xs font-medium text-slate-500">Long Term Goals</label>
																						<div className="mt-1 text-sm text-slate-800 whitespace-pre-wrap">{displayData.longTermGoals}</div>
																					</div>
																				)}
																				{(displayData.treatment || displayData.treatmentProvided || displayData.rehabProtocol) && (
																					<div>
																						<label className="block text-xs font-medium text-slate-500">Treatment</label>
																						<div className="mt-1 text-sm text-slate-800 whitespace-pre-wrap">{displayData.treatment || displayData.treatmentProvided || displayData.rehabProtocol || ''}</div>
																					</div>
																				)}
																				{displayData.advice && (
																					<div>
																						<label className="block text-xs font-medium text-slate-500">Advice</label>
																						<div className="mt-1 text-sm text-slate-800 whitespace-pre-wrap">{displayData.advice}</div>
																					</div>
																				)}
																			</div>
																		</div>
																	)}
																</div>
															);
														})()}
													</div>
												)}
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
		</div>
	);
}

