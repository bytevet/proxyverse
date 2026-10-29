/**
 * Hybrid logical clock (spec §3.3): `TTTTTTTTTTTTTTT:CCCC:DEVICEID`, where T
 * is milliseconds since the epoch (15 digits), C a counter (4 digits) and
 * the device ID breaks ties. The fixed widths make a plain string compare
 * the clock order, which is how the server decides last-writer-wins.
 */

export type HLCParts = { time: number; counter: number; deviceID: string };

const HLC_PATTERN = /^\d{15}:\d{4}:[A-Za-z0-9-]{1,64}$/;
const MAX_TIME = 10 ** 15 - 1;
const MAX_COUNTER = 9999;

export const isHLC = (v: unknown): v is string =>
  typeof v === "string" && HLC_PATTERN.test(v);

export function formatHLC({ time, counter, deviceID }: HLCParts): string {
  if (!Number.isSafeInteger(time) || time < 0 || time > MAX_TIME) {
    throw RangeError(`HLC time out of range: ${time}`);
  }
  if (!Number.isInteger(counter) || counter < 0 || counter > MAX_COUNTER) {
    throw RangeError(`HLC counter out of range: ${counter}`);
  }
  const hlc = `${String(time).padStart(15, "0")}:${String(counter).padStart(
    4,
    "0"
  )}:${deviceID}`;
  if (!isHLC(hlc)) throw RangeError(`Invalid HLC device ID: ${deviceID}`);
  return hlc;
}

/** The parts of an HLC, or undefined if it isn't one. */
export function parseHLC(hlc: string): HLCParts | undefined {
  if (!isHLC(hlc)) return undefined;
  return {
    time: Number(hlc.slice(0, 15)),
    counter: Number(hlc.slice(16, 20)),
    deviceID: hlc.slice(21),
  };
}

/** Clock order: negative if `a` is older than `b`, 0 if equal. */
export const compareHLC = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/**
 * The HLC for a new local edit. It's never lower than `last` (the device's
 * clock, spec §5.1 `clock`), even when the wall clock goes backwards; the
 * counter orders edits within one millisecond. A counter past 9999 moves to
 * the next millisecond instead, keeping the fixed width.
 */
export function tickHLC(
  last: string | undefined,
  deviceID: string,
  now: number
): string {
  const prev = last === undefined ? undefined : parseHLC(last);
  const wall = Math.floor(now);
  if (!prev || wall > prev.time) {
    return formatHLC({ time: wall, counter: 0, deviceID });
  }
  return prev.counter < MAX_COUNTER
    ? formatHLC({ time: prev.time, counter: prev.counter + 1, deviceID })
    : formatHLC({ time: prev.time + 1, counter: 0, deviceID });
}

/**
 * The clock after seeing a remote record's HLC: the later of the two, so
 * the next local edit sorts after everything this device has seen. An
 * invalid `received` is ignored.
 */
export function observeHLC(
  last: string | undefined,
  received: string
): string | undefined {
  if (!isHLC(received)) return last;
  if (last === undefined || !isHLC(last)) return received;
  return compareHLC(received, last) > 0 ? received : last;
}
