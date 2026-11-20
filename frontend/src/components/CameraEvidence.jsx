import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, savePhotoEvidence, deleteEvidence } from "../db/cluekeeperDB";
import "./CameraEvidence.css";

function SavedPhoto({ evidence }) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    const objectUrl = URL.createObjectURL(evidence.blob);
    setUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [evidence.blob]);

  return (
    <article className="photo-card">
      {url && <img src={url} alt="Evidencia almacenada" />}
      <p>Estado: {evidence.status}</p>
      <small>{new Date(evidence.createdAt).toLocaleString()}</small>
      <button onClick={() => deleteEvidence(evidence.id)}>
        Eliminar evidencia
      </button>
    </article>
  );
}

export default function CameraEvidence({ checkpointId = "checkpoint-demo" }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const requestRef = useRef(0);

  const [cameraActive, setCameraActive] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const savedPhotos = useLiveQuery(
    () =>
      db.evidences
        .where("checkpointId")
        .equals(checkpointId)
        .filter((item) => item.type === "PHOTO")
        .reverse()
        .sortBy("createdAt"),
    [checkpointId],
    [],
  );

  function stopCamera() {
    requestRef.current += 1;

    streamRef.current?.getTracks().forEach((track) => track.stop());

    streamRef.current = null;
    setCameraActive(false);
  }

  useEffect(() => {
    return () => {
      requestRef.current += 1;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!photo) {
      setPreview("");
      return;
    }

    const url = URL.createObjectURL(photo);
    setPreview(url);

    return () => URL.revokeObjectURL(url);
  }, [photo]);

  useEffect(() => {
    if (cameraActive && videoRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {
        setError("No se pudo iniciar la vista previa.");
        stopCamera();
      });
    }
  }, [cameraActive]);

  async function startCamera() {
    setError("");
    setMessage("");
    setPhoto(null);
    stopCamera();

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("La cámara no está disponible en este navegador.");
      return;
    }

    const requestId = ++requestRef.current;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      if (requestId !== requestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      setCameraActive(true);
    } catch (err) {
      const messages = {
        NotAllowedError: "Permiso de cámara denegado.",
        NotFoundError: "No se encontró una cámara.",
        NotReadableError: "La cámara está ocupada o no responde.",
      };

      setError(messages[err.name] || "No se pudo abrir la cámara.");
    }
  }

  function takePhoto() {
    const video = videoRef.current;

    if (!video?.videoWidth || !video?.videoHeight) {
      setError("Espera a que la cámara muestre la imagen.");
      return;
    }

    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1280 / video.videoWidth);

    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);

    const context = canvas.getContext("2d");
    if (!context) {
      setError("No se pudo procesar la imagen.");
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError("No se pudo capturar la fotografía.");
          return;
        }

        setPhoto(blob);
        stopCamera();
      },
      "image/jpeg",
      0.82,
    );
  }

  function handleFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) {
      setError("Selecciona una imagen válida de máximo 8 MB.");
      return;
    }

    stopCamera();
    setError("");
    setPhoto(file);
  }

  async function savePhoto() {
    if (!photo || saving) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      await savePhotoEvidence(photo, checkpointId);
      setMessage("Fotografía guardada localmente. Envío pendiente.");
      setPhoto(null);
    } catch {
      setError("No se pudo guardar. Revisa el almacenamiento disponible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="camera-evidence">
      <h2>HU-11 · Evidencia fotográfica</h2>
      <p>Checkpoint de prueba: {checkpointId}</p>

      <button onClick={startCamera}>Abrir cámara</button>

      <label className="file-label">
        Usar cámara del teléfono o seleccionar imagen
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFile}
        />
      </label>

      {cameraActive && (
        <div>
          <video ref={videoRef} autoPlay muted playsInline />
          <button onClick={takePhoto}>Tomar fotografía</button>
          <button onClick={stopCamera}>Cerrar cámara</button>
        </div>
      )}

      {preview && (
        <div>
          <h3>Vista previa</h3>
          <img src={preview} alt="Fotografía capturada" />
          <button onClick={savePhoto} disabled={saving}>
            {saving ? "Guardando..." : "Guardar evidencia"}
          </button>
          <button onClick={() => setPhoto(null)}>Descartar fotografía</button>
        </div>
      )}

      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}

      <h3>Evidencias locales ({savedPhotos.length})</h3>

      {savedPhotos.length === 0 && <p>Todavía no hay fotografías guardadas.</p>}

      {savedPhotos.map((evidence) => (
        <SavedPhoto key={evidence.id} evidence={evidence} />
      ))}
    </section>
  );
}
