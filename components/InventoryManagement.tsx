'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, where, getDocs, getDoc, serverTimestamp, type QuerySnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/PageHeader';

interface InventoryItem {
	id: string;
	name: string;
	category: 'consumable' | 'non-consumable';
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
	itemCategory?: 'consumable' | 'non-consumable';
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
	const [loading, setLoading] = useState(true);

	// Form states
	const [showAddItemModal, setShowAddItemModal] = useState(false);
	const [showIssueModal, setShowIssueModal] = useState(false);
	const [showReturnModal, setShowReturnModal] = useState(false);

	const [newItem, setNewItem] = useState({ 
		name: '', 
		category: '' as 'consumable' | 'non-consumable' | '', 
		type: 'Physiotherapy' as ItemType, 
		totalQuantity: 0 
	});
	const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
	const [issueForm, setIssueForm] = useState({ itemId: '', quantity: 0 });
	const [returnForm, setReturnForm] = useState({ issueRecordId: '', quantity: 0 });
	const [selectedIssueRecord, setSelectedIssueRecord] = useState<IssueRecord | null>(null);

	const [submitting, setSubmitting] = useState(false);
	const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);


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
						category: (data.category === 'consumable' || data.category === 'non-consumable') 
							? data.category 
							: 'non-consumable' as 'consumable' | 'non-consumable', // Default to non-consumable for existing items
						type: data.type || 'Physiotherapy',
						totalQuantity: data.totalQuantity || 0,
						issuedQuantity: data.issuedQuantity || 0,
						returnedQuantity: data.returnedQuantity || 0,
						remainingQuantity: 0, // Will be calculated from issue records
						createdAt: data.createdAt,
						updatedAt: data.updatedAt,
					} as InventoryItem;
				});

				// Calculate initial remainingQuantity for each item
				const itemsWithRemaining = mapped.map(item => ({
					...item,
					remainingQuantity: Math.max(0, item.totalQuantity - item.issuedQuantity),
				}));

				setItems(itemsWithRemaining);
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

	// Calculate issued and remaining quantities from issue records
	useEffect(() => {
		if (items.length === 0) {
			return;
		}

		// If no issue records, just set remaining = total - issued
		if (issueRecords.length === 0) {
			setItems(prevItems => 
				prevItems.map(item => ({
					...item,
					remainingQuantity: Math.max(0, item.totalQuantity - (item.issuedQuantity || 0)),
				}))
			);
			return;
		}

		// Calculate actual issued and returned quantities from issue records
		setItems(prevItems => 
			prevItems.map(item => {
				// Find all issue records for this item
				const itemIssues = issueRecords.filter(record => record.itemId === item.id);
				
				// If no issue records for this item, use stored values
				if (itemIssues.length === 0) {
					return {
						...item,
						remainingQuantity: Math.max(0, item.totalQuantity - (item.issuedQuantity || 0)),
					};
				}
				
				// Calculate total issued (sum of all issued quantities, regardless of status)
				const totalIssued = itemIssues.reduce((sum, record) => sum + record.quantity, 0);
				
				// Calculate total returned (sum of all returned quantities)
				const totalReturned = itemIssues.reduce((sum, record) => sum + (record.returnedQuantity || 0), 0);
				
				// Currently issued = total issued - total returned
				const currentlyIssued = totalIssued - totalReturned;
				
				// Remaining = Total - Currently Issued
				const remaining = Math.max(0, item.totalQuantity - currentlyIssued);
				
				return {
					...item,
					issuedQuantity: currentlyIssued,
					returnedQuantity: totalReturned,
					remainingQuantity: remaining,
				};
			})
		);
	}, [items.length, issueRecords]);

	// Load issue records
	useEffect(() => {
		if (!user) return;

		const unsubscribe = onSnapshot(
			collection(db, 'inventoryIssues'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data();
					// Get category from issue record, or fallback to finding it from items
					let itemCategory: 'consumable' | 'non-consumable' | undefined = 
						(data.itemCategory === 'consumable' || data.itemCategory === 'non-consumable') 
							? data.itemCategory 
							: undefined;
					
					// If category not in issue record, try to get it from items array
					if (!itemCategory && data.itemId) {
						const relatedItem = items.find(item => item.id === data.itemId);
						if (relatedItem) {
							itemCategory = relatedItem.category;
						}
					}
					
					return {
						id: docSnap.id,
						itemId: data.itemId || '',
						itemName: data.itemName || '',
						itemType: data.itemType || '',
						itemCategory: itemCategory,
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
	}, [user, items]);

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

		if (!newItem.category) {
			alert('Please select a category (Consumable or Non-Consumable)');
			setSubmitting(false);
			return;
		}

		setSubmitting(true);
		try {
			await addDoc(collection(db, 'inventoryItems'), {
				name: newItem.name.trim(),
				category: newItem.category,
				type: newItem.type,
				totalQuantity: newItem.totalQuantity,
				issuedQuantity: 0,
				returnedQuantity: 0,
				createdBy: user.uid,
				createdByName: user.displayName || user.email?.split('@')[0] || 'User',
				createdAt: serverTimestamp(),
				updatedAt: serverTimestamp(),
			});

			setNewItem({ name: '', category: '', type: 'Physiotherapy', totalQuantity: 0 });
			setShowAddItemModal(false);
			alert('Item added successfully!');
		} catch (error) {
			console.error('Failed to add item:', error);
			alert('Failed to add item. Please try again.');
		} finally {
			setSubmitting(false);
		}
	};

	const handleUpdateItem = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!user || !editingItem) {
			alert('User not authenticated or item not selected');
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

		// Validate that new total quantity is not less than currently issued quantity
		if (newItem.totalQuantity < editingItem.issuedQuantity) {
			alert(`Total quantity cannot be less than issued quantity (${editingItem.issuedQuantity})`);
			return;
		}

		if (!newItem.category) {
			alert('Please select a category (Consumable or Non-Consumable)');
			setSubmitting(false);
			return;
		}

		setSubmitting(true);
		try {
			await updateDoc(doc(db, 'inventoryItems', editingItem.id), {
				name: newItem.name.trim(),
				category: newItem.category,
				type: newItem.type,
				totalQuantity: newItem.totalQuantity,
				updatedAt: serverTimestamp(),
				updatedBy: user.uid,
				updatedByName: user.displayName || user.email?.split('@')[0] || 'User',
			});

			setNewItem({ name: '', category: '', type: 'Physiotherapy', totalQuantity: 0 });
			setEditingItem(null);
			setShowAddItemModal(false);
			alert('Item updated successfully!');
		} catch (error) {
			console.error('Failed to update item:', error);
			alert('Failed to update item. Please try again.');
		} finally {
			setSubmitting(false);
		}
	};

	const handleEditItem = (item: InventoryItem) => {
		setEditingItem(item);
		setNewItem({
			name: item.name,
			category: item.category,
			type: item.type,
			totalQuantity: item.totalQuantity,
		});
		setShowAddItemModal(true);
	};

	const handleIssueItemFromRow = (item: InventoryItem) => {
		setIssueForm({
			itemId: item.id,
			quantity: 0,
		});
		setShowIssueModal(true);
	};

	const handleDeleteItem = async (item: InventoryItem) => {
		if (!user) {
			setNotification({ message: 'User not authenticated', type: 'error' });
			setTimeout(() => setNotification(null), 3000);
			return;
		}

		// Check if item has issued quantities
		if (item.issuedQuantity > 0) {
			setNotification({ 
				message: `Cannot delete item. ${item.issuedQuantity} items are currently issued. Please return all items before deleting.`, 
				type: 'error' 
			});
			setTimeout(() => setNotification(null), 5000);
			return;
		}

		// Check if item has issue history
		const hasIssueHistory = issueRecords.some(record => record.itemId === item.id);
		if (hasIssueHistory) {
			const confirmMessage = `This item has issue history. Are you sure you want to delete "${item.name}"?\n\nThis action cannot be undone.`;
			if (!confirm(confirmMessage)) {
				return;
			}
		} else {
			if (!confirm(`Are you sure you want to delete "${item.name}"?\n\nThis action cannot be undone.`)) {
				return;
			}
		}

		setSubmitting(true);
		try {
			await deleteDoc(doc(db, 'inventoryItems', item.id));
			setNotification({ message: 'Item deleted successfully!', type: 'success' });
			setTimeout(() => setNotification(null), 3000);
		} catch (error) {
			console.error('Failed to delete item:', error);
			setNotification({ message: 'Failed to delete item. Please try again.', type: 'error' });
			setTimeout(() => setNotification(null), 5000);
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

		if (!issueForm.itemId || issueForm.quantity <= 0) {
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

		setSubmitting(true);
		try {
			// Update item's issued quantity immediately when item is issued
			const itemRef = doc(db, 'inventoryItems', issueForm.itemId);
			const itemDoc = await getDoc(itemRef);
			if (itemDoc.exists()) {
				const currentItem = itemDoc.data();
				await updateDoc(itemRef, {
					issuedQuantity: (currentItem.issuedQuantity || 0) + issueForm.quantity,
					updatedAt: serverTimestamp(),
				});
			}

			// Create issue record
			await addDoc(collection(db, 'inventoryIssues'), {
				itemId: issueForm.itemId,
				itemName: selectedItem.name,
				itemType: selectedItem.type,
				itemCategory: selectedItem.category,
				quantity: issueForm.quantity,
				issuedBy: user.uid,
				issuedByName: user.displayName || user.email?.split('@')[0] || 'FrontDesk',
				issuedTo: '',
				issuedToName: '',
				issuedToEmail: null,
				status: 'acknowledged',
				returnedQuantity: 0,
				createdAt: serverTimestamp(),
				updatedAt: serverTimestamp(),
			});

			setIssueForm({ itemId: '', quantity: 0 });
			setShowIssueModal(false);
			alert('Item issued successfully!');
		} catch (error) {
			console.error('Failed to issue item:', error);
			alert('Failed to issue item. Please try again.');
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

		// Check if item is consumable - consumables cannot be returned
		if (issueRecord.itemCategory === 'consumable') {
			alert('Consumable items cannot be returned. They are used up when issued.');
			return;
		}

		// Calculate remaining quantity to return (accounting for already returned items)
		const remainingQuantity = issueRecord.quantity - (issueRecord.returnedQuantity || 0);
		if (returnForm.quantity > remainingQuantity) {
			alert(`Cannot return more than ${remainingQuantity} items (${issueRecord.quantity} issued, ${issueRecord.returnedQuantity || 0} already returned)`);
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

			// Update item's returned quantity immediately
			const itemRef = doc(db, 'inventoryItems', issueRecord.itemId);
			const itemDoc = await getDoc(itemRef);
			if (itemDoc.exists()) {
				const currentItem = itemDoc.data();
				await updateDoc(itemRef, {
					returnedQuantity: (currentItem.returnedQuantity || 0) + returnForm.quantity,
					issuedQuantity: (currentItem.issuedQuantity || 0) - returnForm.quantity,
					updatedAt: serverTimestamp(),
				});
			}

			setReturnForm({ issueRecordId: '', quantity: 0 });
			setShowReturnModal(false);
			alert('Return recorded successfully!');
		} catch (error) {
			console.error('Failed to return item:', error);
			alert('Failed to return item. Please try again.');
		} finally {
			setSubmitting(false);
		}
	};


	const handleAdminReturnItem = async (record: IssueRecord) => {
		if (!user || !isAdminOrSuperAdmin) {
			alert('Only admins can manually return items');
			return;
		}

		// Check if item is consumable - consumables cannot be returned
		if (record.itemCategory === 'consumable') {
			alert('Consumable items cannot be returned. They are used up when issued.');
			return;
		}

		const returnQuantity = record.quantity - (record.returnedQuantity || 0);
		if (returnQuantity <= 0) {
			alert('All items have already been returned');
			return;
		}

		if (!confirm(`Mark ${returnQuantity} ${record.itemName} as returned?`)) {
			return;
		}

		setSubmitting(true);
		try {
			// Update issue record
			await updateDoc(doc(db, 'inventoryIssues', record.id), {
				status: 'returned',
				returnedAt: serverTimestamp(),
				returnedBy: user.uid,
				returnedQuantity: record.quantity, // Return all remaining items
				updatedAt: serverTimestamp(),
			});

			// Update item's returned quantity
			const itemRef = doc(db, 'inventoryItems', record.itemId);
			const itemDoc = await getDoc(itemRef);
			if (itemDoc.exists()) {
				const currentItem = itemDoc.data();
				const newReturnedQuantity = (currentItem.returnedQuantity || 0) + returnQuantity;
				// Only reduce issued quantity if it was previously acknowledged
				const newIssuedQuantity = record.status === 'acknowledged' 
					? (currentItem.issuedQuantity || 0) - returnQuantity
					: (currentItem.issuedQuantity || 0);
				await updateDoc(itemRef, {
					returnedQuantity: newReturnedQuantity,
					issuedQuantity: newIssuedQuantity,
					updatedAt: serverTimestamp(),
				});
			}

			alert('Item marked as returned successfully!');
		} catch (error) {
			console.error('Failed to return item:', error);
			alert('Failed to return item. Please try again.');
		} finally {
			setSubmitting(false);
		}
	};

	const isFrontDesk = user?.role === 'FrontDesk' || user?.role === 'frontdesk';
	const isAdmin = user?.role === 'Admin';
	const isSuperAdmin = user?.role === 'SuperAdmin' || user?.role === 'Super Admin' || user?.role === 'superadmin';
	const isAdminOrSuperAdmin = isAdmin || isSuperAdmin;
	const isClinicalTeam = user?.role === 'ClinicalTeam' || user?.role === 'clinic' || user?.role === 'Clinic';
	const canManageInventory = isFrontDesk || isAdmin || isSuperAdmin || isClinicalTeam;


	return (
		<div className="min-h-svh bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 px-6 py-10">
			<div className="mx-auto max-w-7xl space-y-6">
				{/* Notification Banner */}
				{notification && (
					<div
						className={`fixed top-4 right-4 z-50 flex items-center gap-3 rounded-lg px-4 py-3 shadow-lg transition-all duration-300 ${
							notification.type === 'success'
								? 'bg-green-50 border-2 border-green-200 text-green-800'
								: 'bg-red-50 border-2 border-red-200 text-red-800'
						}`}
					>
						<i
							className={`fas ${notification.type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'} text-lg`}
							aria-hidden="true"
						/>
						<p className="font-semibold text-sm">{notification.message}</p>
						<button
							type="button"
							onClick={() => setNotification(null)}
							className="ml-2 text-slate-500 hover:text-slate-700"
							aria-label="Close notification"
						>
							<i className="fas fa-times" aria-hidden="true" />
						</button>
					</div>
				)}

				<div className="flex items-center justify-between">
					<PageHeader title="Inventory Management" />
					{canManageInventory && (
						<button
							type="button"
							onClick={() => {
								setEditingItem(null);
								setNewItem({ name: '', category: '', type: 'Physiotherapy', totalQuantity: 0 });
								setShowAddItemModal(true);
							}}
							className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:from-blue-700 hover:via-blue-800 hover:to-indigo-700 transition-all duration-200 hover:scale-105"
						>
							<i className="fas fa-plus text-xs" aria-hidden="true" />
							Add New Item
						</button>
					)}
				</div>


				{/* Inventory Items List */}
				<section className="rounded-2xl bg-white p-6 shadow-lg border border-slate-200">
					<div className="flex items-center justify-between mb-4">
						<h2 className="text-lg font-semibold text-slate-900">Inventory Items</h2>
						{canManageInventory && (
							<button
								type="button"
								onClick={() => {
									setIssueForm({ itemId: '', quantity: 0 });
									setShowIssueModal(true);
								}}
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
										<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Category</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Type</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Total Quantity</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Issued</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Returned</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Remaining</th>
										{canManageInventory && (
											<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Actions</th>
										)}
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100 bg-white">
									{items.map(item => (
										<tr key={item.id} className="hover:bg-slate-50">
											<td className="px-4 py-3 text-sm font-medium text-slate-900">{item.name}</td>
											<td className="px-4 py-3 text-sm">
												<span
													className={`px-2 py-1 rounded-full text-xs font-semibold ${
														item.category === 'consumable'
															? 'bg-orange-100 text-orange-700'
															: 'bg-blue-100 text-blue-700'
													}`}
												>
													{item.category === 'consumable' ? 'Consumable' : 'Non-Consumable'}
												</span>
											</td>
											<td className="px-4 py-3 text-sm text-slate-600">{item.type}</td>
											<td className="px-4 py-3 text-sm text-slate-600">{item.totalQuantity}</td>
											<td className="px-4 py-3 text-sm text-slate-600">{item.issuedQuantity}</td>
											<td className="px-4 py-3 text-sm text-slate-600">{item.returnedQuantity}</td>
											<td className="px-4 py-3 text-sm font-semibold text-slate-900">{item.remainingQuantity}</td>
											{canManageInventory && (
												<td className="px-4 py-3 text-sm">
													<div className="flex items-center gap-2">
														<button
															type="button"
															onClick={() => handleEditItem(item)}
															className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-md hover:from-blue-700 hover:via-blue-800 hover:to-indigo-700 transition-all duration-200 hover:scale-105"
														>
															<i className="fas fa-edit text-xs" aria-hidden="true" />
															Edit
														</button>
														{item.remainingQuantity > 0 && (
															<button
																type="button"
																onClick={() => handleIssueItemFromRow(item)}
																className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-indigo-600 via-indigo-700 to-purple-600 px-3 py-1.5 text-xs font-semibold text-white shadow-md hover:from-indigo-700 hover:via-indigo-800 hover:to-purple-700 transition-all duration-200 hover:scale-105"
															>
																<i className="fas fa-hand-holding text-xs" aria-hidden="true" />
																Issue
															</button>
														)}
														<button
															type="button"
															onClick={() => handleDeleteItem(item)}
															disabled={submitting || item.issuedQuantity > 0}
															className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-red-600 via-red-700 to-rose-600 px-3 py-1.5 text-xs font-semibold text-white shadow-md hover:from-red-700 hover:via-red-800 hover:to-rose-700 transition-all duration-200 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
															title={item.issuedQuantity > 0 ? 'Cannot delete item with issued quantities' : 'Delete item'}
														>
															<i className="fas fa-trash text-xs" aria-hidden="true" />
															Delete
														</button>
													</div>
												</td>
											)}
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
						{canManageInventory && (
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
										{isAdminOrSuperAdmin && (
											<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Actions</th>
										)}
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100 bg-white">
									{issueRecords.map(record => {
										const remainingToReturn = record.quantity - (record.returnedQuantity || 0);
										const isConsumable = record.itemCategory === 'consumable';
										const canReturn = isAdminOrSuperAdmin && remainingToReturn > 0 && !isConsumable;
										
										return (
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
												{isAdminOrSuperAdmin && (
													<td className="px-4 py-3 text-sm">
														{canReturn ? (
															<button
																type="button"
																onClick={() => handleAdminReturnItem(record)}
																disabled={submitting}
																className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-orange-600 via-orange-700 to-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-md hover:from-orange-700 hover:via-orange-800 hover:to-red-700 transition-all duration-200 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
															>
																<i className="fas fa-undo text-xs" aria-hidden="true" />
																Return
															</button>
														) : isConsumable ? (
															<span className="text-xs text-slate-500 italic" title="Consumable items cannot be returned">
																Consumable
															</span>
														) : (
															<span className="text-xs text-slate-400">—</span>
														)}
													</td>
												)}
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</section>
			</div>

			{/* Add/Edit Item Modal */}
			{showAddItemModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
					<div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
						<h3 className="text-lg font-semibold text-slate-900 mb-4">
							{editingItem ? 'Edit Item' : 'Add New Item'}
						</h3>
						<form onSubmit={editingItem ? handleUpdateItem : handleAddItem} className="space-y-4">
							{editingItem && (
								<div className="mb-4 p-3 bg-slate-50 rounded-lg">
									<p className="text-xs text-slate-600 mb-1">
										<strong>Current Status:</strong> {editingItem.issuedQuantity} issued, {editingItem.returnedQuantity} returned
									</p>
									<p className="text-xs text-slate-500">
										Total quantity must be at least {editingItem.issuedQuantity} (currently issued items)
									</p>
								</div>
							)}
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
								<label className="block text-sm font-medium text-slate-700 mb-2">
									Category <span className="text-red-500">*</span>
								</label>
								<div className="flex gap-4">
									<label className="flex items-center gap-2 cursor-pointer">
										<input
											type="radio"
											name="category"
											value="non-consumable"
											checked={newItem.category === 'non-consumable'}
											onChange={e => setNewItem({ ...newItem, category: e.target.value as 'non-consumable', type: 'Physiotherapy' })}
											className="w-4 h-4 text-blue-600 focus:ring-blue-500"
											required
										/>
										<span className="text-sm text-slate-700">Non Consumables</span>
									</label>
									<label className="flex items-center gap-2 cursor-pointer">
										<input
											type="radio"
											name="category"
											value="consumable"
											checked={newItem.category === 'consumable'}
											onChange={e => setNewItem({ ...newItem, category: e.target.value as 'consumable', type: 'Physiotherapy' })}
											className="w-4 h-4 text-blue-600 focus:ring-blue-500"
											required
										/>
										<span className="text-sm text-slate-700">Consumables</span>
									</label>
								</div>
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
									disabled={!newItem.category}
								>
									{newItem.category === 'non-consumable' ? (
										<>
											<option value="Physiotherapy">Physiotherapy</option>
											<option value="Strength and Conditioning">Strength and Conditioning</option>
											<option value="Psychological">Psychological</option>
										</>
									) : newItem.category === 'consumable' ? (
										<>
											<option value="Physiotherapy">Physiotherapy</option>
											<option value="Strength and Conditioning">Strength and Conditioning</option>
											<option value="Psychological">Psychological</option>
										</>
									) : (
										<option value="">Select category first</option>
									)}
								</select>
							</div>
							<div>
								<label htmlFor="totalQuantity" className="block text-sm font-medium text-slate-700 mb-2">
									Total Quantity <span className="text-red-500">*</span>
								</label>
								<input
									id="totalQuantity"
									type="number"
									min={editingItem ? editingItem.issuedQuantity : 1}
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
										setNewItem({ name: '', category: '', type: 'Physiotherapy', totalQuantity: 0 });
										setEditingItem(null);
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
											{editingItem ? 'Updating...' : 'Adding...'}
										</>
									) : (
										<>
											<i className={`fas ${editingItem ? 'fa-save' : 'fa-plus'} text-xs`} aria-hidden="true" />
											{editingItem ? 'Update Item' : 'Add Item'}
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
							<div className="flex items-center gap-3 justify-end pt-4">
								<button
									type="button"
									onClick={() => {
										setShowIssueModal(false);
										setIssueForm({ itemId: '', quantity: 0 });
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
										.filter(r => {
											// Show only non-consumable items that are acknowledged and not fully returned
											const remainingToReturn = r.quantity - (r.returnedQuantity || 0);
											const isConsumable = r.itemCategory === 'consumable';
											return r.status === 'acknowledged' && remainingToReturn > 0 && !isConsumable;
										})
										.map(record => {
											const remainingToReturn = record.quantity - (record.returnedQuantity || 0);
											return (
												<option key={record.id} value={record.id}>
													{record.itemName} - Issued: {record.quantity} to {record.issuedToName} (Remaining: {remainingToReturn})
												</option>
											);
										})}
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

		</div>
	);
}
