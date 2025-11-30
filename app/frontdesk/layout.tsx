'use client';

import { useState, useEffect } from 'react';
import Sidebar, { type SidebarLink } from '@/components/Sidebar';
import Dashboard from '@/components/frontdesk/Dashboard';
import Patients from '@/components/frontdesk/Patients';
import Billing from '@/components/frontdesk/Billing';
import Calendar from '@/components/frontdesk/Calendar';
import Profile from '@/components/Profile';

type FrontdeskPage = 'dashboard' | 'patients' | 'billing' | 'calendar' | 'profile';

const frontdeskLinks: SidebarLink[] = [
	{ href: '#dashboard', label: 'Dashboard', icon: 'fas fa-home' },
	{ href: '#patients', label: 'Patient Management', icon: 'fas fa-users' },
	{ href: '#calendar', label: 'Calendar', icon: 'fas fa-calendar-alt' },
	{ href: '#billing', label: 'Billing', icon: 'fas fa-file-invoice-dollar' },
];

export default function FrontdeskLayout({ children }: { children: React.ReactNode }) {
	const [activePage, setActivePage] = useState<FrontdeskPage>('dashboard');

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
			if (hash && ['dashboard', 'patients', 'calendar', 'billing', 'profile'].includes(hash)) {
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
			if (page && ['dashboard', 'patients', 'calendar', 'billing', 'profile'].includes(page)) {
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
			case 'calendar':
				return <Calendar />;
			case 'billing':
				return <Billing />;
			case 'profile':
				return <Profile />;
			default:
				return <Dashboard onNavigate={handleLinkClick} />;
		}
	};

	return (
		<div className="min-h-svh bg-purple-50">
			<Sidebar
				title="Front Desk"
				links={frontdeskLinks}
				onLinkClick={handleLinkClick}
				activeHref={`#${activePage}`}
				onProfileClick={handleProfileClick}
			/>
			<main className="ml-64 min-h-svh overflow-y-auto bg-purple-50">{renderPage()}</main>
		</div>
	);
}
