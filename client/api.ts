/**
 * Enterprise API client for HF Transport ERP.
 *
 * Auth: a native session JWT issued by /api/auth/*. It is kept in localStorage
 * so the session survives reloads, and sent as `Authorization: Bearer <token>`.
 */

const TOKEN_KEY = "hf_erp_session";

let overrideTokenFn: (() => Promise<string | null>) | null = null;

/** Persist (or clear) the session token. */
export function setSessionToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode / storage disabled - token just won't persist */
  }
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Override how the token is resolved (used for the dev-login bypass). Pass null to clear. */
export function registerTokenGetter(fn: (() => Promise<string | null>) | null) {
  overrideTokenFn = fn;
}

/** Current session token, or null if signed out. */
export async function getAuthToken(): Promise<string | null> {
  if (overrideTokenFn) return overrideTokenFn();
  return getStoredToken();
}

/**
 * Authenticated file download (template / export). A plain <a href> can't carry
 * the bearer token, so we fetch the blob and click a temporary link.
 */
export async function downloadFile(path: string, fallbackName: string) {
  const token = await getAuthToken();
  const res = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let msg = `Download failed (HTTP ${res.status})`;
    try {
      const j = await res.json();
      if (j.error) msg = j.error;
    } catch {
      /* not json */
    }
    throw new Error(msg);
  }
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const name = match ? match[1] : fallbackName;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** POST multipart/form-data with the bearer token (no JSON content-type). */
export async function uploadFile(path: string, formData: FormData) {
  const token = await getAuthToken();
  const res = await fetch(path, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Upload failed (HTTP ${res.status})`);
  return json;
}

/** Attach a file (receipt / proof / scan) to any record. */
export async function uploadAttachment(
  entityType: string,
  entityId: number,
  file: File,
  caption?: string,
  category?: string
) {
  const fd = new FormData();
  // text fields BEFORE the file so multer's disk-storage sees entityType
  fd.append("entityType", entityType);
  fd.append("entityId", String(entityId));
  if (caption) fd.append("caption", caption);
  if (category) fd.append("category", category);
  fd.append("file", file);
  return uploadFile("/api/attachments", fd);
}

export function attachmentFileUrl(id: number) {
  return `/api/attachments/${id}/file`;
}

/** Fetch an authed binary (image/pdf) as an object URL for inline display. */
export async function fetchBlobUrl(path: string): Promise<string> {
  const token = await getAuthToken();
  const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return URL.createObjectURL(await res.blob());
}

// ---------------------------------------------------------------------------
// Generic entity grid API (/api/entities/:key) - the editable spreadsheet grid
// ---------------------------------------------------------------------------

export interface EntityField {
  column: string;
  field: string;
  type: string;
  required: boolean;
  readonly: boolean;
  naturalKey: boolean;
  enumValues: string[] | null;
  ref: { entity: string; by?: string } | null;
  note?: string | null;
}

export interface EntityListResponse {
  key: string;
  label: string;
  rows: Record<string, any>[];
  total: number;
  limit: number;
  offset: number;
  canWrite: boolean;
  canDelete: boolean;
  fields: EntityField[];
}

export interface EntityListQuery {
  limit?: number;
  offset?: number;
  search?: string;
  sort?: string;
  dir?: "asc" | "desc";
  filters?: Record<string, string>;
  includeDeleted?: boolean;
}

export function entityList(key: string, q: EntityListQuery = {}): Promise<EntityListResponse> {
  const p = new URLSearchParams();
  if (q.limit != null) p.set("limit", String(q.limit));
  if (q.offset != null) p.set("offset", String(q.offset));
  if (q.search) p.set("search", q.search);
  if (q.sort) p.set("sort", q.sort);
  if (q.dir) p.set("dir", q.dir);
  if (q.includeDeleted) p.set("includeDeleted", "1");
  for (const [k, v] of Object.entries(q.filters ?? {})) if (v !== "") p.set(`f_${k}`, v);
  return enterpriseFetch(`/api/entities/${key}?${p.toString()}`);
}

export function entityMeta(key: string) {
  return enterpriseFetch(`/api/entities/${key}/meta`);
}

export function entityCreate(key: string, data: Record<string, unknown>) {
  return enterpriseFetch(`/api/entities/${key}`, { method: "POST", body: JSON.stringify(data) });
}

export function entityUpdate(key: string, id: number, data: Record<string, unknown>) {
  return enterpriseFetch(`/api/entities/${key}/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

export function entityDelete(key: string, id: number) {
  return enterpriseFetch(`/api/entities/${key}/${id}`, { method: "DELETE" });
}

export function entityBulk(
  key: string,
  ops: { op: "create" | "update" | "delete"; id?: number; data?: Record<string, unknown> }[],
) {
  return enterpriseFetch(`/api/entities/${key}/bulk`, { method: "POST", body: JSON.stringify({ ops }) });
}

export function entitiesCatalog(): Promise<{ entities: any[] }> {
  return enterpriseFetch(`/api/entities`);
}

/** The server is asleep or restarting: Render answers with its own HTML page (502/503/504), not the app. */
export const SERVER_WAKING =
  "The server is starting up (it sleeps when nobody uses it, and restarts after an update). Wait a minute and try again · سرور شروع ہو رہا ہے، ایک منٹ بعد دوبارہ کوشش کریں";

/** Whether a response came from the app (JSON) or from the host in front of it (an HTML error page). */
export function isAppJson(res: Response) {
  return (res.headers.get("Content-Type") || "").includes("application/json");
}

/**
 * POST to a sign-in endpoint. While the server wakes up or restarts, the host answers with an HTML
 * page instead of the app — reading that as JSON showed "Unexpected token '<', "<!DOCTYPE "…". Those
 * answers are waited out (a few tries, a few seconds apart); a real answer is returned as it is.
 */
export async function postAuth(path: string, body: unknown, onWaiting?: (attempt: number) => void): Promise<{ ok: boolean; data: any }> {
  const tries = 6;
  for (let attempt = 1; attempt <= tries; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch {
      res = null; // no connection, or the host dropped it mid-restart
    }
    if (res && isAppJson(res)) return { ok: res.ok, data: await res.json() };
    if (attempt < tries) {
      onWaiting?.(attempt);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  throw new Error(SERVER_WAKING);
}

export async function enterpriseFetch(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers || {});

  const token = await getAuthToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  // Ensure JSON content-type if request body is present
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorMessage = `HTTP Error ${response.status}: ${response.statusText}`;
    if ([502, 503, 504].includes(response.status) && !isAppJson(response)) throw new Error(SERVER_WAKING);
    try {
      const errorJson = await response.json();
      if (errorJson.error) {
        errorMessage = errorJson.error;
      } else if (Array.isArray(errorJson.errors) && errorJson.errors.length) {
        // e.g. /api/entities/:key/bulk when every row fails: no top-level
        // "error" string, just an errors[] array — fall back to the first
        // row's message instead of a generic "Bad Request" that hides which
        // field/row actually failed.
        const first = errorJson.errors[0];
        errorMessage = first?.message || errorMessage;
        if (errorJson.errors.length > 1) errorMessage += ` (+${errorJson.errors.length - 1} more)`;
      }
    } catch {
      // Ignored if response is not JSON
    }
    throw new Error(errorMessage);
  }

  // a page instead of data: the host answered for an app that is not up (yet)
  if (!isAppJson(response)) {
    const text = await response.text();
    if (/^\s*</.test(text)) throw new Error(SERVER_WAKING);
    return JSON.parse(text);
  }
  return response.json();
}
