const EARTH_RADIUS = 6371000;
const rad = (d) => (d * Math.PI) / 180;

// Misma fórmula (haversine) que frontend/src/services/geofence.js
export function distanceMeters(a, b) {
  const lat1 = rad(a.latitude);
  const lat2 = rad(b.latitude);
  const dLat = lat2 - lat1;
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const x = Math.min(1, Math.max(0, h));
  return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function checkGeofence(position, checkpoint) {
  const distance = distanceMeters(position, checkpoint);
  return {
    distance,
    inside: distance <= checkpoint.radius,
    remaining: Math.max(0, distance - checkpoint.radius),
  };
}

// Diferencia angular mínima entre dos rumbos (0-180)
export function angularDiff(a, b) {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

export function normalizeText(text) {
  return String(text)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
