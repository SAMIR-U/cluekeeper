export const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD
    ? "https://cluekeeper.onrender.com/api"
    : "http://localhost:4000/api")
).replace(/\/$/, "");
const TOKEN_KEY = "cluekeeper-session-token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function connectionError(error) {
  const message = String(error?.message || "");
  if (error instanceof TypeError || /failed to fetch|fetch failed|networkerror|load failed/i.test(message)) {
    const friendly = new Error("Error de conexión. No se pudo comunicar con el servidor. Revisa tu conexión e inténtalo de nuevo.");
    friendly.code = "NETWORK_ERROR";
    friendly.cause = error;
    return friendly;
  }
  return error;
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  let response;
  try {
    response = await fetch(`${API_BASE}${path.startsWith("/") ? path : `/${path}`}`, {
      ...options,
      headers,
      credentials: "include",
      body: options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body,
    });
  } catch (error) {
    throw connectionError(error);
  }
  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(payload?.error?.message || payload?.message || `Error HTTP ${response.status}`);
    error.status = response.status;
    error.code = payload?.error?.code;
    throw error;
  }
  return payload;
}

export function apiUrl(path) {
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}
