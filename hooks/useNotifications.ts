'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
	collection,
	doc,
	onSnapshot,
	orderBy,
	query,
	Timestamp,
	updateDoc,
	where,
	setDoc,
	type DocumentData,
	type QueryDocumentSnapshot,
} from 'firebase/firestore';

import { db } from '@/lib/firebase';
import type {
	NotificationPreference,
	NotificationRecord,
	NotificationStatus,
	NotificationChannelSettings,
	NotificationMessage,
} from '@/lib/types';

interface UseNotificationsState {
	notifications: NotificationRecord[];
	loading: boolean;
	error: string | null;
	preferences: NotificationPreference | null;
	preferencesLoading: boolean;
	preferencesError: string | null;
}

interface UpdatePreferencesPayload {
	channels?: Partial<NotificationChannelSettings>;
	reminderLeadTimeHours?: number;
	digestEnabled?: boolean;
}

const initialState: UseNotificationsState = {
	notifications: [],
	loading: false,
	error: null,
	preferences: null,
	preferencesLoading: false,
	preferencesError: null,
};

function mapNotification(snapshot: QueryDocumentSnapshot<DocumentData>): NotificationRecord {
	const data = snapshot.data();

	const createdAt = data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : data.createdAt ?? '';
	const readAtValue =
		data.readAt instanceof Timestamp ? data.readAt.toDate().toISOString() : data.readAt ?? null;

	const channels: NotificationRecord['channels'] = data.channels
		? {
				email: data.channels.email ?? undefined,
				sms: data.channels.sms ?? undefined,
				whatsapp: data.channels.whatsapp ?? undefined,
				inApp: data.channels.inApp ?? undefined,
			}
		: undefined;

	const messages: NotificationMessage[] = data.messages
		? (Array.isArray(data.messages) ? data.messages : []).map((msg: any) => ({
				id: msg.id ?? '',
				senderId: msg.senderId ?? '',
				senderName: msg.senderName ?? '',
				message: msg.message ?? '',
				createdAt: msg.createdAt ?? new Date().toISOString(),
			}))
		: undefined;

	return {
		id: snapshot.id,
		userId: data.userId ?? '',
		title: data.title ?? 'Notification',
		message: data.message ?? '',
		category: data.category ?? 'other',
		status: data.status ?? 'unread',
		createdAt,
		readAt: readAtValue,
		metadata: data.metadata ?? undefined,
		channels,
		acknowledgedBy: data.acknowledgedBy ?? undefined,
		source: data.source ?? undefined,
		threadId: data.threadId ?? undefined,
		messages: messages,
		fromUserId: data.fromUserId ?? undefined,
		fromUserName: data.fromUserName ?? undefined,
	};
}

function mapPreferences(docSnap: QueryDocumentSnapshot<DocumentData> | null): NotificationPreference | null {
	if (!docSnap || !docSnap.exists()) {
		return null;
	}

	const data = docSnap.data();
	const updatedAt =
		data.updatedAt instanceof Timestamp ? data.updatedAt.toDate().toISOString() : data.updatedAt ?? '';

	return {
		userId: docSnap.id,
		channels: {
			email: data.channels?.email ?? true,
			sms: data.channels?.sms ?? false,
			whatsapp: data.channels?.whatsapp ?? false,
			inApp: data.channels?.inApp ?? true,
		},
		reminderLeadTimeHours: data.reminderLeadTimeHours ?? 24,
		digestEnabled: data.digestEnabled ?? false,
		updatedAt,
	};
}

