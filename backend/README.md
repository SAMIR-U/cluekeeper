# ClueKeeper · Backend

API REST para el rally de observación. Node ≥ 22 · Express 5 · PostgreSQL (`pg`) · JWT en cookie `httpOnly` (o `Authorization: Bearer`).

```bash
cd backend
npm install
cp .env.example .env      # ajusta JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm run seed              # organizador + rally demo (código DEMO01)
                          # sin DATABASE_URL usa PGlite (Postgres embebido); no necesitas instalar nada
npm run dev               # http://localhost:4000
npm test                  # pruebas de extremo a extremo
```

En el frontend define `VITE_API_BASE_URL=http://localhost:4000/api` (ya lo usa `evidenceSync.js`).

## Docker

```bash
cd backend
echo "JWT_SECRET=$(openssl rand -base64 48)" > .env   # añade además ADMIN_EMAIL y ADMIN_PASSWORD
docker compose up -d --build
curl localhost:4000/api/health
```

Levanta la API junto a un PostgreSQL 16; los datos (incluidas las evidencias) viven en el volumen `cluekeeper-pg`. Respaldo: `docker compose exec db pg_dump -U cluekeeper cluekeeper > respaldo.sql`.

## Decisiones de diseño

- **El servidor es la fuente de verdad**: valida geocerca, QR/NFC, respuestas y tiempos. Las respuestas correctas y los secretos de QR **nunca** salen en endpoints de participante.
- **Contrato alineado con el frontend actual**: `POST /api/evidences` (multipart + `Idempotency-Key`, responde `{evidenceId, status:"RECEIVED"}`) y el contenido de pistas/retos con la forma `{contentId, checkpointId, kind:"CLUE"|"CHALLENGE", content}` que guarda `offlineRally.js` en Dexie.
- **Offline (HU-20/21)**: `arrive`, `submit` y `evidences` aceptan `capturedAt` (ms epoch) y son idempotentes. El tiempo cuenta al instante de captura, con ventana de gracia `LATE_SYNC_GRACE_MINUTES` tras el fin. La *siguiente* pista solo se obtiene al sincronizar el reto (la respuesta se valida en servidor).
- **Tiempo**: el plazo de cada equipo = inicio + duración + minutos extra del rally + minutos extra del equipo. El cierre por tiempo se aplica al consultar (no depende de un cron) y un *ticker* envía los avisos de poco tiempo (15 y 5 min, configurable). Un rally cerrado por tiempo se reabre si el organizador amplía lo suficiente; uno finalizado manualmente no.
- **Ubicación oculta (HU-06)**: con `hideLocation` no se envían coordenadas; la distancia se redondea a 25 m. *Limitación*: con muchas consultas se podría triangular el punto; hay límite de 30/min por equipo.
- **Base de datos**: PostgreSQL. El esquema se crea solo al arrancar (`CREATE TABLE IF NOT EXISTS`). Las fotos y audios se guardan en la tabla `evidences` (BYTEA), así que el servicio **no necesita disco persistente**. Las acciones de un equipo se serializan con bloqueos de fila (`SELECT … FOR UPDATE`), por lo que es seguro ante doble toque y reintentos simultáneos de la cola offline. Para el aviso de poco tiempo basta una instancia; con varias también es seguro porque la inserción es atómica.
- **Seguridad**: rate limit en login/join, comprobación de `Origin` (CSRF) con cookies cross-site, bcrypt, validación de archivos por firma binaria, CSV protegido contra inyección de fórmulas, mensajes de error con `{error:{code,message,details}}`.

## Cobertura de historias de usuario

| HU | Endpoint |
|---|---|
| 01 | `POST /auth/team/join` `{code, teamName}` → 404 `INVALID_RALLY_CODE` si no existe |
| 02 | `GET /admin/rallies/:id/join-qr` (SVG) → el front lee `/?code=…` (el enlace con token queda en `tokenUrl`) → `GET /auth/lookup?token=` y `POST /auth/team/join {joinToken, teamName}` |
| 03, 16 | `GET /rally` (estado, `serverTime`, `endsAt`, `remainingSeconds`) |
| 04, 05 | `GET /route/current` |
| 06 | `POST /checkpoints/:id/proximity` |
| 07, 16 | `GET /progress` (completados/total y tiempos por reto) |
| 08, 09, 10 | `POST /checkpoints/:id/arrive` `{method: GEOFENCE\|QR\|NFC, …}` |
| 11, 13 | `POST /evidences` + `POST /checkpoints/:id/submit {evidenceId}` |
| 12 | `submit {heading}` |
| 14 | respuesta de `submit` (`correct`, `pointsAwarded`, `next`) |
| 15, 17 | `GET /ranking`, `GET /rally` (`team.score`) |
| 18, 19 | `GET /events` (SSE), `GET /notifications?after=` y Web Push (ver abajo) |
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

revisión manual de evidencias, rutas escalonadas por equipo, exportación PDF, mover las evidencias a almacenamiento de objetos (S3/R2) si el volumen crece, y migraciones versionadas del esquema, y un antifraude de GPS más fuerte (la posición la reporta el cliente).

## Notificaciones Web Push (VAPID)

Avisan al equipo (nueva pista, rally iniciado, poco tiempo, tiempo extra, fin) **aunque la PWA esté cerrada**. Reutilizan las notificaciones que ya se guardan: cada `notify()` se envía además por push a los dispositivos suscritos (`services/push.js`).

1. Genera el par de claves (una sola vez, en tu equipo): `npm run vapid`.
2. En el servidor define `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` (`mailto:tu-correo` o la URL https del front). La privada es secreta: no va en git ni en el front. Si la cambias, hay que volver a suscribir los dispositivos.
3. Sin esas variables el servidor arranca igual y el push queda desactivado (`GET /api/push/public-key` → `enabled:false`).

| Endpoint | Uso |
|---|---|
| `GET /api/push/public-key` | `{enabled, publicKey}` (pública): es la `applicationServerKey` del front |
| `POST /api/push/subscribe` | Equipo autenticado; cuerpo = `PushSubscription.toJSON()` (`{endpoint, keys:{p256dh, auth}}`) |
| `DELETE /api/push/subscribe` | `{endpoint}`: da de baja ese dispositivo |

Detalles: máximo 5 dispositivos por equipo (se conservan los más recientes); las suscripciones que el servicio push responde 404/410 se borran solas; los avisos de tiempo caducan en 5 min (TTL) y se envían con urgencia alta; los endpoints se restringen a https y a servicios push de navegadores (`PUSH_ALLOWED_HOSTS`) para evitar SSRF. En iPhone/iPad solo funciona con la PWA **instalada en la pantalla de inicio** (iOS 16.4+).

## Despliegue en Render

1. Crea un **PostgreSQL** en Render y copia su *Internal Database URL*.
2. Crea un **Web Service** con *Root Directory* `backend`, *Build* `npm ci`, *Start* `npm start`, *Health Check* `/api/health`.
3. Variables: `NODE_VERSION=24`, `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGINS`, `APP_BASE_URL`, `TRUST_PROXY=1`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `RALLY_DURATION_MINUTES` (opcional; 60 por defecto) y, para push, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
   (o usa el `render.yaml` de la raíz del repositorio como Blueprint).

Nota: el Postgres gratuito de Render **caduca a los 30 días**; para el evento usa un plan de pago o haz `pg_dump` antes.
