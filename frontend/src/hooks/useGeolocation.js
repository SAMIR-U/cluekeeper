
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
      return
    }

    const currentRequest = ++requestId.current

    setLoading(true)
    setError(null)

    navigator.geolocation.getCurrentPosition(
      ({ coords, timestamp }) => {
        if (!mounted.current ||
            currentRequest !== requestId.current) return

        setPosition({
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy,
          timestamp,
        })
        setLoading(false)
      },
      (err) => {
        if (!mounted.current ||
            currentRequest !== requestId.current) return

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
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    )
  }

  return { position, loading, error, getLocation }
}
