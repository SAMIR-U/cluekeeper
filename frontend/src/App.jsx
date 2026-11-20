import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowDown, ArrowLeft, ArrowRight, Award, Bell, Camera, Check,
  CheckCircle2, CircleHelp, Clock3, Cloud, Compass, Flag, MapPin,
  Navigation, Plus, QrCode, Radio, RefreshCw, Rocket, ScanLine,
  ShieldCheck, Sparkles, Target, Trophy, UserRound, Users, Wifi,
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import CameraEvidence from "./components/CameraEvidence";
import AudioEvidence from "./components/AudioEvidence";
import RallyMap from "./components/RallyMap";
import SyncStatus from "./components/SyncStatus";
import { db } from "./db/cluekeeperDB";
import { useGeolocation } from "./hooks/useGeolocation";
import { validateGeofence } from "./services/geofence";
import "./App.css";

const checkpoint = { latitude: 4.6097, longitude: -74.0817, radius: 100 };
const navigation = [
  { id: "access", label: "Acceso", icon: Flag },
  { id: "route", label: "Ruta & Radar", icon: Navigation },
  { id: "challenge", label: "Reto Activo", icon: Target },
  { id: "ranking", label: "Ranking", icon: Trophy },
];
const initialTeams = [
  { name: "Los Halcones", score: 920, checkpoints: 4, time: "00:42:18", color: "mint" },
  { name: "Las Brújulas", score: 840, checkpoints: 4, time: "00:45:02", color: "blue" },
  { name: "Los Exploradores", score: 710, checkpoints: 3, time: "00:39:46", color: "orange" },
  { name: "Punto Norte", score: 560, checkpoints: 3, time: "00:48:11", color: "purple" },
];

function AccessPanel({ onJoin, teamName, setTeamName }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [qrMode, setQrMode] = useState(false);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const scanFrameRef = useRef(0);
  function stopScanner() {
    cancelAnimationFrame(scanFrameRef.current);
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setScanning(false);
  }
  async function startScanner() {
    setError("");
    if (!("BarcodeDetector" in window)) {
      setError("El escaneo QR no está disponible aquí. Escribe el código del rally manualmente.");
      return;
    }
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      setScanning(true);
    } catch {
      setError("No se pudo abrir la cámara. Comprueba el permiso o escribe el código manualmente.");
    }
  }
  useEffect(() => {
    if (!scanning || !videoRef.current || !streamRef.current) return;
    const video = videoRef.current;
    video.srcObject = streamRef.current;
    video.play().catch(() => setError("No se pudo iniciar la cámara."));
    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    let active = true;
    async function scan() {
      if (!active) return;
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        try {
          const codes = await detector.detect(video);
          if (codes[0]?.rawValue) {
            let value = codes[0].rawValue.trim();
            try { value = new URL(value).searchParams.get("code") || new URL(value).searchParams.get("rally") || value; } catch { /* raw rally code */ }
            setCode(value.toUpperCase());
            setQrMode(false);
            stopScanner();
            return;
          }
        } catch { /* keep scanning */ }
      }
      scanFrameRef.current = requestAnimationFrame(scan);
    }
    scanFrameRef.current = requestAnimationFrame(scan);
    return () => { active = false; cancelAnimationFrame(scanFrameRef.current); };
  }, [scanning]);
  useEffect(() => () => streamRef.current?.getTracks().forEach(track => track.stop()), []);
  function join(event) {
    event.preventDefault();
    if (!teamName.trim()) return setError("Escribe el nombre de tu equipo para continuar.");
    if (code.trim().toUpperCase() !== "CLUE2026") return setError("El código no es válido. Revisa el código del rally e inténtalo de nuevo.");
    setError("");
    onJoin();
  }
  return <div className="access-grid">
    <section className="card access-card">
      <div className="eyebrow"><span className="eyebrow-dot" /> RALLY DE OBSERVACIÓN · BOGOTÁ</div>
      <h1>Una ciudad.<br /><em>Muchas pistas.</em></h1>
      <p className="muted intro">Únete a tu equipo y sigue las pistas hasta el próximo checkpoint.</p>
      <div className="event-status"><span className="status-live"><Radio size={15} /> Rally en curso</span><span><Clock3 size={15} /> Finaliza en 01:18:42</span></div>
      <form onSubmit={join} className="join-form">
        <label htmlFor="team-name">Nombre del equipo</label>
        <div className="input-with-icon"><Users size={18} /><input id="team-name" value={teamName} onChange={e => setTeamName(e.target.value)} placeholder="Ej. Los Halcones" /></div>
        <label htmlFor="rally-code">Código del rally</label>
        <div className="input-with-icon"><ShieldCheck size={18} /><input id="rally-code" value={code} onChange={e => setCode(e.target.value)} placeholder="CLUE2026" /></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary full" type="submit">Entrar al rally <ArrowRight size={17} /></button>
      </form>
      <button className="qr-link" onClick={() => { setQrMode(!qrMode); if (scanning) stopScanner(); }}><QrCode size={17} /> {qrMode ? "Usar código manual" : "¿Tienes un QR del organizador?"}</button>
      {qrMode && <div className="qr-placeholder">{scanning ? <video ref={videoRef} className="qr-video" muted playsInline /> : <ScanLine size={28} />}<div><strong>{scanning ? "Enfoca el código QR" : "Acceso rápido por QR"}</strong><p>{scanning ? "Al reconocer el código, el rally se cargará en el formulario." : "Escanea el QR del organizador para cargar el rally."}</p>{!scanning ? <button type="button" className="qr-start" onClick={startScanner}>Abrir cámara</button> : <button type="button" className="qr-start" onClick={stopScanner}>Cancelar escaneo</button>}</div></div>}
    </section>
    <aside className="card access-aside"><div className="aside-orbit orbit-one"/><div className="aside-orbit orbit-two"/><div className="aside-content"><div className="aside-icon"><Compass size={28} /></div><span className="eyebrow light">TU PRÓXIMA AVENTURA</span><h2>Descubre lo que la ciudad esconde.</h2><p>Resuelve retos, encuentra detalles y suma puntos con tu equipo.</p><div className="aside-stats"><div><strong>08</strong><span>checkpoints</span></div><div><strong>02:30</strong><span>horas de juego</span></div></div></div><div className="aside-bottom"><Sparkles size={16} /> La aventura empieza aquí</div></aside>
  </div>;
}

