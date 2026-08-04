import { useI18n } from '../i18n.jsx';
import MapIcon from './MapIcon';

// Welcome / landing section shown on the home screen: what the app is,
// how it works, and a call to action.
export default function Hero({ onStart, hasTrips }) {
  const { t } = useI18n();
  const steps = [
    { icon: <MapIcon size={27} />, title: t('step1_title'), text: t('step1_text') },
    { icon: '✦', title: t('step3_title'), text: t('step3_text') },
    { icon: '◌', title: t('step4_title'), text: t('step4_text') },
  ];

  return (
    <section className="hero">
      <div className="hero-inner">
        <div className="hero-copy">
          <span className="hero-badge">{t('hero_badge')}</span>
          <h1 className="hero-title">{t('hero_title')}</h1>
          <p className="hero-sub">{t('hero_sub')}</p>
          <div className="hero-cta">
            <button onClick={onStart}>{hasTrips ? t('hero_cta_another') : t('hero_cta_first')}</button>
          </div>
          <div className="hero-trust">
            <span>✓ Secure account</span>
            <span>✓ Free maps</span>
            <span>✓ Shareable plans</span>
          </div>
        </div>

        <div className="hero-preview" aria-hidden="true">
          <div className="preview-window">
            <div className="preview-top">
              <span className="preview-dot" />
              <span className="preview-dot" />
              <span className="preview-dot" />
              <b>Plan with Cotrip</b>
            </div>
            <div className="preview-question">Plan a relaxed weekend from Chicago to Indianapolis.</div>
            <div className="preview-answer">
              <span className="preview-avatar">W</span>
              <div>
                <b>Your route is ready</b>
                <small>Compare transport, add stops, and ask for places along the way.</small>
              </div>
            </div>
            <div className="preview-route">
              <div className="route-place"><span>A</span><div><small>Starting in</small><b>Chicago</b></div></div>
              <div className="route-line"><i /><i /><i /></div>
              <div className="route-place"><span>B</span><div><small>Arriving in</small><b>Indianapolis</b></div></div>
            </div>
            <div className="preview-modes">
              <span className="active">Car</span><span>Plane</span><span>Train</span><span>Bus</span>
            </div>
          </div>
          <div className="preview-float preview-time"><b>3h 02m</b><small>estimated trip</small></div>
          <div className="preview-float preview-saved"><b>Link ready</b><small>share with friends</small></div>
        </div>
      </div>

      <div className="how-heading">
        <span>Everything in one plan</span>
        <h2>From an idea to a route you can use.</h2>
      </div>
      <div className="how-grid">
        {steps.map((s, i) => (
          <div className="how-card" key={i}>
            <div className="how-icon">{s.icon}</div>
            <h3>{s.title}</h3>
            <p className="muted">{s.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
