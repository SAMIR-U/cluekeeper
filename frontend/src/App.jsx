import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity, ArrowRight, Award, BookOpen, Check, CheckCircle2, Clock3,
  Cloud, Compass, Flag, LogOut, MapPin, Navigation, QrCode, Radio,
  RefreshCw, Rocket, ShieldCheck, Sparkles, Target, Trophy,
  Users, Wifi, X,
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import CameraEvidence from "./components/CameraEvidence";
import AudioEvidence from "./components/AudioEvidence";
import SyncStatus from "./components/SyncStatus";
import { db } from "./db/cluekeeperDB";
import { api, apiUrl, getToken, setToken } from "./services/api";
import { syncEvidences } from "./services/evidenceSync";
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
];

function formatDuration(seconds = 0) {
  const safe = Math.max(0, Math.floor(seconds));
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

function AccessPanel({ onJoin, onOrganizer, busy, initialCode = "UPTC26" }) {
  const [teamName, setTeamName] = useState("");
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault(); setError("");
    try { await onJoin(teamName.trim(), code.trim().toUpperCase()); }
    catch (e) { setError(e.message); }
  }
  return <div className="access-layout">
    <section className="access-main">
      <div className="eyebrow"><span className="eyebrow-dot"/> RALLY DE OBSERVACIÓN · TUNJA</div>
      <h1>La ruta del<br/><em>guardián UPTC.</em></h1>
      <p className="lead">Recorre el campus, descifra sus señales y descubre una historia en cada parada.</p>
      <div className="event-summary"><span className="summary-icon"><Compass size={19}/></span><div><strong>Universidad Pedagógica y Tecnológica de Colombia</strong><span>Tunja · 4 estaciones · Rally de exploración</span></div></div>
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
      <div className="campus-map-art"><div className="map-orbit orbit-a"/><div className="map-orbit orbit-b"/><div className="map-path"/><span className="campus-pin pin-a">01</span><span className="campus-pin pin-b">02</span><span className="campus-pin pin-c">03</span><span className="campus-pin pin-d">04</span><span className="campus-center"><Compass size={34}/></span></div>
      <div className="campus-places"><span>Plaza Camilo Torres</span><span>Biblioteca Central</span><span>Bohío · Goranchacha</span><span>Jardín Botánico</span></div>
      <p>Cuatro lugares del campus. Una misión compartida.</p>
    </aside>
  </div>;
}

