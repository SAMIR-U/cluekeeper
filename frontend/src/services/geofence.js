
const EARTH_RADIUS = 6371000

function toRadians(degrees) {
  return degrees * Math.PI / 180
}

export function calculateDistance(pointA, pointB) {
  const lat1 = toRadians(pointA.latitude)
  const lat2 = toRadians(pointB.latitude)

  const deltaLat = lat2 - lat1
  const deltaLon = toRadians(
    pointB.longitude - pointA.longitude
  )

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) *
    Math.cos(lat2) *
    Math.sin(deltaLon / 2) ** 2

  const c = 2 * Math.atan2(
    Math.sqrt(Math.min(1, Math.max(0, a))),
    Math.sqrt(1 - Math.min(1, Math.max(0, a)))
  )

  return EARTH_RADIUS * c
}

export function validateGeofence(position, checkpoint) {
  if (!Number.isFinite(checkpoint.radius) ||
      checkpoint.radius <= 0) {
    throw new Error('Radio de geocerca inválido')
  }

  const distance = calculateDistance(
    position,
    checkpoint
  )

  return {
    distance,
    remaining: Math.max(
      0,
      distance - checkpoint.radius
    ),
    inside: distance <= checkpoint.radius,
  }
}
