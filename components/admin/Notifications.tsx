'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { collection, doc, onSnapshot, addDoc, setDoc, updateDoc, query, where, orderBy, serverTimestamp, type QuerySnapshot, type Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/PageHeader';

// App Notifications Interfaces
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

// Messaging Interfaces
interface StaffMember {
	id: string;
	userName: string;
	role: string;
	status: string;
	profileImage?: string;
	userEmail?: string;
}

interface Message {
	id: string;
	conversationId: string;
	senderId: string;
	senderName: string;
	senderImage?: string;
	receiverId: string;
	receiverName: string;
	text: string;
	createdAt: string;
	read?: boolean;
	readAt?: string;
	reactions?: Record<string, string[]>;
}

interface Conversation {
	id: string;
	participants: string[];
	participantNames: Record<string, string>;
	participantImages: Record<string, string>;
	lastMessage?: string;
	lastMessageAt?: string;
	unreadCount?: Record<string, number>;
}

const EMOJI_LIST = [
	'😀', '😂', '❤️', '👍', '👎', '🎉', '🔥', '💯', '😮', '😢', '😡', '🤔', '👏', '🙌', '💪', '🎯', '⭐', '✨', '💡', '🚀',
	'😊', '😍', '🤣', '😘', '🥰', '😎', '🤩', '😇', '🥳', '😋', '🤗', '😴', '🤤', '😭', '😱', '🤯', '😤', '🤢', '🤮', '😷',
	'🤧', '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👹', '👺', '🤡', '💩', '👻', '💀', '☠️', '👽', '🤖', '🎃', '😺', '😸', '😹',
	'😻', '😼', '😽', '🙀', '😿', '😾', '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉',
	'👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💪', '🦾', '🦿',
	'🦵', '🦶', '👂', '🦻', '👃', '🧠', '🦷', '🦴', '👀', '👁️', '👅', '👄', '💋', '💘', '💝', '💖', '💗', '💓', '💞', '💕',
	'💟', '❣️', '💔', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💯', '💢', '💥', '💫', '💦', '💨', '🕳️', '💣',
	'💬', '👁️‍🗨️', '🗨️', '🗯️', '💭', '💤', '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉'
];

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🔥', '👏'];

