'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar, { type SidebarLink } from '@/components/Sidebar';
import Dashboard from '@/components/clinical-team/Dashboard';
import Calendar from '@/components/clinical-team/Calendar';
import EditReport from '@/components/clinical-team/EditReport';
import Availability from '@/components/clinical-team/Availability';
import Appointments from '@/components/clinical-team/Appointments';
import Notifications from '@/components/admin/Notifications';
import Profile from '@/components/Profile';
import TransferManagement from '@/components/clinical-team/TransferManagement';
import MyPerformance from '@/components/clinical-team/MyPerformance';
import PerformanceRating from '@/components/clinical-team/PerformanceRating';
import InventoryManagement from '@/components/InventoryManagement';
import LeaveManagement from '@/components/LeaveManagement';
import Billing from '@/components/clinical-team/Billing';
import StrengthConditioningReport from '@/components/clinical-team/StrengthConditioningReport';
import { useAuth } from '@/contexts/AuthContext';

type ClinicalTeamPage = 'dashboard' | 'calendar' | 'edit-report' | 'strength-conditioning-report' | 'availability' | 'transfer' | 'appointments' | 'notifications' | 'inventory' | 'leave' | 'profile' | 'my-performance' | 'performance-rating' | 'billing';

const clinicalTeamLinks: SidebarLink[] = [
	{ href: '#dashboard', label: 'Dashboard', icon: 'fas fa-dumbbell' },
	{ href: '#calendar', label: 'Calendar', icon: 'fas fa-calendar-week' },
	{ href: '#appointments', label: 'Patient Management', icon: 'fas fa-calendar-check' },
	{ href: '#billing', label: 'Billing', icon: 'fas fa-file-invoice-dollar' },
	{ href: '#notifications', label: 'Notifications & Messaging', icon: 'fas fa-bell' },
	{ href: '#inventory', label: 'Inventory Management', icon: 'fas fa-boxes' },
	{ href: '#leave', label: 'Leave Management', icon: 'fas fa-calendar-times' },
	{ href: '#edit-report', label: 'View/Edit Reports', icon: 'fas fa-notes-medical' },
	{ href: '#availability', label: 'My Availability', icon: 'fas fa-calendar-check' },
	{ href: '#transfer', label: 'Transfer Management', icon: 'fas fa-exchange-alt' },
	{ href: '#my-performance', label: 'My Performance', icon: 'fas fa-chart-line' },
	{ href: '#performance-rating', label: 'Performance Rating', icon: 'fas fa-star' },
];

