import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  Activity, ArrowLeft, ArrowRight, Award, BookOpen, Camera, Check, CheckCircle2, Clock3,
  Cloud, Compass, Eye, Flag, LogOut, MapPin, Navigation, QrCode, Radio,
  RefreshCw, Rocket, ShieldCheck, Sparkles, Target, Trophy,
  Users, Wifi, X,
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import CameraEvidence from "./components/CameraEvidence";
import AudioEvidence from "./components/AudioEvidence";
import SyncStatus from "./components/SyncStatus";
import PushToggle from "./components/PushToggle";
import { db } from "./db/cluekeeperDB";
import { api, apiUrl, connectionError, getToken, setToken } from "./services/api";
import { syncEvidences } from "./services/evidenceSync";
import { saveUnlockedContent } from "./services/offlineRally";
import { queuePlayAction } from "./services/playSync";
import { disablePush } from "./services/push";
import { useGeolocation } from "./hooks/useGeolocation";
import "./App.css";

const PLAYER_NAV = [
  { id: "route", label: "Ruta", icon: Navigation },
  { id: "challenge", label: "Reto", icon: Target },
  { id: "progress", label: "Progreso", icon: Flag },
  { id: "ranking", label: "Ranking", icon: Trophy },
];
const ADMIN_NAV = [
  { id: "overview", label: "Resumen", icon: Activity },
  { id: "teams", label: "Equipos", icon: Users },
  { id: "checkpoints", label: "Checkpoints", icon: MapPin },
  { id: "evidences", label: "Evidencias", icon: Camera },
];
const RallyMap = lazy(() => import("./components/RallyMap"));

function safeUptcUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "uptc.edu.co" || url.hostname.endsWith(".uptc.edu.co"))
      ? url.href
      : null;
  } catch {
    return null;
  }
}

const STATION_PHOTOS = [
  { name: "Camilo Torres", file: "camilo-torres.jpg", detail: "Plaza Central Camilo Torres Restrepo", source: "https://www.uptc.edu.co/sitio/portal/cal_not_eve/noticias/det/Comunicado-001-a-la-opinion-publica" },
  { name: "Biblioteca", file: "biblioteca-entrada.jpg", detail: "Biblioteca Central UPTC" },
  { name: "Goranchacha", file: "goranchacha.jpg", detail: "Auditorio Goranchacha · Edificio de Posgrados", source: "https://www.uptc.edu.co/sitio/portal/cal_not_eve/noticias/det/Nuevo-Auditorio-Goranchacha-de-la-UPTC-abrio-sus-puertas-a-la-comunidad-universitaria/" },
  { name: "Restaurante", file: "restaurante.jpg", detail: "Restaurante estudiantil UPTC", source: "https://www.uptc.edu.co/sitio/portal/cal_not_eve/noticias/det/Servicio-de-restaurante-estudiantil-se-continuara-prestando-con-normalidad/" },
  { name: "Museo LN", file: "museo-ln.jpg", detail: "Museo de Historia Natural Luis Gonzalo Andrade", source: "https://www.uptc.edu.co/sitio/portal/sitios/universidad/vic_inv_ext/ext_univ/unidades/redmuseos/histnat/index.html" },
  { name: "El Muro", file: "muro.jpg", detail: "Mural de expresión universitaria en el campus UPTC" },
  { name: "Bienestar", file: "bienestar.png", detail: "Logo de Bienestar Universitario UPTC", source: "https://www.uptc.edu.co/sitio/portal/sitios/universidad/rectoria/bie_uni/campus/tunja/" },
  { name: "Rafael Azula", file: "rafael-azula.jpg", detail: "Edificio Rafael Azula Barrera", source: "https://www.uptc.edu.co/sitio/portal/sitios/universidad/rectoria/comunicaciones/5_perio/secc/amb/art_03_s3_2022/index.html" },
];

