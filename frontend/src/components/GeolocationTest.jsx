
import { useState } from 'react'
import { useGeolocation } from '../hooks/useGeolocation'
import { validateGeofence } from '../services/geofence'
import RallyMap from "./RallyMap";

export default function GeolocationTest() {
  const { position, loading, error, getLocation } =
    useGeolocation()

  const [checkpoint, setCheckpoint] = useState(null)
  const [radius, setRadius] = useState(30)

  const createCheckpoint = () => {
    if (!position) return

    setCheckpoint({
      id: 'checkpoint-demo',
      latitude: position.latitude,
      longitude: position.longitude,
      radius,
    })
  }

  const result = position && checkpoint
    ? validateGeofence(position, checkpoint)
    : null

  // Umbral provisional de calidad, solo para esta demo
  const adequateAccuracy =
    position && position.accuracy <= 50

  return (
    <main className="gps-test">
      <h1>ClueKeeper</h1>
      <h2>Prueba de geolocalización</h2>

      <button onClick={getLocation} disabled={loading}>
        {loading
          ? 'Obteniendo ubicación...'
          : 'Obtener mi ubicación'}
      </button>

      {error && <p role="alert">{error}</p>}

      {position && (
        <section>
          <h3>Tu ubicación</h3>
          <p>Latitud: {position.latitude.toFixed(6)}</p>
          <p>Longitud: {position.longitude.toFixed(6)}</p>
          <p>
            Precisión estimada: ±
            {position.accuracy.toFixed(1)} m
          </p>
          <p>
            Estado del GPS:
            {adequateAccuracy
              ? ' Precisión aceptable para la prueba'
              : ' Precisión baja, intenta nuevamente'}
          </p>

          <label htmlFor="radius">
            Radio del checkpoint (metros)
          </label>

          <input
            id="radius"
            type="number"
            min="1"
            max="1000"
            value={radius}
            onChange={(event) =>
              setRadius(Number(event.target.value))
            }
          />
          {position && <RallyMap position={position} />}

          <button
            disabled={!Number.isFinite(radius) ||
              radius < 1 || radius > 1000}
            onClick={createCheckpoint}
          >
            Crear checkpoint aquí
          </button>
        </section>
      )}

      {checkpoint && result && (
        <section>
          <h3>Checkpoint de prueba</h3>

          <p>
            Radio permitido: {checkpoint.radius} m
          </p>
          <p>
            Distancia al centro:
            {' '}{result.distance.toFixed(1)} m
          </p>
          <p>
            Distancia restante:
            {' '}{result.remaining.toFixed(1)} m
          </p>

          <strong>
            {!adequateAccuracy
              ? '⚠️ Ubicación poco precisa'
              : result.inside
                ? '✅ Dentro de la geocerca'
                : '❌ Fuera de la geocerca'}
          </strong>

          {adequateAccuracy && result.inside && (
            <p>
              Checkpoint validado en modo demostración.
            </p>
          )}

          <p>
            Muévete y presiona nuevamente
            "Obtener mi ubicación" para actualizar
            la distancia.
          </p>
        </section>
      )}
    </main>
  )
}
