import { plainSubstitutions } from "./base";

// `_locales/<code>/messages.json` and Chrome's formatting of its messages,
// for the languages the native i18n APIs can't serve (see
// `src/services/i18n.ts`) and for the dev stub.

export type Entry = {
  message: string;
  placeholders?: Record<string, { content: string }>;
};
export type Catalog = Record<string, Entry>;

/** Message names are case-insensitive: keys lower-cased once, up front. */
export const lowerCaseKeys = (raw: Catalog): Catalog =>
  Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]));

/**
 * A message with its substitutions, as `chrome.i18n.getMessage` formats it:
 * `$1`-`$9` are substitutions, `$$` is a literal `$`, and `$name$` is a
 * named placeholder, whose content may refer to substitutions in turn.
 */
export function formatMessage(
  entry: Entry | undefined,
  substitutions?: string | string[]
): string {
  if (!entry) return "";
  const args = [plainSubstitutions(substitutions) ?? []].flat();
  const placeholders = Object.fromEntries(
    Object.entries(entry.placeholders ?? {}).map(([k, v]) => [
      k.toLowerCase(),
      v.content,
    ])
  );

  const format = (text: string, named: boolean): string =>
    text.replace(/\$(\$|[1-9]|[A-Za-z_@][\w@]*\$)/g, (match, token: string) => {
      if (token === "$") return "$";
      if (/^[1-9]$/.test(token)) return args[Number(token) - 1] ?? "";
      const content = placeholders[token.slice(0, -1).toLowerCase()];
      return named && content !== undefined ? format(content, false) : match;
    });
  return format(entry.message, true);
}

/**
 * Look messages up in `chosen`, then in `fallback`, like the browser does.
 * Both catalogs have lower-cased keys (`lowerCaseKeys`).
 */
export function catalogLookup(chosen: Catalog, fallback: Catalog) {
  return (key: string, substitutions?: string | string[]) => {
    const k = key.toLowerCase();
    return formatMessage(chosen[k] ?? fallback[k], substitutions);
  };
}
