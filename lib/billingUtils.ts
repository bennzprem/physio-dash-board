/**
 * Billing utilities for cycle management and billing operations
 */

export interface BillingCycle {
	id: string;
	startDate: string; // YYYY-MM-DD
	endDate: string; // YYYY-MM-DD
	month: number; // 1-12
	year: number;
	status: 'active' | 'closed' | 'pending';
	createdAt: string;
	closedAt?: string;
}

/**
 * Get current billing cycle (month)
 */
export function getCurrentBillingCycle(): { month: number; year: number; startDate: string; endDate: string } {
	const now = new Date();
	const year = now.getFullYear();
	const month = now.getMonth() + 1; // 1-12
	
	// First day of current month
	const startDate = new Date(year, month - 1, 1);
	// Last day of current month
	const endDate = new Date(year, month, 0);
	
	return {
		month,
		year,
		startDate: formatDate(startDate),
		endDate: formatDate(endDate),
	};
}

/**
 * Get billing cycle for a specific date
 */
export function getBillingCycleForDate(date: Date | string): { month: number; year: number; startDate: string; endDate: string } {
	const d = typeof date === 'string' ? new Date(date) : date;
	const year = d.getFullYear();
	const month = d.getMonth() + 1;
	
	const startDate = new Date(year, month - 1, 1);
	const endDate = new Date(year, month, 0);
	
	return {
		month,
		year,
		startDate: formatDate(startDate),
		endDate: formatDate(endDate),
	};
}

/**
 * Format date as YYYY-MM-DD
 */
export function formatDate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

/**
 * Get billing cycle ID (format: YYYY-MM)
 */
export function getBillingCycleId(month?: number, year?: number): string {
	const now = new Date();
	const m = month ?? now.getMonth() + 1;
	const y = year ?? now.getFullYear();
	return `${y}-${String(m).padStart(2, '0')}`;
}

/**
 * Check if a date is within a billing cycle
 */
export function isDateInBillingCycle(date: Date | string, cycleStart: string, cycleEnd: string): boolean {
	const d = typeof date === 'string' ? new Date(date) : date;
	const start = new Date(cycleStart);
	const end = new Date(cycleEnd);
	end.setHours(23, 59, 59, 999); // Include entire end date
	return d >= start && d <= end;
}

/**
 * Get previous billing cycle
 */
export function getPreviousBillingCycle(): { month: number; year: number; startDate: string; endDate: string } {
	const now = new Date();
	const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
	const month = now.getMonth() === 0 ? 12 : now.getMonth();
	
	const startDate = new Date(year, month - 1, 1);
	const endDate = new Date(year, month, 0);
	
	return {
		month,
		year,
		startDate: formatDate(startDate),
		endDate: formatDate(endDate),
	};
}

/**
 * Get next billing cycle
 */
export function getNextBillingCycle(): { month: number; year: number; startDate: string; endDate: string } {
	const now = new Date();
	const year = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
	const month = now.getMonth() === 11 ? 1 : now.getMonth() + 2;
	
	const startDate = new Date(year, month - 1, 1);
	const endDate = new Date(year, month, 0);
	
	return {
		month,
		year,
		startDate: formatDate(startDate),
		endDate: formatDate(endDate),
	};
}

/**
 * Get month name from number
 */
export function getMonthName(month: number): string {
	const months = [
		'January', 'February', 'March', 'April', 'May', 'June',
		'July', 'August', 'September', 'October', 'November', 'December'
	];
	return months[month - 1] || '';
}

/**
 * Get current calendar year start and end dates
 */
export function getCurrentCalendarYear(): { startDate: string; endDate: string } {
	const now = new Date();
	const year = now.getFullYear();
	const startDate = new Date(year, 0, 1); // January 1
	const endDate = new Date(year, 11, 31); // December 31
	return {
		startDate: formatDate(startDate),
		endDate: formatDate(endDate),
	};
}



