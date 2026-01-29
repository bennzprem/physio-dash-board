'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar, { type SidebarLink } from '@/components/Sidebar';
import Dashboard from '@/components/frontdesk/Dashboard';
import Patients from '@/components/frontdesk/Patients';
import Billing from '@/components/frontdesk/Billing';
import Calendar from '@/components/frontdesk/Calendar';
import Profile from '@/components/Profile';
import Notifications from '@/components/admin/Notifications';
import InventoryManagement from '@/components/InventoryManagement';
import LeaveManagement from '@/components/LeaveManagement';
import SOPViewer from '@/components/SOPViewer';
import InternshipManagement from '@/components/frontdesk/InternshipManagement';
import Requests from '@/components/frontdesk/Requests';
import { useAuth } from '@/contexts/AuthContext';

type FrontdeskPage = 'dashboard' | 'patients' | 'billing' | 'calendar' | 'notifications' | 'inventory' | 'leave' | 'profile' | 'sop' | 'internships' | 'requests';

const frontdeskLinks: SidebarLink[] = [
	{ href: '#dashboard', label: 'Dashboard', icon: 'fas fa-home' },
	{ href: '#patients', label: 'Patient Management', icon: 'fas fa-users' },
	{ href: '#requests', label: 'Requests', icon: 'fas fa-inbox' },
	{ href: '#calendar', label: 'Calendar', icon: 'fas fa-calendar-alt' },
	{ href: '#billing', label: 'Billing', icon: 'fas fa-file-invoice-dollar' },
	{ href: '#notifications', label: 'Notifications & Messaging', icon: 'fas fa-bell' },
	{ href: '#inventory', label: 'Inventory Management', icon: 'fas fa-boxes' },
	{ href: '#leave', label: 'Leave Management', icon: 'fas fa-calendar-times' },
	{ href: '#internships', label: 'Internships', icon: 'fas fa-graduation-cap' },
	{ href: '#sop', label: 'SOP Document', icon: 'fas fa-file-alt' },
];

export default function FrontdeskLayout({ children }: { children: React.ReactNode }) {
	const router = useRouter();
	const { user, loading } = useAuth();
	const [activePage, setActivePage] = useState<FrontdeskPage>('dashboard');

	// Role guard: only FrontDesk can access /frontdesk
	useEffect(() => {
		if (loading) return;

		if (!user) {
			router.replace('/login');
			return;
		}

		if (user.role !== 'FrontDesk') {
			if (user.role === 'Admin' || user.role === 'admin') {
				router.replace('/admin');
			} else if (user.role === 'ClinicalTeam' || user.role === 'clinic' || user.role === 'Clinic') {
				router.replace('/clinical-team');
			} else {
				router.replace('/login');
			}
		}
	}, [user, loading, router]);

	const handleLinkClick = (href: string) => {
		const page = href.replace('#', '') as FrontdeskPage;
		setActivePage(page);
	};

	const handleProfileClick = () => {
		setActivePage('profile');
	};

		// Listen for hash changes and navigation events
		useEffect(() => {
			const handleHashChange = () => {
				const hash = window.location.hash.replace('#', '');
				if (hash && ['dashboard', 'patients', 'calendar', 'billing', 'notifications', 'inventory', 'leave', 'profile', 'sop', 'internships', 'requests'].includes(hash)) {
					setActivePage(hash as FrontdeskPage);
				}
			};

			// Check initial hash
			handleHashChange();

			// Listen for hash changes
			window.addEventListener('hashchange', handleHashChange);
			
			// Listen for custom navigation events
			const handleCustomNav = (event: CustomEvent) => {
				const page = event.detail?.page;
				if (page && ['dashboard', 'patients', 'calendar', 'billing', 'notifications', 'inventory', 'leave', 'profile', 'sop', 'internships', 'requests'].includes(page)) {
					setActivePage(page as FrontdeskPage);
				}
			};
		
		window.addEventListener('navigateToPage', handleCustomNav as EventListener);

		return () => {
			window.removeEventListener('hashchange', handleHashChange);
			window.removeEventListener('navigateToPage', handleCustomNav as EventListener);
		};
	}, []);

	const renderPage = () => {
		switch (activePage) {
			case 'dashboard':
				return <Dashboard onNavigate={handleLinkClick} />;
			case 'patients':
				return <Patients />;
			case 'requests':
				return <Requests />;
			case 'calendar':
				return <Calendar />;
			case 'billing':
				return <Billing />;
		case 'notifications':
			return <Notifications />;
		case 'inventory':
			return <InventoryManagement />;
		case 'leave':
			return <LeaveManagement />;
		case 'internships':
			return <InternshipManagement />;
		case 'profile':
			return <Profile />;
		case 'sop':
			return <SOPViewer />;
		default:
			return <Dashboard onNavigate={handleLinkClick} />;
		}
	};

	// Avoid flashing UI while checking auth / redirecting
	if (loading || !user || user.role !== 'FrontDesk') {
		return (
			<div className="min-h-svh flex items-center justify-center bg-purple-50">
				<div className="text-slate-600 text-sm">Checking access…</div>
			</div>
		);
	}

	return (
		<div className="min-h-svh bg-purple-50">
			<Sidebar
				title="Front Desk"
				links={frontdeskLinks}
				onLinkClick={handleLinkClick}
				activeHref={`#${activePage}`}
				onProfileClick={handleProfileClick}
			/>
			<main className="ml-72 min-h-svh overflow-y-auto bg-purple-50">{renderPage()}</main>
		</div>
	);
}