export function useNotifications(userId?: string | null) {
	const [state, setState] = useState<UseNotificationsState>(initialState);

	useEffect(() => {
		if (!userId) {
			setState(initialState);
			return undefined;
		}

		setState(prev => ({
			...prev,
			loading: true,
			error: null,
		}));

		const notificationsRef = collection(db, 'notifications');
		
		// Try the indexed query first (with orderBy)
		const notificationsQuery = query(
			notificationsRef,
			where('userId', '==', userId),
			orderBy('createdAt', 'desc')
		);

		// Fallback query without orderBy (doesn't require index)
		const fallbackQuery = query(
			notificationsRef,
			where('userId', '==', userId)
		);

		let unsubscribe: (() => void) | undefined;
		let hasTriedFallback = false;

		const tryQuery = (queryToUse: typeof notificationsQuery | typeof fallbackQuery, isFallback = false) => {
			// Clean up previous subscription if exists
			if (unsubscribe) {
				unsubscribe();
			}

			unsubscribe = onSnapshot(
				queryToUse,
				snapshot => {
					let records = snapshot.docs.map(mapNotification);
					
					// If using fallback, sort in memory
					if (isFallback) {
						records = records.sort((a, b) => {
							const dateA = new Date(a.createdAt).getTime();
							const dateB = new Date(b.createdAt).getTime();
							return dateB - dateA; // Descending order
						});
					}

					setState(prev => ({
						...prev,
						notifications: records,
						loading: false,
						error: null,
					}));
				},
				error => {
					// Check if it's an index error and we haven't tried fallback yet
					const errorCode = (error as any)?.code;
					const errorMessage = (error as any)?.message || '';
					const isIndexError = 
						errorCode === 'failed-precondition' ||
						errorCode === 'unimplemented' ||
						errorMessage.toLowerCase().includes('index') ||
						errorMessage.toLowerCase().includes('requires an index') ||
						errorMessage.toLowerCase().includes('query requires an index');
					
					if (isIndexError && !hasTriedFallback) {
						// Silently fall back to query without orderBy
						hasTriedFallback = true;
						// Try again with fallback query
						tryQuery(fallbackQuery, true);
					} else {
						console.error('Failed to fetch notifications', error);
						setState(prev => ({
							...prev,
							notifications: [],
							loading: false,
							error: isIndexError 
								? 'Unable to load notifications. Please create the required Firestore index.'
								: 'Unable to load notifications. Please try again later.',
						}));
					}
				}
			);
		};

		// Start with the indexed query
		tryQuery(notificationsQuery, false);

		return () => {
			if (unsubscribe) {
				unsubscribe();
			}
		};
	}, [userId]);

	useEffect(() => {
		if (!userId) {
			setState(prev => ({
				...prev,
				preferences: null,
				preferencesLoading: false,
				preferencesError: null,
			}));
			return undefined;
		}

		setState(prev => ({
			...prev,
			preferencesLoading: true,
			preferencesError: null,
		}));

		const preferencesRef = doc(db, 'notificationPreferences', userId);

		const unsubscribe = onSnapshot(
			preferencesRef,
			snapshot => {
				setState(prev => ({
					...prev,
					preferences: snapshot.exists() ? mapPreferences(snapshot as QueryDocumentSnapshot<DocumentData>) : null,
					preferencesLoading: false,
				}));
			},
			error => {
				console.error('Failed to fetch notification preferences', error);
				setState(prev => ({
					...prev,
					preferences: null,
					preferencesLoading: false,
					preferencesError: 'Unable to load notification preferences.',
				}));
			}
		);

		return () => unsubscribe();
	}, [userId]);

	const unreadCount = useMemo(
		() => state.notifications.filter(notification => notification.status !== 'read').length,
		[state.notifications]
	);

	const updateNotificationStatus = useCallback(
		async (notificationId: string, status: NotificationStatus) => {
			if (!notificationId) return;

			try {
				const notificationRef = doc(db, 'notifications', notificationId);
				await updateDoc(notificationRef, {
					status,
					readAt: status === 'read' ? Timestamp.now() : null,
				});
			} catch (error) {
				console.error('Failed to update notification status', error);
				throw new Error('Unable to update notification status.');
			}
		},
		[]
	);

	const markAsRead = useCallback(
		async (notificationId: string) => updateNotificationStatus(notificationId, 'read'),
		[updateNotificationStatus]
	);

	const markAsUnread = useCallback(
		async (notificationId: string) => updateNotificationStatus(notificationId, 'unread'),
		[updateNotificationStatus]
	);

	const markAllAsRead = useCallback(async () => {
		const unread = state.notifications.filter(notification => notification.status !== 'read');
		await Promise.all(unread.map(notification => updateNotificationStatus(notification.id, 'read')));
	}, [state.notifications, updateNotificationStatus]);

	const savePreferences = useCallback(
		async (payload: UpdatePreferencesPayload) => {
			if (!userId) {
				throw new Error('No user available to update preferences.');
			}

			const preferencesRef = doc(db, 'notificationPreferences', userId);

			const channels: Partial<NotificationChannelSettings> | undefined = payload.channels
				? {
						email: payload.channels.email,
						sms: payload.channels.sms,
						whatsapp: payload.channels.whatsapp,
						inApp: payload.channels.inApp,
					}
				: undefined;

			await setDoc(
				preferencesRef,
				{
					userId,
					...(channels ? { channels } : {}),
					...(payload.reminderLeadTimeHours != null
						? { reminderLeadTimeHours: payload.reminderLeadTimeHours }
						: {}),
					...(payload.digestEnabled != null ? { digestEnabled: payload.digestEnabled } : {}),
					updatedAt: Timestamp.now(),
				},
				{ merge: true }
			);
		},
		[userId]
	);

	return {
		notifications: state.notifications,
		loading: state.loading,
		error: state.error,
		unreadCount,
		markAsRead,
		markAsUnread,
		markAllAsRead,
		preferences: state.preferences,
		preferencesLoading: state.preferencesLoading,
		preferencesError: state.preferencesError,
		savePreferences,
	};
}

