import { useState } from 'react';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
} from 'firebase/auth';
import { auth } from '../firebase';

function authErrorMessage(err) {
  const messages = {
    'auth/invalid-credential': 'The email or password is incorrect.',
    'auth/network-request-failed': 'Google could not be reached. Check your connection and try again.',
    'auth/operation-not-allowed': 'This sign-in method is not enabled for this app.',
    'auth/popup-closed-by-user': 'The Google sign-in window was closed before login finished.',
    'auth/too-many-requests': 'Too many sign-in attempts. Wait a moment and try again.',
    'auth/unauthorized-domain': 'Google sign-in is not allowed from this website address.',
  };
  return messages[err.code] || err.message || 'Sign-in failed. Please try again.';
}

export default function AuthPage({ onGuestStart }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function run(action) {
    setError('');
    setMessage('');
    setLoading(true);
    try {
      await action();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function submit(event) {
    event.preventDefault();
    run(() => (
      mode === 'signup'
        ? createUserWithEmailAndPassword(auth, email.trim(), password)
        : signInWithEmailAndPassword(auth, email.trim(), password)
    ));
  }

  function googleSignIn() {
    run(() => signInWithPopup(auth, new GoogleAuthProvider()));
  }

  function guestSignIn() {
    onGuestStart?.();
    run(() => signInAnonymously(auth));
  }

  function resetPassword() {
    if (!email.trim()) {
      setError('Enter your email address first.');
      return;
    }
    run(async () => {
      await sendPasswordResetEmail(auth, email.trim());
      setMessage('Password reset email sent.');
    });
  }

  return (
    <div className="auth-layout">
      <section className="auth-intro">
        <span className="hero-badge">Your trips, always ready</span>
        <h2>Plan once. Continue anywhere.</h2>
        <p>Sign in to securely save routes, stops, transport choices, and Cotrip conversations.</p>
        <div className="auth-benefits">
          <span>✓ Saved across devices</span>
          <span>✓ Private by default</span>
          <span>✓ Share read-only trip links</span>
        </div>
      </section>

      <section className="card auth-card">
        <h2>{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h2>
        <p className="muted">
          {mode === 'signup' ? 'Start saving your travel plans.' : 'Sign in to see your saved trips.'}
        </p>
        <button type="button" className="google-button" onClick={googleSignIn} disabled={loading}>
          Continue with Google
        </button>
        <button type="button" className="guest-button" onClick={guestSignIn} disabled={loading}>
          Try adding a trip as a guest
        </button>
        <small className="guest-note">No account needed. Guest trips stay on this browser.</small>
        {error && <div className="banner auth-google-error">{error}</div>}
        {message && <div className="banner auth-google-error">{message}</div>}
        <div className="auth-divider"><span>or use email</span></div>
        <form onSubmit={submit}>
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              minLength="6"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? 'Please wait…' : (mode === 'signup' ? 'Create account' : 'Sign in')}
          </button>
        </form>
        {mode === 'login' && (
          <button type="button" className="auth-link" onClick={resetPassword}>Forgot password?</button>
        )}
        <button
          type="button"
          className="auth-link"
          onClick={() => {
            setMode(mode === 'login' ? 'signup' : 'login');
            setError('');
            setMessage('');
          }}
        >
          {mode === 'login' ? 'Create a new account' : 'Already have an account? Sign in'}
        </button>
      </section>
    </div>
  );
}
