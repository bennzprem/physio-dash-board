'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where, onSnapshot, serverTimestamp, deleteField } from 'firebase/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';

interface TimeSlot {
	start: string;
	end: string;
	isNew?: boolean;
}

interface DayAvailability {
	enabled: boolean;
	slots: TimeSlot[];
	unavailableSlots?: TimeSlot[]; // Time ranges when user is unavailable within an available day
}

interface DateSpecificAvailability {
	[date: string]: DayAvailability; // date in YYYY-MM-DD format
}

interface DateAppointmentSummary {
	id?: string;
	date?: string;
	time: string;
	status: string;
	patient?: string;
	duration?: number;
}

const BUTTON_DANGER =
	'inline-flex items-center gap-2 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:border-rose-300 hover:text-rose-700 focus-visible:border-rose-300 focus-visible:text-rose-700 focus-visible:outline-none';

const SLOT_INTERVAL_MINUTES = 30;

const cloneSlots = (slots: TimeSlot[]): TimeSlot[] =>
	slots.map(slot => ({
		start: slot.start,
		end: slot.end,
	}));

const timeStringToMinutes = (time: string) => {
	const [hours, minutes] = time.split(':').map(Number);
	if (Number.isNaN(hours) || Number.isNaN(minutes)) return 0;
	return hours * 60 + minutes;
};

