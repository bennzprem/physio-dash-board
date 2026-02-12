'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { collection, doc, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc, query, where, orderBy, serverTimestamp, type QuerySnapshot, type Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/PageHeader';

// Messaging Interfaces
interface StaffMember {
	id: string;
	userName: string;
	role: string;
	status: string;
	profileImage?: string;
	userEmail?: string;
}

interface Attachment {
	name: string;
	url: string;
	type: string;
	size: number;
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
	attachments?: Attachment[];
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


export default function Notifications() {
	const { user } = useAuth();
	
	// Messaging State
	const [staff, setStaff] = useState<StaffMember[]>([]);
	const [selectedEmployee, setSelectedEmployee] = useState<StaffMember | null>(null);
	const [messages, setMessages] = useState<Message[]>([]);
	const [conversations, setConversations] = useState<Conversation[]>([]);
	const [messageText, setMessageText] = useState('');
	const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
	const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
	const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
	const [uploadingFiles, setUploadingFiles] = useState(false);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

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
				setStaff([...mapped.filter(s => s.status === 'Active' && s.id !== user?.uid)]);
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
				setConversations([...mapped]);
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
						attachments: data.attachments || [],
					} as Message;
				});
				setMessages([...mapped]);
				
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

	const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(e.target.files || []);
		if (files.length === 0) return;

		// Limit to 5 files max
		const newFiles = [...selectedFiles, ...files].slice(0, 5);
		setSelectedFiles(newFiles);

		// Reset input
		if (fileInputRef.current) {
			fileInputRef.current.value = '';
		}
	};

	const handleRemoveFile = (index: number) => {
		setSelectedFiles(prev => prev.filter((_, i) => i !== index));
	};

	const formatFileSize = (bytes: number): string => {
		if (bytes === 0) return '0 Bytes';
		const k = 1024;
		const sizes = ['Bytes', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
	};

	const getFileIcon = (type: string): string => {
		if (type.startsWith('image/')) return 'fas fa-image';
		if (type.includes('pdf')) return 'fas fa-file-pdf';
		if (type.includes('word') || type.includes('document')) return 'fas fa-file-word';
		if (type.includes('excel') || type.includes('spreadsheet')) return 'fas fa-file-excel';
		if (type.includes('zip') || type.includes('rar')) return 'fas fa-file-archive';
		return 'fas fa-file';
	};

	const handleSendMessage = async () => {
		if ((!messageText.trim() && selectedFiles.length === 0) || !selectedEmployee || !user?.uid) return;

		const participants = [user.uid, selectedEmployee.id].sort();
		const conversationId = participants.join('_');

		const currentUser = staff.find(s => s.userEmail === user.email) || staff.find(s => s.id === user.uid);
		const senderName = currentUser?.userName || user.displayName || user.email?.split('@')[0] || 'User';
		const senderImage = currentUser?.profileImage || '';

		setUploadingFiles(true);

		try {
			// Ensure conversation exists first
			const convId = await getOrCreateConversation(selectedEmployee.id, selectedEmployee.userName, selectedEmployee.profileImage);
			if (!convId) {
				throw new Error('Failed to create or find conversation');
			}

			// Upload files to Firebase Storage
			const attachments: Attachment[] = [];
			if (selectedFiles.length > 0) {
				for (const file of selectedFiles) {
					try {
						const timestamp = Date.now();
						const fileName = `${timestamp}_${file.name}`;
						const storageRef = ref(storage, `messages/${convId}/${fileName}`);
						
						await uploadBytes(storageRef, file);
						const downloadURL = await getDownloadURL(storageRef);
						
						attachments.push({
							name: file.name,
							url: downloadURL,
							type: file.type,
							size: file.size,
						});
					} catch (uploadError) {
						console.error('Failed to upload file:', file.name, uploadError);
						// Continue with other files even if one fails
					}
				}
			}

			// Create message
			const messagePreview = messageText.trim() || (attachments.length > 0 ? `Sent ${attachments.length} file(s)` : '');
			const messageData: Record<string, unknown> = {
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
			};
			
			// Only include attachments if there are any (Firestore doesn't allow undefined)
			if (attachments.length > 0) {
				messageData.attachments = attachments;
			}
			
			await addDoc(collection(db, 'messages'), messageData);

			// Update conversation
			try {
				await updateDoc(doc(db, 'conversations', convId), {
					lastMessage: messagePreview,
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
			setSelectedFiles([]);
			setUploadingFiles(false);
		} catch (error) {
			console.error('Failed to send message', error);
			setUploadingFiles(false);
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			alert(`Failed to send message: ${errorMessage}. Please check the browser console for details.`);
		}
	};


	const handleDeleteMessage = async (messageId: string) => {
		if (!user?.uid) return;

		const message = messages.find(m => m.id === messageId);
		if (!message) return;

		// Only allow sender or admin/super admin to delete
		const isSender = message.senderId === user.uid;
		const userRole = user.role?.trim();
		const isAdmin = userRole === 'Admin' || userRole === 'admin' || userRole === 'SuperAdmin' || userRole === 'superadmin';

		if (!isSender && !isAdmin) {
			alert('You can only delete your own messages.');
			return;
		}

		// Confirm deletion
		if (!confirm('Are you sure you want to delete this message?')) {
			return;
		}

		setDeletingMessageId(messageId);

		try {
			// Delete attachments from Firebase Storage
			if (message.attachments && message.attachments.length > 0) {
				for (const attachment of message.attachments) {
					try {
						// Extract the file path from the download URL
						// URLs are typically: https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{path}?alt=media&token=...
						const url = new URL(attachment.url);
						const pathMatch = url.pathname.match(/\/o\/(.+)\?/);
						if (pathMatch) {
							const filePath = decodeURIComponent(pathMatch[1]);
							const storageRef = ref(storage, filePath);
							await deleteObject(storageRef);
						}
					} catch (deleteError) {
						console.error('Failed to delete attachment:', attachment.name, deleteError);
						// Continue with other attachments even if one fails
					}
				}
			}

			// Delete message from Firestore
			await deleteDoc(doc(db, 'messages', messageId));
		} catch (error) {
			console.error('Failed to delete message', error);
			alert('Failed to delete message. Please try again.');
		} finally {
			setDeletingMessageId(null);
		}
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

	return (
		<div className="min-h-svh bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 px-6 py-10">
			<div className="mx-auto max-w-7xl">
			<PageHeader
					title="Messaging"
				/>

				<div className="mt-6 h-[calc(100vh-12rem)]">
					{/* Messaging - full width */}
					<div className="h-full flex flex-col rounded-2xl bg-white/80 backdrop-blur-sm shadow-lg border border-white/20 overflow-hidden">
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
													const userRole = user?.role?.trim();
													const isAdmin = userRole === 'Admin' || userRole === 'admin' || userRole === 'SuperAdmin' || userRole === 'superadmin';
													const canDelete = isOwn || isAdmin;
													const isHovered = hoveredMessageId === message.id;
													const isDeleting = deletingMessageId === message.id;
													return (
														<div
															key={message.id}
															className={`flex gap-3 ${isOwn ? 'justify-end' : 'justify-start'} items-end group relative`}
															onMouseEnter={() => setHoveredMessageId(message.id)}
															onMouseLeave={() => setHoveredMessageId(null)}
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
															<div className={`flex flex-col max-w-[75%] ${isOwn ? 'items-end' : 'items-start'} relative`}>
																{!isOwn && (
																	<p className="text-xs font-semibold text-slate-700 mb-1 px-1">{message.senderName}</p>
																)}
																<div
																	className={`rounded-2xl px-4 py-2.5 text-sm shadow-md relative ${
																		isOwn
																			? 'bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white font-medium'
																			: 'bg-white text-slate-900 border-2 border-emerald-200 font-medium'
																	} ${isDeleting ? 'opacity-50' : ''}`}
																>
																	{canDelete && isHovered && (
																		<button
																			type="button"
																			onClick={() => handleDeleteMessage(message.id)}
																			disabled={isDeleting}
																			className={`absolute -top-2 ${isOwn ? '-left-2' : '-right-2'} z-10 p-1.5 rounded-full bg-red-500 text-white shadow-lg hover:bg-red-600 transition-all duration-200 hover:scale-110 disabled:opacity-50 disabled:cursor-not-allowed`}
																			title="Delete message"
																		>
																			{isDeleting ? (
																				<i className="fas fa-spinner fa-spin text-xs" aria-hidden="true" />
																			) : (
																				<i className="fas fa-trash text-xs" aria-hidden="true" />
																			)}
																		</button>
																	)}
																	{message.text && (
																		<p className="whitespace-pre-wrap break-words leading-relaxed mb-2">{message.text}</p>
																	)}
																	{message.attachments && message.attachments.length > 0 && (
																		<div className="space-y-2 mt-2">
																			{message.attachments.map((attachment, idx) => (
																				<a
																					key={idx}
																					href={attachment.url}
																					target="_blank"
																					rel="noopener noreferrer"
																					className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all duration-200 hover:scale-[1.02] ${
																						isOwn
																							? 'bg-white/20 border-white/30 hover:bg-white/30'
																							: 'bg-slate-50 border-slate-200 hover:bg-slate-100'
																					}`}
																				>
																					<div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${
																						isOwn ? 'bg-white/20' : 'bg-indigo-100'
																					}`}>
																						<i className={`${getFileIcon(attachment.type)} ${isOwn ? 'text-white' : 'text-indigo-600'}`} aria-hidden="true" />
																					</div>
																					<div className="flex-1 min-w-0">
																						<p className={`text-sm font-semibold truncate ${isOwn ? 'text-white' : 'text-slate-900'}`}>
																							{attachment.name}
																						</p>
																						<p className={`text-xs ${isOwn ? 'text-white/80' : 'text-slate-500'}`}>
																							{formatFileSize(attachment.size)}
																						</p>
																					</div>
																					<i className={`fas fa-download ${isOwn ? 'text-white/70' : 'text-slate-400'}`} aria-hidden="true" />
																				</a>
																			))}
																		</div>
																	)}
																</div>
																<div className="flex items-center gap-2 mt-1.5 px-1">
																	<p className={`text-xs font-medium ${isOwn ? 'text-slate-500' : 'text-slate-600'}`}>{formatTime(message.createdAt)}</p>
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
											{selectedFiles.length > 0 && (
												<div className="mb-3 p-3 bg-white rounded-xl border-2 border-indigo-200 shadow-sm">
													<div className="flex items-center justify-between mb-2">
														<p className="text-xs font-semibold text-slate-700">
															{selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''} selected
														</p>
														{selectedFiles.length >= 5 && (
															<p className="text-xs text-amber-600">Maximum 5 files</p>
														)}
													</div>
													<div className="space-y-2">
														{selectedFiles.map((file, index) => (
															<div
																key={index}
																className="flex items-center gap-3 p-2 bg-slate-50 rounded-lg border border-slate-200"
															>
																<div className="flex-shrink-0 w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
																	<i className={`${getFileIcon(file.type)} text-indigo-600 text-sm`} aria-hidden="true" />
																</div>
																<div className="flex-1 min-w-0">
																	<p className="text-xs font-medium text-slate-900 truncate">{file.name}</p>
																	<p className="text-xs text-slate-500">{formatFileSize(file.size)}</p>
																</div>
																<button
																	type="button"
																	onClick={() => handleRemoveFile(index)}
																	className="flex-shrink-0 p-1 text-red-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
																	title="Remove file"
																>
																	<i className="fas fa-times text-xs" aria-hidden="true" />
																</button>
															</div>
														))}
													</div>
												</div>
											)}
											<div className="flex items-end gap-2">
												<input
													ref={fileInputRef}
													type="file"
													multiple
													onChange={handleFileSelect}
													className="hidden"
													accept="*/*"
													id="file-input"
												/>
												<label
													htmlFor="file-input"
													className="p-2.5 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-xl transition-all duration-200 hover:scale-110 shadow-sm cursor-pointer border-2 border-indigo-200"
													title="Attach file"
												>
													<i className="fas fa-paperclip text-lg" aria-hidden="true" />
												</label>
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
													disabled={(!messageText.trim() && selectedFiles.length === 0) || uploadingFiles}
													className="px-6 py-2.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white rounded-xl text-sm font-bold hover:from-indigo-600 hover:via-purple-600 hover:to-pink-600 disabled:from-slate-300 disabled:via-slate-300 disabled:to-slate-300 disabled:cursor-not-allowed transition-all duration-200 shadow-lg hover:shadow-xl hover:scale-105 disabled:hover:scale-100 relative"
												>
													{uploadingFiles ? (
														<span className="flex items-center gap-2">
															<i className="fas fa-spinner fa-spin" aria-hidden="true" />
															Uploading...
														</span>
													) : (
														'Send'
													)}
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
