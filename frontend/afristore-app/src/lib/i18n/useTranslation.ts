"use client";

import { useCallback, useMemo } from "react";
import {
  defaultLocale,
  supportedLocales,
  translate,
  type Locale,
  type TranslationKey,
  type TranslationVariables,
} from "./translate";

/**
 * Client hook used by components to read translated strings.
 *
 * ```tsx
 * const { t } = useTranslation();
 * return <h1>{t("myCollections.title")}</h1>;
 * ```
 */
export function useTranslation(locale: Locale = defaultLocale) {
  const t = useCallback(
    (key: TranslationKey, variables?: TranslationVariables) =>
      translate(key, variables, locale),
    [locale],
  );

  return useMemo(
    () => ({ t, locale, locales: supportedLocales }),
    [t, locale],
  );
}
