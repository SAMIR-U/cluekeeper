import GeolocationTest from "./components/GeolocationTest";
import CameraEvidence from "./components/CameraEvidence";
import "./App.css";

export default function App() {
  return (
    <>
      <GeolocationTest />

      <CameraEvidence checkpointId="checkpoint-demo" />
    </>
  );
}