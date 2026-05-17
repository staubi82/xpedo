export function formatDateTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Heute, ${timeStr}`;
  
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}., ${timeStr}`;
}

export function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((p) => String(p).padStart(2, '0')).join(':');
}

export function distanceInKm(a, b) {
  const R = 6371;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function powerZone(watts, ftp) {
  if (watts >= ftp * 1.21) return { zone: 'Sprint',   zoneColor: 'from-rose-400 to-orange-300',   width: '100%' };
  if (watts >= ftp * 1.06) return { zone: 'VO2 Max',  zoneColor: 'from-fuchsia-400 to-rose-300',  width: '82%'  };
  if (watts >= ftp * 0.91) return { zone: 'Schwelle', zoneColor: 'from-amber-300 to-lime-300',    width: '64%'  };
  if (watts >= ftp * 0.76) return { zone: 'Tempo',    zoneColor: 'from-cyan-300 to-blue-300',     width: '45%'  };
  if (watts > 0)           return { zone: 'Ausdauer', zoneColor: 'from-emerald-400 to-cyan-300',  width: '28%'  };
  return                          { zone: 'Bereit',   zoneColor: 'from-slate-500 to-slate-300',   width: '8%'   };
}
