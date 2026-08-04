import { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import TripForm from './components/TripForm';
import Planner from './components/Planner';
import AuthPage from './components/AuthPage';
import Hero from './components/Hero';
import TemplateBrowser from './components/TemplateBrowser';
import TripTip from './components/TripTip';
import RoadsterIcon from './components/RoadsterIcon';
import Footer from './components/Footer';
import LanguagePage from './components/LanguagePage';
import LandingShowcase from './components/LandingShowcase';
import { useI18n } from './i18n.jsx';
import { api } from './api';
import { auth } from './firebase';

export default function App() {
  const { t } = useI18n();
  const [view, setView] = useState('home'); // home | auth | new | planner | shared | language
  const [prevView, setPrevView] = useState('home');
  const [trips, setTrips] = useState([]);
  const [active, setActive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [openTripAfterAuth, setOpenTripAfterAuth] = useState(false);
  const shareToken = new URLSearchParams(window.location.search).get('share');

  async function loadTrips() {
    try {
      setTrips(await api.listTrips());
    } catch (e) {
      setError(t('err_server', { msg: e.message }));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => onAuthStateChanged(auth, (nextUser) => {
    setUser(nextUser);
    setAuthReady(true);
  }), []);

  useEffect(() => {
    if (!authReady) return;
    if (shareToken) {
      api.getSharedTrip(shareToken)
        .then((trip) => {
          setActive(trip);
          setView('shared');
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
      return;
    }
    if (user) {
      if (view === 'auth') {
        setView(selectedTemplate || openTripAfterAuth ? 'new' : 'home');
        setOpenTripAfterAuth(false);
      }
      loadTrips();
    } else {
      setTrips([]);
      setActive(null);
      setView('home');
      setLoading(false);
    }
  }, [authReady, user?.uid, shareToken]);

  async function openTrip(id) {
    const t = await api.getTrip(id);
    setActive(t);
    setView('planner');
  }

  function goHome() {
    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    setView('home');
    setActive(null);
    setSelectedTemplate(null);
    setOpenTripAfterAuth(false);
    if (user) loadTrips();
  }

  function startBlankTrip() {
    setSelectedTemplate(null);
    setOpenTripAfterAuth(true);
    setView(user ? 'new' : 'auth');
  }

  function useTemplate(template) {
    setSelectedTemplate(template);
    setOpenTripAfterAuth(true);
    setView(user ? 'new' : 'auth');
  }

  function openLanguage() {
    setPrevView(view);
    setView('language');
  }

  async function removeTrip(e, id) {
    e.stopPropagation();
    if (!confirm(t('confirm_delete'))) return;
    await api.deleteTrip(id);
    loadTrips();
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 onClick={goHome} style={{ cursor: 'pointer' }}>
          <span className="leaf">🌿</span> Wander <span className="tag">{t('brand_tag')}</span>
        </h1>
        {user && (
          <div className="account-menu">
            <span>{user.isAnonymous ? 'Guest traveler' : (user.displayName || user.email)}</span>
            <button className="ghost small" onClick={() => signOut(auth)}>Sign out</button>
          </div>
        )}
        {authReady && !user && view !== 'shared' && (
          <button className="ghost small account-signin" onClick={() => setView('auth')}>Sign in</button>
        )}
      </header>

      <div className="container">
        {error && <div className="banner">{error}</div>}
        {!authReady && <div className="spinner">{t('loading')}</div>}

        {authReady && !user && view === 'auth' && (
          <AuthPage onGuestStart={() => setOpenTripAfterAuth(true)} />
        )}

        {view === 'language' && (
          <LanguagePage onBack={() => setView(prevView)} />
        )}

        {view === 'home' && (
          <>
            <Hero
              onStart={startBlankTrip}
              hasTrips={user && trips.length > 0}
            />
            {!user && <LandingShowcase />}
            <section className="quick-trip-start">
              <div>
                <span>Build it yourself</span>
                <h2>Make your own trip</h2>
                <p>Choose your starting place, destination, date, time, and transportation.</p>
              </div>
              <button onClick={startBlankTrip}>Start a custom trip</button>
            </section>
            <TemplateBrowser onSelect={useTemplate} />

            {user && (
              <>
                <div className="page-head" style={{ marginTop: 28 }}>
                  <div>
                    <h2 style={{ margin: 0 }}>🌿 {t('home_title')}</h2>
                    <p className="muted" style={{ margin: '4px 0 0' }}>
                      {t('home_sub')}
                    </p>
                  </div>
                  <button onClick={startBlankTrip}>{t('nav_new_trip')}</button>
                </div>

                {loading && <div className="spinner">{t('loading')}</div>}
                {!loading && trips.length === 0 && (
                  <div className="card empty">
                    <p>{t('no_trips')}</p>
                    <button onClick={startBlankTrip}>{t('plan_first')}</button>
                  </div>
                )}
                {trips.map((tr) => (
                  <div className="card trip-card" key={tr.id} onClick={() => openTrip(tr.id)}>
                    <TripTip tripId={tr.id} />
                    <div className="row spread">
                      <div>
                        <h3>{tr.title}</h3>
                        <div className="muted">
                          {tr.origin.split(',')[0]} → {tr.destination.split(',')[0]}
                          {tr.start_date ? ` · ${tr.start_date}` : ''}
                          {' · '}
                          <span className="trip-mode">
                            {tr.travel_mode === 'car' || !tr.travel_mode
                              ? <><RoadsterIcon size={22} /> Car</>
                              : ({ flight: '✈️ Plane', train: '🚆 Train', bus: '🚌 Bus' }[tr.travel_mode])}
                          </span>
                        </div>
                      </div>
                      <button className="danger" onClick={(e) => removeTrip(e, tr.id)}>{t('delete')}</button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {user && view === 'new' && (
          <TripForm
            key={selectedTemplate?.id || 'blank-trip'}
            initialTemplate={selectedTemplate}
            onCreated={(trip) => { setActive(trip); setView('planner'); }}
            onCancel={goHome}
          />
        )}

        {user && view === 'planner' && active && (
          <Planner
            trip={active}
            onBack={goHome}
            onChanged={loadTrips}
          />
        )}

        {view === 'shared' && active && (
          <Planner
            trip={active}
            onBack={goHome}
            readOnly
            shareToken={shareToken}
            viewer={user}
          />
        )}
      </div>

      <Footer onOpenLanguage={openLanguage} />
      {user && view !== 'shared' && (
        <nav className="mobile-nav" aria-label="Mobile navigation">
          <button className={view === 'home' ? 'active' : ''} onClick={goHome}>
            <span>⌂</span>Trips
          </button>
          <button className={view === 'new' ? 'active primary' : 'primary'} onClick={startBlankTrip}>
            <span>＋</span>New
          </button>
          <button className={view === 'language' ? 'active' : ''} onClick={openLanguage}>
            <span>文</span>Language
          </button>
        </nav>
      )}
    </div>
  );
}
