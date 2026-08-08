import { useCallback } from "react";

import translations from "@/locales/admin-translations.json";
import { AdminLanguage, useAdminLanguageStore } from "@/store/admin-language-store";

type TranslationParams = Record<string, string | number>;
type TranslationDictionary = typeof translations.en;

export type AdminTranslationKey = keyof TranslationDictionary;

function interpolate(template: string, params?: TranslationParams) {
  if (!params) {
    return template;
  }

  return Object.entries(params).reduce(
    (value, [key, replacement]) => value.replaceAll(`{{${key}}}`, String(replacement)),
    template,
  );
}

function getDictionary(language: AdminLanguage) {
  return (translations[language] ?? translations.en) as TranslationDictionary;
}

export function translateAdminText(language: AdminLanguage, key: AdminTranslationKey, params?: TranslationParams) {
  const dictionary = getDictionary(language);
  const fallbackDictionary = translations.en as TranslationDictionary;
  const template = dictionary[key] ?? fallbackDictionary[key] ?? String(key);

  return interpolate(template, params);
}

export function getAdminLocalizedItemName(
  language: AdminLanguage,
  itemName: string,
  itemTamilName?: string | null,
) {
  if (language === "ta") {
    const tamilName = itemTamilName?.trim();
    if (tamilName) {
      return tamilName;
    }
  }
  return itemName;
}

export function useAdminTranslation() {
  const language = useAdminLanguageStore((state) => state.language);
  const setLanguage = useAdminLanguageStore((state) => state.setLanguage);
  const toggleLanguage = useAdminLanguageStore((state) => state.toggleLanguage);
  const isTamil = language === "ta";
  const t = useCallback(
    (key: AdminTranslationKey, params?: TranslationParams) => translateAdminText(language, key, params),
    [language],
  );
  const translateItemName = useCallback(
    (itemName: string, itemTamilName?: string | null) =>
      getAdminLocalizedItemName(language, itemName, itemTamilName),
    [language],
  );

  return {
    language,
    isTamil,
    setLanguage,
    toggleLanguage,
    t,
    translateItemName,
  };
}
