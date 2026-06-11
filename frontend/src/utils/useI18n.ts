import { useSyncExternalStore, useCallback } from 'react';
import { i18n, type TranslationKey, type Language } from './i18n';

let snapshot = { lang: i18n.lang };

i18n.subscribe(() => {
  snapshot = { lang: i18n.lang };
});

export function useI18n() {
  const state = useSyncExternalStore(
    (cb) => i18n.subscribe(cb),
    () => snapshot,
  );

  const t = useCallback((key: TranslationKey) => i18n.t(key), [state]);

  const setLanguage = useCallback((lang: Language) => {
    i18n.setLanguage(lang);
  }, []);

  return { t, lang: state.lang, setLanguage };
}
