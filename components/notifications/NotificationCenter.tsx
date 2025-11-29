'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, updateDoc, addDoc, where, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import type {
	NotificationCategory,
	NotificationPreference,
	NotificationRecord,
	NotificationStatus,
} from '@/lib/types';
import { useNotifications } from '@/hooks/useNotifications';

export type UpcomingReminder = {
	id: string;
	title: string;
	subtitle?: string;
	scheduledAt: Date;
	status?: string;
	source?: string;
};

interface NotificationCenterProps {
	userId?: string | null;
	upcomingReminders?: UpcomingReminder[];
	className?: string;
	emptyStateHint?: string;
}

type PreferencesDraft = {
	channels: NotificationPreference['channels'];
	reminderLeadTimeHours: number;
	digestEnabled: boolean;
};

const CATEGORY_LABELS: Record<NotificationCategory | 'unknown', string> = {
	appointment: 'Appointments',
	reminder: 'Reminders',
	system: 'System',
	patient: 'Patients',
	billing: 'Billing',
	birthday: 'Birthdays',
	feedback: 'Feedback',
	other: 'Other',
	unknown: 'General',
};

const STATUS_STYLES: Record<NotificationStatus, string> = {
	unread: 'bg-sky-100 text-sky-700',
	read: 'bg-slate-100 text-slate-600',
};

const CHANNEL_LABELS: Array<{ key: keyof NotificationPreference['channels']; label: string; description: string }> = [
	{ key: 'inApp', label: 'In-app', description: 'Show notifications inside the dashboard.' },
	{ key: 'email', label: 'Email', description: 'Send email reminders and alerts.' },
	{ key: 'sms', label: 'SMS', description: 'Send text message reminders (where available).' },
	{ key: 'whatsapp', label: 'WhatsApp', description: 'Send WhatsApp reminders (where available).' },
];

const REMINDER_LEAD_OPTIONS = [1, 3, 6, 12, 24, 48];

function formatAbsolute(date: Date | null): string {
	if (!date || Number.isNaN(date.getTime())) return 'Unknown time';
	return new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	}).format(date);
}

function formatDateHeading(value: string): string {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return value;
	return new Intl.DateTimeFormat('en-US', {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		year: 'numeric',
	}).format(parsed);
}

function formatRelative(isoString?: string, now?: number): string {
	if (!isoString) return '';
	const date = new Date(isoString);
	if (Number.isNaN(date.getTime())) return '';

	// Use provided now time or current time (only on client)
	const currentTime = now ?? (typeof window !== 'undefined' ? Date.now() : 0);
	if (currentTime === 0) return ''; // Return empty on server to avoid hydration mismatch

	const diffMs = currentTime - date.getTime();
	const diffMinutes = Math.round(diffMs / 60000);

	if (diffMinutes < 1) return 'Just now';
	if (diffMinutes < 60) return `${diffMinutes} min ago`;

	const diffHours = Math.round(diffMinutes / 60);
	if (diffHours < 24) return `${diffHours} hr${diffHours === 1 ? '' : 's'} ago`;

	const diffDays = Math.round(diffHours / 24);
	if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;

	const diffWeeks = Math.round(diffDays / 7);
	if (diffWeeks < 4) return `${diffWeeks} wk${diffWeeks === 1 ? '' : 's'} ago`;

	const diffMonths = Math.round(diffDays / 30);
	if (diffMonths < 12) return `${diffMonths} mo${diffMonths === 1 ? '' : 's'} ago`;

	const diffYears = Math.round(diffDays / 365);
	return `${diffYears} yr${diffYears === 1 ? '' : 's'} ago`;
}

function normalizeSearch(value: string): string {
	return value.trim().toLowerCase();
}

function defaultPreferencesDraft(preferences: NotificationPreference | null): PreferencesDraft {
	return {
		channels: {
			email: preferences?.channels.email ?? true,
			sms: preferences?.channels.sms ?? false,
			whatsapp: preferences?.channels.whatsapp ?? false,
			inApp: preferences?.channels.inApp ?? true,
		},
		reminderLeadTimeHours: preferences?.reminderLeadTimeHours ?? 24,
		digestEnabled: preferences?.digestEnabled ?? false,
	};
}

