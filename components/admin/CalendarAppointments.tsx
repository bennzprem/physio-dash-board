'use client';

import { useState } from 'react';
import Calendar from '@/components/admin/Calendar';
import Appointments from '@/components/admin/Appointments';
import PageHeader from '@/components/PageHeader';

type TabType = 'calendar' | 'appointments';

export default function CalendarAppointments() {
	const [activeTab, setActiveTab] = useState<TabType>('calendar');

	return (
		<div className="min-h-svh bg-slate-50 px-6 py-10">
			<div className="mx-auto max-w-7xl space-y-6">
				<PageHeader
					title="Calendar & Appointments"
				/>

				{/* Tab Navigation */}
				<div className="flex items-center gap-2 border-b border-slate-200 bg-white rounded-t-xl px-4">
					<button
						type="button"
						onClick={() => setActiveTab('calendar')}
						className={`px-6 py-3 text-sm font-semibold transition-all relative ${
							activeTab === 'calendar'
								? 'text-sky-700'
								: 'text-slate-600 hover:text-slate-900'
						}`}
					>
						<i className={`fas fa-calendar-alt mr-2 ${activeTab === 'calendar' ? 'text-sky-600' : 'text-slate-500'}`} aria-hidden="true" />
						Calendar View
						{activeTab === 'calendar' && (
							<span className="absolute bottom-0 left-0 right-0 h-0.5 bg-sky-600" />
						)}
					</button>
					<button
						type="button"
						onClick={() => setActiveTab('appointments')}
						className={`px-6 py-3 text-sm font-semibold transition-all relative ${
							activeTab === 'appointments'
								? 'text-sky-700'
								: 'text-slate-600 hover:text-slate-900'
						}`}
					>
						<i className={`fas fa-list mr-2 ${activeTab === 'appointments' ? 'text-sky-600' : 'text-slate-500'}`} aria-hidden="true" />
						Appointments List
						{activeTab === 'appointments' && (
							<span className="absolute bottom-0 left-0 right-0 h-0.5 bg-sky-600" />
						)}
					</button>
				</div>

				{/* Tab Content */}
				<div className="bg-white rounded-b-xl shadow-sm">
					{activeTab === 'calendar' ? <Calendar /> : <Appointments />}
				</div>
			</div>
		</div>
	);
}

