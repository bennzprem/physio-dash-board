/* eslint-disable react-hooks/exhaustive-deps */
'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import {
	collection,
	doc,
	onSnapshot,
	addDoc,
	updateDoc,
	deleteDoc,
	serverTimestamp,
	writeBatch,
	getDocs,
	query,
	where,
	type QuerySnapshot,
	type Timestamp,
} from 'firebase/firestore';
// @ts-ignore - papaparse types may not be available
import Papa from 'papaparse';

import {
	type AdminGenderOption,
	type AdminPatientRecord,
	type AdminPatientStatus,
} from '@/lib/adminMockData';
import { db } from '@/lib/firebase';
import PageHeader from '@/components/PageHeader';
import { sendSMSNotification, isValidPhoneNumber } from '@/lib/sms';
import { sendEmailNotification } from '@/lib/email';
import ReportModal from '@/components/frontdesk/ReportModal';

const genderOptions: Array<{ value: AdminGenderOption; label: string }> = [
	{ value: '', label: 'Select' },
	{ value: 'Male', label: 'Male' },
	{ value: 'Female', label: 'Female' },
	{ value: 'Other', label: 'Other' },
];

const statusOptions: Array<{ value: AdminPatientStatus; label: string }> = [
	{ value: 'pending', label: 'Pending' },
	{ value: 'ongoing', label: 'Ongoing' },
	{ value: 'completed', label: 'Completed' },
	{ value: 'cancelled', label: 'Cancelled' },
];

const statusFilterOptions: Array<{ value: 'all' | AdminPatientStatus; label: string }> = [
	{ value: 'all', label: 'All statuses' },
	...statusOptions,
];

const formatDate = (iso: string) => {
	if (!iso) return '—';
	try {
		return new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
		}).format(new Date(iso));
	} catch {
		return '—';
	}
};

const formatPatientIdShort = (patientId?: string | null, length: number = 8) => {
	if (!patientId) return '—';
	if (patientId.length <= length) return patientId;
	return '...' + patientId.slice(-length);
};

const formatDateTime = (iso: string) => {
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
		return '—';
	}
};

function normalizeDateInput(raw?: string) {
	if (!raw) return '';
	const trimmed = raw.trim();
	if (!trimmed) return '';

	// direct parse first
	const direct = Date.parse(trimmed);
	if (!Number.isNaN(direct)) {
		return new Date(direct).toISOString();
	}

	// handle common dd/MM/yyyy or MM/dd/yyyy formats
	const parts = trimmed.split(/[\/\-\.]/);
	if (parts.length === 3) {
		let [a, b, c] = parts.map(part => part.trim());

		// ensure year is four digits (fallback if 2 digits)
		if (c.length === 2) {
			c = Number(c) > 50 ? `19${c}` : `20${c}`;
		}

		const numA = Number(a);
		const numB = Number(b);
		const year = Number(c);

		if (!Number.isNaN(numA) && !Number.isNaN(numB) && !Number.isNaN(year)) {
			const isDayFirst = numA > 12 || (numA <= 12 && numB <= 12 && numA > numB);
			const day = isDayFirst ? numA : numB;
			const month = isDayFirst ? numB : numA;
			const parsed = new Date(year, month - 1, day);
			if (!Number.isNaN(parsed.getTime())) {
				return parsed.toISOString();
			}
		}
	}

	// fallback: store as-is (formatDate will show raw string)
	return trimmed;
}

interface PatientNote {
	id: string;
	content: string;
	createdAt: string;
}

interface PatientAttachment {
	id: string;
	fileName: string;
	sizeLabel: string;
	url?: string;
	createdAt: string;
}

interface PatientHistory {
	id: string;
	text: string;
	createdAt: string;
}

interface PatientExtras {
	notes: PatientNote[];
	attachments: PatientAttachment[];
	history: PatientHistory[];
}

