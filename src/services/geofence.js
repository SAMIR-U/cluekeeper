
export function calculateDistance(pointA, pointB) {
  const toRad = degrees => degrees * Math.PI / 180
  const earthRadius = 6371000

  const lat1 = toRad(pointA.latitude)
  const lat2 = toRad(pointB.latitude)
  const dLat = lat2 - lat1
  const dLon = toRad(
    pointB.longitude - pointA.longitude
  )

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) *
    Math.cos(lat2) *
    Math.sin(dLon / 2) ** 2

  const c = 2 * Math.atan2(
    Math.sqrt(a),
    Math.sqrt(1 - a)
  )

  return earthRadius * c
}

export function isInsideGeofence(
  position,
  checkpoint
) {
  const distance = calculateDistance(
    position,
    checkpoint
  )

  return {
    distance,
    inside: distance <= checkpoint.radius,
  }
}
