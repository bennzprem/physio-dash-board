'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where, getDocs, type QuerySnapshot, type Timestamp } from 'firebase/firestore';

import PageHeader from '@/components/PageHeader';
import DashboardWidget from '@/components/dashboard/DashboardWidget';
import StatsChart from '@/components/dashboard/StatsChart';
import { db, auth } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import type { AdminAppointmentStatus, AdminPatientStatus } from '@/lib/adminMockData';

interface DashboardProps {
	onNavigate?: (page: string) => void;
}

interface PatientRecord {
	id: string;
	patientId: string;
	name: string;
	status: AdminPatientStatus;
}

interface AppointmentRecord {
	id: string;
	patientId: string;
	patient: string;
	doctor: string;
	date: string;
	status: AdminAppointmentStatus;
}

interface StaffMember {
	id: string;
	userName: string;
	role: string;
	status: string;
}

interface UserRecord {
	id: string;
	email: string;
	role: string;
	status: string;
}

export default function Dashboard({ onNavigate }: DashboardProps) {
	const { user } = useAuth();
	const [patients, setPatients] = useState<PatientRecord[]>([]);
	const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
	const [staff, setStaff] = useState<StaffMember[]>([]);
	const [users, setUsers] = useState<UserRecord[]>([]);
	const [userProfile, setUserProfile] = useState<{ userName?: string; profileImage?: string }>({});

	// Check for birthdays on dashboard load (only once per day)
	useEffect(() => {
		const checkBirthdays = async () => {
			if (!user || user.role?.trim() !== 'Admin') return;

			// Check if we've already checked birthdays today
			const lastCheck = localStorage.getItem('lastBirthdayCheck');
			const today = new Date().toDateString();
			
			if (lastCheck === today) {
				return; // Already checked today
			}

			try {
				const token = await auth.currentUser?.getIdToken(true);
				if (!token) return;

				const response = await fetch('/api/birthdays/notifications', {
					method: 'GET',
					headers: {
						'Authorization': `Bearer ${token}`,
					},
				});

				if (response.ok) {
					const result = await response.json();
					if (result.success && result.birthdayCount > 0) {
						console.log(`Birthday notifications sent for ${result.birthdayCount} employee(s)`);
					}
					// Mark that we've checked today
					localStorage.setItem('lastBirthdayCheck', today);
				}
			} catch (error) {
				console.error('Failed to check birthdays:', error);
			}
		};

		// Small delay to ensure auth is ready
		const timer = setTimeout(checkBirthdays, 2000);
		return () => clearTimeout(timer);
	}, [user]);

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
	const quickLinks = [
		{
			href: '#users',
			icon: 'fas fa-users-cog',
			title: 'Employee Management',
			summary: 'Register Front Desk & Clinical Team staff.',
		},
		{
			href: '#patients',
			icon: 'fas fa-user-injured',
			title: 'Patient Management',
			summary: 'Search, add, and export patient records.',
		},
		{
			href: '#appointments',
			icon: 'fas fa-calendar-alt',
			title: 'Appointments',
			summary: 'Coordinate schedules and manage bookings.',
		},
		{
			href: '#billing',
			icon: 'fas fa-file-invoice-dollar',
			title: 'Billing & Payments',
			summary: 'Track invoices and payment status.',
		},
		{
			href: '#analytics',
			icon: 'fas fa-chart-bar',
			title: 'Analytics',
			summary: 'Monitor performance trends and exports.',
		},
	];

	// Load patients from Firestore
	useEffect(() => {
		const unsubscribe = onSnapshot(
			collection(db, 'patients'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data() as Record<string, unknown>;
					return {
						id: docSnap.id,
						patientId: data.patientId ? String(data.patientId) : '',
						name: data.name ? String(data.name) : '',
						status: (data.status as AdminPatientStatus) ?? 'pending',
					} as PatientRecord;
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
					return {
						id: docSnap.id,
						patientId: data.patientId ? String(data.patientId) : '',
						patient: data.patient ? String(data.patient) : '',
						doctor: data.doctor ? String(data.doctor) : '',
						date: data.date ? String(data.date) : '',
						status: (data.status as AdminAppointmentStatus) ?? 'pending',
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

	// Load users from Firestore
	useEffect(() => {
		const unsubscribe = onSnapshot(
			collection(db, 'users'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data() as Record<string, unknown>;
					return {
						id: docSnap.id,
						email: data.email ? String(data.email) : '',
						role: data.role ? String(data.role) : '',
						status: data.status ? String(data.status) : '',
					} as UserRecord;
				});
				setUsers(mapped.filter(u => u.status === 'Active'));
			},
			error => {
				console.error('Failed to load users', error);
				setUsers([]);
			}
		);
		return () => unsubscribe();
	}, []);

	// Calculate statistics
	const stats = useMemo(() => {
		const pending = patients.filter(p => p.status === 'pending');
		const ongoing = patients.filter(p => p.status === 'ongoing');
		const completed = patients.filter(p => p.status === 'completed');

		const today = new Date().toISOString().split('T')[0];
		const todayAppointments = appointments.filter(apt => apt.date === today && apt.status !== 'cancelled');
		const thisWeekAppointments = appointments.filter(apt => {
			const aptDate = new Date(apt.date);
			const weekAgo = new Date();
			weekAgo.setDate(weekAgo.getDate() - 7);
			return aptDate >= weekAgo && apt.status !== 'cancelled';
		});

		const appointmentsByStaff = staff.map(member => ({
			staffName: member.userName,
			count: appointments.filter(apt => apt.doctor === member.userName && apt.status !== 'cancelled').length,
		}));

		return {
			totalPatients: patients.length,
			pending,
			ongoing,
			completed,
			totalAppointments: appointments.filter(apt => apt.status !== 'cancelled').length,
			todayAppointments: todayAppointments.length,
			thisWeekAppointments: thisWeekAppointments.length,
			appointmentsByStaff,
			activeStaff: staff.length,
			activeUsers: users.length,
		};
	}, [patients, appointments, staff, users]);

	// Chart data for appointment trends
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
					borderColor: '#3b82f6',
					backgroundColor: 'rgba(59, 130, 246, 0.15)',
					fill: true,
					tension: 0.4,
					pointRadius: 5,
					pointHoverRadius: 7,
					pointBackgroundColor: '#ffffff',
					pointBorderColor: '#3b82f6',
					pointBorderWidth: 2,
					pointHoverBackgroundColor: '#3b82f6',
					pointHoverBorderColor: '#ffffff',
					pointHoverBorderWidth: 3,
					borderWidth: 3,
					shadowOffsetX: 0,
					shadowOffsetY: 4,
					shadowBlur: 10,
					shadowColor: 'rgba(59, 130, 246, 0.3)',
				},
			],
		};
	}, [appointments]);

	// Chart data for patient status distribution
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
					borderWidth: 3,
					hoverBorderWidth: 4,
					hoverOffset: 8,
					spacing: 2,
				},
			],
		};
	}, [stats.pending.length, stats.ongoing.length, stats.completed.length]);

	// Chart data for staff workload
	const staffLoadData = useMemo(() => {
		const activeStaff = stats.appointmentsByStaff.filter(member => member.count > 0);
		const hasData = activeStaff.length > 0;
		const labels = hasData ? activeStaff.map(member => member.staffName || 'Unassigned') : ['No data'];
		const data = hasData ? activeStaff.map(member => member.count) : [0];

		return {
			labels,
			datasets: [
				{
					label: 'Active appointments',
					data,
					backgroundColor: hasData ? 'rgba(59, 130, 246, 0.5)' : 'rgba(148, 163, 184, 0.4)',
					borderColor: hasData ? '#3b82f6' : '#94a3b8',
					borderWidth: 2,
					borderRadius: 8,
					borderSkipped: false,
					barThickness: 'flex' as const,
					maxBarThickness: 50,
				},
			],
		};
	}, [stats.appointmentsByStaff]);

	const handleQuickLinkClick = (href: string) => {
		if (onNavigate) {
			onNavigate(href);
		}
	};

	const ICON_WRAPPER =
		'flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-600 transition group-hover:bg-gradient-to-r group-hover:from-blue-700 group-hover:via-blue-600 group-hover:to-blue-500 group-hover:text-white group-focus-visible:bg-gradient-to-r group-focus-visible:from-blue-700 group-focus-visible:via-blue-600 group-focus-visible:to-blue-500 group-focus-visible:text-white';

	return (
		<div className="min-h-svh bg-purple-50 px-6 py-10">
			<div className="mx-auto max-w-6xl space-y-10">
				<PageHeader
					title="Admin Dashboard"
					description="Manage staff, monitor operations, and jump into core tooling without leaving this workspace."
					statusCard={{
						label: 'Today\'s Overview',
						value: (
							<div className="flex items-center gap-3">
								{userProfile.profileImage ? (
									<img
										src={userProfile.profileImage}
										alt={userProfile.userName || 'User'}
										className="h-10 w-10 rounded-full object-cover border-2 border-blue-300 cursor-pointer hover:border-blue-500 transition"
										onClick={() => onNavigate && onNavigate('#profile')}
										title="Click to view profile"
									/>
								) : (
									<div 
										className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-200 border-2 border-blue-300 cursor-pointer hover:border-blue-500 transition"
										onClick={() => onNavigate && onNavigate('#profile')}
										title="Click to view profile"
									>
										<i className="fas fa-user text-blue-700 text-sm" aria-hidden="true" />
									</div>
								)}
								<span 
									className="cursor-pointer hover:text-blue-700 transition text-blue-900 font-semibold"
									onClick={() => onNavigate && onNavigate('#profile')}
									title="Click to view profile"
								>
									{userProfile.userName || user?.displayName || 'Admin'}
								</span>
							</div>
						),
						subtitle: (
							<>
								{stats.activeStaff} active staff · {stats.totalPatients} total patients
							</>
						),
					}}
				/>

				{/* Divider */}
				<div className="border-t border-blue-200" />

				{/* Quick Actions Section */}
				<section>
					<div className="mb-6">
						<h2 className="text-xl font-semibold text-blue-900">Quick Actions</h2>
						<p className="mt-1 text-sm text-blue-700">
							Access core management tools and system functions
						</p>
					</div>
					<div
						className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
						aria-label="Admin quick actions"
					>
						{quickLinks.map(link => (
						<button
							key={link.href}
							type="button"
							onClick={() => handleQuickLinkClick(link.href)}
							className="group rounded-3xl bg-white border border-blue-200 px-6 py-5 shadow-lg hover:shadow-blue-200 transition-all hover:scale-[1.02] gap-3 flex flex-col"
						>
								<span className={ICON_WRAPPER} aria-hidden="true">
									<i className={link.icon} />
								</span>
								<div>
									<h3 className="text-lg font-semibold text-blue-900">{link.title}</h3>
									<p className="mt-1 text-sm text-blue-700">{link.summary}</p>
								</div>
								<span className="mt-auto inline-flex items-center text-sm font-semibold text-blue-600 group-hover:text-blue-700 group-focus-visible:text-blue-700">
									Open <i className="fas fa-arrow-right ml-2 text-xs" aria-hidden="true" />
								</span>
							</button>
						))}
					</div>
				</section>

				{/* Divider */}
				<div className="border-t border-blue-200" />

				{/* Analytics Section */}
				<section>
					<div className="rounded-3xl bg-white border border-blue-200 p-6 shadow-lg space-y-6">
						<div className="flex items-center justify-between">
							<div>
								<h2 className="text-xl font-semibold text-blue-900">Analytics Overview</h2>
								<p className="mt-1 text-sm text-blue-700">
							Visualize system-wide metrics, patient distribution, and team workload in real time.
						</p>
							</div>
							<i className="fas fa-chart-line text-blue-600 text-2xl" aria-hidden="true" />
						</div>
						<div className="grid gap-6 lg:grid-cols-2">
							<div className="rounded-2xl border border-blue-200 bg-white p-5 shadow-lg hover:shadow-xl transition-shadow duration-300">
								<p className="text-sm font-semibold text-blue-900 mb-1">Weekly Appointment Trend</p>
								<p className="text-xs text-blue-700 mb-4">Includes the last 7 days of confirmed sessions.</p>
								<div className="mt-2">
									<StatsChart type="line" data={appointmentTrendData} height={260} />
								</div>
							</div>
							<div className="grid gap-6 sm:grid-cols-2">
								<div className="rounded-2xl border border-blue-200 bg-white p-5 shadow-lg hover:shadow-xl transition-shadow duration-300">
									<p className="text-sm font-semibold text-blue-900 mb-1">Patient Status Mix</p>
									<p className="text-xs text-blue-700 mb-4">Pending vs. ongoing vs. completed.</p>
									<div className="mt-2">
										<StatsChart type="doughnut" data={statusDistributionData} height={220} />
									</div>
								</div>
								<div className="rounded-2xl border border-blue-200 bg-white p-5 shadow-lg hover:shadow-xl transition-shadow duration-300">
									<p className="text-sm font-semibold text-blue-900 mb-1">Team Workload</p>
									<p className="text-xs text-blue-700 mb-4">Active appointments by clinician.</p>
									<div className="mt-2">
										<StatsChart type="bar" data={staffLoadData} height={220} />
									</div>
								</div>
							</div>
						</div>
					</div>
				</section>

				{/* Divider */}
				<div className="border-t border-blue-200" />

				{/* Operations & Resources Section */}
				<section>
					<div className="mb-6">
						<h2 className="text-xl font-semibold text-blue-900">Operations & Resources</h2>
						<p className="mt-1 text-sm text-blue-700">
							Monitor daily operations and access helpful resources
						</p>
					</div>
					<div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
						<div className="rounded-3xl bg-white border border-blue-200 p-6 shadow-lg">
							<h3 className="text-lg font-semibold text-blue-900">Operational Snapshot</h3>
							<p className="mt-1 text-sm text-blue-700">
								Keep tabs on the day-to-day so handoffs stay smooth across teams.
							</p>
							<ul className="mt-4 space-y-3 text-sm text-blue-800">
								<li className="flex items-start gap-2">
									<i className="fas fa-user-shield mt-1 text-blue-600" aria-hidden="true" />
									<span>Review pending staff invites to ensure new hires have access on day one.</span>
								</li>
								<li className="flex items-start gap-2">
									<i className="fas fa-file-alt mt-1 text-blue-600" aria-hidden="true" />
									<span>Export the latest patient roster before daily stand-up for quick reference.</span>
								</li>
								<li className="flex items-start gap-2">
									<i className="fas fa-bell mt-1 text-blue-600" aria-hidden="true" />
									<span>Check calendar notifications for schedule conflicts flagged overnight.</span>
								</li>
							</ul>
						</div>
						<div className="rounded-3xl bg-white border border-blue-200 p-6 shadow-lg">
							<h3 className="text-lg font-semibold text-blue-900">Need A Quick Link?</h3>
							<ul className="mt-4 space-y-3 text-sm text-blue-800">
								<li>
									<button
										type="button"
										onClick={() => handleQuickLinkClick('#analytics')}
										className="inline-flex items-center text-blue-600 hover:text-blue-700 transition"
									>
										<i className="fas fa-chart-line mr-2 text-xs" aria-hidden="true" />
										View performance overview
									</button>
								</li>
								<li>
									<button
										type="button"
										onClick={() => handleQuickLinkClick('#billing')}
										className="inline-flex items-center text-blue-600 hover:text-blue-700 transition"
									>
										<i className="fas fa-wallet mr-2 text-xs" aria-hidden="true" />
										Reconcile outstanding invoices
									</button>
								</li>
							</ul>
						</div>
					</div>
				</section>
			</div>
		</div>
	);
}

