"use client";

import { useMemo } from "react";
import { useTranslation as useReactI18nextTranslation } from "react-i18next";

/**
 * Shared translation hook for app components.
 * Wraps react-i18next so all components share one i18n context.
 */
export function useTranslation() {
  const { t, i18n } = useReactI18nextTranslation();

  return useMemo(
    () => ({
      t,
      i18n,
      locale: i18n.resolvedLanguage ?? i18n.language ?? "en",
      locales: Object.keys(i18n.options?.resources ?? { en: {} }),
      changeLanguage: i18n.changeLanguage?.bind(i18n),
    }),
    [t, i18n],
  );
}