function RoutePanel({ position, geo, result, onLocate, locationError, submitted }) {
  const [tab, setTab] = useState("map");
  const steps = ["Parque Central", "Pasaje de los Murales", "Plaza de las Letras", "Mirador del Búho", "Jardín de los Poetas"];
  const stops = <div className="route-list">{steps.map((step, i) => { const done = i < (submitted ? 3 : 2); const current = i === (submitted ? 3 : 2); return <div className={`route-stop ${done ? "done" : current ? "current" : "locked"}`} key={step}><div className="stop-marker">{done ? <Check size={15} /> : current ? <MapPin size={15} /> : <span>0{i + 1}</span>}</div><div className="stop-copy"><strong>{step}</strong><span>{done ? "Checkpoint completado" : current ? "Siguiente pista · a 340 m" : "Se desbloquea al avanzar"}</span></div>{current && <span className="now-tag">SIGUIENTE</span>}</div>; })}</div>;
  return <div className="route-layout">
    <div className="route-workspace">
      <div className="panel-tabs" role="tablist" aria-label="Paneles de la ruta">
        <button role="tab" aria-selected={tab === "map"} className={tab === "map" ? "selected" : ""} onClick={() => setTab("map")}><Navigation size={16}/> Mapa</button>
        <button role="tab" aria-selected={tab === "clue"} className={tab === "clue" ? "selected" : ""} onClick={() => setTab("clue")}><CircleHelp size={16}/> Pista</button>
        <button role="tab" aria-selected={tab === "progress"} className={tab === "progress" ? "selected" : ""} onClick={() => setTab("progress")}><CheckCircle2 size={16}/> Progreso</button>
      </div>
      <section className="route-workspace-panel" role="tabpanel">
        {tab === "map" && <><div className="panel-title"><div><span className="eyebrow">SIGUIENTE CHECKPOINT</span><h2>Parque Central</h2></div><span className="gps-chip"><span className="signal-dot"/> GPS</span></div><div className="map-surface">{position ? <RallyMap position={position} /> : <div className="map-placeholder"><div className="map-grid"/><div className="map-pin target-pin"><Target size={17}/></div><div className="map-pin team-pin"><Navigation size={17}/></div><div className="map-route-line"/><span className="map-distance">340 m</span><span className="map-caption">Activa tu ubicación para ver el mapa</span></div>}</div><div className="map-details"><div><span className="detail-icon"><MapPin size={16}/></span><div><small>Distancia estimada</small><strong>{result ? `${Math.max(0, result.distance).toFixed(0)} m` : "340 m"}</strong></div></div><button className="button button-dark" onClick={onLocate} disabled={geo.loading}>{geo.loading ? <><RefreshCw size={16} className="spin"/> Buscando...</> : <><Navigation size={16}/> {position ? "Actualizar ubicación" : "Encontrar ubicación"}</>}</button></div>{locationError && <p className="form-error" role="alert">{locationError}</p>}{result && <p className={`geo-result ${result.inside ? "success" : ""}`}>{result.inside ? "¡Ya estás en la zona del checkpoint!" : `Te faltan ${Math.max(0, result.remaining).toFixed(0)} m para llegar.`}</p>}<p className="privacy-note"><ShieldCheck size={14}/> Tu posición solo se usa para validar el checkpoint.</p></>}
        {tab === "clue" && <div className="route-clue-panel"><span className="clue-icon"><CircleHelp size={20}/></span><span className="eyebrow">{submitted ? "NUEVA PISTA · WP #04" : "TU PISTA · WP #03"}</span><h2>{submitted ? "Sigue el sonido de las campanas" : "Las historias se encuentran"}</h2><p>{submitted ? "Sigue el sonido de las campanas hasta la plaza donde se cruzan cuatro caminos." : "Busca el lugar donde las historias de la ciudad se encuentran bajo la sombra de los árboles."}</p><span className="soft-chip">{submitted ? "WP #04 · PLAZA DE LAS LETRAS" : "WP #03 · PARQUE CENTRAL"}</span></div>}
        {tab === "progress" && <><div className="panel-title"><div><span className="eyebrow">TU RECORRIDO</span><h2>Checkpoints</h2></div><span className="progress-pill"><CheckCircle2 size={15}/>{submitted ? "3" : "2"} de 8</span></div><div className="route-progress"><div style={{ width: submitted ? "37.5%" : "25%" }}/></div><p className="muted progress-caption">{submitted ? "¡Buen trabajo! Te faltan 5 checkpoints." : "Vas muy bien. Te faltan 6 checkpoints."}</p>{stops}</>}
      </section>
    </div>
  </div>;
}