export default function Patients() {
	const [patients, setPatients] = useState<AdminPatientRecord[]>([]);
	const [loading, setLoading] = useState(true);
	const [searchTerm, setSearchTerm] = useState('');
	const [statusFilter, setStatusFilter] = useState<'all' | AdminPatientStatus>('all');
	const [dateFrom, setDateFrom] = useState('');
	const [dateTo,   setDateTo]   = useState('');
	const [doctorFilter, setDoctorFilter] = useState<'all' | string>('all');
	const [selectedPatientIds, setSelectedPatientIds] = useState<Set<string>>(new Set());
	const [isImportOpen, setIsImportOpen] = useState(false);
	const [importFile, setImportFile] = useState<File | null>(null);
	const [importPreview, setImportPreview] = useState<any[]>([]);
	const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
	const [patientExtras, setPatientExtras] = useState<Record<string, PatientExtras>>({});
	const [loadingExtras, setLoadingExtras] = useState<Record<string, boolean>>({});
	const [patientBilling, setPatientBilling] = useState<any[]>([]);
	const [patientAppointments, setPatientAppointments] = useState<any[]>([]);
	const [showReports, setShowReports] = useState(false);
	const [showReportModal, setShowReportModal] = useState(false);
	const [reportModalPatientId, setReportModalPatientId] = useState<string | null>(null);
	const [isDialogOpen, setIsDialogOpen] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [noteContent, setNoteContent] = useState('');
	const [isAddingNote, setIsAddingNote] = useState(false);
	const [showActionsDropdown, setShowActionsDropdown] = useState(false);
	const [showDeletedPatients, setShowDeletedPatients] = useState(false);
	const [deleteConfirmation, setDeleteConfirmation] = useState<{ patient: (AdminPatientRecord & { id?: string }) | null; nameInput: string }>({ patient: null, nameInput: '' });
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [formState, setFormState] = useState<Omit<AdminPatientRecord, 'registeredAt'>>({
		patientId: '',
		name: '',
		dob: '',
		gender: '',
		phone: '',
		email: '',
		address: '',
		complaint: '',
		status: 'pending',
	});
	const [isBackupOpen, setIsBackupOpen] = useState(false);
	const [isRestoreOpen, setIsRestoreOpen] = useState(false);
	const [restoreFile, setRestoreFile] = useState<File | null>(null);
	const [isBackingUp, setIsBackingUp] = useState(false);
	const [isRestoring, setIsRestoring] = useState(false);
	const restoreFileInputRef = useRef<HTMLInputElement>(null);

	// Load patients from Firestore
	useEffect(() => {
		const unsubscribe = onSnapshot(
			collection(db, 'patients'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data() as Record<string, unknown>;
					const created = (data.registeredAt as Timestamp | undefined)?.toDate?.();
					const deleted = (data.deletedAt as Timestamp | undefined)?.toDate?.();
					return {
						id: docSnap.id,
						patientId: data.patientId ? String(data.patientId) : '',
						name: data.name ? String(data.name) : '',
						dob: data.dob ? String(data.dob) : '',
						gender: (data.gender as AdminGenderOption) || '',
						phone: data.phone ? String(data.phone) : '',
						email: data.email ? String(data.email) : '',
						address: data.address ? String(data.address) : '',
						complaint: data.complaint ? String(data.complaint) : '',
						status: (data.status as AdminPatientStatus) ?? 'pending',
						registeredAt: created ? created.toISOString() : (data.registeredAt as string | undefined) || new Date().toISOString(),
						deleted: data.deleted === true,
						deletedAt: deleted ? deleted.toISOString() : (data.deletedAt as string | undefined) || null,
						patientType: data.patientType ? String(data.patientType) : '',
						assignedDoctor: data.assignedDoctor ? String(data.assignedDoctor) : undefined,
						totalSessionsRequired: typeof data.totalSessionsRequired === 'number' ? data.totalSessionsRequired : (data.totalSessionsRequired ? Number(data.totalSessionsRequired) : undefined),
						remainingSessions: typeof data.remainingSessions === 'number' ? data.remainingSessions : (data.remainingSessions ? Number(data.remainingSessions) : undefined),
						feedback: data.feedback ? String(data.feedback) : undefined,
					} as AdminPatientRecord & { id: string; deleted?: boolean; deletedAt?: string | null; patientType?: string; assignedDoctor?: string; totalSessionsRequired?: number; remainingSessions?: number; feedback?: string };
				});
				setPatients(mapped);
				setLoading(false);
			},
			error => {
				console.error('Failed to load patients', error);
				setPatients([]);
				setLoading(false);
			}
		);

		return () => unsubscribe();
	}, []);

	const doctorOptions = useMemo(() => {
		const doctors = new Set<string>();
		patients.forEach(patient => {
			const candidate = (patient as AdminPatientRecord & { assignedDoctor?: string }).assignedDoctor;
			if (candidate) doctors.add(candidate);
		});
		return Array.from(doctors);
	}, [patients]);

	const filteredPatients = useMemo(() => {
		const query = searchTerm.trim().toLowerCase();
		return patients
			.map((patient, index) => ({ patient, index, id: (patient as AdminPatientRecord & { id?: string }).id || '' }))
			.filter(({ patient }) => {
				// Filter by deleted status
				const isDeleted = (patient as any).deleted === true;
				if (showDeletedPatients && !isDeleted) return false;
				if (!showDeletedPatients && isDeleted) return false;

				const matchesSearch =
					!query ||
					(patient.name || '').toLowerCase().includes(query) ||
					(patient.patientId || '').toLowerCase().includes(query) ||
					(patient.phone || '').toLowerCase().includes(query) ||
					(patient.email || '').toLowerCase().includes(query);
				const matchesStatus = statusFilter === 'all' || patient.status === statusFilter;
				const registeredAt = patient.registeredAt ? new Date(patient.registeredAt) : null;
				const matchesDateFrom = dateFrom
					? (registeredAt ? registeredAt >= new Date(`${dateFrom}T00:00:00`) : false)
					: true;
				const matchesDateTo = dateTo
					? (registeredAt ? registeredAt <= new Date(`${dateTo}T23:59:59`) : false)
					: true;
				const assignedDoctor = (patient as AdminPatientRecord & { assignedDoctor?: string }).assignedDoctor || '';
				const matchesDoctor = doctorFilter === 'all' || assignedDoctor === doctorFilter;
				return matchesSearch && matchesStatus && matchesDateFrom && matchesDateTo && matchesDoctor;
			});
	}, [patients, searchTerm, statusFilter, dateFrom, dateTo, doctorFilter, showDeletedPatients]);

	// Presets removed per request

	const selectedPatient = useMemo(() => {
		if (!selectedPatientId) return null;
		return patients.find(patient => (patient as AdminPatientRecord & { id?: string }).id === selectedPatientId) || null;
	}, [patients, selectedPatientId]);

	// Calculate billing totals
	const billingSummary = useMemo(() => {
		const totalAmount = patientBilling.reduce((sum, bill) => sum + (bill.packageAmount || bill.amount || 0), 0);
		const totalPaid = patientBilling.reduce((sum, bill) => sum + (bill.amountPaid || 0), 0);
		const totalPending = totalAmount - totalPaid;
		return { totalAmount, totalPaid, totalPending };
	}, [patientBilling]);

	// Get next session
	const nextSession = useMemo(() => {
		if (!patientAppointments.length) return null;
		const today = new Date().toISOString().split('T')[0];
		const upcoming = patientAppointments
			.filter(apt => apt.status !== 'cancelled' && apt.date >= today)
			.sort((a, b) => {
				const dateA = new Date(a.date + 'T' + (a.time || '00:00'));
				const dateB = new Date(b.date + 'T' + (b.time || '00:00'));
				return dateA.getTime() - dateB.getTime();
			});
		return upcoming.length > 0 ? upcoming[0] : null;
	}, [patientAppointments]);


	useEffect(() => {
		if (selectedPatient) {
			const previous = document.body.style.overflow;
			document.body.style.overflow = 'hidden';
			return () => {
				document.body.style.overflow = previous;
			};
		}
		return;
	}, [selectedPatient]);

	useEffect(() => {
		if (!selectedPatient) return;
		const handler = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				closeProfile();
			}
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [selectedPatient]);

	const closeProfile = () => setSelectedPatientId(null);

	// Load patient billing and appointments
	useEffect(() => {
		if (!selectedPatientId || !selectedPatient) {
			setPatientBilling([]);
			setPatientAppointments([]);
			return;
		}
		
		const patientId = selectedPatient.patientId;
		
		// Load billing records
		const billingUnsubscribe = onSnapshot(
			query(collection(db, 'billing'), where('patientId', '==', patientId)),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data();
					return {
						id: docSnap.id,
						amount: typeof data.amount === 'number' ? data.amount : Number(data.amount) || 0,
						amountPaid: typeof data.amountPaid === 'number' ? data.amountPaid : Number(data.amountPaid) || 0,
						packageAmount: typeof data.packageAmount === 'number' ? data.packageAmount : (data.packageAmount ? Number(data.packageAmount) : null),
						status: data.status || 'Pending',
					};
				});
				setPatientBilling(mapped);
			},
			error => {
				console.error('Failed to load billing', error);
				setPatientBilling([]);
			}
		);

		// Load appointments
		const appointmentsUnsubscribe = onSnapshot(
			query(collection(db, 'appointments'), where('patientId', '==', patientId)),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data();
					return {
						id: docSnap.id,
						date: data.date || '',
						time: data.time || '',
						status: data.status || '',
					};
				});
				setPatientAppointments(mapped);
			},
			error => {
				console.error('Failed to load appointments', error);
				setPatientAppointments([]);
			}
		);

		return () => {
			billingUnsubscribe();
			appointmentsUnsubscribe();
		};
	}, [selectedPatientId, selectedPatient]);

	// Load patient extras (notes, attachments, history)
	useEffect(() => {
		if (!selectedPatientId) return;
		const patientId = selectedPatientId;
		
		if (patientExtras[patientId]) return; // Already loaded
		
		setLoadingExtras(prev => ({ ...prev, [patientId]: true }));
		
		const loadExtras = async () => {
			try {
				const [notesSnap, attachmentsSnap, historySnap] = await Promise.all([
					getDocs(collection(db, 'patients', patientId, 'notes')),
					getDocs(collection(db, 'patients', patientId, 'attachments')),
					getDocs(collection(db, 'patients', patientId, 'history')),
				]);
				
				const notes: PatientNote[] = notesSnap.docs.map(d => {
					const data = d.data();
					const createdAt = (data.createdAt as Timestamp)?.toDate?.()?.toISOString() || data.createdAt || new Date().toISOString();
					return {
						id: d.id,
						content: data.content || '',
						createdAt,
					};
				});
				
				const attachments: PatientAttachment[] = attachmentsSnap.docs.map(d => {
					const data = d.data();
					const createdAt = (data.createdAt as Timestamp)?.toDate?.()?.toISOString() || data.createdAt || new Date().toISOString();
					return {
						id: d.id,
						fileName: data.fileName || '',
						sizeLabel: data.sizeLabel || '',
						url: data.url,
						createdAt,
					};
				});
				
				const history: PatientHistory[] = historySnap.docs.map(d => {
					const data = d.data();
					const createdAt = (data.createdAt as Timestamp)?.toDate?.()?.toISOString() || data.createdAt || new Date().toISOString();
					return {
						id: d.id,
						text: data.text || '',
						createdAt,
					};
				});
				
				setPatientExtras(prev => ({
					...prev,
					[patientId]: { notes, attachments, history },
				}));
			} catch (error) {
				console.error('Failed to load patient extras', error);
				setPatientExtras(prev => ({
					...prev,
					[patientId]: { notes: [], attachments: [], history: [] },
				}));
			} finally {
				setLoadingExtras(prev => ({ ...prev, [patientId]: false }));
			}
		};
		
		loadExtras();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedPatientId]);

	const handleToggleSelection = (patientId: string) => {
		setSelectedPatientIds(prev => {
			const next = new Set(prev);
			if (next.has(patientId)) {
				next.delete(patientId);
			} else {
				next.add(patientId);
			}
			return next;
		});
	};

	const handleSelectAll = () => {
		if (selectedPatientIds.size === filteredPatients.length) {
			setSelectedPatientIds(new Set());
		} else {
			setSelectedPatientIds(new Set(filteredPatients.map(({ id }) => id)));
		}
	};

	const handleImportClick = () => {
		setIsImportOpen(true);
	};

	// download template CSV (headers exactly as requested)
	function downloadTemplate() {
		const headers = ['Name', 'Dob', 'Gender', 'Phoneno', 'Email', 'Address', 'DoctorName', 'RegisteredAt', 'Complaint'];
		const csv = headers.join(',') + '\n';
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'patients_template.csv';
		a.click();
		URL.revokeObjectURL(url);
	}

	const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (!file) return;
		
		setImportFile(file);
		Papa.parse(file, {
			header: true,
			complete: (results: { data: any[] }) => {
				setImportPreview((results.data || []).slice(0, 50)); // Preview first 50 rows
			},
			error: (error: Error) => {
				alert(`Failed to parse CSV: ${error.message}`);
			},
		});
	};

	const handleImportConfirm = async () => {
		if (!importFile) return;
		
		try {
			Papa.parse(importFile, {
				header: true,
				complete: async (results: { data: any[] }) => {
					let batch = writeBatch(db);
					let count = 0;
					
					for (const rawRow of (results.data as any[]) || []) {
						// build case-insensitive map of row keys
						const row: Record<string, string> = {};
						for (const k of Object.keys(rawRow || {})) {
							row[k.toLowerCase().trim()] = rawRow[k];
						}

						// read template headers or common aliases
						const name = (row['name'] || row['fullname'] || row['full name'] || row['fullname'.toLowerCase()] || '').trim();
						const dob = (row['dob'] || row['dateofbirth'] || row['date_of_birth'] || '').trim();
						const gender = (row['gender'] || '').trim();
						const phoneno = (row['phoneno'] || row['phone'] || '').trim();
						const email = (row['email'] || '').trim();
						const address = (row['address'] || '').trim();
						const doctorName = (row['doctorname'] || row['doctor'] || '').trim();
						const registeredAtRaw = (row['registeredat'] || row['registered_at'] || '').trim();
						const complaint = (row['complaint'] || row['notes'] || '').trim();

						// Basic skip rules (same as original)
						if (!name) continue;
						if (!email && !phoneno) continue;

						const patientData = {
							patientId: row['patientid'] || `CSS${Date.now()}${Math.random().toString(36).substr(2, 9)}`,
							name: String(name),
							email: String(email),
							phone: String(phoneno),
							dob: normalizeDateInput(dob),
							address: String(address),
							gender: String(gender) as AdminGenderOption,
							complaint: String(complaint),
							status: 'pending' as AdminPatientStatus,
							// store registeredAt as string (ISO or raw CSV value)
							registeredAt: registeredAtRaw || new Date().toISOString(),
							assignedDoctor: String(doctorName) || undefined,
						};
						
						const docRef = doc(collection(db, 'patients'));
						batch.set(docRef, patientData);
						count++;
						
						if (count % 500 === 0) {
							await batch.commit();
							batch = writeBatch(db);
						}
					}
					
					// commit any remaining
					try {
						await batch.commit();
					} catch (err) {
						if (count > 0) console.error('Final batch commit failed', err);
					}
					
					alert(`Successfully imported ${count} patients.`);
					setIsImportOpen(false);
					setImportFile(null);
					setImportPreview([]);
				},
				error: (err: Error) => {
					console.error('Parsing error', err);
					alert('Failed to parse CSV. Please check the file.');
				}
			});
		} catch (error) {
			console.error('Import failed', error);
			alert('Failed to import patients. Please try again.');
		}
	};

	const handleBulkDeactivate = async () => {
		if (selectedPatientIds.size === 0) {
			alert('Please select at least one patient to deactivate.');
			return;
		}
		
		const confirmed = window.confirm(
			`Are you sure you want to deactivate ${selectedPatientIds.size} patient(s)?`
		);
		if (!confirmed) return;
		
		try {
			const batch = writeBatch(db);
			for (const patientId of selectedPatientIds) {
				const patientRef = doc(db, 'patients', patientId);
				batch.update(patientRef, { status: 'cancelled' });
			}
			await batch.commit();
			alert(`Successfully deactivated ${selectedPatientIds.size} patient(s).`);
			setSelectedPatientIds(new Set());
		} catch (error) {
			console.error('Bulk deactivate failed', error);
			alert('Failed to deactivate patients. Please try again.');
		}
	};

	const handleAddNote = async () => {
		if (!selectedPatientId || !noteContent.trim()) return;
		
		setIsAddingNote(true);
		try {
			const noteData = {
				content: noteContent.trim(),
				createdAt: serverTimestamp(),
			};
			
			await addDoc(collection(db, 'patients', selectedPatientId, 'notes'), noteData);
			
			// Also add to history
			await addDoc(collection(db, 'patients', selectedPatientId, 'history'), {
				text: 'Note added',
				createdAt: serverTimestamp(),
			});
			
			// Clear cached extras to trigger reload
			setPatientExtras(prev => {
				const next = { ...prev };
				delete next[selectedPatientId];
				return next;
			});
			
			setNoteContent('');
			alert('Note added successfully.');
		} catch (error) {
			console.error('Failed to add note', error);
			alert('Failed to add note. Please try again.');
		} finally {
			setIsAddingNote(false);
		}
	};

	const handleUploadAttachment = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (!file || !selectedPatientId) return;
		
		try {
			const attachmentData = {
				fileName: file.name,
				sizeLabel: `${(file.size / 1024).toFixed(2)} KB`,
				createdAt: serverTimestamp(),
			};
			
			await addDoc(collection(db, 'patients', selectedPatientId, 'attachments'), attachmentData);
			
			// Also add to history
			await addDoc(collection(db, 'patients', selectedPatientId, 'history'), {
				text: `Attachment uploaded: ${file.name}`,
				createdAt: serverTimestamp(),
			});
			
			// Clear cached extras to trigger reload
			setPatientExtras(prev => {
				const next = { ...prev };
				delete next[selectedPatientId];
				return next;
			});
			
			alert('Attachment uploaded successfully.');
		} catch (error) {
			console.error('Failed to upload attachment', error);
			alert('Failed to upload attachment. Please try again.');
		}
	};

	const handleLogActivity = async () => {
		if (!selectedPatientId) return;
		
		const activity = prompt('Enter activity description:');
		if (!activity?.trim()) return;
		
		try {
			await addDoc(collection(db, 'patients', selectedPatientId, 'history'), {
				text: activity.trim(),
				createdAt: serverTimestamp(),
			});
			
			// Clear cached extras to trigger reload
			setPatientExtras(prev => {
				const next = { ...prev };
				delete next[selectedPatientId];
				return next;
			});
			
			alert('Activity logged successfully.');
		} catch (error) {
			console.error('Failed to log activity', error);
			alert('Failed to log activity. Please try again.');
		}
	};

	const handleProfileAction = (action: string) => () => {
		if (action === 'Schedule follow-up' || action === 'Share report' || action === 'Transfer patient') {
			alert(`${action} – functionality coming soon.`);
		}
	};

	const openDialogForCreate = () => {
		setEditingId(null);
		setFormState({
			patientId: '',
			name: '',
			dob: '',
			gender: '',
			phone: '',
			email: '',
			address: '',
			complaint: '',
			status: 'pending',
		});
		setIsDialogOpen(true);
	};

	const openDialogForEdit = (id: string) => {
		const patient = patients.find(p => (p as AdminPatientRecord & { id?: string }).id === id);
		if (!patient) return;
		setEditingId(id);
		setFormState({
			patientId: patient.patientId,
			name: patient.name,
			dob: patient.dob,
			gender: patient.gender,
			phone: patient.phone,
			email: patient.email,
			address: patient.address,
			complaint: patient.complaint,
			status: patient.status,
		});
		setIsDialogOpen(true);
	};

	const closeDialog = () => {
		setIsDialogOpen(false);
		setEditingId(null);
	};

	const handleDeleteClick = (id: string) => {
		const patient = patients.find(p => (p as AdminPatientRecord & { id?: string }).id === id);
		if (!patient) return;
		setDeleteConfirmation({ patient: patient as AdminPatientRecord & { id: string }, nameInput: '' });
	};

	const handleDeleteConfirm = async () => {
		if (!deleteConfirmation.patient || !deleteConfirmation.patient.id) return;

		const patient = deleteConfirmation.patient;
		const enteredName = deleteConfirmation.nameInput.trim();
		const correctName = patient.name.trim();

		// Check if the entered name matches exactly (case-insensitive)
		if (enteredName.toLowerCase() !== correctName.toLowerCase()) {
			return;
		}

		setDeleteConfirmation({ patient: null, nameInput: '' });

		try {
			// First, delete all appointments for this patient
			const appointmentsQuery = query(
				collection(db, 'appointments'),
				where('patientId', '==', patient.patientId)
			);
			const appointmentsSnapshot = await getDocs(appointmentsQuery);
			
			if (appointmentsSnapshot.docs.length > 0) {
				// Use batch write for better performance and atomicity
				const batch = writeBatch(db);
				appointmentsSnapshot.docs.forEach(appointmentDoc => {
					batch.delete(appointmentDoc.ref);
				});
				await batch.commit();
				console.log(`Deleted ${appointmentsSnapshot.docs.length} appointment(s) for patient ${patient.patientId}`);
			}

			// Soft delete the patient (set deleted flag instead of actually deleting)
			await updateDoc(doc(db, 'patients', patient.id), {
				deleted: true,
				deletedAt: serverTimestamp(),
				status: 'cancelled',
			});

			// Show success message
			const appointmentCount = appointmentsSnapshot.docs.length;
			const appointmentText = appointmentCount === 1 ? 'appointment' : 'appointments';
			alert(
				`✅ Patient "${patient.name}" (ID: ${patient.patientId}) has been successfully deleted.\n\n` +
				`${appointmentCount > 0 ? `${appointmentCount} associated ${appointmentText} ${appointmentCount === 1 ? 'was' : 'were'} also deleted. ` : ''}` +
				`The patient has been moved to past patients.`
			);

			// Automatically switch to past patients view
			setShowDeletedPatients(true);
		} catch (error) {
			console.error('Failed to delete patient', error);
			alert('❌ Failed to delete patient. Please try again.');
		}
	};

	const handleDeleteCancel = () => {
		setDeleteConfirmation({ patient: null, nameInput: '' });
	};

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();

		const trimmedId = formState.patientId.trim();
		const trimmedName = formState.name.trim();
		const trimmedPhone = formState.phone.trim();
		const trimmedEmail = formState.email.trim();

		if (!trimmedId || !trimmedName) {
			alert('Patient ID and name are required.');
			return;
		}

		// Check for duplicate patient ID
		const duplicateId = patients.some(record => {
			if (editingId && (record as AdminPatientRecord & { id?: string }).id === editingId) return false;
			return record.patientId.toLowerCase() === trimmedId.toLowerCase();
		});
		if (duplicateId) {
			alert('Another patient already uses this ID.');
			return;
		}

		try {
			const patientData = {
				patientId: trimmedId,
				name: trimmedName,
				dob: normalizeDateInput(formState.dob) || '',
				gender: formState.gender || '',
				phone: trimmedPhone || '',
				email: trimmedEmail || '',
				address: formState.address || '',
				complaint: formState.complaint || '',
				status: formState.status,
				registeredAt: editingId ? undefined : serverTimestamp(),
			};

			console.log('Saving patient...', { editingId, patientData });

			if (editingId) {
				// Update existing patient
				await updateDoc(doc(db, 'patients', editingId), patientData);
				console.log('Patient updated successfully');
			} else {
				// Create new patient
				const docRef = await addDoc(collection(db, 'patients'), patientData);
				console.log('Patient created successfully with document ID:', docRef.id);

				// Send registration email if email is provided
				let emailSent = false;
				if (trimmedEmail) {
					try {
						const emailResult = await sendEmailNotification({
							to: trimmedEmail,
							subject: `Welcome to Centre For Sports Science - Patient ID: ${trimmedId}`,
							template: 'patient-registered',
							data: {
								patientName: trimmedName,
								patientEmail: trimmedEmail,
								patientId: trimmedId,
							},
						});
						emailSent = emailResult.success;
					} catch (emailError) {
						// Log error but don't fail registration
						console.error('Failed to send registration email:', emailError);
					}
				}

				// Send registration SMS if phone is provided
				let smsSent = false;
				if (trimmedPhone && isValidPhoneNumber(trimmedPhone)) {
					try {
						const smsResult = await sendSMSNotification({
							to: trimmedPhone,
							template: 'patient-registered',
							data: {
								patientName: trimmedName,
								patientPhone: trimmedPhone,
								patientId: trimmedId,
							},
						});
						smsSent = smsResult.success;
					} catch (smsError) {
						// Log error but don't fail registration
						console.error('Failed to send registration SMS:', smsError);
					}
				}

				// Build confirmation message
				const confirmations = [];
				if (emailSent) confirmations.push('email');
				if (smsSent) confirmations.push('SMS');
				const confirmationText = confirmations.length > 0 
					? ` Confirmation sent via ${confirmations.join(' and ')}.`
					: '';

				// Show success message with confirmation details
				setTimeout(() => {
					alert(`Patient "${trimmedName}" (ID: ${trimmedId}) has been added successfully!${confirmationText}`);
				}, 100);
			}

			// Close dialog and reset form
			setIsDialogOpen(false);
			setEditingId(null);
			setFormState({
				patientId: '',
				name: '',
				dob: '',
				gender: '',
				phone: '',
				email: '',
				address: '',
				complaint: '',
				status: 'pending',
			});
		} catch (error) {
			console.error('Failed to save patient', error);
			const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
			console.error('Error details:', {
				message: errorMessage,
				error,
				formData: formState,
				editingId,
			});
			alert(`Failed to save patient: ${errorMessage}. Please check the console for details.`);
		}
	};

	const handleExportCsv = () => {
		if (!patients.length) {
			alert('No patients found to export.');
			return;
		}

		const headers = [
			'patientId',
			'name',
			'dob',
			'gender',
			'phone',
			'email',
			'address',
			'complaint',
			'status',
			'registeredAt',
		] as const;

		const rows = patients.map(patient =>
			headers
				.map(key => {
					const value = patient[key] ?? '';
					return `"${String(value).replace(/"/g, '""')}"`;
				})
				.join(',')
		);

		const csvContent = [headers.join(','), ...rows].join('\n');
		const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);

		const tempLink = document.createElement('a');
		tempLink.href = url;
		tempLink.setAttribute('download', `patients-${new Date().toISOString().slice(0, 10)}.csv`);
		document.body.appendChild(tempLink);
		tempLink.click();
		document.body.removeChild(tempLink);
		URL.revokeObjectURL(url);
	};

	// Backup all patient data as CSV
	const handleBackup = async () => {
		if (!patients.length) {
			alert('No patients found to backup.');
			return;
		}

		setIsBackingUp(true);
		try {
			const headers = [
				'id',
				'patientId',
				'name',
				'dob',
				'gender',
				'phone',
				'email',
				'address',
				'complaint',
				'status',
				'registeredAt',
				'assignedDoctor',
				'noteCount',
				'attachmentCount',
				'historyCount',
				'notesPreview',
				'historyPreview',
			] as const;

			const rows: string[] = [];

			for (const patient of patients) {
				const patientId = (patient as AdminPatientRecord & { id?: string }).id;
				if (!patientId) continue;

				try {
					const [notesSnap, attachmentsSnap, historySnap] = await Promise.all([
						getDocs(collection(db, 'patients', patientId, 'notes')),
						getDocs(collection(db, 'patients', patientId, 'attachments')),
						getDocs(collection(db, 'patients', patientId, 'history')),
					]);

					const notes = notesSnap.docs.map(d => (d.data().content || '').replace(/[\r\n]+/g, ' ').trim());
					const attachments = attachmentsSnap.docs;
					const history = historySnap.docs.map(d => (d.data().text || '').replace(/[\r\n]+/g, ' ').trim());

					const safe = (value: unknown) => {
						const str = value ?? '';
						return `"${String(str).replace(/"/g, '""')}"`;
					};

					rows.push(
						headers
							.map(key => {
								switch (key) {
									case 'id':
										return safe(patientId);
									case 'assignedDoctor':
										return safe((patient as { assignedDoctor?: string }).assignedDoctor ?? '');
									case 'noteCount':
										return notes.length.toString();
									case 'attachmentCount':
										return attachments.length.toString();
									case 'historyCount':
										return history.length.toString();
									case 'notesPreview':
										return safe(notes.slice(0, 3).join(' | '));
									case 'historyPreview':
										return safe(history.slice(0, 3).join(' | '));
									default:
										return safe(patient[key] ?? '');
								}
							})
							.join(',')
					);
				} catch (error) {
					console.error(`Failed to include patient ${patientId} in backup`, error);
				}
			}

			const csvContent = [headers.join(','), ...rows].join('\n');
			const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
			const url = URL.createObjectURL(blob);

			const link = document.createElement('a');
			link.href = url;
			link.setAttribute('download', `patients-backup-${new Date().toISOString().slice(0, 10)}.csv`);
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);

			alert(`Backup created for ${rows.length} patient(s).`);
			setIsBackupOpen(false);
		} catch (error) {
			console.error('Backup failed', error);
			alert('Failed to create CSV backup. Please try again.');
		} finally {
			setIsBackingUp(false);
		}
	};

	// Restore patient data from backup
	const handleRestoreFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (!file) return;

		if (!file.name.endsWith('.json')) {
			alert('Please select a valid JSON backup file.');
			return;
		}

		setRestoreFile(file);
	};

	const handleRestore = async () => {
		if (!restoreFile) {
			alert('Please select a backup file to restore.');
			return;
		}

		const confirmed = window.confirm(
			'WARNING: Restoring will overwrite existing patient data. This action cannot be undone. Are you sure you want to continue?'
		);
		if (!confirmed) return;

		setIsRestoring(true);
		try {
			const fileText = await restoreFile.text();
			const backupData = JSON.parse(fileText);

			if (!backupData.patients || !Array.isArray(backupData.patients)) {
				throw new Error('Invalid backup file format.');
			}

			let restoredCount = 0;
			let errorCount = 0;

			// Process patients in batches
			const batchSize = 100;
			for (let i = 0; i < backupData.patients.length; i += batchSize) {
				const batch = writeBatch(db);
				const patientBatch = backupData.patients.slice(i, i + batchSize);

				for (const patientBackup of patientBatch) {
					try {
						const patientRef = doc(db, 'patients', patientBackup.id);
						batch.set(patientRef, {
							...patientBackup.data,
							registeredAt: patientBackup.data.registeredAt || serverTimestamp(),
						}, { merge: true });

						restoredCount++;
					} catch (error) {
						console.error(`Failed to restore patient ${patientBackup.id}:`, error);
						errorCount++;
					}
				}

				await batch.commit();
			}

			// Restore subcollections (notes, attachments, history)
			for (const patientBackup of backupData.patients) {
				try {
					const patientId = patientBackup.id;

					// Restore notes
					if (patientBackup.notes && patientBackup.notes.length > 0) {
						const notesBatch = writeBatch(db);
						for (const note of patientBackup.notes) {
							const noteRef = doc(collection(db, 'patients', patientId, 'notes'), note.id);
							notesBatch.set(noteRef, {
								content: note.content,
								createdAt: note.createdAt ? new Date(note.createdAt) : serverTimestamp(),
							}, { merge: true });
						}
						await notesBatch.commit();
					}

					// Restore attachments
					if (patientBackup.attachments && patientBackup.attachments.length > 0) {
						const attachmentsBatch = writeBatch(db);
						for (const attachment of patientBackup.attachments) {
							const attachmentRef = doc(collection(db, 'patients', patientId, 'attachments'), attachment.id);
							attachmentsBatch.set(attachmentRef, {
								fileName: attachment.fileName,
								sizeLabel: attachment.sizeLabel,
								url: attachment.url,
								createdAt: attachment.createdAt ? new Date(attachment.createdAt) : serverTimestamp(),
							}, { merge: true });
						}
						await attachmentsBatch.commit();
					}

					// Restore history
					if (patientBackup.history && patientBackup.history.length > 0) {
						const historyBatch = writeBatch(db);
						for (const historyItem of patientBackup.history) {
							const historyRef = doc(collection(db, 'patients', patientId, 'history'), historyItem.id);
							historyBatch.set(historyRef, {
								text: historyItem.text,
								createdAt: historyItem.createdAt ? new Date(historyItem.createdAt) : serverTimestamp(),
							}, { merge: true });
						}
						await historyBatch.commit();
					}
				} catch (error) {
					console.error(`Failed to restore subcollections for patient ${patientBackup.id}:`, error);
					errorCount++;
				}
			}

			alert(
				`Restore completed. ${restoredCount} patient(s) restored successfully.${errorCount > 0 ? ` ${errorCount} error(s) occurred.` : ''}`
			);
			setIsRestoreOpen(false);
			setRestoreFile(null);
			if (restoreFileInputRef.current) {
				restoreFileInputRef.current.value = '';
			}
		} catch (error) {
			console.error('Restore failed', error);
			alert(`Failed to restore backup: ${error instanceof Error ? error.message : 'Unknown error'}. Please check the backup file and try again.`);
		} finally {
			setIsRestoring(false);
		}
	};

	return (
		<div className="min-h-svh bg-slate-50 px-6 py-10">
			<div className="mx-auto max-w-6xl space-y-10">
				<PageHeader
					title="Patient Management"
				/>

				<div className="border-t border-slate-200" />

				<section>
					<div className="card-container">
						<div className="flex w-full flex-col gap-3 md:flex-row md:items-end md:gap-4">
							<div className="w-full md:w-[360px]">
								<label className="block text-sm font-medium text-slate-700">Search patients</label>
								<div className="relative mt-2">
									<i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400" aria-hidden="true" />
									<input
										type="search"
										value={searchTerm}
										onChange={event => setSearchTerm(event.target.value)}
										className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm text-slate-700 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
										placeholder="Filter by name, ID, or phone"
									/>
								</div>
							</div>
							<div className="w-full md:w-40">
								<label className="block text-sm font-medium text-slate-700">Status filter</label>
								<select
									value={statusFilter}
									onChange={event => setStatusFilter(event.target.value as 'all' | AdminPatientStatus)}
									className="select-base"
								>
									{statusFilterOptions.map(option => (
										<option key={option.value} value={option.value}>
											{option.label}
										</option>
									))}
								</select>
							</div>
						</div>

						{/* Registered date filter */}
						<div className="mt-4">
							<label className="block text-sm font-medium text-slate-700">Registered</label>
							<div className="mt-2 flex items-center gap-2">
								<input
									type="date"
									value={dateFrom}
									onChange={e => setDateFrom(e.target.value)}
									className="w-full max-w-[180px] rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
								/>
								<span className="text-xs text-slate-500">to</span>
								<input
									type="date"
									value={dateTo}
									onChange={e => setDateTo(e.target.value)}
									className="w-full max-w-[180px] rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
								/>
							</div>
						</div>

						{/* Doctor filter */}
						<div className="mt-4">
								<label className="block text-sm font-medium text-slate-700">Assigned doctor</label>
								<select
									value={doctorFilter}
									onChange={event => setDoctorFilter(event.target.value as 'all' | string)}
									className="select-base mt-2 w-full md:w-40 lg:w-48"
								>
									<option value="all">All doctors</option>
									{doctorOptions.map(option => (
										<option key={option} value={option}>
											{option}
										</option>
									))}
								</select>
							</div>
						</div>

						<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end sm:gap-4 mt-4">
							{/* Actions Dropdown */}
							<div className="relative actions-dropdown-container">
							<button
								type="button"
									onClick={() => setShowActionsDropdown(!showActionsDropdown)}
									className="inline-flex items-center rounded-lg bg-gradient-to-r from-blue-900 via-blue-800 to-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-900/40 transition-all hover:from-blue-800 hover:via-blue-700 hover:to-blue-600 hover:shadow-xl hover:shadow-blue-900/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
							>
									<i className="fas fa-ellipsis-v mr-2 text-sm" aria-hidden="true" />
									Actions
									<i className={`fas fa-chevron-${showActionsDropdown ? 'up' : 'down'} ml-2 text-xs`} aria-hidden="true" />
							</button>
								
								{showActionsDropdown && (
									<>
										<div 
											className="fixed inset-0 z-10" 
											onClick={() => setShowActionsDropdown(false)}
											aria-hidden="true"
										/>
										<div className="absolute right-0 z-20 mt-2 w-56 origin-top-right rounded-xl bg-white shadow-xl ring-1 ring-black ring-opacity-5 border border-blue-200">
											<div className="py-1" role="menu" aria-orientation="vertical">
												{!showDeletedPatients && (
													<button
														type="button"
														onClick={() => {
															handleBulkDeactivate();
															setShowActionsDropdown(false);
														}}
														className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-amber-50 hover:text-amber-700 transition-colors"
														role="menuitem"
													>
														<i className="fas fa-user-slash text-amber-600" aria-hidden="true" />
														<span className="font-medium">Bulk Deactivate</span>
													</button>
												)}
							<button
								type="button"
													onClick={() => {
														handleExportCsv();
														setShowActionsDropdown(false);
													}}
													disabled={filteredPatients.length === 0}
													className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-slate-700"
													role="menuitem"
												>
													<i className="fas fa-file-csv text-blue-600" aria-hidden="true" />
													<span className="font-medium">Export CSV</span>
							</button>
							<button
								type="button"
													onClick={() => {
														setShowDeletedPatients(!showDeletedPatients);
														setShowActionsDropdown(false);
													}}
													className={`flex w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
														showDeletedPatients
															? 'bg-amber-50 text-amber-700'
															: 'text-slate-700 hover:bg-amber-50 hover:text-amber-700'
													}`}
													role="menuitem"
												>
													<i className={`fas ${showDeletedPatients ? 'fa-eye-slash' : 'fa-history'} text-amber-600`} aria-hidden="true" />
													<span className="font-medium">
														{showDeletedPatients ? 'Show Active Patients' : 'View Past Patients'}
													</span>
							</button>
											</div>
										</div>
									</>
								)}
							</div>
						</div>
				</section>

				<section className="mx-auto mt-8 max-w-6xl">
					<div className="section-card">
						{loading ? (
							<div className="py-12 text-center text-sm text-slate-500">
								<div className="loading-spinner h-10 w-10" aria-hidden="true" />
								<span className="ml-3 align-middle">Loading patients…</span>
							</div>
						) : filteredPatients.length === 0 ? (
							<div className="py-12 text-center text-sm text-slate-500">
								<p className="font-medium text-slate-700">No patients match your filters.</p>
								<p className="mt-1">Try adjusting the search or add a new profile to keep testing data fresh.</p>
							</div>
						) : (
							<div className="w-full">
								<table className="w-full divide-y divide-slate-200 text-left text-sm text-slate-700 table-fixed">
									<thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
										<tr>
											<th className="w-12 px-2 py-3 font-semibold">
												<input
													type="checkbox"
													checked={selectedPatientIds.size === filteredPatients.length && filteredPatients.length > 0}
													onChange={handleSelectAll}
													className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
												/>
											</th>
											<th className="w-10 px-2 py-3 font-semibold">#</th>
											<th className="w-32 px-2 py-3 font-semibold">Patient ID</th>
											<th className="w-28 px-2 py-3 font-semibold">Name</th>
											<th className="w-24 px-2 py-3 font-semibold">Department</th>
											<th className="w-20 px-2 py-3 font-semibold">Gender</th>
											<th className="w-28 px-2 py-3 font-semibold">Phone</th>
											<th className="w-32 px-2 py-3 font-semibold">Assigned Therapist</th>
											<th className="w-24 px-2 py-3 font-semibold">Status</th>
											<th className="w-36 px-2 py-3 font-semibold">Registered</th>
											<th className="w-24 px-2 py-3 font-semibold text-center">Actions</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-slate-100">
										{filteredPatients.map(({ patient, index, id }, row) => (
											<tr key={`${patient.patientId}-${id}`}>
												<td className="px-2 py-4">
													<input
														type="checkbox"
														checked={selectedPatientIds.has(id)}
														onChange={() => handleToggleSelection(id)}
														className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
													/>
												</td>
												<td className="px-2 py-4 text-xs text-slate-500">{row + 1}</td>
												<td className="px-2 py-4 text-xs font-semibold text-slate-800" title={patient.patientId || '—'}>
													{formatPatientIdShort(patient.patientId, 8)}
												</td>
												<td className="px-2 py-4 text-xs text-slate-700">
													<div className="truncate" title={patient.name || 'Unnamed patient'}>
														{patient.name || 'Unnamed patient'}
													</div>
													{(patient as any).deleted && (
														<span className="mt-1 inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
															Past
														</span>
													)}
												</td>
												<td className="px-2 py-4 text-xs text-slate-600 truncate">
													{((patient as any).patientType || '').toUpperCase() || '—'}
												</td>
												<td className="px-2 py-4 text-xs text-slate-600">{patient.gender || '—'}</td>
												<td className="px-2 py-4 text-xs text-slate-600 truncate" title={patient.phone || '—'}>
													{patient.phone || '—'}
												</td>
												<td className="px-2 py-4 text-xs text-slate-600 truncate" title={(patient as any).assignedDoctor || '—'}>
													{(patient as any).assignedDoctor || '—'}
												</td>
												<td className="px-2 py-4">
													<span
														className={[
															'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
															patient.status === 'completed'
															? 'bg-emerald-100 text-emerald-700'
															: patient.status === 'ongoing'
																? 'bg-sky-100 text-sky-700'
																: patient.status === 'cancelled'
																	? 'bg-rose-100 text-rose-600'
																	: 'bg-amber-100 text-amber-700',
														].join(' ')}
													>
														{patient.status.charAt(0).toUpperCase() + patient.status.slice(1)}
													</span>
												</td>
												<td className="px-2 py-4 text-[10px] text-slate-500 truncate" title={showDeletedPatients && (patient as any).deletedAt 
													? `Removed: ${formatDateTime((patient as any).deletedAt)}`
													: formatDateTime(patient.registeredAt)}>
													{showDeletedPatients && (patient as any).deletedAt 
														? `Removed: ${formatDateTime((patient as any).deletedAt)}`
														: formatDateTime(patient.registeredAt)}
												</td>
												<td className="px-2 py-4 text-center">
													<div className="inline-flex items-center gap-1">
														<button
															type="button"
															onClick={() => setSelectedPatientId(id)}
															className="inline-flex items-center justify-center rounded-full border border-sky-200 px-1.5 py-1 text-sky-700 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800 focus-visible:border-sky-300 focus-visible:text-sky-800 focus-visible:outline-none"
															title="View profile"
														>
															<i className="fas fa-user text-[10px]" aria-hidden="true" />
														</button>
														{!showDeletedPatients && !(patient as any).deleted && (
															<button
																type="button"
																onClick={() => handleDeleteClick(id)}
																className="inline-flex items-center justify-center rounded-full border border-rose-200 px-1.5 py-1 text-rose-600 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 focus-visible:border-rose-300 focus-visible:text-rose-700 focus-visible:outline-none"
																title="Delete"
															>
																<i className="fas fa-trash text-[10px]" aria-hidden="true" />
															</button>
														)}
													</div>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</div>
				</section>

				{/* Selected patient profile modal */}
				{selectedPatient && (
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6"
						onClick={closeProfile}
						role="dialog"
						aria-modal="true"
					>
						<div
							className="w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
							onClick={event => event.stopPropagation()}
						>
							<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4 sticky top-0 bg-white z-10">
								<div>
									<h2 className="text-lg font-semibold text-slate-900">Patient profile</h2>
									<p className="text-xs text-slate-500">ID: {(selectedPatient as any).patientId || '—'}</p>
								</div>
							</header>

							<div className="grid max-h-[calc(90vh-64px)] gap-4 overflow-y-auto px-6 py-6 lg:grid-cols-[1.2fr,0.8fr]">
								<section className="space-y-4">
									<div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
										<h3 className="text-sm font-semibold text-slate-800">Personal details</h3>
										<dl className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
											<div>
												<dt className="font-semibold text-slate-500">Name</dt>
												<dd>{selectedPatient.name || '—'}</dd>
											</div>
											<div>
												<dt className="font-semibold text-slate-500">Patient ID</dt>
												<dd>{selectedPatient.patientId || '—'}</dd>
											</div>
											<div>
												<dt className="font-semibold text-slate-500">Date of birth</dt>
												<dd>{formatDate(selectedPatient.dob)}</dd>
											</div>
											<div>
												<dt className="font-semibold text-slate-500">Gender</dt>
												<dd>{selectedPatient.gender || '—'}</dd>
											</div>
											<div>
												<dt className="font-semibold text-slate-500">Phone</dt>
												<dd>{selectedPatient.phone || '—'}</dd>
											</div>
											<div>
												<dt className="font-semibold text-slate-500">Email</dt>
												<dd>{selectedPatient.email || '—'}</dd>
											</div>
											<div className="sm:col-span-2">
												<dt className="font-semibold text-slate-500">Address</dt>
												<dd>{selectedPatient.address || '—'}</dd>
											</div>
										</dl>
									</div>

								</section>

								{/* Sidebar */}
								<aside className="space-y-4">
									{/* Billing Info */}
									<div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
										<h3 className="text-sm font-semibold text-slate-800">Billing</h3>
										<dl className="mt-3 space-y-2 text-xs">
											<div className="flex justify-between">
												<dt className="font-semibold text-slate-500">Total Amount</dt>
												<dd className="font-semibold text-slate-900">₹{billingSummary.totalAmount.toLocaleString()}</dd>
											</div>
											<div className="flex justify-between">
												<dt className="font-semibold text-slate-500">Amount Paid</dt>
												<dd className="font-semibold text-emerald-700">₹{billingSummary.totalPaid.toLocaleString()}</dd>
											</div>
											<div className="flex justify-between">
												<dt className="font-semibold text-slate-500">Amount Pending</dt>
												<dd className="font-semibold text-amber-700">₹{billingSummary.totalPending.toLocaleString()}</dd>
											</div>
										</dl>
									</div>

									{/* Sessions */}
									<div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
										<h3 className="text-sm font-semibold text-slate-800 mb-3">Sessions</h3>
										<dl className="space-y-2 text-xs">
											<div className="flex justify-between">
												<dt className="font-semibold text-slate-500">Total Sessions</dt>
												<dd className="font-semibold text-slate-900">
													{(selectedPatient as any)?.totalSessionsRequired || 0}
												</dd>
											</div>
											<div className="flex justify-between">
												<dt className="font-semibold text-slate-500">Completed</dt>
												<dd className="font-semibold text-emerald-700">
													{(() => {
														const total = (selectedPatient as any)?.totalSessionsRequired || 0;
														const remaining = (selectedPatient as any)?.remainingSessions || 0;
														return Math.max(0, total - remaining);
													})()}
												</dd>
											</div>
											<div className="flex justify-between">
												<dt className="font-semibold text-slate-500">Remaining</dt>
												<dd className="font-semibold text-amber-700">
													{(selectedPatient as any)?.remainingSessions || 0}
												</dd>
											</div>
											<div className="pt-2 border-t border-slate-200">
												<dt className="font-semibold text-slate-500 mb-1">Next Session</dt>
												{nextSession ? (
													<dd className="text-slate-600">
														<p className="font-semibold text-slate-900">{formatDate(nextSession.date)}</p>
														{nextSession.time && (
															<p className="mt-1 text-slate-500">{nextSession.time}</p>
														)}
													</dd>
												) : (
													<dd className="text-slate-500">No upcoming sessions</dd>
												)}
											</div>
										</dl>
									</div>

									{/* Feedback */}
									<div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
										<h3 className="text-sm font-semibold text-slate-800">Patient Feedback</h3>
										<p className="mt-3 text-xs text-slate-500">
											{(selectedPatient as any)?.feedback || 'No feedback available'}
										</p>
									</div>

									{/* Reports */}
									<div className="rounded-xl border border-blue-200 bg-white p-4 shadow-sm">
										<h3 className="text-sm font-semibold text-slate-800 mb-3">Reports</h3>
										<button
											type="button"
											onClick={() => {
												setShowReportModal(true);
												setReportModalPatientId(selectedPatient?.patientId || null);
											}}
											className="w-full inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-3 text-sm font-semibold text-white transition hover:from-blue-700 hover:to-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 shadow-sm"
										>
											<i className="fas fa-file-medical mr-2" aria-hidden="true" />
											View Reports
										</button>
									</div>
								</aside>
							</div>
						</div>
					</div>
				)}

				{/* Create / Edit dialog */}
				{isDialogOpen && (
					<div
						role="dialog"
						aria-modal="true"
						className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6"
					>
						<div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
							<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
								<h2 className="text-lg font-semibold text-slate-900">
									{editingId !== null ? 'Edit Patient' : 'Add Patient'}
								</h2>
								<button
									type="button"
									onClick={closeDialog}
									className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:bg-slate-100 focus-visible:text-slate-600 focus-visible:outline-none"
									aria-label="Close dialog"
								>
									<i className="fas fa-times" aria-hidden="true" />
								</button>
							</header>

							<form onSubmit={handleSubmit} className="grid gap-4 px-6 py-6 sm:grid-cols-2">
								<div>
									<label className="block text-sm font-medium text-slate-700">Patient ID *</label>
									<input
										type="text"
										value={formState.patientId}
										onChange={event =>
											setFormState(current => ({ ...current, patientId: event.target.value }))
										}
										className="input-base"
										required
									/>
								</div>
								<div>
									<label className="block text-sm font-medium text-slate-700">Full name *</label>
									<input
										type="text"
										value={formState.name}
										onChange={event =>
											setFormState(current => ({ ...current, name: event.target.value }))
										}
										className="input-base"
										required
									/>
								</div>
								<div>
									<label className="block text-sm font-medium text-slate-700">Date of birth</label>
									<input
										type="date"
										value={formState.dob}
										onChange={event =>
											setFormState(current => ({ ...current, dob: event.target.value }))
										}
										className="input-base"
									/>
								</div>
								<div>
									<label className="block text-sm font-medium text-slate-700">Gender</label>
									<select
										value={formState.gender}
										onChange={event =>
											setFormState(current => ({
												...current,
												gender: event.target.value as AdminGenderOption,
											}))
										}
										className="select-base"
									>
										{genderOptions.map(option => (
											<option key={option.value} value={option.value}>
												{option.label}
											</option>
										))}
									</select>
								</div>
								<div>
									<label className="block text-sm font-medium text-slate-700">Phone</label>
									<input
										type="tel"
										value={formState.phone}
										onChange={event =>
											setFormState(current => ({ ...current, phone: event.target.value }))
										}
										className="input-base"
									/>
								</div>
								<div>
									<label className="block text-sm font-medium text-slate-700">Email</label>
									<input
										type="email"
										value={formState.email}
										onChange={event =>
											setFormState(current => ({ ...current, email: event.target.value }))
										}
										className="input-base"
									/>
								</div>
								<div>
									<label className="block text-sm font-medium text-slate-700">Status</label>
									<select
										value={formState.status}
										onChange={event =>
											setFormState(current => ({ ...current, status: event.target.value as AdminPatientStatus }))
										}
										className="select-base"
									>
										{statusOptions.map(option => (
											<option key={option.value} value={option.value}>
												{option.label}
											</option>
										))}
									</select>
								</div>
								<div className="sm:col-span-2">
									<label className="block text-sm font-medium text-slate-700">Address</label>
									<input
										type="text"
										value={formState.address}
										onChange={event =>
											setFormState(current => ({ ...current, address: event.target.value }))
										}
										className="input-base"
									/>
								</div>
								<div className="sm:col-span-2">
									<label className="block text-sm font-medium text-slate-700">Medical complaint</label>
									<textarea
										value={formState.complaint}
										onChange={event =>
											setFormState(current => ({ ...current, complaint: event.target.value }))
										}
										className="textarea-base min-h-[96px]"
									/>
								</div>
								<footer className="sm:col-span-2 flex items-center justify-end gap-3 pt-2">
									<button type="button" onClick={closeDialog} className="btn-secondary">
										Cancel
									</button>
									<button type="submit" className="btn-primary">
										{editingId !== null ? 'Save changes' : 'Add patient'}
									</button>
								</footer>
							</form>
						</div>
					</div>
				)}

				{/* Import modal */}
				{isImportOpen && (
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6"
						onClick={() => {
							setIsImportOpen(false);
							setImportFile(null);
							setImportPreview([]);
						}}
						role="dialog"
						aria-modal="true"
					>
						<div
							className="w-full max-w-4xl max-h-[85vh] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
							onClick={e => e.stopPropagation()}
						>
							<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4 sticky top-0 bg-white z-10">
								<h2 className="text-lg font-semibold text-slate-900">Import Patients from CSV</h2>
								<button
									type="button"
									onClick={() => {
										setIsImportOpen(false);
										setImportFile(null);
										setImportPreview([]);
									}}
									className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
									aria-label="Close"
								>
									<i className="fas fa-times" aria-hidden="true" />
								</button>
							</header>

							<div className="max-h-[calc(85vh-120px)] overflow-y-auto px-6 py-6">
								<div className="space-y-4">
									<div>
										<label className="block text-sm font-medium text-slate-700 mb-2">
											Select CSV file
										</label>
										<input
											type="file"
											accept=".csv,.xlsx,.xls"
											onChange={handleFileSelect}
											className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
										/>
										{/* helper text removed as requested */}
									</div>

									{importPreview.length > 0 && (
										<div>
											<h3 className="text-sm font-semibold text-slate-800 mb-2">
												Preview (first {importPreview.length} rows)
											</h3>
											<div className="overflow-x-auto rounded-lg border border-slate-200">
												<table className="min-w-full text-xs">
													<thead className="bg-slate-50">
														<tr>
															{Object.keys(importPreview[0] || {}).map(key => (
																<th key={key} className="px-3 py-2 text-left font-semibold text-slate-700">
																	{key}
																</th>
															))}
														</tr>
													</thead>
													<tbody className="divide-y divide-slate-100">
														{importPreview.slice(0, 10).map((row, idx) => (
															<tr key={idx}>
																{Object.values(row).map((val: any, i) => (
																	<td key={i} className="px-3 py-2 text-slate-600">
																		{String(val || '—')}
																	</td>
																))}
															</tr>
														))}
													</tbody>
												</table>
											</div>
										</div>
									)}
								</div>
							</div>

							<footer className="flex justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4 sticky bottom-0">
								<button
									type="button"
									onClick={() => {
										setIsImportOpen(false);
										setImportFile(null);
										setImportPreview([]);
									}}
									className="btn-secondary"
								>
									Cancel
								</button>

								{/* Download template inside modal */}
								<button
									type="button"
									onClick={downloadTemplate}
									className="btn-secondary"
								>
									<i className="fas fa-download mr-2" />
									Download Template
								</button>

								<button
									type="button"
									onClick={handleImportConfirm}
									disabled={!importFile}
									className="btn-primary"
								>
									Import {importPreview.length > 0 ? `${importPreview.length} patients` : 'CSV'}
								</button>
							</footer>
						</div>
					</div>
				)}

				{/* Backup Modal */}
				{isBackupOpen && (
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6"
						onClick={() => setIsBackupOpen(false)}
						role="dialog"
						aria-modal="true"
					>
						<div
							className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl"
							onClick={e => e.stopPropagation()}
						>
							<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
								<h2 className="text-lg font-semibold text-slate-900">Backup Patient Data</h2>
								<button
									type="button"
									onClick={() => setIsBackupOpen(false)}
									className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
									aria-label="Close"
								>
									<i className="fas fa-times" aria-hidden="true" />
								</button>
							</header>

							<div className="px-6 py-6">
								<div className="space-y-4">
									<p className="text-sm text-slate-600">
										This will download a CSV backup of patient records including summary info for notes, attachments, and history.
									</p>
									<ul className="list-disc list-inside space-y-1 text-sm text-slate-600 ml-4">
										<li>Patient records</li>
										<li>Notes</li>
										<li>Attachments</li>
										<li>History</li>
									</ul>
									<p className="text-sm font-medium text-slate-700">
										Total patients: {patients.length}
									</p>
								</div>
							</div>

							<footer className="flex justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4">
								<button
									type="button"
									onClick={() => setIsBackupOpen(false)}
									className="btn-secondary"
									disabled={isBackingUp}
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={handleBackup}
									disabled={isBackingUp || patients.length === 0}
									className="btn-primary"
								>
									{isBackingUp ? (
										<>
											<div className="loading-spinner h-4 w-4" aria-hidden="true" />
											Backing up...
										</>
									) : (
										<>
											<i className="fas fa-download text-xs" aria-hidden="true" />
											Create Backup
										</>
									)}
								</button>
							</footer>
						</div>
					</div>
				)}

				{/* Restore Modal */}
				{isRestoreOpen && (
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6"
						onClick={() => {
							setIsRestoreOpen(false);
							setRestoreFile(null);
							if (restoreFileInputRef.current) {
								restoreFileInputRef.current.value = '';
							}
						}}
						role="dialog"
						aria-modal="true"
					>
						<div
							className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl"
							onClick={e => e.stopPropagation()}
						>
							<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
								<h2 className="text-lg font-semibold text-slate-900">Restore Patient Data</h2>
								<button
									type="button"
									onClick={() => {
										setIsRestoreOpen(false);
										setRestoreFile(null);
										if (restoreFileInputRef.current) {
											restoreFileInputRef.current.value = '';
										}
									}}
									className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
									aria-label="Close"
								>
									<i className="fas fa-times" aria-hidden="true" />
								</button>
							</header>

							<div className="px-6 py-6">
								<div className="space-y-4">
									<div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
										<p className="text-sm font-semibold text-amber-800 mb-2">⚠️ Warning</p>
										<p className="text-sm text-amber-700">
											Restoring will overwrite existing patient data. This action cannot be undone. Please ensure you have a current backup before proceeding.
										</p>
									</div>
									<div>
										<label className="block text-sm font-medium text-slate-700 mb-2">
											Select backup file (JSON)
										</label>
										<input
											ref={restoreFileInputRef}
											type="file"
											accept=".json"
											onChange={handleRestoreFileSelect}
											className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
										/>
										{restoreFile && (
											<p className="mt-2 text-xs text-slate-600">
												Selected: {restoreFile.name}
											</p>
										)}
									</div>
								</div>
							</div>

							<footer className="flex justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4">
								<button
									type="button"
									onClick={() => {
										setIsRestoreOpen(false);
										setRestoreFile(null);
										if (restoreFileInputRef.current) {
											restoreFileInputRef.current.value = '';
										}
									}}
									className="btn-secondary"
									disabled={isRestoring}
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={handleRestore}
									disabled={isRestoring || !restoreFile}
									className="btn-primary"
								>
									{isRestoring ? (
										<>
											<div className="loading-spinner h-4 w-4" aria-hidden="true" />
											Restoring...
										</>
									) : (
										<>
											<i className="fas fa-upload text-xs" aria-hidden="true" />
											Restore Backup
										</>
									)}
								</button>
							</footer>
						</div>
					</div>
				)}
			</div>

			{/* Delete Confirmation Modal */}
			{deleteConfirmation.patient && (
				<div
					role="dialog"
					aria-modal="true"
					className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 px-4 py-6"
					onClick={handleDeleteCancel}
				>
					<div
						className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
						onClick={event => event.stopPropagation()}
					>
						<div className="px-6 py-5 border-b border-slate-200">
							<div className="flex items-center gap-3">
								<div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-100">
									<i className="fas fa-exclamation-triangle text-rose-600 text-xl" aria-hidden="true" />
								</div>
								<div>
									<h3 className="text-lg font-semibold text-slate-900">Delete Patient</h3>
									<p className="text-sm text-slate-600">This action cannot be undone</p>
								</div>
							</div>
						</div>

						<div className="px-6 py-5 space-y-4">
							<div className="rounded-lg bg-rose-50 border border-rose-200 p-4">
								<p className="text-sm font-medium text-rose-900 mb-2">
									You are about to delete:
								</p>
								<p className="text-base font-semibold text-slate-900">
									{deleteConfirmation.patient.name}
								</p>
								<p className="text-sm text-slate-600 mt-1">
									ID: {deleteConfirmation.patient.patientId}
								</p>
							</div>

							<div>
								<label className="block text-sm font-semibold text-slate-700 mb-2">
									To confirm, please type the patient's name:
									<span className="font-mono text-blue-600 ml-2">
										{deleteConfirmation.patient.name}
									</span>
								</label>
								<input
									type="text"
									value={deleteConfirmation.nameInput}
									onChange={event => setDeleteConfirmation(prev => ({ ...prev, nameInput: event.target.value }))}
									placeholder="Enter patient name"
									className="w-full rounded-lg border-2 border-slate-300 px-4 py-3 text-sm text-slate-900 transition focus:border-rose-500 focus:outline-none focus:ring-4 focus:ring-rose-100"
									autoFocus
									onKeyDown={event => {
										if (event.key === 'Enter' && deleteConfirmation.nameInput.trim().toLowerCase() === deleteConfirmation.patient?.name.trim().toLowerCase()) {
											handleDeleteConfirm();
										}
									}}
								/>
								{deleteConfirmation.nameInput.trim() && deleteConfirmation.nameInput.trim().toLowerCase() !== deleteConfirmation.patient?.name.trim().toLowerCase() && (
									<p className="mt-2 text-sm text-rose-600 flex items-center gap-2">
										<i className="fas fa-exclamation-circle" aria-hidden="true" />
										The name you entered does not match. Please type the patient name exactly as shown.
									</p>
								)}
							</div>
						</div>

						<div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-3">
							<button
								type="button"
								onClick={handleDeleteCancel}
								className="px-4 py-2 text-sm font-semibold text-slate-700 rounded-lg border border-slate-300 hover:bg-slate-50 transition focus:outline-none focus:ring-2 focus:ring-slate-300"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleDeleteConfirm}
								disabled={
									deleteConfirmation.nameInput.trim().toLowerCase() !== deleteConfirmation.patient?.name.trim().toLowerCase()
								}
								className="px-4 py-2 text-sm font-semibold text-white rounded-lg bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-700 hover:to-rose-800 transition focus:outline-none focus:ring-4 focus:ring-rose-200 disabled:opacity-50 disabled:cursor-not-allowed"
							>
								<span className="flex items-center gap-2">
									<i className="fas fa-trash" aria-hidden="true" />
									Delete Patient
								</span>
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Report Modal */}
			<ReportModal
				isOpen={showReportModal}
				patientId={reportModalPatientId}
				initialTab="report"
				onClose={() => {
					setShowReportModal(false);
					setReportModalPatientId(null);
				}}
			/>
		</div>
	);
}
