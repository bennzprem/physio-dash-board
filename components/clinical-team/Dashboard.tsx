'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, onSnapshot, query, where, getDocs, type QuerySnapshot } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/PageHeader';
import DashboardWidget from '@/components/dashboard/DashboardWidget';
import StatsChart from '@/components/dashboard/StatsChart';
import type { PatientRecordBasic, PatientStatus } from '@/lib/types';

/** Head of department → subordinates by login email (Physiotherapy, Strength and Conditioning, etc.) */
const HEAD_SUBORDINATES: Record<string, string[]> = {
	'ashima@css.com': ['nayana@css.com', 'pravallika@css.com', 'dharanjay@css.com'],
	'anchalsingh@css.com': ['uddalokdas@css.com', 'johnbenedict@css.com', 'dharanjay@css.com'],
};

/** Department display name for each head (shown above "Patients by team member") */
const HEAD_DEPARTMENT_NAMES: Record<string, string> = {
	'ashima@css.com': 'Physiotherapy Department',
	'anchalsingh@css.com': 'Strength and Conditioning Department',
};

/** Report type used for "Total patients" count per department (unique patients per report type) */
const HEAD_DEPARTMENT_REPORT_TYPE: Record<string, 'physiotherapy' | 'strength-and-conditioning'> = {
	'ashima@css.com': 'physiotherapy',
	'anchalsingh@css.com': 'strength-and-conditioning',
};

/** Only this user's "Total patients" count is based on reports filled; all others use assignedDoctor. */
const REPORT_BASED_COUNT_EMAIL = 'dharanjay@css.com';

interface AppointmentRecord {
	id: string;
	patientId?: string;
	patient?: string;
	doctor?: string;
	date?: string;
	time?: string;
	status?: string;
	notes?: string;
}

type ModalView = 'caseload' | 'pending' | 'today' | 'completed' | 'team' | null;

const STATUS_BADGES: Record<'pending' | 'ongoing' | 'completed' | 'cancelled', string> = {
	pending: 'status-badge-pending',
	ongoing: 'status-badge-ongoing',
	completed: 'status-badge-completed',
	cancelled: 'status-badge-cancelled',
};


const ICON_SIZE = 'h-5 w-5';

const BriefcaseIcon = () => (
	<svg
		className={ICON_SIZE}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth={1.7}
		strokeLinecap="round"
		strokeLinejoin="round"
	>
		<path d="M9 6V5a2 2 0 012-2h2a2 2 0 012 2v1" />
		<rect x="4" y="7" width="16" height="13" rx="2" />
		<path d="M4 12h16" />
	</svg>
);

const HourglassIcon = () => (
	<svg
		className={ICON_SIZE}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth={1.7}
		strokeLinecap="round"
		strokeLinejoin="round"
	>
		<path d="M6 3h12" />
		<path d="M6 21h12" />
		<path d="M6 3c0 4 6 5 6 9s-6 5-6 9" />
		<path d="M18 3c0 4-6 5-6 9s6 5 6 9" />
	</svg>
);

const CalendarIcon = () => (
	<svg
		className={ICON_SIZE}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth={1.7}
		strokeLinecap="round"
		strokeLinejoin="round"
	>
		<rect x="3" y="4" width="18" height="18" rx="2" />
		<path d="M16 2v4" />
		<path d="M8 2v4" />
		<path d="M3 10h18" />
		<path d="M8 14h.01" />
		<path d="M12 14h.01" />
		<path d="M16 14h.01" />
	</svg>
);

const CheckIcon = () => (
	<svg
		className={ICON_SIZE}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth={1.7}
		strokeLinecap="round"
		strokeLinejoin="round"
	>
		<path d="M5 13l4 4L19 7" />
	</svg>
);

const ReportIcon = () => (
	<svg
		className={ICON_SIZE}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth={1.7}
		strokeLinecap="round"
		strokeLinejoin="round"
	>
		<path d="M7 3h8l4 4v12a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z" />
		<path d="M14 3v5h5" />
		<path d="M9 13h6" />
		<path d="M9 17h4" />
	</svg>
);

const AvailabilityIcon = () => (
	<svg
		className={ICON_SIZE}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth={1.7}
		strokeLinecap="round"
		strokeLinejoin="round"
	>
		<circle cx="12" cy="12" r="8" />
		<path d="M12 8v4l2.5 1.5" />
		<path d="M7 3v4" />
		<path d="M17 3v4" />
	</svg>
);

const TransferIcon = () => (
	<svg
		className={ICON_SIZE}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth={1.7}
		strokeLinecap="round"
		strokeLinejoin="round"
	>
		<path d="M5 7h11l-3-3" />
		<path d="M19 17H8l3 3" />
		<path d="M5 7v6" />
		<path d="M19 17v-6" />
	</svg>
);

function normalize(value?: string | null) {
	return value?.trim().toLowerCase() ?? '';
}

function parseDate(date?: string, time?: string) {
	if (!date) return null;
	if (time) {
		const combined = new Date(`${date}T${time}`);
		if (!Number.isNaN(combined.getTime())) return combined;
	}
	const onlyDate = new Date(date);
	return Number.isNaN(onlyDate.getTime()) ? null : onlyDate;
}

function isSameDay(reference: Date, other: Date) {
	return (
		reference.getFullYear() === other.getFullYear() &&
		reference.getMonth() === other.getMonth() &&
		reference.getDate() === other.getDate()
	);
}

function formatDateLabel(value?: string) {
	if (!value) return '—';
	const parsed = parseDate(value);
	if (!parsed) return value;
	return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
}

function formatTimeLabel(date?: string, time?: string) {
	const parsed = parseDate(date, time);
	if (!parsed) return time ?? '—';
	return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(parsed);
}

interface DashboardProps {
	onNavigate?: (page: string) => void;
}

