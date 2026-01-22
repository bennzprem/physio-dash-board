'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, doc, query, orderBy, serverTimestamp, type QuerySnapshot, type Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/PageHeader';
import { notifyFrontdesk } from '@/lib/notificationUtils';
import * as XLSX from 'xlsx';

interface Intern {
	id?: string;
	serialNumber: number;
	name: string;
	college: string;
	degree: "Bachelor's Degree (BPT)" | "Master's Degree (MPT)" | "Clinical";
	dateOfJoining: string;
	dateOfLeaving: string;
	amount: number;
	isPaid: boolean;
	paymentDate?: string;
	receiptNumber?: string;
	paymentMode?: 'Cash' | 'Card/UPI';
	utrNumber?: string;
	createdAt: any;
	updatedAt: any;
}

type DegreeType = "Bachelor's Degree (BPT)" | "Master's Degree (MPT)" | "Clinical";

const DEGREE_AMOUNTS: Record<DegreeType, number> = {
	"Bachelor's Degree (BPT)": 2500,
	"Master's Degree (MPT)": 5000,
	"Clinical": 2500,
};

export default function InternshipManagement() {
	const { user } = useAuth();
	const [interns, setInterns] = useState<Intern[]>([]);
	const [loading, setLoading] = useState(true);
	const [showAddModal, setShowAddModal] = useState(false);
	const [showEditModal, setShowEditModal] = useState(false);
	const [editingIntern, setEditingIntern] = useState<Intern | null>(null);
	const [processingPayment, setProcessingPayment] = useState<string | null>(null);
	const [searchTerm, setSearchTerm] = useState('');
	
	// Form state
	const [formData, setFormData] = useState({
		name: '',
		college: '',
		degree: "Bachelor's Degree (BPT)" as DegreeType,
		dateOfJoining: '',
		dateOfLeaving: '',
		amount: DEGREE_AMOUNTS["Bachelor's Degree (BPT)"],
		receiptNumber: '',
		paymentMode: 'Cash' as 'Cash' | 'Card/UPI',
		utrNumber: '',
	});
	const [submitting, setSubmitting] = useState(false);

	// Load interns from Firestore
	useEffect(() => {
		const unsubscribe = onSnapshot(
			query(collection(db, 'interns'), orderBy('createdAt', 'asc')),
			(snapshot: QuerySnapshot) => {
				const loadedInterns = snapshot.docs.map(docSnap => {
					const data = docSnap.data();
					// Ensure isPaid is a proper boolean (handle existing data that might be string "true"/"false" or other formats)
					const isPaid = data.isPaid === true || data.isPaid === 'true' || data.isPaid === 1;
					// Ensure amount is a number (handle existing data that might be string or other formats)
					const amount = typeof data.amount === 'number' ? data.amount : (typeof data.amount === 'string' ? parseFloat(data.amount) || 0 : 0);
					return {
						id: docSnap.id,
						serialNumber: data.serialNumber || 0,
						name: data.name || '',
						college: data.college || '',
						degree: data.degree || "Bachelor's Degree (BPT)",
						dateOfJoining: data.dateOfJoining || '',
						dateOfLeaving: data.dateOfLeaving || '',
						amount: amount,
						isPaid: isPaid,
						paymentDate: data.paymentDate || undefined,
						receiptNumber: data.receiptNumber || undefined,
						paymentMode: data.paymentMode || 'Cash',
						utrNumber: data.utrNumber || undefined,
						createdAt: data.createdAt,
						updatedAt: data.updatedAt,
					} as Intern;
				});
				setInterns(loadedInterns);
				setLoading(false);
			},
			error => {
				console.error('Failed to load interns:', error);
				setLoading(false);
			}
		);

		return () => unsubscribe();
	}, []);

	// Check for expired internships and send notifications
	useEffect(() => {
		const today = new Date();
		today.setHours(0, 0, 0, 0);

		const expiredInterns = interns.filter(intern => {
			if (!intern.dateOfLeaving || intern.isPaid) return false;
			const leavingDate = new Date(intern.dateOfLeaving);
			leavingDate.setHours(0, 0, 0, 0);
			return leavingDate < today;
		});

		if (expiredInterns.length > 0 && user?.uid) {
			// Send notification for expired internships
			const internNames = expiredInterns.map(i => i.name).join(', ');
			notifyFrontdesk(
				'Internship Expired',
				`The following internship(s) have expired: ${internNames}. Please process payments if needed.`,
				'internship_expired',
				{ expiredCount: expiredInterns.length },
				user.uid
			).catch(err => console.error('Failed to send notification:', err));
		}
	}, [interns, user?.uid]);

	// Note: Auto-calculation is now handled directly in the degree dropdown onChange handler
	// to avoid overwriting existing amounts when editing an intern

	const handleAddIntern = async () => {
		if (!formData.name.trim() || !formData.college.trim() || !formData.dateOfJoining || !formData.dateOfLeaving) {
			alert('Please fill in all required fields.');
			return;
		}

		// Validate UTR number for Card/UPI payment mode
		if (formData.paymentMode === 'Card/UPI' && !formData.utrNumber.trim()) {
			alert('UTR Number is required when Payment Mode is Card/UPI.');
			return;
		}

		// Validate dates
		const joiningDate = new Date(formData.dateOfJoining);
		const leavingDate = new Date(formData.dateOfLeaving);
		if (leavingDate < joiningDate) {
			alert('Date of Leaving must be after Date of Joining.');
			return;
		}

		setSubmitting(true);
		try {
			// Get next serial number
			const nextSerialNumber = interns.length > 0 
				? Math.max(...interns.map(i => i.serialNumber)) + 1 
				: 1;

			// Ensure amount is rounded to integer to avoid floating-point errors
			const amountValue = Math.round(typeof formData.amount === 'number' 
				? formData.amount 
				: (typeof formData.amount === 'string' 
					? parseFloat(formData.amount) || 0 
					: 0));
			
			// Build document data, only including fields with values
			const docData: Record<string, any> = {
				serialNumber: nextSerialNumber,
				name: formData.name.trim(),
				college: formData.college.trim(),
				degree: formData.degree,
				dateOfJoining: formData.dateOfJoining,
				dateOfLeaving: formData.dateOfLeaving,
				amount: amountValue,
				isPaid: false,
				paymentMode: formData.paymentMode,
				createdAt: serverTimestamp(),
				updatedAt: serverTimestamp(),
			};

			// Only include receiptNumber if it has a value
			if (formData.receiptNumber.trim()) {
				docData.receiptNumber = formData.receiptNumber.trim();
			}

			// Only include utrNumber if payment mode is Card/UPI and it has a value
			if (formData.paymentMode === 'Card/UPI' && formData.utrNumber.trim()) {
				docData.utrNumber = formData.utrNumber.trim();
			}

			await addDoc(collection(db, 'interns'), docData);

			// Reset form
			setFormData({
				name: '',
				college: '',
				degree: "Bachelor's Degree (BPT)",
				dateOfJoining: '',
				dateOfLeaving: '',
				amount: DEGREE_AMOUNTS["Bachelor's Degree (BPT)"],
				receiptNumber: '',
				paymentMode: 'Cash',
				utrNumber: '',
			});
			setShowAddModal(false);
			alert('Intern added successfully!');
		} catch (error) {
			console.error('Failed to add intern:', error);
			alert(`Failed to add intern: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setSubmitting(false);
		}
	};

	const handlePay = async (intern: Intern) => {
		if (!intern.id) return;
		
		const receiptNumber = prompt(`Enter receipt number for payment of ₹${intern.amount} for ${intern.name}:`, intern.receiptNumber || '');
		if (receiptNumber === null) return; // User cancelled
		
		if (confirm(`Mark payment of ₹${intern.amount} as paid for ${intern.name}?`)) {
			setProcessingPayment(intern.id);
			try {
				const today = new Date().toISOString().split('T')[0];
				
				// Update intern record
				const updateData: Record<string, any> = {
					isPaid: true,
					paymentDate: today,
					updatedAt: serverTimestamp(),
				};
				if (receiptNumber.trim()) {
					updateData.receiptNumber = receiptNumber.trim();
				}
				await updateDoc(doc(db, 'interns', intern.id), updateData);

				// Create expense transaction record
				const expenseData: Record<string, any> = {
					type: 'internship_payment',
					description: `Internship payment for ${intern.name} (${intern.college})${receiptNumber.trim() ? ` - Receipt: ${receiptNumber.trim()}` : ''}`,
					amount: intern.amount,
					date: today,
					internId: intern.id,
					internName: intern.name,
					createdBy: user?.uid || null,
					createdByName: user?.displayName || user?.email || null,
					createdAt: serverTimestamp(),
				};
				if (receiptNumber.trim()) {
					expenseData.receiptNumber = receiptNumber.trim();
				}
				await addDoc(collection(db, 'expenses'), expenseData);

				alert('Payment recorded successfully!');
			} catch (error) {
				console.error('Failed to process payment:', error);
				alert(`Failed to process payment: ${error instanceof Error ? error.message : 'Unknown error'}`);
			} finally {
				setProcessingPayment(null);
			}
		}
	};

	const handleEdit = (intern: Intern) => {
		setEditingIntern(intern);
		setFormData({
			name: intern.name,
			college: intern.college,
			degree: intern.degree,
			dateOfJoining: intern.dateOfJoining,
			dateOfLeaving: intern.dateOfLeaving,
			amount: intern.amount,
			receiptNumber: intern.receiptNumber || '',
			paymentMode: intern.paymentMode || 'Cash',
			utrNumber: intern.utrNumber || '',
		});
		setShowEditModal(true);
	};

	const handleUpdateIntern = async () => {
		if (!editingIntern?.id) return;
		
		if (!formData.name.trim() || !formData.college.trim() || !formData.dateOfJoining || !formData.dateOfLeaving) {
			alert('Please fill in all required fields.');
			return;
		}

		// Validate UTR number for Card/UPI payment mode
		if (formData.paymentMode === 'Card/UPI' && !formData.utrNumber.trim()) {
			alert('UTR Number is required when Payment Mode is Card/UPI.');
			return;
		}

		// Validate dates
		const joiningDate = new Date(formData.dateOfJoining);
		const leavingDate = new Date(formData.dateOfLeaving);
		if (leavingDate < joiningDate) {
			alert('Date of Leaving must be after Date of Joining.');
			return;
		}

		setSubmitting(true);
		try {
			// Ensure amount is a valid number and round to integer to avoid floating-point errors
			const amountValue = typeof formData.amount === 'number' 
				? Math.round(formData.amount)
				: (typeof formData.amount === 'string' 
					? Math.round(parseFloat(formData.amount) || 0)
					: 0);
			
			// Build update data, only including fields with values
			const updateData: Record<string, any> = {
				name: formData.name.trim(),
				college: formData.college.trim(),
				degree: formData.degree,
				dateOfJoining: formData.dateOfJoining,
				dateOfLeaving: formData.dateOfLeaving,
				amount: amountValue,
				paymentMode: formData.paymentMode,
				updatedAt: serverTimestamp(),
			};

			// Only include receiptNumber if it has a value
			if (formData.receiptNumber.trim()) {
				updateData.receiptNumber = formData.receiptNumber.trim();
			}

			// Only include utrNumber if payment mode is Card/UPI and it has a value
			if (formData.paymentMode === 'Card/UPI' && formData.utrNumber.trim()) {
				updateData.utrNumber = formData.utrNumber.trim();
			}

			await updateDoc(doc(db, 'interns', editingIntern.id), updateData);

			// Reset form and close modal
			setFormData({
				name: '',
				college: '',
				degree: "Bachelor's Degree (BPT)",
				dateOfJoining: '',
				dateOfLeaving: '',
				amount: DEGREE_AMOUNTS["Bachelor's Degree (BPT)"],
				receiptNumber: '',
				paymentMode: 'Cash',
				utrNumber: '',
			});
			setEditingIntern(null);
			setShowEditModal(false);
			alert('Intern updated successfully!');
		} catch (error) {
			console.error('Failed to update intern:', error);
			alert(`Failed to update intern: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setSubmitting(false);
		}
	};

	const isExpired = (dateOfLeaving: string): boolean => {
		if (!dateOfLeaving) return false;
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const leavingDate = new Date(dateOfLeaving);
		leavingDate.setHours(0, 0, 0, 0);
		return leavingDate < today;
	};

	const formatDate = (dateStr: string): string => {
		if (!dateStr) return 'N/A';
		try {
			const date = new Date(dateStr);
			return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
		} catch {
			return dateStr;
		}
	};

	const formatDegree = (degree: string): string => {
		if (!degree) return 'N/A';
		
		// Fix any typos (Degee -> Degree)
		const corrected = degree.replace(/Degee/gi, 'Degree');
		
		// Normalize to standard values
		if (corrected.includes("Bachelor") || corrected.includes("BPT")) {
			return "Bachelor's Degree (BPT)";
		}
		if (corrected.includes("Master") || corrected.includes("MPT")) {
			return "Master's Degree (MPT)";
		}
		if (corrected.includes("Clinical") || corrected.toLowerCase().includes("clinical")) {
			return "Clinical";
		}
		
		return corrected;
	};

	// Helper function to get amount for a degree, with fallback normalization
	const getDegreeAmount = (degree: string | undefined): number => {
		if (!degree) return 0;
		
		// Try direct lookup first
		const directLookup = DEGREE_AMOUNTS[degree as DegreeType];
		if (directLookup !== undefined) return directLookup;
		
		// Normalize and try again
		const normalized = formatDegree(degree);
		const normalizedLookup = DEGREE_AMOUNTS[normalized as DegreeType];
		if (normalizedLookup !== undefined) return normalizedLookup;
		
		// Fallback: check by keywords
		if (degree.includes("Bachelor") || degree.includes("BPT")) {
			return DEGREE_AMOUNTS["Bachelor's Degree (BPT)"];
		}
		if (degree.includes("Master") || degree.includes("MPT")) {
			return DEGREE_AMOUNTS["Master's Degree (MPT)"];
		}
		if (degree.includes("Clinical")) {
			return DEGREE_AMOUNTS["Clinical"];
		}
		
		return 0;
	};

	// Calculate statistics
	const totalInterns = useMemo(() => interns.length, [interns]);
	const totalAmountPaid = useMemo(() => {
		return interns
			.filter(intern => intern.isPaid === true)
			.reduce((sum, intern) => {
				const amount = typeof intern.amount === 'number' ? intern.amount : 0;
				return sum + amount;
			}, 0);
	}, [interns]);

	// Filter interns based on search term
	const filteredInterns = useMemo(() => {
		if (!searchTerm.trim()) {
			return interns;
		}
		const term = searchTerm.toLowerCase().trim();
		return interns.filter(intern => 
			intern.name.toLowerCase().includes(term) ||
			intern.college.toLowerCase().includes(term) ||
			formatDegree(intern.degree).toLowerCase().includes(term) ||
			(intern.utrNumber && intern.utrNumber.toLowerCase().includes(term)) ||
			(intern.receiptNumber && intern.receiptNumber.toLowerCase().includes(term))
		);
	}, [interns, searchTerm]);

	// Export function for Excel/CSV
	const handleExport = (format: 'csv' | 'excel' = 'excel') => {
		if (filteredInterns.length === 0) {
			alert('No interns to export.');
			return;
		}

		const rows = [
			['Serial No', 'Name', 'College/University', 'Degree', 'Date of Joining', 'Date of Leaving', 'Amount (₹)', 'Payment Mode', 'UTR Number', 'Receipt Number', 'Status', 'Payment Date'],
			...filteredInterns.map(intern => [
				intern.serialNumber || '',
				intern.name || '',
				intern.college || '',
				formatDegree(intern.degree) || '',
				formatDate(intern.dateOfJoining) || '',
				formatDate(intern.dateOfLeaving) || '',
				intern.amount || 0,
				intern.paymentMode || 'Cash',
				intern.utrNumber || '',
				intern.receiptNumber || '',
				intern.isPaid ? 'Paid' : 'Pending',
				intern.paymentDate ? formatDate(intern.paymentDate) : '',
			]),
		];

		if (format === 'csv') {
			const csv = rows
				.map(line => line.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
				.join('\n');

			const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
			const url = URL.createObjectURL(blob);

			const link = document.createElement('a');
			link.href = url;
			link.setAttribute('download', `interns-export-${new Date().toISOString().slice(0, 10)}.csv`);
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
		} else {
			// Excel export
			const ws = XLSX.utils.aoa_to_sheet(rows);
			const wb = XLSX.utils.book_new();
			XLSX.utils.book_append_sheet(wb, ws, 'Interns');

			// Set column widths
			ws['!cols'] = [
				{ wch: 10 }, // Serial No
				{ wch: 25 }, // Name
				{ wch: 30 }, // College/University
				{ wch: 25 }, // Degree
				{ wch: 15 }, // Date of Joining
				{ wch: 15 }, // Date of Leaving
				{ wch: 12 }, // Amount
				{ wch: 12 }, // Payment Mode
				{ wch: 20 }, // UTR Number
				{ wch: 15 }, // Receipt Number
				{ wch: 10 }, // Status
				{ wch: 15 }, // Payment Date
			];

			XLSX.writeFile(wb, `interns-export-${new Date().toISOString().slice(0, 10)}.xlsx`);
		}
	};

	if (loading) {
		return (
			<div className="min-h-screen p-8">
				<div className="text-center text-slate-600">Loading interns...</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen p-8">
			<PageHeader title="Internship Management" />
			
			{/* Summary Cards */}
			<div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
				<div className="bg-white rounded-lg shadow-md p-6 border-l-4 border-blue-500">
					<div className="flex items-center justify-between">
						<div>
							<p className="text-sm font-medium text-slate-600 uppercase tracking-wide">Total Interns</p>
							<p className="mt-2 text-3xl font-bold text-slate-900">{totalInterns}</p>
						</div>
						<div className="bg-blue-100 rounded-full p-4">
							<i className="fas fa-users text-2xl text-blue-600"></i>
						</div>
					</div>
				</div>

				<div className="bg-white rounded-lg shadow-md p-6 border-l-4 border-green-500">
					<div className="flex items-center justify-between">
						<div>
							<p className="text-sm font-medium text-slate-600 uppercase tracking-wide">Total Amount Paid</p>
							<p className="mt-2 text-3xl font-bold text-slate-900">₹{totalAmountPaid.toLocaleString('en-IN')}</p>
						</div>
						<div className="bg-green-100 rounded-full p-4">
							<i className="fas fa-rupee-sign text-2xl text-green-600"></i>
						</div>
					</div>
				</div>
			</div>
			
			<div className="mt-6">
				<div className="mb-4 flex justify-between items-center">
					<h2 className="text-xl font-semibold text-slate-800">Interns List</h2>
					<div className="flex items-center gap-3">
						<button
							onClick={() => handleExport('excel')}
							className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2"
							title="Export to Excel"
						>
							<i className="fas fa-file-excel"></i>
							Export Excel/CSV
						</button>
						<button
							onClick={() => setShowAddModal(true)}
							className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
						>
							<i className="fas fa-plus"></i>
							Add New Intern
						</button>
					</div>
				</div>

				{/* Search Bar */}
				<div className="mb-4">
					<div className="relative">
						<i className="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" aria-hidden="true" />
						<input
							type="text"
							placeholder="Search interns by name, college, degree, UTR number, or receipt number..."
							value={searchTerm}
							onChange={(e) => setSearchTerm(e.target.value)}
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

				{interns.length === 0 ? (
					<div className="bg-white rounded-lg shadow p-8 text-center text-slate-500">
						<p>No interns registered yet. Click "Add New Intern" to get started.</p>
					</div>
				) : filteredInterns.length === 0 ? (
					<div className="bg-white rounded-lg shadow p-8 text-center text-slate-500">
						<p>No interns match your search. Try a different search term.</p>
					</div>
				) : (
					<div className="bg-white rounded-lg shadow overflow-hidden">
						<div className="max-h-[calc(100vh-400px)] overflow-y-auto overflow-x-hidden">
							<table className="w-full divide-y divide-slate-200" style={{ tableLayout: 'fixed' }}>
								<thead className="bg-slate-50 sticky top-0 z-10">
									<tr>
										<th className="px-2 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider" style={{ width: '5%' }}>Sl. No</th>
										<th className="px-2 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider" style={{ width: '12%' }}>Name</th>
										<th className="px-2 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider" style={{ width: '15%' }}>College/University</th>
										<th className="px-2 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider" style={{ width: '12%' }}>Degree</th>
										<th className="px-2 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider" style={{ width: '10%' }}>Date of Joining</th>
										<th className="px-2 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider" style={{ width: '10%' }}>Date of Leaving</th>
										<th className="px-2 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider" style={{ width: '8%' }}>Amount (₹)</th>
										<th className="px-2 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider" style={{ width: '8%' }}>Payment Mode</th>
										<th className="px-2 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider" style={{ width: '8%' }}>UTR Number</th>
										<th className="px-2 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider" style={{ width: '8%' }}>Receipt No.</th>
										<th className="px-2 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider" style={{ width: '6%' }}>Status</th>
										<th className="px-2 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider" style={{ width: '8%' }}>Actions</th>
									</tr>
								</thead>
								<tbody className="bg-white divide-y divide-slate-200">
									{filteredInterns.map(intern => {
										const expired = !intern.isPaid && isExpired(intern.dateOfLeaving);
										return (
											<tr
												key={intern.id}
												className={expired ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-slate-50'}
											>
												<td className="px-2 py-3 text-sm text-slate-900">{intern.serialNumber}</td>
												<td className="px-2 py-3 text-sm font-medium text-slate-900 truncate" title={intern.name}>{intern.name}</td>
												<td className="px-2 py-3 text-sm text-slate-700 truncate" title={intern.college}>{intern.college}</td>
												<td className="px-2 py-3 text-sm text-slate-700 truncate" title={formatDegree(intern.degree)}>{formatDegree(intern.degree)}</td>
												<td className="px-2 py-3 text-sm text-slate-700 whitespace-nowrap">{formatDate(intern.dateOfJoining)}</td>
												<td className={`px-2 py-3 text-sm ${expired ? 'font-semibold text-red-600' : 'text-slate-700'} whitespace-nowrap`}>
													{formatDate(intern.dateOfLeaving)}
													{expired && <span className="ml-1 text-xs text-red-600">(Exp)</span>}
												</td>
												<td className="px-2 py-3 text-sm text-slate-900 font-medium whitespace-nowrap">₹{intern.amount.toLocaleString('en-IN')}</td>
												<td className="px-2 py-3 text-sm text-slate-700 whitespace-nowrap">
													{intern.paymentMode || 'Cash'}
												</td>
												<td className="px-2 py-3 text-sm text-slate-700 truncate" title={intern.utrNumber || ''}>
													{intern.utrNumber || '—'}
												</td>
												<td className="px-2 py-3 text-sm text-slate-700 truncate" title={intern.receiptNumber || ''}>
													{intern.receiptNumber || '—'}
												</td>
												<td className="px-2 py-3">
													{intern.isPaid ? (
														<span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800 whitespace-nowrap">
															Paid
														</span>
													) : (
														<span className="px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800 whitespace-nowrap">
															Pending
														</span>
													)}
												</td>
												<td className="px-2 py-3 text-sm">
													<div className="flex items-center gap-1">
														<button
															onClick={() => handleEdit(intern)}
															className="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-xs"
															title="Edit intern details"
														>
															<i className="fas fa-edit"></i>
														</button>
														{!intern.isPaid ? (
															<button
																onClick={() => handlePay(intern)}
																disabled={processingPayment === intern.id}
																className="px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors text-xs whitespace-nowrap"
															>
																{processingPayment === intern.id ? '...' : 'Pay'}
															</button>
														) : (
															<span className="text-xs text-slate-500 truncate" title={`Paid on ${formatDate(intern.paymentDate || '')}`}>
																Paid
															</span>
														)}
													</div>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					</div>
				)}
			</div>

			{/* Add Intern Modal */}
			{showAddModal && (
				<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
					<div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
						<div className="p-6 border-b border-slate-200">
							<h3 className="text-xl font-semibold text-slate-800">Add New Intern</h3>
						</div>
						<div className="p-6 space-y-4">
							<div>
								<label className="block text-sm font-medium text-slate-700 mb-1">
									Name <span className="text-red-500">*</span>
								</label>
								<input
									type="text"
									value={formData.name}
									onChange={(e) => setFormData({ ...formData, name: e.target.value })}
									className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 bg-white"
									placeholder="Enter intern name"
								/>
							</div>

							<div>
								<label className="block text-sm font-medium text-slate-700 mb-1">
									College/University <span className="text-red-500">*</span>
								</label>
								<input
									type="text"
									value={formData.college}
									onChange={(e) => setFormData({ ...formData, college: e.target.value })}
									className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 bg-white"
									placeholder="Enter college or university name"
								/>
							</div>

							<div>
								<label className="block text-sm font-medium text-slate-700 mb-1">
									Degree <span className="text-red-500">*</span>
								</label>
								<select
									value={formData.degree}
									onChange={(e) => {
										const newDegree = e.target.value as DegreeType;
										// Auto-calculate amount only when user manually changes degree
										setFormData({ 
											...formData, 
											degree: newDegree,
											amount: DEGREE_AMOUNTS[newDegree] || 0
										});
									}}
									className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 bg-white"
								>
									<option value="Bachelor's Degree (BPT)">Bachelor's Degree (BPT)</option>
									<option value="Master's Degree (MPT)">Master's Degree (MPT)</option>
									<option value="Clinical">Clinical</option>
								</select>
							</div>

							<div>
								<label className="block text-sm font-medium text-slate-700 mb-1">
									Date of Joining <span className="text-red-500">*</span>
								</label>
								<input
									type="date"
									value={formData.dateOfJoining}
									onChange={(e) => setFormData({ ...formData, dateOfJoining: e.target.value })}
									className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 bg-white"
								/>
							</div>

							<div>
								<label className="block text-sm font-medium text-slate-700 mb-1">
									Date of Leaving <span className="text-red-500">*</span>
								</label>
								<input
									type="date"
									value={formData.dateOfLeaving}
									onChange={(e) => setFormData({ ...formData, dateOfLeaving: e.target.value })}
									className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 bg-white"
								/>
							</div>

							<div>
								<label className="block text-sm font-medium text-slate-700 mb-1">
									Amount (₹) <span className="text-red-500">*</span>
								</label>
								<input
									type="number"
									value={formData.amount ?? 0}
									onChange={(e) => {
										const inputValue = e.target.value;
										// Handle empty input
										if (inputValue === '' || inputValue === '-') {
											setFormData({ ...formData, amount: 0 });
											return;
										}
										// Parse and round to nearest integer to avoid floating-point errors
										const parsed = parseFloat(inputValue);
										const rounded = isNaN(parsed) ? 0 : Math.round(parsed);
										setFormData({ ...formData, amount: rounded });
									}}
									className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 bg-white"
									min="0"
									step="1"
								/>
								<p className="mt-1 text-xs text-slate-500">
									{(() => {
										const amount = getDegreeAmount(formData.degree);
										let degreeDisplay = "Bachelor's Degree";
										if (formData.degree && (formData.degree.includes("Master") || formData.degree.includes("MPT"))) {
											degreeDisplay = "Master's Degree";
										} else if (formData.degree && formData.degree.includes("Clinical")) {
											degreeDisplay = "Clinical";
										}
										return `Auto-calculated: ₹${amount.toLocaleString('en-IN')} for ${degreeDisplay}. You can edit this amount.`;
									})()}
								</p>
							</div>

							<div>
								<label className="block text-sm font-medium text-slate-700 mb-1">
									Payment Mode <span className="text-red-500">*</span>
								</label>
								<select
									value={formData.paymentMode}
									onChange={(e) => setFormData({ ...formData, paymentMode: e.target.value as 'Cash' | 'Card/UPI', utrNumber: e.target.value === 'Cash' ? '' : formData.utrNumber })}
									className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 bg-white"
								>
									<option value="Cash">Cash</option>
									<option value="Card/UPI">Card/UPI</option>
								</select>
							</div>

							{formData.paymentMode === 'Card/UPI' && (
								<div>
									<label className="block text-sm font-medium text-slate-700 mb-1">
										UTR Number <span className="text-red-500">*</span>
									</label>
									<input
										type="text"
										value={formData.utrNumber}
										onChange={(e) => setFormData({ ...formData, utrNumber: e.target.value })}
										className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 bg-white"
										placeholder="Enter UTR number"
										required={formData.paymentMode === 'Card/UPI'}
									/>
								</div>
							)}

							<div>
								<label className="block text-sm font-medium text-slate-700 mb-1">
									Receipt Number
								</label>
								<input
									type="text"
									value={formData.receiptNumber}
									onChange={(e) => setFormData({ ...formData, receiptNumber: e.target.value })}
									className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 bg-white"
									placeholder="Enter receipt number (optional)"
								/>
							</div>
						</div>
						<div className="p-6 border-t border-slate-200 flex justify-end gap-3">
							<button
								onClick={() => {
									setShowAddModal(false);
									setFormData({
										name: '',
										college: '',
										degree: "Bachelor's Degree (BPT)",
										dateOfJoining: '',
										dateOfLeaving: '',
										amount: DEGREE_AMOUNTS["Bachelor's Degree (BPT)"],
										receiptNumber: '',
										paymentMode: 'Cash',
										utrNumber: '',
									});
								}}
								className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors"
								disabled={submitting}
							>
								Cancel
							</button>
							<button
								onClick={handleAddIntern}
								disabled={submitting}
								className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors"
							>
								{submitting ? 'Adding...' : 'Add Intern'}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Edit Intern Modal */}
			{showEditModal && editingIntern && (
				<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
					<div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
						<div className="p-6 border-b border-slate-200">
							<h3 className="text-xl font-semibold text-slate-800">Edit Intern Details</h3>
						</div>
						<div className="p-6 space-y-4">
							<div>
								<label className="block text-sm font-medium text-slate-700 mb-1">
									Name <span className="text-red-500">*</span>
								</label>
								<input
									type="text"
									value={formData.name}
									onChange={(e) => setFormData({ ...formData, name: e.target.value })}
									className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 bg-white"
									placeholder="Enter intern name"
								/>
							</div>

							<div>
								<label className="block text-sm font-medium text-slate-700 mb-1">
									College/University <span className="text-red-500">*</span>
								</label>
								<input
									type="text"
									value={formData.college}
									onChange={(e) => setFormData({ ...formData, college: e.target.value })}
									className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 bg-white"
									placeholder="Enter college or university name"
								/>
							</div>

							<div>
								<label className="block text-sm font-medium text-slate-700 mb-1">
									Degree <span className="text-red-500">*</span>
								</label>
								<select
									value={formData.degree}
									onChange={(e) => {
										const newDegree = e.target.value as DegreeType;
										// Auto-calculate amount only when user manually changes degree
										setFormData({ 
											...formData, 
											degree: newDegree,
											amount: DEGREE_AMOUNTS[newDegree] || 0
										});
									}}
									className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 bg-white"
								>
									<option value="Bachelor's Degree (BPT)">Bachelor's Degree (BPT)</option>
									<option value="Master's Degree (MPT)">Master's Degree (MPT)</option>
									<option value="Clinical">Clinical</option>
								</select>
							</div>

							<div>
								<label className="block text-sm font-medium text-slate-700 mb-1">
									Date of Joining <span className="text-red-500">*</span>
								</label>
								<input
									type="date"
									value={formData.dateOfJoining}
									onChange={(e) => setFormData({ ...formData, dateOfJoining: e.target.value })}
									className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 bg-white"
								/>
							</div>

							<div>
								<label className="block text-sm font-medium text-slate-700 mb-1">
									Date of Leaving <span className="text-red-500">*</span>
								</label>
								<input
									type="date"
									value={formData.dateOfLeaving}
									onChange={(e) => setFormData({ ...formData, dateOfLeaving: e.target.value })}
									className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 bg-white"
								/>
							</div>

							<div>
								<label className="block text-sm font-medium text-slate-700 mb-1">
									Amount (₹) <span className="text-red-500">*</span>
								</label>
								<input
									type="number"
									value={formData.amount ?? 0}
									onChange={(e) => {
										const inputValue = e.target.value;
										// Handle empty input
										if (inputValue === '' || inputValue === '-') {
											setFormData({ ...formData, amount: 0 });
											return;
										}
										// Parse and round to nearest integer to avoid floating-point errors
										const parsed = parseFloat(inputValue);
										const rounded = isNaN(parsed) ? 0 : Math.round(parsed);
										setFormData({ ...formData, amount: rounded });
									}}
									className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 bg-white"
									min="0"
									step="1"
								/>
								<p className="mt-1 text-xs text-slate-500">
									{(() => {
										const amount = getDegreeAmount(formData.degree);
										let degreeDisplay = "Bachelor's Degree";
										if (formData.degree && (formData.degree.includes("Master") || formData.degree.includes("MPT"))) {
											degreeDisplay = "Master's Degree";
										} else if (formData.degree && formData.degree.includes("Clinical")) {
											degreeDisplay = "Clinical";
										}
										return `Auto-calculated: ₹${amount.toLocaleString('en-IN')} for ${degreeDisplay}. You can edit this amount.`;
									})()}
								</p>
							</div>

							<div>
								<label className="block text-sm font-medium text-slate-700 mb-1">
									Payment Mode <span className="text-red-500">*</span>
								</label>
								<select
									value={formData.paymentMode}
									onChange={(e) => setFormData({ ...formData, paymentMode: e.target.value as 'Cash' | 'Card/UPI', utrNumber: e.target.value === 'Cash' ? '' : formData.utrNumber })}
									className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 bg-white"
								>
									<option value="Cash">Cash</option>
									<option value="Card/UPI">Card/UPI</option>
								</select>
							</div>

							{formData.paymentMode === 'Card/UPI' && (
								<div>
									<label className="block text-sm font-medium text-slate-700 mb-1">
										UTR Number <span className="text-red-500">*</span>
									</label>
									<input
										type="text"
										value={formData.utrNumber}
										onChange={(e) => setFormData({ ...formData, utrNumber: e.target.value })}
										className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 bg-white"
										placeholder="Enter UTR number"
										required={formData.paymentMode === 'Card/UPI'}
									/>
								</div>
							)}

							<div>
								<label className="block text-sm font-medium text-slate-700 mb-1">
									Receipt Number
								</label>
								<input
									type="text"
									value={formData.receiptNumber}
									onChange={(e) => setFormData({ ...formData, receiptNumber: e.target.value })}
									className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 bg-white"
									placeholder="Enter receipt number (optional)"
								/>
							</div>
						</div>
						<div className="p-6 border-t border-slate-200 flex justify-end gap-3">
							<button
								onClick={() => {
									setShowEditModal(false);
									setEditingIntern(null);
									setFormData({
										name: '',
										college: '',
										degree: "Bachelor's Degree (BPT)",
										dateOfJoining: '',
										dateOfLeaving: '',
										amount: DEGREE_AMOUNTS["Bachelor's Degree (BPT)"],
										receiptNumber: '',
										paymentMode: 'Cash',
										utrNumber: '',
									});
								}}
								className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors"
								disabled={submitting}
							>
								Cancel
							</button>
							<button
								onClick={handleUpdateIntern}
								disabled={submitting}
								className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors"
							>
								{submitting ? 'Updating...' : 'Update Intern'}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

