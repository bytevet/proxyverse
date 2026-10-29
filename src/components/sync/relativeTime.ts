// one formatter per locale: building them is costly, and the sync status
// recomputes every 30 seconds
const formatters = new Map<string, Intl.RelativeTimeFormat>();
const formatter = (locale: string) => {
  let rtf = formatters.get(locale);
  if (!rtf) {
    rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    formatters.set(locale, rtf);
  }
  return rtf;
};

// each unit, and how many of it make the next one
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["minute", 60],
  ["hour", 24],
  ["day", 7],
];

/**
 * How long ago `then` was, e.g. "5 minutes ago" or "yesterday", in `locale`.
 * Under a minute reads as `recent` (e.g. "a few seconds ago"): Intl only has
 * "now" for it, which reads oddly after "Last synced". Counts whole units,
 * as clocks do: 90 seconds is "1 minute ago".
 */
export function relativeTime(
  then: number,
  now: number,
  locale: string,
  recent: string
): string {
  const seconds = (then - now) / 1000;
  if (Math.abs(seconds) < 60) return recent;

  // whole units, toward zero for past and future alike
  const whole = (v: number) => Math.sign(v) * Math.floor(Math.abs(v));
  let value = seconds / 60;
  for (const [unit, next] of UNITS) {
    if (Math.abs(value) < next) return formatter(locale).format(whole(value), unit);
    value /= next;
  }
  return formatter(locale).format(whole(value), "week");
}