function formatDuration(seconds = 0) {
  if (seconds == null) return "—";
  const numeric = Number(seconds);
  if (!Number.isFinite(numeric)) return "—";
  const safe = Math.max(0, Math.floor(numeric));
  return [Math.floor(safe / 3600), Math.floor((safe % 3600) / 60), safe % 60]
    .map(value => String(value).padStart(2, "0")).join(":");
}
function dateTime(timestamp) {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("es-CO", { hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}
function Skeleton({ rows = 3 }) {
  return <div className="skeleton-stack" aria-label="Cargando información" aria-busy="true">
    <span className="skeleton skeleton-title" />
    {Array.from({ length: rows }, (_, index) => <span className="skeleton skeleton-line" key={index} />)}
    <span className="skeleton skeleton-block" />
  </div>;
}
function PageTabs({ items, value, onChange, label }) {
  return <nav className="page-tabs" aria-label={label}>
    {items.map(item => {
      const Icon = item.icon;
      return <button key={item.id} type="button" className={value === item.id ? "page-tab active" : "page-tab"}
        aria-current={value === item.id ? "page" : undefined} onClick={() => onChange(item.id)}>
        <Icon size={18} aria-hidden="true"/><span>{item.label}</span>
      </button>;
    })}
  </nav>;
}

function BrandMark() {
  const [failed, setFailed] = useState(false);
  return failed
    ? <span className="brand-mark-fallback" aria-hidden="true"><Compass size={24}/></span>
    : <img className="brand-mark-image" src="/pwa-192x192.png" alt="" onError={() => setFailed(true)}/>;
}

function AccessPanel({ onJoin, onOrganizer, busy, initialCode = "UPTC26" }) {
  const [teamName, setTeamName] = useState("");
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState("");
  const [activeStation, setActiveStation] = useState(0);
  const touchStart = useRef(null);
  const station = STATION_PHOTOS[activeStation];
  const sourceUrl = safeUptcUrl(station.source);
  const showStation = index => setActiveStation((index + STATION_PHOTOS.length) % STATION_PHOTOS.length);
  async function submit(event) {
    event.preventDefault(); setError("");
    try { await onJoin(teamName.trim(), code.trim().toUpperCase()); }
    catch (e) { setError(e.message); }
  }
  return <div className="access-layout">
    <section className="access-main">
      <h1>Rally UPTC:<br/><em>Conoce la U.</em></h1>
      <p className="lead">Recorre el campus, descifra sus señales y descubre una historia en cada parada.</p>
      <div className="event-summary"><span className="summary-icon"><Compass size={19}/></span><div><strong>Universidad Pedagógica y Tecnológica de Colombia</strong><span>Tunja · 8 estaciones · Rally de exploración</span></div></div>
      <form className="join-form" onSubmit={submit}>
        <label htmlFor="team-name">Nombre del equipo</label>
        <input id="team-name" name="teamName" autoComplete="organization" minLength={2} maxLength={40} required value={teamName} onChange={event => setTeamName(event.target.value)} placeholder="Ej. Guardianes del campus"/>
        <label htmlFor="rally-code">Código del rally</label>
        <input id="rally-code" name="rallyCode" required value={code} onChange={event => setCode(event.target.value)} placeholder="UPTC26" autoCapitalize="characters"/>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary full" type="submit" disabled={busy}>{busy ? "Conectando…" : "Entrar al rally"}<ArrowRight size={18}/></button>
      </form>
      <button type="button" className="text-button" onClick={onOrganizer}>Acceso de organización</button>
    </section>
    <aside className="campus-aside" aria-label="Lugares del recorrido">
      <div className="campus-topline"><span className="live-dot"/> RUTA UPTC · TUNJA</div>
      <div className="campus-carousel" role="region" aria-roledescription="carrusel" aria-label="Estaciones del rally UPTC" tabIndex={0} onKeyDown={event => { if (event.key === "ArrowRight") { event.preventDefault(); showStation(activeStation + 1); } if (event.key === "ArrowLeft") { event.preventDefault(); showStation(activeStation - 1); } }} onTouchStart={event => { touchStart.current = event.changedTouches[0].clientX; }} onTouchEnd={event => { if (touchStart.current == null) return; const swipe = event.changedTouches[0].clientX - touchStart.current; if (Math.abs(swipe) > 45) showStation(activeStation + (swipe < 0 ? 1 : -1)); touchStart.current = null; }}>
        <figure className="campus-slide" key={station.file || station.name}>
          {station.file ? <img src={`/places/${station.file}`} alt={station.detail} loading="lazy" decoding="async"/> : <div className="campus-no-photo" aria-label="Imagen del lugar pendiente"><MapPin size={36}/><span>Estación del campus</span></div>}
          <span className="campus-slide-count">{String(activeStation + 1).padStart(2, "0")} <i/> {String(STATION_PHOTOS.length).padStart(2, "0")}</span>
          <figcaption><span className="campus-slide-kicker">ESTACIÓN {String(activeStation + 1).padStart(2, "0")}</span><h2>{station.name}</h2><p>{station.detail}</p>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer">Ver fuente de la imagen <ArrowRight size={14}/></a>}</figcaption>
          <button type="button" className="campus-carousel-arrow previous" onClick={() => showStation(activeStation - 1)} aria-label="Ver estación anterior"><ArrowLeft size={19}/></button>
          <button type="button" className="campus-carousel-arrow next" onClick={() => showStation(activeStation + 1)} aria-label="Ver estación siguiente"><ArrowRight size={19}/></button>
        </figure>
      <div className="campus-carousel-controls"><span className="carousel-counter">{activeStation + 1} de {STATION_PHOTOS.length}</span><div className="carousel-dots" role="group" aria-label="Elegir estación">{STATION_PHOTOS.map((item, index) => <button key={item.file || item.name} type="button" className={index === activeStation ? "carousel-dot active" : "carousel-dot"} onClick={() => showStation(index)} aria-label={`Ver ${item.name}`} aria-current={index === activeStation ? "true" : undefined}/>)}</div><span className="carousel-hint">Desliza para explorar</span></div>
      </div>
      <p className="campus-carousel-footer">Ocho lugares del campus. Una misión compartida.</p>
    </aside>
  </div>;
}

function RoutePanel({ route, progress, rallyStatus, onRefresh, onRanking, loading, geo, onProximity, proximity, busy }) {
  const steps = progress?.checkpoints || [];
  const current = route?.checkpoint;
  const timeUp = route?.state === "TIME_UP" || rallyStatus === "FINISHED";
  return <div className="workspace-grid">
    <section className="panel main-panel">
      <div className="panel-heading"><div><span className="eyebrow">TU MISIÓN ACTUAL</span><h2>{current ? `Checkpoint ${current.position}` : route?.state === "ALL_COMPLETED" ? "Ruta completada" : timeUp ? "Rally finalizado" : "Esperando el inicio"}</h2></div><button type="button" className="icon-button" onClick={onRefresh} aria-label="Actualizar ruta" disabled={loading}><RefreshCw size={18} className={loading ? "spin" : ""}/></button></div>
      {loading ? <Skeleton rows={3}/> : current ? <>
        <div className="clue-banner"><span className="clue-mark"><BookOpen size={19}/></span><div><span className="eyebrow">PISTA DESBLOQUEADA</span><h3>{current.clue?.content?.title || `Pista ${current.position}`}</h3><p>{current.clue?.content?.text || "Acércate al siguiente lugar para descubrir la pista."}</p></div></div>
        <Suspense fallback={<div className="map-loading" role="status">Cargando mapa del campus…</div>}><RallyMap position={geo.position} checkpoint={current}/></Suspense>
        <div className="location-row"><div className="location-copy"><span className="location-icon"><MapPin size={18}/></span><div><strong>{geo.position ? "Ubicación obtenida" : "Valida tu proximidad"}</strong><span>{proximity?.reliable === false ? "Señal GPS poco precisa. Busca un espacio abierto o valida con el QR." : proximity ? proximity.inside ? "Estás dentro del perímetro del checkpoint." : Number.isFinite(proximity.remaining) ? `Aproximadamente ${Math.max(0, proximity.remaining)} m para llegar.` : "No se pudo calcular la distancia. Intenta de nuevo." : "El punto exacto se revela en el campus."}</span></div></div><button type="button" className="button button-dark" disabled={geo.loading || busy} onClick={onProximity}>{geo.loading || busy ? "Localizando…" : <><Navigation size={17}/> Verificar GPS</>}</button></div>
        {geo.error && <p className="form-error" role="alert">{geo.error}</p>}
      </> : <div className="empty-state"><span className="empty-icon">{timeUp || route?.state === "ALL_COMPLETED" ? <Trophy size={25}/> : <Clock3 size={25}/>}</span><h3>{route?.state === "ALL_COMPLETED" ? "¡Lo lograron!" : timeUp ? "El tiempo del rally terminó" : "El rally aún no comienza"}</h3><p>{route?.state === "ALL_COMPLETED" ? "Su equipo recorrió todos los puntos de la ruta." : timeUp ? "Consulta la clasificación y el resultado final del equipo." : "La pista aparecerá aquí cuando organización inicie el evento."}</p>{(timeUp || route?.state === "ALL_COMPLETED") && <button type="button" className="button button-primary" onClick={onRanking}>Ver clasificación</button>}</div>}
    </section>
    <aside className="panel route-side"><div className="panel-heading"><div><span className="eyebrow">RECORRIDO</span><h2>Estaciones</h2></div><span className="count-pill">{progress?.completed || 0}/{progress?.total || 0}</span></div>
      <div className="station-list">{steps.map((step, index) => <div className={`station-row ${step.status.toLowerCase()}`} key={step.id}><span className="station-number">{step.status === "COMPLETED" ? <Check size={15}/> : String(index + 1).padStart(2, "0")}</span><div><strong>{step.status === "LOCKED" ? `Estación ${index + 1}` : step.title || `Checkpoint ${index + 1}`}</strong><span>{step.status === "COMPLETED" ? `Completado · +${step.pointsAwarded} pts` : step.reviewStatus === "PENDING" ? step.reviewKind === "ANSWER" ? "Respuesta en revisión · esperando validación" : "Foto en revisión · esperando aprobación" : step.reviewStatus === "REJECTED" ? step.reviewKind === "ANSWER" ? "Respuesta no aprobada · puedes corregirla" : "Foto rechazada · requiere nuevo envío" : step.status === "ARRIVED" ? "Llegada validada · reto disponible" : step.status === "CLUE" ? "Pista actual" : "Bloqueado"}</span></div><span className={`station-status ${step.reviewStatus === "PENDING" ? "review-pending" : step.status.toLowerCase()}`}>{step.reviewStatus === "PENDING" ? "Revisión" : step.status === "COMPLETED" ? "Listo" : step.status === "CLUE" || step.status === "ARRIVED" ? "Actual" : "Luego"}</span></div>)}</div>
      <div className="route-tip"><ShieldCheck size={17}/><span>Las ubicaciones se desbloquean progresivamente para mantener la sorpresa.</span></div>
    </aside>
  </div>;
}

function QrArrival({ onResult }) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef(null);
  const [stream, setStream] = useState(null);
  const resultHandler = useRef(onResult);
  useEffect(() => { resultHandler.current = onResult; }, [onResult]);
  useEffect(() => {
    let alive = true;
    let frame;
    const video = videoRef.current;
    if (scanning && video && stream && "BarcodeDetector" in window) {
      video.srcObject = stream; video.play().catch(() => setError("No se pudo iniciar la cámara."));
      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      const scan = async () => {
        if (!alive) return;
        if (video.readyState >= 2) {
          try { const codes = await detector.detect(video); if (codes[0]?.rawValue) { await resultHandler.current(codes[0].rawValue); setStream(null); setScanning(false); return; } } catch { /* continue scan */ }
        }
        frame = requestAnimationFrame(scan);
      };
      frame = requestAnimationFrame(scan);
    }
    return () => { alive = false; cancelAnimationFrame(frame); };
  }, [scanning, stream]);
  function stop() { stream?.getTracks().forEach(track => track.stop()); setStream(null); setScanning(false); }
  async function start() {
    setError("");
    if (!("BarcodeDetector" in window)) { setError("El lector QR no está disponible en este navegador. Valida la estación con GPS."); return; }
    try { setStream(await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })); setScanning(true); }
    catch { setError("No fue posible abrir la cámara."); }
  }
  useEffect(() => () => stream?.getTracks().forEach(track => track.stop()), [stream]);
  return <div className="qr-arrival"><div><strong>Escaneo QR</strong><span>Lee el código físico de la estación.</span></div>{scanning ? <><video ref={videoRef} className="qr-video" muted playsInline/><button type="button" className="button button-soft" onClick={stop}><X size={16}/> Cancelar</button></> : <button type="button" className="button button-soft" onClick={start}><QrCode size={16}/> Abrir cámara</button>}{error && <p className="form-error" role="alert">{error}</p>}</div>;
}

