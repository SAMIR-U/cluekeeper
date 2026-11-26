const env = process.env;
const isProd = env.NODE_ENV === 'production';

const num = (value, fallback) => {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
};

if (isProd && !env.DATABASE_URL) {
  throw new Error('DATABASE_URL (PostgreSQL) es obligatorio en producción');
}

if (isProd && (!env.JWT_SECRET || env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET (mínimo 32 caracteres) es obligatorio en producción');
}

const origins = (env.CORS_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

// Hosts de servicios push de los navegadores (FCM/Chrome, Mozilla, Apple, Windows). Evita que un cliente
// haga que el servidor envíe peticiones a URLs arbitrarias. Ampliable con PUSH_ALLOWED_HOSTS.
const pushAllowedHosts = (
  env.PUSH_ALLOWED_HOSTS ??
  'googleapis.com,push.services.mozilla.com,push.apple.com,notify.windows.com,mozaws.net'
)
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const appBaseUrl = (env.APP_BASE_URL ?? origins[0] ?? 'http://localhost:5173').replace(/\/$/, '');

export const config = Object.freeze({
  isProd,
  port: num(env.PORT, 4000),
  jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me-dev-only-secret',
  // Orígenes del frontend (React) autorizados a llamar a la API con cookies
  corsOrigins: origins,
  // URL pública del frontend; se usa para construir el enlace del QR de acceso
  appBaseUrl,
  // Frontend y API en dominios distintos => SameSite=None + Secure
  cookieSameSite: env.COOKIE_SAMESITE ?? (isProd ? 'none' : 'lax'),
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProd,
  trustProxy: num(env.TRUST_PROXY, 0),
  // PostgreSQL. Sin DATABASE_URL (solo desarrollo/tests) se usa PGlite, un Postgres embebido
  databaseUrl: env.DATABASE_URL,
  databaseSsl: env.DATABASE_SSL === 'true',
  databasePoolMax: num(env.DATABASE_POOL_MAX, 10),
  pgliteDir: env.PGLITE_DIR ?? './data/pglite', // ':memory:' para no persistir
  // Precisión GPS máxima aceptada para validar una geocerca (metros)
  maxGeoAccuracyM: num(env.MAX_GEO_ACCURACY_M, 100),
  // Ventana tras el fin del rally para aceptar datos capturados offline (minutos)
  lateSyncGraceMinutes: num(env.LATE_SYNC_GRACE_MINUTES, 120),
  teamSessionHours: num(env.TEAM_SESSION_HOURS, 36),
  organizerSessionHours: num(env.ORGANIZER_SESSION_HOURS, 12),
  // Carga/sincroniza el Rally UPTC en la base de datos al arrancar
  autoSeedRally: env.AUTO_SEED_RALLY !== 'false',
  rateLimitEnabled: env.RATE_LIMIT !== 'off',
  adminEmail: env.ADMIN_EMAIL,
  adminPassword: env.ADMIN_PASSWORD,
  // Web Push (VAPID). Genera el par con `npm run vapid`. La clave privada nunca debe salir del servidor.
  vapidPublicKey: env.VAPID_PUBLIC_KEY?.trim() || undefined,
  vapidPrivateKey: env.VAPID_PRIVATE_KEY?.trim() || undefined,
  // mailto: o https:// de contacto para los servicios push (obligatorio en VAPID)
  vapidSubject:
    env.VAPID_SUBJECT?.trim() ||
    (env.ADMIN_EMAIL ? `mailto:${env.ADMIN_EMAIL}` : appBaseUrl.startsWith('https://') ? appBaseUrl : 'mailto:admin@cluekeeper.test'),
  pushAllowedHosts,
});