export default function ClinicalTeamLayout({ children }: { children: React.ReactNode }) {
	const pathname = usePathname();
	const router = useRouter();
	const { user, loading } = useAuth();
	const [activePage, setActivePage] = useState<ClinicalTeamPage>('dashboard');
	const isNavigatingRef = useRef(false);

	// Authorized raters who can access Performance Rating
	const AUTHORIZED_RATERS = ['dharanjaydubey@css.com', 'shajisp@css.com'];
	const isAuthorizedRater = user?.email && AUTHORIZED_RATERS.includes(user.email.toLowerCase());

	// Role guard: only Clinical team can access /clinical-team (except authorized raters)
	useEffect(() => {
		if (loading) return;

		if (!user) {
			router.replace('/login');
			return;
		}

		const role = user.role;
		const isClinical =
			role === 'ClinicalTeam' || role === 'clinic' || role === 'Clinic';

		// Allow authorized raters to access the clinical team dashboard
		if (!isClinical && !isAuthorizedRater) {
			if (role === 'Admin' || role === 'admin') {
				router.replace('/admin');
			} else if (role === 'FrontDesk' || role === 'frontdesk') {
				router.replace('/frontdesk');
			} else {
				router.replace('/login');
			}
		}
	}, [user, loading, router, isAuthorizedRater]);

	// Detect route from pathname
	useEffect(() => {
		// Don't override if we're intentionally navigating
		if (isNavigatingRef.current) {
			isNavigatingRef.current = false;
			return;
		}

		if (pathname?.includes('/strength-conditioning-report')) {
			setActivePage('strength-conditioning-report');
		} else if (pathname?.includes('/edit-report')) {
			setActivePage('edit-report');
		} else if (pathname?.includes('/calendar')) {
			setActivePage('calendar');
		} else if (pathname?.includes('/appointments')) {
			setActivePage('appointments');
		} else if (pathname?.includes('/billing')) {
			setActivePage('billing');
		} else if (pathname?.includes('/notifications')) {
			setActivePage('notifications');
		} else if (pathname?.includes('/inventory')) {
			setActivePage('inventory');
		} else if (pathname?.includes('/leave')) {
			setActivePage('leave');
		} else if (pathname?.includes('/availability')) {
			setActivePage('availability');
		} else if (pathname?.includes('/transfer')) {
			setActivePage('transfer');
		} else if (pathname?.includes('/profile')) {
			setActivePage('profile');
		} else if (pathname?.includes('/my-performance')) {
			setActivePage('my-performance');
		} else if (pathname?.includes('/performance-rating')) {
			setActivePage('performance-rating');
		}
		// Don't set to dashboard when on base route - let hash navigation handle it
	}, [pathname]);

	const handleLinkClick = (href: string) => {
		const page = href.replace('#', '') as ClinicalTeamPage;
		
		// If we're on a direct route, navigate back to base route first
		if (pathname !== '/clinical-team') {
			isNavigatingRef.current = true;
			setActivePage(page);
			router.push('/clinical-team');
		} else {
			setActivePage(page);
		}
	};

	const handleProfileClick = () => {
		const page = 'profile' as ClinicalTeamPage;
		if (pathname !== '/clinical-team') {
			isNavigatingRef.current = true;
			setActivePage(page);
			router.push('/clinical-team');
		} else {
			setActivePage(page);
		}
	};

	const renderPage = () => {
		// If we're on a direct route (children exists and is not null), render children
		// Otherwise use hash-based navigation
		if (children && pathname !== '/clinical-team') {
			return children;
		}

		switch (activePage) {
			case 'dashboard':
				return <Dashboard onNavigate={handleLinkClick} />;
			case 'calendar':
				return <Calendar />;
			case 'appointments':
				return <Appointments />;
			case 'billing':
				return <Billing />;
		case 'notifications':
			return <Notifications />;
		case 'inventory':
			return <InventoryManagement />;
		case 'leave':
			return <LeaveManagement />;
		case 'edit-report':
			return <EditReport />;
		case 'strength-conditioning-report':
			return <StrengthConditioningReport />;
			case 'availability':
				return <Availability />;
			case 'transfer':
				return <TransferManagement />;
			case 'profile':
				return <Profile />;
			case 'my-performance':
				return <MyPerformance />;
			case 'performance-rating':
				return <PerformanceRating />;
			default:
				return <Dashboard onNavigate={handleLinkClick} />;
		}
	};

	// Avoid flashing clinical UI while checking auth / redirecting
	// Allow authorized raters even if they don't have ClinicalTeam role
	const hasAccess = user && (
		user.role === 'ClinicalTeam' || 
		user.role === 'clinic' || 
		user.role === 'Clinic' ||
		isAuthorizedRater
	);

	if (loading || !user || !hasAccess) {
		return (
			<div className="min-h-svh flex items-center justify-center bg-purple-50">
				<div className="text-slate-600 text-sm">Checking access…</div>
			</div>
		);
	}

	return (
		<div className="min-h-svh bg-purple-50">
			<Sidebar
				title="Clinical Team"
				links={clinicalTeamLinks}
				onLinkClick={handleLinkClick}
				activeHref={`#${activePage}`}
				onProfileClick={handleProfileClick}
			/>
			<main className="ml-64 min-h-svh overflow-y-auto bg-purple-50">{renderPage()}</main>
		</div>
	);
}
