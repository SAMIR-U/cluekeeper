
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
  const campus = [5.5530, -73.3567];
  const center = position ? [position.latitude, position.longitude] : campus;
  const accuracy = Number.isFinite(position?.accuracy) ? position.accuracy : null;

  return (
    <section className="map-section">
      <div className="map-heading"><div><h3>Mapa del campus</h3><p>{position ? "Punto azul: tu ubicación · verde: UPTC" : "Activa el GPS para mostrar tu ubicación"}</p></div><span className="map-provider">OpenStreetMap</span></div>

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

        <MapUpdater latitude={center[0]} longitude={center[1]} />

        <CircleMarker center={campus} radius={10} pathOptions={{ color: "#fff", weight: 3, fillColor: "#047857", fillOpacity: 1 }}>
          <Popup>Campus principal UPTC · Tunja</Popup>
        </CircleMarker>
        {position && accuracy !== null && <Circle center={center} radius={accuracy} pathOptions={{ color: "#2563eb", fillColor: "#3b82f6", fillOpacity: 0.15 }} />}
        {position && <CircleMarker center={center} radius={8} pathOptions={{ color: "#fff", weight: 3, fillColor: "#2563eb", fillOpacity: 1 }}>
          <Popup>Estás aquí{accuracy !== null && <><br/>Precisión estimada: {accuracy.toFixed(1)} m</>}</Popup>
        </CircleMarker>}
      </MapContainer>

      <p className="map-note">La ruta muestra el campus. Los checkpoints mantienen su ubicación oculta hasta desbloquearse.</p>
    </section>
  );
}