function ChallengePanel({ route, progress, onArrive, onSubmit, busy, proximity, geo, onProximity, notify }) {
  const [answer, setAnswer] = useState("");
  const [heading, setHeading] = useState("");
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submissionKey = useRef(null);
  const submissionLock = useRef(false);
  const checkpoint = route?.checkpoint;
  const challenge = checkpoint?.challenge?.content;
  const checkpointId = checkpoint?.id;
  const checkpointProgress = progress?.checkpoints?.find(item => item.id === checkpointId);
  const reviewPending = checkpointProgress?.reviewStatus === "PENDING";
  const reviewRejected = checkpointProgress?.reviewStatus === "REJECTED";
  const openQuestion = challenge?.type === "QUESTION" && !challenge.options?.length;
  const pendingSubmission = useLiveQuery(() => checkpointId
    ? db.playActions.where("checkpointId").equals(checkpointId).filter(item => item.kind === "SUBMIT" && ["PENDING", "SENDING"].includes(item.status)).first()
    : Promise.resolve(null), [checkpointId], null);
  const saved = useLiveQuery(() => checkpointId ? db.evidences.where("checkpointId").equals(checkpointId).toArray() : Promise.resolve([]), [checkpointId], []);
  const orderedEvidence = [...saved].sort((a, b) => b.createdAt - a.createdAt);
  const localEvidence = orderedEvidence.find(item => item.type === challenge?.type);
  const arrived = checkpoint?.status === "ARRIVED";
  const cpArrive = async body => {
    setFeedback("");
    try { const response = await onArrive(checkpointId, body); setFeedback(response.pending ? "Llegada guardada en este dispositivo. Se validará al recuperar conexión." : response.arrived ? "Llegada validada. El reto está disponible." : response.message || `Aún fuera del perímetro · ${response.remaining ?? ""} m`); }
    catch (error) { setFeedback(error.message); }
  };
  const verifyQr = async code => { await cpArrive({ method: "QR", code, capturedAt: Date.now() }); };
  async function submit(event) {
    event.preventDefault();
    if (submissionLock.current || reviewPending || pendingSubmission) return;
    submissionLock.current = true;
    setSubmitting(true);
    setFeedback("");
    try {
      if (!arrived) { setFeedback("Valida primero tu llegada a la estación."); return; }
      submissionKey.current ||= crypto.randomUUID();
      let evidenceId;
      if (["PHOTO", "AUDIO"].includes(challenge?.type)) {
        if (!localEvidence) { setFeedback(challenge?.type === "PHOTO" ? "Guarda una foto para continuar." : "Guarda un audio para continuar."); return; }
        if (reviewRejected && challenge?.type === "PHOTO" && localEvidence.createdAt <= checkpointProgress.reviewSubmittedAt) { setFeedback("Captura una foto nueva: la anterior fue rechazada."); return; }
        if (localEvidence.status !== "SENT") {
          if (!navigator.onLine) evidenceId = localEvidence.id;
          else {
            setFeedback("Sincronizando la evidencia con el servidor…");
            await syncEvidences();
            const refreshed = await db.evidences.where("checkpointId").equals(checkpointId).toArray();
            evidenceId = refreshed.find(item => item.id === localEvidence.id && item.status === "SENT")?.id;
            if (!evidenceId) { setFeedback("La evidencia sigue pendiente de sincronización. Revisa tu conexión y vuelve a intentar."); return; }
          }
        } else evidenceId = localEvidence.id;
      }
      const result = await onSubmit(checkpointId, { submissionId: submissionKey.current, ...(challenge?.type === "QUESTION" ? { answer } : {}), ...(challenge?.type === "COMPASS" ? { heading: Number(heading) } : {}), ...(evidenceId ? { evidenceId } : {}), capturedAt: Date.now() });
      if (result.pending) { setFeedback("Reto guardado sin conexión. Se enviará una sola vez al recuperar conexión."); return; }
      submissionKey.current = null;
      if (result.pendingReview) { setFeedback(openQuestion ? "Respuesta enviada. Organización la revisará antes de desbloquear la siguiente pista." : "Foto enviada. La siguiente estación se desbloqueará cuando organización la apruebe."); return; }
      if (result.replayed) setFeedback("Este reto ya estaba registrado. Tu progreso se actualizó.");
      else if (result.correct || result.completed) { setFeedback(result.correct ? `¡Correcto! +${result.pointsAwarded} puntos.` : `Reto cerrado. Puntos otorgados: ${result.pointsAwarded}.`); notify("Progreso sincronizado con el rally."); }
      else setFeedback(`Respuesta incorrecta. ${result.attemptsLeft} intentos restantes.`);
    } catch (error) { if (error.code === "ALREADY_COMPLETED") submissionKey.current = null; setFeedback(error.message); }
    finally { submissionLock.current = false; setSubmitting(false); }
  }
  async function readCompass() {
    try {
      if (typeof window.DeviceOrientationEvent?.requestPermission === "function") {
        const permission = await window.DeviceOrientationEvent.requestPermission();
        if (permission !== "granted") throw new Error("Permite el acceso a sensores para usar la brújula.");
      }
      const handler = event => { const value = event.webkitCompassHeading ?? (event.alpha == null ? null : (360 - event.alpha) % 360); if (value != null) { setHeading(String(Math.round(value))); window.removeEventListener("deviceorientation", handler); } };
      window.addEventListener("deviceorientation", handler, { once: true });
      setTimeout(() => window.removeEventListener("deviceorientation", handler), 5000);
      setFeedback("Mueve el teléfono lentamente para capturar el rumbo.");
    } catch (error) { setFeedback(error.message || "No se detectó brújula; introduce el rumbo manualmente."); }
  }
  if (!checkpoint) return <section className="panel empty-state"><span className="empty-icon"><Target size={25}/></span><h2>{route?.state === "TIME_UP" ? "El tiempo terminó" : route?.state === "ALL_COMPLETED" ? "Ruta completada" : "El reto aparecerá aquí"}</h2><p>{route?.state === "TIME_UP" ? "El rally ya cerró. Revisa la clasificación para consultar el resultado." : route?.state === "ALL_COMPLETED" ? "Completaron todas las estaciones. Revisa la clasificación del equipo." : "Entra al rally y espera a que organización inicie el evento."}</p></section>;
  return <div className="challenge-layout">
    <section className="panel challenge-head"><div className="challenge-title-row"><div className="challenge-number">{String(checkpoint.position).padStart(2, "0")}</div><div><span className="eyebrow">RETO DE ESTACIÓN · {checkpoint.points} PTS</span><h2>{challenge?.title || `Checkpoint ${checkpoint.position}`}</h2></div><span className={`status-pill ${arrived ? "success" : "waiting"}`}>{arrived ? <><CheckCircle2 size={15}/> Llegada validada</> : <><Radio size={15}/> Por validar</>}</span></div><p className="challenge-instruction">{challenge?.instruction || "Primero valida tu llegada para ver el reto."}</p>{challenge?.description && <p className="challenge-description">{challenge.description}</p>}</section>
    <div className="challenge-columns">
      <section className="panel arrival-panel"><div className="panel-heading"><div><span className="eyebrow">PASO 1</span><h3>Confirma tu llegada</h3></div><MapPin size={20}/></div><p>Valida tu presencia en la estación con GPS o escanea el QR del punto.</p><div className="arrival-actions"><button type="button" className="button button-dark" disabled={geo.loading || busy || arrived} onClick={async () => { const position = geo.position || await geo.getLocation(); if (!position) return; const gpsArrival = { method: "GEOFENCE", ...position, capturedAt: Date.now() }; if (!navigator.onLine) { await cpArrive(gpsArrival); return; } try { const result = await onProximity(checkpointId, position); if (result.reliable && result.inside) await cpArrive(gpsArrival); else setFeedback(result.reliable && Number.isFinite(result.remaining) ? `Aún estás fuera del perímetro · ${Math.max(0, result.remaining)} m` : "La señal GPS es poco precisa. Intenta en un espacio abierto o usa el QR."); } catch (error) { if (!error.status || error.status >= 500) await cpArrive(gpsArrival); else setFeedback(error.message); } }}><Navigation size={17}/>{arrived ? "Validado" : geo.loading ? "Localizando…" : "Validar con GPS"}</button></div><QrArrival checkpointId={checkpointId} onResult={verifyQr}/>{proximity?.reliable && !proximity.inside && Number.isFinite(proximity.remaining) && <p className="hint-text">Distancia aproximada: {Math.max(0, proximity.remaining)} m.</p>}{feedback && <p className="inline-feedback" role="status">{feedback}</p>}</section>
      <section className="panel answer-panel"><div className="panel-heading"><div><span className="eyebrow">PASO 2 · {challenge?.type || "RETO"}</span><h3>{arrived ? "Completa la misión" : "Reto bloqueado"}</h3></div>{challenge?.type === "PHOTO" ? <Target size={20}/> : challenge?.type === "AUDIO" ? <Activity size={20}/> : challenge?.type === "COMPASS" ? <Compass size={20}/> : <BookOpen size={20}/>}</div>
        {reviewPending && <div className="review-notice" role="status"><Clock3 size={18}/><span>{checkpointProgress.reviewKind === "ANSWER" ? "Respuesta en revisión. La siguiente pista se habilitará cuando el organizador la valide." : "Foto en revisión. La próxima pista se habilita cuando el organizador la apruebe."}</span></div>}{reviewRejected && <div className="review-notice rejected" role="status"><Camera size={18}/><span>{checkpointProgress.reviewKind === "ANSWER" ? "Respuesta no aprobada. Puedes corregirla y volver a enviarla." : "La foto fue rechazada. Captura una nueva imagen para volver a enviarla."}{checkpointProgress.reviewNote ? ` Motivo: ${checkpointProgress.reviewNote}` : ""}</span></div>}
        {!arrived ? <div className="locked-prompt"><ShieldCheck size={22}/><span>La misión se abrirá al validar la llegada.</span></div> : !challenge ? <div className="locked-prompt"><Cloud size={22}/><span>El reto se descargará cuando el dispositivo vuelva a conectarse.</span></div> : <form onSubmit={submit}>
          {challenge?.type === "QUESTION" && <label className="field-label" htmlFor="challenge-answer">{openQuestion ? "Tu respuesta abierta" : "Tu respuesta"}{challenge.options?.length ? <select id="challenge-answer" name="answer" value={answer} onChange={event => setAnswer(event.target.value)} required><option value="">Selecciona una opción</option>{challenge.options.map(option => <option key={option} value={option}>{option}</option>)}</select> : <input id="challenge-answer" name="answer" value={answer} onChange={event => setAnswer(event.target.value)} maxLength={500} required placeholder="Escribe lo que observaste"/>}</label>}
          {challenge?.type === "PHOTO" && <CameraEvidence checkpointId={checkpointId}/>}
          {challenge?.type === "AUDIO" && <AudioEvidence checkpointId={checkpointId}/>}
          {challenge?.type === "COMPASS" && <div className="compass-capture"><p>Captura el rumbo que marca el sensor del teléfono.</p><div className="compass-input-row"><input aria-label="Rumbo en grados" type="number" min="0" max="360" value={heading} onChange={event => setHeading(event.target.value)} required placeholder="0–360°"/><button type="button" className="button button-soft" onClick={readCompass}><Compass size={17}/> Capturar rumbo</button></div></div>}
          <button className="button button-primary full submit-challenge" type="submit" disabled={busy || submitting || reviewPending || Boolean(pendingSubmission)}>{reviewPending ? "En revisión…" : pendingSubmission ? "Envío pendiente…" : busy || submitting ? "Enviando…" : <>Enviar reto <ArrowRight size={17}/></>}</button>
        </form>}
      </section>
    </div>
  </div>;
}

