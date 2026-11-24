// Call this server's own routes as the signed-in user, so a background step (approving an AI
// draft, carrying out an approved payment) goes through exactly the same checks, links and
// audit as typing it on the screen.
import { AuthRequest } from "../src/middleware/auth.ts";
import { INTERNAL_CALL_TOKEN } from "../src/middleware/security.ts";

export async function selfApi(req: AuthRequest, method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
  const port = Number(process.env.PORT) || 3000;
  const r = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { authorization: String(req.headers.authorization || ""), "content-type": "application/json", "x-internal-call": INTERNAL_CALL_TOKEN, ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const json: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json?.error || `HTTP ${r.status} on ${path}`);
  return json;
}
