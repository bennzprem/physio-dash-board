'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { collection, doc, onSnapshot, setDoc, type QuerySnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/PageHeader';
import type { PatientRecordFull } from '@/lib/types';

interface StrengthConditioningData {
	// Therapist information
	therapistName?: string;
	// Injury risk screening
	scapularDyskinesiaTest?: string;
	upperLimbFlexibilityRight?: string;
	upperLimbFlexibilityLeft?: string;
	shoulderInternalRotationRight?: string;
	shoulderInternalRotationLeft?: string;
	shoulderExternalRotationRight?: string;
	shoulderExternalRotationLeft?: string;
	thoracicRotation?: string;
	sitAndReachTest?: string;
	singleLegSquatRight?: string;
	singleLegSquatLeft?: string;
	weightBearingLungeTestRight?: string;
	weightBearingLungeTestLeft?: string;
	hamstringsFlexibilityRight?: string;
	hamstringsFlexibilityLeft?: string;
	quadricepsFlexibilityRight?: string;
	quadricepsFlexibilityLeft?: string;
	hipExternalRotationRight?: string;
	hipExternalRotationLeft?: string;
	hipInternalRotationRight?: string;
	hipInternalRotationLeft?: string;
	hipExtensionRight?: string;
	hipExtensionLeft?: string;
	activeSLRRight?: string;
	activeSLRLeft?: string;
	pronePlank?: string;
	sidePlankRight?: string;
	sidePlankLeft?: string;
	storkStandingBalanceTestRight?: string;
	storkStandingBalanceTestLeft?: string;
	deepSquat?: string;
	pushup?: string;
	fmsScore?: string;
	totalFmsScore?: string;
	summary?: string;
}

