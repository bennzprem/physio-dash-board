'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, onSnapshot, query, where, getDocs, type QuerySnapshot, type Timestamp } from 'firebase/firestore';

import PageHeader from '@/components/PageHeader';
import DashboardWidget from '@/components/dashboard/DashboardWidget';
import StatsChart from '@/components/dashboard/StatsChart';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import type { AdminAppointmentStatus } from '@/lib/adminMockData';
import type { PatientRecordBasic, PatientStatus } from '@/lib/types';

const STATUS_BADGES: Record<'pending' | 'ongoing' | 'completed' | 'cancelled', string> = {
	pending: 'status-badge-pending',
	ongoing: 'status-badge-ongoing',
	completed: 'status-badge-completed',
	cancelled: 'status-badge-cancelled',
};

type ModalType = 'patients' | 'pending' | 'ongoing' | 'completed' | null;

interface DashboardCardConfig {
	key: Exclude<ModalType, null>;
	title: string;
	subtitle: string;
	icon: ReactNode;
	iconBg: string;
	count: number;
}

const ICON_SIZE = 'h-5 w-5';

const ClipboardIcon = () => (
	<svg
		className={ICON_SIZE}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth={1.7}
		strokeLinecap="round"
		strokeLinejoin="round"
	>
		<rect x="5" y="4" width="14" height="17" rx="2" />
		<path d="M9 4V3a2 2 0 012-2h2a2 2 0 012 2v1" />
		<path d="M9 9h6" />
		<path d="M9 13h6" />
		<path d="M9 17h3" />
	</svg>
);

const ClockIcon = () => (
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
		<path d="M12 7v5l2.5 2.5" />
	</svg>
);

