/**
 * Deep clone an object to remove all Proxy objects (e.g., from Vue reactivity).
 * This is necessary because chrome.storage and browser.storage use structured clone
 * which cannot clone Proxy objects.
 *
 * Note: structuredClone() is NOT used here intentionally — it throws a DataCloneError
 * on JavaScript Proxy objects (including Vue reactive/ref wrappers). JSON round-trip
 * serializes through the Proxy traps and produces a plain object, which is exactly
 * what chrome.storage requires.
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Parse a web URL, which auto switch rules can target.
 * Returns undefined for other schemes (e.g. chrome://, data:) and bad URLs.
 */
export function parseWebURL(url?: string): URL | undefined {
  try {
    const u = new URL(url ?? "");
    return ["http:", "https:", "ws:", "wss:"].includes(u.protocol)
      ? u
      : undefined;
  } catch {
    return undefined;
  }
}

/** Decode base64 holding UTF-8 text. */
export function decodeBase64(text: string): string {
  const binary = atob(text.replace(/\s/g, ""));
  return new TextDecoder().decode(
    Uint8Array.from(binary, (c) => c.charCodeAt(0))
  );
}

const fallbackLocks = new Map<string, Promise<unknown>>();

/**
 * Run `fn` holding the named lock, so read-modify-write sequences on storage
 * don't interleave. Web Locks span every extension context (pages and the
 * background); where they're missing, fall back to a lock local to this context.
 */
export function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (locks) return locks.request(name, fn);

  const prev = fallbackLocks.get(name) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  fallbackLocks.set(
    name,
    run.catch(() => undefined)
  );
  return run;
}
