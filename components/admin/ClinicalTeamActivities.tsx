'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, orderBy, type QuerySnapshot, type Timestamp } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { db } from '@/lib/firebase';
import PageHeader from '@/components/PageHeader';
import { useAuth } from '@/contexts/AuthContext';

interface ActivityRecord {
	id: string;
	staffId?: string;
	staffEmail?: string;
	staffName?: string;
	activityType?: string;
	description?: string;
	startTime?: string;
	endTime?: string;
	date?: string;
	createdAt?: string | Timestamp;
	updatedAt?: string | Timestamp;
}

interface StaffMember {
	id: string;
	userName: string;
	userEmail?: string;
	role?: string;
}

export default function ClinicalTeamActivities() {
	const { user } = useAuth();
	const [activities, setActivities] = useState<ActivityRecord[]>([]);
	const [staff, setStaff] = useState<StaffMember[]>([]);
	const [loading, setLoading] = useState(true);

	// Check if user is the exclusive Super Admin
	const isExclusiveSuperAdmin = user?.email?.toLowerCase() === 'antonychacko@css.com';

	// Redirect or show error if not authorized
	if (!isExclusiveSuperAdmin) {
		return (
			<div className="min-h-svh bg-slate-50 px-6 py-10">
				<div className="mx-auto max-w-6xl">
					<div className="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center">
						<i className="fas fa-lock text-4xl text-rose-600 mb-4" aria-hidden="true" />
						<h2 className="text-2xl font-bold text-rose-900 mb-2">Access Restricted</h2>
						<p className="text-rose-700">This feature is only available to authorized Super Admin users.</p>
					</div>
				</div>
			</div>
		);
	}

	// Filter states
	const [dateFrom, setDateFrom] = useState<string>('');
	const [dateTo, setDateTo] = useState<string>('');
	const [employeeFilter, setEmployeeFilter] = useState<string>('all');
	const [activityTypeFilter, setActivityTypeFilter] = useState<string>('all');
	const [showExportDropdown, setShowExportDropdown] = useState(false);

	// Load staff members
	useEffect(() => {
		const unsubscribe = onSnapshot(
			collection(db, 'staff'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data();
					return {
						id: docSnap.id,
						userName: data.userName || '',
						userEmail: data.userEmail || '',
						role: data.role || '',
					} as StaffMember;
				});
				setStaff([...mapped]);
			},
			error => {
				console.error('Failed to load staff', error);
				setStaff([]);
			}
		);

		return () => unsubscribe();
	}, []);

	// Load activities
	useEffect(() => {
		const unsubscribe = onSnapshot(
			query(collection(db, 'activities'), orderBy('createdAt', 'desc')),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data();
					const created = (data.createdAt as Timestamp | undefined)?.toDate?.();
					const updated = (data.updatedAt as Timestamp | undefined)?.toDate?.();
					return {
						id: docSnap.id,
						staffId: data.staffId ? String(data.staffId) : undefined,
						staffEmail: data.staffEmail ? String(data.staffEmail) : undefined,
						staffName: data.staffName ? String(data.staffName) : undefined,
						activityType: data.activityType ? String(data.activityType) : undefined,
						description: data.description ? String(data.description) : undefined,
						startTime: data.startTime ? String(data.startTime) : undefined,
						endTime: data.endTime ? String(data.endTime) : undefined,
						date: data.date ? String(data.date) : undefined,
						createdAt: created ? created.toISOString() : undefined,
						updatedAt: updated ? updated.toISOString() : undefined,
					} as ActivityRecord;
				});
				setActivities([...mapped]);
				setLoading(false);
			},
			error => {
				console.error('Failed to load activities', error);
				setActivities([]);
				setLoading(false);
			}
		);

		return () => unsubscribe();
	}, []);

	// Get unique activity types
	const activityTypes = useMemo(() => {
		const types = new Set<string>();
		activities.forEach(activity => {
			if (activity.activityType) {
				types.add(activity.activityType);
			}
		});
		return Array.from(types).sort();
	}, [activities]);

	// Get clinical team staff
	const clinicalTeamStaff = useMemo(() => {
		return staff.filter(s => {
			const role = (s.role || '').toLowerCase();
			return role === 'clinicalteam' || role === 'clinic' || role === 'physiotherapist' || role === 'strengthandconditioning';
		});
	}, [staff]);

	// Filter activities
	const filteredActivities = useMemo(() => {
		return activities.filter(activity => {
			// Date range filter
			if (dateFrom && activity.date) {
				if (activity.date < dateFrom) return false;
			}
			if (dateTo && activity.date) {
				if (activity.date > dateTo) return false;
			}

			// Employee filter
			if (employeeFilter !== 'all') {
				if (activity.staffEmail?.toLowerCase() !== employeeFilter.toLowerCase()) {
					return false;
				}
			}

			// Activity type filter
			if (activityTypeFilter !== 'all') {
				if (activity.activityType !== activityTypeFilter) {
					return false;
				}
			}

			return true;
		});
	}, [activities, dateFrom, dateTo, employeeFilter, activityTypeFilter]);

	// Format date for display
	const formatDate = (dateStr?: string) => {
		if (!dateStr) return '—';
		try {
			return new Intl.DateTimeFormat('en-US', {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
			}).format(new Date(dateStr));
		} catch {
			return dateStr;
		}
	};

	// Format datetime for display
	const formatDateTime = (dateTimeStr?: string) => {
		if (!dateTimeStr) return '—';
		try {
			return new Intl.DateTimeFormat('en-US', {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
				hour: 'numeric',
				minute: '2-digit',
			}).format(new Date(dateTimeStr));
		} catch {
			return dateTimeStr;
		}
	};

	// Helper to convert createdAt to string (handles both string and Timestamp)
	const getCreatedAtString = (createdAt?: string | Timestamp): string | undefined => {
		if (!createdAt) return undefined;
		if (typeof createdAt === 'string') return createdAt;
		// It's a Timestamp, convert to ISO string
		if (createdAt && typeof createdAt === 'object' && 'toDate' in createdAt) {
			try {
				return (createdAt as Timestamp).toDate().toISOString();
			} catch {
				return undefined;
			}
		}
		return undefined;
	};

	// Format time range
	const formatTimeRange = (startTime?: string, endTime?: string) => {
		if (!startTime || !endTime) return '—';
		try {
			const start = new Date(startTime);
			const end = new Date(endTime);
			const startFormatted = new Intl.DateTimeFormat('en-US', {
				hour: 'numeric',
				minute: '2-digit',
			}).format(start);
			const endFormatted = new Intl.DateTimeFormat('en-US', {
				hour: 'numeric',
				minute: '2-digit',
			}).format(end);
			return `${startFormatted} - ${endFormatted}`;
		} catch {
			return `${startTime} - ${endTime}`;
		}
	};

	// Calculate duration in minutes
	const calculateDuration = (startTime?: string, endTime?: string) => {
		if (!startTime || !endTime) return '—';
		try {
			const start = new Date(startTime);
			const end = new Date(endTime);
			const diffMs = end.getTime() - start.getTime();
			const diffMinutes = Math.round(diffMs / 60000);
			const hours = Math.floor(diffMinutes / 60);
			const minutes = diffMinutes % 60;
			if (hours > 0) {
				return `${hours}h ${minutes}m`;
			}
			return `${minutes}m`;
		} catch {
			return '—';
		}
	};

	// Export to CSV
	const handleExportCSV = () => {
		if (filteredActivities.length === 0) {
			alert('No activities to export for the current filters.');
			return;
		}

		const headers = ['Date', 'Employee Name', 'Employee Email', 'Activity Type', 'Description', 'Start Time', 'End Time', 'Duration', 'Created At'];
		const rows = filteredActivities.map(activity => {
			const createdAtStr = getCreatedAtString(activity.createdAt);
			return [
				formatDate(activity.date),
				activity.staffName || '—',
				activity.staffEmail || '—',
				activity.activityType || '—',
				activity.description || '—',
				activity.startTime ? formatDateTime(activity.startTime) : '—',
				activity.endTime ? formatDateTime(activity.endTime) : '—',
				calculateDuration(activity.startTime, activity.endTime),
				createdAtStr ? formatDateTime(createdAtStr) : '—',
			];
		});

		const csv = headers.join(',') + '\n' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.setAttribute('download', `clinical-team-activities-${new Date().toISOString().slice(0, 10)}.csv`);
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	};

	// Export to XLSX
	const handleExportXLSX = () => {
		if (filteredActivities.length === 0) {
			alert('No activities to export for the current filters.');
			return;
		}

		const headers = ['Date', 'Employee Name', 'Employee Email', 'Activity Type', 'Description', 'Start Time', 'End Time', 'Duration', 'Created At'];
		const rows = filteredActivities.map(activity => {
			const createdAtStr = getCreatedAtString(activity.createdAt);
			return [
				formatDate(activity.date),
				activity.staffName || '—',
				activity.staffEmail || '—',
				activity.activityType || '—',
				activity.description || '—',
				activity.startTime ? formatDateTime(activity.startTime) : '—',
				activity.endTime ? formatDateTime(activity.endTime) : '—',
				calculateDuration(activity.startTime, activity.endTime),
				createdAtStr ? formatDateTime(createdAtStr) : '—',
			];
		});

		const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
		const wb = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(wb, ws, 'Clinical Team Activities');

		// Set column widths
		ws['!cols'] = [
			{ wch: 12 }, // Date
			{ wch: 20 }, // Employee Name
			{ wch: 25 }, // Employee Email
			{ wch: 20 }, // Activity Type
			{ wch: 30 }, // Description
			{ wch: 18 }, // Start Time
			{ wch: 18 }, // End Time
			{ wch: 12 }, // Duration
			{ wch: 20 }, // Created At
		];

		XLSX.writeFile(wb, `clinical-team-activities-${new Date().toISOString().slice(0, 10)}.xlsx`);
	};

	if (loading) {
		return (
			<div className="min-h-svh bg-slate-50 px-6 py-10">
				<div className="mx-auto max-w-7xl">
					<div className="py-12 text-center text-sm text-slate-500">
						<div className="loading-spinner" aria-hidden="true" />
						<span className="ml-3 align-middle">Loading activities...</span>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-svh bg-slate-50 px-6 py-10">
			<div className="mx-auto max-w-7xl space-y-6">
				<PageHeader
					title="Clinical Team Activities"
					actions={
						<div className="relative">
							<button
								type="button"
								onClick={() => setShowExportDropdown(!showExportDropdown)}
								className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900 focus-visible:border-slate-400 focus-visible:text-slate-900 focus-visible:outline-none"
							>
								<i className="fas fa-file-export mr-2" aria-hidden="true" />
								Export
								<i className="fas fa-chevron-down ml-2 text-xs" aria-hidden="true" />
							</button>
							{showExportDropdown && (
								<>
									<div
										className="fixed inset-0 z-10"
										onClick={() => setShowExportDropdown(false)}
									/>
									<div className="absolute right-0 mt-1 w-48 rounded-lg border border-slate-200 bg-white shadow-lg z-20">
										<button
											type="button"
											onClick={() => {
												handleExportCSV();
												setShowExportDropdown(false);
											}}
											className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 first:rounded-t-lg transition"
										>
											<i className="fas fa-file-csv mr-2 text-emerald-600" aria-hidden="true" />
											Export CSV
										</button>
										<button
											type="button"
											onClick={() => {
												handleExportXLSX();
												setShowExportDropdown(false);
											}}
											className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 last:rounded-b-lg transition"
										>
											<i className="fas fa-file-excel mr-2 text-emerald-600" aria-hidden="true" />
											Export Excel
										</button>
									</div>
								</>
							)}
						</div>
					}
				/>

				{/* Filter Bar */}
				<div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
						{/* Date From */}
						<div>
							<label className="mb-2 block text-sm font-medium text-slate-700">Start Date</label>
							<input
								type="date"
								value={dateFrom}
								onChange={e => setDateFrom(e.target.value)}
								className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
							/>
						</div>

						{/* Date To */}
						<div>
							<label className="mb-2 block text-sm font-medium text-slate-700">End Date</label>
							<input
								type="date"
								value={dateTo}
								onChange={e => setDateTo(e.target.value)}
								className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
							/>
						</div>

						{/* Employee Name */}
						<div>
							<label className="mb-2 block text-sm font-medium text-slate-700">Employee Name</label>
							<select
								value={employeeFilter}
								onChange={e => setEmployeeFilter(e.target.value)}
								className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
							>
								<option value="all">All Employees</option>
								{clinicalTeamStaff.map(staffMember => (
									<option key={staffMember.id} value={staffMember.userEmail || ''}>
										{staffMember.userName}
									</option>
								))}
							</select>
						</div>

						{/* Activity Type */}
						<div>
							<label className="mb-2 block text-sm font-medium text-slate-700">Activity Type</label>
							<select
								value={activityTypeFilter}
								onChange={e => setActivityTypeFilter(e.target.value)}
								className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
							>
								<option value="all">All Types</option>
								{activityTypes.map(type => (
									<option key={type} value={type}>
										{type}
									</option>
								))}
							</select>
						</div>
					</div>

					{/* Clear Filters Button */}
					{(dateFrom || dateTo || employeeFilter !== 'all' || activityTypeFilter !== 'all') && (
						<div className="mt-4">
							<button
								type="button"
								onClick={() => {
									setDateFrom('');
									setDateTo('');
									setEmployeeFilter('all');
									setActivityTypeFilter('all');
								}}
								className="text-sm font-medium text-sky-600 hover:text-sky-700 transition"
							>
								<i className="fas fa-times-circle mr-1" aria-hidden="true" />
								Clear Filters
							</button>
						</div>
					)}
				</div>

				{/* Data Table */}
				<div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
					<div className="overflow-x-auto">
						<table className="min-w-full divide-y divide-slate-200">
							<thead className="bg-slate-50">
								<tr>
									<th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-700">Date</th>
									<th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-700">Employee Name</th>
									<th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-700">Activity Type</th>
									<th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-700">Description</th>
									<th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-700">Time Range</th>
									<th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-700">Duration</th>
									<th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-700">Created At</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100 bg-white">
								{filteredActivities.length === 0 ? (
									<tr>
										<td colSpan={7} className="px-6 py-8 text-center text-sm text-slate-500">
											No activities found for the selected filters.
										</td>
									</tr>
								) : (
									filteredActivities.map(activity => (
										<tr key={activity.id} className="hover:bg-slate-50 transition">
											<td className="whitespace-nowrap px-6 py-4 text-sm text-slate-900">{formatDate(activity.date)}</td>
											<td className="whitespace-nowrap px-6 py-4 text-sm text-slate-900">{activity.staffName || '—'}</td>
											<td className="whitespace-nowrap px-6 py-4 text-sm text-slate-900">
												<span className="inline-flex items-center rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-800">
													{activity.activityType || '—'}
												</span>
											</td>
											<td className="px-6 py-4 text-sm text-slate-600 max-w-md truncate" title={activity.description || ''}>
												{activity.description || '—'}
											</td>
											<td className="whitespace-nowrap px-6 py-4 text-sm text-slate-600">{formatTimeRange(activity.startTime, activity.endTime)}</td>
											<td className="whitespace-nowrap px-6 py-4 text-sm text-slate-600">{calculateDuration(activity.startTime, activity.endTime)}</td>
											<td className="whitespace-nowrap px-6 py-4 text-sm text-slate-500">{getCreatedAtString(activity.createdAt) ? formatDateTime(getCreatedAtString(activity.createdAt)) : '—'}</td>
										</tr>
									))
								)}
							</tbody>
						</table>
					</div>

					{/* Summary */}
					{filteredActivities.length > 0 && (
						<div className="border-t border-slate-200 bg-slate-50 px-6 py-4">
							<p className="text-sm text-slate-600">
								Showing <span className="font-semibold text-slate-900">{filteredActivities.length}</span> of{' '}
								<span className="font-semibold text-slate-900">{activities.length}</span> activities
							</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

