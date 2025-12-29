import type { SessionAllowance } from './types';

export const DYES_ANNUAL_SESSION_CAP = 500;
export const DYES_SESSION_RATE = 500; // Default session rate for DYES patients in rupees

export interface AllowanceRefreshResult {
	allowance: SessionAllowance;
	resetsApplied: number;
}

export function getUpcomingJanuaryFirstUTC(fromDate = new Date()): Date {
	return new Date(Date.UTC(fromDate.getUTCFullYear() + 1, 0, 1, 0, 0, 0, 0));
}

export function getCurrentJanuaryFirstUTC(fromDate = new Date()): Date {
	return new Date(Date.UTC(fromDate.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
}

export function createInitialSessionAllowance(now = new Date()): SessionAllowance {
	return {
		annualFreeSessionCap: DYES_ANNUAL_SESSION_CAP,
		freeSessionsUsed: 0,
		pendingPaidSessions: 0,
		pendingChargeAmount: 0,
		nextResetAt: getUpcomingJanuaryFirstUTC(now).toISOString(),
		lastResetAt: getCurrentJanuaryFirstUTC(now).toISOString(),
		lastUpdatedAt: now.toISOString(),
	};
}

export function normalizeSessionAllowance(
	raw?: Partial<SessionAllowance> | null,
	now = new Date()
): SessionAllowance {
	if (!raw) {
		return createInitialSessionAllowance(now);
	}

	return {
		annualFreeSessionCap: Number(raw.annualFreeSessionCap) || DYES_ANNUAL_SESSION_CAP,
		freeSessionsUsed: Math.max(0, Number(raw.freeSessionsUsed) || 0),
		pendingPaidSessions: Math.max(0, Number(raw.pendingPaidSessions) || 0),
		pendingChargeAmount: Math.max(0, Number(raw.pendingChargeAmount) || 0),
		nextResetAt: raw.nextResetAt || getUpcomingJanuaryFirstUTC(now).toISOString(),
		lastResetAt: raw.lastResetAt ?? null,
		lastUpdatedAt: raw.lastUpdatedAt ?? now.toISOString(),
	};
}

export function refreshSessionAllowanceIfNeeded(
	allowance: SessionAllowance,
	now = new Date()
): AllowanceRefreshResult {
	const updated: SessionAllowance = { ...allowance };

	let resetsApplied = 0;
	let nextReset = allowance.nextResetAt ? new Date(allowance.nextResetAt) : getUpcomingJanuaryFirstUTC(now);
	if (Number.isNaN(nextReset.getTime())) {
		nextReset = getUpcomingJanuaryFirstUTC(now);
	}

	while (now >= nextReset) {
		resetsApplied += 1;
		updated.freeSessionsUsed = 0;
		updated.lastResetAt = nextReset.toISOString();
		nextReset = getUpcomingJanuaryFirstUTC(nextReset);
	}

	if (resetsApplied > 0) {
		updated.nextResetAt = nextReset.toISOString();
	}

	updated.lastUpdatedAt = now.toISOString();

	return {
		allowance: updated,
		resetsApplied,
	};
}

export function getRemainingFreeSessions(allowance: SessionAllowance): number {
	return Math.max(0, allowance.annualFreeSessionCap - allowance.freeSessionsUsed);
}

