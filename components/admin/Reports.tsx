'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { collection, doc, onSnapshot, deleteDoc, query, where, getDocs, writeBatch, type QuerySnapshot, type Timestamp } from 'firebase/firestore';

import {
	type AdminAppointmentRecord,
	type AdminPatientRecord,
	type AdminPatientStatus,
} from '@/lib/adminMockData';
import { db } from '@/lib/firebase';
import PageHeader from '@/components/PageHeader';
import { generatePhysiotherapyReportPDF, generateStrengthConditioningPDF, type StrengthConditioningData } from '@/lib/pdfGenerator';

interface StaffMember {
	id: string;
	userName: string;
	role: string;
	status: string;
}

type StatusFilter = 'all' | AdminPatientStatus;
type DateFilter = 'all' | '7' | '30' | '180' | '365';

interface PatientRow {
	patient: AdminPatientRecord;
	doctors: string[];
	age: string;
	status: AdminPatientStatus;
}

interface SummaryCounts {
	total: number;
	pending: number;
	ongoing: number;
	completed: number;
	cancelled: number;
}

const statusOptions: Array<{ value: StatusFilter; label: string }> = [
	{ value: 'all', label: 'All' },
	{ value: 'pending', label: 'Pending' },
	{ value: 'ongoing', label: 'Ongoing' },
	{ value: 'completed', label: 'Completed' },
	{ value: 'cancelled', label: 'Cancelled' },
];

const dateRangeOptions: Array<{ value: DateFilter; label: string }> = [
	{ value: 'all', label: 'All Time' },
	{ value: '7', label: 'Last 7 Days' },
	{ value: '30', label: 'Last 1 Month' },
	{ value: '180', label: 'Last 6 Months' },
	{ value: '365', label: 'Last 1 Year' },
];

const statusBadgeClasses: Record<AdminPatientStatus, string> = {
	pending: 'status-badge-pending',
	ongoing: 'status-badge-ongoing',
	completed: 'status-badge-completed',
	cancelled: 'status-badge-cancelled',
};

const capitalize = (value?: string | null) => {
	if (!value) return '';
	return value.charAt(0).toUpperCase() + value.slice(1);
};

const calculateAge = (dob?: string) => {
	if (!dob) return '';
	const birth = new Date(dob);
	if (Number.isNaN(birth.getTime())) return '';
	const now = new Date();
	let age = now.getFullYear() - birth.getFullYear();
	const monthDiff = now.getMonth() - birth.getMonth();
	if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
		age -= 1;
	}
	return age > 0 ? String(age) : '';
};

const isWithinWindow = (dateIso: string | undefined, window: DateFilter) => {
	if (window === 'all') return true;
	if (!dateIso) return false;
	const date = new Date(dateIso);
	if (Number.isNaN(date.getTime())) return false;
	const now = new Date();
	const diff = (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);
	return diff <= Number(window);
};

