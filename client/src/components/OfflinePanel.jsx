import { useEffect, useState } from 'react';
import { auth } from '../firebase';
import { cacheRoute, cacheTrip, getOfflineStatus } from '../offline';

function savedTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function OfflinePanel({ trip, route }) {
  const [status, setStatus] = useState(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function refreshStatus() {
    setStatus(await getOfflineStatus(auth.currentUser?.uid, trip.id));
  }

  useEffect(() => {
    refreshStatus();
  }, [trip.id, trip.updated_at]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  async function save() {
    setSaving(true);
    setMessage('');
    try {
      const userId = auth.currentUser?.uid;
      await cacheTrip(userId, trip);
      if (route) await cacheRoute(userId, trip.id, route);
      await navigator.serviceWorker?.ready;
      await refreshStatus();
      setMessage('Offline itinerary refreshed. Map tiles you view are saved automatically.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="offline-panel">
      <div>
        <b>{online ? 'Offline access' : 'You are offline'}</b>
        <small>
          {status
            ? `Itinerary saved ${savedTime(status.updatedAt)}${status.hasRoute ? ' with route' : ''}.`
            : 'Save this itinerary and route on this device.'}
        </small>
        <small>Open and zoom map areas while online to keep those viewed tiles available offline.</small>
      </div>
      <button className="ghost small" onClick={save} disabled={saving || !online}>
        {saving ? 'Saving…' : (status ? 'Refresh offline copy' : 'Save for offline')}
      </button>
      {message && <div className="offline-message">{message}</div>}
    </div>
  );
}
