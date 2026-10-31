// Commerce 2 (2026-10-31) — a calendar date (a Postgres DATE such as
// subscription.next_delivery_date, sent as "YYYY-MM-DD") shown as the same
// day everywhere. new Date("2026-11-14") is UTC midnight, which a browser in
// US time renders as November 13; this pins it to noon UTC and formats in UTC.
// A full ISO timestamp is accepted too (its date part is used).
export function formatCalendarDate(value: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' }): string {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
}