export default function Notifications() {
	const { user } = useAuth();
	
	// App Notifications State
	const [notifications, setNotifications] = useState<AppNotification[]>([]);
	const [notificationsLoading, setNotificationsLoading] = useState(true);
	const [notificationFilter, setNotificationFilter] = useState<'all' | 'birthday' | 'patient_deleted' | 'employee_deleted'>('all');
	
	// Messaging State
	const [staff, setStaff] = useState<StaffMember[]>([]);
	const [selectedEmployee, setSelectedEmployee] = useState<StaffMember | null>(null);
	const [messages, setMessages] = useState<Message[]>([]);
	const [conversations, setConversations] = useState<Conversation[]>([]);
	const [messageText, setMessageText] = useState('');
	const [showEmojiPicker, setShowEmojiPicker] = useState(false);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	// Load app notifications
	useEffect(() => {
		if (!user?.uid) {
			setNotificationsLoading(false);
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
				setNotificationsLoading(false);
			},
			error => {
				console.error('Failed to load app notifications', error);
				setNotifications([]);
				setNotificationsLoading(false);
			}
		);

		return () => unsubscribe();
	}, [user]);

	// Load staff for messaging
	useEffect(() => {
		const unsubscribe = onSnapshot(
			collection(db, 'staff'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data() as Record<string, unknown>;
					return {
						id: docSnap.id,
						userName: data.userName ? String(data.userName) : '',
						role: data.role ? String(data.role) : '',
						status: data.status ? String(data.status) : '',
						profileImage: data.profileImage ? String(data.profileImage) : undefined,
						userEmail: data.userEmail ? String(data.userEmail) : undefined,
					} as StaffMember;
				});
				setStaff(mapped.filter(s => s.status === 'Active' && s.id !== user?.uid));
			},
			error => {
				console.error('Failed to load staff', error);
				setStaff([]);
			}
		);

		return () => unsubscribe();
	}, [user]);

	// Load conversations
	useEffect(() => {
		if (!user?.uid) return;

		const unsubscribe = onSnapshot(
			query(
				collection(db, 'conversations'),
				where('participants', 'array-contains', user.uid),
				orderBy('lastMessageAt', 'desc')
			),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data();
					return {
						id: docSnap.id,
						participants: data.participants || [],
						participantNames: data.participantNames || {},
						participantImages: data.participantImages || {},
						lastMessage: data.lastMessage,
						lastMessageAt: data.lastMessageAt?.toDate?.()?.toISOString() || data.lastMessageAt,
						unreadCount: data.unreadCount || {},
					} as Conversation;
				});
				setConversations(mapped);
			},
			error => {
				console.error('Failed to load conversations', error);
			}
		);

		return () => unsubscribe();
	}, [user]);

	// Load messages for selected conversation
	useEffect(() => {
		if (!selectedEmployee || !user?.uid) {
			setMessages([]);
			return;
		}

		const participants = [user.uid, selectedEmployee.id].sort();
		const conversationId = participants.join('_');

		const unsubscribe = onSnapshot(
			query(
				collection(db, 'messages'),
				where('conversationId', '==', conversationId),
				orderBy('createdAt', 'asc')
			),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data();
					const created = (data.createdAt as Timestamp | undefined)?.toDate?.();
					return {
						id: docSnap.id,
						conversationId: data.conversationId || conversationId,
						senderId: data.senderId || '',
						senderName: data.senderName || '',
						senderImage: data.senderImage,
						receiverId: data.receiverId || '',
						receiverName: data.receiverName || '',
						text: data.text || '',
						createdAt: created ? created.toISOString() : (data.createdAt as string | undefined) || new Date().toISOString(),
						read: data.read || false,
						readAt: data.readAt ? ((data.readAt as Timestamp)?.toDate?.()?.toISOString() || String(data.readAt)) : undefined,
						reactions: data.reactions || {},
					} as Message;
				});
				setMessages(mapped);
				
				if (mapped.length > 0) {
					const unreadMessages = mapped.filter(m => m.receiverId === user.uid && !m.read);
					if (unreadMessages.length > 0) {
						unreadMessages.forEach(msg => {
							updateDoc(doc(db, 'messages', msg.id), { read: true, readAt: serverTimestamp() });
						});
					}
				}
			},
			error => {
				console.error('Failed to load messages', error);
				setMessages([]);
			}
		);

		return () => unsubscribe();
	}, [selectedEmployee, user]);

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [messages]);

	const getOrCreateConversation = async (otherUserId: string, otherUserName: string, otherUserImage?: string) => {
		if (!user?.uid) return null;

		const participants = [user.uid, otherUserId].sort();
		const conversationId = participants.join('_');

		const existingConv = conversations.find(c => c.id === conversationId);
		if (existingConv) {
			return conversationId;
		}

		const currentUser = staff.find(s => s.userEmail === user.email) || staff.find(s => s.id === user.uid);
		const currentUserName = currentUser?.userName || user.displayName || user.email?.split('@')[0] || 'User';
		const currentUserImage = currentUser?.profileImage || '';

		try {
			// Use setDoc with conversationId as document ID to ensure consistency
			await setDoc(doc(db, 'conversations', conversationId), {
				id: conversationId,
				participants,
				participantNames: {
					[user.uid]: currentUserName,
					[otherUserId]: otherUserName,
				},
				participantImages: {
					[user.uid]: currentUserImage,
					[otherUserId]: otherUserImage || '',
				},
				lastMessageAt: serverTimestamp(),
				unreadCount: {
					[user.uid]: 0,
					[otherUserId]: 0,
				},
			});
			return conversationId;
		} catch (error) {
			console.error('Failed to create conversation', error);
			// If conversation already exists, that's fine
			return conversationId;
		}
	};

	const handleSendMessage = async () => {
		if (!messageText.trim() || !selectedEmployee || !user?.uid) return;

		const participants = [user.uid, selectedEmployee.id].sort();
		const conversationId = participants.join('_');

		const currentUser = staff.find(s => s.userEmail === user.email) || staff.find(s => s.id === user.uid);
		const senderName = currentUser?.userName || user.displayName || user.email?.split('@')[0] || 'User';
		const senderImage = currentUser?.profileImage || '';

		try {
			// Ensure conversation exists first
			const convId = await getOrCreateConversation(selectedEmployee.id, selectedEmployee.userName, selectedEmployee.profileImage);
			if (!convId) {
				throw new Error('Failed to create or find conversation');
			}

			// Create message
			await addDoc(collection(db, 'messages'), {
				conversationId: convId,
				senderId: user.uid,
				senderName,
				senderImage,
				receiverId: selectedEmployee.id,
				receiverName: selectedEmployee.userName,
				text: messageText.trim(),
				createdAt: serverTimestamp(),
				read: false,
				reactions: {},
			});

			// Update conversation
			try {
				await updateDoc(doc(db, 'conversations', convId), {
					lastMessage: messageText.trim(),
					lastMessageAt: serverTimestamp(),
					unreadCount: {
						[user.uid]: 0,
						[selectedEmployee.id]: (conversations.find(c => c.id === convId)?.unreadCount?.[selectedEmployee.id] || 0) + 1,
					},
				});
			} catch (updateError) {
				// If update fails, it's not critical - message was sent
				console.warn('Failed to update conversation', updateError);
			}

			setMessageText('');
			setShowEmojiPicker(false);
		} catch (error) {
			console.error('Failed to send message', error);
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			alert(`Failed to send message: ${errorMessage}. Please check the browser console for details.`);
		}
	};

	const handleReaction = async (messageId: string, emoji: string) => {
		if (!user?.uid) return;

		const message = messages.find(m => m.id === messageId);
		if (!message) return;

		const currentReactions = message.reactions || {};
		const usersWhoReacted = currentReactions[emoji] || [];
		const hasReacted = usersWhoReacted.includes(user.uid);

		try {
			const newReactions = { ...currentReactions };
			if (hasReacted) {
				newReactions[emoji] = usersWhoReacted.filter(id => id !== user.uid);
				if (newReactions[emoji].length === 0) {
					delete newReactions[emoji];
				}
			} else {
				newReactions[emoji] = [...usersWhoReacted, user.uid];
			}

			await updateDoc(doc(db, 'messages', messageId), {
				reactions: newReactions,
			});
		} catch (error) {
			console.error('Failed to update reaction', error);
		}
	};

	const insertEmoji = (emoji: string) => {
		setMessageText(prev => prev + emoji);
		setShowEmojiPicker(false);
		inputRef.current?.focus();
	};

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

	const filteredNotifications = useMemo(() => {
		if (notificationFilter === 'all') return notifications;
		return notifications.filter(n => n.type === notificationFilter);
	}, [notifications, notificationFilter]);

	const unreadCount = useMemo(() => {
		return notifications.filter(n => !n.read).length;
	}, [notifications]);

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
			<div className="mx-auto max-w-7xl">
				<PageHeader
					title="Notifications & Messaging"
					description="Stay updated with system notifications and communicate with your team."
				/>

				<div className="mt-6 grid h-[calc(100vh-12rem)] grid-cols-12 gap-4">
					{/* Left Side: App Notifications */}
					<div className="col-span-12 lg:col-span-5 flex flex-col rounded-2xl bg-white shadow-sm border border-slate-200">
						<div className="p-4 border-b border-slate-200 flex items-center justify-between">
							<div>
								<h3 className="text-lg font-semibold text-slate-900">App Notifications</h3>
								<p className="text-sm text-slate-500">
									{unreadCount} unread · {notifications.length} total
								</p>
							</div>
							<select
								value={notificationFilter}
								onChange={e => setNotificationFilter(e.target.value as typeof notificationFilter)}
								className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
							>
								<option value="all">All types</option>
								<option value="birthday">Birthdays</option>
								<option value="patient_deleted">Patient Deletions</option>
								<option value="employee_deleted">Employee Deletions</option>
							</select>
						</div>
						<div className="flex-1 overflow-y-auto divide-y divide-slate-100">
							{notificationsLoading ? (
								<div className="p-8 text-center text-sm text-slate-500">
									<div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-sky-600 border-t-transparent"></div>
									<p className="mt-2">Loading notifications...</p>
								</div>
							) : filteredNotifications.length === 0 ? (
								<div className="p-8 text-center">
									<i className="fas fa-bell-slash text-3xl text-slate-300 mb-3" aria-hidden="true" />
									<p className="text-slate-500 text-sm">No notifications to show.</p>
								</div>
							) : (
								filteredNotifications.map(notification => (
									<div
										key={notification.id}
										className={`p-4 hover:bg-slate-50 transition-colors ${!notification.read ? 'bg-sky-50/50' : ''} ${getNotificationColor(notification.type)}`}
									>
										<div className="flex items-start gap-3">
											<div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${getNotificationColor(notification.type)}`}>
												<i className={`${getNotificationIcon(notification.type)} text-sm`} aria-hidden="true" />
											</div>
											<div className="flex-1 min-w-0">
												<h4 className="font-semibold text-sm text-slate-900">{notification.title}</h4>
												<p className="text-xs text-slate-600 mt-1">{notification.message}</p>
												{notification.metadata && (
													<div className="mt-1 text-xs text-slate-500">
														{notification.metadata.deletedBy && (
															<p>Deleted by: {notification.metadata.deletedByName || notification.metadata.deletedBy}</p>
														)}
													</div>
												)}
											</div>
											<div className="flex-shrink-0 text-xs text-slate-500">
												{formatTime(notification.createdAt)}
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

					{/* Right Side: Messaging */}
					<div className="col-span-12 lg:col-span-7 flex flex-col rounded-2xl bg-white shadow-sm border border-slate-200">
						<div className="p-4 border-b border-slate-200 flex items-center justify-between">
							<h3 className="text-lg font-semibold text-slate-900">Messaging</h3>
						</div>
						<div className="flex-1 flex overflow-hidden">
							{/* Employee List */}
							<div className="w-1/3 border-r border-slate-200 flex flex-col overflow-hidden">
								<div className="p-3 border-b border-slate-200 bg-slate-50">
									<p className="text-xs font-semibold text-slate-600 uppercase">Employees</p>
								</div>
								<div className="flex-1 overflow-y-auto">
									{staff.length === 0 ? (
										<div className="p-4 text-center text-xs text-slate-500">No employees found</div>
									) : (
										<div className="divide-y divide-slate-100">
											{staff.map(employee => (
												<button
													key={employee.id}
													type="button"
													onClick={() => setSelectedEmployee(employee)}
													className={`w-full p-3 text-left hover:bg-slate-50 transition-colors ${
														selectedEmployee?.id === employee.id ? 'bg-sky-50 border-l-4 border-sky-500' : ''
													}`}
												>
													<div className="flex items-center gap-2">
														{employee.profileImage ? (
															<img
																src={employee.profileImage}
																alt={employee.userName}
																className="h-8 w-8 rounded-full object-cover"
															/>
														) : (
															<div className="h-8 w-8 rounded-full bg-sky-100 flex items-center justify-center">
																<i className="fas fa-user text-sky-600 text-xs" aria-hidden="true" />
															</div>
														)}
														<div className="flex-1 min-w-0">
															<p className="font-semibold text-sm text-slate-900 truncate">{employee.userName}</p>
															<p className="text-xs text-slate-500 truncate">{employee.role}</p>
														</div>
													</div>
												</button>
											))}
										</div>
									)}
								</div>
							</div>

							{/* Chat Area */}
							<div className="flex-1 flex flex-col">
								{selectedEmployee ? (
									<>
										<div className="p-3 border-b border-slate-200 flex items-center gap-2 bg-slate-50">
											{selectedEmployee.profileImage ? (
												<img
													src={selectedEmployee.profileImage}
													alt={selectedEmployee.userName}
													className="h-8 w-8 rounded-full object-cover"
												/>
											) : (
												<div className="h-8 w-8 rounded-full bg-sky-100 flex items-center justify-center">
													<i className="fas fa-user text-sky-600 text-xs" aria-hidden="true" />
												</div>
											)}
											<div>
												<p className="font-semibold text-sm text-slate-900">{selectedEmployee.userName}</p>
												<p className="text-xs text-slate-500">{selectedEmployee.role}</p>
											</div>
										</div>

										<div className="flex-1 overflow-y-auto p-3 space-y-2">
											{messages.length === 0 ? (
												<div className="flex items-center justify-center h-full">
													<p className="text-xs text-slate-500">No messages yet. Start the conversation!</p>
												</div>
											) : (
												messages.map(message => {
													const isOwn = message.senderId === user?.uid;
													return (
														<div
															key={message.id}
															className={`flex gap-2 ${isOwn ? 'justify-end' : 'justify-start'}`}
														>
															{!isOwn && (
																<div className="flex-shrink-0">
																	{message.senderImage ? (
																		<img
																			src={message.senderImage}
																			alt={message.senderName}
																			className="h-6 w-6 rounded-full object-cover"
																		/>
																	) : (
																		<div className="h-6 w-6 rounded-full bg-slate-100 flex items-center justify-center">
																			<i className="fas fa-user text-slate-600 text-xs" aria-hidden="true" />
																		</div>
																	)}
																</div>
															)}
															<div className={`flex flex-col max-w-[75%] ${isOwn ? 'items-end' : 'items-start'}`}>
																<div
																	className={`rounded-lg px-3 py-1.5 text-xs ${
																		isOwn
																			? 'bg-sky-600 text-white'
																			: 'bg-slate-100 text-slate-900'
																	}`}
																>
																	<p className="whitespace-pre-wrap break-words">{message.text}</p>
																</div>
																<div className="flex items-center gap-1 mt-0.5">
																	<p className="text-xs text-slate-400">{formatTime(message.createdAt)}</p>
																	{message.reactions && Object.keys(message.reactions).length > 0 && (
																		<div className="flex gap-0.5">
																			{Object.entries(message.reactions).map(([emoji, userIds]) => (
																				<button
																					key={emoji}
																					type="button"
																					onClick={() => handleReaction(message.id, emoji)}
																					className={`text-xs px-1.5 py-0.5 rounded-full border ${
																						userIds.includes(user?.uid || '')
																							? 'bg-sky-100 border-sky-300 text-sky-700'
																							: 'bg-white border-slate-200 text-slate-600'
																					} hover:bg-sky-50 transition-colors`}
																				>
																					{emoji} {userIds.length}
																				</button>
																			))}
																		</div>
																	)}
																	<div className="relative group">
																		<button
																			type="button"
																			className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
																			title="Add reaction"
																		>
																			<i className="far fa-smile" aria-hidden="true" />
																		</button>
																		<div className="absolute bottom-full left-0 mb-2 hidden group-hover:flex gap-1 bg-white rounded-full shadow-lg border border-slate-200 p-1 z-10">
																			{REACTION_EMOJIS.map(emoji => (
																				<button
																					key={emoji}
																					type="button"
																					onClick={() => handleReaction(message.id, emoji)}
																					className="text-sm hover:scale-125 transition-transform p-1"
																				>
																					{emoji}
																				</button>
																			))}
																		</div>
																	</div>
																</div>
															</div>
															{isOwn && (
																<div className="flex-shrink-0">
																	{message.senderImage ? (
																		<img
																			src={message.senderImage}
																			alt={message.senderName}
																			className="h-6 w-6 rounded-full object-cover"
																		/>
																	) : (
																		<div className="h-6 w-6 rounded-full bg-sky-100 flex items-center justify-center">
																			<i className="fas fa-user text-sky-600 text-xs" aria-hidden="true" />
																		</div>
																	)}
																</div>
															)}
														</div>
													);
												})
											)}
											<div ref={messagesEndRef} />
										</div>

										<div className="p-3 border-t border-slate-200">
											{showEmojiPicker && (
												<div className="mb-2 p-2 bg-white rounded-lg border border-slate-200 shadow-lg max-h-32 overflow-y-auto">
													<div className="grid grid-cols-10 gap-0.5">
														{EMOJI_LIST.map(emoji => (
															<button
																key={emoji}
																type="button"
																onClick={() => insertEmoji(emoji)}
																className="text-sm hover:scale-125 transition-transform p-0.5 hover:bg-slate-100 rounded"
															>
																{emoji}
															</button>
														))}
													</div>
												</div>
											)}
											<div className="flex items-end gap-2">
												<button
													type="button"
													onClick={() => setShowEmojiPicker(!showEmojiPicker)}
													className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors"
													title="Add emoji"
												>
													<i className="far fa-smile text-sm" aria-hidden="true" />
												</button>
												<textarea
													ref={inputRef}
													value={messageText}
													onChange={e => setMessageText(e.target.value)}
													onKeyDown={e => {
														if (e.key === 'Enter' && !e.shiftKey) {
															e.preventDefault();
															handleSendMessage();
														}
													}}
													placeholder="Type a message..."
													className="flex-1 resize-none rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
													rows={1}
												/>
												<button
													type="button"
													onClick={handleSendMessage}
													disabled={!messageText.trim()}
													className="px-4 py-1.5 bg-sky-600 text-white rounded-lg text-xs font-semibold hover:bg-sky-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
												>
													Send
												</button>
											</div>
										</div>
									</>
								) : (
									<div className="flex items-center justify-center h-full">
										<div className="text-center">
											<i className="fas fa-comments text-3xl text-slate-300 mb-2" aria-hidden="true" />
											<p className="text-xs text-slate-500">Select an employee to start messaging</p>
										</div>
									</div>
								)}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
