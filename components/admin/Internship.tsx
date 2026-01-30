'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, orderBy, type QuerySnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import PageHeader from '@/components/PageHeader';
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
	createdAt: unknown;
	updatedAt: unknown;
}

const DEGREE_LABELS: Record<string, string> = {
	"Bachelor's Degree (BPT)": "BPT",
	"Master's Degree (MPT)": "MPT",
	"Clinical": "Clinical",
};

function formatDate(dateStr: string | undefined): string {
	if (!dateStr) return '—';
	try {
		const d = new Date(dateStr);
		return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
	} catch {
		return dateStr;
	}
}

function formatDegree(degree: Intern['degree']): string {
	return DEGREE_LABELS[degree] || degree || '—';
}

export default function AdminInternship() {
	const [interns, setInterns] = useState<Intern[]>([]);
	const [loading, setLoading] = useState(true);
	const [searchTerm, setSearchTerm] = useState('');
	const [filterStatus, setFilterStatus] = useState<'all' | 'paid' | 'pending'>('all');
	const [filterDegree, setFilterDegree] = useState<string>('all');
	const [filterCollege, setFilterCollege] = useState<string>('all');
	const [joiningFrom, setJoiningFrom] = useState('');
	const [joiningTo, setJoiningTo] = useState('');
	const [leavingFrom, setLeavingFrom] = useState('');
	const [leavingTo, setLeavingTo] = useState('');

	useEffect(() => {
		const unsubscribe = onSnapshot(
			query(collection(db, 'interns'), orderBy('createdAt', 'asc')),
			(snapshot: QuerySnapshot) => {
				const loaded = snapshot.docs.map(docSnap => {
					const data = docSnap.data();
					const isPaid = data.isPaid === true || data.isPaid === 'true' || data.isPaid === 1;
					const amount = typeof data.amount === 'number' ? data.amount : (typeof data.amount === 'string' ? parseFloat(data.amount) || 0 : 0);
					return {
						id: docSnap.id,
						serialNumber: data.serialNumber ?? 0,
						name: data.name ?? '',
						college: data.college ?? '',
						degree: data.degree ?? "Bachelor's Degree (BPT)",
						dateOfJoining: data.dateOfJoining ?? '',
						dateOfLeaving: data.dateOfLeaving ?? '',
						amount,
						isPaid,
						paymentDate: data.paymentDate,
						receiptNumber: data.receiptNumber,
						paymentMode: data.paymentMode ?? 'Cash',
						utrNumber: data.utrNumber,
						createdAt: data.createdAt,
						updatedAt: data.updatedAt,
					} as Intern;
				});
				setInterns(loaded);
				setLoading(false);
			},
			error => {
				console.error('Failed to load interns', error);
				setInterns([]);
				setLoading(false);
			}
		);
		return () => unsubscribe();
	}, []);

	const uniqueColleges = useMemo(() => {
		const set = new Set(interns.map(i => i.college).filter(Boolean));
		return Array.from(set).sort((a, b) => a.localeCompare(b));
	}, [interns]);

	const filteredInterns = useMemo(() => {
		let list = interns;

		if (searchTerm.trim()) {
			const term = searchTerm.toLowerCase().trim();
			list = list.filter(
				i =>
					i.name.toLowerCase().includes(term) ||
					i.college.toLowerCase().includes(term) ||
					formatDegree(i.degree).toLowerCase().includes(term) ||
					(i.utrNumber && i.utrNumber.toLowerCase().includes(term)) ||
					(i.receiptNumber && i.receiptNumber.toLowerCase().includes(term))
			);
		}

		if (filterStatus === 'paid') list = list.filter(i => i.isPaid);
		if (filterStatus === 'pending') list = list.filter(i => !i.isPaid);

		if (filterDegree !== 'all') list = list.filter(i => i.degree === filterDegree);
		if (filterCollege !== 'all') list = list.filter(i => i.college === filterCollege);

		if (joiningFrom) list = list.filter(i => i.dateOfJoining && i.dateOfJoining >= joiningFrom);
		if (joiningTo) list = list.filter(i => i.dateOfJoining && i.dateOfJoining <= joiningTo);
		if (leavingFrom) list = list.filter(i => i.dateOfLeaving && i.dateOfLeaving >= leavingFrom);
		if (leavingTo) list = list.filter(i => i.dateOfLeaving && i.dateOfLeaving <= leavingTo);

		return list;
	}, [interns, searchTerm, filterStatus, filterDegree, filterCollege, joiningFrom, joiningTo, leavingFrom, leavingTo]);

	const totalInterns = interns.length;
	const totalFiltered = filteredInterns.length;
	const totalPaid = useMemo(() => interns.filter(i => i.isPaid).length, [interns]);
	const totalPending = useMemo(() => interns.filter(i => !i.isPaid).length, [interns]);

	const handleExport = (format: 'csv' | 'excel' = 'excel') => {
		if (filteredInterns.length === 0) {
			alert('No interns to export.');
			return;
		}
		const rows = [
			['Serial No', 'Name', 'College', 'Degree', 'Date of Joining', 'Date of Leaving', 'Amount (₹)', 'Payment Mode', 'UTR', 'Receipt No', 'Status', 'Payment Date'],
			...filteredInterns.map(i => [
				i.serialNumber ?? '',
				i.name ?? '',
				i.college ?? '',
				formatDegree(i.degree),
				formatDate(i.dateOfJoining),
				formatDate(i.dateOfLeaving),
				i.amount ?? 0,
				i.paymentMode ?? 'Cash',
				i.utrNumber ?? '',
				i.receiptNumber ?? '',
				i.isPaid ? 'Paid' : 'Pending',
				i.paymentDate ? formatDate(i.paymentDate) : '',
			]),
		];
		if (format === 'csv') {
			const csv = rows.map(line => line.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
			const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = `interns-${new Date().toISOString().slice(0, 10)}.csv`;
			link.click();
			URL.revokeObjectURL(url);
		} else {
			const ws = XLSX.utils.aoa_to_sheet(rows);
			const wb = XLSX.utils.book_new();
			XLSX.utils.book_append_sheet(wb, ws, 'Interns');
			XLSX.writeFile(wb, `interns-${new Date().toISOString().slice(0, 10)}.xlsx`);
		}
	};

	const clearFilters = () => {
		setSearchTerm('');
		setFilterStatus('all');
		setFilterDegree('all');
		setFilterCollege('all');
		setJoiningFrom('');
		setJoiningTo('');
		setLeavingFrom('');
		setLeavingTo('');
	};

	const hasActiveFilters =
		searchTerm.trim() ||
		filterStatus !== 'all' ||
		filterDegree !== 'all' ||
		filterCollege !== 'all' ||
		joiningFrom ||
		joiningTo ||
		leavingFrom ||
		leavingTo;

	if (loading) {
		return (
			<div className="min-h-svh bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 px-6 py-10">
				<div className="mx-auto max-w-6xl">
					<div className="text-center py-12 text-slate-600">Loading interns...</div>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-svh bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 px-6 py-10">
			<div className="mx-auto max-w-6xl space-y-6">
				<PageHeader title="Internship" />

				{/* Total and summary cards */}
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
					<div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
						<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Interns</p>
						<p className="mt-2 text-3xl font-bold text-slate-900">{totalInterns}</p>
					</div>
					<div className="rounded-xl border border-green-200 bg-green-50/50 p-5 shadow-sm">
						<p className="text-xs font-semibold uppercase tracking-wide text-green-600">Paid</p>
						<p className="mt-2 text-3xl font-bold text-green-900">{totalPaid}</p>
					</div>
					<div className="rounded-xl border border-amber-200 bg-amber-50/50 p-5 shadow-sm">
						<p className="text-xs font-semibold uppercase tracking-wide text-amber-600">Pending</p>
						<p className="mt-2 text-3xl font-bold text-amber-900">{totalPending}</p>
					</div>
					<div className="rounded-xl border border-blue-200 bg-blue-50/50 p-5 shadow-sm">
						<p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Showing (filtered)</p>
						<p className="mt-2 text-3xl font-bold text-blue-900">{totalFiltered}</p>
					</div>
				</div>

				{/* Interns list and filters */}
				<section className="rounded-2xl bg-white p-6 shadow-lg border border-slate-200">
					<div className="flex flex-wrap items-center justify-between gap-4 mb-4">
						<h2 className="text-lg font-semibold text-slate-900">Interns List</h2>
						<div className="flex items-center gap-2">
							{hasActiveFilters && (
								<button
									type="button"
									onClick={clearFilters}
									className="text-sm text-slate-600 hover:text-slate-900 underline"
								>
									Clear filters
								</button>
							)}
							<button
								type="button"
								onClick={() => handleExport('excel')}
								className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700"
							>
								<i className="fas fa-file-excel" aria-hidden="true" />
								Export Excel/CSV
							</button>
						</div>
					</div>

					{/* Filters row */}
					<div className="mb-6 rounded-lg border border-slate-200 bg-slate-50/50 p-4 space-y-4">
						<p className="text-sm font-medium text-slate-700">Filters</p>
						<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
							<div>
								<label className="block text-xs font-medium text-slate-500 mb-1">Search</label>
								<input
									type="text"
									placeholder="Name, college, degree, UTR, receipt..."
									value={searchTerm}
									onChange={e => setSearchTerm(e.target.value)}
									className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
								<select
									value={filterStatus}
									onChange={e => setFilterStatus(e.target.value as 'all' | 'paid' | 'pending')}
									className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
								>
									<option value="all">All</option>
									<option value="paid">Paid</option>
									<option value="pending">Pending</option>
								</select>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500 mb-1">Degree</label>
								<select
									value={filterDegree}
									onChange={e => setFilterDegree(e.target.value)}
									className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
								>
									<option value="all">All</option>
									<option value="Bachelor's Degree (BPT)">BPT</option>
									<option value="Master's Degree (MPT)">MPT</option>
									<option value="Clinical">Clinical</option>
								</select>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500 mb-1">College</label>
								<select
									value={filterCollege}
									onChange={e => setFilterCollege(e.target.value)}
									className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
								>
									<option value="all">All</option>
									{uniqueColleges.map(c => (
										<option key={c} value={c}>{c}</option>
									))}
								</select>
							</div>
						</div>
						<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
							<div>
								<label className="block text-xs font-medium text-slate-500 mb-1">Joining from</label>
								<input
									type="date"
									value={joiningFrom}
									onChange={e => setJoiningFrom(e.target.value)}
									className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500 mb-1">Joining to</label>
								<input
									type="date"
									value={joiningTo}
									onChange={e => setJoiningTo(e.target.value)}
									className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500 mb-1">Leaving from</label>
								<input
									type="date"
									value={leavingFrom}
									onChange={e => setLeavingFrom(e.target.value)}
									className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-slate-500 mb-1">Leaving to</label>
								<input
									type="date"
									value={leavingTo}
									onChange={e => setLeavingTo(e.target.value)}
									className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
								/>
							</div>
						</div>
					</div>

					{interns.length === 0 ? (
						<div className="py-12 text-center text-slate-500">No interns registered yet.</div>
					) : filteredInterns.length === 0 ? (
						<div className="py-12 text-center text-slate-500">No interns match the current filters.</div>
					) : (
						<div className="overflow-x-auto -mx-2">
							<div className="max-h-[60vh] overflow-y-auto">
								<table className="w-full border-collapse text-sm">
									<thead className="bg-slate-50 sticky top-0 z-10">
										<tr>
											<th className="px-2 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Sl. No</th>
											<th className="px-2 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Name</th>
											<th className="px-2 py-3 text-left text-xs font-semibold text-slate-700 uppercase">College</th>
											<th className="px-2 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Degree</th>
											<th className="px-2 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Joining</th>
											<th className="px-2 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Leaving</th>
											<th className="px-2 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Amount</th>
											<th className="px-2 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Mode</th>
											<th className="px-2 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Status</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-slate-200">
										{filteredInterns.map(intern => (
											<tr key={intern.id} className="hover:bg-slate-50">
												<td className="px-2 py-3 text-slate-900">{intern.serialNumber}</td>
												<td className="px-2 py-3 font-medium text-slate-900 truncate max-w-[120px]" title={intern.name}>{intern.name}</td>
												<td className="px-2 py-3 text-slate-700 truncate max-w-[140px]" title={intern.college}>{intern.college}</td>
												<td className="px-2 py-3 text-slate-700">{formatDegree(intern.degree)}</td>
												<td className="px-2 py-3 text-slate-700 whitespace-nowrap">{formatDate(intern.dateOfJoining)}</td>
												<td className="px-2 py-3 text-slate-700 whitespace-nowrap">{formatDate(intern.dateOfLeaving)}</td>
												<td className="px-2 py-3 font-medium text-slate-900 whitespace-nowrap">₹{intern.amount?.toLocaleString('en-IN') ?? '—'}</td>
												<td className="px-2 py-3 text-slate-700">{intern.paymentMode ?? '—'}</td>
												<td className="px-2 py-3">
													{intern.isPaid ? (
														<span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">Paid</span>
													) : (
														<span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Pending</span>
													)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					)}
				</section>
			</div>
		</div>
	);
}
