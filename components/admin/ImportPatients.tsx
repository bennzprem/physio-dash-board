'use client';

import { useMemo, useState } from 'react';
import Papa from 'papaparse';
import CSVPreviewModal from './CSVPreviewModal';
import { auth } from '@/lib/firebase';

interface ImportPatientsProps {
	onClose: () => void;
}

type Row = {
	fullName?: string;
	name?: string;
	email?: string;
	phone?: string;
	dob?: string;
	address?: string;
	gender?: string;
	notes?: string;
	[key: string]: unknown;
};

export default function ImportPatients({ onClose }: ImportPatientsProps) {
	const [file, setFile] = useState<File | null>(null);
	const [rows, setRows] = useState<Row[]>([]);
	const [errors, setErrors] = useState<Array<{ index: number; error: string }>>([]);
	const [parsing, setParsing] = useState(false);
	const [uploading, setUploading] = useState(false);
	const [showPreview, setShowPreview] = useState(false);
	const [skipDuplicates, setSkipDuplicates] = useState(true);

	const headersHelp = useMemo(
		() => 'Expected headers: fullName,email,phone,dob,address,gender,notes (name accepted as alias of fullName)',
		[]
	);

	function validateLocal(r: Row, idx: number): string | null {
		const fullName = String((r.fullName || r.name || '') as string).trim();
		const email = r.email ? String(r.email).trim() : '';
		const phone = r.phone ? String(r.phone).trim() : '';
		if (!fullName) return 'Missing fullName/name';
		if (!email && !phone) return 'Missing email and phone';
		return null;
	}

	const parseFile = async () => {
		if (!file) return;
		setParsing(true);
		try {
			const parsed = await new Promise<Row[]>((resolve, reject) => {
				Papa.parse(file, {
					header: true,
					skipEmptyLines: true,
					complete: (result: { data?: unknown[] }) => resolve((result.data || []) as Row[]),
					error: (err: unknown) => reject(err),
				});
			});
			const mapped = parsed.map(r => {
				if (r.name && !r.fullName) {
					return { ...r, fullName: r.name };
				}
				return r;
			});
			const errs: Array<{ index: number; error: string }> = [];
			mapped.forEach((r, idx) => {
				const e = validateLocal(r, idx);
				if (e) errs.push({ index: idx, error: e });
			});
			setRows([...mapped]);
			setErrors(errs);
			setShowPreview(true);
		} catch (e) {
			alert('Failed to parse CSV. Please check the format.');
		} finally {
			setParsing(false);
		}
	};

	async function getToken(): Promise<string> {
		const user = auth.currentUser;
		if (!user) throw new Error('Not authenticated');
		return await user.getIdToken();
	}

	const upload = async () => {
		setUploading(true);
		try {
			const token = await getToken();
			// Chunk rows to avoid big payloads
			const chunk = <T,>(arr: T[], size: number) => {
				const out: T[][] = [];
				for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
				return out;
			};
			let imported = 0;
			let skipped = 0;
			let totalErrors: Array<{ index: number; error: string }> = [];
			for (const group of chunk(rows, 200)) {
				const res = await fetch('/api/patients/import', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
					body: JSON.stringify({ rows: group, skipDuplicates }),
				});
				if (!res.ok) {
					const data = await res.json().catch(() => ({}));
					throw new Error(data?.message || 'Import failed');
				}
				const data = await res.json();
				imported += Number(data?.imported || 0);
				skipped += Number(data?.skipped || 0);
				const groupErrors = (data?.errors as Array<{ index: number; error: string }>) || [];
				// Offset group index if needed (not shown in UI beyond first page)
				totalErrors = totalErrors.concat(groupErrors);
			}
			alert(`Import complete. Imported: ${imported}, Skipped: ${skipped}, Errors: ${totalErrors.length}`);
			onClose();
		} catch (e: any) {
			alert(e?.message || 'Import failed');
		} finally {
			setUploading(false);
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
			<div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
				<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
					<h2 className="text-lg font-semibold text-slate-900">Import Patients (CSV)</h2>
					<button
						type="button"
						onClick={onClose}
						className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:bg-slate-100 focus-visible:text-slate-600 focus-visible:outline-none"
						aria-label="Close dialog"
					>
						<i className="fas fa-times" aria-hidden="true" />
					</button>
				</header>
				<div className="space-y-4 px-6 py-6">
					<p className="text-sm text-slate-600">{headersHelp}</p>
					<div>
						<label className="block text-sm font-medium text-slate-700">CSV File</label>
						<input
							type="file"
							accept=".csv,text/csv"
							onChange={e => setFile(e.target.files?.[0] || null)}
							className="mt-1 w-full text-sm"
						/>
					</div>
					<div className="flex items-center gap-3">
						<input
							id="skipdups"
							type="checkbox"
							checked={skipDuplicates}
							onChange={e => setSkipDuplicates(e.currentTarget.checked)}
						/>
						<label htmlFor="skipdups" className="text-sm text-slate-700">
							Skip duplicates (match by email/phone)
						</label>
					</div>
				</div>
				<footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
					<button
						type="button"
						onClick={onClose}
						className="inline-flex items-center rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800 focus-visible:border-slate-300 focus-visible:text-slate-800 focus-visible:outline-none"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={parseFile}
						disabled={!file || parsing}
						className="inline-flex items-center rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-500 focus-visible:bg-sky-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:opacity-60"
					>
						{parsing ? 'Parsing…' : 'Preview'}
					</button>
				</footer>
			</div>
			{showPreview && (
				<CSVPreviewModal<Row>
					title="Import Preview"
					rows={rows}
					errors={errors}
					onClose={() => setShowPreview(false)}
					onConfirm={upload}
					maxPreview={50}
				/>
			)}
		</div>
	);
}