function ChallengePanel({ result, onValidate, validated, setValidated, notify, score, setScore, submitted, setSubmitted }) {
  const [tab, setTab] = useState("arrival");
  const [evidenceTab, setEvidenceTab] = useState("photo");
  const [checkpointCode, setCheckpointCode] = useState("");
  const [feedback, setFeedback] = useState("");
  const evidence = useLiveQuery(
    () => db.evidences.where("checkpointId").equals("checkpoint-demo").toArray(),
    [],
    [],
  );
  const hasPhoto = evidence.some(item => item.type === "PHOTO");
  const hasAudio = evidence.some(item => item.type === "AUDIO");
  const completedCount = Number(hasPhoto) + Number(hasAudio);
  async function validateNfc() {
    if (!("NDEFReader" in window)) { setFeedback("NFC no está disponible en este dispositivo. Usa GPS o el código del checkpoint."); return; }
    try {
      const reader = new window.NDEFReader();
      await reader.scan();
      reader.onreading = () => { setValidated(true); setFeedback("Checkpoint validado por NFC."); notify("Checkpoint validado"); };
      setFeedback("Acerca tu teléfono al tag NFC del checkpoint.");
    } catch { setFeedback("No se pudo iniciar NFC. Revisa el permiso e inténtalo de nuevo."); }
  }
  function validateCode(e) { e.preventDefault(); if (checkpointCode.trim().toUpperCase() === "BHO3") { setValidated(true); setFeedback("Checkpoint validado con el código QR."); notify("Checkpoint validado"); } else setFeedback("Código incorrecto. Escanea el QR del checkpoint."); }
  return <div className="challenge-layout">
    <section className="challenge-overview"><div className="challenge-overview-main"><div className="chip-row"><span className="soft-chip">WP #03 · PARQUE CENTRAL</span><span className="points-chip">+150 PTS</span></div><h2>El secreto del búho</h2><p>Encuentra la inscripción en la base del monumento y registra una foto y un audio.</p></div><div className="challenge-overview-meta"><span><Clock3 size={15}/> 00:04:32</span><span><Activity size={15}/> Intento 1 de 3</span><span className={`state-pill ${validated ? "complete" : "pending"}`}>{validated ? <><CheckCircle2 size={14}/> Llegada validada</> : <><Radio size={14}/> Llegada pendiente</>}</span></div></section>
    <div className="panel-tabs challenge-tabs" role="tablist" aria-label="Paneles del reto">
      <button role="tab" aria-selected={tab === "arrival"} className={tab === "arrival" ? "selected" : ""} onClick={() => setTab("arrival")}><MapPin size={16}/> Llegada</button>
      <button role="tab" aria-selected={tab === "evidence"} className={tab === "evidence" ? "selected" : ""} onClick={() => setTab("evidence")}><Camera size={16}/> Evidencias <span className="tab-count">{completedCount}/2</span></button>
      <button role="tab" aria-selected={tab === "compass"} className={tab === "compass" ? "selected" : ""} onClick={() => setTab("compass")}><Compass size={16}/> Orientación</button>
    </div>
    <section className="challenge-tab-panel" role="tabpanel">
      {tab === "arrival" && <div className="arrival-panel"><div><span className="eyebrow">CHECKPOINT #03</span><h3>Valida tu llegada</h3><p>Confirma que estás en el Parque Central para desbloquear el reto.</p></div><div className="validation-actions"><button className="button button-dark" onClick={onValidate}><Navigation size={16}/> Validar con GPS</button><button className="button button-soft" onClick={validateNfc}><Radio size={16}/> NFC</button></div><form className="code-form" onSubmit={validateCode}><QrCode size={17}/><input aria-label="Código del checkpoint" value={checkpointCode} onChange={e => setCheckpointCode(e.target.value)} placeholder="Código QR del checkpoint"/><button aria-label="Validar código"><ArrowRight size={16}/></button></form>{feedback && <p className="muted small-feedback" role="status">{feedback}</p>}{result && !validated && <p className="geo-result">{result.inside ? "Estás dentro del perímetro. Ya puedes validar." : `Estás a ${result.remaining.toFixed(0)} m del perímetro.`}</p>}</div>}
      {tab === "evidence" && <div className="evidence-panel"><div className="evidence-panel-heading"><div><span className="eyebrow">EVIDENCIAS OBLIGATORIAS</span><h3>Registra lo que encontraste</h3></div><span className="evidence-count">{completedCount} de 2</span></div><div className="evidence-switch" role="tablist" aria-label="Tipo de evidencia"><button role="tab" aria-selected={evidenceTab === "photo"} className={evidenceTab === "photo" ? "selected" : ""} onClick={() => setEvidenceTab("photo")}><Camera size={16}/> Fotografía {hasPhoto && <CheckCircle2 size={14}/>}</button><button role="tab" aria-selected={evidenceTab === "audio"} className={evidenceTab === "audio" ? "selected" : ""} onClick={() => setEvidenceTab("audio")}><Activity size={16}/> Audio {hasAudio && <CheckCircle2 size={14}/>}</button></div>{evidenceTab === "photo" ? <CameraEvidence checkpointId="checkpoint-demo"/> : <AudioEvidence checkpointId="checkpoint-demo"/>}</div>}
      {tab === "compass" && <div className="compass-panel"><div className="compass-display"><div className="compass-ring"><span className="north">N</span><Compass size={52}/><span className="bearing">NE · 42°</span></div><div><span className="eyebrow">ORIENTACIÓN · OPCIONAL</span><strong>Apunta al noreste</strong><span>Rumbo objetivo: 42°</span></div></div><button className="button button-soft" onClick={() => setFeedback("Abre los ajustes rápidos de tu dispositivo para calibrar la brújula.")}><Compass size={16}/> Calibrar brújula</button>{feedback && <p className="muted small-feedback" role="status">{feedback}</p>}</div>}
    </section>
    {submitted && <div className="submission-feedback" role="status"><CheckCircle2 size={17}/><span><strong>¡Reto enviado!</strong><small>Las evidencias quedaron guardadas en la cola local.</small></span><b>+150 pts</b></div>}
    <button className="button button-submit full" disabled={submitted} onClick={() => { if (!hasPhoto || !hasAudio) { notify("Completa la foto y la grabación de audio antes de enviar."); return; } if (!validated && !result?.inside) { notify("Valida tu llegada al checkpoint antes de enviar."); return; } setValidated(true); setSubmitted(true); localStorage.setItem("cluekeeper-demo-submitted", "true"); setScore(score+150); notify("¡Reto completado! +150 puntos. Nueva pista desbloqueada."); }}><Rocket size={18}/> {submitted ? "Reto completado" : "Enviar evidencias y validar reto"} <span>{submitted ? "+150 pts ✓" : "+150 pts"}</span></button>
  </div>;
}

function RankingPanel({ teamName, score, time }) {
  const rows = useMemo(() => [{ name: teamName || "Los Halcones", score, checkpoints: 4, time, color: "mint" }, ...initialTeams.slice(1)].sort((a,b) => b.score-a.score), [teamName, score, time]);
  return <div className="ranking-layout"><section className="card ranking-hero"><div className="eyebrow light">ASÍ VA EL RALLY</div><h2>¡Van con todo,<br/><em>{teamName || "Halcones"}!</em></h2><div className="rank-stats"><div><Trophy size={17}/><strong>#{rows.findIndex(x => x.name === (teamName || "Los Halcones")) + 1}</strong><span>posición</span></div><div><Sparkles size={17}/><strong>{score.toLocaleString()}</strong><span>puntos</span></div><div><Clock3 size={17}/><strong>{time}</strong><span>tiempo activo</span></div></div><div className="hero-decoration"><Target size={132}/></div></section><section className="card leaderboard"><div className="section-heading"><div><div className="eyebrow">COMPETENCIA EN VIVO</div><h2>Tabla de posiciones</h2></div><span className="live-indicator"><span className="signal-dot"/> EN VIVO</span></div><div className="leader-head"><span>POSICIÓN · EQUIPO</span><span>CHECKPOINTS</span><span>PUNTOS</span></div>{rows.map((row,i)=><div className={`leader-row ${row.name === (teamName || "Los Halcones") ? "your-team" : ""}`} key={row.name}><span className={`rank-number ${i===0?"first":""}`}>{String(i+1).padStart(2,"0")}</span><span className={`team-avatar ${row.color}`}><Users size={16}/></span><div className="team-name"><strong>{row.name}</strong><small>{row.time}</small></div><span className="checkpoints-count">{row.checkpoints}<small> / 8</small></span><strong className="team-score">{row.score.toLocaleString()}<small> pts</small></strong></div>)}<div className="ranking-note"><Bell size={15}/> La tabla se actualiza cuando los equipos sincronizan sus resultados.</div></section></div>;
}

function OrganizerPanel({ rallyRunning, setRallyRunning, extraMinutes, setExtraMinutes, remainingSeconds, setRemainingSeconds, teamName, playerScore, playerTime, notify }) {
  const [report, setReport] = useState(false);
  function exportReport() {
    const teams = [...initialTeams.filter(team => team.name !== teamName), { name: teamName, score: playerScore, checkpoints: 4, time: playerTime }].sort((a, b) => b.score - a.score);
    const csv = ["Posición,Equipo,Puntos,Checkpoints,Tiempo", ...teams.map((team, i) => `${i+1},${team.name},${team.score},${team.checkpoints},${team.time}`)].join("\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob(["\ufeff",csv], {type:"text/csv;charset=utf-8"})); link.download = "cluekeeper-resultados.csv"; link.click(); URL.revokeObjectURL(link.href); setReport(true);
  }
  const countdown = `${String(Math.floor(remainingSeconds/3600)).padStart(2,"0")}:${String(Math.floor(remainingSeconds/60)%60).padStart(2,"0")}:${String(remainingSeconds%60).padStart(2,"0")}`;
  return <div className="organizer-layout"><section className="card organizer-welcome"><div className="organizer-mark"><Activity size={24}/></div><div><div className="eyebrow">PANEL DE ORGANIZACIÓN</div><h2>Rally Centro Histórico</h2><p className="muted">Viernes, 20 de noviembre · Bogotá</p></div><span className={`state-pill ${rallyRunning ? "complete" : "pending"}`}><span className="signal-dot"/>{rallyRunning ? "En curso" : "En pausa"}</span></section><div className="organizer-metrics"><div className="card metric-card"><Users size={18}/><strong>12</strong><span>equipos registrados</span></div><div className="card metric-card"><Target size={18}/><strong>08</strong><span>checkpoints activos</span></div><div className="card metric-card"><Clock3 size={18}/><strong>{countdown}</strong><span>tiempo restante</span></div></div><section className="card organizer-controls"><div className="eyebrow">CONTROL DEL EVENTO</div><h3>Gestiona el rally</h3><p className="muted">Los cambios se reflejan en este panel de demostración.</p><div className="control-row"><div className="control-icon"><Rocket size={18}/></div><div className="control-copy"><strong>{rallyRunning ? "Rally en curso" : "Rally en pausa"}</strong><span>{rallyRunning ? "Los equipos pueden seguir jugando." : "Inicia el reloj y habilita el acceso."}</span></div><button className={`button ${rallyRunning ? "button-soft" : "button-primary"}`} onClick={() => { setRallyRunning(!rallyRunning); notify(rallyRunning ? "Rally pausado" : "¡Rally iniciado!"); }}>{rallyRunning ? "Pausar rally" : "Iniciar rally"}</button></div><div className="control-row"><div className="control-icon orange-icon"><Plus size={18}/></div><div className="control-copy"><strong>Otorgar tiempo adicional</strong><span>{extraMinutes ? `Se agregaron ${extraMinutes} minutos al evento.` : "Extiende el plazo para todos los equipos."}</span></div><button className="button button-soft" onClick={() => { setExtraMinutes(extraMinutes+10); setRemainingSeconds(remainingSeconds+600); notify("Se agregaron 10 minutos al rally"); }}>+10 min</button></div></section><section className="card report-card"><div className="report-icon"><Award size={22}/></div><div><div className="eyebrow">CIERRE DEL EVENTO</div><h3>Reporte de resultados</h3><p className="muted">Descarga el ranking de equipos, puntajes y tiempos en CSV.</p></div><button className="button button-dark" onClick={exportReport}>Exportar reporte <ArrowDown size={16}/></button>{report && <span role="status" className="report-success"><CheckCircle2 size={15}/> Reporte descargado</span>}</section><section className="card teams-card"><div className="section-heading"><div><div className="eyebrow">PARTICIPANTES</div><h3>Equipos registrados</h3></div><span className="progress-pill"><Users size={14}/> 12 equipos</span></div>{initialTeams.slice(0,3).map((team,i)=><div className="registered-team" key={team.name}><span className={`rank-number ${i===0?"first":""}`}>{String(i+1).padStart(2,"0")}</span><strong>{team.name}</strong><span>{team.checkpoints} checkpoints</span><b>{team.score} pts</b></div>)}</section></div>;
}

export default function App() {
  const [panel, setPanel] = useState("challenge");
  const [teamName, setTeamName] = useState("Los Halcones");
  const [organizer, setOrganizer] = useState(false);
  const [validated, setValidated] = useState(false);
  const [rallyRunning, setRallyRunning] = useState(true);
  const [extraMinutes, setExtraMinutes] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(4722);
  const [toast, setToast] = useState("");
  const [score, setScore] = useState(() => Number(localStorage.getItem("cluekeeper-demo-score")) || 920);
  const [submitted, setSubmitted] = useState(() => localStorage.getItem("cluekeeper-demo-submitted") === "true");
  const [seconds, setSeconds] = useState(2538);
  const geo = useGeolocation();
  const result = geo.position ? validateGeofence(geo.position, checkpoint) : null;
  useEffect(() => { if (!rallyRunning) return undefined; const id = window.setInterval(() => { setSeconds(s => s+1); setRemainingSeconds(s => Math.max(0, s-1)); }, 1000); return () => window.clearInterval(id); }, [rallyRunning]);
  useEffect(() => { localStorage.setItem("cluekeeper-demo-score", String(score)); }, [score]);
  useEffect(() => { if (!toast) return; const id = window.setTimeout(() => setToast(""), 3000); return () => window.clearTimeout(id); }, [toast]);
  const time = `${String(Math.floor(seconds/3600)).padStart(2,"0")}:${String(Math.floor(seconds/60)%60).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`;
  function notify(message) { setToast(message); }
  const activeNav = panel === "organizer" ? "access" : panel;
  return <div className="app-shell">
    <header className="topbar"><button className="brand" onClick={() => {setOrganizer(false);setPanel("challenge");}} aria-label="Ir al inicio"><span className="brand-mark"><Compass size={20}/></span><span className="brand-copy"><strong>ClueKeeper</strong><small>LA CIUDAD TE HABLA</small></span></button><div className="topbar-center"><span className="event-label"><span className="signal-dot"/> RALLY {rallyRunning ? "EN CURSO" : "EN PAUSA"}</span><span className="team-label"><Users size={14}/> {teamName}</span></div><button className={`profile-button ${organizer ? "profile-active" : ""}`} onClick={() => {setOrganizer(!organizer);setPanel(organizer ? "challenge" : "organizer");}} aria-label={organizer ? "Vista participante" : "Panel de organizador"}><UserRound size={18}/></button></header>
    <main className="page-content">{organizer ? <><div className="page-heading"><button className="back-link" onClick={() => {setOrganizer(false);setPanel("challenge");}}><ArrowLeft size={16}/> Volver al rally</button><span className="eyebrow">VISTA DE ORGANIZADOR</span></div><OrganizerPanel rallyRunning={rallyRunning} setRallyRunning={setRallyRunning} extraMinutes={extraMinutes} setExtraMinutes={setExtraMinutes} remainingSeconds={remainingSeconds} setRemainingSeconds={setRemainingSeconds} teamName={teamName} playerScore={score} playerTime={time} notify={notify}/></> : <><div className="page-heading"><div><span className="eyebrow">VIERNES · BOGOTÁ, COLOMBIA</span><h1>{panel === "access" ? "Acceso al rally" : panel === "route" ? "Tu ruta" : panel === "ranking" ? "Marcador" : "A jugar, equipo."}</h1></div><div className="header-timer"><Clock3 size={17}/><div><small>TIEMPO DE JUEGO</small><strong>{time}</strong></div></div></div>
      {panel === "access" && <AccessPanel onJoin={() => {setPanel("challenge");notify("¡Bienvenido al rally!");}} teamName={teamName} setTeamName={setTeamName}/>}
      {remainingSeconds > 0 && remainingSeconds <= 600 && <div className="time-warning" role="status"><Clock3 size={16}/><span><strong>¡Quedan menos de 10 minutos!</strong> Administra el tiempo para terminar tu reto.</span></div>}
      {panel === "route" && <RoutePanel position={geo.position} geo={geo} result={result} onLocate={geo.getLocation} locationError={geo.error} submitted={submitted}/>}
      {panel === "challenge" && <ChallengePanel result={result} onValidate={geo.getLocation} validated={validated || Boolean(result?.inside)} setValidated={setValidated} notify={notify} score={score} setScore={setScore} submitted={submitted} setSubmitted={setSubmitted}/>}
      {panel === "ranking" && <RankingPanel teamName={teamName} score={score} time={time}/>}
      <div className="sync-strip"><span className="sync-cloud"><Cloud size={17}/></span><div><strong>Tu progreso está a salvo</strong><span>Guardado en este dispositivo · Sincroniza al recuperar conexión</span></div><span className="offline-indicator"><Wifi size={14}/> PWA activa</span></div>
      <div className="sync-details"><SyncStatus/></div>
    </>}</main>
    {!organizer && <nav className="bottom-nav" aria-label="Navegación principal">{navigation.map(item=>{const Icon=item.icon;return <button className={activeNav===item.id?"nav-item active":"nav-item"} onClick={()=>{setPanel(item.id);setOrganizer(false);}} key={item.id}><Icon size={20} strokeWidth={activeNav===item.id?2.4:1.8}/><span>{item.label}</span></button>})}</nav>}
    {toast && <div className="toast" role="status"><CheckCircle2 size={17}/>{toast}</div>}
  </div>;
}
