# ClueKeeper · Frontend API Connection Guide

Guide for the React team. It describes the prerequisites, authentication (JWT), the contract for each endpoint, and how to integrate everything with the offline PWA.

All routes hang off `https://<your-service>.onrender.com/api`. The examples below use `API` for that prefix.

---

## 1. Prerequisites for Connecting the Frontend

### 1.1 What to Ask the Backend Administrator

Before writing any code, you need the following details. Without them, the connection will not work.

| What | What you use it for | Example |
| :--- | :--- | :--- |
| **API URL** | Value of `VITE_API_BASE_URL` (must end in `/api`) | `https://cluekeeper-api.onrender.com/api` |
| **Your registered origin on the backend (CORS)** | If your URL is not authorized, the browser blocks all requests and you will see CORS errors | `https://cluekeeper.vercel.app` and, for development, `http://localhost:5173` |
| **Public frontend URL configured on the backend** | The access QR opens `<that URL>/join?token=...`; must match your app's `/join` route | `https://cluekeeper.vercel.app` |
| **Organizer credentials** | To test the `/admin` panel | `admin@cluekeeper.com` + password |
| **A pre-created test rally (with $\ge 1$ checkpoint)** | To test a team's flow without waiting for the organizer | code `DEMO01` |

Quick check to verify the API is alive (must return `{"status":"ok"}`):

```bash
curl https://your-service.onrender.com/api/health
```

> **Note:** If the API is hosted on Render's free tier, the first request after a period of inactivity takes ~1 minute. Show a loading state and do not treat it as an error.

### 1.2 React Project Configuration

**Environment variable** (local `.env` file and hosting environment variable, e.g., Vercel):

```env
VITE_API_BASE_URL=https://your-service.onrender.com/api
```

* It **must** include `/api`: `evidenceSync.js` appends `/evidences` directly to it.
* `VITE_*` variables are read at build time: if you change it, redeploy.
* **Do not put any secrets here.** The frontend never needs `JWT_SECRET`; it only receives already-signed tokens.

