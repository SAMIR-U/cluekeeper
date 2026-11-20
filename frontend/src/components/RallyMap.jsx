
import { useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Circle,
  CircleMarker,
  Popup,
  useMap,
} from "react-leaflet";

import "leaflet/dist/leaflet.css";
import "./RallyMap.css";

function MapUpdater({ latitude, longitude }) {
  const map = useMap();

  useEffect(() => {
    map.setView(
      [latitude, longitude],
      map.getZoom()
    );
  }, [map, latitude, longitude]);

  return null;
}

export default function RallyMap({ position }) {
  if (!position) {
    return <p>Obtén tu ubicación para ver el mapa.</p>;
  }

  const { latitude, longitude, accuracy } = position;
  const center = [latitude, longitude];

  return (
    <section className="map-section">
      <h3>Mapa del rally</h3>

      <MapContainer
        center={center}
        zoom={17}
        scrollWheelZoom={false}
        className="rally-map"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MapUpdater
          latitude={latitude}
          longitude={longitude}
        />

        <Circle
          center={center}
          radius={accuracy}
          pathOptions={{
            color: "#2563eb",
            fillColor: "#3b82f6",
            fillOpacity: 0.15,
          }}
        />

        <CircleMarker
          center={center}
          radius={8}
          pathOptions={{
            color: "#fff",
            weight: 3,
            fillColor: "#2563eb",
            fillOpacity: 1,
          }}
        >
          <Popup>
            Estás aquí
            <br />
            Precisión estimada: {accuracy.toFixed(1)} m
          </Popup>
        </CircleMarker>
      </MapContainer>

      <p>
        El punto azul representa tu posición estimada.
      </p>
    </section>
  );
}
