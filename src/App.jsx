
import GeolocationTest from "./components/GeolocationTest";
import CameraEvidence from "./components/CameraEvidence";
import AudioEvidence from "./components/AudioEvidence";
import SyncStatus from "./components/SyncStatus";
import "./App.css";

export default function App() {
  return (
    <>
      <GeolocationTest />

      <CameraEvidence checkpointId="checkpoint-demo" />

      <AudioEvidence checkpointId="checkpoint-demo" />

      <SyncStatus />
    </>
  );
}
