// ─────────────────────────────────────────────────────────────
// lib/i18n/translate.ts — dependency-free translation helper
// ─────────────────────────────────────────────────────────────
//
// The app ships every UI string in `locales/<locale>.json` and reads it back
// through dot-path keys, e.g. `translate("myCollections.badge")`. Keys are
// typed against the default locale, so a typo or a removed string fails
// type-check instead of rendering a raw key in the UI.

import en from "./locales/en.json";

export const locales = { en } as const;

export type Locale = keyof typeof locales;

export const defaultLocale: Locale = "en";

export const supportedLocales = Object.keys(locales) as Locale[];

type Dictionary = typeof en;

/**
 * Union of every dot-separated string path in the default dictionary,
 * e.g. `"myCollections" | "myCollections.badge" | ...`.
 */
type DotPaths<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends object
      ? `${K}.${DotPaths<T[K]>}`
      : never;
}[keyof T & string];

export type TranslationKey = DotPaths<Dictionary>;

export type TranslationVariables = Record<string, string | number>;

function lookup(locale: Locale, key: string): string | undefined {
  const value = key.split(".").reduce<unknown>((node, segment) => {
    if (node && typeof node === "object" && segment in node) {
      return (node as Record<string, unknown>)[segment];
    }
    return undefined;
  }, locales[locale]);

  return typeof value === "string" ? value : undefined;
}

/** Replaces `{{name}}` placeholders with the matching value. */
export function interpolate(
  template: string,
  variables?: TranslationVariables,
): string {
  if (!variables) return template;

  return template.replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (placeholder, name: string) =>
      name in variables ? String(variables[name]) : placeholder,
  );
}

/**
 * Resolves a translation key for the given locale, falling back to the default
 * locale. Unknown keys return the key itself so the UI degrades gracefully.
 */
export function translate(
  key: TranslationKey,
  variables?: TranslationVariables,
  locale: Locale = defaultLocale,
): string {
  const template = lookup(locale, key) ?? lookup(defaultLocale, key);

  if (template === undefined) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[i18n] Missing translation for "${key}" in "${locale}"`);
    }
    return key;
  }

  return interpolate(template, variables);
}