function ProgressPanel({ progress, rally, remaining }) {
  const checkpoints = progress?.checkpoints || [];
  return <div className="workspace-grid progress-layout"><section className="panel main-panel"><div className="panel-heading"><div><span className="eyebrow">AVANCE DEL EQUIPO</span><h2>Bitácora del recorrido</h2></div><span className="count-pill">{progress?.completed || 0} / {progress?.total || 0}</span></div><progress className="progress-meter" aria-label="Progreso del rally" max={progress?.total || 1} value={progress?.completed || 0}/><p className="muted-text">{progress?.total ? `${Math.round((progress.completed / progress.total) * 100)}% de la aventura completada` : "Esperando datos del rally"}</p><div className="progress-list">{checkpoints.map((item, index) => <article className="progress-row" key={item.id}><span className={`progress-node ${item.status.toLowerCase()}`}>{item.status === "COMPLETED" ? <Check size={16}/> : String(index + 1).padStart(2, "0")}</span><div className="progress-copy"><strong>{item.status === "LOCKED" ? `Checkpoint ${index + 1}` : item.title || `Checkpoint ${index + 1}`}</strong><span>{item.status === "COMPLETED" ? `Completado ${dateTime(item.completedAt)} · ${item.secondsTotal ?? "—"} s` : item.reviewStatus === "PENDING" ? item.reviewKind === "ANSWER" ? "Respuesta enviada · pendiente de validación" : "Foto enviada · pendiente de aprobación" : item.reviewStatus === "REJECTED" ? item.reviewKind === "ANSWER" ? "Respuesta no aprobada · corrígela" : "Foto rechazada · captura una nueva" : item.status === "ARRIVED" ? `Llegada ${dateTime(item.arrivedAt)} · reto en curso` : item.status === "CLUE" ? "Pista desbloqueada" : "Se desbloqueará al avanzar"}</span></div><b>{item.status === "COMPLETED" ? `+${item.pointsAwarded}` : `${item.points} pts`}</b></article>)}</div></section><aside className="panel stats-panel"><span className="eyebrow">TABLERO DE MISIÓN</span><div className="stat-block"><Trophy size={19}/><strong>{rally?.team?.score || 0}</strong><span>Puntos del equipo</span></div><div className="stat-block"><Target size={19}/><strong>{progress?.completed || 0}<small> / {progress?.total || 0}</small></strong><span>Estaciones completadas</span></div><div className="stat-block"><Clock3 size={19}/><strong>{formatDuration(remaining)}</strong><span>Tiempo restante</span></div></aside></div>;
}

function RankingPanel({ data, teamId }) {
  const rows = data?.ranking || [];
  const me = rows.find(row => row.teamId === teamId);
  return <div className="workspace-grid ranking-layout"><section className="panel ranking-hero"><div className="eyebrow light">RALLY UPTC · POSICIONES</div><h2>La misión se<br/><em>juega en equipo.</em></h2><div className="rank-summary"><span><Trophy size={18}/><strong>{me ? `#${me.rank}` : "—"}</strong><small>posición</small></span><span><Sparkles size={18}/><strong>{me?.score || 0}</strong><small>puntos</small></span></div><div className="hero-decoration"><Compass size={126}/></div></section><section className="panel leaderboard"><div className="panel-heading"><div><span className="eyebrow">CLASIFICACIÓN OFICIAL</span><h2>Equipos</h2></div><span className="live-pill"><i/>En vivo</span></div>{rows.length === 0 ? <div className="empty-state compact"><p>Aún no hay equipos en la tabla.</p></div> : <><div className="leader-head"><span>POS.</span><span>EQUIPO</span><span>ESTACIONES</span><span>PUNTOS</span></div>{rows.map(row => <div key={row.teamId} className={`leader-row ${row.teamId === teamId ? "your-team" : ""}`}><span className="rank-number">{String(row.rank).padStart(2, "0")}</span><strong className="leader-name">{row.name}{row.teamId === teamId && <small>Tu equipo</small>}</strong><span>{row.completedCheckpoints}</span><b>{row.score}<small> pts</small></b></div>)}</>}</section></div>;
}

function OrganizerAccess({ onLogin, onBack }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event) { event.preventDefault(); setBusy(true); setError(""); try { await onLogin(email, password); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  return <div className="access-layout admin-login-layout"><section className="access-main"><button type="button" className="text-button back-button" onClick={onBack}>← Volver al rally</button><div className="eyebrow">ÁREA DE ORGANIZACIÓN</div><h1>Coordina la<br/><em>aventura.</em></h1><p className="lead">Controla tiempos, equipos y resultados desde un solo panel.</p><form className="join-form" onSubmit={submit}><label htmlFor="admin-email">Correo organizador</label><input type="email" id="admin-email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} placeholder="organizador@cluekeeper.test"/><label htmlFor="admin-password">Contraseña</label><input type="password" id="admin-password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)}/>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary full" disabled={busy}>{busy ? "Ingresando…" : "Abrir panel de organización"}<ArrowRight size={17}/></button></form></section><aside className="campus-aside admin-aside"><span className="admin-aside-icon"><Activity size={28}/></span><h2>El campus está listo.</h2><p>Inicia el rally UPTC para habilitar las pistas a los equipos.</p></aside></div>;
}

