import { en } from '@gatecrash/core';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

/**
 * i18n — FRONTEND.md §2.1.
 *
 * English at launch; Hindi and Marathi are a near-certain ask for a township. Strings are
 * externalised from day one because retrofitting is three days of nothing.
 *
 * The bundle is typed via the module augmentation below, so `t('users.credentials.titel')` is a
 * **compile error** rather than a raw key rendered at an admin. That is what makes the extra
 * indirection worth paying for.
 */
void i18next.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: {
    // React already escapes; double-escaping turns an apostrophe into `&#39;` on screen.
    escapeValue: false,
  },
  returnNull: false,
});

export default i18next;

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
    returnNull: false;
  }
}
