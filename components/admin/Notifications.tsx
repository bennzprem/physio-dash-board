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
		<div className="min-h-svh bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 px-6 py-10">
			<div className="mx-auto max-w-7xl">
				<PageHeader
					title="Notifications & Messaging"
				/>

				<div className="mt-6 grid h-[calc(100vh-12rem)] grid-cols-12 gap-4">
					{/* Left Side: App Notifications */}
					<div className="col-span-12 lg:col-span-5 flex flex-col rounded-2xl bg-white/80 backdrop-blur-sm shadow-lg border border-white/20 overflow-hidden">
						<div className="p-4 border-b border-slate-200/50 bg-gradient-to-r from-purple-50 to-blue-50 flex items-center justify-between">
							<div>
								<h3 className="text-lg font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">App Notifications</h3>
								<p className="text-sm text-slate-600 font-medium">
									{unreadCount} unread · {notifications.length} total
								</p>
							</div>
							<select
								value={notificationFilter}
								onChange={e => setNotificationFilter(e.target.value as typeof notificationFilter)}
								className="rounded-lg border border-purple-200 bg-white px-3 py-1.5 text-xs text-slate-700 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200 shadow-sm"
							>
								<option value="all">All types</option>
								<option value="birthday">Birthdays</option>
								<option value="patient_deleted">Patient Deletions</option>
								<option value="employee_deleted">Employee Deletions</option>
							</select>
						</div>
						<div className="flex-1 overflow-y-auto divide-y divide-slate-100/50 bg-white/50">
							{notificationsLoading ? (
								<div className="p-8 text-center text-sm text-slate-500">
									<div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-purple-600 border-t-transparent"></div>
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
										className={`p-4 hover:bg-gradient-to-r hover:from-purple-50/50 hover:to-blue-50/50 transition-all duration-200 ${!notification.read ? 'bg-gradient-to-r from-purple-50/70 to-blue-50/70 border-l-3 border-purple-500' : ''} ${getNotificationColor(notification.type)}`}
									>
										<div className="flex items-start gap-3">
											<div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center shadow-md ${getNotificationColor(notification.type)}`}>
												<i className={`${getNotificationIcon(notification.type)} text-base`} aria-hidden="true" />
											</div>
											<div className="flex-1 min-w-0">
												<h4 className="font-bold text-sm text-slate-900">{notification.title}</h4>
												<p className="text-xs text-slate-700 mt-1 font-medium">{notification.message}</p>
												{notification.metadata && (
													<div className="mt-1 text-xs text-slate-600">
														{notification.metadata.deletedBy && (
															<p>Deleted by: {notification.metadata.deletedByName || notification.metadata.deletedBy}</p>
														)}
													</div>
												)}
											</div>
											<div className="flex-shrink-0 text-xs text-slate-600 font-medium">
												{formatTime(notification.createdAt)}
											</div>
											{!notification.read && (
												<div className="flex-shrink-0">
													<div className="w-3 h-3 rounded-full bg-gradient-to-r from-purple-500 to-blue-500 animate-pulse"></div>
												</div>
											)}
										</div>
									</div>
								))
							)}
						</div>
					</div>

					{/* Right Side: Messaging */}
					<div className="col-span-12 lg:col-span-7 flex flex-col rounded-2xl bg-white/80 backdrop-blur-sm shadow-lg border border-white/20 overflow-hidden">
						<div className="p-4 border-b border-slate-200/50 bg-gradient-to-r from-indigo-50 to-purple-50 flex items-center justify-between">
							<h3 className="text-lg font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">Messaging</h3>
						</div>
						<div className="flex-1 flex overflow-hidden bg-gradient-to-br from-slate-50/50 to-white/50">
							{/* Employee List */}
							<div className="w-1/3 border-r border-slate-200/50 flex flex-col overflow-hidden bg-white/60">
								<div className="p-3 border-b border-slate-200/50 bg-gradient-to-r from-indigo-50/50 to-purple-50/50">
									<p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Employees</p>
								</div>
								<div className="flex-1 overflow-y-auto">
									{staff.length === 0 ? (
										<div className="p-4 text-center text-xs text-slate-500">No employees found</div>
									) : (
										<div className="divide-y divide-slate-100/50">
											{staff.map(employee => (
												<button
													key={employee.id}
													type="button"
													onClick={() => setSelectedEmployee(employee)}
													className={`w-full p-3 text-left hover:bg-gradient-to-r hover:from-indigo-50/50 hover:to-purple-50/50 transition-all duration-200 ${
														selectedEmployee?.id === employee.id ? 'bg-gradient-to-r from-indigo-100 to-purple-100 border-l-4 border-indigo-500 shadow-sm' : ''
													}`}
												>
													<div className="flex items-center gap-3">
														{employee.profileImage ? (
															<img
																src={employee.profileImage}
																alt={employee.userName}
																className="h-10 w-10 rounded-full object-cover ring-2 ring-white shadow-md"
															/>
														) : (
															<div className="h-10 w-10 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center shadow-md ring-2 ring-white">
																<i className="fas fa-user text-white text-sm" aria-hidden="true" />
															</div>
														)}
														<div className="flex-1 min-w-0">
															<p className="font-bold text-sm text-slate-900 truncate">{employee.userName}</p>
															<p className="text-xs text-slate-600 truncate font-medium">{employee.role}</p>
														</div>
													</div>
												</button>
											))}
										</div>
									)}
								</div>
							</div>

							{/* Chat Area */}
							<div className="flex-1 flex flex-col bg-gradient-to-b from-white/80 to-slate-50/50">
								{selectedEmployee ? (
									<>
										<div className="p-4 border-b border-slate-200/50 flex items-center gap-3 bg-gradient-to-r from-indigo-50/50 to-purple-50/50 shadow-sm">
											{selectedEmployee.profileImage ? (
												<img
													src={selectedEmployee.profileImage}
													alt={selectedEmployee.userName}
													className="h-10 w-10 rounded-full object-cover ring-2 ring-white shadow-md"
												/>
											) : (
												<div className="h-10 w-10 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center shadow-md ring-2 ring-white">
													<i className="fas fa-user text-white text-sm" aria-hidden="true" />
												</div>
											)}
											<div>
												<p className="font-bold text-sm text-slate-900">{selectedEmployee.userName}</p>
												<p className="text-xs text-slate-600 font-medium">{selectedEmployee.role}</p>
											</div>
										</div>

										<div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gradient-to-b from-transparent to-slate-50/30">
											{messages.length === 0 ? (
												<div className="flex items-center justify-center h-full">
													<div className="text-center">
														<div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 mb-3">
															<i className="fas fa-comments text-2xl text-indigo-500" aria-hidden="true" />
														</div>
														<p className="text-sm text-slate-600 font-medium">No messages yet. Start the conversation!</p>
													</div>
												</div>
											) : (
												messages.map(message => {
													const isOwn = message.senderId === user?.uid;
													return (
														<div
															key={message.id}
															className={`flex gap-3 ${isOwn ? 'justify-end' : 'justify-start'} items-end`}
														>
															{!isOwn && (
																<div className="flex-shrink-0">
																	{message.senderImage ? (
																		<img
																			src={message.senderImage}
																			alt={message.senderName}
																			className="h-8 w-8 rounded-full object-cover ring-2 ring-white shadow-md"
																		/>
																	) : (
																		<div className="h-8 w-8 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-md ring-2 ring-white">
																			<i className="fas fa-user text-white text-xs" aria-hidden="true" />
																		</div>
																	)}
																</div>
															)}
															<div className={`flex flex-col max-w-[75%] ${isOwn ? 'items-end' : 'items-start'}`}>
																{!isOwn && (
																	<p className="text-xs font-semibold text-slate-700 mb-1 px-1">{message.senderName}</p>
																)}
																<div
																	className={`rounded-2xl px-4 py-2.5 text-sm shadow-md ${
																		isOwn
																			? 'bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white font-medium'
																			: 'bg-white text-slate-900 border-2 border-emerald-200 font-medium'
																	}`}
																>
																	<p className="whitespace-pre-wrap break-words leading-relaxed">{message.text}</p>
																</div>
																<div className="flex items-center gap-2 mt-1.5 px-1">
																	<p className={`text-xs font-medium ${isOwn ? 'text-slate-500' : 'text-slate-600'}`}>{formatTime(message.createdAt)}</p>
																	{message.reactions && Object.keys(message.reactions).length > 0 && (
																		<div className="flex gap-1">
																			{Object.entries(message.reactions).map(([emoji, userIds]) => (
																				<button
																					key={emoji}
																					type="button"
																					onClick={() => handleReaction(message.id, emoji)}
																					className={`text-xs px-2 py-0.5 rounded-full border-2 shadow-sm ${
																						userIds.includes(user?.uid || '')
																							? 'bg-indigo-100 border-indigo-300 text-indigo-700'
																							: 'bg-white border-slate-200 text-slate-600'
																					} hover:bg-indigo-50 transition-all duration-200 hover:scale-105`}
																				>
																					{emoji} {userIds.length}
																				</button>
																			))}
																		</div>
																	)}
																	<div className="relative group">
																		<button
																			type="button"
																			className={`text-xs transition-colors hover:scale-110 ${isOwn ? 'text-white/70 hover:text-white' : 'text-slate-400 hover:text-slate-600'}`}
																			title="Add reaction"
																		>
																			<i className="far fa-smile" aria-hidden="true" />
																		</button>
																		<div className="absolute bottom-full left-0 mb-2 hidden group-hover:flex gap-1 bg-white rounded-full shadow-xl border-2 border-slate-200 p-2 z-10">
																			{REACTION_EMOJIS.map(emoji => (
																				<button
																					key={emoji}
																					type="button"
																					onClick={() => handleReaction(message.id, emoji)}
																					className="text-base hover:scale-125 transition-transform p-1.5 hover:bg-indigo-50 rounded-full"
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
																			className="h-8 w-8 rounded-full object-cover ring-2 ring-white shadow-md"
																		/>
																	) : (
																		<div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center shadow-md ring-2 ring-white">
																			<i className="fas fa-user text-white text-xs" aria-hidden="true" />
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

										<div className="p-4 border-t border-slate-200/50 bg-gradient-to-r from-white to-slate-50/50">
											{showEmojiPicker && (
												<div className="mb-3 p-3 bg-white rounded-xl border-2 border-indigo-200 shadow-xl max-h-40 overflow-y-auto">
													<div className="grid grid-cols-10 gap-1">
														{EMOJI_LIST.map(emoji => (
															<button
																key={emoji}
																type="button"
																onClick={() => insertEmoji(emoji)}
																className="text-base hover:scale-125 transition-transform p-1 hover:bg-indigo-50 rounded-lg"
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
													className="p-2.5 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-xl transition-all duration-200 hover:scale-110 shadow-sm"
													title="Add emoji"
												>
													<i className="far fa-smile text-lg" aria-hidden="true" />
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
													className="flex-1 resize-none rounded-xl border-2 border-indigo-200 bg-white px-4 py-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 shadow-sm"
													rows={1}
												/>
												<button
													type="button"
													onClick={handleSendMessage}
													disabled={!messageText.trim()}
													className="px-6 py-2.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white rounded-xl text-sm font-bold hover:from-indigo-600 hover:via-purple-600 hover:to-pink-600 disabled:from-slate-300 disabled:via-slate-300 disabled:to-slate-300 disabled:cursor-not-allowed transition-all duration-200 shadow-lg hover:shadow-xl hover:scale-105 disabled:hover:scale-100"
												>
													Send
												</button>
											</div>
										</div>
									</>
								) : (
									<div className="flex items-center justify-center h-full bg-gradient-to-br from-indigo-50/30 to-purple-50/30">
										<div className="text-center">
											<div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 mb-4 shadow-lg">
												<i className="fas fa-comments text-3xl text-indigo-500" aria-hidden="true" />
											</div>
											<p className="text-sm text-slate-600 font-semibold">Select an employee to start messaging</p>
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
