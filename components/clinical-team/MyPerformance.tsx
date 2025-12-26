'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where, getDocs, updateDoc, doc, serverTimestamp, type QuerySnapshot, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import PageHeader from '@/components/PageHeader';
import { useAuth } from '@/contexts/AuthContext';

interface AppointmentRecord {
	id: string;
	patientId?: string;
	patient?: string;
	doctor?: string;
	date?: string;
	time?: string;
	duration?: number;
	status?: string;
}

interface ActivityRecord {
	id: string;
	staffId?: string;
	staffEmail?: string;
	activityType?: string;
	description?: string;
	startTime?: string;
	endTime?: string;
	date?: string;
}

interface BillingRecord {
	id: string;
	patientId?: string;
	doctor?: string;
	amount?: number;
	status?: string;
	date?: string;
}

interface PatientRecord {
	id: string;
	patientId?: string;
	assignedDoctor?: string;
	patientType?: string;
}

interface TransferRecord {
	id: string;
	patientId?: string;
	patientName?: string;
	fromTherapist?: string;
	toTherapist?: string;
	transferredBy?: string;
	transferredAt?: string | Timestamp;
	reason?: string;
}

interface SessionTransferRecord {
	id: string;
	patientId?: string;
	patientName?: string;
	fromTherapist?: string;
	toTherapist?: string;
	sessionsTransferred?: number;
	transferredBy?: string;
	transferredAt?: string | Timestamp;
	reason?: string;
}

type TimePeriod = 'day' | 'week' | 'month';

