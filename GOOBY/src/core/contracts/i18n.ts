/**
 * Language contract shared by persistence, settings, and the typed string
 * catalogs in `src/i18n`. The game ships complete English and German text;
 * `auto` resolves from the device locale list and falls back to English.
 */

export const APP_LANGUAGES = ["en", "de"] as const;
export type AppLanguage = (typeof APP_LANGUAGES)[number];

export const LANGUAGE_SETTINGS = ["auto", "en", "de"] as const;
export type LanguageSetting = (typeof LANGUAGE_SETTINGS)[number];

export const DEFAULT_LANGUAGE_SETTING: LanguageSetting = "auto";
export const FALLBACK_LANGUAGE: AppLanguage = "en";

export function isAppLanguage(value: unknown): value is AppLanguage {
  return typeof value === "string" && (APP_LANGUAGES as readonly string[]).includes(value);
}

export function isLanguageSetting(value: unknown): value is LanguageSetting {
  return typeof value === "string" && (LANGUAGE_SETTINGS as readonly string[]).includes(value);
}

/**
 * Resolves a persisted language setting into a concrete shipped language.
 * `auto` scans the provided locale list (for example `navigator.languages`)
 * in order and picks the first supported base language.
 */
export function resolveLanguage(
  setting: LanguageSetting,
  locales: readonly string[] = [],
): AppLanguage {
  if (setting !== "auto") return setting;
  for (const locale of locales) {
    const base = locale.toLowerCase().split(/[-_]/u)[0];
    if (isAppLanguage(base)) return base;
  }
  return FALLBACK_LANGUAGE;
}
