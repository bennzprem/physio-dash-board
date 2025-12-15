'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar, { type SidebarLink } from '@/components/Sidebar';
import Dashboard from '@/components/admin/Dashboard';
import Users from '@/components/admin/Users';
import Patients from '@/components/admin/Patients';
import CalendarAppointments from '@/components/admin/CalendarAppointments';
import Billing from '@/components/admin/Billing';
import Reports from '@/components/admin/Reports';
import Seed from '@/components/admin/Seed';
import AuditLogs from '@/components/admin/AuditLogs';
import HeaderManagement from '@/components/admin/HeaderManagement';
import Notifications from '@/components/admin/Notifications';
import Profile from '@/components/Profile';
import InventoryManagement from '@/components/InventoryManagement';
import LeaveManagement from '@/components/LeaveManagement';
import AdminLeaveManagement from '@/components/admin/LeaveManagement';
import LeaveRequestNotification from '@/components/admin/LeaveRequestNotification';
import RatingApprovals from '@/components/admin/RatingApprovals';
import PerformanceRating from '@/components/clinical-team/PerformanceRating';
import { useAuth } from '@/contexts/AuthContext';

type AdminPage = 'dashboard' | 'users' | 'patients' | 'appointments' | 'billing' | 'analytics' | 'calendar' | 'calendar-appointments' | 'audit' | 'seed' | 'headers' | 'notifications' | 'inventory' | 'leave' | 'profile' | 'rating-approvals' | 'performance-rating';

const adminLinks: SidebarLink[] = [
	{ href: '#dashboard', label: 'Dashboard', icon: 'fas fa-columns' },
	{ href: '#users', label: 'Employee Management', icon: 'fas fa-users-cog' },
	{ href: '#patients', label: 'Patient Management', icon: 'fas fa-user-injured' },
	{ href: '#calendar-appointments', label: 'Calendar & Appointments', icon: 'fas fa-calendar-check' },
	{ href: '#billing', label: 'Billing & Payments', icon: 'fas fa-file-invoice-dollar' },
	{ href: '#analytics', label: 'Analytics', icon: 'fas fa-chart-pie' },
	{ href: '#notifications', label: 'Notifications & Messaging', icon: 'fas fa-bell' },
	{ href: '#inventory', label: 'Inventory Management', icon: 'fas fa-boxes' },
	{ href: '#leave', label: 'Leave Management', icon: 'fas fa-calendar-times' },
	{ href: '#headers', label: 'Header Management', icon: 'fas fa-heading' },
	{ href: '#audit', label: 'Audit Logs', icon: 'fas fa-clipboard-list' },
	{ href: '#seed', label: 'Seed Data', icon: 'fas fa-database' },
	{ href: '#rating-approvals', label: 'Rating Approvals', icon: 'fas fa-check-circle' },
	{ href: '#performance-rating', label: 'Performance Rating', icon: 'fas fa-star' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
	const router = useRouter();
	const { user, loading } = useAuth();
	const [activePage, setActivePage] = useState<AdminPage>('dashboard');

	// Check if user is an authorized rater
	const AUTHORIZED_RATERS = ['dharanjaydubey@css.com', 'shajisp@css.com'];
	const isAuthorizedRater = user?.email && AUTHORIZED_RATERS.includes(user.email.toLowerCase());

	// Simple client-side role guard: only Admin can access /admin
	useEffect(() => {
		if (loading) return;

		// Not logged in -> go to login
		if (!user) {
			router.replace('/login');
			return;
		}

		// If not admin, redirect to their own dashboard
		if (user.role !== 'Admin') {
			if (user.role === 'FrontDesk') {
				router.replace('/frontdesk');
			} else if (user.role === 'ClinicalTeam' || user.role === 'clinic' || user.role === 'Clinic') {
				router.replace('/clinical-team');
			} else {
				router.replace('/login');
			}
		}
	}, [user, loading, router]);

	const handleLinkClick = (href: string) => {
		const page = href.replace('#', '') as AdminPage;
		setActivePage(page);
	};

	const handleProfileClick = () => {
		setActivePage('profile');
	};

	const handleNavigateToLeave = () => {
		setActivePage('leave');
	};

	const renderPage = () => {
		switch (activePage) {
			case 'dashboard':
				return <Dashboard onNavigate={handleLinkClick} />;
			case 'users':
				return <Users />;
			case 'patients':
				return <Patients />;
			case 'appointments':
			case 'calendar':
			case 'calendar-appointments':
				return <CalendarAppointments />;
			case 'billing':
				return <Billing />;
		case 'analytics':
				return <Reports />;
			case 'headers':
				return <HeaderManagement />;
			case 'seed':
				return <Seed />;
		case 'audit':
			return <AuditLogs />;
		case 'notifications':
			return <Notifications />;
		case 'inventory':
			return <InventoryManagement />;
		case 'leave':
			return <AdminLeaveManagement />;
		case 'profile':
			return <Profile />;
		case 'rating-approvals':
			return <RatingApprovals />;
		case 'performance-rating':
			return <PerformanceRating />;
		default:
			return <Dashboard onNavigate={handleLinkClick} />;
		}
	};

	// While checking auth/redirecting, avoid flashing the admin UI
	if (loading || !user || user.role !== 'Admin') {
		return (
			<div className="min-h-svh flex items-center justify-center bg-purple-50">
				<div className="text-slate-600 text-sm">Checking access…</div>
			</div>
		);
	}

	// Filter links based on user permissions
	const filteredAdminLinks = adminLinks.filter(link => {
		// Only show Performance Rating to authorized raters
		if (link.href === '#performance-rating' && !isAuthorizedRater) {
			return false;
		}
		return true;
	});

	return (
		<div className="min-h-svh bg-purple-50">
			<LeaveRequestNotification onNavigateToLeave={handleNavigateToLeave} />
			<Sidebar 
				title="Admin" 
				links={filteredAdminLinks} 
				onLinkClick={handleLinkClick}
				activeHref={`#${activePage}`}
				onProfileClick={handleProfileClick}
			/>
			<main className="ml-64 min-h-svh overflow-y-auto bg-purple-50">{renderPage()}</main>
		</div>
	);
}

