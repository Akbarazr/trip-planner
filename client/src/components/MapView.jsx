import { useEffect } from 'react';
import {
  MapContainer, TileLayer, Marker, Popup, Polyline, useMap,
} from 'react-leaflet';
import L from 'leaflet';

// Fix default marker icons (they break under bundlers otherwise).
const icon = (color) =>
  L.divIcon({
    className: 'pin',
    html: `<div style="background:${color};width:18px;height:18px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 18],
  });

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lon], 11);
    } else {
      map.fitBounds(points.map((p) => [p.lat, p.lon]), { padding: [40, 40] });
    }
  }, [JSON.stringify(points)]);
  return null;
}

export default function MapView({
  markers = [], routeLine = null, suggestions = [], routeColor = '#6b8e5a',
}) {
  const center = markers[0] ? [markers[0].lat, markers[0].lon] : [39.5, -98.35];
  const line = routeLine?.coordinates?.map(([lon, lat]) => [lat, lon]) || [];

  return (
    <div className="map-wrap">
      <MapContainer center={center} zoom={5} scrollWheelZoom>
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {line.length > 0 && (
          <Polyline
            positions={line}
            pathOptions={{ color: routeColor, weight: 5, dashArray: routeColor === '#38bdf8' ? '10 10' : null }}
          />
        )}
        {markers.map((m, i) => (
          <Marker key={`m${i}`} position={[m.lat, m.lon]} icon={icon(m.color || '#557153')}>
            <Popup>{m.label}</Popup>
          </Marker>
        ))}
        {suggestions.map((s, i) => (
          <Marker key={`s${i}`} position={[s.lat, s.lon]} icon={icon('#c07b52')}>
            <Popup>
              <b>{s.name}</b>
              {s.details ? <div>{s.details}</div> : null}
            </Popup>
          </Marker>
        ))}
        <FitBounds points={[...markers, ...(line.length ? [] : suggestions)]} />
      </MapContainer>
    </div>
  );
}
