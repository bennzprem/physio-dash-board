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
import StatsChart from '@/components/dashboard/StatsChart';
import { generatePhysiotherapyReportPDF, generateStrengthConditioningPDF, type StrengthConditioningData } from '@/lib/pdfGenerator';

interface StaffMember {
	id: string;
	userName: string;
	role: string;
	status: string;
	profileImage?: string;
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

interface BillingRecord {
	id?: string;
	billingId: string;
	appointmentId?: string;
	patient: string;
	patientId: string;
	doctor?: string;
	amount: number;
	status: 'Pending' | 'Completed' | 'Auto-Paid';
	date: string;
}

export default function Reports() {
	const [patients, setPatients] = useState<(AdminPatientRecord & { id?: string })[]>([]);
	const [appointments, setAppointments] = useState<(AdminAppointmentRecord & { id?: string })[]>([]);
	const [staff, setStaff] = useState<StaffMember[]>([]);
	const [billing, setBilling] = useState<BillingRecord[]>([]);

	const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
	const [doctorFilter, setDoctorFilter] = useState<'all' | string>('all');
	const [dateFilter, setDateFilter] = useState<DateFilter>('all');
	const [searchTerm, setSearchTerm] = useState('');
	const [organizationTimeFilter, setOrganizationTimeFilter] = useState<'today' | 'weekly' | 'monthly' | 'overall'>('overall');
	const [hoveredCard, setHoveredCard] = useState<string | null>(null);
	const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null);
	const [analyticsFromDate, setAnalyticsFromDate] = useState<string>('');
	const [analyticsToDate, setAnalyticsToDate] = useState<string>('');

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
						department: data.department ? String(data.department) : undefined,
						typeOfOrganization: data.typeOfOrganization ? String(data.typeOfOrganization) : undefined,
					} as AdminPatientRecord & { id: string; patientType?: string; department?: string; typeOfOrganization?: string };
				});
				// Force update by creating a new array reference
				setPatients([...mapped]);
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
				// Force update by creating a new array reference
				setAppointments([...mapped]);
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
						profileImage: data.profileImage ? String(data.profileImage) : undefined,
					} as StaffMember;
				});
				// Force update by creating a new array reference
				setStaff([...mapped]);
			},
			error => {
				console.error('Failed to load staff', error);
				setStaff([]);
			}
		);

		return () => unsubscribe();
	}, []);

	// Load billing from Firestore
	useEffect(() => {
		const unsubscribe = onSnapshot(
			collection(db, 'billing'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data() as Record<string, unknown>;
					return {
						id: docSnap.id,
						billingId: data.billingId ? String(data.billingId) : '',
						appointmentId: data.appointmentId ? String(data.appointmentId) : undefined,
						patient: data.patient ? String(data.patient) : '',
						patientId: data.patientId ? String(data.patientId) : '',
						doctor: data.doctor ? String(data.doctor) : undefined,
						amount: typeof data.amount === 'number' ? data.amount : Number(data.amount) || 0,
						status: (data.status as 'Pending' | 'Completed' | 'Auto-Paid') ?? 'Pending',
						date: data.date ? String(data.date) : '',
					} as BillingRecord;
				});
				// Force update by creating a new array reference
				setBilling([...mapped]);
			},
			error => {
				console.error('Failed to load billing', error);
				setBilling([]);
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
				totalHours: 0,
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

		// Calculate total hours (assuming 1 hour per appointment, or calculate from time if available)
		const totalHours = physicianAppointments.length; // Assuming 1 hour per appointment

		return {
			vipCount,
			dyesCount,
			othersCount,
			totalPatients: uniquePatientIds.size,
			totalRevenue,
			totalHours,
		};
	}, [selectedPhysician, appointments, patients]);

	// Activities and Appointments Distribution by Clinical Team (Pie Chart Data)
	const activitiesDistributionData = useMemo(() => {
		const clinicalTeamMembers = staff.filter(
			member => 
				(member.role === 'ClinicalTeam' || member.role === 'Physiotherapist' || member.role === 'StrengthAndConditioning') &&
				member.status === 'Active'
		);

		const distribution = clinicalTeamMembers.map(member => {
			const memberAppointments = appointments.filter(
				apt => apt.doctor?.toLowerCase() === member.userName.toLowerCase() && apt.status !== 'cancelled'
			);
			return {
				name: member.userName,
				count: memberAppointments.length,
			};
		}).filter(item => item.count > 0).sort((a, b) => b.count - a.count);

		// Generate gradient colors for pie chart
		const gradientColors = distribution.map((_, index) => {
			const hue = (index * 137.508) % 360;
			return `hsl(${hue}, 70%, 60%)`;
		});

		return {
			labels: distribution.map(item => item.name || 'Unassigned'),
			datasets: [
				{
					label: 'Appointments',
					data: distribution.map(item => item.count),
					backgroundColor: gradientColors,
					borderColor: '#ffffff',
					borderWidth: 2,
				},
			],
		};
	}, [staff, appointments]);

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
		let rowsToUse = filteredRows;

		// Apply date range filter if set
		if (analyticsFromDate || analyticsToDate) {
			rowsToUse = filteredRows.filter(row => {
				const patient = row.patient;
				const registeredAt = patient.registeredAt;
				if (!registeredAt) return false;

				let registeredDate: Date;
				if (typeof registeredAt === 'string') {
					registeredDate = new Date(registeredAt);
				} else if (registeredAt && typeof registeredAt === 'object' && 'toDate' in registeredAt) {
					// Firestore Timestamp object
					registeredDate = (registeredAt as Timestamp).toDate();
				} else {
					// Fallback: try to create Date from the value
					registeredDate = new Date(String(registeredAt));
				}

				if (isNaN(registeredDate.getTime())) return false;

				// Set time to start of day for comparison
				const regDate = new Date(registeredDate);
				regDate.setHours(0, 0, 0, 0);

				if (analyticsFromDate) {
					const fromDate = new Date(analyticsFromDate);
					fromDate.setHours(0, 0, 0, 0);
					if (regDate < fromDate) return false;
				}

				if (analyticsToDate) {
					const toDate = new Date(analyticsToDate);
					toDate.setHours(23, 59, 59, 999);
					if (regDate > toDate) return false;
				}

				return true;
			});
		}

		return rowsToUse.reduce<SummaryCounts>(
			(acc, row) => {
				acc.total += 1;
				acc[row.status] += 1;
				return acc;
			},
			{ total: 0, pending: 0, ongoing: 0, completed: 0, cancelled: 0 }
		);
	}, [filteredRows, analyticsFromDate, analyticsToDate]);

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

	// Clinical Team vs Total Patients Graph Data
	const clinicalTeamData = useMemo(() => {
		const clinicalTeamMembers = staff.filter(
			member => 
				(member.role === 'ClinicalTeam' || member.role === 'Physiotherapist' || member.role === 'StrengthAndConditioning') &&
				member.status === 'Active'
		);

		// Filter appointments by date range if set
		let filteredAppointments = appointments;
		if (analyticsFromDate || analyticsToDate) {
			filteredAppointments = appointments.filter(apt => {
				if (!apt.date) return false;
				const aptDate = new Date(apt.date);
				if (isNaN(aptDate.getTime())) return false;

				const aptDateOnly = new Date(aptDate);
				aptDateOnly.setHours(0, 0, 0, 0);

				if (analyticsFromDate) {
					const fromDate = new Date(analyticsFromDate);
					fromDate.setHours(0, 0, 0, 0);
					if (aptDateOnly < fromDate) return false;
				}

				if (analyticsToDate) {
					const toDate = new Date(analyticsToDate);
					toDate.setHours(23, 59, 59, 999);
					if (aptDateOnly > toDate) return false;
				}

				return true;
			});
		}

		const teamPatientCounts = clinicalTeamMembers.map(member => {
			const memberAppointments = filteredAppointments.filter(
				apt => apt.doctor?.toLowerCase() === member.userName.toLowerCase()
			);
			// Get unique patient IDs from appointments within the date range
			const uniquePatientIds = new Set(memberAppointments.map(apt => apt.patientId).filter(Boolean));
			return {
				name: member.userName,
				count: uniquePatientIds.size,
			};
		}).sort((a, b) => b.count - a.count);

		// Generate gradient colors for each bar (using HSL for variety)
		const gradientColors = teamPatientCounts.map((_, index) => {
			const hue = (index * 137.508) % 360; // Golden angle for color distribution
			return `hsl(${hue}, 70%, 60%)`;
		});

		// Generate lighter colors for gradient effect
		const lighterColors = teamPatientCounts.map((_, index) => {
			const hue = (index * 137.508) % 360;
			return `hsl(${hue}, 70%, 70%)`;
		});

		return {
			labels: teamPatientCounts.map(item => item.name || 'Unassigned'),
			datasets: [
				{
					label: 'Total Patients',
					data: teamPatientCounts.map(item => item.count),
					backgroundColor: gradientColors,
					borderColor: lighterColors,
					borderWidth: 2,
				},
			],
		};
	}, [staff, appointments, analyticsFromDate, analyticsToDate]);

	// Organization-based Graph Data with time filters
	const organizationData = useMemo(() => {
		const organizationCounts = new Map<string, number>();
		const now = new Date();
		let startDate: Date | null = null;

		// Calculate start date based on filter
		if (organizationTimeFilter === 'today') {
			startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		} else if (organizationTimeFilter === 'weekly') {
			startDate = new Date(now);
			startDate.setDate(now.getDate() - 7);
		} else if (organizationTimeFilter === 'monthly') {
			startDate = new Date(now);
			startDate.setMonth(now.getMonth() - 1);
		}
		// 'overall' means no date filter

		patients.forEach(patient => {
			// Check date filter if applicable
			if (startDate && patient.registeredAt) {
				const registeredDate = new Date(patient.registeredAt);
				if (registeredDate < startDate) {
					return; // Skip patients registered before the filter date
				}
			}

			// Get organization from typeOfOrganization or patientType
			const org = (patient as { typeOfOrganization?: string; patientType?: string }).typeOfOrganization || 
				(patient as { typeOfOrganization?: string; patientType?: string }).patientType || 
				'Unassigned';
			organizationCounts.set(org, (organizationCounts.get(org) || 0) + 1);
		});

		const sortedOrgs = Array.from(organizationCounts.entries())
			.map(([org, count]) => ({ org, count }))
			.sort((a, b) => b.count - a.count);

		// Generate gradient colors for each organization (offset hue for variety)
		const gradientColors = sortedOrgs.map((_, index) => {
			const hue = (index * 137.508 + 180) % 360; // Offset hue for variety
			return `hsl(${hue}, 65%, 55%)`;
		});

		// Generate lighter colors for gradient effect
		const lighterColors = sortedOrgs.map((_, index) => {
			const hue = (index * 137.508 + 180) % 360;
			return `hsl(${hue}, 65%, 65%)`;
		});

		return {
			labels: sortedOrgs.map(item => item.org),
			datasets: [
				{
					label: 'Patients by Organization',
					data: sortedOrgs.map(item => item.count),
					backgroundColor: gradientColors,
					borderColor: lighterColors,
					borderWidth: 2,
				},
			],
		};
	}, [patients, organizationTimeFilter]);

	// Revenue vs Clinical Team Graph Data (based on billing totals)
	const revenueTeamData = useMemo(() => {
		const clinicalTeamMembers = staff.filter(
			member => 
				(member.role === 'ClinicalTeam' || member.role === 'Physiotherapist' || member.role === 'StrengthAndConditioning') &&
				member.status === 'Active'
		);

		// Filter billing by date range if set
		let filteredBilling = billing;
		if (analyticsFromDate || analyticsToDate) {
			filteredBilling = billing.filter(bill => {
				if (!bill.date) return false;
				const billDate = new Date(bill.date);
				if (isNaN(billDate.getTime())) return false;

				const billDateOnly = new Date(billDate);
				billDateOnly.setHours(0, 0, 0, 0);

				if (analyticsFromDate) {
					const fromDate = new Date(analyticsFromDate);
					fromDate.setHours(0, 0, 0, 0);
					if (billDateOnly < fromDate) return false;
				}

				if (analyticsToDate) {
					const toDate = new Date(analyticsToDate);
					toDate.setHours(23, 59, 59, 999);
					if (billDateOnly > toDate) return false;
				}

				return true;
			});
		}

		const teamRevenue = clinicalTeamMembers.map(member => {
			// Calculate total revenue from billing records for this member
			// Include both 'Completed' and 'Auto-Paid' statuses as they represent actual revenue
			const memberBilling = filteredBilling.filter(bill => {
				const doctorMatch = bill.doctor?.toLowerCase().trim() === member.userName.toLowerCase().trim() ||
					bill.doctor?.toLowerCase().trim() === member.userName?.toLowerCase().trim();
				const statusMatch = bill.status === 'Completed' || bill.status === 'Auto-Paid';
				return doctorMatch && statusMatch;
			});
			
			const totalRevenue = memberBilling.reduce((sum, bill) => {
				const amount = Number.isFinite(bill.amount) ? bill.amount : 0;
				return sum + (amount > 0 ? amount : 0);
			}, 0);

			return {
				name: member.userName,
				revenue: totalRevenue,
				profileImage: member.profileImage,
			};
		}).sort((a, b) => b.revenue - a.revenue); // Show all members, even with 0 revenue

		// Generate gradient colors for each bar (offset hue for variety)
		const gradientColors = teamRevenue.map((_, index) => {
			const hue = (index * 137.508 + 90) % 360; // Offset hue for variety
			return `hsl(${hue}, 65%, 55%)`;
		});

		// Generate lighter colors for gradient effect
		const lighterColors = teamRevenue.map((_, index) => {
			const hue = (index * 137.508 + 90) % 360;
			return `hsl(${hue}, 65%, 65%)`;
		});

		return {
			labels: teamRevenue.map(item => item.name || 'Unassigned'),
			profileImages: teamRevenue.map(item => item.profileImage),
			datasets: [
				{
					label: 'Revenue (₹)',
					data: teamRevenue.map(item => item.revenue),
					backgroundColor: gradientColors,
					borderColor: lighterColors,
					borderWidth: 2,
					// Increase bar thickness and spacing for better visibility
					barThickness: 'flex' as const,
					maxBarThickness: 60, // Maximum bar height in pixels (thicker bars)
					categoryPercentage: 0.85, // 85% of available space for categories (more spacing between bars)
					barPercentage: 0.9, // 90% of category space for bars (thicker bars)
				},
			],
		};
	}, [staff, billing, analyticsFromDate, analyticsToDate]);

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
			history: (patient as any).history || ((patient as any).presentHistory || '') + ((patient as any).pastHistory ? '\n' + (patient as any).pastHistory : ''),
			surgicalHistory: '',
			medicalHistory: '',
			sleepCycle: '',
			hydration: '4',
			nutrition: '',
			chiefComplaint: patient.complaint || '',
			duration: '',
			mechanismOfInjury: '',
			painType: '',
			painIntensity: '',
			aggravatingFactor: '',
			relievingFactor: '',
			siteSide: '',
			onset: '',
			natureOfInjury: '',
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
			finalDiagnosis: '',
			shortTermGoals: '',
			longTermGoals: '',
			treatment: '',
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
			history: (patient as any).history || ((patient as any).presentHistory || '') + ((patient as any).pastHistory ? '\n' + (patient as any).pastHistory : ''),
			surgicalHistory: '',
			medicalHistory: '',
			sleepCycle: '',
			hydration: '4',
			nutrition: '',
			chiefComplaint: patient.complaint || '',
			duration: '',
			mechanismOfInjury: '',
			painType: '',
			painIntensity: '',
			aggravatingFactor: '',
			relievingFactor: '',
			siteSide: '',
			onset: '',
			natureOfInjury: '',
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
			finalDiagnosis: '',
			shortTermGoals: '',
			longTermGoals: '',
			treatment: '',
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
					title="Analytics"
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

				{/* Date Range Filter for Analytics */}
				<div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
					<div className="flex items-center gap-4 flex-wrap">
						<label className="text-sm font-medium text-slate-700 whitespace-nowrap">
							Filter by Date Range:
						</label>
						<div className="flex items-center gap-3 flex-wrap">
							<div className="flex items-center gap-2">
								<label htmlFor="analyticsFromDate" className="text-sm text-slate-600 whitespace-nowrap">
									From:
								</label>
								<input
									type="date"
									id="analyticsFromDate"
									value={analyticsFromDate}
									onChange={e => {
										const date = e.target.value;
										setAnalyticsFromDate(date);
										if (analyticsToDate && date > analyticsToDate) {
											setAnalyticsToDate(date);
										}
									}}
									max={analyticsToDate || new Date().toISOString().split('T')[0]}
									className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
								/>
							</div>
							<div className="flex items-center gap-2">
								<label htmlFor="analyticsToDate" className="text-sm text-slate-600 whitespace-nowrap">
									To:
								</label>
								<input
									type="date"
									id="analyticsToDate"
									value={analyticsToDate}
									onChange={e => {
										const date = e.target.value;
										setAnalyticsToDate(date);
										if (analyticsFromDate && date < analyticsFromDate) {
											setAnalyticsFromDate(date);
										}
									}}
									min={analyticsFromDate || undefined}
									max={new Date().toISOString().split('T')[0]}
									className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
								/>
							</div>
							{(analyticsFromDate || analyticsToDate) && (
								<button
									type="button"
									onClick={() => {
										setAnalyticsFromDate('');
										setAnalyticsToDate('');
									}}
									className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
								>
									Clear
								</button>
							)}
						</div>
					</div>
					{(analyticsFromDate || analyticsToDate) && (
						<p className="mt-2 text-xs text-slate-500">
							Showing analytics for: {analyticsFromDate ? new Date(analyticsFromDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'All time'} 
							{' - '}
							{analyticsToDate ? new Date(analyticsToDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Today'}
						</p>
					)}
				</div>

				<div className="border-t border-slate-200" />

				<section className="grid gap-4 text-center sm:grid-cols-2 lg:grid-cols-4 relative">
				<div 
					className="group relative rounded-2xl bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-700 p-6 text-white shadow-lg transition-all duration-300 hover:scale-105 hover:shadow-2xl cursor-pointer"
					onMouseEnter={(e) => {
						setHoveredCard('total');
						const rect = e.currentTarget.getBoundingClientRect();
						setTooltipPosition({ x: rect.left + rect.width / 2, y: rect.top - 10 });
					}}
					onMouseLeave={() => {
						setHoveredCard(null);
						setTooltipPosition(null);
					}}
				>
					<p className="text-sm uppercase tracking-wide text-white/80">Total Patients</p>
					<p className="mt-2 text-3xl font-semibold">{summary.total}</p>
					<div className="absolute inset-0 rounded-2xl bg-white/0 transition-all duration-300 group-hover:bg-white/10" />
					{hoveredCard === 'total' && tooltipPosition && (
						<div 
							className="fixed z-50 px-4 py-2 bg-slate-900 text-white text-sm rounded-lg shadow-xl pointer-events-none whitespace-nowrap transform -translate-x-1/2 -translate-y-full mb-2"
							style={{ left: `${tooltipPosition.x}px`, top: `${tooltipPosition.y}px` }}
						>
							Total of {summary.total} registered patients in the system
							<div className="absolute left-1/2 top-full transform -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
				</div>
					)}
				</div>
				<div 
					className="group relative rounded-2xl bg-gradient-to-br from-amber-400 via-orange-500 to-red-500 p-6 text-white shadow-lg transition-all duration-300 hover:scale-105 hover:shadow-2xl cursor-pointer"
					onMouseEnter={(e) => {
						setHoveredCard('pending');
						const rect = e.currentTarget.getBoundingClientRect();
						setTooltipPosition({ x: rect.left + rect.width / 2, y: rect.top - 10 });
					}}
					onMouseLeave={() => {
						setHoveredCard(null);
						setTooltipPosition(null);
					}}
				>
					<p className="text-sm uppercase tracking-wide text-white/90">Pending</p>
					<p className="mt-2 text-3xl font-semibold">{summary.pending}</p>
					<div className="absolute inset-0 rounded-2xl bg-white/0 transition-all duration-300 group-hover:bg-white/10" />
					{hoveredCard === 'pending' && tooltipPosition && (
						<div 
							className="fixed z-50 px-4 py-2 bg-slate-900 text-white text-sm rounded-lg shadow-xl pointer-events-none whitespace-nowrap transform -translate-x-1/2 -translate-y-full mb-2"
							style={{ left: `${tooltipPosition.x}px`, top: `${tooltipPosition.y}px` }}
						>
							{summary.pending} patients awaiting confirmation or scheduling
							<div className="absolute left-1/2 top-full transform -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
				</div>
					)}
				</div>
				<div 
					className="group relative rounded-2xl bg-gradient-to-br from-cyan-400 via-sky-500 to-blue-600 p-6 text-white shadow-lg transition-all duration-300 hover:scale-105 hover:shadow-2xl cursor-pointer"
					onMouseEnter={(e) => {
						setHoveredCard('ongoing');
						const rect = e.currentTarget.getBoundingClientRect();
						setTooltipPosition({ x: rect.left + rect.width / 2, y: rect.top - 10 });
					}}
					onMouseLeave={() => {
						setHoveredCard(null);
						setTooltipPosition(null);
					}}
				>
					<p className="text-sm uppercase tracking-wide text-white/80">Ongoing</p>
					<p className="mt-2 text-3xl font-semibold">{summary.ongoing}</p>
					<div className="absolute inset-0 rounded-2xl bg-white/0 transition-all duration-300 group-hover:bg-white/10" />
					{hoveredCard === 'ongoing' && tooltipPosition && (
						<div 
							className="fixed z-50 px-4 py-2 bg-slate-900 text-white text-sm rounded-lg shadow-xl pointer-events-none whitespace-nowrap transform -translate-x-1/2 -translate-y-full mb-2"
							style={{ left: `${tooltipPosition.x}px`, top: `${tooltipPosition.y}px` }}
						>
							{summary.ongoing} patients currently in active treatment
							<div className="absolute left-1/2 top-full transform -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
				</div>
					)}
				</div>
				<div 
					className="group relative rounded-2xl bg-gradient-to-br from-emerald-400 via-green-500 to-teal-600 p-6 text-white shadow-lg transition-all duration-300 hover:scale-105 hover:shadow-2xl cursor-pointer"
					onMouseEnter={(e) => {
						setHoveredCard('completed');
						const rect = e.currentTarget.getBoundingClientRect();
						setTooltipPosition({ x: rect.left + rect.width / 2, y: rect.top - 10 });
					}}
					onMouseLeave={() => {
						setHoveredCard(null);
						setTooltipPosition(null);
					}}
				>
					<p className="text-sm uppercase tracking-wide text-white/80">Completed</p>
					<p className="mt-2 text-3xl font-semibold">{summary.completed}</p>
					<div className="absolute inset-0 rounded-2xl bg-white/0 transition-all duration-300 group-hover:bg-white/10" />
					{hoveredCard === 'completed' && tooltipPosition && (
						<div 
							className="fixed z-50 px-4 py-2 bg-slate-900 text-white text-sm rounded-lg shadow-xl pointer-events-none whitespace-nowrap transform -translate-x-1/2 -translate-y-full mb-2"
							style={{ left: `${tooltipPosition.x}px`, top: `${tooltipPosition.y}px` }}
						>
							{summary.completed} patients who have completed their treatment
							<div className="absolute left-1/2 top-full transform -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
						</div>
					)}
				</div>
			</section>

			{/* Analytics Graphs Section */}
			<section className="mx-auto mt-8 max-w-6xl space-y-6">
				<div className="grid gap-6 lg:grid-cols-2">
					{/* Clinical Team vs Total Patients */}
					<div className="group rounded-2xl bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.07)] transition-all duration-300 hover:shadow-[0_25px_50px_rgba(15,23,42,0.15)] hover:scale-[1.01]">
						<h3 className="mb-2 text-lg font-semibold text-slate-900 transition-colors group-hover:text-sky-600">Clinical Team vs Total Patients</h3>
						<p className="mb-4 text-sm text-slate-500">Patient distribution across clinical team members</p>
						<div className="h-[350px]">
							<StatsChart 
								type="bar" 
								data={clinicalTeamData} 
								height={350}
							/>
						</div>
					</div>

					{/* Revenue vs Clinical Team */}
					<div className="group rounded-2xl bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.07)] transition-all duration-300 hover:shadow-[0_25px_50px_rgba(15,23,42,0.15)] hover:scale-[1.01]">
						<h3 className="mb-2 text-lg font-semibold text-slate-900 transition-colors group-hover:text-sky-600">Revenue vs Clinical Team</h3>
						<p className="mb-4 text-sm text-slate-500">Revenue generated by each clinical team member</p>
						<div className="h-[350px]">
							<StatsChart 
								type="bar" 
								data={revenueTeamData} 
								height={350}
								indexAxis="y"
							/>
						</div>
					</div>
				</div>
				<div className="grid gap-6 lg:grid-cols-1">
					{/* Patients by Organization */}
					<div className="group rounded-2xl bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.07)] transition-all duration-300 hover:shadow-[0_25px_50px_rgba(15,23,42,0.15)] hover:scale-[1.01]">
						<div className="mb-4 flex items-center justify-between">
							<div>
								<h3 className="mb-2 text-lg font-semibold text-slate-900 transition-colors group-hover:text-sky-600">Patients by Organization</h3>
								<p className="text-sm text-slate-500">Patient distribution across different organizations</p>
							</div>
							<div className="flex gap-2">
								<button
									type="button"
									onClick={() => setOrganizationTimeFilter('today')}
									className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
										organizationTimeFilter === 'today'
											? 'bg-sky-600 text-white'
											: 'bg-slate-100 text-slate-700 hover:bg-slate-200'
									}`}
								>
									Today
								</button>
								<button
									type="button"
									onClick={() => setOrganizationTimeFilter('weekly')}
									className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
										organizationTimeFilter === 'weekly'
											? 'bg-sky-600 text-white'
											: 'bg-slate-100 text-slate-700 hover:bg-slate-200'
									}`}
								>
									Weekly
								</button>
								<button
									type="button"
									onClick={() => setOrganizationTimeFilter('monthly')}
									className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
										organizationTimeFilter === 'monthly'
											? 'bg-sky-600 text-white'
											: 'bg-slate-100 text-slate-700 hover:bg-slate-200'
									}`}
								>
									Monthly
								</button>
								<button
									type="button"
									onClick={() => setOrganizationTimeFilter('overall')}
									className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
										organizationTimeFilter === 'overall'
											? 'bg-sky-600 text-white'
											: 'bg-slate-100 text-slate-700 hover:bg-slate-200'
									}`}
								>
									Overall
								</button>
							</div>
						</div>
						<div className="h-[350px]">
							<StatsChart 
								type="bar" 
								data={organizationData} 
								height={350}
							/>
						</div>
					</div>
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
					<>
						<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
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

							{/* Total Hours */}
							<div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-indigo-100 p-5 shadow-sm">
								<div className="flex items-center justify-between">
				<div>
										<p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
											Total Hours
										</p>
										<p className="mt-2 text-3xl font-bold text-indigo-900">
											{clinicianAnalytics.totalHours || 0}
										</p>
				</div>
									<div className="rounded-full bg-indigo-200 p-3">
										<i className="fas fa-clock text-xl text-indigo-600" aria-hidden="true" />
				</div>
				</div>
				</div>
						</div>

						{/* Activities and Appointments Distribution Pie Chart */}
						<div className="mt-8 grid gap-6 lg:grid-cols-2">
							<div className="group rounded-2xl bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.07)] transition-all duration-300 hover:shadow-[0_25px_50px_rgba(15,23,42,0.15)] hover:scale-[1.01]">
								<h3 className="mb-2 text-lg font-semibold text-slate-900 transition-colors group-hover:text-sky-600">Activities & Appointments Distribution</h3>
								<p className="mb-4 text-sm text-slate-500">Distribution of appointments across clinical team members</p>
								<div className="h-[350px]">
									<StatsChart 
										type="doughnut" 
										data={activitiesDistributionData} 
										height={350}
									/>
								</div>
							</div>
				</div>
					</>
				)}

				{!selectedPhysician && (
					<div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center">
						<i className="fas fa-chart-line text-3xl text-slate-400 mb-3" aria-hidden="true" />
						<p className="text-sm text-slate-600">Select a physician to view performance analytics</p>
				</div>
				)}
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


