import { useI18n } from '../i18n.jsx';

// Dedicated page (reached from the footer language link) listing every language.
// Selecting one translates the whole app and returns home.
export default function LanguagePage({ onBack }) {
  const { t, lang, setLang, languages } = useI18n();

  function choose(code) {
    setLang(code);
    onBack?.();
  }

  return (
    <div className="card lang-page">
      <button type="button" className="ghost small" onClick={onBack}>{t('back')}</button>
      <h2 style={{ margin: '12px 0 4px' }}>🌐 {t('lang_page_title')}</h2>
      <p className="muted" style={{ marginTop: 0 }}>{t('lang_page_sub')}</p>

      <div className="lang-grid">
        {languages.map((l) => (
          <button
            key={l.code}
            type="button"
            className={`lang-option ${l.code === lang ? 'active' : ''}`}
            onClick={() => choose(l.code)}
          >
            <span className="lang-native" dir={l.dir}>{l.native}</span>
            <span className="lang-label muted">{l.label}</span>
            {l.code === lang && <span className="lang-check">✓</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
