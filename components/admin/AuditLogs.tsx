'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, type QuerySnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import PageHeader from '@/components/PageHeader';

interface AuditLog {
	id: string;
	action: string;
	userId?: string | null;
	userEmail?: string | null;
	resourceType?: string | null;
	resourceId?: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
}

const ACTION_OPTIONS = [
	{ value: 'all', label: 'All actions' },
	{ value: 'patients-import', label: 'Patients import' },
	{ value: 'patients-export', label: 'Patients export' },
	{ value: 'user-reset-password', label: 'User reset password' },
	{ value: 'billing-send-notifications', label: 'Billing notifications' },
] as const;

export default function AuditLogs() {
	const [logs, setLogs] = useState<AuditLog[]>([]);
	const [loading, setLoading] = useState(true);

	// filters
	const [search, setSearch] = useState('');
	const [actionFilter, setActionFilter] = useState<(typeof ACTION_OPTIONS)[number]['value']>('all');
	const [dateFrom, setDateFrom] = useState('');
	const [dateTo, setDateTo] = useState('');
	const [userFilter, setUserFilter] = useState('');

	const [selected, setSelected] = useState<AuditLog | null>(null);

	useEffect(() => {
		const q = query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'));
		const unsub = onSnapshot(
			q,
			(snapshot: QuerySnapshot) => {
				const next = snapshot.docs.map(d => {
					const data = d.data() as Record<string, any>;
					return {
						id: d.id,
						action: String(data.action || ''),
						userId: data.userId ?? null,
						userEmail: data.userEmail ?? null,
						resourceType: data.resourceType ?? null,
						resourceId: data.resourceId ?? null,
						metadata: (data.metadata as Record<string, unknown>) || {},
						createdAt: String(data.createdAt || ''),
					} as AuditLog;
				});
				setLogs(next);
				setLoading(false);
			},
			err => {
				console.error('Failed to load audit logs', err);
				setLogs([]);
				setLoading(false);
			}
		);
		return () => unsub();
	}, []);

	const filtered = useMemo(() => {
		return logs.filter(log => {
			// action filter
			if (actionFilter !== 'all' && log.action !== actionFilter) return false;
			// date range
			if (dateFrom) {
				const d = new Date(log.createdAt);
				if (!(d >= new Date(`${dateFrom}T00:00:00`))) return false;
			}
			if (dateTo) {
				const d = new Date(log.createdAt);
				if (!(d <= new Date(`${dateTo}T23:59:59`))) return false;
			}
			// user filter
			if (userFilter) {
				const needle = userFilter.trim().toLowerCase();
				const hay = `${log.userEmail || ''} ${log.userId || ''}`.toLowerCase();
				if (!hay.includes(needle)) return false;
			}
			// search in metadata and resource
			if (search.trim()) {
				const s = search.trim().toLowerCase();
				const text =
					`${log.resourceType || ''} ${log.resourceId || ''} ${JSON.stringify(log.metadata || {})}`.toLowerCase();
				if (!text.includes(s)) return false;
			}
			return true;
		});
	}, [logs, actionFilter, dateFrom, dateTo, userFilter, search]);

	function formatDateTime(iso: string) {
		if (!iso) return '—';
		try {
			return new Intl.DateTimeFormat('en-US', {
				month: 'short',
				day: 'numeric',
				year: 'numeric',
				hour: 'numeric',
				minute: '2-digit',
			}).format(new Date(iso));
		} catch {
			return iso;
		}
	}

	function exportCsv() {
		if (!filtered.length) {
			alert('No audit entries to export for current filters.');
			return;
		}
		const headers = ['createdAt', 'action', 'userEmail', 'userId', 'resourceType', 'resourceId', 'metadataJSON'];
		const rows = filtered.map(row => [
			row.createdAt,
			row.action,
			row.userEmail || '',
			row.userId || '',
			row.resourceType || '',
			row.resourceId || '',
			JSON.stringify(row.metadata || {}),
		]);
		const csv =
			headers.join(',') +
			'\n' +
			rows
				.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
				.join('\n');
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.setAttribute('download', `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`);
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	}

	return (
		<div className="min-h-svh bg-slate-50 px-6 py-10">
			<div className="mx-auto max-w-6xl space-y-10">
				<PageHeader
					title="Audit Logs"
					actions={
						<button
							type="button"
							onClick={exportCsv}
							className="inline-flex items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900 focus-visible:border-slate-400 focus-visible:text-slate-900 focus-visible:outline-none"
						>
							<i className="fas fa-file-export mr-2" aria-hidden="true" />
							Export CSV
						</button>
					}
				/>

				<div className="rounded-2xl bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.07)]">
					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
						<div>
							<label className="block text-sm font-medium text-slate-700">Action</label>
							<select
								value={actionFilter}
								onChange={e => setActionFilter(e.target.value as any)}
								className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
							>
								{ACTION_OPTIONS.map(opt => (
									<option key={opt.value} value={opt.value}>
										{opt.label}
									</option>
								))}
							</select>
						</div>
						<div>
							<label className="block text-sm font-medium text-slate-700">User (email/ID)</label>
							<input
								type="search"
								value={userFilter}
								onChange={e => setUserFilter(e.target.value)}
								className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
								placeholder="admin@test.com"
							/>
						</div>
						<div>
							<label className="block text-sm font-medium text-slate-700">From</label>
							<input
								type="date"
								value={dateFrom}
								onChange={e => setDateFrom(e.target.value)}
								className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
							/>
						</div>
						<div>
							<label className="block text-sm font-medium text-slate-700">To</label>
							<input
								type="date"
								value={dateTo}
								onChange={e => setDateTo(e.target.value)}
								className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
							/>
						</div>
					</div>

					<div className="mt-4">
						<label className="block text-sm font-medium text-slate-700">Search in metadata</label>
						<input
							type="search"
							value={search}
							onChange={e => setSearch(e.target.value)}
							className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
							placeholder='Try "export" or a filename'
						/>
					</div>

					<div className="mt-6 overflow-x-auto">
						{loading ? (
							<p className="py-6 text-sm text-slate-500">Loading…</p>
						) : filtered.length === 0 ? (
							<p className="py-6 text-sm text-slate-500">No logs match the current filters.</p>
						) : (
							<table className="min-w-full divide-y divide-slate-200 text-left text-sm text-slate-700">
								<thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
									<tr>
										<th className="px-4 py-3 font-semibold">Timestamp</th>
										<th className="px-4 py-3 font-semibold">Action</th>
										<th className="px-4 py-3 font-semibold">User</th>
										<th className="px-4 py-3 font-semibold">Resource</th>
										<th className="px-4 py-3 font-semibold text-right">Details</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100">
									{filtered.slice(0, 500).map(row => (
										<tr key={row.id}>
											<td className="px-4 py-3">{formatDateTime(row.createdAt)}</td>
											<td className="px-4 py-3">{row.action}</td>
											<td className="px-4 py-3">{row.userEmail || row.userId || '—'}</td>
											<td className="px-4 py-3">
												{row.resourceType || '—'}
												{row.resourceId ? `:${row.resourceId}` : ''}
											</td>
											<td className="px-4 py-3 text-right">
												<button
													type="button"
													onClick={() => setSelected(row)}
													className="inline-flex items-center rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800 focus-visible:border-slate-300 focus-visible:text-slate-800 focus-visible:outline-none"
												>
													<i className="fas fa-eye mr-1 text-[11px]" aria-hidden="true" />
													View
												</button>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
					</div>
				</div>

				{selected && (
					<div
						role="dialog"
						aria-modal="true"
						className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6"
						onClick={() => setSelected(null)}
					>
						<div
							className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl"
							onClick={e => e.stopPropagation()}
						>
							<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
								<h2 className="text-lg font-semibold text-slate-900">Audit details</h2>
								<button
									type="button"
									onClick={() => setSelected(null)}
									className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:bg-slate-100 focus-visible:text-slate-600 focus-visible:outline-none"
									aria-label="Close"
								>
									<i className="fas fa-times" aria-hidden="true" />
								</button>
							</header>
							<div className="space-y-2 px-6 py-5 text-sm text-slate-700">
								<p><strong>Timestamp:</strong> {formatDateTime(selected.createdAt)}</p>
								<p><strong>Action:</strong> {selected.action}</p>
								<p><strong>User:</strong> {selected.userEmail || selected.userId || '—'}</p>
								<p><strong>Resource:</strong> {(selected.resourceType || '—')}{selected.resourceId ? `:${selected.resourceId}` : ''}</p>
								<div>
									<p className="font-semibold">Metadata (JSON)</p>
									<pre className="mt-1 max-h-72 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
{JSON.stringify(selected.metadata || {}, null, 2)}
									</pre>
								</div>
							</div>
							<footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
								<button
									type="button"
									onClick={() => setSelected(null)}
									className="inline-flex items-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800 focus-visible:border-slate-300 focus-visible:text-slate-800 focus-visible:outline-none"
								>
									Close
								</button>
							</footer>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}