export default function Dashboard({ onNavigate }: DashboardProps) {
	const { user } = useAuth();
	const [patients, setPatients] = useState<PatientRecordBasic[]>([]);
	const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
	const [modal, setModal] = useState<ModalView>(null);
	const [userProfile, setUserProfile] = useState<{ userName?: string; profileImage?: string }>({});
	const [subordinateUserNames, setSubordinateUserNames] = useState<string[]>([]);
	/** Subordinates with both email and userName for report-based matching */
	const [subordinateStaff, setSubordinateStaff] = useState<Array<{ email: string; userName: string }>>([]);
	const [teamDateFrom, setTeamDateFrom] = useState<string>('');
	const [teamDateTo, setTeamDateTo] = useState<string>('');
	/** When true, "Patients by team member" shows counts for appointments today only */
	const [teamDateFilterToday, setTeamDateFilterToday] = useState<boolean>(false);
	/** Report-based: normalized(createdBy/updatedBy) -> Set of patient IDs (for current department) */
	const [reportPatientIdsByCreator, setReportPatientIdsByCreator] = useState<Record<string, Set<string>>>({});
	const [selectedTeamMember, setSelectedTeamMember] = useState<{
		displayName: string;
		patients: PatientRecordBasic[];
	} | null>(null);

	// Load user profile data
	useEffect(() => {
		const loadProfile = async () => {
			if (!user?.email) return;

			try {
				const staffQuery = query(collection(db, 'staff'), where('userEmail', '==', user.email));
				const querySnapshot = await getDocs(staffQuery);

				if (!querySnapshot.empty) {
					const data = querySnapshot.docs[0].data();
					setUserProfile({
						userName: data.userName || user.displayName || '',
						profileImage: data.profileImage || '',
					});
				} else {
					setUserProfile({
						userName: user.displayName || user.email?.split('@')[0] || '',
						profileImage: '',
					});
				}
			} catch (error) {
				console.error('Failed to load user profile:', error);
				setUserProfile({
					userName: user.displayName || user.email?.split('@')[0] || '',
					profileImage: '',
				});
			}
		};

		loadProfile();
	}, [user]);

	const subordinateEmails = useMemo(() => {
		const email = user?.email?.trim().toLowerCase();
		if (!email) return [];
		return HEAD_SUBORDINATES[email] ?? [];
	}, [user?.email]);

	const isHead = subordinateEmails.length > 0;

	useEffect(() => {
		if (!isHead || subordinateEmails.length === 0) {
			setSubordinateUserNames([]);
			setSubordinateStaff([]);
			return;
		}
		const loadSubordinates = async () => {
			try {
				const staffSnap = await getDocs(collection(db, 'staff'));
				const names: string[] = [];
				const staffList: Array<{ email: string; userName: string }> = [];
				staffSnap.docs.forEach(docSnap => {
					const data = docSnap.data();
					const email = (data.userEmail as string)?.trim().toLowerCase();
					if (email && subordinateEmails.includes(email) && data.userName) {
						const userName = String(data.userName).trim();
						names.push(userName);
						staffList.push({ email, userName });
					}
				});
				setSubordinateUserNames(names);
				setSubordinateStaff(staffList);
			} catch (err) {
				console.error('Failed to load subordinate staff', err);
				setSubordinateUserNames([]);
				setSubordinateStaff([]);
			}
		};
		loadSubordinates();
	}, [isHead, subordinateEmails]);

	const headEmail = useMemo(() => user?.email?.trim().toLowerCase() ?? '', [user?.email]);
	const departmentReportType = useMemo(
		() => (headEmail ? HEAD_DEPARTMENT_REPORT_TYPE[headEmail] : null),
		[headEmail]
	);

	/** Today's date as YYYY-MM-DD for appointment date filter */
	const todayISODate = useMemo(() => {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}, []);

	useEffect(() => {
		if (!isHead || !departmentReportType) {
			setReportPatientIdsByCreator({});
			return;
		}
		const loadReportData = async () => {
			try {
				const byCreator: Record<string, Set<string>> = {};
				const add = (creatorKey: string, patientId: string) => {
					if (!creatorKey || !patientId) return;
					if (!byCreator[creatorKey]) byCreator[creatorKey] = new Set();
					byCreator[creatorKey].add(patientId);
				};
				if (departmentReportType === 'physiotherapy') {
					let snap;
					try {
						const q = query(
							collection(db, 'reportVersions'),
							where('reportType', '==', 'physiotherapy')
						);
						snap = await getDocs(q);
					} catch {
						const snapAll = await getDocs(collection(db, 'reportVersions'));
						snap = snapAll;
					}
					snap.docs.forEach(docSnap => {
						const d = docSnap.data();
						const reportType = (d.reportType as string) || '';
						if (reportType !== 'physiotherapy' && reportType !== '') return;
						const createdBy = (d.createdBy as string) ?? '';
						const patientId = (d.patientId as string) ?? '';
						add(normalize(createdBy), patientId);
					});
				} else {
					const snap = await getDocs(collection(db, 'strengthConditioningReports'));
					snap.docs.forEach(docSnap => {
						const d = docSnap.data();
						const updatedBy = (d.updatedBy as string) ?? '';
						const patientId = docSnap.id;
						add(normalize(updatedBy), patientId);
					});
				}
				setReportPatientIdsByCreator(byCreator);
			} catch (err) {
				console.error('Failed to load report data for department', err);
				setReportPatientIdsByCreator({});
			}
		};
		loadReportData();
	}, [isHead, departmentReportType]);

	useEffect(() => {
		const unsubscribePatients = onSnapshot(
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
						status: (data.status as PatientStatus) ?? 'pending',
						assignedDoctor: data.assignedDoctor ? String(data.assignedDoctor) : undefined,
						registeredAt: created ? created.toISOString() : (data.registeredAt as string | undefined),
					};
				});
				setPatients([...mapped]);
			},
			error => {
				console.error('Failed to load clinical dashboard patients', error);
				setPatients([]);
			}
		);

		const unsubscribeAppointments = onSnapshot(
			collection(db, 'appointments'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data() as Record<string, unknown>;
					return {
						id: docSnap.id,
						patientId: data.patientId ? String(data.patientId) : undefined,
						patient: data.patient ? String(data.patient) : undefined,
						doctor: data.doctor ? String(data.doctor) : undefined,
						date: data.date ? String(data.date) : undefined,
						time: data.time ? String(data.time) : undefined,
						status: data.status ? String(data.status) : undefined,
						notes: data.notes ? String(data.notes) : undefined,
					};
				});
				setAppointments([...mapped]);
			},
			error => {
				console.error('Failed to load clinical dashboard appointments', error);
				setAppointments([]);
			}
		);

		return () => {
			unsubscribePatients();
			unsubscribeAppointments();
		};
	}, []);

	/** Match Frontdesk assignment: `assignedDoctor` is staff display name (userName), same as appointment `doctor`. */
	const clinicianName = useMemo(() => {
		const fromDisplay = normalize(user?.displayName ?? '');
		const fromStaff = normalize(userProfile.userName ?? '');
		return fromDisplay || fromStaff;
	}, [user?.displayName, userProfile.userName]);

	const assignedPatients = useMemo(() => {
		if (!clinicianName) return patients;
		return patients.filter(patient => normalize(patient.assignedDoctor) === clinicianName);
	}, [patients, clinicianName]);

	const subordinatePatientSet = useMemo(() => {
		if (subordinateUserNames.length === 0) return new Set<string>();
		return new Set(subordinateUserNames.map(n => normalize(n)));
	}, [subordinateUserNames]);

	const subordinatePatients = useMemo(() => {
		if (subordinatePatientSet.size === 0) return [];
		return patients.filter(p => p.assignedDoctor && subordinatePatientSet.has(normalize(p.assignedDoctor)));
	}, [patients, subordinatePatientSet]);

	const subordinatePatientsFiltered = useMemo(() => {
		if (subordinatePatients.length === 0) return [];
		const from = teamDateFrom.trim() ? new Date(teamDateFrom) : null;
		const to = teamDateTo.trim() ? new Date(teamDateTo) : null;
		if (!from && !to) return subordinatePatients;
		return subordinatePatients.filter(p => {
			const reg = p.registeredAt;
			if (!reg) return false;
			const d = new Date(reg);
			if (Number.isNaN(d.getTime())) return false;
			if (from && d < from) return false;
			if (to) {
				const toEnd = new Date(to);
				toEnd.setHours(23, 59, 59, 999);
				if (d > toEnd) return false;
			}
			return true;
		});
	}, [subordinatePatients, teamDateFrom, teamDateTo]);

	function applyTeamDateFilter(list: PatientRecordBasic[]) {
		if (list.length === 0) return list;
		const from = teamDateFrom.trim() ? new Date(teamDateFrom) : null;
		const to = teamDateTo.trim() ? new Date(teamDateTo) : null;
		if (!from && !to) return list;
		return list.filter(p => {
			const reg = p.registeredAt;
			if (!reg) return false;
			const d = new Date(reg);
			if (Number.isNaN(d.getTime())) return false;
			if (from && d < from) return false;
			if (to) {
				const toEnd = new Date(to);
				toEnd.setHours(23, 59, 59, 999);
				if (d > toEnd) return false;
			}
			return true;
		});
	}

	const teamMembersList = useMemo(() => {
		if (!isHead) return [];
		const list: Array<{ displayName: string; normalizedName: string; email: string }> = [];
		const headDisplayName = userProfile.userName || user?.displayName || user?.email?.split('@')[0] || 'You';
		const headEmailVal = user?.email?.trim().toLowerCase() ?? '';
		list.push({
			displayName: headDisplayName,
			normalizedName: clinicianName || normalize(headDisplayName),
			email: headEmailVal,
		});
		subordinateStaff.forEach(({ email, userName }) => {
			list.push({ displayName: userName, normalizedName: normalize(userName), email });
		});
		return list;
	}, [isHead, userProfile.userName, user?.displayName, user?.email, clinicianName, subordinateStaff]);

	const patientsByTeamMember = useMemo(() => {
		if (teamMembersList.length === 0) return [];
		const reportBasedEmailNorm = normalize(REPORT_BASED_COUNT_EMAIL);
		return teamMembersList.map((member, index) => {
			const useReportBased =
				!teamDateFilterToday &&
				departmentReportType != null &&
				normalize(member.email) === reportBasedEmailNorm;
			let memberPatientIds: Set<string>;
			if (teamDateFilterToday) {
				// "Today" mode: count unique patients each user had an appointment with today
				const doctorNames = new Set<string>([member.normalizedName]);
				if (index === 0 && clinicianName) doctorNames.add(clinicianName);
				memberPatientIds = new Set(
					appointments
						.filter(
							apt =>
								apt.date === todayISODate &&
								apt.doctor &&
								doctorNames.has(normalize(apt.doctor))
						)
						.map(apt => apt.patientId)
						.filter((id): id is string => Boolean(id))
				);
			} else if (useReportBased) {
				const set1 = reportPatientIdsByCreator[normalize(member.email)] ?? new Set();
				const set2 = reportPatientIdsByCreator[member.normalizedName] ?? new Set();
				memberPatientIds = new Set([...set1, ...set2]);
			} else {
				// Match My Performance "Overall Patients Attended": same doctor matching (staffName/displayName) and unique patient IDs from appointments
				const doctorNames = new Set<string>([member.normalizedName]);
				if (index === 0 && clinicianName) doctorNames.add(clinicianName);
				memberPatientIds = new Set(
					appointments
						.filter(
							apt =>
								apt.doctor && doctorNames.has(normalize(apt.doctor))
						)
						.map(apt => apt.patientId)
						.filter((id): id is string => Boolean(id))
				);
			}
			const memberPatients = patients.filter(
				p => memberPatientIds.has(p.patientId ?? '') || memberPatientIds.has(p.id ?? '')
			);
			// For report-based (dharanjay) apply registration date filter when not "Today"; for others use raw list
			const filtered = useReportBased ? applyTeamDateFilter(memberPatients) : memberPatients;
			const count = teamDateFilterToday ? memberPatientIds.size : (useReportBased ? filtered.length : memberPatientIds.size);
			return {
				displayName: member.displayName,
				normalizedName: member.normalizedName,
				count,
				patients: teamDateFilterToday ? memberPatients : filtered,
			};
		});
	}, [
		teamMembersList,
		patients,
		appointments,
		teamDateFrom,
		teamDateTo,
		teamDateFilterToday,
		todayISODate,
		reportPatientIdsByCreator,
		departmentReportType,
		clinicianName,
	]);

	/** Union of subordinate patient IDs for team modal: report-based only for dharanjay, appointments-based (Overall Patients Attended) for others */
	const subordinateTeamModalPatientIds = useMemo(() => {
		const ids = new Set<string>();
		const reportBasedEmailNorm = normalize(REPORT_BASED_COUNT_EMAIL);
		subordinateStaff.forEach(({ email, userName }) => {
			if (departmentReportType != null && normalize(email) === reportBasedEmailNorm) {
				const set1 = reportPatientIdsByCreator[normalize(email)] ?? new Set();
				const set2 = reportPatientIdsByCreator[normalize(userName)] ?? new Set();
				set1.forEach(id => ids.add(id));
				set2.forEach(id => ids.add(id));
			} else {
				appointments
					.filter(apt => apt.doctor && normalize(apt.doctor) === normalize(userName))
					.forEach(apt => {
						if (apt.patientId) ids.add(apt.patientId);
					});
			}
		});
		return ids;
	}, [
		departmentReportType,
		subordinateStaff,
		reportPatientIdsByCreator,
		appointments,
	]);

	const subordinatePatientsFilteredForModal = useMemo(() => {
		if (teamDateFilterToday) {
			const subordinateNames = new Set(subordinateStaff.map(({ userName }) => normalize(userName)));
			const todayIds = new Set(
				appointments
					.filter(
						apt =>
							apt.date === todayISODate &&
							apt.doctor &&
							subordinateNames.has(normalize(apt.doctor))
					)
					.map(apt => apt.patientId)
					.filter((id): id is string => Boolean(id))
			);
			return patients.filter(
				p => todayIds.has(p.patientId ?? '') || todayIds.has(p.id ?? '')
			);
		}
		if (subordinateTeamModalPatientIds.size > 0) {
			const list = patients.filter(
				p =>
					subordinateTeamModalPatientIds.has(p.patientId ?? '') ||
					subordinateTeamModalPatientIds.has(p.id ?? '')
			);
			return applyTeamDateFilter(list);
		}
		return subordinatePatientsFiltered;
	}, [
		teamDateFilterToday,
		todayISODate,
		subordinateStaff,
		appointments,
		patients,
		subordinateTeamModalPatientIds,
		subordinatePatientsFiltered,
		teamDateFrom,
		teamDateTo,
	]);

	const assignedAppointments = useMemo(() => {
		if (!clinicianName) return appointments;
		return appointments.filter(appointment => normalize(appointment.doctor) === clinicianName);
	}, [appointments, clinicianName]);

	const today = useMemo(() => new Date(), []);

	const caseload = useMemo(
		() => assignedPatients.filter(p => {
			const status = (p.status ?? 'pending').toLowerCase();
			return status !== 'completed' && status !== 'cancelled';
		}),
		[assignedPatients]
	);

	const pending = useMemo(
		() => assignedPatients.filter(p => (p.status ?? 'pending') === 'pending'),
		[assignedPatients]
	);

	const todaysAppointments = useMemo(() => {
		return assignedAppointments.filter(appointment => {
			const parsed = parseDate(appointment.date, appointment.time);
			return parsed ? isSameDay(parsed, today) : false;
		});
	}, [assignedAppointments, today]);

	const upcomingAppointments = useMemo(() => {
		return assignedAppointments.filter(appointment => {
			const parsed = parseDate(appointment.date, appointment.time);
			return parsed ? parsed >= today && !isSameDay(parsed, today) : false;
		});
	}, [assignedAppointments, today]);

	const completedThisWeek = useMemo(() => {
		const now = new Date();
		const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const sevenDaysAgo = new Date(todayStart);
		sevenDaysAgo.setDate(todayStart.getDate() - 7);
		
		return assignedAppointments.filter(appointment => {
			if ((appointment.status ?? '').toLowerCase() !== 'completed') return false;
			const parsed = parseDate(appointment.date, appointment.time);
			if (!parsed) return false;
			
			// Normalize parsed date to start of day for comparison
			const appointmentDate = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
			
			// Include appointments from 7 days ago up to and including today
			return appointmentDate >= sevenDaysAgo && appointmentDate <= todayStart;
		});
	}, [assignedAppointments]);

	const modalTitle = useMemo(() => {
		switch (modal) {
			case 'caseload':
				return clinicianName ? 'Your Active Caseload' : 'Active Caseload';
			case 'pending':
				return 'Patients Awaiting Care';
			case 'today':
				return "Today's Schedule";
			case 'completed':
				return 'Completed In The Last 7 Days';
			case 'team':
				return 'Total Patients (Team)';
			default:
				return '';
		}
	}, [modal, clinicianName]);

	const modalRows = useMemo(() => {
		switch (modal) {
			case 'caseload':
				return caseload;
			case 'pending':
				return pending;
			case 'today':
				return todaysAppointments;
			case 'completed':
				return completedThisWeek;
			case 'team':
				return subordinatePatientsFilteredForModal;
			default:
				return [];
		}
	}, [modal, caseload, pending, todaysAppointments, completedThisWeek, subordinatePatientsFilteredForModal]);

	const hasAssignments = clinicianName ? caseload.length > 0 || todaysAppointments.length > 0 : true;

	// Chart data for appointment trends
	const appointmentTrendData = useMemo(() => {
		const today = new Date();
		const dayBuckets = Array.from({ length: 7 }, (_, index) => {
			const date = new Date(today);
			date.setDate(today.getDate() - (6 - index));
			const isoKey = date.toISOString().split('T')[0];
			const label = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date);
			const count = assignedAppointments.filter(
				apt => apt.date === isoKey && apt.status !== 'cancelled'
			).length;
			return { label, count };
		});

		return {
			labels: dayBuckets.map(bucket => bucket.label),
			datasets: [
				{
					label: 'Appointments',
					data: dayBuckets.map(bucket => bucket.count),
					borderColor: '#0ea5e9',
					backgroundColor: 'rgba(14, 165, 233, 0.2)',
					fill: true,
					tension: 0.3,
				},
			],
		};
	}, [assignedAppointments]);

	// Chart data for patient status distribution
	const statusDistributionData = useMemo(() => {
		const pendingCount = pending.length;
		const ongoingCount = caseload.filter(p => p.status === 'ongoing').length;
		const completedCount = assignedPatients.filter(p => p.status === 'completed').length;

		return {
			labels: ['Pending', 'Ongoing', 'Completed'],
			datasets: [
				{
					label: 'Patients',
					data: [pendingCount, ongoingCount, completedCount],
					backgroundColor: [
						'rgba(251, 191, 36, 0.85)',   // Pending - Amber-400 (matches status-badge-pending: amber)
						'rgba(14, 165, 233, 0.85)',   // Ongoing - Sky-500 (matches status-badge-ongoing: sky)
						'rgba(16, 185, 129, 0.85)',   // Completed - Emerald-500 (matches status-badge-completed: emerald)
					],
					borderColor: '#ffffff',
					borderWidth: 1,
				},
			],
		};
	}, [pending.length, caseload, assignedPatients]);

	/** Gender from patient records (Frontdesk registration); counts only patients assigned to you. */
	const genderRatioData = useMemo(() => {
		let male = 0;
		let female = 0;
		let other = 0;
		let unspecified = 0;
		for (const p of assignedPatients) {
			const g = normalize(p.gender ?? '');
			if (g === 'male' || g === 'm') male += 1;
			else if (g === 'female' || g === 'f') female += 1;
			else if (g === 'other') other += 1;
			else unspecified += 1;
		}
		const totalPatients = assignedPatients.length;
		const pct = (n: number) => (totalPatients > 0 ? Math.round((n / totalPatients) * 100) : 0);
		const segments: { label: string; count: number; color: string }[] = [];
		if (male > 0)
			segments.push({
				label: `Male (${male}) · ${pct(male)}%`,
				count: male,
				color: 'rgba(59, 130, 246, 0.88)',
			});
		if (female > 0)
			segments.push({
				label: `Female (${female}) · ${pct(female)}%`,
				count: female,
				color: 'rgba(236, 72, 153, 0.88)',
			});
		if (other > 0)
			segments.push({
				label: `Other (${other}) · ${pct(other)}%`,
				count: other,
				color: 'rgba(139, 92, 246, 0.88)',
			});
		if (unspecified > 0)
			segments.push({
				label: `Not specified (${unspecified}) · ${pct(unspecified)}%`,
				count: unspecified,
				color: 'rgba(148, 163, 184, 0.88)',
			});
		return {
			labels: segments.map(s => s.label),
			datasets: [
				{
					label: 'Patients',
					data: segments.map(s => s.count),
					backgroundColor: segments.map(s => s.color),
					borderColor: '#ffffff',
					borderWidth: 1,
				},
			],
		};
	}, [assignedPatients]);

	// Chart data for weekly completion
	const weeklyCompletionData = useMemo(() => {
		const weekDays = Array.from({ length: 7 }, (_, index) => {
			const date = new Date(today);
			date.setDate(today.getDate() - (6 - index));
			const isoKey = date.toISOString().split('T')[0];
			const label = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date);
			const count = completedThisWeek.filter(apt => apt.date === isoKey).length;
			return { label, count };
		});

		return {
			labels: weekDays.map(day => day.label),
			datasets: [
				{
					label: 'Completed',
					data: weekDays.map(day => day.count),
					backgroundColor: 'rgba(34, 197, 94, 0.4)',
					borderColor: '#22c55e',
					borderWidth: 1,
				},
			],
		};
	}, [completedThisWeek, today]);

	const UsersIcon = () => (
		<svg className={ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
			<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
			<circle cx="9" cy="7" r="4" />
			<path d="M23 21v-2a4 4 0 00-3-3.87" />
			<path d="M16 3.13a4 4 0 010 7.75" />
		</svg>
	);

	const dashboardCards: Array<{
		key: Exclude<ModalView, null>;
		title: string;
		subtitle: string;
		icon: ReactNode;
		iconBg: string;
		count: number;
	}> = [
		...(isHead
			? [
					{
						key: 'team' as const,
						title: 'Total Patients (Team)',
						subtitle: 'Patients under your subordinates',
						icon: <UsersIcon />,
						iconBg: 'bg-gradient-to-br from-violet-100 to-purple-100 text-violet-700 ring-violet-200',
						count: patientsByTeamMember.length > 1
							? patientsByTeamMember.slice(1).reduce((s, m) => s + m.count, 0)
							: subordinatePatientsFiltered.length,
					},
				]
			: []),
		{
			key: 'caseload',
			title: 'Active Caseload',
			subtitle: 'Patients currently in your care',
			icon: <BriefcaseIcon />,
			iconBg: 'bg-gradient-to-br from-indigo-100 to-purple-100 text-indigo-700 ring-indigo-200',
			count: caseload.length,
		},
		{
			key: 'today',
			title: "Today's Sessions",
			subtitle: 'Appointments scheduled for today',
			icon: <CalendarIcon />,
			iconBg: 'bg-gradient-to-br from-teal-100 to-cyan-100 text-teal-700 ring-teal-200',
			count: todaysAppointments.length,
		},
		{
			key: 'completed',
			title: 'Completed (7 days)',
			subtitle: 'Sessions wrapped in the last week',
			icon: <CheckIcon />,
			iconBg: 'bg-gradient-to-br from-emerald-100 to-teal-100 text-emerald-700 ring-emerald-200',
			count: completedThisWeek.length,
		},
	];

	const quickLinks: Array<{
		href: string;
		title: string;
		summary: string;
		icon: ReactNode;
		iconBg: string;
	}> = [
		{
			href: '#calendar',
			icon: <CalendarIcon />,
			title: 'Calendar',
			summary: 'View and manage your appointment schedule.',
			iconBg: 'bg-sky-100 text-sky-700 ring-sky-200',
		},
		{
			href: '#edit-report',
			icon: <ReportIcon />,
			title: 'Appointments',
			summary: 'Review appointments and update patient reports.',
			iconBg: 'bg-indigo-100 text-indigo-700 ring-indigo-200',
		},
		{
			href: '#availability',
			icon: <AvailabilityIcon />,
			title: 'My Availability',
			summary: 'Set your working hours and availability.',
			iconBg: 'bg-amber-100 text-amber-700 ring-amber-200',
		},
	];

	const handleQuickLinkClick = (href: string) => {
		if (onNavigate) {
			onNavigate(href);
		}
	};

	const QUICK_ICON_WRAPPER_BASE =
		'flex h-12 w-12 items-center justify-center rounded-xl shadow-sm ring-1 transition group-hover:-translate-y-0.5';

	const CARD_ICON_WRAPPER_BASE =
		'flex h-12 w-12 items-center justify-center rounded-2xl shadow-sm ring-1 transition group-hover:-translate-y-0.5';

	return (
		<div className="min-h-svh bg-slate-50 px-6 py-10">
			<div className="mx-auto max-w-6xl space-y-10">
				<PageHeader
					title={clinicianName ? 'Your Clinical Dashboard' : 'Clinical Team Dashboard'}
					statusCard={{
						label: 'Clinician',
						value: (
							<div className="flex items-center gap-3">
								{userProfile.profileImage ? (
									<img
										src={userProfile.profileImage}
										alt={userProfile.userName || 'User'}
										className="h-10 w-10 rounded-full object-cover border-2 border-sky-200 cursor-pointer hover:border-sky-400 transition"
										onClick={() => onNavigate && onNavigate('#profile')}
										title="Click to view profile"
									/>
								) : (
									<div 
										className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 border-2 border-sky-200 cursor-pointer hover:border-sky-400 transition"
										onClick={() => onNavigate && onNavigate('#profile')}
										title="Click to view profile"
									>
										<i className="fas fa-user text-sky-600 text-sm" aria-hidden="true" />
									</div>
								)}
								<span 
									className="cursor-pointer hover:text-sky-600 transition"
									onClick={() => onNavigate && onNavigate('#profile')}
									title="Click to view profile"
								>
									{userProfile.userName || user?.displayName || user?.email || 'All Team Members'}
								</span>
							</div>
						),
						subtitle: (
							<>
								Upcoming sessions: <span className="font-semibold">{todaysAppointments.length}</span>
							</>
						),
					}}
				/>

				{!hasAssignments && (
					<div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
						No patients are currently assigned to you. Once the front desk updates assignments, they will appear here.
					</div>
				)}

				{/* Divider */}
				<div className="border-t border-teal-200/50" />

				{/* Statistics Overview Section */}
				<section>
					<div className="mb-6">
						<h2 className="text-xl font-semibold text-slate-900">Overview</h2>
						<p className="mt-1 text-sm text-slate-500">
							Quick access to your caseload, appointments, and recent activity
						</p>
					</div>
					{isHead && (
						<div className="mb-4 flex flex-wrap items-center gap-4 rounded-xl border border-violet-200 bg-violet-50/50 px-4 py-3">
							<span className="text-sm font-medium text-violet-800">Date filter (Team patients):</span>
							<button
								type="button"
								onClick={() => {
									setTeamDateFilterToday(true);
									setTeamDateFrom('');
									setTeamDateTo('');
								}}
								className={`rounded-lg px-3 py-1.5 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-1 ${
									teamDateFilterToday
										? 'bg-violet-600 text-white shadow-sm'
										: 'bg-white border border-slate-300 text-slate-700 hover:border-violet-400 hover:bg-violet-50'
								}`}
							>
								Today
							</button>
							<label className="flex items-center gap-2 text-sm text-slate-700">
								From
								<input
									type="date"
									value={teamDateFrom}
									onChange={e => {
										setTeamDateFrom(e.target.value);
										setTeamDateFilterToday(false);
									}}
									className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
								/>
							</label>
							<label className="flex items-center gap-2 text-sm text-slate-700">
								To
								<input
									type="date"
									value={teamDateTo}
									onChange={e => {
										setTeamDateTo(e.target.value);
										setTeamDateFilterToday(false);
									}}
									className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
								/>
							</label>
							{(teamDateFrom || teamDateTo || teamDateFilterToday) && (
								<button
									type="button"
									onClick={() => {
										setTeamDateFrom('');
										setTeamDateTo('');
										setTeamDateFilterToday(false);
									}}
									className="text-sm font-medium text-violet-600 hover:text-violet-800"
								>
									Clear filter
								</button>
							)}
						</div>
					)}
					{isHead && patientsByTeamMember.length > 0 && (
						<div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
							{user?.email && HEAD_DEPARTMENT_NAMES[user.email.trim().toLowerCase()] && (
								<p className="mb-3 text-lg font-bold text-slate-900">
									{HEAD_DEPARTMENT_NAMES[user.email.trim().toLowerCase()]}
								</p>
							)}
							<h3 className="text-sm font-semibold text-slate-800">Patients by team member</h3>
							<p className="mt-1 text-xs text-slate-500">
								Total patients per user
								{teamDateFilterToday
									? ' (attended today)'
									: teamDateFrom || teamDateTo
										? ' (filtered by registration date)'
										: ''}
								. Click a row to view the patient list.
							</p>
							<ul className="mt-4 space-y-2">
								{patientsByTeamMember.map(({ displayName, count, patients }) => (
									<li key={displayName}>
										<button
											type="button"
											onClick={() => setSelectedTeamMember({ displayName, patients })}
											className="flex w-full cursor-pointer items-center justify-between rounded-lg border border-slate-100 bg-slate-50/50 px-4 py-3 text-left transition hover:border-violet-200 hover:bg-violet-50/30 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2"
										>
											<span className="text-sm font-medium text-slate-800">{displayName}</span>
											<span className="text-sm font-semibold text-violet-700">
												Total patients ({count})
											</span>
										</button>
									</li>
								))}
								<li className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-100/80 px-4 py-3">
									<span className="text-sm font-semibold text-slate-800">Total</span>
									<span className="text-sm font-bold text-violet-800">
										Total patients ({patientsByTeamMember.reduce((sum, m) => sum + m.count, 0)})
									</span>
								</li>
							</ul>
						</div>
					)}
					<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
						{dashboardCards.map(card => (
							<button
								key={card.key}
								type="button"
								onClick={() => setModal(card.key)}
								className="group card-base bg-gradient-to-br from-white to-emerald-50/40 hover:from-white hover:to-teal-50/50 border-emerald-100 hover:border-teal-200 shadow-md hover:shadow-lg transition-all duration-300"
							>
								<div className="flex items-center justify-between">
									<span className={`${CARD_ICON_WRAPPER_BASE} ${card.iconBg}`} aria-hidden="true">
										{card.icon}
									</span>
									<span className="text-3xl font-bold text-slate-900">{card.count}</span>
								</div>
								<div>
									<p className="text-sm font-semibold text-slate-900">{card.title}</p>
									<p className="mt-1 text-xs text-slate-500">{card.subtitle}</p>
								</div>
								<span className="mt-auto inline-flex items-center text-sm font-semibold text-sky-600 group-hover:text-sky-700 group-focus-visible:text-sky-700">
									View details <i className="fas fa-arrow-right ml-2 text-xs" aria-hidden="true" />
								</span>
							</button>
						))}
					</div>
				</section>

				{/* Divider */}
				<div className="border-t border-teal-200/50" />

				{/* Analytics Section */}
				<section>
					<DashboardWidget title="Analytics Overview" icon="fas fa-chart-line" collapsible className="space-y-6">
						<p className="text-sm text-slate-500">
							Visualize your appointment trends, patient distribution, gender mix from registration, and workload in real time.
						</p>
						<div className="grid gap-6 lg:grid-cols-2">
							<div className="rounded-2xl border border-teal-200 bg-gradient-to-br from-teal-50/50 to-emerald-50/30 p-4 shadow-md hover:shadow-lg transition-shadow">
								<p className="text-sm font-semibold text-teal-900">Weekly Appointment Trend</p>
								<p className="text-xs text-teal-700">Your appointments over the last 7 days.</p>
								<div className="mt-4">
									<StatsChart type="line" data={appointmentTrendData} height={260} />
								</div>
							</div>
							<div className="grid gap-6 sm:grid-cols-2">
								<div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/50 to-teal-50/30 p-4 shadow-md hover:shadow-lg transition-shadow">
									<p className="text-sm font-semibold text-emerald-900">Patient Status Mix</p>
									<p className="text-xs text-emerald-700">Your caseload breakdown.</p>
									<div className="mt-4">
										<StatsChart type="doughnut" data={statusDistributionData} height={220} />
									</div>
								</div>
								<div className="rounded-2xl border border-cyan-200 bg-gradient-to-br from-cyan-50/50 to-teal-50/30 p-4 shadow-md hover:shadow-lg transition-shadow">
									<p className="text-sm font-semibold text-cyan-900">Weekly Completion</p>
									<p className="text-xs text-slate-500">Completed sessions this week.</p>
									<div className="mt-4">
										<StatsChart type="bar" data={weeklyCompletionData} height={220} />
									</div>
								</div>
								<div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/50 to-violet-50/30 p-4 shadow-md hover:shadow-lg transition-shadow sm:col-span-2">
									<p className="text-sm font-semibold text-indigo-900">Patient gender ratio</p>
									<p className="text-xs text-indigo-700">
										Based on gender captured at front desk registration, for patients currently assigned to you.
									</p>
									<div className="mt-4">
										{assignedPatients.length === 0 ? (
											<p className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-10 text-center text-sm text-slate-500">
												No patients assigned to you yet. When the front desk assigns patients, their registration gender will appear here.
											</p>
										) : (
											<StatsChart
												type="doughnut"
												data={genderRatioData}
												height={240}
												doughnutSegmentLabels
											/>
										)}
									</div>
								</div>
							</div>
						</div>
					</DashboardWidget>
				</section>

				{/* Divider */}
				<div className="border-t border-teal-200/50" />

				{/* Quick Actions Section */}
				{onNavigate && (
					<section>
						<div className="mb-6">
							<h2 className="text-xl font-semibold text-slate-900">Quick Actions</h2>
							<p className="mt-1 text-sm text-slate-500">
								Access core clinical tools and functions
							</p>
						</div>
						<div
							className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
							aria-label="Clinical team quick actions"
						>
							{quickLinks.map(link => (
								<button
									key={link.href}
									type="button"
									onClick={() => handleQuickLinkClick(link.href)}
									className="group card-base gap-3"
								>
									<span className={`${QUICK_ICON_WRAPPER_BASE} ${link.iconBg}`} aria-hidden="true">
										{link.icon}
									</span>
									<div>
										<h3 className="text-lg font-semibold text-slate-900">{link.title}</h3>
										<p className="mt-1 text-sm text-slate-500">{link.summary}</p>
									</div>
									<span className="mt-auto inline-flex items-center text-sm font-semibold text-sky-600 group-hover:text-sky-700 group-focus-visible:text-sky-700">
										Open <i className="fas fa-arrow-right ml-2 text-xs" aria-hidden="true" />
									</span>
								</button>
							))}
						</div>
					</section>
				)}

				{/* Divider */}
				<div className="border-t border-teal-200/50" />

				{/* Daily Operations Section */}
				<section>
					<div className="mb-6">
						<h2 className="text-xl font-semibold text-slate-900">Daily Operations</h2>
						<p className="mt-1 text-sm text-slate-500">
							Review today's schedule and manage your workflow
						</p>
					</div>
					<div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
						<div className="section-card">
							<h3 className="text-lg font-semibold text-slate-900">Today's Timeline</h3>
							<p className="mt-1 text-sm text-slate-500">
								Review when to expect each session. Click any entry to open details.
							</p>
							{todaysAppointments.length === 0 ? (
								<p className="mt-6 rounded-lg border border-slate-100 bg-slate-50 px-4 py-5 text-sm text-slate-500">
									No appointments scheduled for today.
								</p>
							) : (
								<ul className="mt-6 space-y-3">
									{todaysAppointments
										.slice()
										.sort((a, b) => {
											const timeA = parseDate(a.date, a.time)?.getTime() ?? 0;
											const timeB = parseDate(b.date, b.time)?.getTime() ?? 0;
											return timeA - timeB;
										})
										.map((appointment, index) => (
											<li
												key={`${appointment.patientId ?? appointment.patient}-${appointment.date}-${index}`}
												className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3"
											>
												<div>
													<p className="text-sm font-semibold text-slate-800">
														{appointment.patient || appointment.patientId || 'Patient'}
													</p>
													<p className="text-xs text-slate-500">
														{formatDateLabel(appointment.date)} &bull;{' '}
														{formatTimeLabel(appointment.date, appointment.time)}
													</p>
												</div>
												<span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
													{(appointment.status ?? 'pending').toString().toUpperCase()}
												</span>
											</li>
										))}
								</ul>
							)}
						</div>

						<div className="section-card">
							<h3 className="text-lg font-semibold text-slate-900">Action Items</h3>
							<ul className="mt-4 space-y-3 text-sm text-slate-600">
								<li>Update notes after each completed session so reports stay current.</li>
								<li>Follow up on pending patients to confirm first visit details.</li>
								<li>Coordinate with the front desk on any schedule conflicts spotted here.</li>
							</ul>
						</div>
					</div>
				</section>
			</div>

			{modal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
					<div className="w-full max-w-5xl rounded-2xl border border-slate-200 bg-white shadow-2xl flex max-h-[85vh] flex-col">
						<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
							<div>
								<h2 className="text-lg font-semibold text-slate-900">{modalTitle}</h2>
								<p className="text-xs text-slate-500">
									Showing {modalRows.length} record{modalRows.length === 1 ? '' : 's'}.
								</p>
							</div>
							<button
								type="button"
								onClick={() => setModal(null)}
								className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:bg-slate-100 focus-visible:text-slate-600 focus-visible:outline-none"
								aria-label="Close dialog"
							>
								<i className="fas fa-times" aria-hidden="true" />
							</button>
						</header>
						<div className="flex-1 overflow-y-auto px-6 py-4">
							{modalRows.length === 0 ? (
								<p className="py-10 text-center text-sm text-slate-500">No records available.</p>
							) : modal === 'caseload' || modal === 'pending' || modal === 'team' ? (
								<div className="overflow-x-auto">
									<table className="min-w-full divide-y divide-slate-200 text-left text-sm text-slate-700">
										<thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
											<tr>
												<th className="px-3 py-2 font-semibold">#</th>
												<th className="px-3 py-2 font-semibold">Patient ID</th>
												<th className="px-3 py-2 font-semibold">Name</th>
												{modal === 'team' && (
													<th className="px-3 py-2 font-semibold">Assigned to</th>
												)}
												<th className="px-3 py-2 font-semibold">Status</th>
												<th className="px-3 py-2 font-semibold">Phone</th>
												<th className="px-3 py-2 font-semibold">Email</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-slate-100">
											{(modalRows as PatientRecordBasic[]).map((patient, index) => {
												const rawStatus = (patient.status ?? 'pending') as PatientStatus;
												const status =
													rawStatus === 'pending' ||
													rawStatus === 'ongoing' ||
													rawStatus === 'completed' ||
													rawStatus === 'cancelled'
														? rawStatus
														: 'pending';
												return (
													<tr key={patient.id}>
														<td className="px-3 py-3 text-xs text-slate-500">{index + 1}</td>
														<td className="px-3 py-3 text-sm font-medium text-slate-800">
															{patient.patientId || '—'}
														</td>
														<td className="px-3 py-3 text-sm text-slate-700">{patient.name || '—'}</td>
														{modal === 'team' && (
															<td className="px-3 py-3 text-sm text-slate-600">{patient.assignedDoctor || '—'}</td>
														)}
														<td className="px-3 py-3">
															<span
																className={`badge-base px-3 py-1 ${STATUS_BADGES[status]}`}
															>
																{status.charAt(0).toUpperCase() + status.slice(1)}
															</span>
														</td>
														<td className="px-3 py-3 text-sm text-slate-600">{patient.phone || '—'}</td>
														<td className="px-3 py-3 text-sm text-slate-600">{patient.email || '—'}</td>
													</tr>
												);
											})}
										</tbody>
									</table>
								</div>
							) : (
								<div className="overflow-x-auto">
									<table className="min-w-full divide-y divide-slate-200 text-left text-sm text-slate-700">
										<thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
											<tr>
												<th className="px-3 py-2 font-semibold">#</th>
												<th className="px-3 py-2 font-semibold">Patient</th>
												<th className="px-3 py-2 font-semibold">Date</th>
												<th className="px-3 py-2 font-semibold">Time</th>
												<th className="px-3 py-2 font-semibold">Status</th>
												<th className="px-3 py-2 font-semibold">Notes</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-slate-100">
											{(modalRows as AppointmentRecord[]).map((appointment, index) => (
												<tr
													key={appointment.id}
												>
													<td className="px-3 py-3 text-xs text-slate-500">{index + 1}</td>
													<td className="px-3 py-3 text-sm font-medium text-slate-800">
														{appointment.patient || appointment.patientId || 'Patient'}
													</td>
													<td className="px-3 py-3 text-sm text-slate-600">
														{formatDateLabel(appointment.date)}
													</td>
													<td className="px-3 py-3 text-sm text-slate-600">
														{formatTimeLabel(appointment.date, appointment.time)}
													</td>
													<td className="px-3 py-3">
														<span className="badge-base px-3 py-1 bg-slate-100 text-slate-600 ring-1 ring-slate-200">
															{(appointment.status ?? 'pending').toString().toUpperCase()}
														</span>
													</td>
													<td className="px-3 py-3 text-sm text-slate-600">
														{appointment.notes || '—'}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							)}
						</div>
						<footer className="flex items-center justify-end border-t border-slate-200 px-6 py-4">
							<button
								type="button"
								onClick={() => setModal(null)}
								className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 focus-visible:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
							>
								<i className="fas fa-arrow-left" aria-hidden="true" />
								Back to Dashboard
							</button>
						</footer>
					</div>
				</div>
			)}

			{selectedTeamMember && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
					<div className="flex max-h-[85vh] w-full max-w-5xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl">
						<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
							<div>
								<h2 className="text-lg font-semibold text-slate-900">
									Patients — {selectedTeamMember.displayName}
								</h2>
								<p className="text-xs text-slate-500">
									Showing {selectedTeamMember.patients.length} patient
									{selectedTeamMember.patients.length === 1 ? '' : 's'}.
								</p>
							</div>
							<button
								type="button"
								onClick={() => setSelectedTeamMember(null)}
								className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:bg-slate-100 focus-visible:text-slate-600 focus-visible:outline-none"
								aria-label="Close dialog"
							>
								<i className="fas fa-times" aria-hidden="true" />
							</button>
						</header>
						<div className="flex-1 overflow-y-auto px-6 py-4">
							{selectedTeamMember.patients.length === 0 ? (
								<p className="py-10 text-center text-sm text-slate-500">No patients for this team member.</p>
							) : (
								<div className="overflow-x-auto">
									<table className="min-w-full divide-y divide-slate-200 text-left text-sm text-slate-700">
										<thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
											<tr>
												<th className="px-3 py-2 font-semibold">#</th>
												<th className="px-3 py-2 font-semibold">Patient ID</th>
												<th className="px-3 py-2 font-semibold">Name</th>
												<th className="px-3 py-2 font-semibold">Status</th>
												<th className="px-3 py-2 font-semibold">Phone</th>
												<th className="px-3 py-2 font-semibold">Email</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-slate-100">
											{selectedTeamMember.patients.map((patient, index) => {
												const rawStatus = (patient.status ?? 'pending') as PatientStatus;
												const status =
													rawStatus === 'pending' ||
													rawStatus === 'ongoing' ||
													rawStatus === 'completed' ||
													rawStatus === 'cancelled'
														? rawStatus
														: 'pending';
												return (
													<tr key={patient.id}>
														<td className="px-3 py-3 text-xs text-slate-500">{index + 1}</td>
														<td className="px-3 py-3 text-sm font-medium text-slate-800">
															{patient.patientId || '—'}
														</td>
														<td className="px-3 py-3 text-sm text-slate-700">{patient.name || '—'}</td>
														<td className="px-3 py-3">
															<span className={`badge-base px-3 py-1 ${STATUS_BADGES[status]}`}>
																{status.charAt(0).toUpperCase() + status.slice(1)}
															</span>
														</td>
														<td className="px-3 py-3 text-sm text-slate-600">{patient.phone || '—'}</td>
														<td className="px-3 py-3 text-sm text-slate-600">{patient.email || '—'}</td>
													</tr>
												);
											})}
										</tbody>
									</table>
								</div>
							)}
						</div>
						<footer className="flex items-center justify-end border-t border-slate-200 px-6 py-4">
							<button
								type="button"
								onClick={() => setSelectedTeamMember(null)}
								className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 focus-visible:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
							>
								<i className="fas fa-arrow-left" aria-hidden="true" />
								Back to list
							</button>
						</footer>
					</div>
				</div>
			)}
		</div>
	);
}
