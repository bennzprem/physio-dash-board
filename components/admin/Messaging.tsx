'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { collection, doc, onSnapshot, addDoc, updateDoc, query, where, orderBy, serverTimestamp, type QuerySnapshot, type Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/PageHeader';

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
	reactions?: Record<string, string[]>; // emoji -> array of user IDs who reacted
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

export default function Messaging() {
	const { user } = useAuth();
	const [staff, setStaff] = useState<StaffMember[]>([]);
	const [selectedEmployee, setSelectedEmployee] = useState<StaffMember | null>(null);
	const [messages, setMessages] = useState<Message[]>([]);
	const [conversations, setConversations] = useState<Conversation[]>([]);
	const [messageText, setMessageText] = useState('');
	const [showEmojiPicker, setShowEmojiPicker] = useState(false);
	const [replyingToMessage, setReplyingToMessage] = useState<Message | null>(null);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	// Load staff from Firestore
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

	// Load conversations for current user
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

		// Create conversation ID (sorted to ensure consistency)
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
				
				// Mark messages as read
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

	// Scroll to bottom when new messages arrive
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [messages]);

	// Get or create conversation
	const getOrCreateConversation = async (otherUserId: string, otherUserName: string, otherUserImage?: string) => {
		if (!user?.uid) return null;

		const participants = [user.uid, otherUserId].sort();
		const conversationId = participants.join('_');

		// Check if conversation exists
		const existingConv = conversations.find(c => c.id === conversationId);
		if (existingConv) {
			return existingConv.id;
		}

		// Create new conversation
		const currentUser = staff.find(s => s.userEmail === user.email) || staff.find(s => s.id === user.uid);
		const currentUserName = currentUser?.userName || user.displayName || user.email?.split('@')[0] || 'User';
		const currentUserImage = currentUser?.profileImage || '';

		try {
			const convRef = await addDoc(collection(db, 'conversations'), {
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
			return convRef.id;
		} catch (error) {
			console.error('Failed to create conversation', error);
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
			// Get or create conversation
			await getOrCreateConversation(selectedEmployee.id, selectedEmployee.userName, selectedEmployee.profileImage);

			// Add message
			await addDoc(collection(db, 'messages'), {
				conversationId,
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
			await updateDoc(doc(db, 'conversations', conversationId), {
				lastMessage: messageText.trim(),
				lastMessageAt: serverTimestamp(),
				unreadCount: {
					[user.uid]: 0,
					[selectedEmployee.id]: (conversations.find(c => c.id === conversationId)?.unreadCount?.[selectedEmployee.id] || 0) + 1,
				},
			});

			setMessageText('');
			setShowEmojiPicker(false);
			setReplyingToMessage(null);
		} catch (error) {
			console.error('Failed to send message', error);
			alert('Failed to send message. Please try again.');
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
				// Remove reaction
				newReactions[emoji] = usersWhoReacted.filter(id => id !== user.uid);
				if (newReactions[emoji].length === 0) {
					delete newReactions[emoji];
				}
			} else {
				// Add reaction
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

	const getOtherParticipant = (conversation: Conversation) => {
		if (!user?.uid) return null;
		const otherId = conversation.participants.find(p => p !== user.uid);
		if (!otherId) return null;
		return {
			id: otherId,
			name: conversation.participantNames[otherId] || 'Unknown',
			image: conversation.participantImages[otherId] || '',
		};
	};

	return (
		<div className="min-h-svh bg-slate-50 px-6 py-10">
			<div className="mx-auto max-w-7xl">
				<PageHeader
					title="Messaging"
					description="Communicate with your team members. Send messages, emojis, and react to conversations."
				/>

				<div className="mt-6 grid h-[calc(100vh-12rem)] grid-cols-12 gap-4">
					{/* Employee List / Conversations */}
					<div className="col-span-12 lg:col-span-4 flex flex-col rounded-2xl bg-white shadow-sm border border-slate-200">
						<div className="p-4 border-b border-slate-200">
							<h3 className="text-lg font-semibold text-slate-900">Employees</h3>
						</div>
						<div className="flex-1 overflow-y-auto">
							{staff.length === 0 ? (
								<div className="p-4 text-center text-sm text-slate-500">No employees found</div>
							) : (
								<div className="divide-y divide-slate-100">
									{staff.map(employee => (
										<button
											key={employee.id}
											type="button"
											onClick={() => setSelectedEmployee(employee)}
											className={`w-full p-4 text-left hover:bg-slate-50 transition-colors ${
												selectedEmployee?.id === employee.id ? 'bg-sky-50 border-l-4 border-sky-500' : ''
											}`}
										>
											<div className="flex items-center gap-3">
												{employee.profileImage ? (
													<img
														src={employee.profileImage}
														alt={employee.userName}
														className="h-12 w-12 rounded-full object-cover"
													/>
												) : (
													<div className="h-12 w-12 rounded-full bg-sky-100 flex items-center justify-center">
														<i className="fas fa-user text-sky-600" aria-hidden="true" />
													</div>
												)}
												<div className="flex-1 min-w-0">
													<p className="font-semibold text-slate-900 truncate">{employee.userName}</p>
													<p className="text-xs text-slate-500">{employee.role}</p>
												</div>
											</div>
										</button>
									))}
								</div>
							)}
						</div>
					</div>

					{/* Chat Area */}
					<div className="col-span-12 lg:col-span-8 flex flex-col rounded-2xl bg-white shadow-sm border border-slate-200">
						{selectedEmployee ? (
							<>
								{/* Chat Header */}
								<div className="p-4 border-b border-slate-200 flex items-center justify-between">
									<div className="flex items-center gap-3">
										{selectedEmployee.profileImage ? (
											<img
												src={selectedEmployee.profileImage}
												alt={selectedEmployee.userName}
												className="h-10 w-10 rounded-full object-cover"
											/>
										) : (
											<div className="h-10 w-10 rounded-full bg-sky-100 flex items-center justify-center">
												<i className="fas fa-user text-sky-600" aria-hidden="true" />
											</div>
										)}
										<div>
											<p className="font-semibold text-slate-900">{selectedEmployee.userName}</p>
											<p className="text-xs text-slate-500">{selectedEmployee.role}</p>
										</div>
									</div>
								</div>

								{/* Messages */}
								<div className="flex-1 overflow-y-auto p-4 space-y-4">
									{messages.length === 0 ? (
										<div className="flex items-center justify-center h-full">
											<p className="text-sm text-slate-500">No messages yet. Start the conversation!</p>
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
																	className="h-8 w-8 rounded-full object-cover"
																/>
															) : (
																<div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center">
																	<i className="fas fa-user text-slate-600 text-xs" aria-hidden="true" />
																</div>
															)}
														</div>
													)}
													<div className={`flex flex-col max-w-[70%] ${isOwn ? 'items-end' : 'items-start'}`}>
														<div
															className={`rounded-2xl px-4 py-2 ${
																isOwn
																	? 'bg-sky-600 text-white'
																	: 'bg-slate-100 text-slate-900'
															}`}
														>
															<p className="text-sm whitespace-pre-wrap break-words">{message.text}</p>
														</div>
														<div className="flex items-center gap-2 mt-1">
															<p className="text-xs text-slate-500">{formatTime(message.createdAt)}</p>
															{/* Reactions */}
															{message.reactions && Object.keys(message.reactions).length > 0 && (
																<div className="flex gap-1">
																	{Object.entries(message.reactions).map(([emoji, userIds]) => (
																		<button
																			key={emoji}
																			type="button"
																			onClick={() => handleReaction(message.id, emoji)}
																			className={`text-xs px-2 py-0.5 rounded-full border ${
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
															{/* Reaction Button */}
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
																			className="text-lg hover:scale-125 transition-transform p-1"
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
																	className="h-8 w-8 rounded-full object-cover"
																/>
															) : (
																<div className="h-8 w-8 rounded-full bg-sky-100 flex items-center justify-center">
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

								{/* Message Input */}
								<div className="p-4 border-t border-slate-200">
									{showEmojiPicker && (
										<div className="mb-2 p-3 bg-white rounded-lg border border-slate-200 shadow-lg max-h-64 overflow-y-auto">
											<div className="grid grid-cols-10 gap-1">
												{EMOJI_LIST.map(emoji => (
													<button
														key={emoji}
														type="button"
														onClick={() => insertEmoji(emoji)}
														className="text-xl hover:scale-125 transition-transform p-1 hover:bg-slate-100 rounded"
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
											className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
											title="Add emoji"
										>
											<i className="far fa-smile text-xl" aria-hidden="true" />
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
											className="flex-1 resize-none rounded-lg border border-slate-300 px-4 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
											rows={1}
										/>
										<button
											type="button"
											onClick={handleSendMessage}
											disabled={!messageText.trim()}
											className="px-6 py-2 bg-sky-600 text-white rounded-lg font-semibold hover:bg-sky-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
										>
											Send
										</button>
									</div>
								</div>
							</>
						) : (
							<div className="flex items-center justify-center h-full">
								<div className="text-center">
									<i className="fas fa-comments text-4xl text-slate-300 mb-4" aria-hidden="true" />
									<p className="text-slate-500">Select an employee to start messaging</p>
								</div>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