function OrganizerPanel({ data, selected, onSelect, onRefresh, onControl, onNewEdition, onReview, onReviewSubmission, busy, onExport, onQr, onJoinQr, onEvidence, tab, tick, clockNow, clockOffset }) {
  const [extra, setExtra] = useState("10");
  const rallies = data?.rallies || [];
  const rally = selected;
  const teams = data?.teams || [];
  const checkpoints = data?.checkpoints || [];
  const remaining = rally?.status === "NOT_STARTED" ? null
    : rally && rally.endsAt != null && Number.isFinite(Number(rally.endsAt))
      ? Math.max(0, Math.floor((Number(rally.endsAt) - (clockNow + clockOffset)) / 1000))
      : rally && rally.remainingSeconds != null && Number.isFinite(Number(rally.remainingSeconds))
        ? Math.max(0, Number(rally.remainingSeconds) - tick) : null;
  return <div className="admin-workspace">
    <div className="admin-top-row"><div><span className="eyebrow">PANEL DE ORGANIZACIÓN</span><h2>{rally?.name || "Selecciona un rally"}</h2><p className="muted-text">{rally ? `${rally.code} · ${rally.status === "IN_PROGRESS" ? "En curso" : rally.status === "FINISHED" ? "Finalizado" : "Sin iniciar"}` : "Elige un evento para gestionar."}</p></div><div className="admin-actions"><select aria-label="Seleccionar rally" value={rally?.id || ""} onChange={e => onSelect(e.target.value)}>{rallies.map(item => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</select>{rally && <button type="button" className="button button-soft" onClick={() => onJoinQr(rally.id)}>QR de acceso</button>}<button type="button" className="icon-button" aria-label="Actualizar panel" onClick={onRefresh}><RefreshCw size={18}/></button></div></div>
    {!rally ? rallies.length ? <Skeleton rows={4}/> : <section className="panel empty-state admin-empty-state"><span className="empty-icon"><Flag size={25}/></span><h3>No hay rallies asignados a esta cuenta</h3><p>La API respondió, pero no encontró un rally para este organizador. En producción, verifica que `ADMIN_EMAIL` corresponda a la cuenta con la que iniciaste sesión y que el backend haya creado el rally UPTC26.</p><p>La lista se volverá a consultar automáticamente.</p></section> : <>
      {tab === "overview" && <><div className="admin-metrics"><div className="panel metric-card"><Users size={19}/><strong>{rally.teamsCount ?? teams.length}</strong><span>equipos inscritos</span></div><div className="panel metric-card"><Target size={19}/><strong>{checkpoints.length}</strong><span>estaciones del rally</span></div><div className="panel metric-card"><Clock3 size={19}/><strong>{formatDuration(rally.status === "NOT_STARTED" ? Number(rally.durationMinutes) * 60 : remaining)}</strong><span>{rally.status === "NOT_STARTED" ? "duración del rally" : "tiempo restante"}</span></div></div>
      <div className="admin-grid"><section className="panel control-panel"><span className="eyebrow">CONTROL DEL EVENTO</span><h3>Estado del rally</h3><p>{rally.status === "IN_PROGRESS" ? "Los equipos pueden consultar sus pistas y registrar avances." : rally.status === "FINISHED" ? "El evento está cerrado. Crea una nueva edición para volver a jugar; los resultados actuales se conservarán." : "Inicia el rally cuando las estaciones estén preparadas."}</p><div className="control-actions">{rally.status === "NOT_STARTED" && <button className="button button-primary" disabled={busy} onClick={() => onControl("start")}><Rocket size={17}/> Iniciar rally</button>}{rally.status === "FINISHED" && <button type="button" className="button button-primary" disabled={busy} onClick={onNewEdition}><RefreshCw size={17}/> Crear nueva edición</button>}{rally.status === "IN_PROGRESS" && <><div className="extend-control"><label htmlFor="extend-minutes">Extender</label><input id="extend-minutes" type="number" min="1" max="240" value={extra} onChange={e => setExtra(e.target.value)}/><span>min</span><button type="button" className="button button-soft" disabled={busy} onClick={() => onControl("extend", Number(extra))}>Añadir tiempo</button></div><button className="button button-danger" disabled={busy} onClick={() => onControl("finish")}>Finalizar rally</button></>}</div></section><section className="panel report-panel"><span className="report-icon"><Award size={21}/></span><div><span className="eyebrow">CIERRE DEL EVENTO</span><h3>Reporte de resultados</h3><p>Descarga la clasificación oficial en formato CSV.</p></div><button className="button button-dark" onClick={onExport}>Exportar CSV</button></section></div></>}
      {tab === "teams" && <section className="panel admin-table"><div className="panel-heading"><div><span className="eyebrow">CLASIFICACIÓN</span><h3>Equipos registrados</h3></div><span className="count-pill">{teams.length} equipos</span></div>{teams.length ? <div className="admin-team-list">{teams.map(team => <div className="admin-team-row" key={team.teamId}><span className="rank-number">{String(team.rank).padStart(2, "0")}</span><strong>{team.name}</strong><span>{team.completedCheckpoints} / {checkpoints.length} estaciones</span><b>{team.score} pts</b></div>)}</div> : <p className="muted-text">Los equipos aparecerán cuando se inscriban al rally.</p>}</section>}
      {tab === "checkpoints" && <section className="panel admin-table checkpoint-table"><div className="panel-heading"><div><span className="eyebrow">RUTA CONFIGURADA</span><h3>Estaciones del rally</h3></div></div>{checkpoints.map(cp => <div className="checkpoint-row" key={cp.id}><span className="checkpoint-order">{String(cp.position).padStart(2, "0")}</span><div><strong>{cp.title}</strong><span>{cp.challenge?.type} · {cp.points} pts · {cp.radius} m</span></div><button type="button" className="text-link" onClick={() => onQr(cp.id, rally.id)}>Ver QR</button></div>)}</section>}
      {tab === "evidences" && <section className="panel admin-table"><div className="panel-heading"><div><span className="eyebrow">ARCHIVO DEL RALLY</span><h3>Evidencias y respuestas</h3></div><span className="count-pill">{(data.evidences?.length || 0) + (data.submissions?.length || 0)}</span></div>
        {data.evidences?.length ? <div className="admin-team-list">{[...data.evidences].sort((a, b) => (a.reviewStatus === "PENDING" ? -1 : 0) - (b.reviewStatus === "PENDING" ? -1 : 0)).map(item => <div className="checkpoint-row evidence-row" key={item.id}><span className="checkpoint-order">{item.type === "PHOTO" ? <Camera size={16}/> : <Activity size={16}/>}</span><div><strong>{item.teamName} · Estación {item.checkpointPosition}</strong><span>{item.type === "PHOTO" ? "Fotografía" : "Audio"} · {new Date(item.receivedAt).toLocaleString("es-CO")}{item.late ? " · sincronizada tarde" : ""}</span><span className={`review-label ${String(item.reviewStatus || "").toLowerCase()}`}>{item.reviewStatus === "PENDING" ? "Pendiente de aprobación" : item.reviewStatus === "APPROVED" ? "Aprobada" : item.reviewStatus === "REJECTED" ? `Rechazada${item.reviewNote ? ` · ${item.reviewNote}` : ""}` : item.reviewStatus === "SUPERSEDED" ? "Reemplazada por evidencia más reciente" : "Recibida"}</span></div><div className="evidence-actions"><button type="button" className="button button-soft evidence-view" onClick={() => onEvidence(rally.id, item.id)} title="Ver evidencia"><Eye size={16}/><span>Ver</span></button>{item.type === "PHOTO" && item.reviewStatus === "PENDING" && <><button type="button" className="button button-primary review-button" disabled={busy} onClick={() => onReview(item.id, "APPROVE")}>Aprobar</button><button type="button" className="button button-danger review-button" disabled={busy} onClick={() => onReview(item.id, "REJECT")}>Rechazar</button></>}</div></div>)}</div> : <p className="muted-text">Las fotos y audios aparecerán cuando los equipos sincronicen sus evidencias.</p>}
        <h4 className="submission-list-title">Respuestas de los retos</h4>{data.submissions?.length ? <div className="admin-team-list">{data.submissions.map(item => <div className="checkpoint-row submission-row" key={item.id}><span className="checkpoint-order"><BookOpen size={16}/></span><div><strong>{item.teamName} · Estación {item.checkpointPosition} · {item.checkpointTitle}</strong><span>Respondieron: “{item.answerText}”</span>{item.matchedAnswer && <span>Respuesta sugerida: “{item.matchedAnswer}”</span>}</div><div className="evidence-actions"><span className={`review-label ${item.reviewStatus === "PENDING" ? "pending" : item.reviewStatus === "REJECTED" ? "rejected" : item.reviewStatus === "SUPERSEDED" ? "superseded" : item.reviewStatus === "APPROVED" || item.correct ? "approved" : "rejected"}`}>{item.reviewStatus === "PENDING" ? "Pendiente de validar" : item.reviewStatus === "APPROVED" ? "Aprobada" : item.reviewStatus === "REJECTED" ? "Rechazada" : item.reviewStatus === "SUPERSEDED" ? "Reemplazada" : item.correct ? "Correcta" : "Incorrecta"}</span>{item.reviewNote && <span className="review-label rejected">{item.reviewNote}</span>}{item.reviewStatus === "PENDING" && <><button type="button" className="button button-primary review-button" disabled={busy} onClick={() => onReviewSubmission(item.id, "APPROVE")}>Aprobar</button><button type="button" className="button button-danger review-button" disabled={busy} onClick={() => onReviewSubmission(item.id, "REJECT")}>Rechazar</button></>}</div></div>)}</div> : <p className="muted-text">Las respuestas escritas aparecerán aquí al enviarse.</p>}
      </section>}
    </>}
  </div>;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [panel, setPanel] = useState("route");
  const [authMode, setAuthMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [rallyData, setRallyData] = useState(null);
  const [route, setRoute] = useState(null);
  const [progress, setProgress] = useState(null);
  const [ranking, setRanking] = useState(null);
  const [proximity, setProximity] = useState(null);
  const [adminData, setAdminData] = useState({ rallies: [], teams: [], checkpoints: [], evidences: [], submissions: [] });
  const [adminRallyId, setAdminRallyId] = useState("");
  const [adminTab, setAdminTab] = useState("overview");
  const [tick, setTick] = useState(0);
  const [clockNow, setClockNow] = useState(0);
  const [clockOffset, setClockOffset] = useState(0);
  const lastNotificationId = useRef(0);
  const pollingRef = useRef(false);
  const geo = useGeolocation();
  const notify = useCallback(message => setToast(message), []);

  const refreshPlayer = useCallback(async ({ silent = false } = {}) => {
    if (session?.role !== "team") return;
    if (!silent) { setError(""); setLoading(true); }
    try {
      const [rallyResponse, progressResponse, rankingResponse] = await Promise.all([api("/rally"), api("/progress"), api("/ranking")]);
      setRallyData(rallyResponse); setProgress(progressResponse); setRanking(rankingResponse); setTick(0); setClockNow(Date.now());
      if (Number.isFinite(rallyResponse.rally?.serverTime)) setClockOffset(rallyResponse.rally.serverTime - Date.now());
      setProximity(null);
      let routeResponse;
      try { routeResponse = await api("/route/current"); }
      catch (routeError) { if (routeError.code === "RALLY_NOT_STARTED") routeResponse = { state: "WAITING", checkpoint: null }; else throw routeError; }
      setRoute(routeResponse);
      const rallyId = rallyResponse.rally?.id || session.rally?.id || localStorage.getItem("cluekeeper-rally-id");
      const teamId = rallyResponse.team?.id || session.team?.id;
      if (rallyId && teamId) {
        const current = routeResponse.checkpoint;
        if (current?.clue) await saveUnlockedContent({ rallyId, teamId, ...current.clue }).catch(() => {});
        if (current?.challenge) await saveUnlockedContent({ rallyId, teamId, ...current.challenge }).catch(() => {});
        await db.rallyStates.put({ key: `${rallyId}:${teamId}`, rallyId, teamId, rally: rallyResponse, progress: progressResponse, ranking: rankingResponse, route: routeResponse, updatedAt: Date.now() }).catch(() => {});
      }
    } catch (e) {
      if (e.status === 401 && session.team?.id) {
        const teamName = localStorage.getItem("cluekeeper-team-name");
        const teamKey = localStorage.getItem("cluekeeper-team-key");
        const code = localStorage.getItem("cluekeeper-team-code") || "UPTC26";
        if (teamName && teamKey) {
          try {
            const resumed = await api("/auth/team/resume", { method: "POST", body: { code, teamName, teamKey } });
            setToken(resumed.token);
            localStorage.setItem("cluekeeper-player-session", JSON.stringify({ role: "team", team: resumed.team, rally: resumed.rally }));
            window.location.reload();
            return;
          } catch { /* Keep the cached session visible if the server is still waking up. */ }
        }
      }
      const recoverable = !e.status || e.status >= 500;
      const rallyId = session.rally?.id || localStorage.getItem("cluekeeper-rally-id");
      const teamId = session.team?.id;
      const cached = recoverable && rallyId && teamId ? await db.rallyStates.get(`${rallyId}:${teamId}`).catch(() => null) : null;
      if (cached) {
        setRallyData(cached.rally); setProgress(cached.progress); setRanking(cached.ranking); setRoute(cached.route);
        setClockNow(Date.now());
        const serverTime = cached.rally?.rally?.serverTime;
        if (Number.isFinite(serverTime)) setClockOffset(serverTime - cached.updatedAt);
        setError("Sin conexión con el servidor. Mostramos el último estado guardado; los cambios se sincronizarán al reconectar.");
      } else setError(e.message);
    } finally { setLoading(false); }
  }, [session]);

  useEffect(() => {
    let active = true;
    (async () => {
      const saved = (() => { try { return JSON.parse(localStorage.getItem("cluekeeper-player-session") || "null"); } catch { return null; } })();
      try {
        const result = await api("/auth/me");
        if (active) { setSession(result); setPanel("route"); if (result.role === "team") localStorage.setItem("cluekeeper-player-session", JSON.stringify(result)); }
      } catch (error) {
        if (!active) return;
        if (error.status === 401) {
          const teamName = localStorage.getItem("cluekeeper-team-name");
          const teamKey = localStorage.getItem("cluekeeper-team-key");
          const code = localStorage.getItem("cluekeeper-team-code") || "UPTC26";
          if (teamName && teamKey) {
            try {
              const resumed = await api("/auth/team/resume", { method: "POST", body: { code, teamName, teamKey } });
              setToken(resumed.token);
              const sessionResult = { role: "team", team: resumed.team, rally: resumed.rally };
              setSession(sessionResult); setPanel("route");
              localStorage.setItem("cluekeeper-rally-id", resumed.rally.id);
              localStorage.setItem("cluekeeper-player-session", JSON.stringify(sessionResult));
              return;
            } catch (resumeError) {
              if (!resumeError.status || resumeError.status >= 500) {
                if (saved?.role === "team") { setSession({ ...saved, offline: true }); setPanel("route"); setError("Conectando con el servidor… se conservaron tus datos en este dispositivo."); return; }
              }
            }
          }
          setToken(null);
          if (saved?.role === "team") { setSession(saved); setPanel("route"); setError("Tu sesión venció. Conéctate para recuperarla y continuar."); }
        } else if (saved?.role === "team") {
          setSession({ ...saved, offline: true }); setPanel("route"); setError("Conectando con el servidor… se conservaron tus datos en este dispositivo.");
        } else setError("No fue posible conectar con ClueKeeper. Intenta de nuevo cuando tengas conexión.");
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, []);
  useEffect(() => { const timer = window.setTimeout(refreshPlayer, 0); return () => window.clearTimeout(timer); }, [refreshPlayer]);
  useEffect(() => { if (!session) return; const timer = window.setInterval(() => { setTick(value => value + 1); setClockNow(Date.now()); }, 1000); return () => window.clearInterval(timer); }, [session]);
  useEffect(() => {
    if (session?.role !== "team") return;
    let active = true;
    let initialized = false;
    const poll = async () => {
      if (!active || document.visibilityState !== "visible" || pollingRef.current) return;
      pollingRef.current = true;
      try {
        const result = await api(`/notifications?after=${lastNotificationId.current}`);
        const notes = result.notifications || [];
        if (!initialized) {
          if (notes.length) lastNotificationId.current = Math.max(...notes.map(note => Number(note.id) || 0));
          initialized = true;
        } else {
          for (const note of notes) {
            lastNotificationId.current = Math.max(lastNotificationId.current, Number(note.id) || 0);
            if (note.type === "RALLY_STARTED") notify("¡El rally comenzó! Tu primera pista ya está lista.");
            else if (note.type === "TIME_WARNING") notify(note.body || note.title);
            else if (note.type === "TIME_EXTENDED") notify(note.body || "Se amplió el tiempo del rally.");
            else if (note.type === "RALLY_FINISHED") notify(note.body || "El rally finalizó.");
            else if (note.type === "NEW_CLUE") notify("Hay una nueva pista disponible.");
            else if (note.type === "EVIDENCE_REJECTED") notify(note.body || "La fotografía fue rechazada. Toma otra y vuelve a enviarla.");
            else if (note.type === "ANSWER_REJECTED") notify(note.body || "Tu respuesta no fue aprobada. Revísala y vuelve a enviarla.");
            else if (note.type === "ROUTE_COMPLETED") notify("¡Ruta completada! Consulta el ranking.");
          }
        }
        await refreshPlayer({ silent: true });
      } catch { /* La próxima consulta reintenta cuando el servidor responda. */ }
      finally { pollingRef.current = false; }
    };
    void poll();
    const timer = window.setInterval(poll, 12_000);
    const onVisible = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [session?.role, refreshPlayer, notify]);
  useEffect(() => {
    if (session?.role !== "team" || !("serviceWorker" in navigator)) return;
    const refresh = event => { if (event.data?.source === "cluekeeper-push") void refreshPlayer({ silent: true }); };
    const synced = () => void refreshPlayer({ silent: true });
    const reconnected = () => void refreshPlayer({ silent: true });
    navigator.serviceWorker.addEventListener("message", refresh);
    window.addEventListener("cluekeeper:play-synced", synced);
    window.addEventListener("cluekeeper:connection-restored", reconnected);
    return () => { navigator.serviceWorker.removeEventListener("message", refresh); window.removeEventListener("cluekeeper:play-synced", synced); window.removeEventListener("cluekeeper:connection-restored", reconnected); };
  }, [session?.role, refreshPlayer]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 3500); return () => window.clearTimeout(timer); }, [toast]);

  const join = async (teamName, code) => {
    setBusy(true);
    try {
      const result = await api("/auth/team/join", { method: "POST", body: { code, teamName } });
      setToken(result.token); localStorage.setItem("cluekeeper-team-name", result.team.name); localStorage.setItem("cluekeeper-team-key", result.teamKey || "");
      const nextSession = { role: "team", team: result.team, rally: result.rally };
      localStorage.setItem("cluekeeper-team-code", code);
      localStorage.setItem("cluekeeper-rally-id", result.rally.id);
      localStorage.setItem("cluekeeper-player-session", JSON.stringify(nextSession));
      setSession(nextSession); setPanel("route"); notify(`Equipo ${result.team.name} conectado al rally.`);
    } finally { setBusy(false); }
  };
  const organizerLogin = async (email, password) => {
    const result = await api("/auth/organizer/login", { method: "POST", body: { email, password } });
    setToken(result.token); setSession({ role: "organizer", organizer: result.organizer }); setAuthMode(false); setAdminTab("overview");
    const list = await api("/admin/rallies"); setAdminData(current => ({ ...current, rallies: list.rallies }));
    const choice = list.rallies.find(item => item.code === "UPTC26") || list.rallies[0]; if (choice) await loadAdminRally(choice.id, list.rallies);
  };
  const loadAdminRally = async (id, rallyList = adminData.rallies) => {
    if (!id) return;
    const details = await api(`/admin/rallies/${id}`);
    const [received, submissions] = await Promise.all([
      api(`/admin/rallies/${id}/evidences`).catch(error => { setError(connectionError(error).message); return null; }),
      api(`/admin/rallies/${id}/submissions`).catch(error => { setError(connectionError(error).message); return null; }),
    ]);
    if (received && submissions) setError("");
    setAdminRallyId(id); setAdminData(current => ({ rallies: rallyList, teams: details.teams || [], checkpoints: details.checkpoints || [], evidences: received?.evidences || (current.selected?.id === id ? current.evidences : []), submissions: submissions?.submissions || (current.selected?.id === id ? current.submissions : []), selected: details })); setTick(0); setClockNow(Date.now());
    if (Number.isFinite(details.serverTime)) setClockOffset(details.serverTime - Date.now());
  };
  useEffect(() => {
    if (session?.role !== "organizer") return;
    let active = true;
    const refresh = async () => {
      try {
        const list = await api("/admin/rallies");
        if (!active) return;
        const preferred = list.rallies.find(item => item.id === adminRallyId) || list.rallies.find(item => item.code === "UPTC26") || list.rallies[0];
        if (!preferred) { setAdminData({ rallies: list.rallies, teams: [], checkpoints: [], evidences: [], submissions: [] }); return; }
        const [details, received, submissions] = await Promise.all([
          api(`/admin/rallies/${preferred.id}`),
          api(`/admin/rallies/${preferred.id}/evidences`).catch(error => { if (active) setError(connectionError(error).message); return null; }),
          api(`/admin/rallies/${preferred.id}/submissions`).catch(error => { if (active) setError(connectionError(error).message); return null; }),
        ]);
        if (!active) return;
        if (received && submissions) setError("");
        setAdminRallyId(preferred.id);
        setAdminData(current => ({ rallies: list.rallies, teams: details.teams || [], checkpoints: details.checkpoints || [], evidences: received?.evidences || (current.selected?.id === preferred.id ? current.evidences : []), submissions: submissions?.submissions || (current.selected?.id === preferred.id ? current.submissions : []), selected: details }));
        setClockNow(Date.now());
        if (Number.isFinite(details.serverTime)) setClockOffset(details.serverTime - Date.now());
      } catch (e) { if (active) setError(e.message); }
    };
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [session?.role, adminRallyId]);

  const proximityRequest = async (checkpointId, position) => {
    const location = position || geo.position || await geo.getLocation();
    if (!location) throw new Error(geo.error || "No se obtuvo la ubicación del dispositivo.");
    const result = await api(`/checkpoints/${checkpointId}/proximity`, { method: "POST", body: { latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy } });
    setProximity(result); return result;
  };
  const arrive = async (checkpointId, body) => {
    const captured = { ...body, capturedAt: body.capturedAt || Date.now() };
    try {
      const result = await api(`/checkpoints/${checkpointId}/arrive`, { method: "POST", body: captured });
      if (result.arrived) {
        const challenge = result.challenge;
        const rallyId = session?.rally?.id || localStorage.getItem("cluekeeper-rally-id");
        if (challenge && rallyId && session?.team?.id) await saveUnlockedContent({ rallyId, teamId: session.team.id, ...challenge }).catch(() => {});
        setRoute(value => value ? { ...value, checkpoint: { ...value.checkpoint, status: "ARRIVED", challenge } } : value);
        await refreshPlayer({ silent: true });
      }
      return result;
    } catch (error) {
      if ((!error.status || error.status >= 500 || !navigator.onLine) && session?.rally?.id && session?.team?.id) {
        await queuePlayAction({ rallyId: session.rally.id, teamId: session.team.id, checkpointId, kind: "ARRIVE", body: captured });
        const cachedChallenge = await db.rallyContent.where("rallyId").equals(session.rally.id)
          .filter(item => item.teamId === session.team.id && item.checkpointId === checkpointId && item.kind === "CHALLENGE")
          .first().catch(() => null);
        setRoute(value => value ? { ...value, checkpoint: { ...value.checkpoint, status: "ARRIVED", challenge: cachedChallenge || null } } : value);
        return { arrived: true, pending: true, method: captured.method, arrivedAt: captured.capturedAt };
      }
      throw error;
    }
  };
  const submit = async (checkpointId, body) => {
    const idempotencyKey = body.submissionId || crypto.randomUUID();
    try {
    const result = await api(`/checkpoints/${checkpointId}/submit`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: { ...body, submissionId: idempotencyKey } });
    if (result.pendingReview) {
      await refreshPlayer({ silent: true });
    } else if (result.completed) {
      setRoute(result.finished ? { state: "ALL_COMPLETED", checkpoint: null } : { state: "ACTIVE", checkpoint: result.next });
      setPanel(result.finished ? "ranking" : "route");
      await refreshPlayer({ silent: true });
    }
    return result;
    } catch (e) {
      if (e.code === "ALREADY_COMPLETED") { await refreshPlayer(); setPanel("route"); return { correct: false, completed: true, pointsAwarded: 0, replayed: true }; }
      if (!navigator.onLine || !e.status || e.status >= 500) {
        const rallyId = session?.rally?.id || localStorage.getItem("cluekeeper-rally-id");
        if (rallyId && session?.team?.id) {
          await queuePlayAction({ rallyId, teamId: session.team.id, checkpointId, kind: "SUBMIT", body: { ...body, capturedAt: body.capturedAt || Date.now() }, idempotencyKey });
          return { correct: false, completed: false, pending: true, pointsAwarded: 0 };
        }
      }
      throw e;
    }
  };
  const logout = async () => { if (session?.role === "team") await disablePush().catch(() => {}); try { await api("/auth/logout", { method: "POST" }); } catch { /* local session still clears */ } setToken(null); for (const key of ["cluekeeper-team-name", "cluekeeper-team-key", "cluekeeper-team-code", "cluekeeper-rally-id", "cluekeeper-player-session"]) localStorage.removeItem(key); setSession(null); setPanel("route"); setRallyData(null); setRoute(null); setProgress(null); };
  const control = async (action, minutes) => {
    const id = adminData.selected?.id; if (!id) return;
    setBusy(true);
    try { await api(`/admin/rallies/${id}/${action}`, { method: "POST", ...(action === "extend" ? { body: { minutes } } : {}) }); notify(action === "start" ? "Rally iniciado." : action === "finish" ? "Rally finalizado." : `Se agregaron ${minutes} minutos.`); const list = await api("/admin/rallies"); await loadAdminRally(id, list.rallies); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const newEdition = async () => {
    const sourceId = adminData.selected?.id; if (!sourceId) return;
    setBusy(true); setError("");
    try {
      const created = await api(`/admin/rallies/${sourceId}/new-edition`, { method: "POST" });
      const list = await api("/admin/rallies");
      await loadAdminRally(created.id, list.rallies);
      notify(`Nueva edición lista. Código de acceso: ${created.code}`);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const exportReport = async () => {
    const rally = adminData.selected; if (!rally) return;
    try { const csv = await api(`/admin/rallies/${rally.id}/report?format=csv`); const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" })); link.download = `rally-${rally.code}-resultados.csv`; link.click(); URL.revokeObjectURL(link.href); notify("Reporte CSV descargado."); }
    catch (e) { setError(e.message); }
  };
  const reviewEvidence = async (evidenceId, action) => {
    const rally = adminData.selected; if (!rally) return;
    setBusy(true); setError("");
    try {
      const result = await api(`/admin/rallies/${rally.id}/evidences/${evidenceId}/review`, { method: "POST", body: { action } });
      setAdminData(current => ({ ...current, evidences: current.evidences.map(item => item.id === evidenceId ? { ...item, reviewStatus: result.status, reviewedAt: result.reviewedAt } : item) }));
      const list = await api("/admin/rallies");
      await loadAdminRally(rally.id, list.rallies);
      notify(action === "APPROVE" ? result.alreadyCompleted ? "Foto aprobada. La estación ya estaba completada; no se duplicaron puntos." : `Foto aprobada. +${result.pointsAwarded} puntos; siguiente pista desbloqueada.` : "Foto rechazada. El equipo recibirá un aviso para intentarlo de nuevo.");
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const reviewSubmission = async (submissionId, action) => {
    const rally = adminData.selected; if (!rally) return;
    setBusy(true); setError("");
    try {
      const result = await api(`/admin/rallies/${rally.id}/submissions/${submissionId}/review`, { method: "POST", body: { action } });
      setAdminData(current => ({ ...current, submissions: current.submissions.map(item => item.id === submissionId ? { ...item, reviewStatus: result.status, correct: result.status === "APPROVED" || item.correct, reviewNote: result.reviewNote || item.reviewNote } : item) }));
      const list = await api("/admin/rallies");
      await loadAdminRally(rally.id, list.rallies);
      notify(action === "APPROVE" ? result.alreadyCompleted ? "Respuesta aprobada. La estación ya estaba completada; no se duplicaron puntos." : `Respuesta aprobada. +${result.pointsAwarded} puntos y siguiente pista desbloqueada.` : "Respuesta rechazada. El equipo podrá intentarlo de nuevo.");
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const openQr = async (checkpointId, rallyId) => {
    try { const response = await fetch(apiUrl(`/admin/rallies/${rallyId}/checkpoints/${checkpointId}/qr`), { headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {}, credentials: "include" }); if (!response.ok) throw new Error("No se pudo abrir el QR."); const svg = await response.text(); const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })); window.open(url, "_blank", "noopener"); setTimeout(() => URL.revokeObjectURL(url), 60000); }
    catch (e) { setError(connectionError(e).message); }
  };
  const openJoinQr = async rallyId => {
    try { const response = await fetch(apiUrl(`/admin/rallies/${rallyId}/join-qr`), { headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {}, credentials: "include" }); if (!response.ok) throw new Error("No se pudo abrir el QR de acceso."); const svg = await response.text(); const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })); window.open(url, "_blank", "noopener"); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
    catch (e) { setError(connectionError(e).message); }
  };
  const openEvidence = async (rallyId, evidenceId) => {
    try { const response = await fetch(apiUrl(`/admin/rallies/${rallyId}/evidences/${evidenceId}/file`), { headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {}, credentials: "include" }); if (!response.ok) throw new Error("No se pudo descargar la evidencia."); const blob = await response.blob(); const url = URL.createObjectURL(blob); window.open(url, "_blank", "noopener"); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
    catch (e) { setError(connectionError(e).message); }
  };
  const selectedAdmin = adminData.selected || adminData.rallies.find(item => item.id === adminRallyId);
  const endsAt = rallyData?.rally?.endsAt;
  const rallyStatus = rallyData?.rally?.status;
  const remaining = !rallyData?.rally ? null : rallyStatus === "NOT_STARTED" ? null : rallyStatus === "FINISHED" ? 0
    : endsAt != null && Number.isFinite(Number(endsAt))
      ? Math.max(0, Math.floor((Number(endsAt) - (clockNow + clockOffset)) / 1000))
      : rallyData.rally.remainingSeconds != null && Number.isFinite(Number(rallyData.rally.remainingSeconds))
        ? Math.max(0, Number(rallyData.rally.remainingSeconds) - tick) : null;

  if (loading && !session) return <div className="app-shell"><main className="loading-shell"><div className="brand"><BrandMark/><strong>ClueKeeper</strong></div><Skeleton rows={5}/></main></div>;
  return <div className="app-shell">
    <header className="topbar"><button type="button" className="brand" onClick={() => { setPanel("route"); }}><BrandMark/><span><strong>ClueKeeper</strong><small>RALLY UPTC · TUNJA</small></span></button><div className="topbar-center">{session?.role === "team" && <span className="team-label"><Users size={15}/>{session.team.name}</span>}{session?.role === "organizer" && <span className="team-label"><ShieldCheck size={15}/>{session.organizer.name || session.organizer.email}</span>}</div>{session && <button type="button" className="profile-button" title="Cerrar sesión" aria-label="Cerrar sesión" onClick={logout}><LogOut size={18}/></button>}</header>
    <main className="page-content">
      {!session && !authMode && <AccessPanel busy={busy} onJoin={join} onOrganizer={() => setAuthMode(true)} initialCode={new URLSearchParams(window.location.search).get("code") || "UPTC26"}/>}
      {!session && authMode && <OrganizerAccess onLogin={organizerLogin} onBack={() => setAuthMode(false)}/>}
      {session?.role === "team" && <><div className="page-heading"><div><span className="eyebrow">UNIVERSIDAD PEDAGÓGICA Y TECNOLÓGICA DE COLOMBIA</span><h1>{panel === "route" ? "Explora el campus" : panel === "challenge" ? "Reto activo" : panel === "progress" ? "Tu bitácora" : "Marcador"}</h1><span className={`rally-status-chip ${String(rallyData?.rally?.status || "NOT_STARTED").toLowerCase()}`}><i/>{rallyData?.rally?.status === "IN_PROGRESS" ? "Rally en curso" : rallyData?.rally?.status === "FINISHED" ? "Rally finalizado" : "Rally por iniciar"}</span></div><div className="header-timer"><Clock3 size={18}/><div><small>{rallyData?.rally?.status === "NOT_STARTED" ? "DURACIÓN DEL RALLY" : "TIEMPO RESTANTE"}</small><strong>{formatDuration(rallyData?.rally?.status === "NOT_STARTED" ? Number(rallyData.rally.durationMinutes) * 60 : remaining)}</strong></div></div></div>
        <PageTabs items={PLAYER_NAV} value={panel} onChange={setPanel} label="Secciones del rally"/>
        <PushToggle/>
        {error && <div className="notice-error" role="alert"><span>{error}</span><button type="button" onClick={() => { setError(""); refreshPlayer(); }} aria-label="Reintentar"><RefreshCw size={16}/></button></div>}
        {panel === "route" && <RoutePanel route={route} progress={progress} rallyStatus={rallyData?.rally?.status} onRanking={() => setPanel("ranking")} onRefresh={refreshPlayer} loading={loading} geo={geo} proximity={proximity} busy={busy} onProximity={async () => { try { const result = await proximityRequest(route?.checkpoint?.id); setProximity(result); } catch (e) { setError(e.message); } }}/>}
        {panel === "challenge" && <ChallengePanel route={route} progress={progress} onArrive={arrive} onSubmit={submit} busy={busy} proximity={proximity} geo={geo} onProximity={proximityRequest} notify={notify}/>}
        {panel === "progress" && <ProgressPanel progress={progress} rally={rallyData} remaining={remaining}/>}
        {panel === "ranking" && <RankingPanel data={ranking} teamId={rallyData?.team?.id}/>}
        <div className="sync-strip"><span className="sync-cloud"><Cloud size={19}/></span><div><strong>Progreso protegido</strong><span>Las evidencias se guardan en este dispositivo y se sincronizan al recuperar conexión.</span></div><span className="offline-indicator"><Wifi size={15}/> {navigator.onLine ? "Conectado" : "Sin conexión"}</span></div><details className="sync-details"><summary>Estado de sincronización</summary><SyncStatus onNotify={notify}/></details>
      </>}
      {session?.role === "organizer" && <><PageTabs items={ADMIN_NAV} value={adminTab} onChange={setAdminTab} label="Panel de organización"/>{error && <div className="notice-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError("")} aria-label="Cerrar"><X size={16}/></button></div>}<OrganizerPanel data={adminData} selected={selectedAdmin} onSelect={id => loadAdminRally(id)} onRefresh={() => loadAdminRally(adminRallyId)} onControl={control} onNewEdition={newEdition} onReview={reviewEvidence} onReviewSubmission={reviewSubmission} busy={busy} onExport={exportReport} onQr={openQr} onJoinQr={openJoinQr} onEvidence={openEvidence} tab={adminTab} tick={tick} clockNow={clockNow} clockOffset={clockOffset}/><div className="admin-logout"><button type="button" className="text-button" onClick={logout}>Cerrar sesión</button></div></>}
    </main>
    {toast && <div className="toast" role="status"><CheckCircle2 size={17}/>{toast}</div>}
  </div>;
}

