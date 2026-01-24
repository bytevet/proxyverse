/**
 * Deep clone an object to remove all Proxy objects (e.g., from Vue reactivity).
 * This is necessary because chrome.storage and browser.storage use structured clone
 * which cannot clone Proxy objects.
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
