
import { useEffect, useRef, useState } from 'react'

export function useGeolocation() {
  const [position, setPosition] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const requestId = useRef(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true

    return () => {
      mounted.current = false
      requestId.current += 1
    }
  }, [])

  const getLocation = () => {
    if (!('geolocation' in navigator)) {
      setError('Este dispositivo no admite geolocalización.')
      return Promise.resolve(null)
    }

    const currentRequest = ++requestId.current

    setLoading(true)
    setError(null)

    return new Promise(resolve => navigator.geolocation.getCurrentPosition(
      ({ coords, timestamp }) => {
        if (!mounted.current ||
            currentRequest !== requestId.current) return resolve(null)

        const nextPosition = {
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy,
          timestamp,
        }
        setPosition(nextPosition)
        setLoading(false)
        resolve(nextPosition)
      },
      (err) => {
        if (!mounted.current ||
            currentRequest !== requestId.current) return resolve(null)

        const messages = {
          1: 'Permiso de ubicación denegado.',
          2: 'No se pudo determinar tu ubicación.',
          3: 'Se agotó el tiempo para obtener el GPS.',
        }

        setError(
          messages[err.code] ||
          'Ocurrió un error al obtener la ubicación.'
        )
        setLoading(false)
        resolve(null)
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    ))
  }

  return { position, loading, error, getLocation }
}
