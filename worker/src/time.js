/* Clinic-local time helpers. Bookings are stored as ISO UTC; opening hours are
   interpreted in the clinic timezone (Europe/London), so we need the UTC offset
   for any given date to convert wall-clock slots to UTC instants. */

const TZ = 'Europe/London';

/** UTC offset in minutes for the given date in the clinic timezone. */
export function tzOffsetMinutes(dateStr) {
  const probe = new Date(dateStr + 'T12:00:00Z');
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(probe).map(p => [p.type, p.value]));
  const asLocal = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return Math.round((asLocal - probe.getTime()) / 60000);
}

/** "YYYY-MM-DD" + "HH:MM" wall-clock in clinic tz -> ISO UTC string. */
export function localToUtcIso(dateStr, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const offset = tzOffsetMinutes(dateStr);
  const ms = Date.UTC(...dateStr.split('-').map((v, i) => (i === 1 ? +v - 1 : +v)), h, m) - offset * 60000;
  return new Date(ms).toISOString();
}

/** ISO UTC -> "HH:MM" wall-clock in clinic tz. */
export function utcIsoToLocalHHMM(iso) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

/** Day-of-week (0=Sunday) of a YYYY-MM-DD in the clinic tz. */
export function localWeekday(dateStr) {
  return new Date(dateStr + 'T12:00:00Z').getUTCDay();
}

/** Today's date string in the clinic tz. */
export function todayLocal() {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date());
}
