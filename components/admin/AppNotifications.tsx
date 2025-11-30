'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where, orderBy, type QuerySnapshot, type Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/PageHeader';

interface AppNotification {
	id: string;
	type: 'birthday' | 'patient_deleted' | 'employee_deleted';
	title: string;
	message: string;
	createdAt: string;
	read: boolean;
	metadata?: {
		patientId?: string;
		patientName?: string;
		employeeId?: string;
		employeeName?: string;
		deletedBy?: string;
		deletedByName?: string;
		birthdayDate?: string;
		personName?: string;
	};
}

export default function AppNotifications() {
	const { user } = useAuth();
	const [notifications, setNotifications] = useState<AppNotification[]>([]);
	const [loading, setLoading] = useState(true);
	const [filter, setFilter] = useState<'all' | 'birthday' | 'patient_deleted' | 'employee_deleted'>('all');

	// Load app notifications from Firestore
	useEffect(() => {
		if (!user?.uid) {
			setLoading(false);
			return;
		}

		const unsubscribe = onSnapshot(
			query(
				collection(db, 'appNotifications'),
				orderBy('createdAt', 'desc')
			),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data();
					const created = (data.createdAt as Timestamp | undefined)?.toDate?.();
					return {
						id: docSnap.id,
						type: (data.type as 'birthday' | 'patient_deleted' | 'employee_deleted') || 'other',
						title: data.title ? String(data.title) : '',
						message: data.message ? String(data.message) : '',
						createdAt: created ? created.toISOString() : (data.createdAt as string | undefined) || new Date().toISOString(),
						read: data.read || false,
						metadata: data.metadata || {},
					} as AppNotification;
				});
				setNotifications(mapped);
				setLoading(false);
			},
			error => {
				console.error('Failed to load app notifications', error);
				setNotifications([]);
				setLoading(false);
			}
		);

		return () => unsubscribe();
	}, [user]);

	// Load patients and staff to check for birthdays (simplified - birthday notifications should be created by a scheduled job or on patient/staff creation)
	// This is a placeholder - in production, you'd want a scheduled function or trigger

	const filteredNotifications = useMemo(() => {
		if (filter === 'all') return notifications;
		return notifications.filter(n => n.type === filter);
	}, [notifications, filter]);

	const unreadCount = useMemo(() => {
		return notifications.filter(n => !n.read).length;
	}, [notifications]);

	const formatTime = (dateString: string) => {
		const date = new Date(dateString);
		const now = new Date();
		const diff = now.getTime() - date.getTime();
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);

		if (minutes < 1) return 'Just now';
		if (minutes < 60) return `${minutes}m ago`;
		if (hours < 24) return `${hours}h ago`;
		if (days < 7) return `${days}d ago`;
		return date.toLocaleDateString();
	};

	const getNotificationIcon = (type: string) => {
		switch (type) {
			case 'birthday':
				return 'fas fa-birthday-cake text-pink-500';
			case 'patient_deleted':
				return 'fas fa-user-times text-red-500';
			case 'employee_deleted':
				return 'fas fa-user-slash text-orange-500';
			default:
				return 'fas fa-bell text-slate-500';
		}
	};

	const getNotificationColor = (type: string) => {
		switch (type) {
			case 'birthday':
				return 'bg-pink-50 border-pink-200';
			case 'patient_deleted':
				return 'bg-red-50 border-red-200';
			case 'employee_deleted':
				return 'bg-orange-50 border-orange-200';
			default:
				return 'bg-slate-50 border-slate-200';
		}
	};

	return (
		<div className="min-h-svh bg-slate-50 px-6 py-10">
			<div className="mx-auto max-w-6xl">
				<PageHeader
					title="App Notifications"
					description="Stay updated with birthdays, deletions, and important system events."
				/>

				<div className="mt-6 rounded-2xl bg-white shadow-sm border border-slate-200">
					{/* Header */}
					<div className="p-4 border-b border-slate-200 flex items-center justify-between">
						<div>
							<h3 className="text-lg font-semibold text-slate-900">Notifications</h3>
							<p className="text-sm text-slate-500">
								{unreadCount} unread · {notifications.length} total
							</p>
						</div>
						<div className="flex items-center gap-2">
							<select
								value={filter}
								onChange={e => setFilter(e.target.value as typeof filter)}
								className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
							>
								<option value="all">All types</option>
								<option value="birthday">Birthdays</option>
								<option value="patient_deleted">Patient Deletions</option>
								<option value="employee_deleted">Employee Deletions</option>
							</select>
						</div>
					</div>

					{/* Notifications List */}
					<div className="divide-y divide-slate-100">
						{loading ? (
							<div className="p-8 text-center text-sm text-slate-500">
								<div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-sky-600 border-t-transparent"></div>
								<p className="mt-2">Loading notifications...</p>
							</div>
						) : filteredNotifications.length === 0 ? (
							<div className="p-8 text-center">
								<i className="fas fa-bell-slash text-4xl text-slate-300 mb-3" aria-hidden="true" />
								<p className="text-slate-500">No notifications to show.</p>
								<p className="text-sm text-slate-400 mt-1">You're all caught up! No notifications at the moment.</p>
							</div>
						) : (
							filteredNotifications.map(notification => (
								<div
									key={notification.id}
									className={`p-4 hover:bg-slate-50 transition-colors ${!notification.read ? 'bg-sky-50/50' : ''} ${getNotificationColor(notification.type)}`}
								>
									<div className="flex items-start gap-3">
										<div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${getNotificationColor(notification.type)}`}>
											<i className={`${getNotificationIcon(notification.type)} text-lg`} aria-hidden="true" />
										</div>
										<div className="flex-1 min-w-0">
											<div className="flex items-start justify-between gap-2">
												<div className="flex-1">
													<h4 className="font-semibold text-slate-900">{notification.title}</h4>
													<p className="text-sm text-slate-600 mt-1">{notification.message}</p>
													{notification.metadata && (
														<div className="mt-2 text-xs text-slate-500">
															{notification.metadata.deletedBy && (
																<p>Deleted by: {notification.metadata.deletedByName || notification.metadata.deletedBy}</p>
															)}
															{notification.metadata.birthdayDate && (
																<p>Birthday: {new Date(notification.metadata.birthdayDate).toLocaleDateString()}</p>
															)}
														</div>
													)}
												</div>
												<div className="flex-shrink-0 text-xs text-slate-500">
													{formatTime(notification.createdAt)}
												</div>
											</div>
										</div>
										{!notification.read && (
											<div className="flex-shrink-0">
												<div className="w-2 h-2 rounded-full bg-sky-600"></div>
											</div>
										)}
									</div>
								</div>
							))
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