const minutesToTimeString = (totalMinutes: number) => {
	const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
	const hours = Math.floor(normalized / 60);
	const minutes = normalized % 60;
	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

// Helper to format date as YYYY-MM-DD in local timezone
const formatDateKey = (date: Date): string => {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
};

export default function Availability() {
	const { user } = useAuth();
	
	const [dateSpecific, setDateSpecific] = useState<DateSpecificAvailability>({});
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [savedMessage, setSavedMessage] = useState(false);
	const [staffDocId, setStaffDocId] = useState<string | null>(null);
	const isSavingRef = useRef(false);

	// Date-specific scheduling state
	const [selectedMonth, setSelectedMonth] = useState<string>(() => {
		const today = new Date();
		const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
		return formatDateKey(firstDay);
	});
	const [selectedDate, setSelectedDate] = useState<string | null>(null);
	const [editingDateSchedule, setEditingDateSchedule] = useState<DayAvailability | null>(null);
	const [appointmentsForDate, setAppointmentsForDate] = useState<DateAppointmentSummary[]>([]);
	const [loadingAppointments, setLoadingAppointments] = useState(false);
	const [currentStaffUserName, setCurrentStaffUserName] = useState<string | null>(null);
	const [copyDialog, setCopyDialog] = useState<{
		isOpen: boolean;
		sourceDate: string | null;
		selectedDates: string[];
	}>({ isOpen: false, sourceDate: null, selectedDates: [] });
	const [copyingSchedule, setCopyingSchedule] = useState(false);
	const [newUnavailableSlot, setNewUnavailableSlot] = useState<{ start: string; end: string }>({ start: '', end: '' });

	// Find staff document by user email
	useEffect(() => {
		if (!user?.email) {
			setLoading(false);
			return;
		}

		let unsubscribe: (() => void) | null = null;

		const loadStaffDoc = async () => {
			try {
				const staffQuery = query(collection(db, 'staff'), where('userEmail', '==', user.email?.toLowerCase()));
				const querySnapshot = await getDocs(staffQuery);
				
				if (!querySnapshot.empty) {
					const staffDoc = querySnapshot.docs[0];
					const data = staffDoc.data();
					setStaffDocId(staffDoc.id);
					setCurrentStaffUserName(data.userName ? String(data.userName) : null);
					
					// Set up real-time listener for this staff document
					const staffRef = doc(db, 'staff', staffDoc.id);
					unsubscribe = onSnapshot(
						staffRef,
						snapshot => {
							// Don't update if we're currently saving (to avoid race conditions)
							if (isSavingRef.current) {
								return;
							}

							if (snapshot.exists()) {
								const data = snapshot.data();
								setCurrentStaffUserName(data.userName ? String(data.userName) : null);
								const loadedDateSpecific = data.dateSpecificAvailability as DateSpecificAvailability | undefined;

								if (loadedDateSpecific) {
									console.log('📅 Availability updated from Firestore:', Object.keys(loadedDateSpecific));
									setDateSpecific(loadedDateSpecific);
								} else {
									setDateSpecific({});
								}
							} else {
								setDateSpecific({});
								setCurrentStaffUserName(null);
							}
							setLoading(false);
						},
						error => {
							console.error('Failed to load availability', error);
							setDateSpecific({});
							setCurrentStaffUserName(null);
							setLoading(false);
						}
					);
				} else {
					console.warn('No staff document found for user email:', user.email);
					setDateSpecific({});
					setCurrentStaffUserName(null);
					setLoading(false);
				}
			} catch (error) {
				console.error('Failed to find staff document', error);
				setDateSpecific({});
				setCurrentStaffUserName(null);
				setLoading(false);
			}
		};

		loadStaffDoc();

		return () => {
			if (unsubscribe) {
				unsubscribe();
			}
		};
	}, [user?.email]);

	// Date-specific handlers
	const getMonthDates = (monthStart: string): string[] => {
		const start = new Date(monthStart + 'T00:00:00'); // Parse as local time
		const year = start.getFullYear();
		const month = start.getMonth();
		
		// Get first day of month and what day of week it is
		const firstDay = new Date(year, month, 1);
		const lastDay = new Date(year, month + 1, 0); // Last day of month
		const daysInMonth = lastDay.getDate();
		const startDayOfWeek = firstDay.getDay(); // 0 = Sunday, 1 = Monday, etc.
		
		const dates: string[] = [];
		
		// Add days from previous month to fill the first week
		const prevMonthLastDay = new Date(year, month, 0).getDate();
		for (let i = startDayOfWeek - 1; i >= 0; i--) {
			const date = new Date(year, month - 1, prevMonthLastDay - i);
			dates.push(formatDateKey(date));
		}
		
		// Add all days of current month
		for (let day = 1; day <= daysInMonth; day++) {
			const date = new Date(year, month, day);
			dates.push(formatDateKey(date));
		}
		
		// Add days from next month to fill the last week (to make 6 rows = 42 days)
		const totalDays = dates.length;
		const remainingDays = 42 - totalDays; // 6 weeks * 7 days = 42
		for (let day = 1; day <= remainingDays; day++) {
			const date = new Date(year, month + 1, day);
			dates.push(formatDateKey(date));
		}
		
		return dates;
	};

	const getDayName = (date: string): string => {
		// Parse date as local time to avoid timezone issues
		const d = new Date(date + 'T00:00:00');
		const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
		return dayNames[d.getDay()];
	};

	// Default availability: 9 AM to 6 PM for all days except Sunday
	const DEFAULT_START_TIME = '09:00';
	const DEFAULT_END_TIME = '18:00';
	const DEFAULT_SLOTS: TimeSlot[] = [{ start: DEFAULT_START_TIME, end: DEFAULT_END_TIME }];

	const normalizeDateKey = (dateString: string): string => {
		const date = new Date(dateString + 'T00:00:00');
		if (Number.isNaN(date.getTime())) return dateString;
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	};

	const getDateSchedule = (date: string): DayAvailability => {
		const dayName = getDayName(date);
		const isSunday = dayName === 'Sunday';
		
		// Sunday is always unavailable
		if (isSunday) {
			return { enabled: false, slots: DEFAULT_SLOTS };
		}
		
		// Normalize date key for lookup
		const normalizedDate = normalizeDateKey(date);
		
		// Check for date-specific availability (try both normalized and original key)
		const dateSchedule = dateSpecific[normalizedDate] || dateSpecific[date];
		if (dateSchedule) {
			return dateSchedule;
		}
		
		// Default: available from 9 AM to 6 PM for all days except Sunday
		return { enabled: true, slots: DEFAULT_SLOTS };
	};

	// Check if a time slot has appointments
const hasAppointmentsInSlot = (slot: TimeSlot, date: string): boolean => {
	if (!slot.start || !slot.end) {
		return false;
	}
	return appointmentsForDate.some(apt => {
			if (apt.status === 'cancelled') return false;
			
			const aptDuration = Math.max(SLOT_INTERVAL_MINUTES, apt.duration ?? SLOT_INTERVAL_MINUTES);
			const aptStart = timeStringToMinutes(apt.time);
			const aptEnd = aptStart + aptDuration;
			
			const slotStart = timeStringToMinutes(slot.start);
			let slotEnd = timeStringToMinutes(slot.end);
			
			// Handle slots that span midnight
			if (slotEnd <= slotStart) {
				slotEnd += 24 * 60; // Add 24 hours
			}
			
			// Overlap if appointment starts before slot ends AND ends after slot starts
			return aptStart < slotEnd && aptEnd > slotStart;
		});
	};

	// Load appointments for a specific date with real-time updates
	// Use userName from staff document (which is what appointments use) instead of displayName
	useEffect(() => {
		if (!selectedDate || !currentStaffUserName) {
			setAppointmentsForDate([]);
			return;
		}

		setLoadingAppointments(true);
		const appointmentsQuery = query(
			collection(db, 'appointments'),
			where('doctor', '==', currentStaffUserName),
			where('date', '==', selectedDate)
		);

		const unsubscribe = onSnapshot(
			appointmentsQuery,
			(snapshot) => {
				const appointments: DateAppointmentSummary[] = snapshot.docs.map(doc => ({
					id: doc.id,
					date: selectedDate || undefined,
					time: doc.data().time as string,
					patient: doc.data().patient as string,
					status: doc.data().status as string,
					duration: typeof doc.data().duration === 'number' ? doc.data().duration : undefined,
				}));
				setAppointmentsForDate(appointments);
				setLoadingAppointments(false);
			},
			(error) => {
				console.error('Failed to load appointments for date', error);
				setAppointmentsForDate([]);
				setLoadingAppointments(false);
			}
		);

		return () => unsubscribe();
	}, [selectedDate, currentStaffUserName]);

	// Imperative loader for appointments on a specific date (used before destructive actions)
const loadAppointmentsForDate = async (
	date: string,
	includeCancelled = false
): Promise<DateAppointmentSummary[]> => {
		if (!currentStaffUserName) {
			setAppointmentsForDate([]);
			return [];
		}
		setLoadingAppointments(true);
		try {
			const appointmentsQuery = query(
				collection(db, 'appointments'),
				where('doctor', '==', currentStaffUserName),
				where('date', '==', date)
			);
			const snapshot = await getDocs(appointmentsQuery);
			const appointments: DateAppointmentSummary[] = snapshot.docs.map(doc => ({
				id: doc.id,
				date,
				time: doc.data().time as string,
				patient: doc.data().patient as string,
				status: doc.data().status as string,
				duration: typeof doc.data().duration === 'number' ? doc.data().duration : undefined,
			}));
			setAppointmentsForDate(appointments);
			return includeCancelled ? appointments : appointments.filter(apt => apt.status !== 'cancelled');
		} catch (error) {
			console.error('Failed to load appointments for date', error);
			setAppointmentsForDate([]);
			return [];
		} finally {
			setLoadingAppointments(false);
		}
	};

	const handleDateClick = async (date: string) => {
		const dayName = getDayName(date);
		const isSunday = dayName === 'Sunday';
		
		// Don't allow editing Sunday
		if (isSunday) {
			alert('Sunday is not available for scheduling.');
			return;
		}
		
		setSelectedDate(date);
		const currentSchedule = getDateSchedule(date);
		// For unavailability, we store it as enabled: false
		// If the date is in dateSpecific, it means it's marked as unavailable
		const normalizedDate = normalizeDateKey(date);
		const dateSchedule = dateSpecific[normalizedDate] || dateSpecific[date];
		const isUnavailable = !!dateSchedule && !dateSchedule.enabled;
		setEditingDateSchedule({
			enabled: !isUnavailable, // If not in dateSpecific or enabled=true, it's available
			slots: DEFAULT_SLOTS.map(slot => ({ ...slot })),
			unavailableSlots: dateSchedule?.unavailableSlots || [],
		});
		setNewUnavailableSlot({ start: '', end: '' }); // Reset new slot form
		// Appointments will be loaded automatically via useEffect when selectedDate changes
	};

	const saveDateSchedule = async () => {
		if (!selectedDate || !editingDateSchedule || !staffDocId) return;

		const dayName = getDayName(selectedDate);
		const isSunday = dayName === 'Sunday';
		
		if (isSunday) {
			alert('Sunday is not available for scheduling.');
			return;
		}

		// Normalize date to YYYY-MM-DD format for consistent key matching
		const normalizeDateKey = (dateString: string): string => {
			const date = new Date(dateString + 'T00:00:00');
			if (Number.isNaN(date.getTime())) return dateString;
			const year = date.getFullYear();
			const month = String(date.getMonth() + 1).padStart(2, '0');
			const day = String(date.getDate()).padStart(2, '0');
			return `${year}-${month}-${day}`;
		};

		const normalizedDate = normalizeDateKey(selectedDate);

		// If enabled is false, mark as unavailable (store in dateSpecific)
		// If enabled is true but has unavailable slots, store in dateSpecific with unavailableSlots
		// If enabled is true and no unavailable slots, remove from dateSpecific (use default availability)
		const updatedSchedule = { ...dateSpecific };
		const hasUnavailableSlots = editingDateSchedule.unavailableSlots && editingDateSchedule.unavailableSlots.length > 0;
		
		// Remove any existing entry for this date (in case date format changed)
		Object.keys(updatedSchedule).forEach(key => {
			if (normalizeDateKey(key) === normalizedDate) {
				delete updatedSchedule[key];
			}
		});
		
		if (!editingDateSchedule.enabled) {
			// Mark as unavailable
			updatedSchedule[normalizedDate] = {
				enabled: false,
				slots: DEFAULT_SLOTS, // Store default slots for reference
			};
		} else if (hasUnavailableSlots) {
			// Day is available but has unavailable time slots - store in dateSpecific
			updatedSchedule[normalizedDate] = {
				enabled: true,
				slots: DEFAULT_SLOTS,
				unavailableSlots: editingDateSchedule.unavailableSlots,
			};
		} else {
			// Day is available with no unavailable slots - remove from dateSpecific to use default
			// Already deleted above, so nothing to do here
		}

		// Update local state immediately for better UX
		setDateSpecific(updatedSchedule);
		setSelectedDate(null);
		setEditingDateSchedule(null);

		// Auto-save to Firestore - use updateDoc to replace the entire object
		isSavingRef.current = true;
		try {
			const staffRef = doc(db, 'staff', staffDocId);
			// Use updateDoc to ensure the entire dateSpecificAvailability object is replaced
			// This ensures deleted dates are actually removed from Firestore
			await updateDoc(
				staffRef,
				{
					dateSpecificAvailability: updatedSchedule,
					availabilityUpdatedAt: serverTimestamp(),
				}
			);
			console.log('✅ Saved availability for', normalizedDate, 'Schedule:', updatedSchedule);
			setSavedMessage(true);
			setTimeout(() => setSavedMessage(false), 3000);
		} catch (error) {
			console.error('Failed to save availability', error);
			alert('Failed to save availability. Please try again.');
			// Revert on error
			setDateSpecific(dateSpecific);
		} finally {
			// Allow listener to update after a short delay
			setTimeout(() => {
				isSavingRef.current = false;
			}, 500);
		}
	};

	const removeDateSchedule = async (date: string) => {
		const dayName = getDayName(date);
		const isSunday = dayName === 'Sunday';
		
		if (isSunday) {
			alert('Sunday is not available for scheduling.');
			return;
		}

		if (!window.confirm('Mark this date as available (remove unavailability)?') || !staffDocId) return;

		// Load appointments for this date to check
		const appointments = await loadAppointmentsForDate(date);
		const activeAppointments = appointments.filter(apt => apt.status !== 'cancelled');

		if (activeAppointments.length > 0) {
			alert('You have patients booked on this date. Please transfer or cancel those appointments before changing availability.');
			return;
		}

		// Remove from dateSpecific to restore default availability
		const updatedSchedule = { ...dateSpecific };
		delete updatedSchedule[date];

		// Update local state immediately
		setDateSpecific(updatedSchedule);

		// Auto-save to Firestore
		isSavingRef.current = true;
		try {
			const staffRef = doc(db, 'staff', staffDocId);
			
			// Use updateDoc to properly replace the entire dateSpecificAvailability object
			await updateDoc(
				staffRef,
				{
					dateSpecificAvailability: updatedSchedule,
					availabilityUpdatedAt: serverTimestamp(),
				}
			);
			
			console.log('✅ Removed unavailability for', date);
			setSavedMessage(true);
			setTimeout(() => setSavedMessage(false), 3000);
		} catch (error) {
			console.error('Failed to remove unavailability', error);
			alert('Failed to remove unavailability. Please try again.');
			// Revert on error
			setDateSpecific(dateSpecific);
		} finally {
			// Allow listener to update after a short delay
			setTimeout(() => {
				isSavingRef.current = false;
			}, 500);
		}
	};

	// Time slots are fixed at 9 AM - 6 PM, so we don't need these handlers anymore
	// But keeping them for backward compatibility in case they're referenced elsewhere
	const handleDateSlotChange = (slotIndex: number, field: 'start' | 'end', value: string) => {
		// Slots are fixed, so this is disabled
		alert('Time slots are fixed from 9 AM to 6 PM. You can only mark days as unavailable.');
	};

	const handleDateAddSlot = () => {
		// Slots are fixed, so this is disabled
		alert('Time slots are fixed from 9 AM to 6 PM. You can only mark days as unavailable.');
	};

	const handleDateRemoveSlot = (slotIndex: number) => {
		// Slots are fixed, so this is disabled
		alert('Time slots are fixed from 9 AM to 6 PM. You can only mark days as unavailable.');
	};

	const copyScheduleToDates = async (sourceDate: string, targetDates: string[]) => {
		if (!staffDocId || targetDates.length === 0) return;

		const sourceSchedule = getDateSchedule(sourceDate);
		const isSourceUnavailable = !!dateSpecific[sourceDate] && !dateSpecific[sourceDate].enabled;
		const newDateSpecific = { ...dateSpecific };

		targetDates.forEach(date => {
			const dayName = getDayName(date);
			const isSunday = dayName === 'Sunday';
			
			// Skip Sundays
			if (isSunday) return;
			
			if (isSourceUnavailable) {
				// Mark target dates as unavailable
				newDateSpecific[date] = {
					enabled: false,
					slots: DEFAULT_SLOTS,
				};
			} else {
				// Remove from dateSpecific to use default availability
				delete newDateSpecific[date];
			}
		});

		setDateSpecific(newDateSpecific);

		isSavingRef.current = true;
		setCopyingSchedule(true);
		try {
			const staffRef = doc(db, 'staff', staffDocId);
			await setDoc(
				staffRef,
				{
					dateSpecificAvailability: newDateSpecific,
					availabilityUpdatedAt: serverTimestamp(),
				},
				{ merge: true }
			);
			setSavedMessage(true);
			setTimeout(() => setSavedMessage(false), 3000);
		} catch (error) {
			console.error('Failed to copy availability', error);
			alert('Failed to copy availability. Please try again.');
		} finally {
			setCopyingSchedule(false);
			setTimeout(() => {
				isSavingRef.current = false;
			}, 500);
		}
	};

	const handleSave = async () => {
		if (saving) return;

		if (!staffDocId) {
			alert('Staff profile not found. Please contact an administrator.');
			return;
		}

		setSaving(true);
		try {
			const staffRef = doc(db, 'staff', staffDocId);
			
			// Log what we're saving
			console.log('💾 Saving availability:', dateSpecific);
			console.log('💾 Dates being saved:', Object.keys(dateSpecific));
			Object.entries(dateSpecific).forEach(([date, schedule]) => {
				console.log(`  - ${date}: enabled=${schedule.enabled}, slots=${schedule.slots?.length || 0}`);
			});
			
			await setDoc(
				staffRef,
				{
					dateSpecificAvailability: dateSpecific,
					availabilityUpdatedAt: serverTimestamp(),
				},
				{ merge: true }
			);

			const verifyDoc = await getDoc(staffRef);
			if (!verifyDoc.exists()) {
				throw new Error('Staff document was not found in Firestore');
			}

			const savedData = verifyDoc.data();
			console.log('✅ Saved successfully. Verified data:', savedData.dateSpecificAvailability);

			setSavedMessage(true);
			setTimeout(() => setSavedMessage(false), 3000);
		} catch (error) {
			console.error('Failed to save availability', error);
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			alert(`Failed to save availability: ${errorMessage}`);
		} finally {
			setSaving(false);
		}
	};

	const monthDates = useMemo(() => getMonthDates(selectedMonth), [selectedMonth]);
	const todayKey = formatDateKey(new Date());
	
	const getMonthName = (dateString: string) => {
		const date = new Date(dateString + 'T00:00:00');
		return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
	};
	
	const isCurrentMonth = (date: string) => {
		const d = new Date(date + 'T00:00:00');
		const monthStart = new Date(selectedMonth + 'T00:00:00');
		return d.getFullYear() === monthStart.getFullYear() && d.getMonth() === monthStart.getMonth();
	};

	const formatDateDisplay = (date: string) => {
		const d = new Date(date);
		return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
	};

	const currentMonthDatesOnly = useMemo(() => {
		const today = new Date();
		// zero time for comparison
		today.setHours(0, 0, 0, 0);
		return monthDates.filter(date => {
			if (!isCurrentMonth(date)) return false;
			const dateObj = new Date(date + 'T00:00:00');
			return dateObj >= today;
		});
	}, [monthDates, selectedMonth]);

	const handleOpenCopyDialog = (sourceDate: string) => {
		const sourceDateObj = new Date(sourceDate + 'T00:00:00');
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		if (sourceDateObj < today) {
			alert('You cannot copy schedules from a past date.');
			return;
		}

		const defaultTargets = currentMonthDatesOnly.filter(date => date !== sourceDate);
		if (defaultTargets.length === 0) {
			alert('No future days available this month to copy the schedule.');
			return;
		}
		setCopyDialog({
			isOpen: true,
			sourceDate,
			selectedDates: defaultTargets,
		});
	};

	const handleCloseCopyDialog = () => {
		setCopyDialog({ isOpen: false, sourceDate: null, selectedDates: [] });
	};

	const handleToggleCopyDate = (date: string) => {
		setCopyDialog(prev => {
			if (!prev.isOpen) return prev;
			const isSelected = prev.selectedDates.includes(date);
			const selectedDates = isSelected
				? prev.selectedDates.filter(item => item !== date)
				: [...prev.selectedDates, date];
			return { ...prev, selectedDates };
		});
	};

	const handleSelectAllCopyDates = () => {
		setCopyDialog(prev => {
			if (!prev.isOpen || !prev.sourceDate) return prev;
			const allTargets = currentMonthDatesOnly.filter(date => date !== prev.sourceDate);
			return { ...prev, selectedDates: allTargets };
		});
	};

	const handleClearCopyDates = () => {
		setCopyDialog(prev => ({ ...prev, selectedDates: [] }));
	};

	const handleCopyDialogSave = async () => {
		if (!copyDialog.sourceDate || copyDialog.selectedDates.length === 0) {
			alert('Select at least one day to copy the schedule.');
			return;
		}
		await copyScheduleToDates(copyDialog.sourceDate, copyDialog.selectedDates);
		handleCloseCopyDialog();
	};

	if (loading) {
		return (
			<div className="min-h-svh bg-slate-50 px-6 py-10">
				<div className="mx-auto max-w-4xl">
					<div className="py-12 text-center text-sm text-slate-500">
						<div className="loading-spinner" aria-hidden="true" />
						<span className="ml-3 align-middle">Loading availability…</span>
					</div>
				</div>
			</div>
		);
	}

	return (
		<>
			<div className="min-h-svh bg-slate-50 px-6 py-10">
				<div className="mx-auto max-w-6xl">
				<header className="mb-8">
					<p className="text-sm font-semibold uppercase tracking-wide text-sky-600">Clinical Team</p>
					<h1 className="mt-1 text-3xl font-semibold text-slate-900">My Availability</h1>
					<p className="mt-2 text-sm text-slate-600">
						Your default availability is 9 AM to 6 PM for all days except Sunday. Click on any date to mark it as unavailable.
					</p>
				</header>

				{savedMessage && (
					<div className="mb-6 alert-success">
						<i className="fas fa-check mr-2" aria-hidden="true" />
						Changes saved successfully!
					</div>
				)}

				{/* Month Selector */}
				<div className="mb-6 section-card">
					<div className="mb-4 flex items-center justify-between">
						<h3 className="text-lg font-semibold text-slate-900">{getMonthName(selectedMonth)}</h3>
						<div className="flex items-center gap-3">
							<button
								type="button"
								onClick={() => {
									const current = new Date(selectedMonth + 'T00:00:00');
									current.setMonth(current.getMonth() - 1);
									setSelectedMonth(formatDateKey(current));
								}}
								className="btn-secondary"
							>
								<i className="fas fa-chevron-left" aria-hidden="true" />
							</button>
							<input
								type="month"
								value={selectedMonth.substring(0, 7)}
								onChange={e => {
									const newDate = new Date(e.target.value + '-01T00:00:00');
									setSelectedMonth(formatDateKey(newDate));
								}}
								className="input-base"
							/>
							<button
								type="button"
								onClick={() => {
									const current = new Date(selectedMonth + 'T00:00:00');
									current.setMonth(current.getMonth() + 1);
									setSelectedMonth(formatDateKey(current));
								}}
								className="btn-secondary"
							>
								<i className="fas fa-chevron-right" aria-hidden="true" />
							</button>
							<button
								type="button"
								onClick={() => {
									const today = new Date();
									const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
									setSelectedMonth(formatDateKey(firstDay));
								}}
								className="btn-secondary text-xs"
							>
								This Month
							</button>
						</div>
					</div>
				</div>

				{/* Month Calendar Grid */}
				<div className="mb-6">
					{/* Day headers */}
					<div className="mb-2 grid grid-cols-7 gap-2">
						{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
							<div key={day} className="text-center text-xs font-semibold text-slate-600">
								{day}
							</div>
						))}
					</div>
					{/* Calendar days */}
					<div className="grid grid-cols-7 gap-2">
						{monthDates.map((date, index) => {
							const dayName = getDayName(date);
							const dateSchedule = getDateSchedule(date);
							const normalizedDate = normalizeDateKey(date);
							const hasSchedule = !!(dateSpecific[normalizedDate] || dateSpecific[date]);
							const today = new Date();
							const isToday = date === todayKey;
							const isCurrentMonthDay = isCurrentMonth(date);
							const isPastDay = date < todayKey;
							const isInactivePastDay = isPastDay && isCurrentMonthDay && !isToday;
							
							return (
								<div
									key={date}
									className={`rounded-xl border-2 p-3 transition min-h-[120px] ${
										!isCurrentMonthDay
											? 'border-slate-100 bg-slate-50 opacity-50'
											: isToday
											? 'border-sky-400 bg-sky-50'
											: hasSchedule
											? (() => {
												const schedule = dateSpecific[normalizedDate] || dateSpecific[date];
												return (schedule?.unavailableSlots?.length ?? 0) > 0;
											})()
												? 'border-amber-300 bg-amber-50'
												: 'border-emerald-300 bg-emerald-50'
											: 'border-slate-200 bg-white'
									} ${
										isInactivePastDay ? 'opacity-60 bg-slate-100 cursor-not-allowed' : ''
									}`}
								>
									<div className="mb-2 flex items-center justify-between">
										<div>
											<p className={`text-xs font-medium ${!isCurrentMonthDay ? 'text-slate-400' : 'text-slate-500'}`}>
												{isCurrentMonthDay ? dayName.substring(0, 3) : ''}
											</p>
											<p className={`text-sm font-semibold ${!isCurrentMonthDay ? 'text-slate-400' : isToday ? 'text-sky-700' : 'text-slate-900'}`}>
												{new Date(date + 'T00:00:00').getDate()}
											</p>
										</div>
										{hasSchedule && isCurrentMonthDay && (
											<button
												type="button"
												onClick={() => removeDateSchedule(date)}
												className={`text-xs text-rose-600 hover:text-rose-700 ${isInactivePastDay ? 'cursor-not-allowed opacity-40' : ''}`}
												disabled={isInactivePastDay}
												title="Remove schedule"
											>
												<i className="fas fa-times" aria-hidden="true" />
											</button>
										)}
									</div>
									{isCurrentMonthDay && (
										<>
											{(() => {
												const dayName = getDayName(date);
												const isSunday = dayName === 'Sunday';
												const normalizedDate = normalizeDateKey(date);
												const dateSchedule = dateSpecific[normalizedDate] || dateSpecific[date];
												const isUnavailable = !!dateSchedule && !dateSchedule.enabled;
												const unavailableSlots = dateSchedule?.unavailableSlots || [];
												const hasUnavailableSlots = unavailableSlots.length > 0;
												
												if (isSunday) {
													return <p className="text-xs italic text-slate-400 mb-2">Not available</p>;
												}
												
												if (isUnavailable) {
													return <p className="text-xs italic text-rose-600 mb-2">Unavailable</p>;
												}
												
												return (
													<div className="space-y-1 mb-2">
														<div className="text-xs text-emerald-600 font-medium">
															{DEFAULT_START_TIME} - {DEFAULT_END_TIME}
														</div>
														<div className="text-xs text-slate-500">Available</div>
														{hasUnavailableSlots && (
															<div className="mt-2 space-y-1">
																<div className="text-xs font-semibold text-rose-600">
																	<i className="fas fa-clock mr-1" aria-hidden="true" />
																	Unavailable:
																</div>
																{unavailableSlots
																	.filter(slot => slot.start && slot.end)
																	.map((slot, idx) => (
																		<div
																			key={idx}
																			className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1 font-medium"
																		>
																			{slot.start} - {slot.end}
																		</div>
																	))}
															</div>
														)}
													</div>
												);
											})()}
											<div className="mt-auto flex gap-1">
												{(() => {
													const dayName = getDayName(date);
													const isSunday = dayName === 'Sunday';
													const normalizedDate = normalizeDateKey(date);
													const dateSchedule = dateSpecific[normalizedDate] || dateSpecific[date];
													const isUnavailable = !!dateSchedule && !dateSchedule.enabled;
													
													if (isSunday) {
														return (
															<button
																type="button"
																disabled
																className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-400 cursor-not-allowed"
															>
																Not available
															</button>
														);
													}
													
													return (
														<>
															<button
																type="button"
																onClick={() => handleDateClick(date)}
																className={`flex-1 rounded-lg border px-2 py-1 text-xs font-medium transition ${
																	isUnavailable
																		? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:border-emerald-400 hover:bg-emerald-100'
																		: 'border-rose-300 bg-rose-50 text-rose-700 hover:border-rose-400 hover:bg-rose-100'
																} ${
																	isInactivePastDay ? 'cursor-not-allowed opacity-50 hover:border-slate-300 hover:bg-white hover:text-slate-700' : ''
																}`}
																disabled={isInactivePastDay}
															>
																{isInactivePastDay ? 'Past date' : isUnavailable ? 'Mark Available' : 'Mark Unavailable'}
															</button>
															{isUnavailable && (
																<button
																	type="button"
																	onClick={() => handleOpenCopyDialog(date)}
																	className={`rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700 ${
																		isInactivePastDay ? 'cursor-not-allowed opacity-50 hover:border-slate-300 hover:bg-white hover:text-slate-700' : ''
																	}`}
																	disabled={isInactivePastDay}
																	title="Copy unavailability to selected days"
																>
																	<i className="fas fa-copy" aria-hidden="true" />
																</button>
															)}
														</>
													);
												})()}
											</div>
										</>
									)}
								</div>
							);
						})}
					</div>
				</div>

				{/* Date Edit Modal */}
				{selectedDate && editingDateSchedule && (
					<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4 py-6">
						<div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
							<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
								<h3 className="text-lg font-semibold text-slate-900">
									Availability for {formatDateDisplay(selectedDate)}
								</h3>
								<button
									type="button"
									onClick={() => {
										setSelectedDate(null);
										setEditingDateSchedule(null);
										setAppointmentsForDate([]);
										setNewUnavailableSlot({ start: '', end: '' });
									}}
									className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
								>
									<i className="fas fa-times" aria-hidden="true" />
								</button>
							</header>
							<div className="px-6 py-4">
								{loadingAppointments ? (
									<div className="py-4 text-center text-sm text-slate-500">
										Loading appointments...
									</div>
								) : appointmentsForDate.length > 0 && (
									<div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
										<i className="fas fa-info-circle mr-2" />
										<strong>Note:</strong> You have appointments scheduled on this date. Please transfer or cancel those appointments before marking this date as unavailable.
									</div>
								)}
								
								{/* Default Availability Display */}
								<div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
									<div className="flex items-center gap-2 mb-2">
										<i className="fas fa-clock text-emerald-600" aria-hidden="true" />
										<h4 className="text-sm font-semibold text-emerald-900">Default Availability</h4>
									</div>
									<p className="text-sm text-emerald-800 mb-2">
										Your default availability is <strong>{DEFAULT_START_TIME} - {DEFAULT_END_TIME}</strong> for all days except Sunday.
									</p>
									<p className="text-xs text-emerald-700">
										Time slots are automatically generated in 30-minute intervals from {DEFAULT_START_TIME} to {DEFAULT_END_TIME}.
									</p>
								</div>

								{/* Show appointments if any */}
								{appointmentsForDate.length > 0 && (
									<div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
										<h4 className="text-xs font-semibold text-slate-700 mb-2">Scheduled Appointments:</h4>
										<div className="space-y-1">
											{appointmentsForDate
												.filter(apt => apt.status !== 'cancelled')
												.map((apt, idx) => (
													<div key={idx} className="text-xs text-slate-600">
														• {apt.time} - {apt.patient}
													</div>
												))}
										</div>
									</div>
								)}

								<div className="mt-6 border-t border-slate-200 pt-4">
									{(() => {
										const hasAnyAppointments = selectedDate && appointmentsForDate.some(apt => apt.status !== 'cancelled');
										const isUnavailable = !editingDateSchedule.enabled;
										
										return (
											<label className="flex items-center gap-3">
												<input
													type="checkbox"
													checked={editingDateSchedule.enabled}
													onChange={e => {
														if (hasAnyAppointments) {
															alert('Cannot change availability status when there are appointments assigned. Please transfer or cancel appointments first.');
															return;
														}
														setEditingDateSchedule({
															...editingDateSchedule,
															enabled: e.target.checked,
														});
													}}
													disabled={!!hasAnyAppointments}
													className="h-5 w-5 rounded border-slate-300 text-sky-600 focus:ring-sky-200 disabled:opacity-50 disabled:cursor-not-allowed"
												/>
												<span className={`text-sm font-medium ${hasAnyAppointments ? 'text-slate-400' : 'text-slate-700'}`}>
													{isUnavailable ? 'Mark as Available' : 'Mark as Unavailable'}
													{hasAnyAppointments && <span className="ml-1 text-xs text-amber-600">(Has appointments)</span>}
												</span>
											</label>
										);
									})()}
									<p className="mt-1 text-xs text-slate-500">
										{editingDateSchedule.enabled 
											? 'Uncheck to mark this date as unavailable. You will not be available for appointments on this date.'
											: 'Check to mark this date as available. You will be available from 9 AM to 6 PM on this date.'}
									</p>
								</div>

								{/* Unavailable Time Slots Section - Only show when day is enabled */}
								{editingDateSchedule.enabled && (
									<div className="mt-6 border-t border-slate-200 pt-4">
										<div className="mb-3">
											<h4 className="text-sm font-semibold text-slate-900 mb-1">
												Unavailable Time Slots
											</h4>
											<p className="text-xs text-slate-500">
												Select specific time ranges when you are unavailable on this date. The rest of the day will remain available.
											</p>
										</div>

										{/* Add Unavailable Time Range */}
										<div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
											<div className="grid grid-cols-2 gap-3 mb-3">
												<div>
													<label className="block text-xs font-medium text-slate-700 mb-1">
														Start Time
													</label>
													<input
														type="time"
														value={newUnavailableSlot.start}
														onChange={(e) => setNewUnavailableSlot({ ...newUnavailableSlot, start: e.target.value })}
														min={DEFAULT_START_TIME}
														max={DEFAULT_END_TIME}
														className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
													/>
												</div>
												<div>
													<label className="block text-xs font-medium text-slate-700 mb-1">
														End Time
													</label>
													<input
														type="time"
														value={newUnavailableSlot.end}
														onChange={(e) => setNewUnavailableSlot({ ...newUnavailableSlot, end: e.target.value })}
														min={newUnavailableSlot.start || DEFAULT_START_TIME}
														max={DEFAULT_END_TIME}
														className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
													/>
												</div>
											</div>
											<button
												type="button"
												onClick={() => {
													if (newUnavailableSlot.start && newUnavailableSlot.end) {
														const startMinutes = timeStringToMinutes(newUnavailableSlot.start);
														const endMinutes = timeStringToMinutes(newUnavailableSlot.end);
														
														if (endMinutes <= startMinutes) {
															alert('End time must be after start time.');
															return;
														}
														
														const newSlots = [...(editingDateSchedule.unavailableSlots || []), {
															start: newUnavailableSlot.start,
															end: newUnavailableSlot.end,
														}];
														setEditingDateSchedule({
															...editingDateSchedule,
															unavailableSlots: newSlots,
														});
														setNewUnavailableSlot({ start: '', end: '' });
													}
												}}
												disabled={!newUnavailableSlot.start || !newUnavailableSlot.end}
												className="w-full rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:bg-sky-100 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50 disabled:cursor-not-allowed"
											>
												<i className="fas fa-plus mr-1" aria-hidden="true" />
												Add Unavailable Time Range
											</button>
										</div>

										{/* List of Unavailable Time Slots */}
										{editingDateSchedule.unavailableSlots && editingDateSchedule.unavailableSlots.length > 0 && (
											<div className="space-y-2">
												{editingDateSchedule.unavailableSlots
													.filter(slot => slot.start && slot.end)
													.map((slot, idx) => {
														const fullSlots = editingDateSchedule.unavailableSlots?.filter(s => s.start && s.end) || [];
														const actualIdx = fullSlots.indexOf(slot);
														return (
															<div
																key={idx}
																className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-3 py-2"
															>
																<div className="flex items-center gap-2">
																	<i className="fas fa-clock text-rose-600 text-xs" aria-hidden="true" />
																	<span className="text-sm font-medium text-rose-900">
																		{slot.start} - {slot.end}
																	</span>
																</div>
																<button
																	type="button"
																	onClick={() => {
																		const newSlots = [...(editingDateSchedule.unavailableSlots || [])];
																		// Find and remove this specific slot
																		const slotIndex = newSlots.findIndex(
																			s => s.start === slot.start && s.end === slot.end
																		);
																		if (slotIndex !== -1) {
																			newSlots.splice(slotIndex, 1);
																		}
																		setEditingDateSchedule({
																			...editingDateSchedule,
																			unavailableSlots: newSlots,
																		});
																	}}
																	className="rounded p-1 text-rose-600 transition hover:bg-rose-100 focus:outline-none"
																	title="Remove unavailable time slot"
																>
																	<i className="fas fa-times text-xs" aria-hidden="true" />
																</button>
															</div>
														);
													})}
											</div>
										)}
									</div>
								)}
							</div>
							<footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
								<button
									type="button"
									onClick={() => {
										setSelectedDate(null);
										setEditingDateSchedule(null);
										setAppointmentsForDate([]);
										setNewUnavailableSlot({ start: '', end: '' });
									}}
									className="btn-secondary"
								>
									Cancel
								</button>
								<button type="button" onClick={saveDateSchedule} className="btn-primary">
									Save
								</button>
							</footer>
						</div>
					</div>
				)}


				<div className="mt-6 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700">
					<i className="fas fa-info-circle mr-2" aria-hidden="true" />
					<strong>Note:</strong> Your default availability is 9 AM to 6 PM for all days except Sunday. Click on any date to mark it as unavailable. Use the copy button to apply unavailability to multiple days.
				</div>
			</div>
		</div>

		{copyDialog.isOpen && copyDialog.sourceDate ? (
			<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4 py-6">
				<div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
					<header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
						<div>
							<p className="text-xs uppercase tracking-wide text-slate-500">Copy Schedule</p>
							<h3 className="text-lg font-semibold text-slate-900">{formatDateDisplay(copyDialog.sourceDate)}</h3>
							<p className="text-xs text-slate-500">Select the days in this month that should receive this schedule.</p>
						</div>
						<button
							type="button"
							onClick={handleCloseCopyDialog}
							className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
						>
							<i className="fas fa-times" aria-hidden="true" />
						</button>
					</header>
					<div className="px-6 py-4 space-y-4">
						<div className="flex items-center gap-3">
							<button type="button" onClick={handleSelectAllCopyDates} className="text-xs font-medium text-sky-600 hover:text-sky-700">
								Select all
							</button>
							<button type="button" onClick={handleClearCopyDates} className="text-xs font-medium text-slate-500 hover:text-slate-700">
								Clear
							</button>
						</div>
						<div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 p-3">
							<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
								{currentMonthDatesOnly
									.filter(date => date !== copyDialog.sourceDate)
									.map(date => {
										const isSelected = copyDialog.selectedDates.includes(date);
										return (
											<label
												key={date}
												className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm font-medium transition ${
													isSelected ? 'border-sky-400 bg-sky-50 text-sky-800' : 'border-slate-200 bg-white text-slate-700'
												}`}
											>
												<span>{formatDateDisplay(date)}</span>
												<input
													type="checkbox"
													checked={isSelected}
													onChange={() => handleToggleCopyDate(date)}
													className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-200"
												/>
											</label>
										);
									})}
							</div>
						</div>
					</div>
					<footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
						<button type="button" onClick={handleCloseCopyDialog} className="btn-secondary" disabled={copyingSchedule}>
							Cancel
						</button>
						<button
							type="button"
							onClick={handleCopyDialogSave}
							className="btn-primary"
							disabled={copyingSchedule || copyDialog.selectedDates.length === 0}
						>
							{copyingSchedule ? 'Copying…' : 'Copy schedule'}
						</button>
					</footer>
				</div>
			</div>
		) : null}
	</>
	);
}
