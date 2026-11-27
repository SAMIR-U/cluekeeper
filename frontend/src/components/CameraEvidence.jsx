import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Camera, ImagePlus, Trash2 } from "lucide-react";
import { db, savePhotoEvidence, deleteEvidence } from "../db/cluekeeperDB";
import "./CameraEvidence.css";

async function toJpeg(file) {
  let source;
  let objectUrl;
  try {
    if (typeof createImageBitmap === "function") {
      try { source = await createImageBitmap(file); } catch { /* HEIC decoders may only be exposed through HTMLImageElement. */ }
    }
    if (!source) {
      const image = new Image();
      objectUrl = URL.createObjectURL(file);
      image.src = objectUrl;
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
      source = image;
    }
    const scale = Math.min(1, 1600 / source.width, 1600 / source.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No fue posible procesar la imagen.");
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("El navegador no pudo convertir la imagen a JPEG.")), "image/jpeg", 0.86));
    if (blob.size > 8 * 1024 * 1024) throw new Error("La imagen convertida supera el máximo de 8 MB.");
    return blob;
  } finally {
    source?.close?.();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

function SavedPhoto({ evidence }) {
  const [url] = useState(() => URL.createObjectURL(evidence.blob));

  useEffect(() => {
    return () => URL.revokeObjectURL(url);
  }, [url]);

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
  const [photoName, setPhotoName] = useState("");
  const [photoVersion, setPhotoVersion] = useState(0);
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
    setPhotoName("");
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
        setPhotoName("Foto tomada con la cámara");
        setPhotoVersion(version => version + 1);
        stopCamera();
      },
      "image/jpeg",
      0.82,
    );
  }

  async function handleFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!(file.type.startsWith("image/") || /\.(heic|heif)$/i.test(file.name)) || file.size > 20 * 1024 * 1024) {
      setError("Selecciona una imagen válida de máximo 8 MB.");
      return;
    }

    stopCamera();
    setError("");
    try {
      setPhoto(await toJpeg(file));
      setPhotoName(file.name);
      setPhotoVersion(version => version + 1);
    } catch {
      setError("No se pudo convertir esta imagen. Prueba guardarla como JPEG y vuelve a seleccionarla.");
    }
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

      <div className="photo-actions">
        <button type="button" onClick={startCamera}><Camera size={17}/> Abrir cámara</button>
        <label className="file-picker">
          <ImagePlus size={17}/><span>Elegir imagen</span>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFile}
        />
        </label>
      </div>
      {photoName && <p className="photo-filename" title={photoName}>{photoName}</p>}

      {cameraActive && (
        <div>
          <video ref={videoRef} autoPlay muted playsInline />
          <button onClick={takePhoto}>Tomar fotografía</button>
          <button onClick={stopCamera}>Cerrar cámara</button>
        </div>
      )}

      {photo && (
        <div>
          <h3>Vista previa</h3>
          <PhotoPreview key={photoVersion} photo={photo} />
          <button onClick={savePhoto} disabled={saving}>
            {saving ? "Guardando..." : "Guardar evidencia"}
          </button>
          <button type="button" className="photo-discard" onClick={() => { setPhoto(null); setPhotoName(""); }}><Trash2 size={16}/> Descartar fotografía</button>
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

function PhotoPreview({ photo }) {
  const [url] = useState(() => URL.createObjectURL(photo));

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  return <img src={url} alt="Fotografía capturada" />;
}