**Dependencies:** The current project already includes what is needed (`react-router-dom` for routing, `dexie` for the offline queue, `leaflet`/`react-leaflet` for the map). To scan checkpoint QR codes, you will need a reader (for example, `html5-qrcode` or the browser's `BarcodeDetector` API). No JWT or cookie libraries are required.

**Code rules you must follow in all API calls:**

1. Always use `credentials: 'include'` in `fetch` (the session travels in a cookie).
2. Send `Authorization: Bearer <token>` if you stored the token (fallback for Safari/iOS).
3. Send `Content-Type: application/json` on JSON bodies. Do **not** set it manually on `multipart/form-data`: the browser calculates the boundary automatically.
4. Handle error responses shaped as `{ error: { code, message, details } }`.
5. Calculate the countdown timer using `serverTime` from the server, not the device's local clock.

Section 2.2 provides a `fetch` client that already fulfills rules 1 through 4.

### 1.3 Development and Testing Environment

| Situation | What to keep in mind |
| :--- | :--- |
| **Development on `http://localhost:5173`** | Your origin must be allowed in the backend's CORS settings. Geolocation, camera, and microphone work on `localhost`. If the API is on another domain, cookies might not be saved: use Bearer mode (store the token) for development. |
| **Testing from a mobile phone** | **Requires HTTPS:** GPS, camera, microphone, Service Worker, and compass do not work over `http://` (except `localhost`). Use your deployment (Vercel/Pages) or an HTTPS tunnel; that origin must also be allowed in the backend's CORS settings. |
| **Cross-domain cookies** | If the frontend and the API are on different domains, Safari/iOS blocks cookies. Implement the Bearer fallback from the very beginning (Section 2.3). |
| **PWA and cache** | The Service Worker caches the app: after changing `VITE_API_BASE_URL` or deploying a new version, accept the update (`PWAUpdatePrompt`) or clear site data so you don't test against stale code. |
| **Browser permissions** | Request location, camera, and microphone right when using each feature, with clear explanatory text. On iOS, the compass (`DeviceOrientationEvent`) requires an explicit permission request triggered by a user tap. |
| **Test data** | To arrive at a checkpoint via GPS, you must be physically inside its radius. For desktop testing, ask for a checkpoint with QR enabled, or ask the organizer to create one using your current coordinates. |

### 1.4 Recommended Implementation Order

1. `api()` client + `GET /health` (verify URL and CORS).
2. Join flow (`lookup` -> `team/join`) and store `teamKey` and `token`.
3. `GET /auth/me` on app startup to check if there is an active session.
4. Waiting room with `GET /rally` and notifications.
5. Route flow: `route/current` -> `arrive` -> `submit`.
6. Evidence uploads with updated `evidenceSync.js` (Section 7).
7. Ranking and progress screens.
8. Organizer panel (`/admin`).

---

## 2. Authentication and JWT

### 2.1 How It Works

* The backend issues a signed JWT (`HS256`) when a team joins (`/auth/team/join`) or when an organizer logs in (`/auth/organizer/login`).
* The token travels in two ways, and the backend accepts either:
  1. Cookie `ck_session` (`httpOnly`, `Secure`, `SameSite=None` in production). This is the primary option: JavaScript cannot read it.
  2. `Authorization: Bearer <token>` header, using the token also returned in the response body.
* **Expiration:** 36 hours for teams and 12 hours for organizers. Once expired, any protected route responds with `401 UNAUTHENTICATED`.
* The payload contains `sub` (ID), `role` (`team` | `organizer`), `rid` (rally ID, teams only), and `exp`. Do not decode it to make security decisions: use `GET /auth/me`.
* The server verifies on every request that the team/organizer still exists, so a token belonging to a deleted team immediately stops working.

### 2.2 Recommended Fetch Client

```javascript
// src/services/api.js
const API = import.meta.env.VITE_API_BASE_URL.replace(/\/$/, '');
const TOKEN_KEY = 'ck_token';

export const tokenStore = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* private mode */ } },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* noop */ } },
};

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api(path, { method = 'GET', body, headers = {}, form } = {}) {
  const token = tokenStore.get();
  const res = await fetch(`${API}${path}`, {
    method,
    credentials: 'include', // sends the ck_session cookie
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}), // fallback if the browser blocks cookies
      ...headers,
    },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  if (res.status === 204) return null;
  const isJson = res.headers.get('content-type')?.includes('json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'HTTP_ERROR', e.message ?? `HTTP ${res.status}`, e.details);
  }
  return data;
}
```

### 2.3 Safari / iOS and Third-Party Cookies

If the frontend and the API are hosted on different domains (e.g., `vercel.app` and `onrender.com`), Safari blocks cross-site cookies and the session is lost. Solutions:

* **Best:** Use a custom domain with subdomains on the same site (`app.mydomain.com` and `api.mydomain.com`).
* **Fallback:** Save the token from the login/join response and send it as a `Bearer` token (the client above already does this). With `Bearer` auth, you cannot use `EventSource` (it does not support custom headers): for notifications, poll `GET /notifications?after=` or use `fetch` with streaming.

The current `evidenceSync.js` only uses `credentials: "include"`. To make it work with `Bearer`, add the `Authorization` header (see Section 7).

### 2.4 Error Format

All error responses share the same structure:

```json
{
  "error": {
    "code": "TIME_EXPIRED",
    "message": "Team time has expired",
    "details": null
  }
}
```

`details` only contains data on `VALIDATION_ERROR`: `[{ "path": "teamName", "message": "..." }]`.

| HTTP | Frequent Codes |
| :--- | :--- |
| **400** | `VALIDATION_ERROR`, `INVALID_JSON`, `INVALID_CAPTURED_AT`, `ANSWER_REQUIRED`, `HEADING_REQUIRED`, `FILE_REQUIRED`, `IDEMPOTENCY_MISMATCH` |
| **401** | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `INVALID_TEAM_KEY` |
| **403** | `FORBIDDEN` (wrong role), `ORIGIN_NOT_ALLOWED` (unauthorized origin), `CHECKPOINT_LOCKED`, `CHECKPOINT_NOT_REACHED` |
| **404** | `INVALID_RALLY_CODE`, `NOT_FOUND`, `CHECKPOINT_NOT_FOUND`, `RALLY_NOT_FOUND` |
| **409** | `TEAM_NAME_TAKEN`, `RALLY_FINISHED`, `RALLY_NOT_STARTED`, `TIME_EXPIRED`, `ALREADY_COMPLETED`, `NOT_ARRIVED`, `EVIDENCE_ID_TAKEN`, `SUBMISSION_ID_TAKEN` |
| **413 / 415** | `FILE_TOO_LARGE` / `UNSUPPORTED_MEDIA` |
| **422** | `METHOD_NOT_ALLOWED`, `EVIDENCE_REQUIRED`, `NO_CHECKPOINTS` |
| **429** | `RATE_LIMITED` |

### 2.5 Rate Limits

| Route | Limit |
| :--- | :--- |
| `/auth/team/join`, `/auth/team/resume` | 20 / min per IP |
| `/auth/organizer/login` | 10 / min per IP |
| `/auth/lookup` | 30 / min per IP |
| `proximity`, `arrive`, `submit` | 30 / min per team |
| `POST /evidences` | 60 / min per team |

Do not poll `proximity` in a tight loop: call it at most every 3–5 seconds.

---

## 3. Participant Flow

```text
/join (QR or code)
   │  GET  /auth/lookup            -> displays the rally name
   │  POST /auth/team/join         -> session + teamKey
   ▼
Waiting room ── GET /rally  (status = NOT_STARTED)
   │  (organizer starts; RALLY_STARTED notification arrives)
   ▼
GET /route/current  -> current checkpoint clue
   │  POST /checkpoints/:id/proximity   (optional, map/distance)
   │  POST /checkpoints/:id/arrive      (GPS, QR, or NFC)
   ▼
Challenge unlocked  -> [POST /evidences] -> POST /checkpoints/:id/submit
   │  correct: true  -> next clue in `next`
   │  correct: false -> retry (`attemptsLeft`)
   ▼
... repeat until state = ALL_COMPLETED  ->  GET /ranking
```

**Checkpoint states for a team:** `LOCKED` -> `CLUE` -> `ARRIVED` -> `COMPLETED`.

---

## 4. Participant Endpoints

### 4.1 Access (US-01, 02)

#### `GET /auth/lookup?code=ABC123` or `?token=<joinToken>`
Public endpoint. Rally preview (used to open the app with the rally pre-loaded).

```json
{
  "rally": {
    "id": "...",
    "name": "Demo Rally",
    "status": "NOT_STARTED",
    "durationMinutes": 90
  }
}
```

Returns `404 INVALID_RALLY_CODE` if the code or token is invalid.

#### `POST /auth/team/join`
Creates the team and starts a session.

```json
// Request body: code OR joinToken, plus teamName (2–40 characters)
{ "code": "DEMO01", "teamName": "The Wolves" }

// 201 Created
{
  "token": "eyJ...",
  "expiresIn": 129600,
  "team": { "id": "...", "name": "The Wolves" },
  "teamKey": "k3J...",
  "rally": {
    "id": "...",
    "name": "Demo Rally",
    "status": "NOT_STARTED",
    "durationMinutes": 90,
    "totalCheckpoints": 3,
    "serverTime": 1795203055608,
    "startedAt": null,
    "endsAt": null,
    "remainingSeconds": null,
    "extraMinutes": 0
  }
}
```

* Sets the `ck_session` cookie.
* **Save `teamKey`:** It is the only way to recover the session if the cookie is lost or the user switches devices. It is only returned in this response.
* **Errors:** `404 INVALID_RALLY_CODE`, `409 TEAM_NAME_TAKEN`, `409 RALLY_FINISHED`, `400 VALIDATION_ERROR`.
* The rally code is case-insensitive (`demo01` = `DEMO01`).

#### `POST /auth/team/resume`
Recovers an existing team session.

```json
{ "code": "DEMO01", "teamName": "The Wolves", "teamKey": "k3J..." }
```

Responds with the same payload as `join`, except without `teamKey`. Returns `401 INVALID_TEAM_KEY` if it does not match.

#### `GET /auth/me`
Returns the current authenticated identity. For a team: `{ "role": "team", "team": ..., "rally": ... }`. Call this on app startup to check if the session is still valid.

#### `POST /auth/logout`
Returns `204 No Content`. Clears the cookie (make sure you also clear the stored `Bearer` token on the client).

---

### 4.2 Rally Status and Timer (US-03, 15, 16)

#### `GET /rally`

```json
{
  "rally": {
    "id": "...",
    "name": "Demo Rally",
    "status": "IN_PROGRESS",
    "durationMinutes": 90,
    "totalCheckpoints": 3,
    "serverTime": 1795203055608,
    "startedAt": 1795200000000,
    "endsAt": 1795205400000,
    "remainingSeconds": 2344,
    "extraMinutes": 0
  },
  "team": { "id": "...", "name": "The Wolves", "score": 190 },
  "progress": { "completed": 2, "total": 3 }
}
```

* `status`: `NOT_STARTED` | `IN_PROGRESS` | `FINISHED`.
* `endsAt` is this specific team's deadline (includes extra minutes granted to the rally or the individual team).
* **Countdown timer:** Do not rely on the device's local clock. Calculate the clock offset once and apply it:

```javascript
const offset = rally.serverTime - Date.now(); // compute when receiving the response
const remainingMs = () => rally.endsAt - (Date.now() + offset);
```

Re-fetch `GET /rally` whenever a `TIME_EXTENDED` notification arrives.

---

### 4.3 Route and Clues (US-04, 05, 06, 07)

#### `GET /route/current`
Returns the active clue. Returns `409 RALLY_NOT_STARTED` if the rally has not begun yet.

```json
{
  "state": "ACTIVE",
  "progress": { "completed": 1, "total": 3 },
  "checkpoint": {
    "id": "7b1c...",
    "position": 2,
    "status": "CLUE",
    "unlockedAt": 1795200600000,
    "arrivedAt": null,
    "validationMethods": ["GEOFENCE", "QR"],
    "hideLocation": true,
    "location": null,
    "points": 100,
    "clue": {
      "contentId": "clue-7b1c...",
      "checkpointId": "7b1c...",
      "kind": "CLUE",
      "content": { "title": "Clue 2", "text": "Where the city was born..." }
    },
    "challenge": null
  }
}
```

* `state`: `ACTIVE` | `TIME_UP` (team's time ran out) | `ALL_COMPLETED` (in both `TIME_UP` and `ALL_COMPLETED`, `checkpoint` is `null`).
* `location` is `null` when `hideLocation` is `true` (observation/riddle challenges). When `false`, it returns `{ latitude, longitude, radius }` to draw on the map.
* `challenge` is `null` until arrival is validated; once `status` is `"ARRIVED"`, it contains the challenge object.
* `clue` and `challenge` follow the `{ contentId, checkpointId, kind, content }` structure expected by `saveUnlockedContent()` in `offlineRally.js`: persist them in Dexie as soon as they are received so they remain available offline (US-20).

#### `GET /progress`
Returns progress and timing metrics per checkpoint.

```json
{
  "completed": 1,
  "total": 3,
  "checkpoints": [
    {
      "id": "...",
      "position": 1,
      "title": "Clue 1",
      "status": "COMPLETED",
      "points": 100,
      "pointsAwarded": 90,
      "attempts": 2,
      "unlockedAt": 1795200000000,
      "arrivedAt": 1795200300000,
      "completedAt": 1795200420000,
      "secondsToArrive": 300,
      "secondsOnChallenge": 120,
      "secondsTotal": 420
    },
    {
      "id": "...",
      "position": 3,
      "title": null,
      "status": "LOCKED",
      "points": 100,
      "pointsAwarded": 0,
      "attempts": 0,
      "unlockedAt": null,
      "arrivedAt": null,
      "completedAt": null,
      "secondsToArrive": null,
      "secondsOnChallenge": null,
      "secondsTotal": null
    }
  ]
}
```

`LOCKED` checkpoints return `title: null` so future locations are not leaked.

#### `POST /checkpoints/:id/proximity`
Checks distance without committing an arrival (for map UI). Only works for the current checkpoint while the rally is in progress.

```json
// Request
{ "latitude": 4.6, "longitude": -74.07, "accuracy": 12 }

// Response
{ "reliable": true, "inside": false, "distance": 450, "remaining": 410 }
```

* When `hideLocation` is `true`, `distance` is rounded to multiples of 25 m.
* If `accuracy` exceeds 100 m: `{ "reliable": false, "reason": "LOW_ACCURACY", "accuracy": 250, "maxAccuracy": 100 }`.
* The map displays the team's own device position and this distance; no destination coordinates are shown if it is an observation challenge.

---

### 4.4 Validate Arrival (US-08, 09, 10)

#### `POST /checkpoints/:id/arrive`
`method` must be listed in the checkpoint's `validationMethods` (otherwise `422 METHOD_NOT_ALLOWED`).

```json
// GPS
{ "method": "GEOFENCE", "latitude": 4.6001, "longitude": -74.07, "accuracy": 10 }

// QR (raw string read from the QR code)
{ "method": "QR", "code": "CK1.7b1c....xYz" }

// NFC (code stored in the NDEF tag, or tag serial number)
{ "method": "NFC", "code": "CK1.7b1c....xYz" } // or { "method": "NFC", "uid": "04:A3:..." }

// Optional on any method (for offline queue): "capturedAt": 1795200300000
```

**Success response (`200 OK`):**

```json
{
  "arrived": true,
  "method": "GEOFENCE",
  "arrivedAt": 1795200300000,
  "challenge": {
    "contentId": "challenge-7b1c...",
    "checkpointId": "7b1c...",
    "kind": "CHALLENGE",
    "content": {
      "title": "Observation Challenge",
      "instruction": "What animal appears on the main building?",
      "type": "QUESTION",
      "evidenceType": null,
      "points": 100
    }
  }
}
```

If the team had already arrived, it returns the same payload with `"alreadyArrived": true` (the endpoint is idempotent).

**Rejected arrival (also `200 OK`, with `arrived: false`)** — this is not an HTTP error; display the reason to the user:

| `reason` | Data | What to display |
| :--- | :--- | :--- |
| `OUTSIDE_GEOFENCE` | `inside: false`, `distance`, `remaining` (m) | `"You are ~{remaining} m away"` (US-08) |
| `LOW_ACCURACY` | `accuracy`, `maxAccuracy`, `message` | Ask the user to move to open sky or scan the QR code |
| `INVALID_CODE` | `message` | `"This code does not belong to this checkpoint"` |

**HTTP Errors:** `403 CHECKPOINT_LOCKED` (not your current checkpoint), `409 ALREADY_COMPLETED`, `409 TIME_EXPIRED`, `409 RALLY_NOT_STARTED`, `422 METHOD_NOT_ALLOWED`.

**QR/NFC code format:** `CK1.<checkpointId>.<secret>`. The organizer prints the QR from the admin panel; the frontend simply submits the scanned text as `code`. Note that Web NFC is only supported on Chrome for Android.

#### `GET /checkpoints/:id/challenge`
Re-fetches the challenge (only available after arriving; returns `403 CHECKPOINT_NOT_REACHED` beforehand).

---

### 4.5 Challenges and Feedback (US-11 to 14)

**Challenge types (`challenge.content.type`):**

| `type` | What is sent in `submit` | How it is validated |
| :--- | :--- | :--- |
| `QUESTION` | `answer` (string) | Case-, accent-, and punctuation-insensitive. May include `options` (array) for multiple-choice questions. |
| `PHOTO` | `evidenceId` of an already-uploaded photo | Accepted if the evidence was received. |
| `AUDIO` | `evidenceId` of an already-uploaded audio clip | Accepted if the evidence was received. |
| `COMPASS` | `heading` ($0^\circ$ to $360^\circ$, degrees relative to North) | Correct if within the target bearing's tolerance (handles $0^\circ$/$360^\circ$ wrap-around properly). |

> **Compass note:** On iOS, use `webkitCompassHeading` (requires `DeviceOrientationEvent` permission); on Android, use `deviceorientationabsolute`.

#### `POST /checkpoints/:id/submit`

```json
{
  "submissionId": "a1b2c3d4-...",
  "answer": "condor",
  "capturedAt": 1795200420000
}
```

* `submissionId` (8–64 chars `A-Za-z0-9_-`) makes the request idempotent: repeating it returns the exact same result with `"replayed": true`. You can also pass it via the `Idempotency-Key` header. Generate one per attempt using `crypto.randomUUID()` and reuse it on retries.
* `capturedAt` (epoch ms) is optional; send it when the answer was recorded while offline.

**Response when challenge is completed:**

```json
{
  "submissionId": "a1b2c3d4-...",
  "correct": true,
  "completed": true,
  "pointsAwarded": 90,
  "score": 190,
  "finished": false,
  "progress": { "completed": 2, "total": 3 },
  "next": {
    "id": "...",
    "position": 3,
    "status": "CLUE",
    "clue": { "...": "..." },
    "challenge": null
  }
}
```

* `next` holds the next checkpoint's clue (same shape as `checkpoint` in `/route/current`), or `null` if `finished` is `true`.
* If attempts are exhausted: `correct: false`, `completed: true`, `pointsAwarded: 0`, and `"reason": "ATTEMPTS_EXHAUSTED"`; the team still advances to the next checkpoint.

**Response on an incorrect answer (with attempts remaining):**

```json
{
  "submissionId": "...",
  "correct": false,
  "completed": false,
  "pointsAwarded": 0,
  "attemptsLeft": 1
}
```

Each failed attempt may deduct points from the final reward (configured by the organizer).

**Errors:** `409 NOT_ARRIVED` (arrival not validated yet), `409 ALREADY_COMPLETED`, `409 TIME_EXPIRED`, `422 EVIDENCE_REQUIRED` (photo/audio has not synced yet: retry `submit` after `POST /evidences` succeeds), `400 ANSWER_REQUIRED` / `HEADING_REQUIRED`.

---

### 4.6 Evidence: Photo and Audio (US-11, 13, 21, 22)

#### `POST /evidences` (`multipart/form-data`)
This is the endpoint already consumed by `evidenceSync.js`.

| Field | Value |
| :--- | :--- |
| `evidenceId` | Client-generated UUID (8–64 chars `A-Za-z0-9_-`) |
| `checkpointId` | Real checkpoint ID (from `/route/current`, **not** `"checkpoint-demo"`) |
| `type` | `PHOTO` or `AUDIO` |
| `capturedAt` | Optional, epoch ms (use `evidence.createdAt`) |
| `file` | The binary file (must be appended **after** all text fields) |

Optional `Idempotency-Key` header: if provided, it must match `evidenceId` (`400 IDEMPOTENCY_MISMATCH`).

```json
// 201 Created (first upload) / 200 OK with "replayed": true (retry)
{
  "evidenceId": "...",
  "status": "RECEIVED",
  "checkpointId": "...",
  "type": "PHOTO",
  "size": 183204,
  "receivedAt": 1795200400000
}
```

* `evidenceSync.js` already checks `evidenceId` and `status === "RECEIVED"`, so it works out of the box once you add `Authorization` and `capturedAt` (Section 7).
* **Limits & Formats:** Photo max 8 MB, audio max 15 MB. The server inspects actual file magic bytes (not just `Content-Type`): photos must be JPEG, PNG, or WebP (HEIC is rejected; convert to JPEG via `<canvas>` first); audio must be WebM, OGG, MP4/M4A, MP3, or WAV. The detected file type must match `type`.
* Evidence is accepted for already-unlocked checkpoints (rejected for future checkpoints with `403 CHECKPOINT_LOCKED`).

---

### 4.7 Ranking (US-17)

#### `GET /ranking`

```json
{
  "rallyStatus": "IN_PROGRESS",
  "ranking": [
    {
      "rank": 1,
      "teamId": "...",
      "name": "The Wolves",
      "score": 280,
      "completedCheckpoints": 3,
      "finished": true,
      "finishedAt": 1795203000000,
      "totalSeconds": 3000,
      "lastCompletedAt": 1795203000000,
      "extraMinutes": 0,
      "endsAt": 1795205400000
    }
  ],
  "me": { "rank": 1, "...": "..." }
}
```

**Sort order:** Highest score -> most completed checkpoints -> earliest completion time. `totalSeconds` is `null` until the team completes the route. Refresh when opening the screen or poll every 15–30 seconds.

---

### 4.8 Notifications (US-18, 19, 25)

**Notification types:**

| `type` | When | Suggested action |
| :--- | :--- | :--- |
| `RALLY_STARTED` | Organizer starts the rally | Load `/route/current` |
| `NEW_CLUE` | Next clue unlocks | Refresh current route |
| `TIME_WARNING` | $\le 15$ and $\le 5$ min remaining (configurable) | Show on-screen alert |
| `TIME_EXTENDED` | Organizer adds extra time | Refresh `GET /rally` |
| `RALLY_FINISHED` | Ended due to time limit or manually | Show final results |
| `ROUTE_COMPLETED` | Team finished all checkpoints | Navigate to `/ranking` |

**Notification payload:** `{ id, rallyId, teamId, type, title, body, data, createdAt }` (`teamId: null` means broadcast to all teams).

**Option A — SSE:** `GET /events` (requires session cookie)

```javascript
const es = new EventSource(`${API}/events`, { withCredentials: true });
es.addEventListener('notification', (e) => handle(JSON.parse(e.data)));
```

Upon reconnecting, the browser automatically sends `Last-Event-ID` and the server replays any missed notifications.

**Option B — Polling:** `GET /notifications?after=<lastId>` (works with both cookie and `Bearer` token)

```json
{
  "notifications": [
    { "id": 12, "type": "NEW_CLUE", "title": "New clue unlocked", "...": "..." }
  ]
}
```

Track the highest `id` received and poll every 10–15 seconds. Use this as a fallback when SSE is unavailable.

> Web Push is not implemented yet: notifications are only delivered while the app is open.

---

## 5. Offline and Synchronization (US-20, 21, 22)

* **Cache unlocked content:** Save `clue` and `challenge` objects in Dexie using `saveUnlockedContent` as soon as you receive them. While offline, users can view the clue and prepare their challenge response.
* **What does NOT work offline:** Validating arrival, grading answers, and fetching the next clue require server connectivity. While offline, queue photos/audio and challenge answers locally, then sync once connectivity returns.
* **Idempotency:** `evidenceId`, `submissionId`, and `arrive` requests can be safely retried without risking duplicate points.
* **`capturedAt`:** Send this timestamp in `arrive`, `submit`, and `POST /evidences` whenever the action took place offline. Challenge elapsed time is calculated from that moment. Offline submissions are accepted up to 2 hours past the team's deadline (`409 TIME_EXPIRED` if later). The timestamp cannot be in the future or earlier than the rally start (`400 INVALID_CAPTURED_AT`).
* **Recommended sync order for a queued challenge:**
  1. `arrive` with `capturedAt`
  2. `POST /evidences`
  3. `submit` with `evidenceId`

**How to handle sync queue errors:**

| Result | Action |
| :--- | :--- |
| Network error, `5xx`, `429` | Retry later (`PENDING`) |
| `400`, `401`, `403`, `404`, `409`, `413`, `415`, `422` | Mark `FAILED` and display the reason (do not retry blindly) |
| `401 UNAUTHENTICATED` | Refresh session using `team/resume` and retry |

---

## 6. Suggested Routes in React

| Route | Screen | Endpoints |
| :--- | :--- | :--- |
| `/join?token=...` or `/join` | Join screen via QR or code | `lookup`, `team/join` |
| `/lobby` | Waiting room / status | `rally`, notifications |
| `/play` | Active clue, map, arrival, challenge | `route/current`, `proximity`, `arrive`, `submit`, `evidences` |
| `/progress` | Progress and timing breakdown | `progress` |
| `/ranking` | Leaderboard | `ranking` |
| `/admin/login`, `/admin/rallies/:id` | Organizer panel | See Section 8 |

The access QR opens `<APP_BASE_URL>/join?token=<joinToken>`: read the `token` query parameter, call `GET /auth/lookup?token=...` to display the rally details, and then prompt for the team name to call `POST /auth/team/join` with `{ joinToken, teamName }`.

---

## 7. Minimal Changes in `evidenceSync.js`

```javascript
import { tokenStore } from './api';

// ...inside uploadEvidence():
form.append('evidenceId', evidence.id);
form.append('checkpointId', evidence.checkpointId);    // real checkpoint ID
form.append('type', evidence.type);
form.append('capturedAt', String(evidence.createdAt)); // NEW
form.append('file', evidence.blob, filename);

const token = tokenStore.get();
const response = await fetch(`${API_URL.replace(/\/$/, '')}/evidences`, {
  method: 'POST',
  credentials: 'include',
  headers: {
    'Idempotency-Key': evidence.id,
    ...(token ? { Authorization: `Bearer ${token}` } : {}), // NEW
  },
  body: form,
});
```

Additionally, ensure the evidence lifecycle uses the real `checkpointId` returned by `/route/current` rather than the `"checkpoint-demo"` placeholder from test screens.

---

## 8. Organizer Endpoints (`/admin`)

All routes below require an organizer session (cookie or `Bearer` token). A team token receives `403 FORBIDDEN`.

### 8.1 Session (US-23)

* `POST /auth/organizer/login`
  * **Body:** `{ "email": "admin@cluekeeper.com", "password": "..." }`
  * **Response:** `{ token, expiresIn, organizer: { id, email, name } }` + `ck_session` cookie.
  * **Error:** `401 INVALID_CREDENTIALS` on failure.

### 8.2 Rallies

| Method and Route | Description |
| :--- | :--- |
| `POST /admin/rallies` | Create a new rally |
| `GET /admin/rallies` | List organizer's rallies |
| `GET /admin/rallies/:id` | Organizer dashboard view (US-23): status, timer, teams with scores, completed checkpoints |
| `PUT /admin/rallies/:id` | Edit rally (only before starting) |
| `DELETE /admin/rallies/:id` | Delete rally (only before starting) |
| `POST /admin/rallies/:id/start` | Start rally (US-24) |
| `POST /admin/rallies/:id/extend` | Grant extra time (US-25) |
| `POST /admin/rallies/:id/finish` | End rally manually |
| `GET /admin/rallies/:id/join-qr` | Access QR code (SVG); with `?format=json` returns `{ url, code }` |
| `GET /admin/rallies/:id/ranking` | Rally leaderboard |
| `GET /admin/rallies/:id/report` | Rally report (US-26): JSON; with `?format=csv` downloads a CSV file |
| `GET /admin/rallies/:id/evidences` | List of received evidence files |
| `GET /admin/rallies/:id/evidences/:eid/file` | Download photo/audio file |

**Create rally body:**

```json
{
  "name": "Downtown Rally",
  "code": "CENTRO1",
  "durationMinutes": 90,
  "wrongAttemptPenalty": 10,
  "maxAttempts": 3,
  "warningMinutes": [15, 5]
}
```

* `code` is optional (4–12 alphanumeric characters; auto-generates a 6-character code if omitted).
* `wrongAttemptPenalty`: points deducted per failed attempt.
* `maxAttempts`: maximum tries before advancing with 0 points.

**Extend time body:**

```json
{ "minutes": 10 }                // applies to the entire rally
{ "minutes": 10, "teamId": "..." } // applies to a single team
```

* If the rally had already ended due to time expiration, it reopens if the extension brings the deadline back into the future. A manually finished rally cannot be extended (`409 RALLY_FINISHED`). Broadcasts a `TIME_EXTENDED` notification.
* **Start:** Requires at least one checkpoint (`422 NO_CHECKPOINTS`) and must not have started already (`409 ALREADY_STARTED`). Triggers `RALLY_STARTED`.

### 8.3 Checkpoints (Editable Only Before Starting)

| Method and Route | Description |
| :--- | :--- |
| `GET /admin/rallies/:id/checkpoints` | List checkpoints (includes accepted answers and QR secrets) |
| `POST /admin/rallies/:id/checkpoints` | Create checkpoint (appended at the end) |
| `PUT /admin/rallies/:id/checkpoints/:cid` | Edit checkpoint |
| `DELETE /admin/rallies/:id/checkpoints/:cid` | Delete checkpoint (automatically reorders remaining ones) |
| `PUT /admin/rallies/:id/checkpoints/order` | Reorder: `{ "ids": ["cid1", "cid2", ...] }` (must include all checkpoint IDs) |
| `GET /admin/rallies/:id/checkpoints/:cid/qr` | Printable checkpoint QR code (SVG) |

**Checkpoint body:**

```json
{
  "title": "Bolivar Square",
  "clueText": "Find the square where the city's power gathers.",
  "latitude": 4.5981,
  "longitude": -74.0760,
  "radius": 40,
  "validationMethods": ["GEOFENCE", "QR"],
  "nfcUid": "04A3B2C1",
  "hideLocation": true,
  "points": 100,
  "challenge": {
    "type": "QUESTION",
    "title": "Observation Challenge",
    "instruction": "What animal appears on the main building?",
    "acceptedAnswers": ["condor"]
  }
}
```

* `title` is visible only to the organizer (teams see `"Clue N"`).
* `radius`: 5–1000 m (defaults to 30).
* `validationMethods`: `GEOFENCE`, `QR`, `NFC` (if `NFC` is included, `nfcUid` is required).
* `points`: 0–1000.
* **Challenge variants:**
  * `{ "type": "QUESTION", "title", "instruction", "description"?, "options"?: [2–6 strings], "acceptedAnswers": [1–10 strings] }`
  * `{ "type": "PHOTO", "title", "instruction" }`
  * `{ "type": "AUDIO", "title", "instruction" }`
  * `{ "type": "COMPASS", "title", "instruction", "bearing": 0–360, "tolerance": 5–90 }`
* In the response, `qrPayload` contains the exact string encoded in the checkpoint's QR/NFC tag.
* Attempting to modify configuration after the rally has started returns `409 RALLY_LOCKED`.

### 8.4 Report

`GET /admin/rallies/:id/report` returns:

```json
{
  "generatedAt": "...",
  "rally": {
    "id": "...",
    "name": "...",
    "code": "...",
    "status": "...",
    "startedAt": 1795200000000,
    "finishedAt": 1795205400000,
    "durationMinutes": 90,
    "extraMinutes": 0
  },
  "checkpoints": [
    { "id": "...", "position": 1, "title": "...", "points": 100 }
  ],
  "teams": [
    {
      "rank": 1,
      "name": "...",
      "score": 280,
      "completedCheckpoints": 3,
      "finished": true,
      "totalSeconds": 3000,
      "checkpoints": [
        {
          "position": 1,
          "title": "...",
          "status": "COMPLETED",
          "pointsAwarded": 90,
          "attempts": 2,
          "unlockedAt": 1795200000000,
          "arrivedAt": 1795200300000,
          "completedAt": 1795200420000,
          "secondsTotal": 420,
          "secondsOnChallenge": 120
        }
      ]
    }
  ]
}
```

* Appending `?format=csv` downloads the report with a UTF-8 BOM (opens cleanly in Excel). To download it using `Bearer` auth, use `fetch` -> `blob` -> `URL.createObjectURL`; a direct `<a>` download link only works when cookies are sent.
* Endpoints returning SVGs or binary files (`join-qr`, `.../qr`, `.../file`) also require authentication. An `<img src>` tag sends cookies, but **not** the `Bearer` header: when using `Bearer` auth, fetch them via `fetch()` and convert the response to an object URL (`blob`).

### 8.5 Panel Notifications

`GET /events?rallyId=<id>` (SSE, cookie-authenticated) streams all rally notifications to the organizer in real time.

---

## 9. Launch Checklist

1. **Backend online:** `GET API/health` -> `{"status":"ok"}`.
2. **CORS & URLs configured:** Your origins (production and `localhost`) are authorized in the backend's CORS settings, and the backend knows your public frontend URL.
3. **Organizer login works:** `/auth/organizer/login` succeeds.
4. **Test rally ready:** Create a rally and at least one checkpoint; copy its `code` or download the access QR.
5. **Frontend configured:** `VITE_API_BASE_URL` (ending in `/api`), `credentials: 'include'` on all `fetch` calls, and the API client includes the `Bearer` fallback.
6. **Real mobile device testing over HTTPS:** Test GPS, camera, microphone, compass, and airplane mode (offline queue).
7. **Safari/iOS session persistence:** Verify session retention; if third-party cookies are blocked, rely on `Bearer` mode or configure same-site subdomains.
8. **Session recovery:** Save `teamKey` upon joining and verify `team/resume` works if the session is lost.

---

## 10. Route Summary

| Area | Route |
| :--- | :--- |
| **System** | `GET /health` |
| **Access** | `GET /auth/lookup`, `POST /auth/team/join`, `POST /auth/team/resume`, `POST /auth/organizer/login`, `POST /auth/logout`, `GET /auth/me` |
| **Gameplay** | `GET /rally`, `GET /route/current`, `GET /progress`, `GET /ranking` |
| **Checkpoints** | `POST /checkpoints/:id/proximity`, `POST /checkpoints/:id/arrive`, `GET /checkpoints/:id/challenge`, `POST /checkpoints/:id/submit` |
| **Evidence** | `POST /evidences` |
| **Notifications** | `GET /events` (SSE), `GET /notifications?after=` |
| **Organizer** | `/admin/rallies...` (see Section 8) |

### User Story Map

* **US-01 / US-02** -> `lookup`, `team/join`
* **US-03 / US-16** -> `rally`
* **US-04 / US-05** -> `route/current`
* **US-06** -> `proximity`
* **US-07** -> `progress`
* **US-08 / US-09 / US-10** -> `arrive`
* **US-11 / US-12 / US-13 / US-14** -> `evidences`, `submit`
* **US-15** -> `rally` (`team.score`)
* **US-17** -> `ranking`
* **US-18 / US-19** -> `events`, `notifications`
* **US-20 / US-21 / US-22** -> Dexie cache + idempotency
* **US-23** -> `organizer/login`, `admin/rallies/:id`
* **US-24** -> `start`
* **US-25** -> `extend`
* **US-26** -> `report`