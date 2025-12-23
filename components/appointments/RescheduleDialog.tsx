'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot, type QuerySnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { checkAppointmentConflict } from '@/lib/appointmentUtils';

interface DayAvailability {
	enabled: boolean;
	slots: Array<{ start: string; end: string }>;
}

interface StaffMember {
	id: string;
	name: string;
	availability?: {
		[day: string]: DayAvailability;
	};
	dateSpecificAvailability?: {
		[date: string]: DayAvailability;
	};
}

interface RescheduleDialogProps {
	isOpen: boolean;
	appointment: {
		id: string;
		appointmentId?: string;
		patient: string;
		doctor: string;
		date: string;
		time: string;
	} | null;
	onClose: () => void;
	onConfirm: (newDate: string, newTime: string) => Promise<void>;
	allAppointments: Array<{
		id: string;
		appointmentId?: string;
		patient: string;
		doctor: string;
		date: string;
		time: string;
		status?: string;
		duration?: number;
	}>;
	staff?: StaffMember[];
}

const SLOT_INTERVAL_MINUTES = 30;

function timeStringToMinutes(value: string) {
	const [hours, minutes] = value.split(':').map(Number);
	if (Number.isNaN(hours) || Number.isNaN(minutes)) return 0;
	return hours * 60 + minutes;
}

