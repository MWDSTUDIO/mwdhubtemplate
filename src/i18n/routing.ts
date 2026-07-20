import { defineRouting } from "next-intl/routing";

export const locales = ["en", "fr", "zh", "ja", "es"] as const;
export type Locale = (typeof locales)[number];

export const localeNames: Record<Locale, string> = {
  en: "English",
  fr: "Français",
  zh: "中文",
  ja: "日本語",
  es: "Español"
};

export const routing = defineRouting({
  locales,
  defaultLocale: "en",
  localePrefix: "as-needed"
});
