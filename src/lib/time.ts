const DAY_MS = 86_400_000;
const TIME: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

/** "Today 7:42 PM", "Yesterday 9:10 PM", "Sat 7:42 PM", or a date for anything older than a week. */
export function relativeLabel(date: Date, now: Date, locale?: string): string {
  const time = new Intl.DateTimeFormat(locale, TIME).format(date);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  if (days > 1 && days < 7) return `${new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date)} ${time}`;
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(date);
}

/** "Sat, Nov 28": how the summary and the KKB text name the day. */
export const DATE_LABEL: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };

/** The dining day: the first confirmed round's date, else today (nothing was confirmed yet), in the device's locale. */
export function dineDate(rounds: readonly { confirmedAt: string | null }[], now: Date, locale?: string): string {
  const first = rounds.flatMap((r) => (r.confirmedAt ? [r.confirmedAt] : [])).sort()[0];
  return new Intl.DateTimeFormat(locale, DATE_LABEL).format(first ? new Date(first) : now);
}
