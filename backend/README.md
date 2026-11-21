# ClueKeeper · Backend (v1)

API REST para el rally de observación. Node ≥ 22.13 · Express 5 · SQLite (`node:sqlite`, sin dependencias nativas) · JWT en cookie `httpOnly` (o `Authorization: Bearer`).

```bash
cd backend
npm install
cp .env.example .env      # ajusta JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm run seed              # organizador + rally demo (código DEMO01)
npm run dev               # http://localhost:4000
npm test                  # pruebas de extremo a extremo
```

En el frontend define `VITE_API_BASE_URL=http://localhost:4000/api` (ya lo usa `evidenceSync.js`).

## Decisiones de diseño

- **El servidor es la fuente de verdad**: valida geocerca, QR/NFC, respuestas y tiempos. Las respuestas correctas y los secretos de QR **nunca** salen en endpoints de participante.
- **Contrato alineado con el frontend actual**: `POST /api/evidences` (multipart + `Idempotency-Key`, responde `{evidenceId, status:"RECEIVED"}`) y el contenido de pistas/retos con la forma `{contentId, checkpointId, kind:"CLUE"|"CHALLENGE", content}` que guarda `offlineRally.js` en Dexie.
- **Offline (HU-20/21)**: `arrive`, `submit` y `evidences` aceptan `capturedAt` (ms epoch) y son idempotentes. El tiempo cuenta al instante de captura, con ventana de gracia `LATE_SYNC_GRACE_MINUTES` tras el fin. La *siguiente* pista solo se obtiene al sincronizar el reto (la respuesta se valida en servidor).
- **Tiempo**: el plazo de cada equipo = inicio + duración + minutos extra del rally + minutos extra del equipo. El cierre por tiempo se aplica al consultar (no depende de un cron) y un *ticker* envía los avisos de poco tiempo (15 y 5 min, configurable). Un rally cerrado por tiempo se reabre si el organizador amplía lo suficiente; uno finalizado manualmente no.
- **Ubicación oculta (HU-06)**: con `hideLocation` no se envían coordenadas; la distancia se redondea a 25 m. *Limitación*: con muchas consultas se podría triangular el punto; hay límite de 30/min por equipo.
- **Seguridad**: rate limit en login/join, comprobación de `Origin` (CSRF) con cookies cross-site, bcrypt, validación de archivos por firma binaria, CSV protegido contra inyección de fórmulas, mensajes de error con `{error:{code,message,details}}`.

## Cobertura de historias de usuario

| HU | Endpoint |
|---|---|
| 01 | `POST /auth/team/join` `{code, teamName}` → 404 `INVALID_RALLY_CODE` si no existe |
| 02 | `GET /admin/rallies/:id/join-qr` (SVG) → app abre `/join?token=…` → `GET /auth/lookup?token=` y `POST /auth/team/join {joinToken, teamName}` |
| 03, 16 | `GET /rally` (estado, `serverTime`, `endsAt`, `remainingSeconds`) |
| 04, 05 | `GET /route/current` |
| 06 | `POST /checkpoints/:id/proximity` |
| 07, 16 | `GET /progress` (completados/total y tiempos por reto) |
| 08, 09, 10 | `POST /checkpoints/:id/arrive` `{method: GEOFENCE\|QR\|NFC, …}` |
| 11, 13 | `POST /evidences` + `POST /checkpoints/:id/submit {evidenceId}` |
| 12 | `submit {heading}` |
| 14 | respuesta de `submit` (`correct`, `pointsAwarded`, `next`) |
| 15, 17 | `GET /ranking`, `GET /rally` (`team.score`) |
| 18, 19 | `GET /events` (SSE) y `GET /notifications?after=` |
| 20 | contenido cacheable en `route/current` / `challenge` |
| 21, 22 | idempotencia en `evidences` y `submit`; estado local en Dexie |
| 23 | `POST /auth/organizer/login`, `GET /admin/rallies/:id` |
| 24 | `POST /admin/rallies/:id/start` |
| 25 | `POST /admin/rallies/:id/extend {minutes, teamId?}` |
| 26 | `GET /admin/rallies/:id/report[?format=csv]` |

Todas las rutas cuelgan de `/api`. Además hay administración (`/admin/rallies`, `/checkpoints`, orden, QR imprimible por checkpoint, listado/descarga de evidencias) para configurar el rally.

## Flujo del participante

```
POST /auth/team/join ─► GET /rally ─► (organizador inicia) ─► GET /route/current
   ─► POST /checkpoints/:id/arrive  (arrived:false → muestra distancia restante)
   ─► [POST /evidences] ─► POST /checkpoints/:id/submit ─► {correct, next}  ─► …
```

## Integración con React (a tener en cuenta)

- `fetch(..., {credentials:"include"})` y `EventSource(url, {withCredentials:true})`. Si el navegador bloquea cookies de terceros (Safari), usar el `token` devuelto con `Authorization: Bearer` (SSE: usar `GET /notifications?after=` o `fetch` en streaming).
- Calcular el cronómetro con `serverTime`/`endsAt` (no con la hora del dispositivo).
- Guardar `teamKey` (devuelto al unirse) para recuperar la sesión con `POST /auth/team/resume`.
- Recomendado en `evidenceSync.js`: enviar `capturedAt: evidence.createdAt` en el `FormData`.
- Errores `4xx` de negocio (`TIME_EXPIRED`, `ALREADY_COMPLETED`…) deben marcar el ítem de la cola como `FAILED`; los `5xx`/red, reintentar.

## Pendiente para siguientes versiones

Web Push con la PWA cerrada (las notificaciones ya se guardan y emiten; falta el despachador VAPID), revisión manual de evidencias, rutas escalonadas por equipo, exportación PDF, migración a PostgreSQL y almacenamiento S3 (`lib/files.js` es el único punto de acceso a archivos), y un antifraude de GPS más fuerte (la posición la reporta el cliente).
