'use client';

import { useState } from 'react';
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

type AdminPage = 'dashboard' | 'users' | 'patients' | 'appointments' | 'billing' | 'reports' | 'calendar' | 'calendar-appointments' | 'audit' | 'seed' | 'headers' | 'notifications' | 'profile';

const adminLinks: SidebarLink[] = [
	{ href: '#dashboard', label: 'Dashboard', icon: 'fas fa-columns' },
	{ href: '#users', label: 'Employee Management', icon: 'fas fa-users-cog' },
	{ href: '#patients', label: 'Patient Management', icon: 'fas fa-user-injured' },
	{ href: '#calendar-appointments', label: 'Calendar & Appointments', icon: 'fas fa-calendar-check' },
	{ href: '#billing', label: 'Billing & Payments', icon: 'fas fa-file-invoice-dollar' },
	{ href: '#reports', label: 'Reports & Analytics', icon: 'fas fa-chart-pie' },
	{ href: '#notifications', label: 'Notifications', icon: 'fas fa-bell' },
	{ href: '#headers', label: 'Header Management', icon: 'fas fa-heading' },
	{ href: '#audit', label: 'Audit Logs', icon: 'fas fa-clipboard-list' },
	{ href: '#seed', label: 'Seed Data', icon: 'fas fa-database' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
	const [activePage, setActivePage] = useState<AdminPage>('dashboard');

	const handleLinkClick = (href: string) => {
		const page = href.replace('#', '') as AdminPage;
		setActivePage(page);
	};

	const handleProfileClick = () => {
		setActivePage('profile');
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
			case 'reports':
				return <Reports />;
			case 'headers':
				return <HeaderManagement />;
			case 'seed':
				return <Seed />;
		case 'audit':
			return <AuditLogs />;
		case 'notifications':
			return <Notifications />;
		case 'profile':
			return <Profile />;
		default:
			return <Dashboard onNavigate={handleLinkClick} />;
		}
	};

	return (
		<div className="min-h-svh bg-purple-50">
			<Sidebar 
				title="Admin" 
				links={adminLinks} 
				onLinkClick={handleLinkClick}
				activeHref={`#${activePage}`}
				onProfileClick={handleProfileClick}
			/>
			<main className="ml-64 min-h-svh overflow-y-auto bg-purple-50">{renderPage()}</main>
		</div>
	);
}

