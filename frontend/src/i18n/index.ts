import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en';
import es from './locales/es';
import pt from './locales/pt';

export const SUPPORTED_LANGS = ['en', 'es', 'pt'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
      pt: { translation: pt },
    },
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGS as readonly string[] as string[],
    nonExplicitSupportedLngs: true, // 'es-MX' resolves to 'es'
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'pd_lang',
    },
  });

export function isSupportedLang(s: string): s is Lang {
  return (SUPPORTED_LANGS as readonly string[]).includes(s);
}

export function currentLang(): Lang {
  const l = i18n.language?.slice(0, 2);
  return isSupportedLang(l ?? '') ? (l as Lang) : 'en';
}

export default i18n;
