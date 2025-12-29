'use client';

import { useEffect, useMemo, useState } from 'react';
import {
	collection,
	doc,
	onSnapshot,
	updateDoc,
	query,
	where,
	getDocs,
	orderBy,
	type QuerySnapshot,
	type Timestamp,
	serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/PageHeader';

interface BillingRecord {
	id?: string;
	billingId: string;
	appointmentId?: string;
	patient: string;
	patientId: string;
	doctor?: string;
	amount: number;
	date: string;
	status: 'Pending' | 'Completed' | 'Auto-Paid';
	paymentMode?: string;
	utr?: string;
	createdAt?: string | Timestamp;
	updatedAt?: string | Timestamp;
}

interface PatientRecord {
	id: string;
	patientId: string;
	name: string;
	assignedDoctor?: string;
	patientType?: string;
}

function normalize(value?: string | null): string {
	if (!value) return '';
	return value
		.trim()
		.toLowerCase()
		.replace(/\s+/g, ' ');
}

export default function Billing() {
	const { user } = useAuth();
	const [billing, setBilling] = useState<BillingRecord[]>([]);
	const [patients, setPatients] = useState<PatientRecord[]>([]);
	const [loading, setLoading] = useState(true);
	const [selectedBill, setSelectedBill] = useState<BillingRecord | null>(null);
	const [showPayModal, setShowPayModal] = useState(false);
	const [paymentMode, setPaymentMode] = useState<'Cash' | 'UPI/Card'>('Cash');
	const [utr, setUtr] = useState('');
	const [paymentAmount, setPaymentAmount] = useState<number | string>(0);
	const [processingPayment, setProcessingPayment] = useState(false);
	const [filterRange, setFilterRange] = useState<string>('30');
	const [pendingSearchQuery, setPendingSearchQuery] = useState<string>('');
	const [completedSearchQuery, setCompletedSearchQuery] = useState<string>('');

	const clinicianName = useMemo(() => normalize(user?.displayName ?? ''), [user?.displayName]);

	// Load patients assigned to current clinician
	useEffect(() => {
		if (!clinicianName) {
			setPatients([]);
			return;
		}

		const unsubscribe = onSnapshot(
			collection(db, 'patients'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs
					.map(docSnap => {
						const data = docSnap.data() as Record<string, unknown>;
						return {
							id: docSnap.id,
							patientId: data.patientId ? String(data.patientId) : '',
							name: data.name ? String(data.name) : '',
							assignedDoctor: data.assignedDoctor ? String(data.assignedDoctor) : undefined,
							patientType: data.patientType ? String(data.patientType) : undefined,
						} as PatientRecord;
					})
					.filter(patient => normalize(patient.assignedDoctor) === clinicianName);
				setPatients([...mapped]);
			},
			error => {
				console.error('Failed to load patients', error);
				setPatients([]);
			}
		);

		return () => unsubscribe();
	}, [clinicianName]);

	// Get patient IDs assigned to current clinician
	const assignedPatientIds = useMemo(() => {
		return new Set(patients.map(p => p.patientId));
	}, [patients]);

	// Load billing records from Firestore (ordered by createdAt desc)
	useEffect(() => {
		const q = query(collection(db, 'billing'), orderBy('createdAt', 'desc'));

		const unsubscribe = onSnapshot(
			q,
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs
					.map(docSnap => {
						const data = docSnap.data() as Record<string, unknown>;
						const created = (data.createdAt as Timestamp | undefined)?.toDate?.();
						const updated = (data.updatedAt as Timestamp | undefined)?.toDate?.();

						return {
							id: docSnap.id,
							billingId: data.billingId ? String(data.billingId) : '',
							appointmentId: data.appointmentId ? String(data.appointmentId) : undefined,
							patient: data.patient ? String(data.patient) : '',
							patientId: data.patientId ? String(data.patientId) : '',
							doctor: data.doctor ? String(data.doctor) : undefined,
							amount: data.amount ? Number(data.amount) : 0,
							date: data.date ? String(data.date) : '',
							status: (data.status as 'Pending' | 'Completed' | 'Auto-Paid') || 'Pending',
							paymentMode: data.paymentMode ? String(data.paymentMode) : undefined,
							utr: data.utr ? String(data.utr) : undefined,
							createdAt: created ? created.toISOString() : undefined,
							updatedAt: updated ? updated.toISOString() : undefined,
						} as BillingRecord;
					})
					.filter(bill => assignedPatientIds.has(bill.patientId));
				setBilling([...mapped]);
				setLoading(false);
			},
			error => {
				console.error('Failed to load billing', error);
				setBilling([]);
				setLoading(false);
			}
		);

		return () => unsubscribe();
	}, [assignedPatientIds]);

	const filteredBilling = useMemo(() => {
		if (filterRange === 'all') return billing;
		const days = parseInt(filterRange, 10);
		const now = new Date();
		return billing.filter(b => {
			const d = new Date(b.date);
			return (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24) <= days;
		});
	}, [billing, filterRange]);

	const pending = useMemo(() => filteredBilling.filter(b => b.status === 'Pending'), [filteredBilling]);
	const filteredPending = useMemo(() => {
		if (!pendingSearchQuery.trim()) return pending;
		const query = pendingSearchQuery.toLowerCase().trim();
		return pending.filter(bill =>
			bill.billingId?.toLowerCase().includes(query) ||
			bill.patient?.toLowerCase().includes(query) ||
			bill.patientId?.toLowerCase().includes(query) ||
			bill.doctor?.toLowerCase().includes(query) ||
			bill.amount?.toString().includes(query) ||
			bill.date?.toLowerCase().includes(query)
		);
	}, [pending, pendingSearchQuery]);

	const completed = useMemo(
		() => filteredBilling.filter(b => b.status === 'Completed' || b.status === 'Auto-Paid'),
		[filteredBilling]
	);
	const filteredCompleted = useMemo(() => {
		if (!completedSearchQuery.trim()) return completed;
		const query = completedSearchQuery.toLowerCase().trim();
		return completed.filter(
			bill =>
				bill.billingId?.toLowerCase().includes(query) ||
				bill.patient?.toLowerCase().includes(query) ||
				bill.patientId?.toLowerCase().includes(query) ||
				bill.doctor?.toLowerCase().includes(query) ||
				bill.amount?.toString().includes(query) ||
				bill.date?.toLowerCase().includes(query) ||
				bill.paymentMode?.toLowerCase().includes(query)
		);
	}, [completed, completedSearchQuery]);

	const monthlyTotal = useMemo(() => {
		return filteredBilling
			.filter(b => b.status === 'Completed' || b.status === 'Auto-Paid')
			.reduce((sum, bill) => sum + (bill.amount || 0), 0);
	}, [filteredBilling]);

	const handlePay = (bill: BillingRecord) => {
		setSelectedBill(bill);
		setPaymentMode('Cash');
		setUtr('');
		const patient = patients.find(p => p.patientId === bill.patientId);
		const isReferral = (patient?.patientType || '').toUpperCase() === 'REFERRAL';
		setPaymentAmount(isReferral ? 'N/A' : bill.amount);
		setShowPayModal(true);
	};

	const handleSubmitPayment = async () => {
		if (!selectedBill || !selectedBill.id) return;

		if (paymentMode === 'UPI/Card' && !utr.trim()) {
			alert('Please enter UTR/Transaction ID for UPI/Card payment.');
			return;
		}

		setProcessingPayment(true);
		try {
			// For referral patients, amount should be 0 (stored in DB) even if displayed as "N/A"
			const paymentAmountStr = String(paymentAmount).trim().toUpperCase();
			const amountToSave =
				paymentAmountStr === 'N/A'
					? 0
					: typeof paymentAmount === 'number'
						? paymentAmount
						: parseFloat(String(paymentAmount)) || 0;

			const billingRef = doc(db, 'billing', selectedBill.id);
			await updateDoc(billingRef, {
				status: 'Completed',
				amount: amountToSave,
				paymentMode,
				utr: paymentMode === 'UPI/Card' ? utr.trim() : null,
				paymentRegisteredByFrontdesk: user?.uid || null,
				paymentRegisteredByFrontdeskName: user?.displayName || user?.email || null,
				updatedAt: serverTimestamp(),
			});

			// Also update appointment billing status if linked
			if (selectedBill.appointmentId) {
				const appointmentQuery = query(
					collection(db, 'appointments'),
					where('appointmentId', '==', selectedBill.appointmentId)
				);
				const appointmentSnapshot = await getDocs(appointmentQuery);
				if (!appointmentSnapshot.empty) {
					await updateDoc(doc(db, 'appointments', appointmentSnapshot.docs[0].id), {
						'billing.status': 'Completed',
						'billing.paymentMode': paymentMode,
						'billing.utr': paymentMode === 'UPI/Card' ? utr.trim() : null,
					});
				}
			}

			setShowPayModal(false);
			setSelectedBill(null);
			setPaymentMode('Cash');
			setUtr('');
			setPaymentAmount(0);
			alert('Payment processed successfully!');
		} catch (error) {
			console.error('Failed to process payment', error);
			alert(`Failed to process payment: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			setProcessingPayment(false);
		}
	};

	const formatDateLabel = (dateStr: string | undefined): string => {
		if (!dateStr) return '—';
		try {
			const date = new Date(dateStr);
			if (isNaN(date.getTime())) return dateStr;
			return date.toLocaleDateString('en-IN', {
				day: 'numeric',
				month: 'short',
				year: 'numeric',
			});
		} catch {
			return dateStr;
		}
	};

	if (loading) {
		return (
			<div className="min-h-svh bg-purple-50 px-6 py-10">
				<div className="mx-auto max-w-6xl">
					<div className="flex items-center justify-center py-20">
						<div className="text-center">
							<div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-purple-600 border-r-transparent"></div>
							<p className="text-sm text-slate-600">Loading billing records...</p>
						</div>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-svh bg-purple-50 px-6 py-10">
			<div className="mx-auto max-w-6xl space-y-8">
				<PageHeader title="Billing & Payments" />

				{/* Summary Cards */}
				<div className="grid grid-cols-1 gap-6 md:grid-cols-3">
					<div className="rounded-xl border border-amber-200 bg-white p-6 shadow-sm">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-sm font-medium text-slate-600">Pending Payments</p>
								<p className="mt-2 text-3xl font-bold text-amber-600">{pending.length}</p>
							</div>
							<div className="rounded-full bg-amber-100 p-3">
								<i className="fas fa-clock text-2xl text-amber-600"></i>
							</div>
						</div>
					</div>

					<div className="rounded-xl border border-green-200 bg-white p-6 shadow-sm">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-sm font-medium text-slate-600">Completed Payments</p>
								<p className="mt-2 text-3xl font-bold text-green-600">{completed.length}</p>
							</div>
							<div className="rounded-full bg-green-100 p-3">
								<i className="fas fa-check-circle text-2xl text-green-600"></i>
							</div>
						</div>
					</div>

					<div className="rounded-xl border border-purple-200 bg-white p-6 shadow-sm">
						<div className="flex items-center justify-between">
							<div>
								<p className="text-sm font-medium text-slate-600">Total Collections</p>
								<p className="mt-2 text-3xl font-bold text-purple-600">₹{monthlyTotal.toFixed(2)}</p>
							</div>
							<div className="rounded-full bg-purple-100 p-3">
								<i className="fas fa-rupee-sign text-2xl text-purple-600"></i>
							</div>
						</div>
					</div>
				</div>

				{/* Filter */}
				<div className="flex items-center gap-4">
					<label className="text-sm font-medium text-slate-700">Filter by Date Range:</label>
					<select
						value={filterRange}
						onChange={e => setFilterRange(e.target.value)}
						className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
					>
						<option value="7">Last 7 days</option>
						<option value="30">Last 30 days</option>
						<option value="90">Last 90 days</option>
						<option value="all">All time</option>
					</select>
				</div>

				{/* Pending Payments */}
				<div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
					<div className="mb-6 flex items-center justify-between">
						<h2 className="text-xl font-semibold text-slate-900">Pending Payments</h2>
						<div className="flex items-center gap-2">
							<input
								type="text"
								value={pendingSearchQuery}
								onChange={e => setPendingSearchQuery(e.target.value)}
								placeholder="Search pending payments..."
								className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
							/>
						</div>
					</div>

					{filteredPending.length === 0 ? (
						<div className="py-8 text-center text-sm text-slate-500">No pending payments found.</div>
					) : (
						<div className="overflow-x-auto">
							<table className="min-w-full divide-y divide-slate-200">
								<thead className="bg-slate-50">
									<tr>
										<th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-700">
											Billing ID
										</th>
										<th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-700">
											Patient
										</th>
										<th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-700">
											Date
										</th>
										<th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-700">
											Amount
										</th>
										<th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-700">
											Actions
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100 bg-white">
									{filteredPending.map(bill => {
										const patient = patients.find(p => p.patientId === bill.patientId);
										const isReferral = (patient?.patientType || '').toUpperCase() === 'REFERRAL';
										return (
											<tr key={bill.id}>
												<td className="px-4 py-4 text-sm text-slate-900">{bill.billingId}</td>
												<td className="px-4 py-4 text-sm text-slate-900">
													{bill.patient}
													<br />
													<span className="text-xs text-slate-500">{bill.patientId}</span>
												</td>
												<td className="px-4 py-4 text-sm text-slate-600">{formatDateLabel(bill.date)}</td>
												<td className="px-4 py-4 text-sm font-semibold text-slate-900">
													{isReferral ? 'N/A' : `₹${bill.amount.toFixed(2)}`}
												</td>
												<td className="px-4 py-4 text-right">
													<button
														onClick={() => handlePay(bill)}
														className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
													>
														<i className="fas fa-money-bill-wave mr-2"></i>
														Pay
													</button>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</div>

				{/* Completed Payments */}
				<div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
					<div className="mb-6 flex items-center justify-between">
						<h2 className="text-xl font-semibold text-slate-900">Completed Payments</h2>
						<div className="flex items-center gap-2">
							<input
								type="text"
								value={completedSearchQuery}
								onChange={e => setCompletedSearchQuery(e.target.value)}
								placeholder="Search completed payments..."
								className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
							/>
						</div>
					</div>

					{filteredCompleted.length === 0 ? (
						<div className="py-8 text-center text-sm text-slate-500">No completed payments found.</div>
					) : (
						<div className="overflow-x-auto">
							<table className="min-w-full divide-y divide-slate-200">
								<thead className="bg-slate-50">
									<tr>
										<th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-700">
											Billing ID
										</th>
										<th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-700">
											Patient
										</th>
										<th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-700">
											Date
										</th>
										<th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-700">
											Amount
										</th>
										<th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-700">
											Payment Mode
										</th>
										<th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-700">
											Status
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100 bg-white">
									{filteredCompleted.map(bill => {
										const patient = patients.find(p => p.patientId === bill.patientId);
										const isReferral = (patient?.patientType || '').toUpperCase() === 'REFERRAL';
										return (
											<tr key={bill.id}>
												<td className="px-4 py-4 text-sm text-slate-900">{bill.billingId}</td>
												<td className="px-4 py-4 text-sm text-slate-900">
													{bill.patient}
													<br />
													<span className="text-xs text-slate-500">{bill.patientId}</span>
												</td>
												<td className="px-4 py-4 text-sm text-slate-600">{formatDateLabel(bill.date)}</td>
												<td className="px-4 py-4 text-sm font-semibold text-slate-900">
													{isReferral ? 'N/A' : `₹${bill.amount.toFixed(2)}`}
												</td>
												<td className="px-4 py-4 text-sm text-slate-600">{bill.paymentMode || '—'}</td>
												<td className="px-4 py-4">
													<span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800">
														{bill.status === 'Auto-Paid' ? 'Auto-Paid' : 'Completed'}
													</span>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</div>

				{/* Payment Modal */}
				{showPayModal && selectedBill && (
					<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
						<div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
							<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
								<h2 className="text-lg font-semibold text-slate-900">Process Payment</h2>
								<button
									type="button"
									onClick={() => {
										setShowPayModal(false);
										setSelectedBill(null);
										setPaymentMode('Cash');
										setUtr('');
										setPaymentAmount(0);
									}}
									className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
									aria-label="Close dialog"
								>
									<i className="fas fa-times" aria-hidden="true" />
								</button>
							</header>
							<div className="px-6 py-4">
								<div className="space-y-4">
									<div>
										<label className="block text-sm font-medium text-slate-700">Patient</label>
										<p className="mt-1 text-sm text-slate-900">
											{selectedBill.patient} ({selectedBill.patientId})
										</p>
									</div>
									<div>
										<label className="block text-sm font-medium text-slate-700">Billing ID</label>
										<p className="mt-1 text-sm text-slate-900">{selectedBill.billingId}</p>
									</div>
									<div>
										<label className="block text-sm font-medium text-slate-700">Amount</label>
										<p className="mt-1 text-lg font-semibold text-slate-900">
											{typeof paymentAmount === 'string' && paymentAmount.toUpperCase() === 'N/A'
												? 'N/A'
												: `₹${(typeof paymentAmount === 'number' ? paymentAmount : parseFloat(String(paymentAmount)) || 0).toFixed(2)}`}
										</p>
									</div>
									<div>
										<label className="block text-sm font-medium text-slate-700">
											Payment Mode <span className="text-red-500">*</span>
										</label>
										<select
											value={paymentMode}
											onChange={e => setPaymentMode(e.target.value as 'Cash' | 'UPI/Card')}
											className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
										>
											<option value="Cash">Cash</option>
											<option value="UPI/Card">UPI/Card</option>
										</select>
									</div>
									{paymentMode === 'UPI/Card' && (
										<div>
											<label className="block text-sm font-medium text-slate-700">
												UTR/Transaction ID <span className="text-red-500">*</span>
											</label>
											<input
												type="text"
												value={utr}
												onChange={e => setUtr(e.target.value)}
												placeholder="Enter UTR/Transaction ID"
												className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
											/>
										</div>
									)}
								</div>
							</div>
							<footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
								<button
									type="button"
									onClick={() => {
										setShowPayModal(false);
										setSelectedBill(null);
										setPaymentMode('Cash');
										setUtr('');
										setPaymentAmount(0);
									}}
									className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={handleSubmitPayment}
									disabled={processingPayment}
									className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
								>
									{processingPayment ? (
										<>
											<i className="fas fa-spinner fa-spin mr-2"></i>
											Processing...
										</>
									) : (
										<>
											<i className="fas fa-check mr-2"></i>
											Process Payment
										</>
									)}
								</button>
							</footer>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

