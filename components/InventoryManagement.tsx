'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, where, getDocs, getDoc, serverTimestamp, writeBatch, type QuerySnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/PageHeader';
// @ts-ignore - papaparse types may not be available
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

interface InventoryItem {
	id: string;
	name: string;
	category: 'consumable' | 'non-consumable';
	type: 'Physiotherapy' | 'Strength and Conditioning' | 'Psychological' | 'Biomechanics';
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
	remarks: string | null;
	createdAt: any;
	updatedAt: any;
}

type ItemType = 'Physiotherapy' | 'Strength and Conditioning' | 'Psychological' | 'Biomechanics';

export default function InventoryManagement() {
	const { user } = useAuth();
	const [items, setItems] = useState<InventoryItem[]>([]);
	const [issueRecords, setIssueRecords] = useState<IssueRecord[]>([]);
	const [loading, setLoading] = useState(true);

	// Form states
	const [showAddItemModal, setShowAddItemModal] = useState(false);
	const [showIssueModal, setShowIssueModal] = useState(false);
	const [showReturnModal, setShowReturnModal] = useState(false);
	const [showImportModal, setShowImportModal] = useState(false);
	const [importFile, setImportFile] = useState<File | null>(null);
	const [importing, setImporting] = useState(false);
	const [importPreview, setImportPreview] = useState<any[]>([]);

	const [newItem, setNewItem] = useState({ 
		name: '', 
		category: '' as 'consumable' | 'non-consumable' | '', 
		type: 'Physiotherapy' as ItemType, 
		totalQuantity: 0 
	});
	const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
	const [issueForm, setIssueForm] = useState({ itemId: '', quantity: 0, issuedTo: '', remarks: '' });
	const [returnForm, setReturnForm] = useState({ issueRecordId: '', quantity: 0 });
	const [selectedIssueRecord, setSelectedIssueRecord] = useState<IssueRecord | null>(null);
	const [editingRemarksId, setEditingRemarksId] = useState<string | null>(null);
	const [editingRemarksValue, setEditingRemarksValue] = useState<string>('');
	const [staff, setStaff] = useState<Array<{
		id: string;
		userName: string;
		userEmail: string;
		role: string;
		status: string;
	}>>([]);

	const [submitting, setSubmitting] = useState(false);
	const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
	const [searchTerm, setSearchTerm] = useState('');
	const [categoryFilter, setCategoryFilter] = useState<'all' | 'consumable' | 'non-consumable'>('all');
	const [typeFilter, setTypeFilter] = useState<'all' | ItemType>('all');

	// Use ref to store latest items to avoid circular dependency in useEffect
	const itemsRef = useRef<InventoryItem[]>([]);
	useEffect(() => {
		itemsRef.current = items;
	}, [items]);

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
					// Use ref to access latest items without causing dependency loop
					if (!itemCategory && data.itemId) {
						const relatedItem = itemsRef.current.find(item => item.id === data.itemId);
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
						remarks: data.remarks || null,
						createdAt: data.createdAt,
						updatedAt: data.updatedAt,
					} as IssueRecord;
				});

				setIssueRecords([...mapped]);
			},
			error => {
				console.error('Failed to load issue records', error);
				setIssueRecords([]);
			}
		);

		return () => unsubscribe();
	}, [user]); // Removed items from dependencies to prevent circular dependency

	// Load staff members for "Issue To" dropdown
	useEffect(() => {
		if (!user) return;

		const unsubscribe = onSnapshot(
			collection(db, 'staff'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data();
					return {
						id: docSnap.id,
						userName: data.userName ? String(data.userName) : '',
						userEmail: data.userEmail ? String(data.userEmail) : '',
						role: data.role ? String(data.role) : '',
						status: data.status ? String(data.status) : '',
					};
				});
				// Filter to show only active staff members
				setStaff([...mapped.filter(s => s.status === 'Active')]);
			},
			error => {
				console.error('Failed to load staff', error);
				setStaff([]);
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
			issuedTo: '',
			remarks: '',
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

		if (!issueForm.issuedTo) {
			alert('Please select who to issue the item to');
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

			// Find the selected staff member
			const selectedStaff = staff.find(s => s.id === issueForm.issuedTo);
			if (!selectedStaff) {
				alert('Selected staff member not found');
				setSubmitting(false);
				return;
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
				issuedTo: selectedStaff.id,
				issuedToName: selectedStaff.userName,
				issuedToEmail: selectedStaff.userEmail || null,
				status: 'acknowledged',
				returnedQuantity: 0,
				remarks: issueForm.remarks.trim() || null,
				createdAt: serverTimestamp(),
				updatedAt: serverTimestamp(),
			});

			setIssueForm({ itemId: '', quantity: 0, issuedTo: '', remarks: '' });
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


	const handleEditRemarks = (record: IssueRecord) => {
		setEditingRemarksId(record.id);
		setEditingRemarksValue(record.remarks || '');
	};

	const handleSaveRemarks = async (recordId: string) => {
		if (!user) {
			alert('User not authenticated');
			return;
		}

		setSubmitting(true);
		try {
			await updateDoc(doc(db, 'inventoryIssues', recordId), {
				remarks: editingRemarksValue.trim() || null,
				updatedAt: serverTimestamp(),
			});
			setEditingRemarksId(null);
			setEditingRemarksValue('');
		} catch (error) {
			console.error('Failed to update remarks:', error);
			alert('Failed to update remarks. Please try again.');
		} finally {
			setSubmitting(false);
		}
	};

	const handleCancelEditRemarks = () => {
		setEditingRemarksId(null);
		setEditingRemarksValue('');
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

	// Filter items based on search term, category, and type
	const filteredItems = useMemo(() => {
		let filtered = items;

		// Apply category filter
		if (categoryFilter !== 'all') {
			filtered = filtered.filter(item => item.category === categoryFilter);
		}

		// Apply type filter
		if (typeFilter !== 'all') {
			filtered = filtered.filter(item => item.type === typeFilter);
		}

		// Apply search term filter
		if (searchTerm.trim()) {
			const term = searchTerm.toLowerCase().trim();
			filtered = filtered.filter(item => 
				item.name.toLowerCase().includes(term) ||
				item.category.toLowerCase().includes(term) ||
				item.type.toLowerCase().includes(term)
			);
		}

		return filtered;
	}, [items, searchTerm, categoryFilter, typeFilter]);

	// Filter out-of-stock consumable items for local alerts
	const outOfStockConsumables = useMemo(() => {
		return items.filter(item => 
			item.category === 'consumable' && 
			item.remainingQuantity === 0
		);
	}, [items]);

	// Import functions
	const parseFile = async (file: File): Promise<any[]> => {
		return new Promise((resolve, reject) => {
			const fileName = file.name.toLowerCase();
			const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
			
			if (isExcel) {
				// Parse Excel file
				const reader = new FileReader();
				reader.onload = (e) => {
					try {
						const data = e.target?.result;
						const workbook = XLSX.read(data, { type: 'binary' });
						const firstSheetName = workbook.SheetNames[0];
						const worksheet = workbook.Sheets[firstSheetName];
						const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
						
						if (jsonData.length < 2) {
							reject(new Error('Excel file must have at least a header row and one data row'));
							return;
						}
						
						// First row is headers
						const headers = ((jsonData[0] as unknown) as any[]).map((h: any) => String(h || '').toLowerCase().trim());
						const rows = jsonData.slice(1).map((row: unknown) => {
							const rowArray = (row as unknown) as any[];
							const obj: any = {};
							headers.forEach((header, idx) => {
								obj[header] = rowArray[idx] !== undefined && rowArray[idx] !== null ? String(rowArray[idx]).trim() : '';
							});
							return obj;
						});
						
						resolve(rows.filter(row => Object.values(row).some(v => v !== '')));
					} catch (error) {
						reject(error);
					}
				};
				reader.onerror = () => reject(new Error('Failed to read Excel file'));
				reader.readAsBinaryString(file);
			} else {
				// Parse CSV file
				Papa.parse(file, {
					header: true,
					skipEmptyLines: true,
					complete: (results: { data?: unknown[] } | any) => {
						const data = (results as { data?: unknown[] }).data || [];
						resolve((data as any[]).map((row: any) => {
							// Normalize keys to lowercase
							const normalized: any = {};
							Object.keys(row).forEach(key => {
								normalized[key.toLowerCase().trim()] = row[key];
							});
							return normalized;
						}));
					},
					error: (error: Error | any) => reject(error instanceof Error ? error : new Error(String(error))),
				});
			}
		});
	};

	const normalizeCategory = (category: string): 'consumable' | 'non-consumable' => {
		const normalized = category.toLowerCase().trim();
		if (normalized.includes('consumable') && !normalized.includes('non')) {
			return 'consumable';
		}
		return 'non-consumable';
	};

	const normalizeType = (type: string): ItemType => {
		const normalized = type.toLowerCase().trim();
		if (normalized.includes('strength') || normalized.includes('conditioning')) {
			return 'Strength and Conditioning';
		}
		if (normalized.includes('psychological') || normalized.includes('psychology')) {
			return 'Psychological';
		}
		if (normalized.includes('biomechanics') || normalized.includes('biomechanic')) {
			return 'Biomechanics';
		}
		return 'Physiotherapy';
	};

	const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;

		setImportFile(file);
		setImporting(true);
		try {
			const parsed = await parseFile(file);
			
			// Map parsed data to inventory items
			const mapped = parsed.map((row: any, idx: number) => {
				// Try to find columns by common names (case-insensitive)
				const itemName = row['item name'] || row['itemname'] || row['name'] || row['item'] || '';
				const category = row['category'] || row['cat'] || '';
				const type = row['type'] || '';
				const totalQuantity = parseInt(row['total quantity'] || row['totalquantity'] || row['total'] || row['quantity'] || '0') || 0;
				const issued = parseInt(row['issued'] || row['issued quantity'] || '0') || 0;
				const returned = parseInt(row['returned'] || row['returned quantity'] || '0') || 0;
				const remaining = parseInt(row['remaining'] || row['remaining quantity'] || '0') || 0;

				return {
					rowIndex: idx + 2, // +2 because 1-indexed and header row
					itemName: String(itemName).trim(),
					category: normalizeCategory(category),
					type: normalizeType(type),
					totalQuantity,
					issuedQuantity: issued,
					returnedQuantity: returned,
					remainingQuantity: remaining,
					errors: [] as string[],
				};
			}).filter(item => item.itemName); // Filter out empty rows

			// Validate mapped data
			const validated = mapped.map(item => {
				const errors: string[] = [];
				if (!item.itemName) {
					errors.push('Item name is required');
				}
				if (item.totalQuantity < 0) {
					errors.push('Total quantity cannot be negative');
				}
				if (item.issuedQuantity < 0) {
					errors.push('Issued quantity cannot be negative');
				}
				if (item.returnedQuantity < 0) {
					errors.push('Returned quantity cannot be negative');
				}
				if (item.returnedQuantity > item.issuedQuantity) {
					errors.push('Returned quantity cannot exceed issued quantity');
				}
				if (item.totalQuantity < item.issuedQuantity) {
					errors.push('Total quantity cannot be less than issued quantity');
				}
				return { ...item, errors };
			});

			setImportPreview(validated);
		} catch (error: any) {
			alert(`Failed to parse file: ${error.message || 'Unknown error'}`);
			setImportFile(null);
			setImportPreview([]);
		} finally {
			setImporting(false);
		}
	};

	const handleImportConfirm = async () => {
		if (!user || importPreview.length === 0) {
			alert('No data to import');
			return;
		}

		// Filter out rows with errors
		const validRows = importPreview.filter(row => row.errors.length === 0);
		if (validRows.length === 0) {
			alert('No valid rows to import. Please fix errors in the preview.');
			return;
		}

		setImporting(true);
		try {
			const batch = writeBatch(db);
			let count = 0;

			for (const row of validRows) {
				const itemRef = doc(collection(db, 'inventoryItems'));
				batch.set(itemRef, {
					name: row.itemName,
					category: row.category,
					type: row.type,
					totalQuantity: row.totalQuantity,
					issuedQuantity: row.issuedQuantity || 0,
					returnedQuantity: row.returnedQuantity || 0,
					createdBy: user.uid,
					createdByName: user.displayName || user.email?.split('@')[0] || 'User',
					createdAt: serverTimestamp(),
					updatedAt: serverTimestamp(),
				});
				count++;

				// Firestore batch limit is 500, commit in chunks
				if (count % 500 === 0) {
					await batch.commit();
				}
			}

			// Commit remaining
			if (count % 500 !== 0) {
				await batch.commit();
			}

			setNotification({ 
				message: `Successfully imported ${count} items!`, 
				type: 'success' 
			});
			setTimeout(() => setNotification(null), 5000);
			
			setShowImportModal(false);
			setImportFile(null);
			setImportPreview([]);
		} catch (error: any) {
			console.error('Import failed:', error);
			alert(`Failed to import items: ${error.message || 'Unknown error'}`);
		} finally {
			setImporting(false);
		}
	};


	return (
		<div className="min-h-svh bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 px-6 py-10">
			<div className="mx-auto max-w-7xl space-y-6 relative">
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

				<div className="flex items-center justify-between relative">
					<PageHeader title="Inventory Management" />
					{canManageInventory && (
						<div className="flex flex-col items-end gap-3">
							{/* Out-of-Stock Alerts - Above buttons */}
							{outOfStockConsumables.length > 0 && (
								<div className="z-40 max-w-sm">
									<div className="rounded-lg bg-red-50 border-2 border-red-300 shadow-lg p-4">
										<div className="flex items-center gap-2 mb-3">
											<i className="fas fa-exclamation-triangle text-red-600 text-lg flex-shrink-0" aria-hidden="true" />
											<h3 className="font-bold text-sm text-red-800">
												Out of Stock ({outOfStockConsumables.length})
											</h3>
										</div>
										<div className="space-y-2 max-h-64 overflow-y-auto">
											{outOfStockConsumables.map(item => (
												<div
													key={item.id}
													className="flex items-center gap-2 rounded-md bg-white border border-red-200 px-3 py-2"
												>
													<i className="fas fa-circle text-red-500 text-xs" aria-hidden="true" />
													<p className="text-sm text-red-800 font-medium">
														{item.name}
													</p>
												</div>
											))}
										</div>
									</div>
								</div>
							)}
							<div className="flex items-center gap-3">
								<button
									type="button"
									onClick={() => setShowImportModal(true)}
									className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-green-600 via-green-700 to-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:from-green-700 hover:via-green-800 hover:to-emerald-700 transition-all duration-200 hover:scale-105"
								>
									<i className="fas fa-file-import text-xs" aria-hidden="true" />
									Import Excel/CSV
								</button>
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
							</div>
						</div>
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
									setIssueForm({ itemId: '', quantity: 0, issuedTo: '', remarks: '' });
									setShowIssueModal(true);
								}}
								className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 via-indigo-700 to-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:from-indigo-700 hover:via-indigo-800 hover:to-purple-700 transition-all duration-200 hover:scale-105"
							>
								<i className="fas fa-hand-holding text-xs" aria-hidden="true" />
								Issue Items
							</button>
						)}
					</div>

					{/* Filters and Search Bar */}
					<div className="mb-4 space-y-3">
						{/* Filter Options */}
						<div className="flex flex-wrap items-center gap-4">
							{/* Category Filter */}
							<div className="flex items-center gap-2">
								<label htmlFor="categoryFilter" className="text-sm font-medium text-slate-700 whitespace-nowrap">
									Category:
								</label>
								<select
									id="categoryFilter"
									value={categoryFilter}
									onChange={e => setCategoryFilter(e.target.value as 'all' | 'consumable' | 'non-consumable')}
									className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
								>
									<option value="all">All Categories</option>
									<option value="consumable">Consumables</option>
									<option value="non-consumable">Non-Consumables</option>
								</select>
							</div>

							{/* Type Filter */}
							<div className="flex items-center gap-2">
								<label htmlFor="typeFilter" className="text-sm font-medium text-slate-700 whitespace-nowrap">
									Type:
								</label>
								<select
									id="typeFilter"
									value={typeFilter}
									onChange={e => setTypeFilter(e.target.value as 'all' | ItemType)}
									className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
								>
									<option value="all">All Types</option>
									<option value="Physiotherapy">Physiotherapy</option>
									<option value="Strength and Conditioning">Strength and Conditioning</option>
									<option value="Psychological">Psychological</option>
									<option value="Biomechanics">Biomechanics</option>
								</select>
							</div>

							{/* Clear Filters Button */}
							{(categoryFilter !== 'all' || typeFilter !== 'all' || searchTerm) && (
								<button
									type="button"
									onClick={() => {
										setCategoryFilter('all');
										setTypeFilter('all');
										setSearchTerm('');
									}}
									className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 transition-colors"
								>
									<i className="fas fa-times text-xs" aria-hidden="true" />
									Clear Filters
								</button>
							)}
						</div>

						{/* Search Bar */}
						<div className="relative">
							<i className="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" aria-hidden="true" />
							<input
								type="text"
								placeholder="Search items by name, category, or type..."
								value={searchTerm}
								onChange={e => setSearchTerm(e.target.value)}
								className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
							/>
							{searchTerm && (
								<button
									type="button"
									onClick={() => setSearchTerm('')}
									className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-600"
									aria-label="Clear search"
								>
									<i className="fas fa-times" aria-hidden="true" />
								</button>
							)}
						</div>
					</div>

					{loading ? (
						<div className="text-center py-8 text-slate-500">Loading inventory...</div>
					) : items.length === 0 ? (
						<div className="text-center py-8 text-slate-500">No inventory items found</div>
					) : filteredItems.length === 0 ? (
						<div className="text-center py-8 text-slate-500">No items match your search</div>
					) : (
						<div className="overflow-x-auto max-h-[600px] overflow-y-auto border border-slate-200 rounded-lg">
							<table className="min-w-full divide-y divide-slate-200">
								<thead className="bg-slate-50 sticky top-0 z-10">
									<tr>
										<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Serial No</th>
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
									{filteredItems.map((item, index) => (
										<tr key={item.id} className="hover:bg-slate-50">
											<td className="px-4 py-3 text-sm text-slate-600">{index + 1}</td>
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
						<div className="overflow-x-auto max-h-[600px] overflow-y-auto border border-slate-200 rounded-lg">
							<table className="min-w-full divide-y divide-slate-200">
								<thead className="bg-slate-50 sticky top-0 z-10">
									<tr>
										<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Serial No</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Item</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Type</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Quantity</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Issued By</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Issued To</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Status</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Returned</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Remarks</th>
										{isAdminOrSuperAdmin && (
											<th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Actions</th>
										)}
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100 bg-white">
									{issueRecords.map((record, index) => {
										const remainingToReturn = record.quantity - (record.returnedQuantity || 0);
										const isConsumable = record.itemCategory === 'consumable';
										const canReturn = isAdminOrSuperAdmin && remainingToReturn > 0 && !isConsumable;
										
										return (
											<tr key={record.id} className="hover:bg-slate-50">
												<td className="px-4 py-3 text-sm text-slate-600">{index + 1}</td>
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
												<td className="px-4 py-3 text-sm text-slate-600">
													{editingRemarksId === record.id ? (
														<div className="flex items-start gap-2">
															<textarea
																value={editingRemarksValue}
																onChange={e => setEditingRemarksValue(e.target.value)}
																rows={2}
																className="flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-200 resize-none"
																placeholder="Enter remarks..."
																autoFocus
															/>
															<div className="flex flex-col gap-1">
																<button
																	type="button"
																	onClick={() => handleSaveRemarks(record.id)}
																	disabled={submitting}
																	className="inline-flex items-center justify-center rounded bg-green-600 px-2 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
																	title="Save remarks"
																>
																	<i className="fas fa-check text-xs" aria-hidden="true" />
																</button>
																<button
																	type="button"
																	onClick={handleCancelEditRemarks}
																	disabled={submitting}
																	className="inline-flex items-center justify-center rounded bg-slate-400 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-500 disabled:opacity-50 disabled:cursor-not-allowed"
																	title="Cancel"
																>
																	<i className="fas fa-times text-xs" aria-hidden="true" />
																</button>
															</div>
														</div>
													) : (
														<div className="flex items-start gap-2 group">
															<span className="flex-1 text-slate-600 min-w-0 break-words">
																{record.remarks || (
																	<span className="text-slate-400 italic">No remarks</span>
																)}
															</span>
															{canManageInventory && (
																<button
																	type="button"
																	onClick={() => handleEditRemarks(record)}
																	className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center justify-center rounded bg-blue-600 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-700"
																	title="Edit remarks"
																>
																	<i className="fas fa-edit text-xs" aria-hidden="true" />
																</button>
															)}
														</div>
													)}
												</td>
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
											<option value="Biomechanics">Biomechanics</option>
										</>
									) : newItem.category === 'consumable' ? (
										<>
											<option value="Physiotherapy">Physiotherapy</option>
											<option value="Strength and Conditioning">Strength and Conditioning</option>
											<option value="Psychological">Psychological</option>
											<option value="Biomechanics">Biomechanics</option>
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
							<div>
								<label htmlFor="issueTo" className="block text-sm font-medium text-slate-700 mb-2">
									Issue To <span className="text-red-500">*</span>
								</label>
								<select
									id="issueTo"
									value={issueForm.issuedTo}
									onChange={e => setIssueForm({ ...issueForm, issuedTo: e.target.value })}
									className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
									required
								>
									<option value="">Select a person...</option>
									{staff.map(member => (
										<option key={member.id} value={member.id}>
											{member.userName} ({member.role})
										</option>
									))}
								</select>
							</div>
							<div>
								<label htmlFor="issueRemarks" className="block text-sm font-medium text-slate-700 mb-2">
									Remarks
								</label>
								<textarea
									id="issueRemarks"
									value={issueForm.remarks}
									onChange={e => setIssueForm({ ...issueForm, remarks: e.target.value })}
									rows={3}
									placeholder="Enter any remarks or notes about this issue..."
									className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none"
								/>
							</div>
							<div className="flex items-center gap-3 justify-end pt-4">
								<button
									type="button"
								onClick={() => {
									setShowIssueModal(false);
									setIssueForm({ itemId: '', quantity: 0, issuedTo: '', remarks: '' });
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

			{/* Import Excel/CSV Modal */}
			{showImportModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
					<div className="bg-white rounded-2xl p-6 max-w-4xl w-full mx-4 shadow-2xl max-h-[90vh] overflow-hidden flex flex-col">
						<div className="flex items-center justify-between mb-4">
							<h3 className="text-lg font-semibold text-slate-900">Import Inventory Items</h3>
							<button
								type="button"
								onClick={() => {
									setShowImportModal(false);
									setImportFile(null);
									setImportPreview([]);
								}}
								className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
								aria-label="Close modal"
							>
								<i className="fas fa-times" aria-hidden="true" />
							</button>
						</div>

						<div className="flex-1 overflow-y-auto space-y-4">
							<div>
								<label htmlFor="importFile" className="block text-sm font-medium text-slate-700 mb-2">
									Select Excel or CSV File <span className="text-red-500">*</span>
								</label>
								<input
									id="importFile"
									type="file"
									accept=".xlsx,.xls,.csv"
									onChange={handleFileSelect}
									disabled={importing}
									className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-50"
								/>
								<p className="mt-2 text-xs text-slate-500">
									Expected columns: Item Name, Category (Non-Consumable/Consumable), Type, Total Quantity, Issued, Returned, Remaining
								</p>
							</div>

							{importPreview.length > 0 && (
								<div>
									<h4 className="text-sm font-semibold text-slate-900 mb-2">
										Preview ({importPreview.length} items)
									</h4>
									<div className="overflow-x-auto border border-slate-200 rounded-lg">
										<table className="min-w-full divide-y divide-slate-200 text-xs">
											<thead className="bg-slate-50">
												<tr>
													<th className="px-3 py-2 text-left font-semibold text-slate-700">Row</th>
													<th className="px-3 py-2 text-left font-semibold text-slate-700">Item Name</th>
													<th className="px-3 py-2 text-left font-semibold text-slate-700">Category</th>
													<th className="px-3 py-2 text-left font-semibold text-slate-700">Type</th>
													<th className="px-3 py-2 text-left font-semibold text-slate-700">Total Qty</th>
													<th className="px-3 py-2 text-left font-semibold text-slate-700">Issued</th>
													<th className="px-3 py-2 text-left font-semibold text-slate-700">Returned</th>
													<th className="px-3 py-2 text-left font-semibold text-slate-700">Status</th>
												</tr>
											</thead>
											<tbody className="divide-y divide-slate-100 bg-white">
												{importPreview.map((row, idx) => (
													<tr key={idx} className={row.errors.length > 0 ? 'bg-red-50' : ''}>
														<td className="px-3 py-2 text-slate-600">{row.rowIndex}</td>
														<td className="px-3 py-2 font-medium text-slate-900">{row.itemName || '—'}</td>
														<td className="px-3 py-2 text-slate-600">{row.category}</td>
														<td className="px-3 py-2 text-slate-600">{row.type}</td>
														<td className="px-3 py-2 text-slate-600">{row.totalQuantity}</td>
														<td className="px-3 py-2 text-slate-600">{row.issuedQuantity}</td>
														<td className="px-3 py-2 text-slate-600">{row.returnedQuantity}</td>
														<td className="px-3 py-2">
															{row.errors.length > 0 ? (
																<span className="text-red-600 text-xs" title={row.errors.join(', ')}>
																	<i className="fas fa-exclamation-circle mr-1" aria-hidden="true" />
																	Error
																</span>
															) : (
																<span className="text-green-600 text-xs">
																	<i className="fas fa-check-circle mr-1" aria-hidden="true" />
																	Valid
																</span>
															)}
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
									{importPreview.some(row => row.errors.length > 0) && (
										<div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg">
											<p className="text-xs text-red-700 font-semibold mb-1">
												<i className="fas fa-exclamation-triangle mr-1" aria-hidden="true" />
												Some rows have errors and will be skipped
											</p>
										</div>
									)}
								</div>
							)}
						</div>

						<div className="flex items-center gap-3 justify-end pt-4 border-t border-slate-200 mt-4">
							<button
								type="button"
								onClick={() => {
									setShowImportModal(false);
									setImportFile(null);
									setImportPreview([]);
								}}
								className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900"
								disabled={importing}
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleImportConfirm}
								disabled={importing || importPreview.length === 0 || importPreview.every(row => row.errors.length > 0)}
								className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-green-600 via-green-700 to-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:from-green-700 hover:via-green-800 hover:to-emerald-700 transition-all duration-200 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
							>
								{importing ? (
									<>
										<div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
										Importing...
									</>
								) : (
									<>
										<i className="fas fa-file-import text-xs" aria-hidden="true" />
										Import {importPreview.filter(row => row.errors.length === 0).length} Items
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
