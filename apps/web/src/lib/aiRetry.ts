/** Seconds left until a RATE_LIMITED retry is allowed. */
export function secondsLeft(until: number | null, now = Date.now()) { return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0; }
