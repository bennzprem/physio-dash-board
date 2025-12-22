/**
 * Utility functions for appointment management
 */

export interface AppointmentConflict {
	hasConflict: boolean;
	conflictingAppointments: Array<{
		id: string;
		appointmentId?: string;
		patient: string;
		date: string;
		time: string;
		doctor: string;
	}>;
}

export interface AppointmentTime {
	date: string; // YYYY-MM-DD
	time: string; // HH:MM
	duration?: number; // Duration in minutes, default 30
}

/**
 * Check if two time slots overlap
 */
function timeSlotsOverlap(
	date1: string,
	time1: string,
	duration1: number,
	date2: string,
	time2: string,
	duration2: number
): boolean {
	// If different dates, no overlap
	if (date1 !== date2) return false;

	// Parse times
	const [hours1, minutes1] = time1.split(':').map(Number);
	const [hours2, minutes2] = time2.split(':').map(Number);

	const start1 = new Date(`${date1}T${time1}:00`);
	const end1 = new Date(start1.getTime() + duration1 * 60000);

	const start2 = new Date(`${date2}T${time2}:00`);
	const end2 = new Date(start2.getTime() + duration2 * 60000);

	// Check for overlap: start1 < end2 && start2 < end1
	return start1 < end2 && start2 < end1;
}

/**
 * Check for appointment conflicts
 * @param appointments - All existing appointments
 * @param newAppointment - The appointment to check (without id for new, with id for updates)
 * @param defaultDuration - Default appointment duration in minutes
 */
export function checkAppointmentConflict(
	appointments: Array<{
		id: string;
		appointmentId?: string;
		patient: string;
		doctor: string;
		date: string;
		time: string;
		status?: string;
	}>,
	newAppointment: {
		id?: string; // If provided, exclude this appointment from conflict check (for updates)
		doctor: string;
		date: string;
		time: string;
		duration?: number;
	},
	defaultDuration: number = 30
): AppointmentConflict {
	const conflictingAppointments: AppointmentConflict['conflictingAppointments'] = [];

	// Filter out cancelled appointments and the appointment being updated
	const activeAppointments = appointments.filter(
		apt =>
			apt.status !== 'cancelled' &&
			apt.doctor === newAppointment.doctor &&
			(!newAppointment.id || apt.id !== newAppointment.id)
	);

	const duration = newAppointment.duration || defaultDuration;

	for (const appointment of activeAppointments) {
		if (
			timeSlotsOverlap(
				newAppointment.date,
				newAppointment.time,
				duration,
				appointment.date,
				appointment.time,
				defaultDuration
			)
		) {
			conflictingAppointments.push({
				id: appointment.id,
				appointmentId: appointment.appointmentId,
				patient: appointment.patient,
				date: appointment.date,
				time: appointment.time,
				doctor: appointment.doctor,
			});
		}
	}

	return {
		hasConflict: conflictingAppointments.length > 0,
		conflictingAppointments,
	};
}

/**
 * Check if appointment time is within staff availability
 * Uses date-specific availability schedule, with default availability (9 AM - 6 PM) for all days except Sunday
 */
export function checkAvailabilityConflict(
	dateSpecificAvailability: {
		[date: string]: {
			enabled: boolean;
			slots: Array<{ start: string; end: string }>;
		};
	} | undefined,
	date: string,
	time: string,
	duration: number = 30
): { isAvailable: boolean; reason?: string } {
	const appointmentDate = new Date(date);
	const dateKey = date; // YYYY-MM-DD format
	const dayName = appointmentDate.toLocaleDateString('en-US', { weekday: 'long' });
	const isSunday = dayName === 'Sunday';
	
	// Sunday is always unavailable
	if (isSunday) {
		return {
			isAvailable: false,
			reason: 'Sunday is not available for scheduling',
		};
	}
	
	// Default availability: 9 AM to 6 PM for all days except Sunday
	const DEFAULT_START_TIME = '09:00';
	const DEFAULT_END_TIME = '18:00';
	
	// Check for date-specific schedule
	const daySchedule = dateSpecificAvailability?.[dateKey];

	// If date-specific schedule exists and is marked as unavailable (enabled: false)
	if (daySchedule && !daySchedule.enabled) {
		return {
			isAvailable: false,
			reason: `Date is marked as unavailable`,
		};
	}

	// Use default availability if no date-specific schedule exists, or if date-specific schedule is enabled
	const slots = daySchedule?.enabled && daySchedule.slots?.length > 0 
		? daySchedule.slots 
		: [{ start: DEFAULT_START_TIME, end: DEFAULT_END_TIME }];

	// Parse appointment time
	const [hours, minutes] = time.split(':').map(Number);
	const appointmentStart = new Date(appointmentDate);
	appointmentStart.setHours(hours, minutes, 0, 0);
	const appointmentEnd = new Date(appointmentStart.getTime() + duration * 60000);

	// Check if appointment fits within any available slot
	for (const slot of slots) {
		const [slotStartHours, slotStartMinutes] = slot.start.split(':').map(Number);
		const [slotEndHours, slotEndMinutes] = slot.end.split(':').map(Number);

		const slotStart = new Date(appointmentDate);
		slotStart.setHours(slotStartHours, slotStartMinutes, 0, 0);

		const slotEnd = new Date(appointmentDate);
		slotEnd.setHours(slotEndHours, slotEndMinutes, 0, 0);

		// Handle slots that span midnight
		if (slotEnd <= slotStart) {
			slotEnd.setDate(slotEnd.getDate() + 1);
		}

		// Check if appointment is completely within this slot
		if (appointmentStart >= slotStart && appointmentEnd <= slotEnd) {
			return { isAvailable: true };
		}
	}

	return {
		isAvailable: false,
		reason: `Time slot ${time} is not within available hours (${DEFAULT_START_TIME} - ${DEFAULT_END_TIME}) on ${dayName}`,
	};
}

/**
 * Generate recurring appointment dates
 */
export function generateRecurringDates(
	startDate: string,
	frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly',
	count: number
): string[] {
	const dates: string[] = [];
	const current = new Date(startDate);

	for (let i = 0; i < count; i++) {
		dates.push(current.toISOString().split('T')[0]);

		switch (frequency) {
			case 'daily':
				current.setDate(current.getDate() + 1);
				break;
			case 'weekly':
				current.setDate(current.getDate() + 7);
				break;
			case 'biweekly':
				current.setDate(current.getDate() + 14);
				break;
			case 'monthly':
				current.setMonth(current.getMonth() + 1);
				break;
		}
	}

	return dates;
}

