import { Host } from "@/adapters";
import { setMessageOverride } from "@/adapters/base";
import {
  type Catalog,
  catalogLookup,
  lowerCaseKeys,
} from "@/adapters/messages";
import englishMessages from "@/../public/_locales/en/messages.json";

export {
  type Catalog,
  catalogLookup,
  formatMessage,
} from "@/adapters/messages";

/**
 * The UI language. The native i18n APIs only know the browser's language,
 * so a language chosen here is loaded from `_locales/<code>/messages.json`
 * and installed as the adapters' message override. Text the browser draws
 * itself (the extension's name and description) stays in its language.
 */

// one per `public/_locales` directory, named in its own language
export const LANGUAGES = [
  { code: "ar", name: "العربية" },
  { code: "en", name: "English" },
  { code: "pt_BR", name: "Português (Brasil)" },
  { code: "zh_CN", name: "简体中文" },
  { code: "zh_TW", name: "繁體中文" },
] as const;

type LanguageCode = (typeof LANGUAGES)[number]["code"];
export type Language = "auto" | LanguageCode;

// base languages only: the direction belongs to the language, not the region
const RIGHT_TO_LEFT = new Set<string>(["ar"] satisfies LanguageCode[]);

const keyLanguage = "ui.language";
// the manifest's default_locale; bundled already (the dev stub uses it)
const ENGLISH = lowerCaseKeys(englishMessages);

const isLanguageCode = (v: unknown): v is LanguageCode =>
  LANGUAGES.some((l) => l.code === v);

/** The chosen language, or "auto" to follow the browser. */
export async function getLanguage(): Promise<Language> {
  const v = await Host.get<string>(keyLanguage);
  return isLanguageCode(v) ? v : "auto";
}

export async function setLanguage(language: Language) {
  await Host.set<Language>(keyLanguage, language);
}

/** The browser's UI language, named in itself, e.g. "English (United States)". */
export function browserLanguageName(): string {
  const tag = navigator.language;
  try {
    return new Intl.DisplayNames([tag], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

async function loadCatalog(code: LanguageCode): Promise<Catalog> {
  if (code === "en") return ENGLISH;
  const res = await fetch(`/_locales/${code}/messages.json`);
  if (!res.ok) throw Error(`HTTP ${res.status} loading ${code} messages`);
  return lowerCaseKeys(await res.json());
}

/**
 * The direction of the messages shown for a UI locale, e.g. "ar-EG". Only
 * languages we have a catalog for are right to left: a Hebrew browser shows
 * our English.
 */
export const textDirection = (locale: string): "ltr" | "rtl" =>
  RIGHT_TO_LEFT.has(locale.split(/[-_]/, 1)[0].toLowerCase()) ? "rtl" : "ltr";

/** Whether this page is right to left; set by `applyStoredLanguage()`. */
export const isRightToLeft = () => document.documentElement.dir === "rtl";

/** Apply the stored language to this page; call before mounting the app. */
export async function applyStoredLanguage() {
  const language = await getLanguage();
  if (language !== "auto") {
    try {
      const chosen = await loadCatalog(language);
      const locale = language.replace("_", "-");
      setMessageOverride({ locale, getMessage: catalogLookup(chosen, ENGLISH) });
      document.documentElement.lang = locale;
    } catch (e) {
      console.error("Failed to load the chosen language", e);
    }
  }
  // the chosen language if it loaded, else the browser's
  document.documentElement.dir = textDirection(Host.currentLocale());
}

/**
 * Reload this page when the language changes, from any page: most labels
 * are read once, when a page loads. Call once per page.
 */
export function followLanguage() {
  Host.onLocalStorageChanged((changes) => {
    if (keyLanguage in changes) location.reload();
  });
}
