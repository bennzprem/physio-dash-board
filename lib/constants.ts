/** Maximum total sessions allowed per patient. When adding a package, (current total + package sessions) must not exceed this. */
export const MAX_TOTAL_SESSIONS_PER_PATIENT = 999;

/** Parse totalSessionsRequired from raw data and cap to max. Use when reading existing package data. */
export function parseAndCapTotalSessions(raw: unknown): number | undefined {
	const v = typeof raw === 'number' ? raw : raw ? Number(raw) : undefined;
	if (v == null || Number.isNaN(v)) return undefined;
	return Math.min(v, MAX_TOTAL_SESSIONS_PER_PATIENT);
}