export default function MyPerformance() {
	const { user } = useAuth();
	const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
	const [activities, setActivities] = useState<ActivityRecord[]>([]);
	const [billing, setBilling] = useState<BillingRecord[]>([]);
	const [patients, setPatients] = useState<PatientRecord[]>([]);
	const [transfers, setTransfers] = useState<TransferRecord[]>([]);
	const [sessionTransfers, setSessionTransfers] = useState<SessionTransferRecord[]>([]);
	const [staffName, setStaffName] = useState<string>('');
	const [staffId, setStaffId] = useState<string>('');
	const [loading, setLoading] = useState(true);
	const [selectedPeriod, setSelectedPeriod] = useState<TimePeriod>('month');
	const [selectedActivityType, setSelectedActivityType] = useState<string | null>(null);
	const [selectedTransfers, setSelectedTransfers] = useState<TransferRecord[] | null>(null);

	// Load staff name
	useEffect(() => {
		const loadStaffName = async () => {
			if (!user?.email) return;

			try {
				const staffQuery = query(collection(db, 'staff'), where('userEmail', '==', user.email));
				const querySnapshot = await getDocs(staffQuery);
				if (!querySnapshot.empty) {
					const doc = querySnapshot.docs[0];
					const data = doc.data();
					setStaffName(data.userName || user.displayName || '');
					setStaffId(doc.id);
				} else {
					setStaffName(user.displayName || '');
					setStaffId('');
				}
			} catch (error) {
				console.error('Failed to load staff name:', error);
				setStaffName(user.displayName || '');
				setStaffId('');
			}
		};

		loadStaffName();
	}, [user]);

	// Load appointments
	useEffect(() => {
		if (!staffName) return;

		const unsubscribe = onSnapshot(
			collection(db, 'appointments'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data() as Record<string, unknown>;
					return {
						id: docSnap.id,
						patientId: data.patientId ? String(data.patientId) : '',
						patient: data.patient ? String(data.patient) : '',
						doctor: data.doctor ? String(data.doctor) : '',
						date: data.date ? String(data.date) : '',
						time: data.time ? String(data.time) : '',
						duration: data.duration ? Number(data.duration) : 30,
						status: data.status ? String(data.status) : 'pending',
					} as AppointmentRecord;
				});
				setAppointments([...mapped]);
			},
			error => {
				console.error('Failed to load appointments:', error);
				setAppointments([]);
			}
		);

		return () => unsubscribe();
	}, [staffName]);

	// Load activities
	useEffect(() => {
		if (!user?.email) return;

		const unsubscribe = onSnapshot(
			collection(db, 'activities'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data() as Record<string, unknown>;
					return {
						id: docSnap.id,
						staffId: data.staffId ? String(data.staffId) : '',
						staffEmail: data.staffEmail ? String(data.staffEmail) : '',
						activityType: data.activityType ? String(data.activityType) : '',
						description: data.description ? String(data.description) : '',
						startTime: data.startTime ? String(data.startTime) : '',
						endTime: data.endTime ? String(data.endTime) : '',
						date: data.date ? String(data.date) : '',
					} as ActivityRecord;
				});
				setActivities([...mapped]);
			},
			error => {
				console.error('Failed to load activities:', error);
				setActivities([]);
			}
		);

		return () => unsubscribe();
	}, [user]);

	// Load billing
	useEffect(() => {
		if (!staffName) return;

		const unsubscribe = onSnapshot(
			collection(db, 'billing'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data() as Record<string, unknown>;
					return {
						id: docSnap.id,
						patientId: data.patientId ? String(data.patientId) : '',
						doctor: data.doctor ? String(data.doctor) : '',
						amount: data.amount ? Number(data.amount) : 0,
						status: data.status ? String(data.status) : 'Pending',
						date: data.date ? String(data.date) : '',
					} as BillingRecord;
				});
				setBilling([...mapped]);
			},
			error => {
				console.error('Failed to load billing:', error);
				setBilling([]);
			}
		);

		return () => unsubscribe();
	}, [staffName]);

	// Load patients
	useEffect(() => {
		if (!staffName) return;

		const unsubscribe = onSnapshot(
			collection(db, 'patients'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data() as Record<string, unknown>;
					return {
						id: docSnap.id,
						patientId: data.patientId ? String(data.patientId) : '',
						assignedDoctor: data.assignedDoctor ? String(data.assignedDoctor) : '',
						patientType: data.patientType ? String(data.patientType) : '',
					} as PatientRecord;
				});
				setPatients([...mapped]);
			},
			error => {
				console.error('Failed to load patients:', error);
				setPatients([]);
			}
		);

		return () => unsubscribe();
	}, [staffName]);

	// Load transfer history
	useEffect(() => {
		if (!staffName) return;

		const unsubscribe = onSnapshot(
			collection(db, 'transferHistory'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data() as Record<string, unknown>;
					const transferredAt = (data.transferredAt as Timestamp | undefined)?.toDate?.();
					return {
						id: docSnap.id,
						patientId: data.patientId ? String(data.patientId) : '',
						patientName: data.patientName ? String(data.patientName) : '',
						fromTherapist: data.fromTherapist ? String(data.fromTherapist) : '',
						toTherapist: data.toTherapist ? String(data.toTherapist) : '',
						transferredBy: data.transferredBy ? String(data.transferredBy) : '',
						transferredAt: transferredAt ? transferredAt.toISOString() : (data.transferredAt as string | undefined) || '',
						reason: data.reason ? String(data.reason) : '',
					} as TransferRecord;
				});
				setTransfers([...mapped]);
			},
			error => {
				console.error('Failed to load transfers:', error);
				setTransfers([]);
			}
		);

		return () => unsubscribe();
	}, [staffName]);

	// Load session transfers (from appointments or a dedicated collection)
	useEffect(() => {
		if (!staffName) return;

		// Try to load from a sessionTransfers collection, or calculate from appointments
		const unsubscribe = onSnapshot(
			collection(db, 'sessionTransfers'),
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data() as Record<string, unknown>;
					const transferredAt = (data.transferredAt as Timestamp | undefined)?.toDate?.();
					return {
						id: docSnap.id,
						patientId: data.patientId ? String(data.patientId) : '',
						patientName: data.patientName ? String(data.patientName) : '',
						fromTherapist: data.fromTherapist ? String(data.fromTherapist) : '',
						toTherapist: data.toTherapist ? String(data.toTherapist) : '',
						sessionsTransferred: data.sessionsTransferred ? Number(data.sessionsTransferred) : 0,
						transferredBy: data.transferredBy ? String(data.transferredBy) : '',
						transferredAt: transferredAt ? transferredAt.toISOString() : (data.transferredAt as string | undefined) || '',
						reason: data.reason ? String(data.reason) : '',
					} as SessionTransferRecord;
				});
				setSessionTransfers([...mapped]);
			},
			error => {
				// Collection might not exist, that's okay
				console.log('Session transfers collection not found:', error);
				setSessionTransfers([]);
			}
		);

		return () => unsubscribe();
	}, [staffName]);

	useEffect(() => {
		if (staffName) {
			setLoading(false);
		}
	}, [staffName]);

	// Update existing DYES bills to have status 'Completed' and amount 500
	useEffect(() => {
		if (!staffName || billing.length === 0 || patients.length === 0) return;

		const updateDYESBills = async () => {
			try {
				// Find all DYES patients
				const dyesPatients = patients.filter(p => (p.patientType || '').toUpperCase() === 'DYES');
				const dyesPatientIds = new Set(dyesPatients.map(p => p.patientId).filter(Boolean));

				// Find billing records for DYES patients that need updating
				for (const bill of billing) {
					if (!bill.patientId || !dyesPatientIds.has(bill.patientId)) continue;
					if (bill.doctor !== staffName) continue;

					// Update bills that are not in the correct format
					if (bill.status !== 'Completed' || bill.amount !== 500) {
						try {
							await updateDoc(doc(db, 'billing', bill.id), {
								amount: 500,
								status: 'Completed',
								paymentMode: 'Auto-Paid',
								updatedAt: serverTimestamp(),
							});
							console.log(`Updated DYES bill ${bill.id} to status 'Completed' with amount 500`);
						} catch (error) {
							console.error(`Failed to update DYES bill ${bill.id}:`, error);
						}
					}
				}
			} catch (error) {
				console.error('Failed to update DYES bills:', error);
			}
		};

		// Run update once after a short delay to ensure data is loaded
		const timer = setTimeout(() => {
			updateDYESBills();
		}, 2000);

		return () => clearTimeout(timer);
	}, [billing, patients, staffName]);

	// Filter data by time period and staff
	const filteredData = useMemo(() => {
		if (!staffName) return { appointments: [], activities: [], billing: [], patients: [], transfers: [], sessionTransfers: [] };

		const now = new Date();
		let startDate: Date;

		switch (selectedPeriod) {
			case 'day':
				startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
				break;
			case 'week':
				startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
				break;
			case 'month':
				startDate = new Date(now.getFullYear(), now.getMonth(), 1);
				break;
		}

		// Filter appointments
		const filteredAppointments = appointments.filter(apt => {
			if (apt.doctor !== staffName) return false;
			if (!apt.date) return false;
			const aptDate = new Date(apt.date);
			return aptDate >= startDate && aptDate <= now;
		});

		// Filter activities
		const filteredActivities = activities.filter(act => {
			if (act.staffEmail !== user?.email) return false;
			if (!act.startTime) return false;
			const actDate = new Date(act.startTime);
			return actDate >= startDate && actDate <= now;
		});

		// Filter billing
		const filteredBilling = billing.filter(bill => {
			if (bill.doctor !== staffName) return false;
			if (!bill.date) return false;
			const billDate = new Date(bill.date);
			return billDate >= startDate && billDate <= now;
		});

		// Filter transfers (where current user is the fromTherapist or toTherapist)
		const filteredTransfers = transfers.filter(transfer => {
			if (transfer.fromTherapist !== staffName && transfer.toTherapist !== staffName) return false;
			if (!transfer.transferredAt) return false;
			const transferDate = transfer.transferredAt instanceof Timestamp 
				? transfer.transferredAt.toDate() 
				: new Date(transfer.transferredAt);
			return transferDate >= startDate && transferDate <= now;
		});

		// Filter session transfers
		const filteredSessionTransfers = sessionTransfers.filter(st => {
			if (st.fromTherapist !== staffName && st.toTherapist !== staffName) return false;
			if (!st.transferredAt) return false;
			const stDate = st.transferredAt instanceof Timestamp 
				? st.transferredAt.toDate() 
				: new Date(st.transferredAt);
			return stDate >= startDate && stDate <= now;
		});

		// Filter patients (always show all assigned patients)
		const filteredPatients = patients.filter(pat => pat.assignedDoctor === staffName);

		return {
			appointments: filteredAppointments,
			activities: filteredActivities,
			billing: filteredBilling,
			patients: filteredPatients,
			transfers: filteredTransfers,
			sessionTransfers: filteredSessionTransfers,
		};
	}, [appointments, activities, billing, patients, transfers, sessionTransfers, staffName, selectedPeriod, user]);

	// Calculate analytics
	const analytics = useMemo(() => {
		const { appointments: apts, activities: acts, billing: bills, patients: pats, transfers: trans, sessionTransfers: sessTrans } = filteredData;

		// Unique patients attended
		const uniquePatientIds = new Set(apts.map(apt => apt.patientId).filter(Boolean));
		const patientsAttended = uniquePatientIds.size;

		// Patients by type (from appointments)
		const patientIdsFromAppointments = Array.from(uniquePatientIds);
		const patientsByType = {
			DYES: 0,
			VIP: 0,
			GETHNA: 0,
			PAID: 0,
		};

		patientIdsFromAppointments.forEach(pid => {
			const patient = pats.find(p => p.patientId === pid);
			if (patient) {
				const type = (patient.patientType || '').toUpperCase();
				if (type === 'DYES') patientsByType.DYES++;
				else if (type === 'VIP') patientsByType.VIP++;
				else if (type === 'GETHNA') patientsByType.GETHNA++;
				else if (type === 'PAID') patientsByType.PAID++;
			}
		});

		// Appointments count and hours
		const appointmentCount = apts.length;
		const appointmentHours = apts.reduce((total, apt) => {
			const duration = apt.duration || 30; // Default 30 minutes
			return total + duration / 60; // Convert minutes to hours
		}, 0);

		// Activities by type
		const activitiesByType = acts.reduce((acc, act) => {
			const type = act.activityType || 'Other';
			if (!acc[type]) {
				acc[type] = { count: 0, hours: 0, activities: [] };
			}
			acc[type].count++;
			if (act.startTime && act.endTime) {
				const start = new Date(act.startTime);
				const end = new Date(act.endTime);
				const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
				acc[type].hours += hours;
			}
			acc[type].activities.push(act);
			return acc;
		}, {} as Record<string, { count: number; hours: number; activities: ActivityRecord[] }>);

		// Total revenue (include both 'Completed' and 'Auto-Paid' statuses)
		const totalRevenue = bills
			.filter(bill => bill.status === 'Completed' || bill.status === 'Auto-Paid')
			.reduce((total, bill) => total + (bill.amount || 0), 0);

		// Revenue by DYES vs non-DYES
		// Use full patients array (not filtered) to find patient type for billing records
		const revenueByType = {
			DYES: 0,
			nonDYES: 0,
		};

		bills
			.filter(bill => bill.status === 'Completed' || bill.status === 'Auto-Paid')
			.forEach(bill => {
				// Use full patients array instead of filtered pats to ensure we can find the patient
				const patient = patients.find(p => p.patientId === bill.patientId);
				const isDYES = patient && (patient.patientType || '').toUpperCase() === 'DYES';
				if (isDYES) {
					revenueByType.DYES += bill.amount || 0;
				} else {
					// Only count non-DYES bills with status 'Completed' (exclude 'Auto-Paid' for non-DYES)
					if (bill.status === 'Completed') {
						revenueByType.nonDYES += bill.amount || 0;
					}
				}
			});

		// Transfers count
		const transfersCount = trans.length;
		const transfersFromMe = trans.filter(t => t.fromTherapist === staffName);
		const transfersToMe = trans.filter(t => t.toTherapist === staffName);

		// Session transfers count
		const sessionTransfersCount = sessTrans.length;
		const totalSessionsTransferred = sessTrans.reduce((sum, st) => sum + (st.sessionsTransferred || 0), 0);

		// Appointments by patient type/department
		const appointmentsByDepartment = {
			DYES: 0,
			VIP: 0,
			GETHNA: 0,
			PAID: 0,
			nonDYES: 0,
		};

		apts.forEach(apt => {
			const patient = pats.find(p => p.patientId === apt.patientId);
			if (patient) {
				const type = (patient.patientType || '').toUpperCase();
				if (type === 'DYES') appointmentsByDepartment.DYES++;
				else if (type === 'VIP') appointmentsByDepartment.VIP++;
				else if (type === 'GETHNA') appointmentsByDepartment.GETHNA++;
				else if (type === 'PAID') appointmentsByDepartment.PAID++;
				else appointmentsByDepartment.nonDYES++;
			} else {
				appointmentsByDepartment.nonDYES++;
			}
		});

		// Appointment hours by department
		const appointmentHoursByDepartment = {
			DYES: 0,
			VIP: 0,
			GETHNA: 0,
			PAID: 0,
			nonDYES: 0,
		};

		apts.forEach(apt => {
			const patient = pats.find(p => p.patientId === apt.patientId);
			const duration = (apt.duration || 30) / 60; // Convert to hours
			if (patient) {
				const type = (patient.patientType || '').toUpperCase();
				if (type === 'DYES') appointmentHoursByDepartment.DYES += duration;
				else if (type === 'VIP') appointmentHoursByDepartment.VIP += duration;
				else if (type === 'GETHNA') appointmentHoursByDepartment.GETHNA += duration;
				else if (type === 'PAID') appointmentHoursByDepartment.PAID += duration;
				else appointmentHoursByDepartment.nonDYES += duration;
			} else {
				appointmentHoursByDepartment.nonDYES += duration;
			}
		});

		return {
			patientsAttended,
			patientsByType,
			appointmentCount,
			appointmentHours: Math.round(appointmentHours * 10) / 10,
			activitiesByType,
			totalRevenue,
			revenueByType,
			transfersCount,
			transfersFromMe,
			transfersToMe,
			sessionTransfersCount,
			totalSessionsTransferred,
			appointmentsByDepartment,
			appointmentHoursByDepartment,
		};
	}, [filteredData, staffName, patients]);

	if (loading) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<div className="text-center">
					<div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-sky-600 border-r-transparent"></div>
					<p className="text-sm text-slate-600">Loading performance data...</p>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-slate-50 p-6">
			<PageHeader
				title="My Performance"
				description="Track your analytics and performance metrics"
				statusCard={{
					label: 'Period',
					value: (
						<div className="flex items-center gap-2">
							<div className="rounded-full bg-sky-100 p-2">
								<i className="fas fa-chart-line text-sky-600" aria-hidden="true" />
							</div>
							<p className="text-sm font-semibold text-slate-900 capitalize">{selectedPeriod}</p>
						</div>
					),
				}}
			/>

			{/* Time Period Selector */}
			<div className="mb-6 flex gap-2">
				{(['day', 'week', 'month'] as TimePeriod[]).map(period => (
					<button
						key={period}
						onClick={() => setSelectedPeriod(period)}
						className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
							selectedPeriod === period
								? 'bg-sky-600 text-white'
								: 'bg-white text-slate-700 hover:bg-slate-50'
						}`}
					>
						{period === 'day' ? 'Today' : period === 'week' ? 'This Week' : 'This Month'}
					</button>
				))}
			</div>

			{/* Key Metrics Cards */}
			<div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
				<div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
					<div className="flex items-center justify-between">
						<div>
							<p className="text-sm font-medium text-slate-500">Patients Attended</p>
							<p className="mt-2 text-2xl font-bold text-slate-900">{analytics.patientsAttended}</p>
						</div>
						<div className="rounded-full bg-emerald-100 p-3">
							<i className="fas fa-users text-emerald-600 text-xl" aria-hidden="true" />
						</div>
					</div>
				</div>

				<div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
					<div className="flex items-center justify-between">
						<div>
							<p className="text-sm font-medium text-slate-500">Appointments</p>
							<p className="mt-2 text-2xl font-bold text-slate-900">{analytics.appointmentCount}</p>
							<p className="text-xs text-slate-500">{analytics.appointmentHours}h total</p>
						</div>
						<div className="rounded-full bg-amber-100 p-3">
							<i className="fas fa-calendar-check text-amber-600 text-xl" aria-hidden="true" />
						</div>
					</div>
				</div>

				<div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
					<div className="flex items-center justify-between">
						<div>
							<p className="text-sm font-medium text-slate-500">Total Revenue</p>
							<p className="mt-2 text-2xl font-bold text-slate-900">₹{analytics.totalRevenue.toLocaleString()}</p>
						</div>
						<div className="rounded-full bg-green-100 p-3">
							<i className="fas fa-rupee-sign text-green-600 text-xl" aria-hidden="true" />
						</div>
					</div>
				</div>

				<div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
					<div className="flex items-center justify-between">
						<div>
							<p className="text-sm font-medium text-slate-500">Total Activities</p>
							<p className="mt-2 text-2xl font-bold text-slate-900">
								{Object.values(analytics.activitiesByType).reduce((sum, act) => sum + act.count, 0)}
							</p>
						</div>
						<div className="rounded-full bg-blue-100 p-3">
							<i className="fas fa-tasks text-blue-600 text-xl" aria-hidden="true" />
						</div>
					</div>
				</div>
			</div>

			{/* Transfers and Session Transfers */}
			<div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
				<div 
					onClick={() => setSelectedTransfers(filteredData.transfers)}
					className="cursor-pointer rounded-lg border border-slate-200 bg-white p-6 shadow-sm transition hover:border-sky-300 hover:shadow-md"
				>
					<div className="flex items-center justify-between">
						<div>
							<p className="text-sm font-medium text-slate-500">Patients Transferred</p>
							<p className="mt-2 text-2xl font-bold text-slate-900">{analytics.transfersCount}</p>
							<p className="text-xs text-slate-500">
								{analytics.transfersFromMe.length} sent • {analytics.transfersToMe.length} received
							</p>
						</div>
						<div className="rounded-full bg-purple-100 p-3">
							<i className="fas fa-exchange-alt text-purple-600 text-xl" aria-hidden="true" />
						</div>
					</div>
					{analytics.transfersCount > 0 && (
						<p className="mt-3 text-xs text-sky-600">Click to view details →</p>
					)}
				</div>

				<div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
					<div className="flex items-center justify-between">
						<div>
							<p className="text-sm font-medium text-slate-500">Session Transfers</p>
							<p className="mt-2 text-2xl font-bold text-slate-900">{analytics.sessionTransfersCount}</p>
							<p className="text-xs text-slate-500">
								{analytics.totalSessionsTransferred} sessions transferred
							</p>
						</div>
						<div className="rounded-full bg-indigo-100 p-3">
							<i className="fas fa-share-alt text-indigo-600 text-xl" aria-hidden="true" />
						</div>
					</div>
				</div>
			</div>

			{/* Patients by Type */}
			<div className="mb-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
				<h3 className="mb-4 text-lg font-semibold text-slate-900">Patients by Type</h3>
				<div className="grid grid-cols-2 gap-4 md:grid-cols-4">
					<div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
						<p className="text-xs font-medium text-slate-500">DYES</p>
						<p className="mt-1 text-xl font-bold text-slate-900">{analytics.patientsByType.DYES}</p>
					</div>
					<div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
						<p className="text-xs font-medium text-slate-500">VIP</p>
						<p className="mt-1 text-xl font-bold text-slate-900">{analytics.patientsByType.VIP}</p>
					</div>
					<div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
						<p className="text-xs font-medium text-slate-500">GETHNA</p>
						<p className="mt-1 text-xl font-bold text-slate-900">{analytics.patientsByType.GETHNA}</p>
					</div>
					<div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
						<p className="text-xs font-medium text-slate-500">PAID</p>
						<p className="mt-1 text-xl font-bold text-slate-900">{analytics.patientsByType.PAID}</p>
					</div>
				</div>
			</div>

			{/* Revenue Breakdown */}
			<div className="mb-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
				<h3 className="mb-4 text-lg font-semibold text-slate-900">Revenue Breakdown</h3>
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
					<div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
						<p className="text-xs font-medium text-slate-500">DYES Revenue</p>
						<p className="mt-1 text-xl font-bold text-slate-900">₹{analytics.revenueByType.DYES.toLocaleString()}</p>
					</div>
					<div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
						<p className="text-xs font-medium text-slate-500">Non-DYES Revenue</p>
						<p className="mt-1 text-xl font-bold text-slate-900">₹{analytics.revenueByType.nonDYES.toLocaleString()}</p>
					</div>
				</div>
			</div>

			{/* Graphical Representations */}
			<div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
				{/* Activities Chart */}
				<div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
					<h3 className="mb-4 text-lg font-semibold text-slate-900">Activities Distribution</h3>
					{Object.keys(analytics.activitiesByType).length === 0 ? (
						<div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center">
							<i className="fas fa-chart-pie mb-2 text-4xl text-slate-400" aria-hidden="true" />
							<p className="text-sm text-slate-500">No activities recorded for this period.</p>
						</div>
					) : (
						<div className="space-y-4">
							{/* Bar Chart */}
							<div className="space-y-3">
								{Object.entries(analytics.activitiesByType).map(([type, data]) => {
									const totalHours = Object.values(analytics.activitiesByType).reduce((sum, act) => sum + act.hours, 0);
									const percentage = totalHours > 0 ? (data.hours / totalHours) * 100 : 0;
									
									return (
										<div
											key={type}
											onClick={() => setSelectedActivityType(type)}
											className="cursor-pointer rounded-lg border border-slate-200 bg-slate-50 p-4 transition hover:bg-slate-100"
										>
											<div className="mb-2 flex items-center justify-between">
												<div>
													<p className="font-semibold text-slate-900">{type}</p>
													<p className="text-xs text-slate-500">
														{data.count} activities • {Math.round(data.hours * 10) / 10}h
													</p>
												</div>
												<div className="text-right">
													<p className="text-sm font-semibold text-slate-900">{Math.round(percentage)}%</p>
												</div>
											</div>
											<div className="h-3 w-full overflow-hidden rounded-full bg-slate-200">
												<div
													className="h-full bg-gradient-to-r from-sky-500 to-sky-600 transition-all"
													style={{ width: `${percentage}%` }}
												/>
											</div>
										</div>
									);
								})}
							</div>
						</div>
					)}
				</div>

				{/* Appointments Chart */}
				<div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
					<h3 className="mb-4 text-lg font-semibold text-slate-900">Appointments Overview</h3>
					<div className="space-y-4">
						{/* Hours Spent Chart */}
						<div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
							<p className="mb-3 text-sm font-semibold text-slate-700">Hours Spent</p>
							<div className="flex items-end gap-2" style={{ height: '120px' }}>
								{analytics.appointmentHours > 0 ? (
									<div className="flex-1">
										<div
											className="w-full rounded-t-lg bg-gradient-to-t from-amber-500 to-amber-400 transition-all hover:from-amber-600 hover:to-amber-500"
											style={{ height: '100%' }}
											title={`${analytics.appointmentHours} hours`}
										/>
										<p className="mt-2 text-center text-xs font-medium text-slate-600">
											{analytics.appointmentHours}h
										</p>
									</div>
								) : (
									<div className="flex h-full w-full items-center justify-center text-sm text-slate-400">
										No appointments
									</div>
								)}
							</div>
						</div>
						{/* Appointment Count */}
						<div className="grid grid-cols-2 gap-4">
							<div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center">
								<p className="text-xs font-medium text-slate-500">Total Appointments</p>
								<p className="mt-1 text-2xl font-bold text-slate-900">{analytics.appointmentCount}</p>
							</div>
							<div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center">
								<p className="text-xs font-medium text-slate-500">Total Hours</p>
								<p className="mt-1 text-2xl font-bold text-slate-900">{analytics.appointmentHours}</p>
							</div>
						</div>
					</div>
				</div>

				{/* Revenue Chart */}
				<div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
					<h3 className="mb-4 text-lg font-semibold text-slate-900">Revenue Breakdown</h3>
					<div className="space-y-4">
						{/* Revenue Bar Chart */}
						<div className="space-y-3">
							{analytics.totalRevenue > 0 ? (
								<>
									<div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
										<div className="mb-2 flex items-center justify-between">
											<p className="text-sm font-semibold text-slate-700">DYES Revenue</p>
											<p className="text-sm font-bold text-slate-900">
												₹{analytics.revenueByType.DYES.toLocaleString()}
											</p>
										</div>
										<div className="h-3 w-full overflow-hidden rounded-full bg-slate-200">
											<div
												className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600"
												style={{
													width: `${analytics.totalRevenue > 0 ? (analytics.revenueByType.DYES / analytics.totalRevenue) * 100 : 0}%`,
												}}
											/>
										</div>
									</div>
									<div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
										<div className="mb-2 flex items-center justify-between">
											<p className="text-sm font-semibold text-slate-700">Non-DYES Revenue</p>
											<p className="text-sm font-bold text-slate-900">
												₹{analytics.revenueByType.nonDYES.toLocaleString()}
											</p>
										</div>
										<div className="h-3 w-full overflow-hidden rounded-full bg-slate-200">
											<div
												className="h-full bg-gradient-to-r from-blue-500 to-blue-600"
												style={{
													width: `${analytics.totalRevenue > 0 ? (analytics.revenueByType.nonDYES / analytics.totalRevenue) * 100 : 0}%`,
												}}
											/>
										</div>
									</div>
									<div className="mt-4 rounded-lg border-2 border-slate-300 bg-gradient-to-r from-green-50 to-emerald-50 p-4 text-center">
										<p className="text-xs font-medium text-slate-500">Total Revenue</p>
										<p className="mt-1 text-2xl font-bold text-slate-900">
											₹{analytics.totalRevenue.toLocaleString()}
										</p>
									</div>
								</>
							) : (
								<div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center">
									<i className="fas fa-rupee-sign mb-2 text-4xl text-slate-400" aria-hidden="true" />
									<p className="text-sm text-slate-500">No revenue recorded for this period.</p>
								</div>
							)}
						</div>
					</div>
				</div>

				{/* Hours Spent Breakdown Chart */}
				<div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
					<h3 className="mb-4 text-lg font-semibold text-slate-900">Hours Spent Breakdown</h3>
					<div className="space-y-4">
						{(() => {
							const totalActivityHours = Object.values(analytics.activitiesByType).reduce(
								(sum, act) => sum + act.hours,
								0
							);
							const maxHours = Math.max(analytics.appointmentHours, ...Object.values(analytics.activitiesByType).map(act => act.hours), 1);
							
							// Create array with appointments and all activities
							const hoursData = [
								{ label: 'Appointments', hours: analytics.appointmentHours, color: 'from-amber-500 to-amber-400', hoverColor: 'from-amber-600 to-amber-500', activityType: undefined },
								...Object.entries(analytics.activitiesByType).map(([type, data]) => ({
									label: type,
									hours: data.hours,
									color: type === 'Lecture' ? 'from-blue-500 to-blue-400' :
										   type === 'Research/Study' ? 'from-cyan-500 to-cyan-400' :
										   type === 'Revenue Generation' ? 'from-orange-500 to-orange-400' :
										   type === 'FBA' ? 'from-pink-500 to-pink-400' :
										   'from-purple-500 to-purple-400',
									hoverColor: type === 'Lecture' ? 'from-blue-600 to-blue-500' :
												type === 'Research/Study' ? 'from-cyan-600 to-cyan-500' :
												type === 'Revenue Generation' ? 'from-orange-600 to-orange-500' :
												type === 'FBA' ? 'from-pink-600 to-pink-500' :
												'from-purple-600 to-purple-500',
									activityType: type,
								})),
							].filter(item => item.hours > 0);

							return hoursData.length > 0 ? (
								<div className="space-y-3">
									{hoursData.map((item, index) => {
										const percentage = maxHours > 0 ? (item.hours / maxHours) * 100 : 0;
										return (
											<div key={index} className="space-y-2">
												<div className="flex items-center justify-between">
													<p className="text-sm font-semibold text-slate-700">{item.label}</p>
													<p className="text-sm font-bold text-slate-900">
														{Math.round(item.hours * 10) / 10}h
													</p>
												</div>
												<div
													onClick={() => 'activityType' in item && item.activityType && setSelectedActivityType(item.activityType)}
													className={`h-8 w-full overflow-hidden rounded-lg bg-gradient-to-r ${item.color} transition-all hover:${item.hoverColor} ${
														'activityType' in item && item.activityType ? 'cursor-pointer' : ''
													}`}
													style={{ width: `${percentage}%` }}
													title={`${item.label}: ${Math.round(item.hours * 10) / 10} hours`}
												/>
											</div>
										);
									})}
									{hoursData.length === 0 && (
										<div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center">
											<i className="fas fa-chart-bar mb-2 text-4xl text-slate-400" aria-hidden="true" />
											<p className="text-sm text-slate-500">No hours recorded for this period.</p>
										</div>
									)}
								</div>
							) : (
								<div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center">
									<i className="fas fa-chart-bar mb-2 text-4xl text-slate-400" aria-hidden="true" />
									<p className="text-sm text-slate-500">No hours recorded for this period.</p>
								</div>
							);
						})()}
					</div>
				</div>
			</div>

			{/* Activities Analytics Graph */}
			<div className="mb-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
				<h3 className="mb-4 text-lg font-semibold text-slate-900">Activities Analytics</h3>
				{Object.keys(analytics.activitiesByType).length === 0 ? (
					<div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center">
						<i className="fas fa-chart-bar mb-2 text-4xl text-slate-400" aria-hidden="true" />
						<p className="text-sm text-slate-500">No activities recorded for this period.</p>
					</div>
				) : (
					<div className="space-y-4">
						{Object.entries(analytics.activitiesByType).map(([type, data]) => {
							const totalHours = Object.values(analytics.activitiesByType).reduce((sum, act) => sum + act.hours, 0);
							const percentage = totalHours > 0 ? (data.hours / totalHours) * 100 : 0;
							
							return (
								<div
									key={type}
									onClick={() => setSelectedActivityType(type)}
									className="cursor-pointer rounded-lg border border-slate-200 bg-slate-50 p-4 transition hover:bg-slate-100"
								>
									<div className="mb-2 flex items-center justify-between">
										<div>
											<p className="font-semibold text-slate-900">{type}</p>
											<p className="text-xs text-slate-500">
												{data.count} activities • {Math.round(data.hours * 10) / 10}h
											</p>
										</div>
										<div className="text-right">
											<p className="text-sm font-semibold text-slate-900">{Math.round(percentage)}%</p>
											<p className="text-xs text-slate-500">of total time</p>
										</div>
									</div>
									<div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
										<div
											className="h-full bg-sky-600 transition-all"
											style={{ width: `${percentage}%` }}
										/>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>

			{/* Patient Transfers Details Modal */}
			{selectedTransfers && (
				<div
					role="dialog"
					aria-modal="true"
					className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4 py-6"
					onClick={() => setSelectedTransfers(null)}
				>
					<div
						className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl max-h-[90vh] overflow-hidden flex flex-col"
						onClick={e => e.stopPropagation()}
					>
						<header className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white px-6 py-5">
							<h2 className="text-xl font-bold text-slate-900">
								<i className="fas fa-exchange-alt mr-2 text-sky-600" aria-hidden="true" />
								Patient Transfer Details
							</h2>
							<button
								type="button"
								onClick={() => setSelectedTransfers(null)}
								className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
								aria-label="Close dialog"
							>
								<i className="fas fa-times text-lg" aria-hidden="true" />
							</button>
						</header>
						<div className="flex-1 overflow-y-auto px-6 py-6">
							{selectedTransfers.length === 0 ? (
								<div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center">
									<i className="fas fa-exchange-alt mb-2 text-4xl text-slate-400" aria-hidden="true" />
									<p className="text-sm text-slate-500">No transfers recorded for this period.</p>
								</div>
							) : (
								<div className="space-y-4">
									{selectedTransfers.map((transfer, index) => (
										<div key={transfer.id || index} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
											<div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
												<div>
													<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Patient</p>
													<p className="mt-1 text-sm font-semibold text-slate-900">
														{transfer.patientName || transfer.patientId || 'Unknown'}
													</p>
													{transfer.patientId && (
														<p className="text-xs text-slate-500">ID: {transfer.patientId}</p>
													)}
												</div>
												{transfer.transferredAt && (
													<div>
														<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Date</p>
														<p className="mt-1 text-sm font-semibold text-slate-900">
															{new Intl.DateTimeFormat('en-US', {
																month: 'short',
																day: 'numeric',
																year: 'numeric',
																hour: 'numeric',
																minute: '2-digit',
															}).format(
																transfer.transferredAt instanceof Timestamp 
																	? transfer.transferredAt.toDate() 
																	: new Date(transfer.transferredAt)
															)}
														</p>
													</div>
												)}
											</div>
											<div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
												<div>
													<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">From</p>
													<p className="mt-1 text-sm font-semibold text-slate-900">
														{transfer.fromTherapist || 'N/A'}
													</p>
												</div>
												<div>
													<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">To</p>
													<p className="mt-1 text-sm font-semibold text-slate-900">
														{transfer.toTherapist || 'N/A'}
													</p>
												</div>
											</div>
											{transfer.transferredBy && (
												<div className="mb-3">
													<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Transferred By</p>
													<p className="mt-1 text-sm text-slate-900">{transfer.transferredBy}</p>
												</div>
											)}
											{transfer.reason && (
												<div>
													<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reason</p>
													<p className="mt-1 text-sm text-slate-900">{transfer.reason}</p>
												</div>
											)}
										</div>
									))}
								</div>
							)}
						</div>
						<footer className="flex items-center justify-end border-t border-slate-200 bg-slate-50 px-6 py-4">
							<button
								type="button"
								onClick={() => setSelectedTransfers(null)}
								className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
							>
								<i className="fas fa-times text-xs" aria-hidden="true" />
								Close
							</button>
						</footer>
					</div>
				</div>
			)}

			{/* Activity Description Modal */}
			{selectedActivityType && analytics.activitiesByType[selectedActivityType] && (
				<div
					role="dialog"
					aria-modal="true"
					className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4 py-6"
					onClick={() => setSelectedActivityType(null)}
				>
					<div
						className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl max-h-[90vh] overflow-hidden flex flex-col"
						onClick={e => e.stopPropagation()}
					>
						<header className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white px-6 py-5">
							<h2 className="text-xl font-bold text-slate-900">
								<i className="fas fa-info-circle mr-2 text-sky-600" aria-hidden="true" />
								{selectedActivityType} Activities
							</h2>
							<button
								type="button"
								onClick={() => setSelectedActivityType(null)}
								className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
								aria-label="Close dialog"
							>
								<i className="fas fa-times text-lg" aria-hidden="true" />
							</button>
						</header>
						<div className="flex-1 overflow-y-auto px-6 py-6">
							<div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
								<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Summary</p>
								<p className="mt-1 text-sm font-semibold text-slate-900">
									{analytics.activitiesByType[selectedActivityType].count} activities • {Math.round(analytics.activitiesByType[selectedActivityType].hours * 10) / 10} hours
								</p>
							</div>
							<div className="space-y-4">
								{analytics.activitiesByType[selectedActivityType].activities.map((activity, index) => (
									<div key={activity.id || index} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
										<div className="mb-3 flex items-center justify-between">
											<p className="text-sm font-semibold text-slate-900">Activity #{index + 1}</p>
											{activity.startTime && activity.endTime && (
												<p className="text-xs text-slate-500">
													{new Intl.DateTimeFormat('en-US', {
														month: 'short',
														day: 'numeric',
														hour: 'numeric',
														minute: '2-digit',
													}).format(new Date(activity.startTime))}
													{' - '}
													{new Intl.DateTimeFormat('en-US', {
														hour: 'numeric',
														minute: '2-digit',
													}).format(new Date(activity.endTime))}
												</p>
											)}
										</div>
										{activity.description && (
											<div>
												<p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Description</p>
												<p className="text-sm text-slate-900">{activity.description}</p>
											</div>
										)}
										{!activity.description && (
											<p className="text-xs text-slate-400 italic">No description provided</p>
										)}
									</div>
								))}
							</div>
						</div>
						<footer className="flex items-center justify-end border-t border-slate-200 bg-slate-50 px-6 py-4">
							<button
								type="button"
								onClick={() => setSelectedActivityType(null)}
								className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
							>
								<i className="fas fa-times text-xs" aria-hidden="true" />
								Close
							</button>
						</footer>
					</div>
				</div>
			)}
		</div>
	);
}

