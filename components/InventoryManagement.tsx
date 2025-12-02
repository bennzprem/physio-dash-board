'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, doc, query, where, getDocs, getDoc, serverTimestamp, type QuerySnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/PageHeader';

interface InventoryItem {
	id: string;
	name: string;
	type: 'Physiotherapy' | 'Strength and Conditioning' | 'Psychological';
	totalQuantity: number;
	issuedQuantity: number;
	returnedQuantity: number;
	remainingQuantity: number;
	createdAt: any;
	updatedAt: any;
}

interface IssueRecord {
	id: string;
	itemId: string;
	itemName: string;
	itemType: string;
	quantity: number;
	issuedBy: string;
	issuedByName: string;
	issuedTo: string;
	issuedToName: string;
	issuedToEmail: string | null;
	status: 'pending_acknowledgment' | 'acknowledged' | 'returned';
	acknowledgedAt: any;
	acknowledgedBy: string | null;
	returnedAt: any;
	returnedBy: string | null;
	returnedQuantity: number;
	createdAt: any;
	updatedAt: any;
}

type ItemType = 'Physiotherapy' | 'Strength and Conditioning' | 'Psychological';

export default function InventoryManagement() {
	const { user } = useAuth();
	const [items, setItems] = useState<InventoryItem[]>([]);
	const [issueRecords, setIssueRecords] = useState<IssueRecord[]>([]);
	const [staff, setStaff] = useState<Array<{ id: string; userName: string; userEmail: string; role: string }>>([]);
	const [loading, setLoading] = useState(true);

	// Form states
	const [showAddItemModal, setShowAddItemModal] = useState(false);
	const [showIssueModal, setShowIssueModal] = useState(false);
	const [showReturnModal, setShowReturnModal] = useState(false);
	const [showAcknowledgeModal, setShowAcknowledgeModal] = useState(false);

	const [newItem, setNewItem] = useState({ name: '', type: 'Physiotherapy' as ItemType, totalQuantity: 0 });
	const [issueForm, setIssueForm] = useState({ itemId: '', quantity: 0, issuedTo: '' });
	const [returnForm, setReturnForm] = useState({ issueRecordId: '', quantity: 0 });
	const [selectedIssueRecord, setSelectedIssueRecord] = useState<IssueRecord | null>(null);

	const [submitting, setSubmitting] = useState(false);

	// Load staff members (for issuing to clinical team)
	useEffect(() => {
		if (!user) return;

		const unsubscribe = onSnapshot(
			collection(db, 'staff'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs
					.map(docSnap => {
						const data = docSnap.data();
						return {
							id: docSnap.id,
							userName: data.userName || data.name || '',
							userEmail: data.userEmail || '',
							role: data.role || '',
							status: data.status || 'Active',
						};
					})
					.filter(s => s.status !== 'Inactive' && (s.role === 'ClinicalTeam' || s.role === 'Physiotherapist' || s.role === 'StrengthAndConditioning'));

				setStaff(mapped);
			},
			error => {
				console.error('Failed to load staff', error);
				setStaff([]);
			}
		);

		return () => unsubscribe();
	}, [user]);

	// Load inventory items
	useEffect(() => {
		if (!user) return;

		const unsubscribe = onSnapshot(
			collection(db, 'inventoryItems'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data();
					return {
						id: docSnap.id,
						name: data.name || '',
						type: data.type || 'Physiotherapy',
						totalQuantity: data.totalQuantity || 0,
						issuedQuantity: data.issuedQuantity || 0,
						returnedQuantity: data.returnedQuantity || 0,
						remainingQuantity: (data.totalQuantity || 0) - (data.issuedQuantity || 0) + (data.returnedQuantity || 0),
						createdAt: data.createdAt,
						updatedAt: data.updatedAt,
					} as InventoryItem;
				});

				setItems(mapped);
				setLoading(false);
			},
			error => {
				console.error('Failed to load inventory items', error);
				setItems([]);
				setLoading(false);
			}
		);

		return () => unsubscribe();
	}, [user]);

	// Load issue records
	useEffect(() => {
		if (!user) return;

		const unsubscribe = onSnapshot(
			collection(db, 'inventoryIssues'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data();
					return {
						id: docSnap.id,
						itemId: data.itemId || '',
						itemName: data.itemName || '',
						itemType: data.itemType || '',
						quantity: data.quantity || 0,
						issuedBy: data.issuedBy || '',
						issuedByName: data.issuedByName || '',
						issuedTo: data.issuedTo || '',
						issuedToName: data.issuedToName || '',
						issuedToEmail: data.issuedToEmail || null,
						status: data.status || 'pending_acknowledgment',
						acknowledgedAt: data.acknowledgedAt,
						acknowledgedBy: data.acknowledgedBy || null,
						returnedAt: data.returnedAt,
						returnedBy: data.returnedBy || null,
						returnedQuantity: data.returnedQuantity || 0,
						createdAt: data.createdAt,
						updatedAt: data.updatedAt,
					} as IssueRecord;
				});

				setIssueRecords(mapped);
			},
			error => {
				console.error('Failed to load issue records', error);
				setIssueRecords([]);
			}
		);

		return () => unsubscribe();
	}, [user]);

	const handleAddItem = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!user) {
			alert('User not authenticated');
			return;
		}

		if (!newItem.name.trim()) {
			alert('Please enter item name');
			return;
		}

		if (newItem.totalQuantity <= 0) {
			alert('Please enter a valid quantity');
			return;
		}

		setSubmitting(true);
		try {
			await addDoc(collection(db, 'inventoryItems'), {
				name: newItem.name.trim(),
				type: newItem.type,
				totalQuantity: newItem.totalQuantity,
				issuedQuantity: 0,
				returnedQuantity: 0,
				createdBy: user.uid,
				createdByName: user.displayName || user.email?.split('@')[0] || 'User',
				createdAt: serverTimestamp(),
				updatedAt: serverTimestamp(),
			});

			setNewItem({ name: '', type: 'Physiotherapy', totalQuantity: 0 });
			setShowAddItemModal(false);
			alert('Item added successfully!');
		} catch (error) {
			console.error('Failed to add item:', error);
			alert('Failed to add item. Please try again.');
		} finally {
			setSubmitting(false);
		}
	};

	const handleIssueItem = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!user) {
			alert('User not authenticated');
			return;
		}

		if (!issueForm.itemId || !issueForm.issuedTo || issueForm.quantity <= 0) {
			alert('Please fill all fields correctly');
			return;
		}

		const selectedItem = items.find(i => i.id === issueForm.itemId);
		if (!selectedItem) {
			alert('Item not found');
			return;
		}

		if (issueForm.quantity > selectedItem.remainingQuantity) {
			alert(`Only ${selectedItem.remainingQuantity} items available`);
			return;
		}

		const selectedStaff = staff.find(s => s.id === issueForm.issuedTo);
		if (!selectedStaff) {
			alert('Staff member not found');
			return;
		}

		setSubmitting(true);
		try {
			// Create issue record with pending acknowledgment
			const issueRef = await addDoc(collection(db, 'inventoryIssues'), {
				itemId: issueForm.itemId,
				itemName: selectedItem.name,
				itemType: selectedItem.type,
				quantity: issueForm.quantity,
				issuedBy: user.uid,
				issuedByName: user.displayName || user.email?.split('@')[0] || 'FrontDesk',
				issuedTo: issueForm.issuedTo,
				issuedToName: selectedStaff.userName,
				issuedToEmail: selectedStaff.userEmail,
				status: 'pending_acknowledgment',
				returnedQuantity: 0,
				createdAt: serverTimestamp(),
				updatedAt: serverTimestamp(),
			});

			// Send notification to clinical team member for acknowledgment
			try {
				const usersQuery = query(collection(db, 'users'), where('email', '==', selectedStaff.userEmail.toLowerCase()));
				const usersSnapshot = await getDocs(usersQuery);
				if (!usersSnapshot.empty) {
					const clinicalUserId = usersSnapshot.docs[0].id;
					await addDoc(collection(db, 'notifications'), {
						userId: clinicalUserId,
						title: 'Inventory Item Issued - Acknowledgment Required',
						message: `${user.displayName || user.email?.split('@')[0] || 'FrontDesk'} has issued ${issueForm.quantity} ${selectedItem.name} (${selectedItem.type}) to you. Please acknowledge to confirm receipt.`,
						category: 'inventory_issue',
						status: 'unread',
						inventoryIssueId: issueRef.id,
						itemName: selectedItem.name,
						quantity: issueForm.quantity,
						createdAt: serverTimestamp(),
					});
				}
			} catch (notifError) {
				console.error('Failed to send notification:', notifError);
			}

			setIssueForm({ itemId: '', quantity: 0, issuedTo: '' });
			setShowIssueModal(false);
			alert('Item issued successfully! The clinical team member has been notified for acknowledgment.');
		} catch (error) {
			console.error('Failed to issue item:', error);
			alert('Failed to issue item. Please try again.');
		} finally {
			setSubmitting(false);
		}
	};

	const handleAcknowledge = async () => {
		if (!selectedIssueRecord || !user) return;

		setSubmitting(true);
		try {
			// Update issue record status
			await updateDoc(doc(db, 'inventoryIssues', selectedIssueRecord.id), {
				status: 'acknowledged',
				acknowledgedAt: serverTimestamp(),
				acknowledgedBy: user.uid,
				updatedAt: serverTimestamp(),
			});

			// Update item's issued quantity (only after acknowledgment)
			const itemRef = doc(db, 'inventoryItems', selectedIssueRecord.itemId);
			const itemDoc = await getDoc(itemRef);
			if (itemDoc.exists()) {
				const currentItem = itemDoc.data();
				await updateDoc(itemRef, {
					issuedQuantity: (currentItem.issuedQuantity || 0) + selectedIssueRecord.quantity,
					updatedAt: serverTimestamp(),
				});
			}

			// Send notification to FrontDesk
			try {
				const frontdeskQuery = query(collection(db, 'users'), where('email', '==', (selectedIssueRecord.issuedBy || '').toLowerCase()));
				const frontdeskSnapshot = await getDocs(frontdeskQuery);
				if (!frontdeskSnapshot.empty) {
					const frontdeskUserId = frontdeskSnapshot.docs[0].id;
					await addDoc(collection(db, 'notifications'), {
						userId: frontdeskUserId,
						title: 'Inventory Item Acknowledged',
						message: `${user.displayName || user.email?.split('@')[0] || 'Clinical Team'} has acknowledged receipt of ${selectedIssueRecord.quantity} ${selectedIssueRecord.itemName}.`,
						category: 'inventory_acknowledgment',
						status: 'unread',
						inventoryIssueId: selectedIssueRecord.id,
						createdAt: serverTimestamp(),
					});
				}
			} catch (notifError) {
				console.error('Failed to send acknowledgment notification:', notifError);
			}

			setShowAcknowledgeModal(false);
			setSelectedIssueRecord(null);
			alert('Item acknowledged successfully!');
		} catch (error) {
			console.error('Failed to acknowledge item:', error);
			alert('Failed to acknowledge item. Please try again.');
		} finally {
			setSubmitting(false);
		}
	};

	const handleReturnItem = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!user) {
			alert('User not authenticated');
			return;
		}

		if (!returnForm.issueRecordId || returnForm.quantity <= 0) {
			alert('Please fill all fields correctly');
			return;
		}

		const issueRecord = issueRecords.find(r => r.id === returnForm.issueRecordId);
		if (!issueRecord) {
			alert('Issue record not found');
			return;
		}

		if (returnForm.quantity > issueRecord.quantity) {
			alert(`Cannot return more than ${issueRecord.quantity} items`);
			return;
		}

		setSubmitting(true);
		try {
			// Update issue record
			await updateDoc(doc(db, 'inventoryIssues', returnForm.issueRecordId), {
				status: 'returned',
				returnedAt: serverTimestamp(),
				returnedBy: user.uid,
				returnedQuantity: returnForm.quantity,
				updatedAt: serverTimestamp(),
			});

			// Send notification to clinical team member for acknowledgment
			try {
				if (issueRecord.issuedToEmail) {
					const usersQuery = query(collection(db, 'users'), where('email', '==', issueRecord.issuedToEmail.toLowerCase()));
					const usersSnapshot = await getDocs(usersQuery);
					if (!usersSnapshot.empty) {
						const clinicalUserId = usersSnapshot.docs[0].id;
						await addDoc(collection(db, 'notifications'), {
							userId: clinicalUserId,
							title: 'Inventory Item Returned - Acknowledgment Required',
							message: `${user.displayName || user.email?.split('@')[0] || 'FrontDesk'} has marked ${returnForm.quantity} ${issueRecord.itemName} as returned. Please acknowledge to confirm.`,
							category: 'inventory_return',
							status: 'unread',
							inventoryIssueId: returnForm.issueRecordId,
							itemName: issueRecord.itemName,
							quantity: returnForm.quantity,
							createdAt: serverTimestamp(),
						});
					}
				}
			} catch (notifError) {
				console.error('Failed to send return notification:', notifError);
			}

			setReturnForm({ issueRecordId: '', quantity: 0 });
			setShowReturnModal(false);
			alert('Return recorded! The clinical team member has been notified for acknowledgment.');
		} catch (error) {
			console.error('Failed to return item:', error);
			alert('Failed to return item. Please try again.');
		} finally {
			setSubmitting(false);
		}
	};

	const handleAcknowledgeReturn = async () => {
		if (!selectedIssueRecord || !user) return;

		setSubmitting(true);
		try {
			// Update item's returned quantity (only after acknowledgment)
			const itemRef = doc(db, 'inventoryItems', selectedIssueRecord.itemId);
			const itemDoc = await getDoc(itemRef);
			if (itemDoc.exists()) {
				const currentItem = itemDoc.data();
				await updateDoc(itemRef, {
					returnedQuantity: (currentItem.returnedQuantity || 0) + (selectedIssueRecord.returnedQuantity || 0),
					issuedQuantity: (currentItem.issuedQuantity || 0) - (selectedIssueRecord.returnedQuantity || 0),
					updatedAt: serverTimestamp(),
				});
			}

			// Send notification to FrontDesk
			try {
				const frontdeskQuery = query(collection(db, 'users'), where('email', '==', (selectedIssueRecord.issuedBy || '').toLowerCase()));
				const frontdeskSnapshot = await getDocs(frontdeskQuery);
				if (!frontdeskSnapshot.empty) {
					const frontdeskUserId = frontdeskSnapshot.docs[0].id;
					await addDoc(collection(db, 'notifications'), {
						userId: frontdeskUserId,
						title: 'Inventory Return Acknowledged',
						message: `${user.displayName || user.email?.split('@')[0] || 'Clinical Team'} has acknowledged return of ${selectedIssueRecord.returnedQuantity} ${selectedIssueRecord.itemName}.`,
						category: 'inventory_return_acknowledgment',
						status: 'unread',
						inventoryIssueId: selectedIssueRecord.id,
						createdAt: serverTimestamp(),
					});
				}
			} catch (notifError) {
				console.error('Failed to send return acknowledgment notification:', notifError);
			}

			setShowAcknowledgeModal(false);
			setSelectedIssueRecord(null);
			alert('Return acknowledged successfully!');
		} catch (error) {
			console.error('Failed to acknowledge return:', error);
			alert('Failed to acknowledge return. Please try again.');
		} finally {
			setSubmitting(false);
		}
	};

	const isFrontDesk = user?.role === 'FrontDesk' || user?.role === 'frontdesk';
	const isAdmin = user?.role === 'Admin';
	const isClinicalTeam = user?.role === 'ClinicalTeam' || user?.role === 'clinic' || user?.role === 'Clinic';

	// Get pending acknowledgments for current user (clinical team)
	const pendingAcknowledgments = useMemo(() => {
		if (!isClinicalTeam || !user) return [];
		return issueRecords.filter(record => {
			const userEmail = user.email?.toLowerCase();
			return (
				record.issuedToEmail?.toLowerCase() === userEmail &&
				(record.status === 'pending_acknowledgment' || (record.status === 'returned' && !record.acknowledgedBy))
			);
		});
	}, [issueRecords, isClinicalTeam, user]);

	return (
		<div className="min-h-svh bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 px-6 py-10">
			<div className="mx-auto max-w-7xl space-y-6">
				<div className="flex items-center justify-between">
					<PageHeader title="Inventory Management" />
					{isFrontDesk && (
						<button
							type="button"
							onClick={() => setShowAddItemModal(true)}
							className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:from-blue-700 hover:via-blue-800 hover:to-indigo-700 transition-all duration-200 hover:scale-105"
						>
							<i className="fas fa-plus text-xs" aria-hidden="true" />
							Add New Item
						</button>
					)}
				</div>

				{/* Pending Acknowledgments (Clinical Team) */}
				{isClinicalTeam && pendingAcknowledgments.length > 0 && (
					<section className="rounded-2xl bg-yellow-50 border-2 border-yellow-200 p-6 shadow-lg">
						<h2 className="text-lg font-semibold text-yellow-900 mb-4">Pending Acknowledgments</h2>
						<div className="space-y-3">
							{pendingAcknowledgments.map(record => (
								<div key={record.id} className="bg-white rounded-lg p-4 border border-yellow-300">
									<div className="flex items-center justify-between">
										<div>
											<p className="font-semibold text-slate-900">{record.itemName}</p>
											<p className="text-sm text-slate-600">
												{record.status === 'pending_acknowledgment'
													? `Issued: ${record.quantity} items by ${record.issuedByName}`
													: `Returned: ${record.returnedQuantity} items by ${record.issuedByName}`}
											</p>
										</div>
										<button
											type="button"
											onClick={() => {
												setSelectedIssueRecord(record);
												setShowAcknowledgeModal(true);
											}}
											className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-green-600 via-green-700 to-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:from-green-700 hover:via-green-800 hover:to-emerald-700 transition-all duration-200 hover:scale-105"
										>
											<i className="fas fa-check text-xs" aria-hidden="true" />
											Acknowledge
										</button>
									</div>
								</div>
							))}
						</div>
					</section>
				)}

				{/* Inventory Items List */}
				<section className="rounded-2xl bg-white p-6 shadow-lg border border-slate-200">
					<div className="flex items-center justify-between mb-4">
						<h2 className="text-lg font-semibold text-slate-900">Inventory Items</h2>
						{isFrontDesk && (
							<button
								type="button"
								onClick={() => setShowIssueModal(true)}
								className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 via-indigo-700 to-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:from-indigo-700 hover:via-indigo-800 hover:to-purple-700 transition-all duration-200 hover:scale-105"
							>
								<i className="fas fa-hand-holding text-xs" aria-hidden="true" />
								Issue Items
							</button>
						)}
					</div>

					{loading ? (
						<div className="text-center py-8 text-slate-500">Loading inventory...</div>
					) : items.length === 0 ? (
						<div className="text-center py-8 text-slate-500">No inventory items found</div>
					) : (
						<div className="overflow-x-auto">
							<table className="min-w-full divide-y divide-slate-200">
								<thead className="bg-slate-50">
									<tr>
										<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Item Name</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Type</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Total Quantity</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Issued</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Returned</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Remaining</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100 bg-white">
									{items.map(item => (
										<tr key={item.id} className="hover:bg-slate-50">
											<td className="px-4 py-3 text-sm font-medium text-slate-900">{item.name}</td>
											<td className="px-4 py-3 text-sm text-slate-600">{item.type}</td>
											<td className="px-4 py-3 text-sm text-slate-600">{item.totalQuantity}</td>
											<td className="px-4 py-3 text-sm text-slate-600">{item.issuedQuantity}</td>
											<td className="px-4 py-3 text-sm text-slate-600">{item.returnedQuantity}</td>
											<td className="px-4 py-3 text-sm font-semibold text-slate-900">{item.remainingQuantity}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</section>

				{/* Issue Records */}
				<section className="rounded-2xl bg-white p-6 shadow-lg border border-slate-200">
					<div className="flex items-center justify-between mb-4">
						<h2 className="text-lg font-semibold text-slate-900">Items Issued</h2>
						{isFrontDesk && (
							<button
								type="button"
								onClick={() => setShowReturnModal(true)}
								className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-orange-600 via-orange-700 to-red-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:from-orange-700 hover:via-orange-800 hover:to-red-700 transition-all duration-200 hover:scale-105"
							>
								<i className="fas fa-undo text-xs" aria-hidden="true" />
								Return Items
							</button>
						)}
					</div>

					{issueRecords.length === 0 ? (
						<div className="text-center py-8 text-slate-500">No issue records found</div>
					) : (
						<div className="overflow-x-auto">
							<table className="min-w-full divide-y divide-slate-200">
								<thead className="bg-slate-50">
									<tr>
										<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Item</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Type</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Quantity</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Issued By</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Issued To</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Status</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Returned</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100 bg-white">
									{issueRecords.map(record => (
										<tr key={record.id} className="hover:bg-slate-50">
											<td className="px-4 py-3 text-sm font-medium text-slate-900">{record.itemName}</td>
											<td className="px-4 py-3 text-sm text-slate-600">{record.itemType}</td>
											<td className="px-4 py-3 text-sm text-slate-600">{record.quantity}</td>
											<td className="px-4 py-3 text-sm text-slate-600">{record.issuedByName}</td>
											<td className="px-4 py-3 text-sm text-slate-600">{record.issuedToName}</td>
											<td className="px-4 py-3 text-sm">
												<span
													className={`px-2 py-1 rounded-full text-xs font-semibold ${
														record.status === 'acknowledged'
															? 'bg-green-100 text-green-700'
															: record.status === 'returned'
																? 'bg-orange-100 text-orange-700'
																: 'bg-yellow-100 text-yellow-700'
													}`}
												>
													{record.status === 'acknowledged'
														? 'Acknowledged'
														: record.status === 'returned'
															? 'Returned'
															: 'Pending'}
												</span>
											</td>
											<td className="px-4 py-3 text-sm text-slate-600">{record.returnedQuantity || 0}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</section>
			</div>

			{/* Add Item Modal */}
			{showAddItemModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
					<div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
						<h3 className="text-lg font-semibold text-slate-900 mb-4">Add New Item</h3>
						<form onSubmit={handleAddItem} className="space-y-4">
							<div>
								<label htmlFor="itemName" className="block text-sm font-medium text-slate-700 mb-2">
									Item Name <span className="text-red-500">*</span>
								</label>
								<input
									id="itemName"
									type="text"
									value={newItem.name}
									onChange={e => setNewItem({ ...newItem, name: e.target.value })}
									className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
									required
								/>
							</div>
							<div>
								<label htmlFor="itemType" className="block text-sm font-medium text-slate-700 mb-2">
									Type <span className="text-red-500">*</span>
								</label>
								<select
									id="itemType"
									value={newItem.type}
									onChange={e => setNewItem({ ...newItem, type: e.target.value as ItemType })}
									className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
									required
								>
									<option value="Physiotherapy">Physiotherapy</option>
									<option value="Strength and Conditioning">Strength and Conditioning</option>
									<option value="Psychological">Psychological</option>
								</select>
							</div>
							<div>
								<label htmlFor="totalQuantity" className="block text-sm font-medium text-slate-700 mb-2">
									Total Quantity <span className="text-red-500">*</span>
								</label>
								<input
									id="totalQuantity"
									type="number"
									min="1"
									value={newItem.totalQuantity || ''}
									onChange={e => setNewItem({ ...newItem, totalQuantity: parseInt(e.target.value) || 0 })}
									className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
									required
								/>
							</div>
							<div className="flex items-center gap-3 justify-end pt-4">
								<button
									type="button"
									onClick={() => {
										setShowAddItemModal(false);
										setNewItem({ name: '', type: 'Physiotherapy', totalQuantity: 0 });
									}}
									className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900"
								>
									Cancel
								</button>
								<button
									type="submit"
									disabled={submitting}
									className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:from-blue-700 hover:via-blue-800 hover:to-indigo-700 transition-all duration-200 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
								>
									{submitting ? (
										<>
											<div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
											Adding...
										</>
									) : (
										<>
											<i className="fas fa-plus text-xs" aria-hidden="true" />
											Add Item
										</>
									)}
								</button>
							</div>
						</form>
					</div>
				</div>
			)}

			{/* Issue Item Modal */}
			{showIssueModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
					<div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
						<h3 className="text-lg font-semibold text-slate-900 mb-4">Issue Items</h3>
						<form onSubmit={handleIssueItem} className="space-y-4">
							<div>
								<label htmlFor="issueItemId" className="block text-sm font-medium text-slate-700 mb-2">
									Item <span className="text-red-500">*</span>
								</label>
								<select
									id="issueItemId"
									value={issueForm.itemId}
									onChange={e => setIssueForm({ ...issueForm, itemId: e.target.value })}
									className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
									required
								>
									<option value="">Select an item...</option>
									{items.map(item => (
										<option key={item.id} value={item.id}>
											{item.name} ({item.type}) - Available: {item.remainingQuantity}
										</option>
									))}
								</select>
							</div>
							<div>
								<label htmlFor="issueQuantity" className="block text-sm font-medium text-slate-700 mb-2">
									Quantity <span className="text-red-500">*</span>
								</label>
								<input
									id="issueQuantity"
									type="number"
									min="1"
									value={issueForm.quantity || ''}
									onChange={e => setIssueForm({ ...issueForm, quantity: parseInt(e.target.value) || 0 })}
									className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
									required
								/>
							</div>
							<div>
								<label htmlFor="issueTo" className="block text-sm font-medium text-slate-700 mb-2">
									Issue To (Clinical Team) <span className="text-red-500">*</span>
								</label>
								<select
									id="issueTo"
									value={issueForm.issuedTo}
									onChange={e => setIssueForm({ ...issueForm, issuedTo: e.target.value })}
									className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
									required
								>
									<option value="">Select clinical team member...</option>
									{staff.map(member => (
										<option key={member.id} value={member.id}>
											{member.userName}
										</option>
									))}
								</select>
							</div>
							<div className="flex items-center gap-3 justify-end pt-4">
								<button
									type="button"
									onClick={() => {
										setShowIssueModal(false);
										setIssueForm({ itemId: '', quantity: 0, issuedTo: '' });
									}}
									className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900"
								>
									Cancel
								</button>
								<button
									type="submit"
									disabled={submitting}
									className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 via-indigo-700 to-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:from-indigo-700 hover:via-indigo-800 hover:to-purple-700 transition-all duration-200 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
								>
									{submitting ? (
										<>
											<div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
											Issuing...
										</>
									) : (
										<>
											<i className="fas fa-hand-holding text-xs" aria-hidden="true" />
											Issue Item
										</>
									)}
								</button>
							</div>
						</form>
					</div>
				</div>
			)}

			{/* Return Item Modal */}
			{showReturnModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
					<div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
						<h3 className="text-lg font-semibold text-slate-900 mb-4">Return Items</h3>
						<form onSubmit={handleReturnItem} className="space-y-4">
							<div>
								<label htmlFor="returnIssueId" className="block text-sm font-medium text-slate-700 mb-2">
									Issue Record <span className="text-red-500">*</span>
								</label>
								<select
									id="returnIssueId"
									value={returnForm.issueRecordId}
									onChange={e => setReturnForm({ ...returnForm, issueRecordId: e.target.value })}
									className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
									required
								>
									<option value="">Select an issue record...</option>
									{issueRecords
										.filter(r => r.status === 'acknowledged')
										.map(record => (
											<option key={record.id} value={record.id}>
												{record.itemName} - Issued: {record.quantity} to {record.issuedToName}
											</option>
										))}
								</select>
							</div>
							<div>
								<label htmlFor="returnQuantity" className="block text-sm font-medium text-slate-700 mb-2">
									Return Quantity <span className="text-red-500">*</span>
								</label>
								<input
									id="returnQuantity"
									type="number"
									min="1"
									value={returnForm.quantity || ''}
									onChange={e => setReturnForm({ ...returnForm, quantity: parseInt(e.target.value) || 0 })}
									className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
									required
								/>
							</div>
							<div className="flex items-center gap-3 justify-end pt-4">
								<button
									type="button"
									onClick={() => {
										setShowReturnModal(false);
										setReturnForm({ issueRecordId: '', quantity: 0 });
									}}
									className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900"
								>
									Cancel
								</button>
								<button
									type="submit"
									disabled={submitting}
									className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-orange-600 via-orange-700 to-red-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:from-orange-700 hover:via-orange-800 hover:to-red-700 transition-all duration-200 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
								>
									{submitting ? (
										<>
											<div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
											Recording...
										</>
									) : (
										<>
											<i className="fas fa-undo text-xs" aria-hidden="true" />
											Record Return
										</>
									)}
								</button>
							</div>
						</form>
					</div>
				</div>
			)}

			{/* Acknowledge Modal */}
			{showAcknowledgeModal && selectedIssueRecord && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
					<div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
						<h3 className="text-lg font-semibold text-slate-900 mb-4">
							{selectedIssueRecord.status === 'pending_acknowledgment' ? 'Acknowledge Receipt' : 'Acknowledge Return'}
						</h3>
						<div className="mb-4">
							<p className="text-sm text-slate-600 mb-2">
								{selectedIssueRecord.status === 'pending_acknowledgment' ? (
									<>
										Confirm receipt of <strong>{selectedIssueRecord.quantity}</strong> {selectedIssueRecord.itemName} issued by{' '}
										<strong>{selectedIssueRecord.issuedByName}</strong>?
									</>
								) : (
									<>
										Confirm return of <strong>{selectedIssueRecord.returnedQuantity}</strong> {selectedIssueRecord.itemName}?
									</>
								)}
							</p>
						</div>
						<div className="flex items-center gap-3 justify-end pt-4">
							<button
								type="button"
								onClick={() => {
									setShowAcknowledgeModal(false);
									setSelectedIssueRecord(null);
								}}
								className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={() => {
									if (selectedIssueRecord.status === 'pending_acknowledgment') {
										handleAcknowledge();
									} else {
										handleAcknowledgeReturn();
									}
								}}
								disabled={submitting}
								className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-green-600 via-green-700 to-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:from-green-700 hover:via-green-800 hover:to-emerald-700 transition-all duration-200 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
							>
								{submitting ? (
									<>
										<div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
										Acknowledging...
									</>
								) : (
									<>
										<i className="fas fa-check text-xs" aria-hidden="true" />
										Acknowledge
									</>
								)}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
