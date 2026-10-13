// Game days run midnight to midnight in India Standard Time for everyone (see docs/brainstorm.md).
// Dates are plain 'YYYY-MM-DD' strings, so they compare and sort correctly as text.

export const GAME_TIME_ZONE = 'Asia/Kolkata';

const istParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: GAME_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The IST calendar date ('YYYY-MM-DD') at a given instant. */
export function istDate(at: Date): string {
  const parts = Object.fromEntries(istParts.formatToParts(at).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** The instant an IST date starts (00:00 IST). */
export function istDayStart(date: string): Date {
  return new Date(`${date}T00:00:00+05:30`);
}

/** Adds (or subtracts) whole days to a 'YYYY-MM-DD' date. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive if `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Monday of the week containing `date`. Leaderboard weeks and streak freezes use Monday to Sunday. */
export function weekStart(date: string): string {
  const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dayOfWeek + 6) % 7));
}