function RoutePanel({ route, progress, onRefresh, loading, geo, onProximity, proximity, busy }) {
  const steps = progress?.checkpoints || [];
  const current = route?.checkpoint;
  return <div className="workspace-grid">
    <section className="panel main-panel">
      <div className="panel-heading"><div><span className="eyebrow">TU MISIÓN ACTUAL</span><h2>{current ? `Checkpoint ${current.position}` : route?.state === "ALL_COMPLETED" ? "Ruta completada" : "Esperando el inicio"}</h2></div><button type="button" className="icon-button" onClick={onRefresh} aria-label="Actualizar ruta" disabled={loading}><RefreshCw size={18} className={loading ? "spin" : ""}/></button></div>
      {loading ? <Skeleton rows={3}/> : current ? <>
        <div className="clue-banner"><span className="clue-mark"><BookOpen size={19}/></span><div><span className="eyebrow">PISTA DESBLOQUEADA</span><h3>{current.clue?.content?.title || `Pista ${current.position}`}</h3><p>{current.clue?.content?.text || "Acércate al siguiente lugar para descubrir la pista."}</p></div></div>
        <div className="route-map-box"><div className="route-map-lines"/><span className="route-map-label label-campus">CAMPUS UPTC</span>{steps.map((step, index) => <span key={step.id} className={`route-point route-point-${index + 1} ${step.status === "COMPLETED" ? "visited" : step.id === current.id ? "current" : "locked"}`} title={`Checkpoint ${step.position}`}>{step.status === "COMPLETED" ? <Check size={13}/> : String(step.position).padStart(2, "0")}</span>)}<span className="map-legend"><i/>Tu ruta · {progress?.completed || 0}/{progress?.total || 0} completados</span></div>
        <div className="location-row"><div className="location-copy"><span className="location-icon"><MapPin size={18}/></span><div><strong>{geo.position ? "Ubicación lista" : "Valida tu proximidad"}</strong><span>{proximity ? proximity.inside ? "Estás dentro del perímetro del checkpoint." : `Aproximadamente ${Math.max(0, proximity.remaining)} m para llegar.` : "El punto exacto se revela en el campus."}</span></div></div><button type="button" className="button button-dark" disabled={geo.loading || busy} onClick={onProximity}>{geo.loading || busy ? "Localizando…" : <><Navigation size={17}/> Verificar GPS</>}</button></div>
        {geo.error && <p className="form-error" role="alert">{geo.error}</p>}
      </> : <div className="empty-state"><span className="empty-icon"><Clock3 size={25}/></span><h3>{route?.state === "ALL_COMPLETED" ? "¡Lo lograron!" : "El rally aún no comienza"}</h3><p>{route?.state === "ALL_COMPLETED" ? "Su equipo recorrió todos los puntos de la ruta." : "La pista aparecerá aquí cuando organización inicie el evento."}</p></div>}
    </section>
    <aside className="panel route-side"><div className="panel-heading"><div><span className="eyebrow">RECORRIDO</span><h2>Estaciones</h2></div><span className="count-pill">{progress?.completed || 0}/{progress?.total || 0}</span></div>
      <div className="station-list">{steps.map((step, index) => <div className={`station-row ${step.status.toLowerCase()}`} key={step.id}><span className="station-number">{step.status === "COMPLETED" ? <Check size={15}/> : String(index + 1).padStart(2, "0")}</span><div><strong>{step.status === "LOCKED" ? `Estación ${index + 1}` : step.title || `Checkpoint ${index + 1}`}</strong><span>{step.status === "COMPLETED" ? `Completado · +${step.pointsAwarded} pts` : step.status === "ARRIVED" ? "Llegada validada · reto disponible" : step.status === "CLUE" ? "Pista actual" : "Bloqueado"}</span></div><span className={`station-status ${step.status.toLowerCase()}`}>{step.status === "COMPLETED" ? "Listo" : step.status === "CLUE" || step.status === "ARRIVED" ? "Actual" : "Luego"}</span></div>)}</div>
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
    if (!("BarcodeDetector" in window)) { setError("Este navegador no admite el lector QR. Solicita el código al organizador."); return; }
    try { setStream(await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })); setScanning(true); }
    catch { setError("No fue posible abrir la cámara."); }
  }
  useEffect(() => () => stream?.getTracks().forEach(track => track.stop()), [stream]);
  return <div className="qr-arrival"><div><strong>Escaneo QR</strong><span>Lee el código físico de la estación.</span></div>{scanning ? <><video ref={videoRef} className="qr-video" muted playsInline/><button type="button" className="button button-soft" onClick={stop}><X size={16}/> Cancelar</button></> : <button type="button" className="button button-soft" onClick={start}><QrCode size={16}/> Abrir cámara</button>}{error && <p className="form-error" role="alert">{error}</p>}</div>;
}

