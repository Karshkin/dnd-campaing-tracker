import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';
import es from './locales/es.json';
import ca from './locales/ca.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    supportedLngs: ['en', 'es', 'ca'],
    load: 'languageOnly',
    resources: {
      en: { translation: en },
      es: { translation: es },
      ca: { translation: ca },
    },
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

const updateDocumentLanguage = () => {
  document.documentElement.lang = i18n.resolvedLanguage || 'en';
  document.title = `${i18n.t('app.title')} — ${i18n.t('app.subtitle')}`;
};

i18n.on('languageChanged', updateDocumentLanguage);
if (i18n.isInitialized) updateDocumentLanguage();

export default i18n;