export default function StrengthConditioningReport() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { user } = useAuth();
	const patientId = searchParams.get('patientId');

	const [patients, setPatients] = useState<PatientRecordFull[]>([]);
	const [selectedPatient, setSelectedPatient] = useState<PatientRecordFull | null>(null);
	const [clinicalTeamMembers, setClinicalTeamMembers] = useState<Array<{ id: string; userName: string; userEmail?: string }>>([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [savedMessage, setSavedMessage] = useState(false);
	const [formData, setFormData] = useState<StrengthConditioningData>({});

	// Load patients
	useEffect(() => {
		const unsubscribe = onSnapshot(
			collection(db, 'patients'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data() as Record<string, unknown>;
					const created = (data.registeredAt as { toDate?: () => Date } | undefined)?.toDate?.();
					return {
						id: docSnap.id,
						patientId: data.patientId ? String(data.patientId) : undefined,
						name: data.name ? String(data.name) : undefined,
						dob: data.dob ? String(data.dob) : undefined,
						gender: data.gender ? String(data.gender) : undefined,
						phone: data.phone ? String(data.phone) : undefined,
						email: data.email ? String(data.email) : undefined,
						address: data.address ? String(data.address) : undefined,
						complaint: data.complaint ? String(data.complaint) : undefined,
						status: (data.status as any) ?? 'pending',
						assignedDoctor: data.assignedDoctor ? String(data.assignedDoctor) : undefined,
						registeredAt: created ? created.toISOString() : (data.registeredAt as string | undefined),
					} as PatientRecordFull;
				});
				setPatients([...mapped]);

				// Auto-select patient if patientId is provided
				if (patientId) {
					const found = mapped.find(p => p.patientId === patientId || p.id === patientId);
					if (found) {
						setSelectedPatient(found);
					}
				}
			},
			error => {
				console.error('Failed to load patients', error);
				setPatients([]);
			}
		);

		return () => unsubscribe();
	}, [patientId]);

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

	// Load existing strength and conditioning data
	useEffect(() => {
		if (!selectedPatient?.id) {
			setFormData({});
			setLoading(false);
			return;
		}

		setLoading(true);
		const docRef = doc(db, 'strengthConditioningReports', selectedPatient.id);
		
		const unsubscribe = onSnapshot(
			docRef,
			snapshot => {
				if (snapshot.exists()) {
					const data = snapshot.data() as StrengthConditioningData;
					setFormData(data);
				} else {
					// Initialize with current user's name if available
					const currentUserStaff = clinicalTeamMembers.find(m => m.userEmail === user?.email);
					setFormData({
						therapistName: currentUserStaff?.userName || user?.displayName || user?.email || '',
					});
				}
				setLoading(false);
			},
			error => {
				console.error('Failed to load strength and conditioning data', error);
				const currentUserStaff = clinicalTeamMembers.find(m => m.userEmail === user?.email);
				setFormData({
					therapistName: currentUserStaff?.userName || user?.displayName || user?.email || '',
				});
				setLoading(false);
			}
		);

		return () => unsubscribe();
	}, [selectedPatient?.id, user?.displayName, user?.email, clinicalTeamMembers]);

	const handleFieldChange = (field: keyof StrengthConditioningData, value: string) => {
		setFormData(prev => ({ ...prev, [field]: value }));
	};

	const handleSave = async () => {
		if (!selectedPatient?.id) {
			alert('Please select a patient first');
			return;
		}

		setSaving(true);
		try {
			const docRef = doc(db, 'strengthConditioningReports', selectedPatient.id);
			await setDoc(docRef, {
				...formData,
				therapistName: formData.therapistName || user?.displayName || user?.email || '',
				patientId: selectedPatient.patientId,
				patientName: selectedPatient.name,
				updatedAt: new Date().toISOString(),
				updatedBy: user?.email || user?.displayName || 'Unknown',
			}, { merge: true });

			setSavedMessage(true);
			setTimeout(() => setSavedMessage(false), 3000);
		} catch (error) {
			console.error('Failed to save strength and conditioning report', error);
			alert('Failed to save report. Please try again.');
		} finally {
			setSaving(false);
		}
	};

	const generatePDF = async (forPrint: boolean = false) => {
		if (!selectedPatient) {
			alert('Please select a patient first');
			return null;
		}

		try {
			const [{ default: jsPDF }, autoTableModule] = await Promise.all([
				import('jspdf'),
				import('jspdf-autotable'),
			]);

			const autoTable = (autoTableModule as any).default || autoTableModule;
			const doc = new jsPDF('p', 'mm', 'a4');
			const pageWidth = 210;
			const pageHeight = 297;
			const pageMargin = 10;
			let y = 20;

			// Title
			doc.setFontSize(16);
			doc.setFont('helvetica', 'bold');
			doc.text('Strength and Conditioning Assessment Report', pageWidth / 2, y, { align: 'center' });
			y += 10;

			// Patient Details
			doc.setFontSize(12);
			doc.setFont('helvetica', 'bold');
			doc.text('Patient Information', pageMargin, y);
			y += 8;

			doc.setFontSize(10);
			doc.setFont('helvetica', 'normal');
			const patientInfo = [
				['Patient Name', selectedPatient.name || ''],
				['Patient ID', selectedPatient.patientId || ''],
				['Date of Birth', selectedPatient.dob || ''],
				['Gender', selectedPatient.gender || ''],
				['Phone', selectedPatient.phone || ''],
				['Email', selectedPatient.email || ''],
			];

			autoTable(doc, {
				startY: y,
				head: [['Field', 'Value']],
				body: patientInfo,
				theme: 'grid',
				headStyles: { fillColor: [7, 89, 133], textColor: [255, 255, 255] },
				styles: { fontSize: 9, cellPadding: 3 },
				columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 'auto' } },
				margin: { left: pageMargin, right: pageMargin },
			});
			y = (doc as any).lastAutoTable.finalY + 10;

			// Therapist Name
			if (formData.therapistName) {
				doc.setFontSize(10);
				doc.setFont('helvetica', 'normal');
				doc.text(`Therapist: ${formData.therapistName}`, pageMargin, y);
				y += 8;
			}

			// Injury Risk Screening Section
			doc.setFontSize(12);
			doc.setFont('helvetica', 'bold');
			doc.text('Injury Risk Screening', pageMargin, y);
			y += 8;

			// Build body rows
			const bodyRows: string[][] = [];

			if (formData.scapularDyskinesiaTest) {
				bodyRows.push(['Scapular Dyskinesia Test', formData.scapularDyskinesiaTest]);
			}

			// Upper body table
			const upperBodyRows: string[][] = [
				['Upper Limb Flexibility', formData.upperLimbFlexibilityRight || '', formData.upperLimbFlexibilityLeft || ''],
				['Shoulder Internal Rotation', formData.shoulderInternalRotationRight || '', formData.shoulderInternalRotationLeft || ''],
				['Shoulder External Rotation', formData.shoulderExternalRotationRight || '', formData.shoulderExternalRotationLeft || ''],
			].filter(row => row[1] || row[2]);

			if (upperBodyRows.length > 0) {
				autoTable(doc, {
					startY: y,
					head: [['Field', 'Right', 'Left']],
					body: upperBodyRows,
					theme: 'grid',
					headStyles: { fillColor: [7, 89, 133], textColor: [255, 255, 255] },
					styles: { fontSize: 9, cellPadding: 2 },
					margin: { left: pageMargin, right: pageMargin },
				});
				y = (doc as any).lastAutoTable.finalY + 6;
			}

			if (formData.thoracicRotation) {
				bodyRows.push(['Thoracic Rotation', formData.thoracicRotation]);
			}
			if (formData.sitAndReachTest) {
				bodyRows.push(['Sit And Reach Test', formData.sitAndReachTest]);
			}

			// Lower body table
			const lowerBodyRows: string[][] = [
				['Single Leg Squat', formData.singleLegSquatRight || '', formData.singleLegSquatLeft || ''],
				['Weight Bearing Lunge Test', formData.weightBearingLungeTestRight || '', formData.weightBearingLungeTestLeft || ''],
				['Hamstrings Flexibility', formData.hamstringsFlexibilityRight || '', formData.hamstringsFlexibilityLeft || ''],
				['Quadriceps Flexibility', formData.quadricepsFlexibilityRight || '', formData.quadricepsFlexibilityLeft || ''],
				['Hip External Rotation', formData.hipExternalRotationRight || '', formData.hipExternalRotationLeft || ''],
				['Hip Internal Rotation', formData.hipInternalRotationRight || '', formData.hipInternalRotationLeft || ''],
				['Hip Extension', formData.hipExtensionRight || '', formData.hipExtensionLeft || ''],
				['Active SLR', formData.activeSLRRight || '', formData.activeSLRLeft || ''],
			].filter(row => row[1] || row[2]);

			if (lowerBodyRows.length > 0) {
				autoTable(doc, {
					startY: y,
					head: [['Field', 'Right', 'Left']],
					body: lowerBodyRows,
					theme: 'grid',
					headStyles: { fillColor: [7, 89, 133], textColor: [255, 255, 255] },
					styles: { fontSize: 9, cellPadding: 2 },
					margin: { left: pageMargin, right: pageMargin },
				});
				y = (doc as any).lastAutoTable.finalY + 6;
			}

			if (formData.pronePlank) {
				bodyRows.push(['Prone Plank', formData.pronePlank]);
			}

			// Side plank and stork table
			const balanceRows: string[][] = [
				['Side Plank', formData.sidePlankRight || '', formData.sidePlankLeft || ''],
				['Stork Standing Balance Test', formData.storkStandingBalanceTestRight || '', formData.storkStandingBalanceTestLeft || ''],
			].filter(row => row[1] || row[2]);

			if (balanceRows.length > 0) {
				autoTable(doc, {
					startY: y,
					head: [['Field', 'Right', 'Left']],
					body: balanceRows,
					theme: 'grid',
					headStyles: { fillColor: [7, 89, 133], textColor: [255, 255, 255] },
					styles: { fontSize: 9, cellPadding: 2 },
					margin: { left: pageMargin, right: pageMargin },
				});
				y = (doc as any).lastAutoTable.finalY + 6;
			}

			// Additional fields
			const additionalFields: string[][] = [];
			if (formData.deepSquat) additionalFields.push(['Deep Squat', formData.deepSquat]);
			if (formData.pushup) additionalFields.push(['Pushup', formData.pushup]);
			if (formData.fmsScore) additionalFields.push(['FMS Score', formData.fmsScore]);
			if (formData.totalFmsScore) additionalFields.push(['Total FMS Score', formData.totalFmsScore]);

			if (additionalFields.length > 0) {
				autoTable(doc, {
					startY: y,
					head: [['Field', 'Value']],
					body: additionalFields,
					theme: 'grid',
					headStyles: { fillColor: [7, 89, 133], textColor: [255, 255, 255] },
					styles: { fontSize: 9, cellPadding: 2 },
					columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 'auto' } },
					margin: { left: pageMargin, right: pageMargin },
				});
				y = (doc as any).lastAutoTable.finalY + 6;
			}

			// Summary
			if (formData.summary) {
				doc.setFontSize(12);
				doc.setFont('helvetica', 'bold');
				doc.text('Summary', pageMargin, y);
				y += 6;

				doc.setFontSize(10);
				doc.setFont('helvetica', 'normal');
				const summaryLines = doc.splitTextToSize(formData.summary, pageWidth - 2 * pageMargin);
				doc.text(summaryLines, pageMargin, y);
			}

			return doc;
		} catch (error) {
			console.error('Failed to generate PDF', error);
			alert('Failed to generate PDF. Please try again.');
			return null;
		}
	};

	const handlePrint = async () => {
		const doc = await generatePDF(true);
		if (doc) {
			// Generate PDF data URL and open in new window for printing
			const pdfDataUri = doc.output('datauristring');
			const printWindow = window.open();
			if (printWindow) {
				printWindow.document.write(`
					<html>
						<head>
							<title>Strength and Conditioning Report - Print</title>
						</head>
						<body style="margin: 0; padding: 0;">
							<iframe src="${pdfDataUri}" style="width: 100%; height: 100vh; border: none;"></iframe>
							<script>
								window.onload = function() {
									setTimeout(function() {
										window.print();
									}, 500);
								};
							</script>
						</body>
					</html>
				`);
				printWindow.document.close();
			}
		}
	};

	const handleDownloadPDF = async () => {
		const doc = await generatePDF(false);
		if (doc && selectedPatient) {
			// Save PDF
			const fileName = `Strength_Conditioning_${selectedPatient.patientId}_${new Date().toISOString().split('T')[0]}.pdf`;
			doc.save(fileName);
		}
	};

	if (loading && selectedPatient) {
		return (
			<div className="flex min-h-svh items-center justify-center bg-slate-50">
				<div className="text-center">
					<div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-sky-600 border-r-transparent"></div>
					<p className="text-sm text-slate-600">Loading report...</p>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-svh bg-slate-50 px-6 py-10 print:px-4 print:py-4">
			<div className="mx-auto max-w-6xl space-y-6">
				<PageHeader
					title="Strength and Conditioning Assessment"
				/>

				{/* Patient Selection */}
				<div className="card-base no-print">
					<label className="block text-sm font-semibold text-slate-700 mb-2">
						Select Patient
					</label>
					<select
						value={selectedPatient?.id || ''}
						onChange={e => {
							const found = patients.find(p => p.id === e.target.value);
							setSelectedPatient(found || null);
						}}
						className="select-base"
					>
						<option value="">-- Select a patient --</option>
						{patients.map(patient => (
							<option key={patient.id} value={patient.id}>
								{patient.name} ({patient.patientId})
							</option>
						))}
					</select>
				</div>

				{!selectedPatient && (
					<div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 no-print">
						Please select a patient to view or edit the strength and conditioning report.
					</div>
				)}

				{selectedPatient && (
					<>
						{/* Patient Details */}
						<div className="card-base">
							<h2 className="mb-4 text-lg font-semibold text-slate-900 border-b-2 border-slate-300 pb-2">
								Patient Information
							</h2>
							<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
								<div>
									<label className="block text-xs font-medium text-slate-500 mb-1">Patient Name</label>
									<p className="text-sm font-medium text-slate-900">{selectedPatient.name || '—'}</p>
								</div>
								<div>
									<label className="block text-xs font-medium text-slate-500 mb-1">Patient ID</label>
									<p className="text-sm font-medium text-slate-900">{selectedPatient.patientId || '—'}</p>
								</div>
								<div>
									<label className="block text-xs font-medium text-slate-500 mb-1">Date of Birth</label>
									<p className="text-sm font-medium text-slate-900">{selectedPatient.dob || '—'}</p>
								</div>
								<div>
									<label className="block text-xs font-medium text-slate-500 mb-1">Gender</label>
									<p className="text-sm font-medium text-slate-900">{selectedPatient.gender || '—'}</p>
								</div>
								<div>
									<label className="block text-xs font-medium text-slate-500 mb-1">Phone</label>
									<p className="text-sm font-medium text-slate-900">{selectedPatient.phone || '—'}</p>
								</div>
								<div>
									<label className="block text-xs font-medium text-slate-500 mb-1">Email</label>
									<p className="text-sm font-medium text-slate-900">{selectedPatient.email || '—'}</p>
								</div>
							</div>
						</div>

						{/* Therapist Name */}
						<div className="card-base">
							<label className="block text-sm font-semibold text-slate-700 mb-2">
								Therapist Name
							</label>
							<select
								value={formData.therapistName || ''}
								onChange={e => handleFieldChange('therapistName', e.target.value)}
								className="select-base"
							>
								<option value="">-- Select therapist --</option>
								{clinicalTeamMembers.map(member => (
									<option key={member.id} value={member.userName}>
										{member.userName}
									</option>
								))}
							</select>
						</div>

						{/* Injury risk screening */}
						<div className="card-base">
							<h2 className="mb-4 text-lg font-semibold text-slate-900 border-b-2 border-slate-300 pb-2">
								Injury Risk Screening
							</h2>
							
							<div className="space-y-4">
								{/* Scapular dyskinesia test - text box */}
								<div>
									<label className="block text-sm font-medium text-slate-700 mb-1">
										Scapular Dyskinesia Test
									</label>
									<input
										type="text"
										value={formData.scapularDyskinesiaTest || ''}
										onChange={e => handleFieldChange('scapularDyskinesiaTest', e.target.value)}
										className="input-base"
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
														value={formData.upperLimbFlexibilityRight || ''}
														onChange={e => handleFieldChange('upperLimbFlexibilityRight', e.target.value)}
														className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
														placeholder="Enter result"
													/>
												</td>
												<td className="px-3 py-2 border border-slate-300">
													<input
														type="text"
														value={formData.upperLimbFlexibilityLeft || ''}
														onChange={e => handleFieldChange('upperLimbFlexibilityLeft', e.target.value)}
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
														value={formData.shoulderInternalRotationRight || ''}
														onChange={e => handleFieldChange('shoulderInternalRotationRight', e.target.value)}
														className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
														placeholder="Enter result"
													/>
												</td>
												<td className="px-3 py-2 border border-slate-300">
													<input
														type="text"
														value={formData.shoulderInternalRotationLeft || ''}
														onChange={e => handleFieldChange('shoulderInternalRotationLeft', e.target.value)}
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
														value={formData.shoulderExternalRotationRight || ''}
														onChange={e => handleFieldChange('shoulderExternalRotationRight', e.target.value)}
														className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
														placeholder="Enter result"
													/>
												</td>
												<td className="px-3 py-2 border border-slate-300">
													<input
														type="text"
														value={formData.shoulderExternalRotationLeft || ''}
														onChange={e => handleFieldChange('shoulderExternalRotationLeft', e.target.value)}
														className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
														placeholder="Enter result"
													/>
												</td>
											</tr>
										</tbody>
									</table>
								</div>

								{/* Thoracic Rotation and Sit and Reach test - text boxes */}
								<div className="grid gap-4 sm:grid-cols-2">
									<div>
										<label className="block text-sm font-medium text-slate-700 mb-1">
											Thoracic Rotation
										</label>
										<input
											type="text"
											value={formData.thoracicRotation || ''}
											onChange={e => handleFieldChange('thoracicRotation', e.target.value)}
											className="input-base"
											placeholder="Enter result"
										/>
									</div>
									<div>
										<label className="block text-sm font-medium text-slate-700 mb-1">
											Sit And Reach Test
										</label>
										<input
											type="text"
											value={formData.sitAndReachTest || ''}
											onChange={e => handleFieldChange('sitAndReachTest', e.target.value)}
											className="input-base"
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
														value={formData.singleLegSquatRight || ''}
														onChange={e => handleFieldChange('singleLegSquatRight', e.target.value)}
														className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
														placeholder="Enter result"
													/>
												</td>
												<td className="px-3 py-2 border border-slate-300">
													<input
														type="text"
														value={formData.singleLegSquatLeft || ''}
														onChange={e => handleFieldChange('singleLegSquatLeft', e.target.value)}
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
														value={formData.weightBearingLungeTestRight || ''}
														onChange={e => handleFieldChange('weightBearingLungeTestRight', e.target.value)}
														className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
														placeholder="Enter result"
													/>
												</td>
												<td className="px-3 py-2 border border-slate-300">
													<input
														type="text"
														value={formData.weightBearingLungeTestLeft || ''}
														onChange={e => handleFieldChange('weightBearingLungeTestLeft', e.target.value)}
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
														value={formData.hamstringsFlexibilityRight || ''}
														onChange={e => handleFieldChange('hamstringsFlexibilityRight', e.target.value)}
														className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
														placeholder="Enter result"
													/>
												</td>
												<td className="px-3 py-2 border border-slate-300">
													<input
														type="text"
														value={formData.hamstringsFlexibilityLeft || ''}
														onChange={e => handleFieldChange('hamstringsFlexibilityLeft', e.target.value)}
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
														value={formData.quadricepsFlexibilityRight || ''}
														onChange={e => handleFieldChange('quadricepsFlexibilityRight', e.target.value)}
														className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
														placeholder="Enter result"
													/>
												</td>
												<td className="px-3 py-2 border border-slate-300">
													<input
														type="text"
														value={formData.quadricepsFlexibilityLeft || ''}
														onChange={e => handleFieldChange('quadricepsFlexibilityLeft', e.target.value)}
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
														value={formData.hipExternalRotationRight || ''}
														onChange={e => handleFieldChange('hipExternalRotationRight', e.target.value)}
														className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
														placeholder="Enter result"
													/>
												</td>
												<td className="px-3 py-2 border border-slate-300">
													<input
														type="text"
														value={formData.hipExternalRotationLeft || ''}
														onChange={e => handleFieldChange('hipExternalRotationLeft', e.target.value)}
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
														value={formData.hipInternalRotationRight || ''}
														onChange={e => handleFieldChange('hipInternalRotationRight', e.target.value)}
														className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
														placeholder="Enter result"
													/>
												</td>
												<td className="px-3 py-2 border border-slate-300">
													<input
														type="text"
														value={formData.hipInternalRotationLeft || ''}
														onChange={e => handleFieldChange('hipInternalRotationLeft', e.target.value)}
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
														value={formData.hipExtensionRight || ''}
														onChange={e => handleFieldChange('hipExtensionRight', e.target.value)}
														className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
														placeholder="Enter result"
													/>
												</td>
												<td className="px-3 py-2 border border-slate-300">
													<input
														type="text"
														value={formData.hipExtensionLeft || ''}
														onChange={e => handleFieldChange('hipExtensionLeft', e.target.value)}
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
														value={formData.activeSLRRight || ''}
														onChange={e => handleFieldChange('activeSLRRight', e.target.value)}
														className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
														placeholder="Enter result"
													/>
												</td>
												<td className="px-3 py-2 border border-slate-300">
													<input
														type="text"
														value={formData.activeSLRLeft || ''}
														onChange={e => handleFieldChange('activeSLRLeft', e.target.value)}
														className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
														placeholder="Enter result"
													/>
												</td>
											</tr>
										</tbody>
									</table>
								</div>

								{/* Prone plank - text box */}
								<div>
									<label className="block text-sm font-medium text-slate-700 mb-1">
										Prone Plank
									</label>
									<input
										type="text"
										value={formData.pronePlank || ''}
										onChange={e => handleFieldChange('pronePlank', e.target.value)}
										className="input-base"
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
														value={formData.sidePlankRight || ''}
														onChange={e => handleFieldChange('sidePlankRight', e.target.value)}
														className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
														placeholder="Enter result"
													/>
												</td>
												<td className="px-3 py-2 border border-slate-300">
													<input
														type="text"
														value={formData.sidePlankLeft || ''}
														onChange={e => handleFieldChange('sidePlankLeft', e.target.value)}
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
														value={formData.storkStandingBalanceTestRight || ''}
														onChange={e => handleFieldChange('storkStandingBalanceTestRight', e.target.value)}
														className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
														placeholder="Enter result"
													/>
												</td>
												<td className="px-3 py-2 border border-slate-300">
													<input
														type="text"
														value={formData.storkStandingBalanceTestLeft || ''}
														onChange={e => handleFieldChange('storkStandingBalanceTestLeft', e.target.value)}
														className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
														placeholder="Enter result"
													/>
												</td>
											</tr>
										</tbody>
									</table>
								</div>

								{/* Out of table fields */}
								<div className="space-y-4">
									<div>
										<label className="block text-sm font-medium text-slate-700 mb-1">
											Deep Squat
										</label>
										<input
											type="text"
											value={formData.deepSquat || ''}
											onChange={e => handleFieldChange('deepSquat', e.target.value)}
											className="input-base"
											placeholder="Enter result"
										/>
									</div>
									<div>
										<label className="block text-sm font-medium text-slate-700 mb-1">
											Pushup
										</label>
										<input
											type="text"
											value={formData.pushup || ''}
											onChange={e => handleFieldChange('pushup', e.target.value)}
											className="input-base"
											placeholder="Enter result"
										/>
									</div>
									<div>
										<label className="block text-sm font-medium text-slate-700 mb-1">
											FMS Score
										</label>
										<input
											type="text"
											value={formData.fmsScore || ''}
											onChange={e => handleFieldChange('fmsScore', e.target.value)}
											className="input-base"
											placeholder="Enter FMS score"
										/>
									</div>
									<div>
										<label className="block text-sm font-medium text-slate-700 mb-1">
											Total FMS Score
										</label>
										<input
											type="text"
											value={formData.totalFmsScore || ''}
											onChange={e => handleFieldChange('totalFmsScore', e.target.value)}
											className="input-base"
											placeholder="Enter total FMS score"
										/>
									</div>
									<div>
										<label className="block text-sm font-medium text-slate-700 mb-1">
											Summary
										</label>
										<textarea
											value={formData.summary || ''}
											onChange={e => handleFieldChange('summary', e.target.value)}
											className="textarea-base"
											rows={4}
											placeholder="Enter summary"
										/>
									</div>
								</div>
							</div>
						</div>

						{/* Action Buttons */}
						<div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-6 no-print">
							{savedMessage && (
								<div className="mr-auto rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
									Report saved successfully!
								</div>
							)}
							<button
								type="button"
								onClick={() => router.push('/clinical-team/edit-report')}
								className="btn-secondary"
							>
								Back
							</button>
							<button
								type="button"
								onClick={handlePrint}
								className="btn-secondary"
								disabled={!selectedPatient}
							>
								<i className="fas fa-print text-xs" aria-hidden="true" />
								Print Report
							</button>
							<button
								type="button"
								onClick={handleDownloadPDF}
								className="btn-secondary"
								disabled={!selectedPatient}
							>
								<i className="fas fa-download text-xs" aria-hidden="true" />
								Download PDF
							</button>
							<button
								type="button"
								onClick={handleSave}
								className="btn-primary"
								disabled={saving}
							>
								<i className="fas fa-save text-xs" aria-hidden="true" />
								{saving ? 'Saving...' : 'Save Report'}
							</button>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