function minutesToTimeString(totalMinutes: number) {
	const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
	const hours = Math.floor(normalized / 60);
	const minutes = normalized % 60;
	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatDateKey(dateString: string): string {
	if (!dateString) return '';
	const date = new Date(dateString + 'T00:00:00');
	if (Number.isNaN(date.getTime())) return dateString;
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function getDayOfWeek(dateString: string): string {
	if (!dateString) return '';
	const date = new Date(dateString + 'T00:00:00');
	if (Number.isNaN(date.getTime())) return '';
	const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
	return days[date.getDay()];
}

export default function RescheduleDialog({
	isOpen,
	appointment,
	onClose,
	onConfirm,
	allAppointments,
	staff = [],
}: RescheduleDialogProps) {
	const [newDate, setNewDate] = useState('');
	const [newTime, setNewTime] = useState('');
	const [selectedTimeSlot, setSelectedTimeSlot] = useState<string>('');
	const [conflict, setConflict] = useState<{ hasConflict: boolean; conflictingAppointments: any[] } | null>(null);
	const [checkingConflict, setCheckingConflict] = useState(false);
	const [saving, setSaving] = useState(false);
	const [allClinicianAppointments, setAllClinicianAppointments] = useState<Array<{ id?: string; doctor: string; date: string; time: string; status: string; duration?: number }>>([]);

	// Default availability: 9 AM to 6 PM for all days except Sunday
	const DEFAULT_START_TIME = '09:00';
	const DEFAULT_END_TIME = '18:00';
	const DEFAULT_DAY_AVAILABILITY: DayAvailability = {
		enabled: true,
		slots: [{ start: DEFAULT_START_TIME, end: DEFAULT_END_TIME }],
	};

	// Get availability for a specific date (checks date-specific, falls back to default availability)
	const getDateAvailability = (staffMember: StaffMember, dateString: string): DayAvailability | null => {
		const dateKey = formatDateKey(dateString);
		const dateObj = new Date(dateString + 'T00:00:00');
		const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
		const isSunday = dayName === 'Sunday';
		
		// Sunday is always unavailable
		if (isSunday) {
			return { enabled: false, slots: [] };
		}
		
		// First, check for date-specific availability
		if (staffMember.dateSpecificAvailability?.[dateKey]) {
			const dateSpecific = staffMember.dateSpecificAvailability[dateKey];
			// If marked as unavailable (enabled: false), return it
			if (!dateSpecific.enabled) {
				return dateSpecific;
			}
			// If enabled, use the date-specific schedule
			return dateSpecific;
		}
		
		// No date-specific schedule exists - use default availability (9 AM - 6 PM)
		return DEFAULT_DAY_AVAILABILITY;
	};

	// Fetch all appointments for the selected clinician (across all dates to find latest appointment)
	useEffect(() => {
		if (!isOpen || !appointment?.doctor) {
			setAllClinicianAppointments([]);
			return;
		}

		// Fetch all appointments for this clinician (not just the selected date)
		// This allows us to find the latest appointment across all dates
		const appointmentsQuery = query(
			collection(db, 'appointments'),
			where('doctor', '==', appointment.doctor)
		);

		const unsubscribe = onSnapshot(
			appointmentsQuery,
			(snapshot: QuerySnapshot) => {
				const mapped = snapshot.docs.map(docSnap => {
					const data = docSnap.data();
					return {
						id: docSnap.id,
						doctor: data.doctor ? String(data.doctor) : '',
						date: data.date ? String(data.date) : '',
						time: data.time ? String(data.time) : '',
						status: data.status ? String(data.status) : 'pending',
						duration: typeof data.duration === 'number' ? data.duration : undefined,
					};
				});
				setAllClinicianAppointments(mapped);
			},
			error => {
				console.error('Failed to load appointments for slot filtering', error);
				setAllClinicianAppointments([]);
			}
		);

		return () => unsubscribe();
	}, [isOpen, appointment?.doctor]);

	// Generate available time slots based on staff availability and existing appointments
	const availableTimeSlots = useMemo(() => {
		if (!appointment?.doctor || !newDate) {
			return [];
		}

		const selectedStaff = staff.find(s => s.name === appointment.doctor);
		if (!selectedStaff) {
			return [];
		}

		const dayAvailability = getDateAvailability(selectedStaff, newDate);
		if (!dayAvailability || !dayAvailability.enabled || !dayAvailability.slots || dayAvailability.slots.length === 0) {
			return [];
		}

		// Get all booked appointments for this staff and date
		// Use allClinicianAppointments (fetched from Firestore) to filter out ALL appointments for this clinician
		const bookedSlotSet = new Set<string>();
		const normalizedFormDate = formatDateKey(newDate);
		allClinicianAppointments
			.filter(apt => {
				// Filter by status (exclude cancelled)
				if (apt.status === 'cancelled') {
					return false;
				}
				// Only consider appointments on the selected date for booked slots
				// Normalize dates for comparison
				if (!apt.date || formatDateKey(apt.date) !== normalizedFormDate) {
					return false;
				}
				// Exclude the appointment we're currently rescheduling
				if (appointment?.id && apt.id === appointment.id) {
					return false;
				}
				return true;
			})
			.forEach(apt => {
				if (!apt.time) return;
				const durationMinutes = Math.max(SLOT_INTERVAL_MINUTES, apt.duration ?? SLOT_INTERVAL_MINUTES);
				const blocks = Math.ceil(durationMinutes / SLOT_INTERVAL_MINUTES);
				const startMinutes = timeStringToMinutes(apt.time);
				for (let block = 0; block < blocks; block += 1) {
					const blockStartMinutes = startMinutes + block * SLOT_INTERVAL_MINUTES;
					bookedSlotSet.add(minutesToTimeString(blockStartMinutes));
				}
			});
		const bookedSlots = [...bookedSlotSet];
		
		// Find the latest (last) appointment across ALL dates
		// If there's an appointment on or before the selected date, filter out slots at or before its end time on the selected date
		const appointmentsWithDates = allClinicianAppointments
			.filter(apt => {
				if (apt.status === 'cancelled') return false;
				if (appointment?.id && apt.id === appointment.id) return false;
				return apt.time && apt.date;
			})
			.map(apt => {
				const durationMinutes = Math.max(SLOT_INTERVAL_MINUTES, apt.duration ?? SLOT_INTERVAL_MINUTES);
				const startMinutes = timeStringToMinutes(apt.time!);
				const endMinutes = startMinutes + durationMinutes;
				return {
					date: apt.date!,
					time: apt.time!,
					duration: durationMinutes,
					endTime: minutesToTimeString(endMinutes),
				};
			})
			.sort((a, b) => {
				// Sort by date first, then by end time (to find the chronologically latest appointment)
				const dateCompare = a.date.localeCompare(b.date);
				if (dateCompare !== 0) return dateCompare;
				return a.endTime.localeCompare(b.endTime);
			});
		
		// Find the latest appointment that is on or before the selected date
		// Normalize dates for comparison (ensure YYYY-MM-DD format)
		const latestAppointment = appointmentsWithDates
			.filter(apt => {
				const normalizedAptDate = formatDateKey(apt.date);
				return normalizedAptDate <= normalizedFormDate;
			})
			.pop() || null;
		
		// Only filter by latest appointment end time if the latest appointment is on the same date
		// We use end time to ensure slots after the appointment ends are available
		const latestAppointmentEndTime = latestAppointment && formatDateKey(latestAppointment.date) === normalizedFormDate ? latestAppointment.endTime : null;

		// Get current date and time for filtering past slots
		const now = new Date();
		const selectedDate = new Date(newDate + 'T00:00:00');
		const isToday = selectedDate.toDateString() === now.toDateString();
		const currentTimeString = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

		// Generate 30-minute slots from availability ranges
		const slots: string[] = [];
		
		dayAvailability.slots.forEach((slot) => {
			if (!slot.start || !slot.end) return;

			const [startHour, startMin] = slot.start.split(':').map(Number);
			const [endHour, endMin] = slot.end.split(':').map(Number);

			if (isNaN(startHour) || isNaN(startMin) || isNaN(endHour) || isNaN(endMin)) return;

			const startTime = new Date();
			startTime.setHours(startHour, startMin, 0, 0);
			const endTime = new Date();
			endTime.setHours(endHour, endMin, 0, 0);

			if (endTime < startTime) {
				endTime.setDate(endTime.getDate() + 1);
			}

			let currentTime = new Date(startTime);
			while (currentTime < endTime) {
				const timeString = `${String(currentTime.getHours()).padStart(2, '0')}:${String(currentTime.getMinutes()).padStart(2, '0')}`;
				
				// Filter out booked slots
				if (bookedSlots.includes(timeString)) {
					currentTime.setMinutes(currentTime.getMinutes() + SLOT_INTERVAL_MINUTES);
					continue;
				}

				// Filter out slots at or before the latest (last) appointment's end time
				// This ensures the next appointment is booked after the last existing appointment ends
				if (latestAppointmentEndTime && timeString <= latestAppointmentEndTime) {
					currentTime.setMinutes(currentTime.getMinutes() + SLOT_INTERVAL_MINUTES);
					continue;
				}

				// Filter out slots whose END time has passed for today
				if (isToday) {
					// Calculate slot end time (start time + 30 minutes)
					const slotEndTime = new Date(currentTime);
					slotEndTime.setMinutes(slotEndTime.getMinutes() + SLOT_INTERVAL_MINUTES);
					const slotEndTimeString = `${String(slotEndTime.getHours()).padStart(2, '0')}:${String(slotEndTime.getMinutes()).padStart(2, '0')}`;
					
					// Only hide slots whose END time has passed
					if (slotEndTimeString <= currentTimeString) {
						currentTime.setMinutes(currentTime.getMinutes() + SLOT_INTERVAL_MINUTES);
						continue;
					}
				}
				
				slots.push(timeString);
				currentTime.setMinutes(currentTime.getMinutes() + SLOT_INTERVAL_MINUTES);
			}
		});

		return [...new Set(slots)].sort();
	}, [newDate, appointment?.doctor, staff, allClinicianAppointments, appointment?.id]);

	useEffect(() => {
		if (isOpen && appointment) {
			setNewDate(appointment.date);
			setNewTime(appointment.time);
			setSelectedTimeSlot('');
			setConflict(null);
		}
	}, [isOpen, appointment]);

	// Update newTime when time slot is selected
	useEffect(() => {
		if (selectedTimeSlot) {
			setNewTime(selectedTimeSlot);
		}
	}, [selectedTimeSlot]);

	useEffect(() => {
		const finalTime = selectedTimeSlot || newTime;
		if (!isOpen || !appointment || !newDate || !finalTime) {
			setConflict(null);
			return;
		}

		// Debounce conflict check
		const timeoutId = setTimeout(async () => {
			if (newDate === appointment.date && finalTime === appointment.time) {
				setConflict(null);
				return;
			}

			setCheckingConflict(true);
			try {
				const conflictResult = checkAppointmentConflict(
					allAppointments,
					{
						id: appointment.id,
						doctor: appointment.doctor,
						date: newDate,
						time: finalTime,
					},
					30
				);
				setConflict(conflictResult);
			} catch (error) {
				console.error('Error checking conflict:', error);
			} finally {
				setCheckingConflict(false);
			}
		}, 500);

		return () => clearTimeout(timeoutId);
	}, [newDate, newTime, selectedTimeSlot, appointment, allAppointments, isOpen]);

	if (!isOpen || !appointment) return null;

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		
		// Use selectedTimeSlot if available, otherwise use newTime
		const finalTime = selectedTimeSlot || newTime;
		
		if (!finalTime) {
			alert('Please select a time slot.');
			return;
		}

		if (conflict?.hasConflict) {
			alert('Cannot reschedule: There is a conflict with another appointment. Please choose a different time.');
			return;
		}

		setSaving(true);
		try {
			await onConfirm(newDate, finalTime);
			onClose();
		} catch (error) {
			console.error('Failed to reschedule:', error);
			alert('Failed to reschedule appointment. Please try again.');
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
			<div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-xl font-semibold text-slate-900">Reschedule Appointment</h2>
					<button
						type="button"
						onClick={onClose}
						className="text-slate-400 hover:text-slate-600"
						aria-label="Close"
					>
						<i className="fas fa-times" />
					</button>
				</div>

				<div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
					<p className="text-sm font-medium text-slate-700">Patient: {appointment.patient}</p>
					<p className="text-sm text-slate-600">Doctor: {appointment.doctor}</p>
					<p className="text-sm text-slate-600">
						Current: {appointment.date} at {appointment.time}
					</p>
				</div>

				<form onSubmit={handleSubmit} className="space-y-4">
					<div>
						<label className="block text-sm font-medium text-slate-700 mb-1">New Date</label>
						<input
							type="date"
							value={newDate}
							onChange={e => {
								setNewDate(e.target.value);
								setSelectedTimeSlot('');
								setNewTime('');
							}}
							required
							min={new Date().toISOString().split('T')[0]}
							className="input-base"
						/>
					</div>

					<div>
						<label className="block text-sm font-medium text-slate-700 mb-1">
							New Time <span className="text-rose-500">*</span>
						</label>
						{newDate && availableTimeSlots.length > 0 ? (
							<div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
								{availableTimeSlots.map(slot => {
									const slotEnd = minutesToTimeString(timeStringToMinutes(slot) + SLOT_INTERVAL_MINUTES);
									const isSelected = selectedTimeSlot === slot;
									return (
										<button
											key={slot}
											type="button"
											onClick={() => {
												setSelectedTimeSlot(isSelected ? '' : slot);
												setNewTime(isSelected ? '' : slot);
											}}
											className={`rounded-xl border px-3 py-2 text-sm font-medium shadow-sm transition ${
												isSelected
													? 'border-sky-500 bg-sky-50 text-sky-800 ring-2 ring-sky-200'
													: 'border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50'
											}`}
											aria-pressed={isSelected}
										>
											<div className="flex items-center justify-between">
												<div>
													<p className="font-semibold">{slot} – {slotEnd}</p>
													<p className="text-xs text-slate-500">30 minutes</p>
												</div>
												<span className={`text-xs ${isSelected ? 'text-sky-600' : 'text-slate-400'}`}>
													<i
														className={`fas ${isSelected ? 'fa-check-circle' : 'fa-clock'}`}
														aria-hidden="true"
													/>
												</span>
											</div>
										</button>
									);
								})}
							</div>
						) : newDate ? (
							<div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
								<i className="fas fa-calendar-times mr-2" aria-hidden="true" />
								No slots available. The clinician has not set a schedule for this date. Please select another date.
							</div>
						) : (
							<input
								type="time"
								value={newTime}
								onChange={e => setNewTime(e.target.value)}
								required
								className="input-base"
							/>
						)}
					</div>

					{checkingConflict && (
						<div className="text-sm text-slate-500">
							<i className="fas fa-spinner fa-spin mr-2" />
							Checking for conflicts...
						</div>
					)}

					{conflict?.hasConflict && (
						<div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
							<p className="text-sm font-medium text-rose-700 mb-2">
								<i className="fas fa-exclamation-triangle mr-2" />
								Conflict detected!
							</p>
							<ul className="text-xs text-rose-600 space-y-1">
								{conflict.conflictingAppointments.map(apt => (
									<li key={apt.id}>
										{apt.patient} - {apt.date} at {apt.time}
									</li>
								))}
							</ul>
						</div>
					)}

					{conflict && !conflict.hasConflict && (newDate !== appointment.date || (selectedTimeSlot || newTime) !== appointment.time) && (
						<div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
							<i className="fas fa-check-circle mr-2" />
							No conflicts detected
						</div>
					)}

					<div className="flex gap-3 justify-end">
						<button
							type="button"
							onClick={onClose}
							className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={saving || conflict?.hasConflict || checkingConflict}
							className="btn-primary"
						>
							{saving ? 'Rescheduling...' : 'Reschedule'}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}

