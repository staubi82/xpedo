import { useEffect, useRef } from 'react';
import L from 'leaflet';

// Leaflet CSS is loaded globally in main.jsx

export default function RideMap({ track }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || track.length < 2) return;

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://openstreetmap.org">OSM</a>',
      maxZoom: 19,
    }).addTo(map);

    const polyline = L.polyline(track, {
      color: '#86efac',
      weight: 4,
      opacity: 0.9,
    }).addTo(map);

    L.circleMarker(track[0], {
      radius: 6, color: '#4ade80', fillColor: '#4ade80', fillOpacity: 1, weight: 2,
    }).bindTooltip('Start', { permanent: false }).addTo(map);

    L.circleMarker(track[track.length - 1], {
      radius: 6, color: '#f87171', fillColor: '#f87171', fillOpacity: 1, weight: 2,
    }).bindTooltip('Ende', { permanent: false }).addTo(map);

    map.fitBounds(polyline.getBounds(), { padding: [20, 20] });

    // Leaflet needs invalidateSize() when the container just became visible
    const timer = setTimeout(() => map.invalidateSize(), 50);

    return () => {
      clearTimeout(timer);
      map.remove();
    };
  }, [track]);

  if (track.length < 2) {
    return (
      <div className="flex h-36 items-center justify-center rounded border border-zinc-800 bg-zinc-900 font-mono text-xs font-bold text-zinc-600">
        KEINE STRECKENDATEN
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded" style={{ height: '210px' }}>
      <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
    </div>
  );
}
