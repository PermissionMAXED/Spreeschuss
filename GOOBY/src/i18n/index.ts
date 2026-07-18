import {
  APP_LANGUAGES,
  FALLBACK_LANGUAGE,
  resolveLanguage,
  type AppLanguage,
  type LanguageSetting,
} from "../core/contracts/i18n";
import type { LocalizedText } from "../core/contracts/minigame";
import { DE_CATALOG } from "./de";
import { EN_CATALOG } from "./en";
import type { LanguageCatalog } from "./types";

export {
  APP_LANGUAGES,
  DEFAULT_LANGUAGE_SETTING,
  FALLBACK_LANGUAGE,
  LANGUAGE_SETTINGS,
  isAppLanguage,
  isLanguageSetting,
  resolveLanguage,
} from "../core/contracts/i18n";
export type { AppLanguage, LanguageSetting } from "../core/contracts/i18n";
export { DE_CATALOG } from "./de";
export { EN_CATALOG } from "./en";
export type {
  AppStrings,
  FurnitureCopyItem,
  LanguageCatalog,
  MinigameCopy,
  NeedCopy,
  ShopCopy,
  StickerCopy,
  WardrobeOptionCopy,
} from "./types";

const CATALOGS: Readonly<Record<AppLanguage, LanguageCatalog>> = {
  en: EN_CATALOG,
  de: DE_CATALOG,
};

export function catalogFor(language: AppLanguage): LanguageCatalog {
  return CATALOGS[language];
}

type LanguageListener = (language: AppLanguage) => void;

let activeLanguage: AppLanguage = FALLBACK_LANGUAGE;
const listeners = new Set<LanguageListener>();

export function getActiveLanguage(): AppLanguage {
  return activeLanguage;
}

/** Runtime language switch. Notifies subscribers only on actual changes. */
export function setActiveLanguage(language: AppLanguage): AppLanguage {
  if (language === activeLanguage) return activeLanguage;
  activeLanguage = language;
  for (const listener of [...listeners]) listener(language);
  return activeLanguage;
}

/** Resolves a persisted setting (including `auto`) and activates the result. */
export function applyLanguageSetting(
  setting: LanguageSetting,
  locales: readonly string[] = [],
): AppLanguage {
  return setActiveLanguage(resolveLanguage(setting, locales));
}

export function onLanguageChanged(listener: LanguageListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The catalog for the currently active language. */
export function activeCatalog(): LanguageCatalog {
  return CATALOGS[activeLanguage];
}

/** Picks one string from every shipped language to build manifest text. */
export function localizedText(pick: (catalog: LanguageCatalog) => string): LocalizedText {
  return {
    en: pick(EN_CATALOG),
    de: pick(DE_CATALOG),
  };
}

/** Resolves localized manifest text against the currently active language. */
export function pickLocalized(text: LocalizedText, language: AppLanguage = activeLanguage): string {
  return text[language];
}

function leafPaths(value: unknown, prefix: string, into: Map<string, string>): void {
  if (typeof value === "function") {
    into.set(prefix, "function");
    return;
  }
  if (Array.isArray(value)) {
    into.set(prefix, `array:${value.length}`);
    for (const [index, entry] of value.entries()) leafPaths(entry, `${prefix}[${index}]`, into);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      leafPaths(entry, prefix ? `${prefix}.${key}` : key, into);
    }
    return;
  }
  into.set(prefix, typeof value);
}

export interface CatalogParityIssue {
  readonly path: string;
  readonly problem: string;
}

/**
 * Structural parity between shipped languages: identical key trees, identical
 * leaf kinds, and no empty display strings anywhere.
 */
export function catalogParityIssues(): readonly CatalogParityIssue[] {
  const issues: CatalogParityIssue[] = [];
  const byLanguage = APP_LANGUAGES.map((language) => {
    const paths = new Map<string, string>();
    const catalog: Record<string, unknown> = { ...CATALOGS[language] };
    delete catalog.language;
    leafPaths(catalog, "", paths);
    return { language, paths };
  });
  const [reference, ...others] = byLanguage;
  if (!reference) return issues;
  for (const other of others) {
    for (const [path, kind] of reference.paths) {
      const otherKind = other.paths.get(path);
      if (otherKind === undefined) {
        issues.push({ path, problem: `missing in ${other.language}` });
      } else if (otherKind !== kind) {
        issues.push({ path, problem: `kind mismatch: ${kind} vs ${otherKind}` });
      }
    }
    for (const path of other.paths.keys()) {
      if (!reference.paths.has(path)) {
        issues.push({ path, problem: `missing in ${reference.language}` });
      }
    }
  }
  for (const { language, paths } of byLanguage) {
    for (const [path, kind] of paths) {
      if (kind === "string") continue;
      if (kind === "function" || kind.startsWith("array:") || kind === "number" || kind === "boolean") continue;
      issues.push({ path, problem: `unsupported leaf kind ${kind} in ${language}` });
    }
  }
  for (const language of APP_LANGUAGES) {
    const paths = new Map<string, string>();
    leafPaths(CATALOGS[language], "", paths);
    for (const [path, kind] of paths) {
      if (kind !== "string") continue;
      const value = path
        .replace(/\[(\d+)\]/gu, ".$1")
        .split(".")
        .reduce<unknown>(
          (node, key) => (typeof node === "object" && node !== null
            ? (node as Record<string, unknown>)[key]
            : undefined),
          CATALOGS[language],
        );
      if (typeof value === "string" && value.trim().length === 0) {
        issues.push({ path, problem: `empty string in ${language}` });
      }
    }
  }
  return issues;
}

const startupIssues = catalogParityIssues();
if (startupIssues.length > 0) {
  const summary = startupIssues
    .slice(0, 5)
    .map(({ path, problem }) => `${path}: ${problem}`)
    .join("; ");
  throw new Error(`Language catalogs violate parity: ${summary}`);
}
