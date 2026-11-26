
import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  db,
  saveAudioEvidence,
  deleteEvidence,
} from "../db/cluekeeperDB";
import "./AudioEvidence.css";

function getSupportedAudioType() {
  const formats = [
    "audio/webm;codecs=opus",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];

  return formats.find(type =>
    MediaRecorder.isTypeSupported(type)
  ) || "";
}

function AudioPlayer({ blob }) {
  const [url] = useState(() => URL.createObjectURL(blob));

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  return url
    ? <audio controls src={url} preload="metadata" />
    : null;
}

export default function AudioEvidence({
  checkpointId = "checkpoint-demo",
}) {
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const requestRef = useRef(0);
  const mountedRef = useRef(false);
  const recordingStartedAt = useRef(0);

  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const audios = useLiveQuery(
    () => db.evidences
      .where("checkpointId")
      .equals(checkpointId)
      .filter(item => item.type === "AUDIO")
      .reverse()
      .sortBy("createdAt"),
    [checkpointId],
    []
  );

  function releaseMicrophone() {
    streamRef.current?.getTracks().forEach(
      track => track.stop()
    );
    streamRef.current = null;
  }

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      requestRef.current += 1;

      const recorder = recorderRef.current;
      recorderRef.current = null;

      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }

      streamRef.current?.getTracks().forEach(
        track => track.stop()
      );
      streamRef.current = null;
    };
  }, []);

  async function startRecording() {
    if (recording || starting) return;

    if (!navigator.mediaDevices?.getUserMedia ||
        !window.MediaRecorder) {
      setError("Este navegador no admite grabación de audio.");
      return;
    }

    const requestId = ++requestRef.current;

    setStarting(true);
    setError("");
    setMessage("");
    setAudioBlob(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      if (!mountedRef.current ||
          requestId !== requestRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = getSupportedAudioType();

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      recorderRef.current = recorder;

      recorder.ondataavailable = event => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        releaseMicrophone();
        if (mountedRef.current) {
          setError("Ocurrió un error durante la grabación.");
          setRecording(false);
        }
      };

      recorder.onstop = () => {
        const chunks = chunksRef.current;
        const type = recorder.mimeType ||
          chunks[0]?.type ||
          "application/octet-stream";

        releaseMicrophone();

        if (!mountedRef.current) return;

        const blob = new Blob(chunks, { type });
        const durationMs = Date.now() - recordingStartedAt.current;

        if (blob.size > 0) {
          if (durationMs >= 5000) setAudioBlob(blob);
          else setError("La evidencia debe contener al menos 5 segundos de audio.");
        } else {
          setError("No se capturó ningún audio.");
        }

        setRecording(false);
      };

      recorder.start();
      recordingStartedAt.current = Date.now();
      setRecording(true);
    } catch (err) {
      releaseMicrophone();

      const errors = {
        NotAllowedError: "Permiso de micrófono denegado.",
        NotFoundError: "No se encontró un micrófono.",
        NotReadableError: "El micrófono está ocupado.",
      };

      if (mountedRef.current) {
        setError(errors[err.name] ||
          "No se pudo iniciar la grabación.");
      }
    } finally {
      if (mountedRef.current) setStarting(false);
    }
  }

  function stopRecording() {
    const recorder = recorderRef.current;

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }

  async function saveRecording() {
    if (!audioBlob || saving) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      await saveAudioEvidence(audioBlob, checkpointId);
      setAudioBlob(null);
      setMessage("Audio guardado localmente. Envío pendiente.");
    } catch {
      setError("No se pudo guardar el audio en IndexedDB.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="audio-evidence">
      <h2>HU-13 · Evidencia de audio</h2>

      <p>Checkpoint: {checkpointId}</p>

      {!recording && (
        <button
          disabled={starting}
          onClick={startRecording}
        >
          {starting
            ? "Solicitando micrófono..."
            : "Iniciar grabación"}
        </button>
      )}

      {recording && (
        <div role="status">
          <p>🔴 Grabando audio… mantén la grabación al menos 5 segundos.</p>

          <button onClick={stopRecording}>
            Detener grabación
          </button>
        </div>
      )}

      {audioBlob && (
        <div>
          <h3>Vista previa</h3>

          <AudioPlayer blob={audioBlob} />

          <button
            onClick={saveRecording}
            disabled={saving}
          >
            {saving ? "Guardando..." : "Guardar audio"}
          </button>

          <button onClick={() => setAudioBlob(null)}>
            Descartar
          </button>
        </div>
      )}

      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}

      <h3>Audios guardados ({audios.length})</h3>

      {audios.map(audio => (
        <article className="audio-card" key={audio.id}>
          <AudioPlayer blob={audio.blob} />

          <p>Estado: {audio.status}</p>

          <small>
            {new Date(audio.createdAt).toLocaleString()}
          </small>

          <button onClick={() => deleteEvidence(audio.id)}>
            Eliminar audio
          </button>
        </article>
      ))}

      {audios.length === 0 && (
        <p>No hay grabaciones guardadas.</p>
      )}
    </section>
  );
}