export default function Reports() {
	const [patients, setPatients] = useState<(AdminPatientRecord & { id?: string })[]>([]);
	const [appointments, setAppointments] = useState<(AdminAppointmentRecord & { id?: string })[]>([]);
	const [staff, setStaff] = useState<StaffMember[]>([]);

	const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
	const [doctorFilter, setDoctorFilter] = useState<'all' | string>('all');
	const [dateFilter, setDateFilter] = useState<DateFilter>('all');
	const [searchTerm, setSearchTerm] = useState('');

	const [isModalOpen, setIsModalOpen] = useState(false);
	const [modalContext, setModalContext] = useState<{ patient: AdminPatientRecord; doctors: string[] } | null>(
		null
	);
	const [selectedPhysician, setSelectedPhysician] = useState<string>('');
	const [showStrengthConditioningModal, setShowStrengthConditioningModal] = useState(false);
	const [strengthConditioningData, setStrengthConditioningData] = useState<StrengthConditioningData | null>(null);
	const [loadingStrengthConditioning, setLoadingStrengthConditioning] = useState(false);
	const [selectedPatientForSC, setSelectedPatientForSC] = useState<AdminPatientRecord | null>(null);
	const strengthConditioningUnsubscribeRef = useRef<(() => void) | null>(null);

	// Load patients from Firestore
	useEffect(() => {
		const unsubscribe = onSnapshot(
			collection(db, 'patients'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data() as Record<string, unknown>;
					const created = (data.registeredAt as Timestamp | undefined)?.toDate?.();
					return {
						id: docSnap.id,
						patientId: data.patientId ? String(data.patientId) : '',
						name: data.name ? String(data.name) : '',
						dob: data.dob ? String(data.dob) : '',
						gender: data.gender ? String(data.gender) : '',
						phone: data.phone ? String(data.phone) : '',
						email: data.email ? String(data.email) : '',
						address: data.address ? String(data.address) : '',
						complaint: data.complaint ? String(data.complaint) : '',
						status: (data.status as AdminPatientStatus) ?? 'pending',
						patientType: data.patientType ? String(data.patientType) : '',
						totalSessionsRequired:
							typeof data.totalSessionsRequired === 'number'
								? data.totalSessionsRequired
								: data.totalSessionsRequired
									? Number(data.totalSessionsRequired)
									: undefined,
						remainingSessions:
							typeof data.remainingSessions === 'number'
								? data.remainingSessions
								: data.remainingSessions
									? Number(data.remainingSessions)
									: undefined,
						registeredAt: created ? created.toISOString() : (data.registeredAt as string | undefined) || new Date().toISOString(),
					} as AdminPatientRecord & { id: string; patientType?: string };
				});
				setPatients(mapped);
			},
			error => {
				console.error('Failed to load patients', error);
				setPatients([]);
			}
		);

		return () => unsubscribe();
	}, []);

	// Load appointments from Firestore
	useEffect(() => {
		const unsubscribe = onSnapshot(
			collection(db, 'appointments'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data() as Record<string, unknown>;
					const created = (data.createdAt as Timestamp | undefined)?.toDate?.();
					return {
						id: docSnap.id,
						appointmentId: data.appointmentId ? String(data.appointmentId) : '',
						patientId: data.patientId ? String(data.patientId) : '',
						patient: data.patient ? String(data.patient) : '',
						doctor: data.doctor ? String(data.doctor) : '',
						date: data.date ? String(data.date) : '',
						time: data.time ? String(data.time) : '',
						status: (data.status as string) ?? 'pending',
						billing: data.billing ? (data.billing as { amount?: string; date?: string }) : undefined,
						createdAt: created ? created.toISOString() : (data.createdAt as string | undefined) || new Date().toISOString(),
					} as AdminAppointmentRecord & { id: string };
				});
				setAppointments(mapped);
			},
			error => {
				console.error('Failed to load appointments', error);
				setAppointments([]);
			}
		);

		return () => unsubscribe();
	}, []);

	// Load staff from Firestore
	useEffect(() => {
		const unsubscribe = onSnapshot(
			collection(db, 'staff'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data() as Record<string, unknown>;
					return {
						id: docSnap.id,
						userName: data.userName ? String(data.userName) : '',
						role: data.role ? String(data.role) : '',
						status: data.status ? String(data.status) : '',
					} as StaffMember;
				});
				setStaff(mapped);
			},
			error => {
				console.error('Failed to load staff', error);
				setStaff([]);
			}
		);

		return () => unsubscribe();
	}, []);

	const doctorOptions = useMemo(() => {
		const set = new Set<string>();
		staff.forEach(member => {
			if (member.role === 'ClinicalTeam' && member.status !== 'Inactive' && member.userName) {
				set.add(member.userName);
			}
		});
		appointments.forEach(appointment => {
			if (appointment.doctor) set.add(appointment.doctor);
		});
		return Array.from(set).sort((a, b) => a.localeCompare(b));
	}, [staff, appointments]);

	// Clinician Performance Analytics
	const clinicianAnalytics = useMemo(() => {
		if (!selectedPhysician) {
			return {
				vipCount: 0,
				dyesCount: 0,
				othersCount: 0,
				totalPatients: 0,
				totalRevenue: 0,
			};
		}

		// Get all appointments for selected physician
		const physicianAppointments = appointments.filter(
			apt => apt.doctor?.toLowerCase() === selectedPhysician.toLowerCase()
		);

		// Get unique patient IDs for this physician
		const uniquePatientIds = new Set(physicianAppointments.map(apt => apt.patientId).filter(Boolean));

		// Get patients attended by this physician
		const physicianPatients = patients.filter(p => uniquePatientIds.has(p.patientId));

		// Count by patient type
		let vipCount = 0;
		let dyesCount = 0;
		let othersCount = 0;

		physicianPatients.forEach(patient => {
			const patientType = (patient as { patientType?: string }).patientType?.toUpperCase() || '';
			if (patientType === 'VIP') {
				vipCount++;
			} else if (patientType === 'DYES') {
				dyesCount++;
			} else {
				othersCount++;
			}
		});

		// Calculate total revenue from appointments with billing
		const totalRevenue = physicianAppointments.reduce((sum, apt) => {
			if (apt.billing?.amount) {
				const amount = Number(apt.billing.amount);
				return sum + (Number.isFinite(amount) ? amount : 0);
			}
			return sum;
		}, 0);

		return {
			vipCount,
			dyesCount,
			othersCount,
			totalPatients: uniquePatientIds.size,
			totalRevenue,
		};
	}, [selectedPhysician, appointments, patients]);

	const appointmentMap = useMemo(() => {
		const map = new Map<string, AdminAppointmentRecord[]>();
		for (const appointment of appointments) {
			if (!appointment.patientId) continue;
			if (!map.has(appointment.patientId)) {
				map.set(appointment.patientId, []);
			}
			map.get(appointment.patientId)?.push(appointment);
		}
		return map;
	}, [appointments]);

	const filteredRows = useMemo<PatientRow[]>(() => {
		const query = searchTerm.trim().toLowerCase();

		return patients
			.map<PatientRow | null>(patient => {
				const appts = appointmentMap.get(patient.patientId) ?? [];
				const doctors = Array.from(
					new Set(appts.map(appointment => appointment.doctor).filter(Boolean) as string[])
				);
				const status = patient.status;

				if (statusFilter !== 'all' && status !== statusFilter) return null;
				if (doctorFilter !== 'all' && !doctors.some(doc => doc.toLowerCase() === doctorFilter.toLowerCase())) {
					return null;
				}
				if (dateFilter !== 'all') {
					const within = appts.some(appointment => isWithinWindow(appointment.date, dateFilter));
					if (!within) return null;
				}
				if (query) {
					const matches =
						(patient.name || '').toLowerCase().includes(query) ||
						(patient.patientId || '').toLowerCase().includes(query) ||
						(patient.phone || '').toLowerCase().includes(query);
					if (!matches) return null;
				}

				return {
					patient,
					doctors,
					age: calculateAge(patient.dob),
					status,
				};
			})
			.filter((row): row is PatientRow => row !== null);
	}, [patients, appointmentMap, statusFilter, doctorFilter, dateFilter, searchTerm]);

	const summary = useMemo<SummaryCounts>(() => {
		return filteredRows.reduce<SummaryCounts>(
			(acc, row) => {
				acc.total += 1;
				acc[row.status] += 1;
				return acc;
			},
			{ total: 0, pending: 0, ongoing: 0, completed: 0, cancelled: 0 }
		);
	}, [filteredRows]);

	const chartData = useMemo(
		() => [
			{ label: 'Pending', value: summary.pending, color: 'bg-amber-400' },
			{ label: 'Ongoing', value: summary.ongoing, color: 'bg-sky-500' },
			{ label: 'Completed', value: summary.completed, color: 'bg-emerald-500' },
		],
		[summary]
	);

	const maxChartValue = useMemo(
		() => Math.max(...chartData.map(item => item.value), 1),
		[chartData]
	);

	const openModal = (row: PatientRow) => {
		setModalContext({ patient: row.patient, doctors: row.doctors });
		setIsModalOpen(true);
	};

	const closeModal = () => {
		setIsModalOpen(false);
		setModalContext(null);
	};

	const handleDelete = async (patientId: string) => {
		const confirmed = window.confirm(
			`Delete this patient record? This will also delete all appointments for this patient. This cannot be undone.`
		);
		if (!confirmed) return;
		const patient = patients.find(p => p.patientId === patientId && p.id);
		if (!patient?.id) return;
		try {
			// First, delete all appointments for this patient
			const appointmentsQuery = query(
				collection(db, 'appointments'),
				where('patientId', '==', patient.patientId)
			);
			const appointmentsSnapshot = await getDocs(appointmentsQuery);
			
			if (appointmentsSnapshot.docs.length > 0) {
				// Use batch write for better performance and atomicity
				const batch = writeBatch(db);
				appointmentsSnapshot.docs.forEach(appointmentDoc => {
					batch.delete(appointmentDoc.ref);
				});
				await batch.commit();
				console.log(`Deleted ${appointmentsSnapshot.docs.length} appointment(s) for patient ${patient.patientId}`);
			}

			// Then delete the patient
			await deleteDoc(doc(db, 'patients', patient.id));
		} catch (error) {
			console.error('Failed to delete patient', error);
			alert('Failed to delete patient. Please try again.');
		}
	};

	const handleViewStrengthConditioning = async (patient: AdminPatientRecord & { id?: string }) => {
		// Clean up previous subscription
		if (strengthConditioningUnsubscribeRef.current) {
			strengthConditioningUnsubscribeRef.current();
			strengthConditioningUnsubscribeRef.current = null;
		}
		
		// Use patient.id (Firestore document ID) as that's what clinical team uses
		// Fallback to patientId if id is not available
		const documentId = patient.id || patient.patientId;
		if (!documentId) {
			console.error('Patient ID not found');
			return;
		}
		
		setSelectedPatientForSC(patient);
		setLoadingStrengthConditioning(true);
		setStrengthConditioningData(null);
		try {
			const reportRef = doc(db, 'strengthConditioningReports', documentId);
			const unsubscribe = onSnapshot(reportRef, (docSnap) => {
				if (docSnap.exists()) {
					setStrengthConditioningData(docSnap.data() as StrengthConditioningData);
				} else {
					setStrengthConditioningData({});
				}
				setShowStrengthConditioningModal(true);
				setLoadingStrengthConditioning(false);
			}, (error) => {
				console.error('Error loading strength and conditioning report:', error);
				setStrengthConditioningData({});
				setShowStrengthConditioningModal(true);
				setLoadingStrengthConditioning(false);
			});
			
			strengthConditioningUnsubscribeRef.current = unsubscribe;
		} catch (error) {
			console.error('Failed to load strength and conditioning report', error);
			setStrengthConditioningData({});
			setShowStrengthConditioningModal(true);
			setLoadingStrengthConditioning(false);
		}
	};

	// Cleanup subscription when component unmounts
	useEffect(() => {
		return () => {
			if (strengthConditioningUnsubscribeRef.current) {
				strengthConditioningUnsubscribeRef.current();
				strengthConditioningUnsubscribeRef.current = null;
			}
		};
	}, []);

	const handleStrengthConditioningPrint = async () => {
		if (!selectedPatientForSC || !strengthConditioningData) return;
		try {
			await generateStrengthConditioningPDF({
				patient: {
					name: selectedPatientForSC.name,
					patientId: selectedPatientForSC.patientId,
					dob: selectedPatientForSC.dob,
					gender: selectedPatientForSC.gender,
					phone: selectedPatientForSC.phone,
					email: selectedPatientForSC.email,
				},
				formData: strengthConditioningData,
			}, { forPrint: true });
		} catch (error) {
			console.error('Failed to print strength and conditioning report', error);
			alert('Failed to print report. Please try again.');
		}
	};

	const handleStrengthConditioningDownload = async () => {
		if (!selectedPatientForSC || !strengthConditioningData) return;
		try {
			await generateStrengthConditioningPDF({
				patient: {
					name: selectedPatientForSC.name,
					patientId: selectedPatientForSC.patientId,
					dob: selectedPatientForSC.dob,
					gender: selectedPatientForSC.gender,
					phone: selectedPatientForSC.phone,
					email: selectedPatientForSC.email,
				},
				formData: strengthConditioningData,
			}, { forPrint: false });
		} catch (error) {
			console.error('Failed to download strength and conditioning report', error);
			alert('Failed to download report. Please try again.');
		}
	};

	const handlePrint = async () => {
		if (!modalContext) return;

		const patient = modalContext.patient;
		const age = calculateAge(patient.dob);
		await generatePhysiotherapyReportPDF({
			patientName: patient.name || '',
			patientId: patient.patientId || '',
			referredBy: modalContext.doctors.join(', ') || '',
			age: age || '',
			gender: patient.gender || '',
			dateOfConsultation: new Date().toISOString().split('T')[0],
			contact: patient.phone || '',
			email: patient.email || '',
			totalSessionsRequired: patient.totalSessionsRequired,
			remainingSessions: patient.remainingSessions,
			complaints: patient.complaint || '',
			presentHistory: '',
			pastHistory: '',
			surgicalHistory: '',
			medicalHistory: '',
			sleepCycle: '',
			hydration: '4',
			nutrition: '',
			chiefComplaint: patient.complaint || '',
			onsetType: '',
			duration: '',
			mechanismOfInjury: '',
			painType: '',
			painIntensity: '',
			aggravatingFactor: '',
			relievingFactor: '',
			siteSide: '',
			onset: '',
			natureOfInjury: '',
			typeOfPain: '',
			vasScale: '5',
			rom: {},
			mmt: {},
			built: '',
			posture: '',
			postureManualNotes: '',
			postureFileName: '',
			gaitAnalysis: '',
			gaitManualNotes: '',
			gaitFileName: '',
			mobilityAids: '',
			localObservation: '',
			swelling: '',
			muscleWasting: '',
			tenderness: '',
			warmth: '',
			scar: '',
			crepitus: '',
			odema: '',
			specialTest: '',
			differentialDiagnosis: '',
			finalDiagnosis: '',
			shortTermGoals: '',
			longTermGoals: '',
			rehabProtocol: '',
			advice: '',
			managementRemarks: '',
			nextFollowUpDate: '',
			nextFollowUpTime: '',
			followUpVisits: [],
			currentPainStatus: '',
			currentRom: '',
			currentStrength: '',
			currentFunctionalAbility: '',
			complianceWithHEP: '',
			physioName: '',
			physioRegNo: '',
			patientType: patient.patientType || '',
		}, { forPrint: true });
	};

	const handleDownloadPDF = async () => {
		if (!modalContext) return;

		const patient = modalContext.patient;
		const age = calculateAge(patient.dob);
		await generatePhysiotherapyReportPDF({
			patientName: patient.name || '',
			patientId: patient.patientId || '',
			referredBy: modalContext.doctors.join(', ') || '',
			age: age || '',
			gender: patient.gender || '',
			dateOfConsultation: new Date().toISOString().split('T')[0],
			contact: patient.phone || '',
			email: patient.email || '',
			complaints: patient.complaint || '',
			presentHistory: '',
			pastHistory: '',
			surgicalHistory: '',
			medicalHistory: '',
			sleepCycle: '',
			hydration: '4',
			nutrition: '',
			chiefComplaint: patient.complaint || '',
			onsetType: '',
			duration: '',
			mechanismOfInjury: '',
			painType: '',
			painIntensity: '',
			aggravatingFactor: '',
			relievingFactor: '',
			siteSide: '',
			onset: '',
			natureOfInjury: '',
			typeOfPain: '',
			vasScale: '5',
			rom: {},
			mmt: {},
			built: '',
			posture: '',
			postureManualNotes: '',
			postureFileName: '',
			gaitAnalysis: '',
			gaitManualNotes: '',
			gaitFileName: '',
			mobilityAids: '',
			localObservation: '',
			swelling: '',
			muscleWasting: '',
			tenderness: '',
			warmth: '',
			scar: '',
			crepitus: '',
			odema: '',
			specialTest: '',
			differentialDiagnosis: '',
			finalDiagnosis: '',
			shortTermGoals: '',
			longTermGoals: '',
			rehabProtocol: '',
			advice: '',
			managementRemarks: '',
			nextFollowUpDate: '',
			nextFollowUpTime: '',
			followUpVisits: [],
			currentPainStatus: '',
			currentRom: '',
			currentStrength: '',
			currentFunctionalAbility: '',
			complianceWithHEP: '',
			physioName: '',
			physioRegNo: '',
			patientType: patient.patientType || '',
		});
	};

	const handleExport = () => {
		if (!filteredRows.length) {
			alert('No data to export for the current filters.');
			return;
		}

		const rows = [
			['Patient ID', 'Name', 'Age', 'Gender', 'Complaint', 'Status', 'Doctors'].join(','),
			...filteredRows.map(row =>
				[
					row.patient.patientId ?? '',
					row.patient.name ?? '',
					row.age ?? '',
					row.patient.gender ?? '',
					row.patient.complaint ?? '',
					capitalize(row.status),
					row.doctors.join('; '),
				]
					.map(value => `"${String(value).replace(/"/g, '""')}"`)
					.join(',')
			),
		].join('\n');

		const blob = new Blob([rows], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);

		const link = document.createElement('a');
		link.href = url;
		link.setAttribute('download', `patient-reports-${new Date().toISOString().slice(0, 10)}.csv`);
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	};

	const handleExportClinicianAnalytics = () => {
		if (!doctorOptions.length) {
			alert('No physicians found to export analytics.');
			return;
		}

		const safe = (value: unknown) => {
			const str = value ?? '';
			return `"${String(str).replace(/"/g, '""')}"`;
		};

		// Build CSV content
		const rows: string[] = [];

		// Header row
		rows.push(
			[
				'Physician Name',
				'VIP Patients',
				'DYES Patients',
				'Other Patients',
				'Total Patients',
				'Total Revenue',
			].map(safe).join(',')
		);

		// Calculate analytics for each physician
		doctorOptions.forEach(physician => {
			// Get all appointments for this physician
			const physicianAppointments = appointments.filter(
				apt => apt.doctor?.toLowerCase() === physician.toLowerCase()
			);

			// Get unique patient IDs for this physician
			const uniquePatientIds = new Set(physicianAppointments.map(apt => apt.patientId).filter(Boolean));

			// Get patients attended by this physician
			const physicianPatients = patients.filter(p => uniquePatientIds.has(p.patientId));

			// Count by patient type
			let vipCount = 0;
			let dyesCount = 0;
			let othersCount = 0;

			physicianPatients.forEach(patient => {
				const patientType = (patient as { patientType?: string }).patientType?.toUpperCase() || '';
				if (patientType === 'VIP') {
					vipCount++;
				} else if (patientType === 'DYES') {
					dyesCount++;
				} else {
					othersCount++;
				}
			});

			// Calculate total revenue from appointments with billing
			const totalRevenue = physicianAppointments.reduce((sum, apt) => {
				if (apt.billing?.amount) {
					const amount = Number(apt.billing.amount);
					return sum + (Number.isFinite(amount) ? amount : 0);
				}
				return sum;
			}, 0);

			// Add row for this physician
			rows.push(
				[
					physician,
					vipCount.toString(),
					dyesCount.toString(),
					othersCount.toString(),
					uniquePatientIds.size.toString(),
					totalRevenue.toFixed(2),
				]
					.map(safe)
					.join(',')
			);
		});

		const csvContent = rows.join('\n');
		const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);

		const link = document.createElement('a');
		link.href = url;
		link.setAttribute('download', `clinician-performance-analytics-${new Date().toISOString().slice(0, 10)}.csv`);
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	};

	return (
		<div className="min-h-svh bg-slate-50 px-6 py-10">
			<div className="mx-auto max-w-6xl space-y-10">
				<PageHeader
					title="Patient Reports"
					description="View comprehensive patient reports and analytics across all registered patients."
					actions={
						<button
							type="button"
							onClick={handleExport}
							className="inline-flex items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900 focus-visible:border-slate-400 focus-visible:text-slate-900 focus-visible:outline-none"
						>
							<i className="fas fa-file-csv mr-2 text-sm" aria-hidden="true" />
							Export CSV
						</button>
					}
				/>

				<div className="border-t border-slate-200" />

				<section className="grid gap-4 text-center sm:grid-cols-2 lg:grid-cols-4">
				<div className="rounded-2xl bg-sky-600 p-6 text-white shadow-lg">
					<p className="text-sm uppercase tracking-wide text-white/80">Total Patients</p>
					<p className="mt-2 text-3xl font-semibold">{summary.total}</p>
				</div>
				<div className="rounded-2xl bg-amber-400 p-6 text-slate-900 shadow-lg">
					<p className="text-sm uppercase tracking-wide text-slate-900/80">Pending</p>
					<p className="mt-2 text-3xl font-semibold">{summary.pending}</p>
				</div>
				<div className="rounded-2xl bg-sky-500 p-6 text-white shadow-lg">
					<p className="text-sm uppercase tracking-wide text-white/80">Ongoing</p>
					<p className="mt-2 text-3xl font-semibold">{summary.ongoing}</p>
				</div>
				<div className="rounded-2xl bg-emerald-500 p-6 text-white shadow-lg">
					<p className="text-sm uppercase tracking-wide text-white/80">Completed</p>
					<p className="mt-2 text-3xl font-semibold">{summary.completed}</p>
				</div>
			</section>

			{/* Clinician Performance Analytics */}
			<section className="mx-auto mt-8 max-w-6xl rounded-2xl bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.07)]">
				<div className="mb-6 flex items-center justify-between">
					<h2 className="text-lg font-semibold text-slate-900">Clinician Performance Analytics</h2>
					<button
						type="button"
						onClick={handleExportClinicianAnalytics}
						className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900 focus-visible:border-slate-400 focus-visible:text-slate-900 focus-visible:outline-none"
					>
						<i className="fas fa-file-csv text-xs" aria-hidden="true" />
						Export CSV
					</button>
				</div>
				
				<div className="mb-6">
					<label className="block text-sm font-medium text-slate-700 mb-2">
						Select Physician
					</label>
					<select
						value={selectedPhysician}
						onChange={event => setSelectedPhysician(event.target.value)}
						className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
					>
						<option value="">Select a physician...</option>
						{doctorOptions.map(physician => (
							<option key={physician} value={physician}>
								{physician}
							</option>
						))}
					</select>
				</div>

				{selectedPhysician && (
					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
						{/* VIP Count */}
						<div className="rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50 to-purple-100 p-5 shadow-sm">
							<div className="flex items-center justify-between">
								<div>
									<p className="text-xs font-semibold uppercase tracking-wide text-purple-600">
										VIP Patients
									</p>
									<p className="mt-2 text-3xl font-bold text-purple-900">
										{clinicianAnalytics.vipCount}
									</p>
								</div>
								<div className="rounded-full bg-purple-200 p-3">
									<i className="fas fa-crown text-xl text-purple-600" aria-hidden="true" />
								</div>
							</div>
						</div>

						{/* DYES Count */}
						<div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-blue-100 p-5 shadow-sm">
							<div className="flex items-center justify-between">
								<div>
									<p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
										DYES Patients
									</p>
									<p className="mt-2 text-3xl font-bold text-blue-900">
										{clinicianAnalytics.dyesCount}
									</p>
								</div>
								<div className="rounded-full bg-blue-200 p-3">
									<i className="fas fa-users text-xl text-blue-600" aria-hidden="true" />
								</div>
							</div>
						</div>

						{/* Others Count */}
						<div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100 p-5 shadow-sm">
							<div className="flex items-center justify-between">
								<div>
									<p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
										Other Patients
									</p>
									<p className="mt-2 text-3xl font-bold text-slate-900">
										{clinicianAnalytics.othersCount}
									</p>
								</div>
								<div className="rounded-full bg-slate-200 p-3">
									<i className="fas fa-user-friends text-xl text-slate-600" aria-hidden="true" />
								</div>
							</div>
						</div>

						{/* Total Patients */}
						<div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-100 p-5 shadow-sm">
							<div className="flex items-center justify-between">
								<div>
									<p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
										Total Patients
									</p>
									<p className="mt-2 text-3xl font-bold text-emerald-900">
										{clinicianAnalytics.totalPatients}
									</p>
								</div>
								<div className="rounded-full bg-emerald-200 p-3">
									<i className="fas fa-user-check text-xl text-emerald-600" aria-hidden="true" />
								</div>
							</div>
						</div>

						{/* Total Revenue */}
						<div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-amber-100 p-5 shadow-sm">
							<div className="flex items-center justify-between">
								<div>
									<p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
										Total Revenue
									</p>
									<p className="mt-2 text-2xl font-bold text-amber-900">
										₹{clinicianAnalytics.totalRevenue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
									</p>
								</div>
								<div className="rounded-full bg-amber-200 p-3">
									<i className="fas fa-rupee-sign text-xl text-amber-600" aria-hidden="true" />
								</div>
							</div>
						</div>
					</div>
				)}

				{!selectedPhysician && (
					<div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center">
						<i className="fas fa-chart-line text-3xl text-slate-400 mb-3" aria-hidden="true" />
						<p className="text-sm text-slate-600">Select a physician to view performance analytics</p>
					</div>
				)}
			</section>

			<section className="mx-auto mt-8 grid max-w-6xl gap-4 md:grid-cols-[repeat(4,minmax(0,1fr))]">
				<div>
					<label className="block text-sm font-medium text-slate-700">Status</label>
					<select
						value={statusFilter}
						onChange={event => setStatusFilter(event.target.value as StatusFilter)}
						className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
					>
						{statusOptions.map(option => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</div>
				<div>
					<label className="block text-sm font-medium text-slate-700">Assigned Clinician</label>
					<select
						value={doctorFilter}
						onChange={event => setDoctorFilter(event.target.value)}
						className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
					>
						<option value="all">All Clinicians</option>
						{doctorOptions.map(option => (
							<option key={option} value={option}>
								{option}
							</option>
						))}
					</select>
				</div>
				<div>
					<label className="block text-sm font-medium text-slate-700">Date Range</label>
					<select
						value={dateFilter}
						onChange={event => setDateFilter(event.target.value as DateFilter)}
						className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
					>
						{dateRangeOptions.map(option => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</div>
				<div>
					<label className="block text-sm font-medium text-slate-700">Search</label>
					<input
						type="search"
						value={searchTerm}
						onChange={event => setSearchTerm(event.target.value)}
						placeholder="Patient name, ID, or phone"
						className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
					/>
				</div>
			</section>

			<section className="mx-auto mt-10 max-w-6xl rounded-2xl bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.07)]">
				<h2 className="text-lg font-semibold text-slate-900">Appointment Status Overview</h2>
				<div className="mt-6 flex h-48 items-end gap-6">
					{chartData.map(item => {
						const height = item.value === 0 ? 6 : Math.max((item.value / maxChartValue) * 100, 10);
						return (
							<div key={item.label} className="flex flex-1 flex-col items-center justify-end">
								<div className="flex h-full w-full max-w-[3.5rem] items-end justify-center">
									<div
										className={`${item.color} w-full rounded-t-lg`}
										style={{ height: `${height}%` }}
									/>
								</div>
								<p className="mt-3 text-sm font-medium text-slate-700">{item.label}</p>
								<p className="text-xs text-slate-500">{item.value}</p>
							</div>
						);
					})}
				</div>
			</section>

			<section className="mx-auto mt-8 max-w-6xl overflow-hidden rounded-2xl bg-white shadow-[0_18px_40px_rgba(15,23,42,0.07)]">
				<div className="overflow-x-auto">
					<table className="min-w-full divide-y divide-slate-200 text-left text-sm text-slate-700">
						<thead className="bg-slate-900 text-xs uppercase tracking-wide text-white">
							<tr>
								<th className="px-4 py-3 font-semibold">Patient ID</th>
								<th className="px-4 py-3 font-semibold">Name</th>
								<th className="px-4 py-3 font-semibold">Age</th>
								<th className="px-4 py-3 font-semibold">Gender</th>
								<th className="px-4 py-3 font-semibold">Complaint</th>
								<th className="px-4 py-3 font-semibold">Status</th>
								<th className="px-4 py-3 font-semibold">Clinicians</th>
								<th className="px-4 py-3 font-semibold text-right">Actions</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-100">
							{filteredRows.length === 0 ? (
								<tr>
									<td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
										No patients match the current filters.
									</td>
								</tr>
							) : (
								filteredRows.map(row => (
									<tr key={(row.patient as AdminPatientRecord & { id?: string }).id ?? row.patient.patientId}>
										<td className="px-4 py-4 font-medium text-slate-800">{row.patient.patientId}</td>
										<td className="px-4 py-4 text-slate-700">{row.patient.name}</td>
										<td className="px-4 py-4 text-slate-600">{row.age}</td>
										<td className="px-4 py-4 text-slate-600">{row.patient.gender || '—'}</td>
										<td className="px-4 py-4 text-slate-600">{row.patient.complaint || '—'}</td>
										<td className="px-4 py-4">
											<span
												className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${statusBadgeClasses[row.status]}`}
											>
												{capitalize(row.status)}
											</span>
										</td>
										<td className="px-4 py-4 text-slate-600">
											{row.doctors.length ? row.doctors.join(', ') : 'N/A'}
										</td>
										<td className="px-4 py-4 text-right text-sm">
											<button
												type="button"
												onClick={() => openModal(row)}
												className="inline-flex items-center rounded-full border border-sky-200 px-3 py-1 text-xs font-semibold text-sky-700 transition hover:border-sky-400 hover:text-sky-800 focus-visible:border-sky-400 focus-visible:text-sky-800 focus-visible:outline-none"
											>
												<i className="fas fa-eye mr-1 text-[11px]" aria-hidden="true" />
												View
											</button>
											<button
												type="button"
												onClick={() => handleViewStrengthConditioning(row.patient)}
												className="ml-2 inline-flex items-center rounded-full border border-sky-200 px-3 py-1 text-xs font-semibold text-sky-700 transition hover:border-sky-400 hover:text-sky-800 focus-visible:border-sky-400 focus-visible:text-sky-800 focus-visible:outline-none"
											>
												<i className="fas fa-dumbbell mr-1 text-[11px]" aria-hidden="true" />
												S&C
											</button>
											<button
												type="button"
												onClick={() => handleDelete(row.patient.patientId)}
												className="ml-2 inline-flex items-center rounded-full border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-600 transition hover:border-rose-400 hover:text-rose-700 focus-visible:border-rose-400 focus-visible:text-rose-700 focus-visible:outline-none"
											>
												<i className="fas fa-trash mr-1 text-[11px]" aria-hidden="true" />
												Delete
											</button>
										</td>
									</tr>
								))
							)}
						</tbody>
					</table>
				</div>
			</section>

			{isModalOpen && modalContext && (
				<div
					role="dialog"
					aria-modal="true"
					className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6"
				>
					<div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
						<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
							<h2 className="text-lg font-semibold text-slate-900">Patient Details</h2>
							<button
								type="button"
								onClick={closeModal}
								className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:bg-slate-100 focus-visible:text-slate-600 focus-visible:outline-none"
								aria-label="Close dialog"
							>
								<i className="fas fa-times" aria-hidden="true" />
							</button>
						</header>
						<div className="space-y-3 px-6 py-6 text-sm text-slate-700">
							<p>
								<strong>Patient ID:</strong> {modalContext.patient.patientId}
							</p>
							<p>
								<strong>Name:</strong> {modalContext.patient.name}
							</p>
							<p>
								<strong>Age:</strong> {calculateAge(modalContext.patient.dob) || '—'}
							</p>
							<p>
								<strong>Gender:</strong> {modalContext.patient.gender || '—'}
							</p>
							<p>
								<strong>Complaint:</strong> {modalContext.patient.complaint || '—'}
							</p>
							<p>
								<strong>Status:</strong> {capitalize(modalContext.patient.status)}
							</p>
							<p>
								<strong>Clinicians:</strong>{' '}
								{modalContext.doctors.length ? modalContext.doctors.join(', ') : 'N/A'}
							</p>
						</div>
						<footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
							<button
								type="button"
								onClick={handleDownloadPDF}
								className="inline-flex items-center rounded-lg border border-sky-600 px-4 py-2 text-sm font-semibold text-sky-600 transition hover:bg-sky-50 focus-visible:outline-none"
							>
								<i className="fas fa-download mr-2" aria-hidden="true" />
								Download PDF
							</button>
							<button
								type="button"
								onClick={handlePrint}
								className="inline-flex items-center rounded-lg border border-sky-600 px-4 py-2 text-sm font-semibold text-sky-600 transition hover:bg-sky-50 focus-visible:outline-none"
							>
								<i className="fas fa-print mr-2" aria-hidden="true" />
								Print Report
							</button>
							<button
								type="button"
								onClick={closeModal}
								className="inline-flex items-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800 focus-visible:border-slate-300 focus-visible:text-slate-800 focus-visible:outline-none"
							>
								Close
							</button>
						</footer>
					</div>
				</div>
			)}

			{/* Strength & Conditioning Report Modal */}
			{showStrengthConditioningModal && selectedPatientForSC && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
					<div className="flex w-full max-w-5xl max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
						<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
							<h2 className="text-lg font-semibold text-slate-900">
								Strength & Conditioning Report - {selectedPatientForSC.name} ({selectedPatientForSC.patientId})
							</h2>
							<button
								type="button"
								onClick={() => {
									setShowStrengthConditioningModal(false);
									setStrengthConditioningData(null);
									setSelectedPatientForSC(null);
									if (strengthConditioningUnsubscribeRef.current) {
										strengthConditioningUnsubscribeRef.current();
										strengthConditioningUnsubscribeRef.current = null;
									}
								}}
								className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none"
								aria-label="Close"
							>
								<i className="fas fa-times" aria-hidden="true" />
							</button>
						</header>
						<div className="flex-1 overflow-y-auto p-6">
							{loadingStrengthConditioning ? (
								<div className="text-center py-12">
									<div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-sky-600 border-r-transparent"></div>
									<p className="mt-4 text-sm text-slate-600">Loading report...</p>
								</div>
							) : !strengthConditioningData || Object.keys(strengthConditioningData).length === 0 ? (
								<div className="text-center py-12">
									<p className="text-slate-600">No Strength & Conditioning report available for this patient.</p>
								</div>
							) : (
								<div className="space-y-6">
									{/* Patient Information */}
									<div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
										<h3 className="mb-3 text-sm font-semibold text-slate-900">Patient Information</h3>
										<div className="grid gap-3 sm:grid-cols-2">
											<div>
												<span className="text-xs text-slate-500">Name:</span>
												<p className="text-sm font-medium text-slate-900">{selectedPatientForSC.name || '—'}</p>
											</div>
											<div>
												<span className="text-xs text-slate-500">Patient ID:</span>
												<p className="text-sm font-medium text-slate-900">{selectedPatientForSC.patientId || '—'}</p>
											</div>
											<div>
												<span className="text-xs text-slate-500">Date of Birth:</span>
												<p className="text-sm font-medium text-slate-900">{selectedPatientForSC.dob || '—'}</p>
											</div>
											<div>
												<span className="text-xs text-slate-500">Gender:</span>
												<p className="text-sm font-medium text-slate-900">{selectedPatientForSC.gender || '—'}</p>
											</div>
											<div>
												<span className="text-xs text-slate-500">Phone:</span>
												<p className="text-sm font-medium text-slate-900">{selectedPatientForSC.phone || '—'}</p>
											</div>
											<div>
												<span className="text-xs text-slate-500">Email:</span>
												<p className="text-sm font-medium text-slate-900">{selectedPatientForSC.email || '—'}</p>
											</div>
										</div>
										{strengthConditioningData.therapistName && (
											<div className="mt-3">
												<span className="text-xs text-slate-500">Therapist:</span>
												<p className="text-sm font-medium text-slate-900">{strengthConditioningData.therapistName}</p>
											</div>
										)}
									</div>

									{/* Injury Risk Screening - Same structure as frontdesk */}
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
							)}
						</div>
						<footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
							<button
								type="button"
								onClick={() => {
									setShowStrengthConditioningModal(false);
									setStrengthConditioningData(null);
									setSelectedPatientForSC(null);
									if (strengthConditioningUnsubscribeRef.current) {
										strengthConditioningUnsubscribeRef.current();
										strengthConditioningUnsubscribeRef.current = null;
									}
								}}
								className="inline-flex items-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800 focus-visible:outline-none"
							>
								Close
							</button>
							{strengthConditioningData && Object.keys(strengthConditioningData).length > 0 && (
								<>
									<button
										type="button"
										onClick={handleStrengthConditioningDownload}
										className="inline-flex items-center rounded-lg border border-sky-600 px-4 py-2 text-sm font-semibold text-sky-600 transition hover:bg-sky-50 focus-visible:outline-none"
									>
										<i className="fas fa-download mr-2" aria-hidden="true" />
										Download PDF
									</button>
									<button
										type="button"
										onClick={handleStrengthConditioningPrint}
										className="inline-flex items-center rounded-lg border border-sky-600 px-4 py-2 text-sm font-semibold text-sky-600 transition hover:bg-sky-50 focus-visible:outline-none"
									>
										<i className="fas fa-print mr-2" aria-hidden="true" />
										Print Report
									</button>
								</>
							)}
						</footer>
					</div>
				</div>
			)}
			</div>
		</div>
	);
}