const StethoscopeIcon = () => (
	<svg
		className={ICON_SIZE}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth={1.7}
		strokeLinecap="round"
		strokeLinejoin="round"
	>
		<path d="M6 4v5a4 4 0 004 4h0a4 4 0 004-4V4" />
		<path d="M10 17a3 3 0 006 0v-3" />
		<circle cx="18" cy="15" r="3" />
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

interface AppointmentRecord {
	id: string;
	appointmentId: string;
	patientId: string;
	patient: string;
	doctor: string;
	date: string;
	time: string;
	status: AdminAppointmentStatus;
	createdAt: string;
}

interface StaffMember {
	id: string;
	userName: string;
	role: string;
	status: string;
}


interface DashboardProps {
	onNavigate?: (page: string) => void;
}

export default function Dashboard({ onNavigate }: DashboardProps) {
	const { user } = useAuth();
	const [patients, setPatients] = useState<PatientRecordBasic[]>([]);
	const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
	const [staff, setStaff] = useState<StaffMember[]>([]);
	const [modal, setModal] = useState<ModalType>(null);
	const [userProfile, setUserProfile] = useState<{ userName?: string; profileImage?: string }>({});

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
						status: (data.status as PatientStatus) ?? 'pending',
						assignedDoctor: data.assignedDoctor ? String(data.assignedDoctor) : undefined,
						registeredAt: created ? created.toISOString() : (data.registeredAt as string | undefined),
					};
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
						status: (data.status as AdminAppointmentStatus) ?? 'pending',
						createdAt: created ? created.toISOString() : (data.createdAt as string | undefined) || new Date().toISOString(),
					} as AppointmentRecord;
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
				setStaff(mapped.filter(s => s.status === 'Active'));
			},
			error => {
				console.error('Failed to load staff', error);
				setStaff([]);
			}
		);

		return () => unsubscribe();
	}, []);

	const stats = useMemo(() => {
		const pending = patients.filter(p => (p.status ?? 'pending') === 'pending');
		const ongoing = patients.filter(p => p.status === 'ongoing');
		const completed = patients.filter(p => p.status === 'completed');

		// Appointment statistics
		const today = new Date().toISOString().split('T')[0];
		const todayAppointments = appointments.filter(apt => apt.date === today && apt.status !== 'cancelled');
		const thisWeekAppointments = appointments.filter(apt => {
			const aptDate = new Date(apt.date);
			const weekAgo = new Date();
			weekAgo.setDate(weekAgo.getDate() - 7);
			return aptDate >= weekAgo && apt.status !== 'cancelled';
		});
		const cancelledThisWeek = appointments.filter(apt => {
			if (apt.status !== 'cancelled') return false;
			const aptDate = new Date(apt.date);
			const weekAgo = new Date();
			weekAgo.setDate(weekAgo.getDate() - 7);
			return aptDate >= weekAgo;
		});

		// Appointments by staff
		const appointmentsByStaff = staff.map(member => ({
			staffName: member.userName,
			count: appointments.filter(apt => apt.doctor === member.userName && apt.status !== 'cancelled').length,
		}));

		return {
			total: patients.length,
			pending,
			ongoing,
			completed,
			appointments: {
				today: todayAppointments.length,
				thisWeek: thisWeekAppointments.length,
				cancelledThisWeek: cancelledThisWeek.length,
				byStaff: appointmentsByStaff,
				total: appointments.filter(apt => apt.status !== 'cancelled').length,
			},
			activeStaff: staff.length,
		};
	}, [patients, appointments, staff]);

	const appointmentTrendData = useMemo(() => {
		const today = new Date();
		const dayBuckets = Array.from({ length: 7 }, (_, index) => {
			const date = new Date(today);
			date.setDate(today.getDate() - (6 - index));
			const isoKey = date.toISOString().split('T')[0];
			const label = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(date);
			const count = appointments.filter(
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
	}, [appointments]);

	const statusDistributionData = useMemo(() => {
		const pendingCount = stats.pending.length;
		const ongoingCount = stats.ongoing.length;
		const completedCount = stats.completed.length;

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
	}, [stats.pending.length, stats.ongoing.length, stats.completed.length]);

	const staffLoadData = useMemo(() => {
		const activeStaff = stats.appointments.byStaff.filter(member => member.count > 0);
		const hasData = activeStaff.length > 0;
		const labels = hasData ? activeStaff.map(member => member.staffName || 'Unassigned') : ['No data'];
		const data = hasData ? activeStaff.map(member => member.count) : [0];

		return {
			labels,
			datasets: [
				{
					label: 'Active appointments',
					data,
					backgroundColor: hasData ? 'rgba(14, 165, 233, 0.4)' : 'rgba(148, 163, 184, 0.4)',
					borderColor: hasData ? '#0ea5e9' : '#94a3b8',
					borderWidth: 1,
				},
			],
		};
	}, [stats.appointments.byStaff]);

	const modalTitle = useMemo(() => {
		switch (modal) {
			case 'patients':
				return 'All Registered Patients';
			case 'pending':
				return 'Pending Appointments';
			case 'ongoing':
				return 'Ongoing Appointments';
			case 'completed':
				return 'Completed Treatments';
			default:
				return '';
		}
	}, [modal]);

	const modalRows = useMemo<PatientRecordBasic[]>(() => {
		switch (modal) {
			case 'patients':
				return patients;
			case 'pending':
				return stats.pending;
			case 'ongoing':
				return stats.ongoing;
			case 'completed':
				return stats.completed;
			default:
				return [];
		}
	}, [modal, patients, stats]);

	const dashboardCards: DashboardCardConfig[] = [
		{
			key: 'patients',
			title: 'Total Registered',
			subtitle: 'View full registry',
			icon: <ClipboardIcon />,
			iconBg: 'bg-gradient-to-br from-sky-100 to-blue-100 text-sky-700 ring-sky-200',
			count: stats.total,
		},
		{
			key: 'pending',
			title: 'Pending',
			subtitle: 'Awaiting confirmation',
			icon: <ClockIcon />,
			iconBg: 'bg-gradient-to-br from-amber-100 to-yellow-100 text-amber-700 ring-amber-200',
			count: stats.pending.length,
		},
		{
			key: 'ongoing',
			title: 'Ongoing',
			subtitle: 'Currently in progress',
			icon: <StethoscopeIcon />,
			iconBg: 'bg-gradient-to-br from-indigo-100 to-purple-100 text-indigo-700 ring-indigo-200',
			count: stats.ongoing.length,
		},
		{
			key: 'completed',
			title: 'Completed',
			subtitle: 'Ready for billing',
			icon: <CheckIcon />,
			iconBg: 'bg-gradient-to-br from-emerald-100 to-teal-100 text-emerald-700 ring-emerald-200',
			count: stats.completed.length,
		},
	];

	const quickLinks = [
		{
			href: '#patients',
			icon: 'fas fa-users',
			title: 'Patient Management',
			summary: 'View, edit, and manage patient records.',
		},
		{
			href: '#notifications',
			icon: 'fas fa-bell',
			title: 'Notification & Messaging',
			summary: 'Stay updated and communicate with your team.',
		},
		{
			href: '#billing',
			icon: 'fas fa-file-invoice-dollar',
			title: 'Billing',
			summary: 'Process payments and invoices.',
		},
	];

	const handleQuickLinkClick = (href: string) => {
		if (onNavigate) {
			onNavigate(href);
		}
	};


	return (
		<div className="min-h-svh bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 px-6 py-10">
			<div className="mx-auto max-w-6xl space-y-10">
				<PageHeader
					title="Front Desk Dashboard"
					statusCard={{
						label: 'Today\'s Overview',
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
									{userProfile.userName || user?.displayName || 'Front Desk'}
								</span>
							</div>
						),
						subtitle: (
							<>
								{stats.activeStaff} active staff · {stats.appointments.total} total appointments
							</>
						),
					}}
				/>

				{/* Divider */}
				<div className="border-t border-indigo-200/50" />

				{/* Statistics Overview Section */}
				<section>
					<DashboardWidget title="Patient Overview" icon="fas fa-user-injured" collapsible className="space-y-6">
						<p className="text-sm text-slate-500">
							Quick access to patient statistics and status breakdowns.
						</p>
						<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
							{dashboardCards.map(card => (
								<button
									key={card.key}
									type="button"
									onClick={() => setModal(card.key)}
									className="group card-base bg-gradient-to-br from-white to-slate-50/50 hover:from-white hover:to-indigo-50/30 border-indigo-100 hover:border-indigo-200 shadow-md hover:shadow-lg transition-all duration-300"
								>
									<div className="flex items-center justify-between">
										<span className={`icon-wrapper-base ${card.iconBg}`} aria-hidden="true">
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
					</DashboardWidget>
				</section>

				{/* Divider */}
				<div className="border-t border-indigo-200/50" />

				{/* Analytics Section */}
				<section>
					<DashboardWidget title="Analytics Overview" icon="fas fa-chart-line" collapsible className="space-y-6">
						<p className="text-sm text-slate-500">
							Visualize appointment flow, patient distribution, and team workload in real time.
						</p>
						<div className="grid gap-6 lg:grid-cols-2">
							<div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/50 to-purple-50/30 p-4 shadow-md hover:shadow-lg transition-shadow">
								<p className="text-sm font-semibold text-indigo-900">Weekly Appointment Trend</p>
								<p className="text-xs text-indigo-700">Includes the last 7 days of confirmed sessions.</p>
								<div className="mt-4">
									<StatsChart type="line" data={appointmentTrendData} height={260} />
								</div>
							</div>
							<div className="grid gap-6 sm:grid-cols-2">
								<div className="rounded-2xl border border-purple-200 bg-gradient-to-br from-purple-50/50 to-pink-50/30 p-4 shadow-md hover:shadow-lg transition-shadow">
									<p className="text-sm font-semibold text-purple-900">Patient Status Mix</p>
									<p className="text-xs text-purple-700">Pending vs. ongoing vs. completed.</p>
									<div className="mt-4">
										<StatsChart type="doughnut" data={statusDistributionData} height={220} />
									</div>
								</div>
								<div className="rounded-2xl border border-pink-200 bg-gradient-to-br from-pink-50/50 to-rose-50/30 p-4 shadow-md hover:shadow-lg transition-shadow">
									<p className="text-sm font-semibold text-pink-900">Team Workload</p>
									<p className="text-xs text-slate-500">Active appointments by clinician.</p>
									<div className="mt-4">
										<StatsChart type="bar" data={staffLoadData} height={220} />
									</div>
								</div>
							</div>
						</div>
					</DashboardWidget>
				</section>

				{/* Divider */}
				<div className="border-t border-indigo-200/50" />

				{/* Quick Actions Section */}
				<section>
					<DashboardWidget title="Quick Actions" icon="fas fa-bolt" collapsible className="space-y-6">
						<p className="text-sm text-slate-500">Jump directly into the workflows you use most.</p>
						<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
							{quickLinks.map(link => (
								<button
									key={link.href}
									type="button"
									onClick={() => handleQuickLinkClick(link.href)}
									className="group card-base gap-3"
								>
									<span className="icon-wrapper-sky" aria-hidden="true">
										<i className={link.icon} />
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
					</DashboardWidget>
				</section>

				{/* Divider */}
				<div className="border-t border-indigo-200/50" />

				{/* Daily Operations Section */}
				<section>
					<DashboardWidget title="Daily Operations" icon="fas fa-clipboard-check" collapsible className="space-y-6">
						<p className="text-sm text-slate-500">
							Monitor today&apos;s activity and access helpful resources.
						</p>
						<div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
							<div className="section-card">
								<h3 className="text-lg font-semibold text-slate-900">Today&apos;s Snapshot</h3>
								<p className="mt-1 text-sm text-slate-500">
									Breakdown of active cases by status to help balance your day.
								</p>
								<div className="mt-6 space-y-3">
									{(['pending', 'ongoing', 'completed'] as Array<'pending' | 'ongoing' | 'completed'>).map(key => (
										<div
											key={key}
											className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3"
										>
											<div>
												<p className="text-sm font-semibold text-slate-800">
													{key === 'pending' ? 'Pending' : key === 'ongoing' ? 'Ongoing' : 'Completed'}
												</p>
												<p className="text-xs text-slate-500">
													{key === 'pending'
														? 'Waiting for confirmation or scheduling'
														: key === 'ongoing'
															? 'In session or scheduled today'
															: 'Ready for follow-up or discharge'}
												</p>
											</div>
											<div className="flex items-center gap-3">
												<span className="text-2xl font-bold text-slate-900">
													{key === 'pending'
														? stats.pending.length
														: key === 'ongoing'
															? stats.ongoing.length
															: stats.completed.length}
												</span>
												<button
													type="button"
													onClick={() => setModal(key)}
													className="text-xs font-semibold text-sky-600 hover:text-sky-500"
												>
													View
												</button>
											</div>
										</div>
									))}
								</div>
							</div>
						</div>
					</DashboardWidget>
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
							) : (
								<div className="overflow-x-auto">
									<table className="min-w-full divide-y divide-slate-200 text-left text-sm text-slate-700">
										<thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
											<tr>
												<th className="px-3 py-2 font-semibold">#</th>
												<th className="px-3 py-2 font-semibold">Patient ID</th>
												<th className="px-3 py-2 font-semibold">Name</th>
												<th className="px-3 py-2 font-semibold">Status</th>
												<th className="px-3 py-2 font-semibold">Assigned Clinician</th>
												<th className="px-3 py-2 font-semibold">Phone</th>
												<th className="px-3 py-2 font-semibold">Email</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-slate-100">
											{modalRows.map((patient, index) => {
												const status = (patient.status ?? 'pending') as PatientStatus;
												const badgeClass =
													STATUS_BADGES[
														status === 'pending' || status === 'ongoing' || status === 'completed' || status === 'cancelled'
															? status
															: 'pending'
													];

												return (
													<tr key={patient.id}>
														<td className="px-3 py-3 text-xs text-slate-500">{index + 1}</td>
														<td className="px-3 py-3 text-sm font-medium text-slate-800">
															{patient.patientId || '—'}
														</td>
														<td className="px-3 py-3 text-sm text-slate-700">{patient.name || '—'}</td>
														<td className="px-3 py-3">
															<span
																className={`badge-base px-3 py-1 ${badgeClass}`}
															>
																{status.toString().charAt(0).toUpperCase() + status.toString().slice(1)}
															</span>
														</td>
														<td className="px-3 py-3 text-sm text-slate-600">
															{patient.assignedDoctor || '—'}
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
		</div>
	);
}