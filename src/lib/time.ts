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