function groupNotificationsByDate(records: NotificationRecord[]): Array<{ dateKey: string; items: NotificationRecord[] }> {
	const groups = new Map<string, NotificationRecord[]>();
	for (const record of records) {
		const date = record.createdAt ? new Date(record.createdAt) : null;
		const key = date && !Number.isNaN(date.getTime()) ? date.toISOString().split('T')[0] : 'unknown';
		if (!groups.has(key)) {
			groups.set(key, []);
		}
		groups.get(key)!.push(record);
	}

	return Array.from(groups.entries())
		.map(([dateKey, items]) => ({
			dateKey,
			items: items.sort((a, b) => {
				const first = a.createdAt ? new Date(a.createdAt).getTime() : 0;
				const second = b.createdAt ? new Date(b.createdAt).getTime() : 0;
				return second - first;
			}),
		}))
		.sort((a, b) => (a.dateKey > b.dateKey ? -1 : 1));
}

export default function NotificationCenter({
	userId,
	upcomingReminders = [],
	className = '',
	emptyStateHint,
}: NotificationCenterProps) {
	const {
		notifications,
		loading,
		error,
		unreadCount,
		markAsRead,
		markAsUnread,
		markAllAsRead,
		preferences,
		preferencesLoading,
		preferencesError,
		savePreferences,
	} = useNotifications(userId);

	const [statusFilter, setStatusFilter] = useState<'all' | NotificationStatus>('all');
	const [categoryFilter, setCategoryFilter] = useState<'all' | NotificationCategory>('all');
	const [searchTerm, setSearchTerm] = useState('');
	const [actionError, setActionError] = useState<string | null>(null);
	const [showPreferences, setShowPreferences] = useState(false);
	const [savingPreferences, setSavingPreferences] = useState(false);
	const [preferencesDraft, setPreferencesDraft] = useState<PreferencesDraft>(defaultPreferencesDraft(preferences));
	const [processingTransfer, setProcessingTransfer] = useState<Record<string, boolean>>({});
	const [currentTime, setCurrentTime] = useState<number>(0);
	const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
	const [replyTexts, setReplyTexts] = useState<Record<string, string>>({});
	const [sendingReplies, setSendingReplies] = useState<Record<string, boolean>>({});
	const { user } = useAuth();

	// Track current time for relative date formatting (client-only to avoid hydration issues)
	useEffect(() => {
		setCurrentTime(Date.now());
		const interval = setInterval(() => {
			setCurrentTime(Date.now());
		}, 60000); // Update every minute
		return () => clearInterval(interval);
	}, []);

	useEffect(() => {
		setPreferencesDraft(defaultPreferencesDraft(preferences));
	}, [preferences, showPreferences]);

	const normalizedSearch = useMemo(() => normalizeSearch(searchTerm), [searchTerm]);

	const availableCategories = useMemo(() => {
		const unique = new Set<NotificationCategory>();
		notifications.forEach(notification => {
			if (notification.category) {
				unique.add(notification.category as NotificationCategory);
			}
		});
		return Array.from(unique.values()).sort();
	}, [notifications]);

	const filteredNotifications = useMemo(() => {
		return notifications.filter(notification => {
			if (statusFilter !== 'all' && notification.status !== statusFilter) {
				return false;
			}

			if (categoryFilter !== 'all' && notification.category !== categoryFilter) {
				return false;
			}

			if (normalizedSearch) {
				const target = `${notification.title} ${notification.message} ${notification.source ?? ''}`.toLowerCase();
				return target.includes(normalizedSearch);
			}

			return true;
		});
	}, [notifications, statusFilter, categoryFilter, normalizedSearch]);

	const groupedNotifications = useMemo(() => groupNotificationsByDate(filteredNotifications), [filteredNotifications]);

	const handleToggleNotificationStatus = async (record: NotificationRecord) => {
		if (!record?.id) return;
		setActionError(null);
		try {
			if (record.status === 'read') {
				await markAsUnread(record.id);
			} else {
				await markAsRead(record.id);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unable to update notification.';
			setActionError(message);
		}
	};

	const handleAcceptSessionTransfer = async (record: NotificationRecord) => {
		if (!record?.id || !record.metadata) return;
		const requestId = record.metadata.requestId as string;
		const appointmentId = record.metadata.appointmentId as string;
		
		if (!requestId || !appointmentId) {
			setActionError('Missing transfer request information.');
			return;
		}

		setProcessingTransfer(prev => ({ ...prev, [record.id]: true }));
		setActionError(null);

		try {
			// Get transfer request
			const requestRef = doc(db, 'transferRequests', requestId);
			const requestDoc = await getDoc(requestRef);
			
			if (!requestDoc.exists()) {
				throw new Error('Transfer request not found.');
			}

			const requestData = requestDoc.data();
			if (requestData.status !== 'pending') {
				throw new Error('This transfer request has already been processed.');
			}

			// Get appointment
			const appointmentRef = doc(db, 'appointments', appointmentId);
			const appointmentDoc = await getDoc(appointmentRef);
			
			if (!appointmentDoc.exists()) {
				throw new Error('Appointment not found.');
			}

			const appointmentData = appointmentDoc.data();
			const targetTherapist = requestData.toTherapist as string;
			const targetTherapistId = requestData.toTherapistId as string;

			// Update appointment
			await updateDoc(appointmentRef, {
				doctor: targetTherapist,
				staffId: targetTherapistId,
				transferredAt: serverTimestamp(),
				transferredFrom: appointmentData.doctor || requestData.fromTherapist,
			});

			// Update patient record to maintain report access
			if (requestData.patientDocumentId) {
				const patientRef = doc(db, 'patients', requestData.patientDocumentId);
				const patientDoc = await getDoc(patientRef);
				
				if (patientDoc.exists()) {
					const patientData = patientDoc.data();
					const existingReportAccess = patientData.reportAccessDoctors || [];
					const reportAccessSet = new Set(existingReportAccess);
					
					if (appointmentData.doctor) {
						reportAccessSet.add(appointmentData.doctor);
					}
					reportAccessSet.add(targetTherapist);
					
					await updateDoc(patientRef, {
						reportAccessDoctors: Array.from(reportAccessSet),
						transferredAt: serverTimestamp(),
					});
				}
			}

			// Update transfer request status
			await updateDoc(requestRef, {
				status: 'accepted',
				respondedAt: serverTimestamp(),
			});

			// Mark notification as read
			await markAsRead(record.id);

			// Create success notification
			await addDoc(collection(db, 'notifications'), {
				userId: user?.uid || '',
				title: 'Session Transfer Accepted',
				message: `You have accepted the session transfer for ${requestData.patientName} on ${requestData.appointmentDate} at ${requestData.appointmentTime}.`,
				category: 'appointment',
				status: 'unread',
				createdAt: serverTimestamp(),
			});

			// Notify original therapist
			const fromTherapistNotifyId =
				(requestData.fromTherapistAuthId as string | undefined) ||
				(requestData.fromTherapistId as string | undefined);
			if (fromTherapistNotifyId && fromTherapistNotifyId !== user?.uid) {
				await addDoc(collection(db, 'notifications'), {
					userId: fromTherapistNotifyId,
					title: 'Session Transfer Accepted',
					message: `${targetTherapist} has accepted the session transfer for ${requestData.patientName} on ${requestData.appointmentDate} at ${requestData.appointmentTime}.`,
					category: 'appointment',
					status: 'unread',
					createdAt: serverTimestamp(),
				});
			}

			alert('Session transfer accepted successfully.');
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to accept session transfer.';
			setActionError(message);
		} finally {
			setProcessingTransfer(prev => ({ ...prev, [record.id]: false }));
		}
	};

	const handleRejectSessionTransfer = async (record: NotificationRecord) => {
		if (!record?.id || !record.metadata) return;
		const requestId = record.metadata.requestId as string;
		
		if (!requestId) {
			setActionError('Missing transfer request information.');
			return;
		}

		if (!confirm('Are you sure you want to reject this session transfer request?')) {
			return;
		}

		setProcessingTransfer(prev => ({ ...prev, [record.id]: true }));
		setActionError(null);

		try {
			const requestRef = doc(db, 'transferRequests', requestId);
			await updateDoc(requestRef, {
				status: 'rejected',
				respondedAt: serverTimestamp(),
			});

			await markAsRead(record.id);

			// Notify original therapist
			const requestDoc = await getDoc(requestRef);
			if (requestDoc.exists()) {
				const requestData = requestDoc.data();
				const fromTherapistNotifyId =
					(requestData.fromTherapistAuthId as string | undefined) ||
					(requestData.fromTherapistId as string | undefined);
				if (fromTherapistNotifyId && fromTherapistNotifyId !== user?.uid) {
					await addDoc(collection(db, 'notifications'), {
						userId: fromTherapistNotifyId,
						title: 'Session Transfer Rejected',
						message: `The session transfer request for ${requestData.patientName} on ${requestData.appointmentDate} at ${requestData.appointmentTime} has been rejected.`,
						category: 'appointment',
						status: 'unread',
						createdAt: serverTimestamp(),
					});
				}
			}

			alert('Session transfer request rejected.');
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to reject session transfer.';
			setActionError(message);
		} finally {
			setProcessingTransfer(prev => ({ ...prev, [record.id]: false }));
		}
	};

	const handleAcceptPatientTransfer = async (record: NotificationRecord) => {
		if (!record?.id || !record.metadata) return;
		const requestId = record.metadata.requestId as string;
		if (!requestId) {
			setActionError('Missing transfer request information.');
			return;
		}

		setProcessingTransfer(prev => ({ ...prev, [record.id]: true }));
		setActionError(null);

		try {
			const requestRef = doc(db, 'transferRequests', requestId);
			const requestDoc = await getDoc(requestRef);

			if (!requestDoc.exists()) {
				throw new Error('Transfer request not found.');
			}

			const requestData = requestDoc.data();
			if (requestData.status !== 'pending') {
				throw new Error('This transfer request has already been processed.');
			}

			const patientDocumentId = requestData.patientDocumentId as string | undefined;
			const patientId = requestData.patientId as string | undefined;
			const toTherapist = requestData.toTherapist as string;
			const fromTherapistId =
				(requestData.fromTherapistAuthId as string | undefined) ||
				(requestData.fromTherapistId as string | undefined);
			const requestedById =
				(requestData.requestedByAuthId as string | undefined) ||
				(requestData.requestedById as string | undefined);

			if (patientDocumentId) {
				await updateDoc(doc(db, 'patients', patientDocumentId), {
					assignedDoctor: toTherapist,
					transferredAt: serverTimestamp(),
				});
			}

			if (patientId) {
				const appointmentsQuery = query(
					collection(db, 'appointments'),
					where('patientId', '==', patientId),
					where('status', 'in', ['pending', 'ongoing'])
				);
				const appointmentSnapshot = await getDocs(appointmentsQuery);
				const appointmentUpdates = appointmentSnapshot.docs.map(docSnap =>
					updateDoc(docSnap.ref, {
						doctor: toTherapist,
					})
				);
				await Promise.allSettled(appointmentUpdates);
			}

			await updateDoc(requestRef, {
				status: 'accepted',
				respondedAt: serverTimestamp(),
			});

			await markAsRead(record.id);

			if (requestedById) {
				await addDoc(collection(db, 'notifications'), {
					userId: requestedById,
					title: 'Patient Transfer Accepted',
					message: `${toTherapist} has accepted the transfer request for ${requestData.patientName} (${requestData.patientId}).`,
					category: 'patient',
					status: 'unread',
					createdAt: serverTimestamp(),
				});
			}

			if (fromTherapistId && fromTherapistId !== user?.uid) {
				await addDoc(collection(db, 'notifications'), {
					userId: fromTherapistId,
					title: 'Patient Transfer Accepted',
					message: `${toTherapist} has accepted the transfer request for ${requestData.patientName}.`,
					category: 'patient',
					status: 'unread',
					createdAt: serverTimestamp(),
				});
			}

			alert('Patient transfer accepted successfully.');
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to accept patient transfer.';
			setActionError(message);
		} finally {
			setProcessingTransfer(prev => ({ ...prev, [record.id]: false }));
		}
	};

	const handleRejectPatientTransfer = async (record: NotificationRecord) => {
		if (!record?.id || !record.metadata) return;
		const requestId = record.metadata.requestId as string;
		if (!requestId) {
			setActionError('Missing transfer request information.');
		 return;
		}

		if (!confirm('Are you sure you want to reject this patient transfer request?')) {
			return;
		}

		setProcessingTransfer(prev => ({ ...prev, [record.id]: true }));
		setActionError(null);

		try {
			const requestRef = doc(db, 'transferRequests', requestId);
			const requestDoc = await getDoc(requestRef);

			if (!requestDoc.exists()) {
				throw new Error('Transfer request not found.');
			}

			const requestData = requestDoc.data();
			const requestedById =
				(requestData.requestedByAuthId as string | undefined) ||
				(requestData.requestedById as string | undefined);

			await updateDoc(requestRef, {
				status: 'rejected',
				respondedAt: serverTimestamp(),
			});

			await markAsRead(record.id);

			if (requestedById) {
				await addDoc(collection(db, 'notifications'), {
					userId: requestedById,
					title: 'Patient Transfer Rejected',
					message: `The transfer request for ${requestData.patientName} (${requestData.patientId}) has been rejected.`,
					category: 'patient',
					status: 'unread',
					createdAt: serverTimestamp(),
				});
			}

			alert('Patient transfer request rejected.');
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to reject patient transfer.';
			setActionError(message);
		} finally {
			setProcessingTransfer(prev => ({ ...prev, [record.id]: false }));
		}
	};

	const handleMarkAllAsRead = async () => {
		setActionError(null);
		try {
			await markAllAsRead();
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unable to mark notifications as read.';
			setActionError(message);
		}
	};

	const handleSavePreferences = async () => {
		if (!userId) return;
		setSavingPreferences(true);
		setActionError(null);
		try {
			await savePreferences({
				channels: { ...preferencesDraft.channels },
				reminderLeadTimeHours: preferencesDraft.reminderLeadTimeHours,
				digestEnabled: preferencesDraft.digestEnabled,
			});
			setShowPreferences(false);
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unable to save notification preferences.';
			setActionError(message);
		} finally {
			setSavingPreferences(false);
		}
	};

	const handleToggleThread = (notificationId: string) => {
		setExpandedThreads(prev => {
			const next = new Set(prev);
			if (next.has(notificationId)) {
				next.delete(notificationId);
			} else {
				next.add(notificationId);
			}
			return next;
		});
	};

	const handleSendReply = async (record: NotificationRecord) => {
		if (!user || !record.threadId || !replyTexts[record.id]?.trim()) return;

		setSendingReplies(prev => ({ ...prev, [record.id]: true }));
		setActionError(null);

		try {
			const newMessage = {
				id: typeof crypto !== 'undefined' && (crypto as any).randomUUID ? (crypto as any).randomUUID() : Math.random().toString(36).slice(2),
				senderId: user.uid,
				senderName: user.displayName || user.email || 'User',
				message: replyTexts[record.id].trim(),
				createdAt: new Date().toISOString(),
			};

			// Get current messages and add new one
			const currentMessages = record.messages || [];
			const updatedMessages = [...currentMessages, newMessage];

			// Update the notification with new message
			await updateDoc(doc(db, 'notifications', record.id), {
				messages: updatedMessages,
				status: 'unread', // Mark as unread when new message is added
			});

			// If this is a feedback notification, also notify the original sender
			if (record.category === 'feedback' && record.fromUserId && record.fromUserId !== user.uid) {
				await addDoc(collection(db, 'notifications'), {
					userId: record.fromUserId,
					title: 'Reply to Your Feedback',
					message: `${user.displayName || user.email || 'Someone'} replied to your feedback.`,
					category: 'feedback',
					status: 'unread',
					createdAt: serverTimestamp(),
					threadId: record.threadId,
					messages: updatedMessages,
					fromUserId: user.uid,
					fromUserName: user.displayName || user.email || 'User',
					metadata: {
						originalNotificationId: record.id,
						...(record.metadata || {}),
					},
					channels: {
						inApp: true,
					},
				});
			}

			// Clear reply text
			setReplyTexts(prev => {
				const next = { ...prev };
				delete next[record.id];
				return next;
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to send reply.';
			setActionError(message);
		} finally {
			setSendingReplies(prev => ({ ...prev, [record.id]: false }));
		}
	};

	const upcomingCards = useMemo(() => {
		return upcomingReminders
			.filter(reminder => reminder.scheduledAt && !Number.isNaN(reminder.scheduledAt.getTime()))
			.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
	}, [upcomingReminders]);

	const canManagePreferences = Boolean(userId);

	return (
		<div className={`rounded-2xl bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.07)] ${className}`}>
			<header className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h3 className="text-lg font-semibold text-slate-900">Notifications</h3>
					<p className="text-sm text-slate-500">
						{unreadCount} unread · {notifications.length} total
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<button
						type="button"
						onClick={handleMarkAllAsRead}
						disabled={unreadCount === 0 || loading}
						className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
					>
						Mark all read
					</button>
					<button
						type="button"
						onClick={() => setShowPreferences(true)}
						disabled={!canManagePreferences}
						className="inline-flex items-center rounded-full bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
					>
						<i className="fas fa-sliders-h mr-2 text-xs" aria-hidden="true" />
						Preferences
					</button>
				</div>
			</header>

			{(error || actionError || preferencesError) && (
				<div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
					{error || actionError || preferencesError || 'Something went wrong.'}
				</div>
			)}

			{upcomingCards.length > 0 && (
				<section className="mt-5">
					<div className="flex items-center justify-between">
						<h4 className="text-sm font-semibold text-slate-800">Upcoming (next 24 hours)</h4>
						<span className="text-xs text-slate-500">{upcomingCards.length} reminder(s)</span>
					</div>
					<ul className="mt-3 space-y-3">
						{upcomingCards.map(reminder => (
							<li
								key={`upcoming-${reminder.id}`}
								className="rounded-xl border border-slate-200 px-4 py-3 transition hover:border-sky-300"
							>
								<p className="text-sm font-semibold text-slate-800">{reminder.title}</p>
								{reminder.subtitle && <p className="mt-1 text-xs text-slate-500">{reminder.subtitle}</p>}
								<div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 text-xs text-slate-500">
									<span className="font-medium text-slate-600">{formatAbsolute(reminder.scheduledAt)}</span>
									<div className="flex items-center gap-2">
										{reminder.status && (
											<span className="badge-base px-2 py-0.5 bg-slate-100 text-slate-600">
												{reminder.status.toUpperCase()}
											</span>
										)}
										{reminder.source && <span className="text-[11px] text-slate-400">{reminder.source}</span>}
									</div>
								</div>
							</li>
						))}
					</ul>
				</section>
			)}

			<section className="mt-6 space-y-4">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="flex flex-wrap gap-2">
						<select
							value={statusFilter}
							onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}
							className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
						>
							<option value="all">All status</option>
							<option value="unread">Unread only</option>
							<option value="read">Read only</option>
						</select>

						<select
							value={categoryFilter}
							onChange={event => setCategoryFilter(event.target.value as typeof categoryFilter)}
							className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
						>
							<option value="all">All categories</option>
							{availableCategories.map(category => (
								<option key={category} value={category}>
									{CATEGORY_LABELS[category] ?? CATEGORY_LABELS.unknown}
								</option>
							))}
						</select>
					</div>

					<div className="relative w-full sm:w-56">
						<i className="fas fa-search pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400" aria-hidden="true" />
						<input
							type="search"
							value={searchTerm}
							onChange={event => setSearchTerm(event.target.value)}
							placeholder="Search notifications"
							className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-2 text-xs text-slate-600 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
						/>
					</div>
				</div>

				<div className="max-h-[22rem] overflow-y-auto pr-1">
					{loading && notifications.length === 0 ? (
						<p className="py-8 text-center text-sm text-slate-500">Loading notifications…</p>
					) : filteredNotifications.length === 0 ? (
						<div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
							<p className="font-medium text-slate-600">No notifications to show.</p>
							{emptyStateHint && <p className="mt-1 text-xs text-slate-400">{emptyStateHint}</p>}
						</div>
					) : (
						<ul className="space-y-4">
							{groupedNotifications.map(group => (
								<li key={group.dateKey}>
									<div className="mb-2 flex items-center justify-between text-xs text-slate-500">
										<span className="font-semibold text-slate-600">
											{group.dateKey === 'unknown' ? 'Undated' : formatDateHeading(group.dateKey)}
										</span>
										<span>{group.items.length} item{group.items.length === 1 ? '' : 's'}</span>
									</div>
									<ul className="space-y-3">
										{group.items.map(record => (
											<li
												key={record.id}
												className="rounded-xl border border-slate-200 p-4 transition hover:border-sky-300"
											>
												<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
													<div className="flex-1">
														<div className="flex flex-wrap items-center gap-2">
															<span
																className={`badge-base px-2.5 py-0.5 ${STATUS_STYLES[record.status]}`}
															>
																{record.status === 'read' ? 'READ' : 'UNREAD'}
															</span>
															<span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
																{CATEGORY_LABELS[record.category] ?? CATEGORY_LABELS.unknown}
															</span>
															{record.source && (
																<span className="text-[11px] text-slate-400">{record.source}</span>
															)}
														</div>
														<h5 className="mt-2 text-sm font-semibold text-slate-900">{record.title}</h5>
														{record.message && !record.messages && (
															<p className="mt-1 text-xs text-slate-600">{record.message}</p>
														)}
														{record.fromUserName && record.category === 'feedback' && (
															<p className="mt-1 text-xs text-slate-500">
																From: {record.fromUserName}
															</p>
														)}
														{record.metadata && Object.keys(record.metadata).length > 0 && (
															<dl className="mt-3 grid grid-cols-1 gap-2 text-[11px] text-slate-500 sm:grid-cols-2">
																{Object.entries(record.metadata)
																	.slice(0, 4)
																	.map(([key, value]) => (
																		<div key={key} className="flex gap-1">
																			<dt className="font-semibold capitalize">{key}:</dt>
																			<dd className="truncate">{String(value)}</dd>
																		</div>
																	))}
															</dl>
														)}
													</div>
													<div className="flex flex-col items-end gap-2">
														<span className="text-xs text-slate-400">
															{formatRelative(record.createdAt, currentTime)}
														</span>
														{record.metadata?.requestId && record.metadata?.type === 'session_transfer_request' && (
															<div className="flex gap-2">
																<button
																	type="button"
																	onClick={() => handleAcceptSessionTransfer(record)}
																	disabled={processingTransfer[record.id]}
																	className="inline-flex items-center rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
																>
																	{processingTransfer[record.id] ? (
																		<>
																			<i className="fas fa-spinner fa-spin mr-1.5" aria-hidden="true" />
																			Processing...
																		</>
																	) : (
																		<>
																			<i className="fas fa-check mr-1.5" aria-hidden="true" />
																			Accept
																		</>
																	)}
																</button>
																<button
																	type="button"
																	onClick={() => handleRejectSessionTransfer(record)}
																	disabled={processingTransfer[record.id]}
																	className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
																>
																	<i className="fas fa-times mr-1.5" aria-hidden="true" />
																	Reject
																</button>
															</div>
														)}
														{record.metadata?.requestId && record.metadata?.type === 'patient_transfer_request' && (
															<div className="flex gap-2">
																<button
																	type="button"
																	onClick={() => handleAcceptPatientTransfer(record)}
																	disabled={processingTransfer[record.id]}
																	className="inline-flex items-center rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
																>
																	{processingTransfer[record.id] ? (
																		<>
																			<i className="fas fa-spinner fa-spin mr-1.5" aria-hidden="true" />
																			Processing...
																		</>
																	) : (
																		<>
																			<i className="fas fa-check mr-1.5" aria-hidden="true" />
																			Accept
																		</>
																	)}
																</button>
																<button
																	type="button"
																	onClick={() => handleRejectPatientTransfer(record)}
																	disabled={processingTransfer[record.id]}
																	className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
																>
																	<i className="fas fa-times mr-1.5" aria-hidden="true" />
																	Reject
																</button>
															</div>
														)}
														{record.category === 'feedback' && (
															<button
																type="button"
																onClick={() => handleToggleThread(record.id)}
																className="inline-flex items-center rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 transition hover:bg-sky-50"
															>
																<i className={`fas fa-${expandedThreads.has(record.id) ? 'chevron-up' : 'comments'} mr-1.5`} aria-hidden="true" />
																{expandedThreads.has(record.id) ? 'Hide Messages' : 'View Messages'}
															</button>
														)}
														<button
															type="button"
															onClick={() => handleToggleNotificationStatus(record)}
															className="text-xs font-semibold text-sky-600 transition hover:text-sky-700"
														>
															{record.status === 'read' ? 'Mark as unread' : 'Mark as read'}
														</button>
													</div>
												</div>
												{/* Message Thread for Feedback */}
												{record.category === 'feedback' && expandedThreads.has(record.id) && (
													<div className="mt-4 border-t border-slate-200 pt-4">
														<div className="space-y-3">
															{(record.messages || (record.message ? [{
																id: 'initial',
																senderId: record.fromUserId || '',
																senderName: record.fromUserName || 'Unknown',
																message: record.message,
																createdAt: record.createdAt,
															}] : [])).map((msg, idx) => (
																<div
																	key={msg.id || idx}
																	className={`rounded-lg border p-3 ${
																		msg.senderId === user?.uid
																			? 'ml-4 border-sky-200 bg-sky-50'
																			: 'mr-4 border-slate-200 bg-slate-50'
																	}`}
																>
																	<div className="flex items-center justify-between mb-1">
																		<span className="text-xs font-semibold text-slate-700">
																			{msg.senderName}
																		</span>
																		<span className="text-[10px] text-slate-400">
																			{formatRelative(msg.createdAt, currentTime)}
																		</span>
																	</div>
																	<p className="text-xs text-slate-600 whitespace-pre-wrap">{msg.message}</p>
																</div>
															))}
														</div>
														{/* Reply Input */}
														<div className="mt-4 space-y-2">
															<textarea
																value={replyTexts[record.id] || ''}
																onChange={e => setReplyTexts(prev => ({ ...prev, [record.id]: e.target.value }))}
																placeholder="Type your reply..."
																className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
																rows={2}
																disabled={sendingReplies[record.id]}
															/>
															<div className="flex justify-end">
																<button
																	type="button"
																	onClick={() => handleSendReply(record)}
																	disabled={!replyTexts[record.id]?.trim() || sendingReplies[record.id]}
																	className="inline-flex items-center rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed"
																>
																	{sendingReplies[record.id] ? (
																		<>
																			<i className="fas fa-spinner fa-spin mr-1.5" aria-hidden="true" />
																			Sending...
																		</>
																	) : (
																		<>
																			<i className="fas fa-paper-plane mr-1.5" aria-hidden="true" />
																			Send Reply
																		</>
																	)}
																</button>
															</div>
														</div>
													</div>
												)}
											</li>
										))}
									</ul>
								</li>
							))}
						</ul>
					)}
				</div>
			</section>

			{showPreferences && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6"
					role="dialog"
					aria-modal="true"
				>
					<div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
						<header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
							<div>
								<h2 className="text-lg font-semibold text-slate-900">Notification Preferences</h2>
								<p className="text-sm text-slate-500">
									Control how you would like to receive reminders and alerts.
								</p>
							</div>
							<button
								type="button"
								onClick={() => setShowPreferences(false)}
								className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:bg-slate-100 focus-visible:text-slate-600 focus-visible:outline-none"
								aria-label="Close preferences"
							>
								<i className="fas fa-times" aria-hidden="true" />
							</button>
						</header>

						<div className="max-h-[60vh] overflow-y-auto px-6 py-6 text-sm text-slate-700">
							<section>
								<h3 className="text-sm font-semibold text-slate-800">Channels</h3>
								<p className="mt-1 text-xs text-slate-500">
									Choose which channels should be used for automated reminders.
								</p>
								<ul className="mt-4 space-y-3">
									{CHANNEL_LABELS.map(channel => (
										<li
											key={channel.key}
											className="flex items-start justify-between rounded-xl border border-slate-200 px-4 py-3"
										>
											<div className="pr-3">
												<label htmlFor={`channel-${channel.key}`} className="text-sm font-medium text-slate-800">
													{channel.label}
												</label>
												<p className="text-xs text-slate-500">{channel.description}</p>
											</div>
											<input
												id={`channel-${channel.key}`}
												type="checkbox"
												checked={preferencesDraft.channels[channel.key]}
												onChange={event =>
													setPreferencesDraft(prev => ({
														...prev,
														channels: {
															...prev.channels,
															[channel.key]: event.target.checked,
														},
													}))
												}
												className="h-5 w-5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
											/>
										</li>
									))}
								</ul>
							</section>

							<section className="mt-6">
								<h3 className="text-sm font-semibold text-slate-800">Reminder lead time</h3>
								<p className="mt-1 text-xs text-slate-500">
									How far in advance should appointment reminders be sent?
								</p>
								<div className="mt-3 flex flex-wrap gap-2">
									{REMINDER_LEAD_OPTIONS.map(option => (
										<button
											key={option}
											type="button"
											onClick={() =>
												setPreferencesDraft(prev => ({
													...prev,
													reminderLeadTimeHours: option,
												}))
											}
											className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
												preferencesDraft.reminderLeadTimeHours === option
													? 'border-sky-500 bg-sky-50 text-sky-700'
													: 'border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700'
											}`}
										>
											{option} hr{option === 1 ? '' : 's'}
										</button>
									))}
									<label className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500">
										<span>Custom</span>
										<input
											type="number"
											min={1}
											max={168}
											value={preferencesDraft.reminderLeadTimeHours}
											onChange={event =>
												setPreferencesDraft(prev => ({
													...prev,
													reminderLeadTimeHours: Number(event.target.value) || prev.reminderLeadTimeHours,
												}))
											}
											className="w-16 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
										/>
										<span>hrs</span>
									</label>
								</div>
							</section>

							<section className="mt-6">
								<label className="flex items-start gap-3 rounded-xl border border-slate-200 px-4 py-3">
									<input
										type="checkbox"
										checked={preferencesDraft.digestEnabled}
										onChange={event =>
											setPreferencesDraft(prev => ({
												...prev,
												digestEnabled: event.target.checked,
											}))
										}
										className="mt-1 h-5 w-5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
									/>
									<div>
										<span className="text-sm font-semibold text-slate-800">Weekly digest email</span>
										<p className="text-xs text-slate-500">
											Receive a weekly summary of unread notifications in your inbox.
										</p>
									</div>
								</label>
							</section>
						</div>

						<footer className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
							<button
								type="button"
								onClick={() => setShowPreferences(false)}
								className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleSavePreferences}
								disabled={savingPreferences || preferencesLoading}
								className="inline-flex items-center rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
							>
								{savingPreferences ? (
									<>
										<i className="fas fa-spinner animate-spin mr-2 text-xs" aria-hidden="true" />
										Saving…
									</>
								) : (
									'Save changes'
								)}
							</button>
						</footer>
					</div>
				</div>
			)}
		</div>
	);
}


