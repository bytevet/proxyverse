import type { ProxyProfile } from "@/services/profile";

/**
 * Something an import couldn't carry over as is. `key` is an i18n message
 * id and `args` its substitutions, so the UI can show it translated.
 */
export type ImportWarning = {
  profileName: string;
  key: string;
  args: string[];
};

export type ImportResult = {
  profiles: ProxyProfile[];
  warnings: ImportWarning[];
};