function ChallengePanel({ route, onArrive, onSubmit, busy, proximity, geo, onProximity, notify }) {
  const [answer, setAnswer] = useState("");
  const [heading, setHeading] = useState("");
  const [feedback, setFeedback] = useState("");
  const checkpoint = route?.checkpoint;
  const challenge = checkpoint?.challenge?.content;
  const checkpointId = checkpoint?.id;
  const saved = useLiveQuery(() => checkpointId ? db.evidences.where("checkpointId").equals(checkpointId).toArray() : Promise.resolve([]), [checkpointId], []);
  const currentEvidence = [...saved].reverse().find(item => item.type === challenge?.type && item.status === "SENT");
  const localEvidence = [...saved].reverse().find(item => item.type === challenge?.type);
  const arrived = checkpoint?.status === "ARRIVED";
  const cpArrive = async body => {
    setFeedback("");
    try { const response = await onArrive(checkpointId, body); setFeedback(response.arrived ? "Llegada validada. El reto está disponible." : response.message || `Aún fuera del perímetro · ${response.remaining ?? ""} m`); }
    catch (error) { setFeedback(error.message); }
  };
  const verifyQr = async code => { await cpArrive({ method: "QR", code, capturedAt: Date.now() }); };
  async function submit(event) {
    event.preventDefault(); setFeedback("");
    try {
      if (!arrived) { setFeedback("Valida primero tu llegada a la estación."); return; }
      let evidenceId;
      if (["PHOTO", "AUDIO"].includes(challenge?.type)) {
        if (!localEvidence) { setFeedback(challenge?.type === "PHOTO" ? "Guarda una foto para continuar." : "Guarda un audio para continuar."); return; }
        if (!currentEvidence) {
          setFeedback("Sincronizando la evidencia con el servidor…");
          await syncEvidences();
          const refreshed = await db.evidences.where("checkpointId").equals(checkpointId).toArray();
          evidenceId = [...refreshed].reverse().find(item => item.type === challenge.type && item.status === "SENT")?.id;
          if (!evidenceId) { setFeedback("La evidencia sigue pendiente de sincronización. Revisa tu conexión y vuelve a intentar."); return; }
        } else evidenceId = currentEvidence.id;
      }
      const result = await onSubmit(checkpointId, { ...(challenge?.type === "QUESTION" ? { answer } : {}), ...(challenge?.type === "COMPASS" ? { heading: Number(heading) } : {}), ...(evidenceId ? { evidenceId } : {}), capturedAt: Date.now() });
      if (result.correct || result.completed) { setFeedback(result.correct ? `¡Correcto! +${result.pointsAwarded} puntos.` : `Reto cerrado. Puntos otorgados: ${result.pointsAwarded}.`); notify("Progreso sincronizado con el rally."); }
      else setFeedback(`Respuesta incorrecta. ${result.attemptsLeft} intentos restantes.`);
    } catch (error) { setFeedback(error.message); }
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
  if (!checkpoint) return <section className="panel empty-state"><span className="empty-icon"><Target size={25}/></span><h2>El siguiente reto aparecerá aquí</h2><p>Entra al rally y espera a que el equipo organizador lo inicie.</p></section>;
  return <div className="challenge-layout">
    <section className="panel challenge-head"><div className="challenge-title-row"><div className="challenge-number">{String(checkpoint.position).padStart(2, "0")}</div><div><span className="eyebrow">RETO DE ESTACIÓN · {checkpoint.points} PTS</span><h2>{challenge?.title || `Checkpoint ${checkpoint.position}`}</h2></div><span className={`status-pill ${arrived ? "success" : "waiting"}`}>{arrived ? <><CheckCircle2 size={15}/> Llegada validada</> : <><Radio size={15}/> Por validar</>}</span></div><p className="challenge-instruction">{challenge?.instruction || "Primero valida tu llegada para ver el reto."}</p>{challenge?.description && <p className="challenge-description">{challenge.description}</p>}</section>
    <div className="challenge-columns">
      <section className="panel arrival-panel"><div className="panel-heading"><div><span className="eyebrow">PASO 1</span><h3>Confirma tu llegada</h3></div><MapPin size={20}/></div><p>Valida tu presencia en la estación con GPS o escanea el QR del punto.</p><div className="arrival-actions"><button type="button" className="button button-dark" disabled={geo.loading || busy || arrived} onClick={async () => { const position = geo.position || await geo.getLocation(); if (!position) return; const result = await (onProximity(checkpointId, position)); if (result.inside) await cpArrive({ method: "GEOFENCE", ...position, capturedAt: Date.now() }); else setFeedback(`Aún estás fuera del perímetro · ${Math.max(0, result.remaining)} m`); }}><Navigation size={17}/>{arrived ? "Validado" : geo.loading ? "Localizando…" : "Validar con GPS"}</button></div><QrArrival checkpointId={checkpointId} onResult={verifyQr}/>{proximity && !proximity.inside && <p className="hint-text">Distancia aproximada: {Math.max(0, proximity.remaining)} m.</p>}{feedback && <p className="inline-feedback" role="status">{feedback}</p>}</section>
      <section className="panel answer-panel"><div className="panel-heading"><div><span className="eyebrow">PASO 2 · {challenge?.type || "RETO"}</span><h3>{arrived ? "Completa la misión" : "Reto bloqueado"}</h3></div>{challenge?.type === "PHOTO" ? <Target size={20}/> : challenge?.type === "AUDIO" ? <Activity size={20}/> : challenge?.type === "COMPASS" ? <Compass size={20}/> : <BookOpen size={20}/>}</div>
        {!arrived ? <div className="locked-prompt"><ShieldCheck size={22}/><span>La misión se abrirá al validar la llegada.</span></div> : <form onSubmit={submit}>
          {challenge?.type === "QUESTION" && <label className="field-label" htmlFor="challenge-answer">Tu respuesta<input id="challenge-answer" name="answer" value={answer} onChange={event => setAnswer(event.target.value)} maxLength={500} required placeholder="Escribe lo que observaste"/></label>}
          {challenge?.type === "PHOTO" && <CameraEvidence checkpointId={checkpointId}/>}
          {challenge?.type === "AUDIO" && <AudioEvidence checkpointId={checkpointId}/>}
          {challenge?.type === "COMPASS" && <div className="compass-capture"><p>Captura el rumbo que marca el sensor del teléfono.</p><div className="compass-input-row"><input aria-label="Rumbo en grados" type="number" min="0" max="360" value={heading} onChange={event => setHeading(event.target.value)} required placeholder="0–360°"/><button type="button" className="button button-soft" onClick={readCompass}><Compass size={17}/> Capturar rumbo</button></div></div>}
          <button className="button button-primary full submit-challenge" type="submit" disabled={busy}>{busy ? "Enviando…" : <>Enviar reto <ArrowRight size={17}/></>}</button>
        </form>}
      </section>
    </div>
  </div>;
}

function ProgressPanel({ progress, rally }) {
  const checkpoints = progress?.checkpoints || [];
  return <div className="workspace-grid progress-layout"><section className="panel main-panel"><div className="panel-heading"><div><span className="eyebrow">AVANCE DEL EQUIPO</span><h2>Bitácora del recorrido</h2></div><span className="count-pill">{progress?.completed || 0} / {progress?.total || 0}</span></div><progress className="progress-meter" aria-label="Progreso del rally" max={progress?.total || 1} value={progress?.completed || 0}/><p className="muted-text">{progress?.total ? `${Math.round((progress.completed / progress.total) * 100)}% de la aventura completada` : "Esperando datos del rally"}</p><div className="progress-list">{checkpoints.map((item, index) => <article className="progress-row" key={item.id}><span className={`progress-node ${item.status.toLowerCase()}`}>{item.status === "COMPLETED" ? <Check size={16}/> : String(index + 1).padStart(2, "0")}</span><div className="progress-copy"><strong>{item.status === "LOCKED" ? `Checkpoint ${index + 1}` : item.title || `Checkpoint ${index + 1}`}</strong><span>{item.status === "COMPLETED" ? `Completado ${dateTime(item.completedAt)} · ${item.secondsTotal ?? "—"} s` : item.status === "ARRIVED" ? `Llegada ${dateTime(item.arrivedAt)} · reto en curso` : item.status === "CLUE" ? "Pista desbloqueada" : "Se desbloqueará al avanzar"}</span></div><b>{item.status === "COMPLETED" ? `+${item.pointsAwarded}` : `${item.points} pts`}</b></article>)}</div></section><aside className="panel stats-panel"><span className="eyebrow">TABLERO DE MISIÓN</span><div className="stat-block"><Trophy size={19}/><strong>{rally?.team?.score || 0}</strong><span>Puntos del equipo</span></div><div className="stat-block"><Target size={19}/><strong>{progress?.completed || 0}<small> / {progress?.total || 0}</small></strong><span>Estaciones completadas</span></div><div className="stat-block"><Clock3 size={19}/><strong>{formatDuration(rally?.rally?.remainingSeconds)}</strong><span>Tiempo restante</span></div></aside></div>;
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

function OrganizerPanel({ data, selected, onSelect, onRefresh, onControl, busy, onExport, onQr, tab }) {
  const [extra, setExtra] = useState("10");
  const rallies = data?.rallies || [];
  const rally = selected;
  const teams = data?.teams || [];
  const checkpoints = data?.checkpoints || [];
  return <div className="admin-workspace">
    <div className="admin-top-row"><div><span className="eyebrow">PANEL DE ORGANIZACIÓN</span><h2>{rally?.name || "Selecciona un rally"}</h2><p className="muted-text">{rally ? `${rally.code} · ${rally.status === "IN_PROGRESS" ? "En curso" : rally.status === "FINISHED" ? "Finalizado" : "Sin iniciar"}` : "Elige un evento para gestionar."}</p></div><div className="admin-actions"><select aria-label="Seleccionar rally" value={rally?.id || ""} onChange={e => onSelect(e.target.value)}>{rallies.map(item => <option key={item.id} value={item.id}>{item.name} · {item.code}</option>)}</select><button type="button" className="icon-button" aria-label="Actualizar panel" onClick={onRefresh}><RefreshCw size={18}/></button></div></div>
    {!rally ? <Skeleton rows={4}/> : <>
      {tab === "overview" && <><div className="admin-metrics"><div className="panel metric-card"><Users size={19}/><strong>{rally.teamsCount ?? teams.length}</strong><span>equipos inscritos</span></div><div className="panel metric-card"><Target size={19}/><strong>{checkpoints.length}</strong><span>estaciones del rally</span></div><div className="panel metric-card"><Clock3 size={19}/><strong>{formatDuration(rally.remainingSeconds)}</strong><span>tiempo restante</span></div></div>
      <div className="admin-grid"><section className="panel control-panel"><span className="eyebrow">CONTROL DEL EVENTO</span><h3>Estado del rally</h3><p>{rally.status === "IN_PROGRESS" ? "Los equipos pueden consultar sus pistas y registrar avances." : rally.status === "FINISHED" ? "El evento está cerrado. Puedes descargar el reporte final." : "Inicia el rally cuando las estaciones estén preparadas."}</p><div className="control-actions">{rally.status === "NOT_STARTED" && <button className="button button-primary" disabled={busy} onClick={() => onControl("start")}><Rocket size={17}/> Iniciar rally</button>}{rally.status === "IN_PROGRESS" && <><div className="extend-control"><label htmlFor="extend-minutes">Extender</label><input id="extend-minutes" type="number" min="1" max="240" value={extra} onChange={e => setExtra(e.target.value)}/><span>min</span><button type="button" className="button button-soft" disabled={busy} onClick={() => onControl("extend", Number(extra))}>Añadir tiempo</button></div><button className="button button-danger" disabled={busy} onClick={() => onControl("finish")}>Finalizar rally</button></>}</div></section><section className="panel report-panel"><span className="report-icon"><Award size={21}/></span><div><span className="eyebrow">CIERRE DEL EVENTO</span><h3>Reporte de resultados</h3><p>Descarga la clasificación oficial en formato CSV.</p></div><button className="button button-dark" onClick={onExport}>Exportar CSV</button></section></div></>}
      {tab === "teams" && <section className="panel admin-table"><div className="panel-heading"><div><span className="eyebrow">CLASIFICACIÓN</span><h3>Equipos registrados</h3></div><span className="count-pill">{teams.length} equipos</span></div>{teams.length ? <div className="admin-team-list">{teams.map(team => <div className="admin-team-row" key={team.teamId}><span className="rank-number">{String(team.rank).padStart(2, "0")}</span><strong>{team.name}</strong><span>{team.completedCheckpoints} / {checkpoints.length} estaciones</span><b>{team.score} pts</b></div>)}</div> : <p className="muted-text">Los equipos aparecerán cuando se inscriban al rally.</p>}</section>}
      {tab === "checkpoints" && <section className="panel admin-table checkpoint-table"><div className="panel-heading"><div><span className="eyebrow">RUTA CONFIGURADA</span><h3>Estaciones del rally</h3></div></div>{checkpoints.map(cp => <div className="checkpoint-row" key={cp.id}><span className="checkpoint-order">{String(cp.position).padStart(2, "0")}</span><div><strong>{cp.title}</strong><span>{cp.challenge?.type} · {cp.points} pts · {cp.radius} m</span></div><button type="button" className="text-link" onClick={() => onQr(cp.id, rally.id)}>Ver QR</button></div>)}</section>}
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
  const [adminData, setAdminData] = useState({ rallies: [], teams: [], checkpoints: [] });
  const [adminRallyId, setAdminRallyId] = useState("");
  const [adminTab, setAdminTab] = useState("overview");
  const [tick, setTick] = useState(0);
  const geo = useGeolocation();
  const notify = useCallback(message => setToast(message), []);

  const refreshPlayer = useCallback(async () => {
    if (session?.role !== "team") return;
    setError(""); setLoading(true);
    try {
      const [rallyResponse, progressResponse, rankingResponse] = await Promise.all([api("/rally"), api("/progress"), api("/ranking")]);
      setRallyData(rallyResponse); setProgress(progressResponse); setRanking(rankingResponse);
      try { setRoute(await api("/route/current")); }
      catch (routeError) { if (routeError.code === "RALLY_NOT_STARTED") setRoute({ state: "WAITING", checkpoint: null }); else throw routeError; }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [session]);

  useEffect(() => {
    let active = true;
    api("/auth/me").then(result => { if (active) { setSession(result); setPanel("route"); } })
      .catch(() => { if (active) { setSession(null); setToken(null); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => { const timer = window.setTimeout(refreshPlayer, 0); return () => window.clearTimeout(timer); }, [refreshPlayer]);
  useEffect(() => { if (session?.role !== "team") return; const timer = window.setInterval(() => setTick(value => value + 1), 1000); return () => window.clearInterval(timer); }, [session]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 3500); return () => window.clearTimeout(timer); }, [toast]);

  const join = async (teamName, code) => {
    setBusy(true);
    try {
      const result = await api("/auth/team/join", { method: "POST", body: { code, teamName } });
      setToken(result.token); localStorage.setItem("cluekeeper-team-name", result.team.name); localStorage.setItem("cluekeeper-team-key", result.teamKey || "");
      setSession({ role: "team", team: result.team, rally: result.rally }); setPanel("route"); notify(`Equipo ${result.team.name} conectado al rally.`);
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
    setAdminRallyId(id); setAdminData({ rallies: rallyList, teams: details.teams || [], checkpoints: details.checkpoints || [], selected: details });
  };
  useEffect(() => {
    if (session?.role !== "organizer") return;
    let active = true;
    (async () => { try { const list = await api("/admin/rallies"); if (!active) return; setAdminData(value => ({ ...value, rallies: list.rallies })); const preferred = list.rallies.find(item => item.id === adminRallyId) || list.rallies.find(item => item.code === "UPTC26") || list.rallies[0]; if (preferred) await loadAdminRally(preferred.id, list.rallies); } catch (e) { if (active) setError(e.message); } })();
    return () => { active = false; };
  // Load once per authenticated organizer session; selection refresh uses the explicit handler.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.role]);

  const proximityRequest = async (checkpointId, position) => {
    const location = position || geo.position || await geo.getLocation();
    if (!location) throw new Error(geo.error || "No se obtuvo la ubicación del dispositivo.");
    const result = await api(`/checkpoints/${checkpointId}/proximity`, { method: "POST", body: { latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy } });
    setProximity(result); return result;
  };
  const arrive = async (checkpointId, body) => {
    const result = await api(`/checkpoints/${checkpointId}/arrive`, { method: "POST", body });
    if (result.arrived) { const challenge = await api(`/checkpoints/${checkpointId}/challenge`); setRoute(value => value ? { ...value, checkpoint: { ...value.checkpoint, status: "ARRIVED", challenge } } : value); await refreshPlayer(); }
    return result;
  };
  const submit = async (checkpointId, body) => {
    const result = await api(`/checkpoints/${checkpointId}/submit`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body });
    if (result.completed) { await refreshPlayer(); if (result.next) setPanel("route"); }
    return result;
  };
  const logout = async () => { try { await api("/auth/logout", { method: "POST" }); } catch { /* local session still clears */ } setToken(null); localStorage.removeItem("cluekeeper-team-name"); localStorage.removeItem("cluekeeper-team-key"); setSession(null); setPanel("route"); setRallyData(null); setRoute(null); setProgress(null); };
  const control = async (action, minutes) => {
    const id = adminData.selected?.id; if (!id) return;
    setBusy(true);
    try { await api(`/admin/rallies/${id}/${action}`, { method: "POST", ...(action === "extend" ? { body: { minutes } } : {}) }); notify(action === "start" ? "Rally iniciado." : action === "finish" ? "Rally finalizado." : `Se agregaron ${minutes} minutos.`); const list = await api("/admin/rallies"); await loadAdminRally(id, list.rallies); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const exportReport = async () => {
    const rally = adminData.selected; if (!rally) return;
    try { const csv = await api(`/admin/rallies/${rally.id}/report?format=csv`); const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" })); link.download = `rally-${rally.code}-resultados.csv`; link.click(); URL.revokeObjectURL(link.href); notify("Reporte CSV descargado."); }
    catch (e) { setError(e.message); }
  };
  const openQr = async (checkpointId, rallyId) => {
    try { const response = await fetch(apiUrl(`/admin/rallies/${rallyId}/checkpoints/${checkpointId}/qr`), { headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {}, credentials: "include" }); if (!response.ok) throw new Error("No se pudo abrir el QR."); const svg = await response.text(); const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })); window.open(url, "_blank", "noopener"); setTimeout(() => URL.revokeObjectURL(url), 60000); }
    catch (e) { setError(e.message); }
  };
  const selectedAdmin = adminData.selected || adminData.rallies.find(item => item.id === adminRallyId);
  const remaining = rallyData?.rally?.remainingSeconds != null ? Math.max(0, rallyData.rally.remainingSeconds - tick) : 0;

  if (loading && !session) return <div className="app-shell"><main className="loading-shell"><div className="brand"><img className="brand-mark-image" src="/pwa-192x192.png" alt=""/><strong>ClueKeeper</strong></div><Skeleton rows={5}/></main></div>;
  return <div className="app-shell">
    <header className="topbar"><button type="button" className="brand" onClick={() => { setPanel("route"); }}><img className="brand-mark-image" src="/pwa-192x192.png" alt=""/><span><strong>ClueKeeper</strong><small>RALLY UPTC · TUNJA</small></span></button><div className="topbar-center"><span className="event-label"><i className={rallyData?.rally?.status === "IN_PROGRESS" ? "live-dot" : "idle-dot"}/>{rallyData?.rally?.status === "IN_PROGRESS" ? "EN CURSO" : "RALLY UPTC"}</span>{session?.role === "team" && <span className="team-label"><Users size={15}/>{session.team.name}</span>}{session?.role === "organizer" && <span className="team-label"><ShieldCheck size={15}/>{session.organizer.name || session.organizer.email}</span>}</div>{session && <button type="button" className="profile-button" title="Cerrar sesión" aria-label="Cerrar sesión" onClick={logout}><LogOut size={18}/></button>}</header>
    <main className="page-content">
      {!session && !authMode && <AccessPanel busy={busy} onJoin={join} onOrganizer={() => setAuthMode(true)} initialCode={new URLSearchParams(window.location.search).get("code") || "UPTC26"}/>}
      {!session && authMode && <OrganizerAccess onLogin={organizerLogin} onBack={() => setAuthMode(false)}/>}
      {session?.role === "team" && <><div className="page-heading"><div><span className="eyebrow">UNIVERSIDAD PEDAGÓGICA Y TECNOLÓGICA DE COLOMBIA</span><h1>{panel === "route" ? "Explora el campus" : panel === "challenge" ? "Reto activo" : panel === "progress" ? "Tu bitácora" : "Marcador"}</h1></div><div className="header-timer"><Clock3 size={18}/><div><small>TIEMPO RESTANTE</small><strong>{formatDuration(remaining)}</strong></div></div></div>
        <PageTabs items={PLAYER_NAV} value={panel} onChange={setPanel} label="Secciones del rally"/>
        {error && <div className="notice-error" role="alert"><span>{error}</span><button type="button" onClick={() => { setError(""); refreshPlayer(); }} aria-label="Reintentar"><RefreshCw size={16}/></button></div>}
        {panel === "route" && <RoutePanel route={route} progress={progress} onRefresh={refreshPlayer} loading={loading} geo={geo} proximity={proximity} busy={busy} onProximity={async () => { try { const result = await proximityRequest(route?.checkpoint?.id); setProximity(result); } catch (e) { setError(e.message); } }}/>}
        {panel === "challenge" && <ChallengePanel route={route} onArrive={arrive} onSubmit={submit} busy={busy} proximity={proximity} geo={geo} onProximity={proximityRequest} notify={notify}/>}
        {panel === "progress" && <ProgressPanel progress={progress} rally={rallyData}/>}
        {panel === "ranking" && <RankingPanel data={ranking} teamId={rallyData?.team?.id}/>}
        <div className="sync-strip"><span className="sync-cloud"><Cloud size={19}/></span><div><strong>Progreso protegido</strong><span>Las evidencias se guardan en este dispositivo y se sincronizan al recuperar conexión.</span></div><span className="offline-indicator"><Wifi size={15}/> {navigator.onLine ? "Conectado" : "Sin conexión"}</span></div><details className="sync-details"><summary>Estado de sincronización</summary><SyncStatus/></details>
      </>}
      {session?.role === "organizer" && <><PageTabs items={ADMIN_NAV} value={adminTab} onChange={setAdminTab} label="Panel de organización"/>{error && <div className="notice-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError("")} aria-label="Cerrar"><X size={16}/></button></div>}<OrganizerPanel data={adminData} selected={selectedAdmin} onSelect={id => loadAdminRally(id)} onRefresh={() => loadAdminRally(adminRallyId)} onControl={control} busy={busy} onExport={exportReport} onQr={openQr} tab={adminTab}/><div className="sync-strip"><span className="sync-cloud"><ShieldCheck size={19}/></span><div><strong>Datos desde el backend</strong><span>El panel muestra registros y estados oficiales del rally.</span></div><button type="button" className="text-button" onClick={logout}>Cerrar sesión</button></div></>}
    </main>
    {toast && <div className="toast" role="status"><CheckCircle2 size={17}/>{toast}</div>}
  </div>;
}
