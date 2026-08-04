import { useI18n } from '../i18n.jsx';

// Always-visible footer with a microsoft.com-style globe language link that
// opens the full language-selection page.
export default function Footer({ onOpenLanguage }) {
  const { t, lang, languages } = useI18n();
  const current = languages.find((l) => l.code === lang) || languages[0];

  return (
    <footer className="app-footer">
      <span className="footer-tagline">{t('footer_tagline')}</span>
      <button type="button" className="lang-link" onClick={onOpenLanguage}>
        <span className="globe" aria-hidden="true">🌐</span>
        {t('footer_lang')}: {current.native}
      </button>
    </footer>
  );
}
