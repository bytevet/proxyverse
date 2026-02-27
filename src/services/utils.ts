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
