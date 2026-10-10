/**
 * The one door to a language model for the AI Accountant.
 *
 *   ANTHROPIC_API_KEY  → Claude (preferred; AI_MODEL overrides the model)
 *   GEMINI_API_KEY     → Gemini (used when there is no Claude key)
 *   AI_PROVIDER=off    → no AI at all (the AI Accountant still works in "rules" mode)
 *
 * Every call is recorded in ai_runs (feature, model, ok / error, size, time) — never the content.
 * Callers ask for JSON; the reply is parsed leniently (code fences / text around it are ignored).
 */
import { GoogleGenAI } from "@google/genai";
import { db, schema } from "../../src/db/index.ts";

export type Attachment = { mime: string; data: Buffer; name?: string };

const CLAUDE_DEFAULT = "claude-sonnet-5-5";
const GEMINI_DEFAULT = "gemini-3.5-flash";

export function aiStatus(): { on: boolean; provider: "claude" | "gemini" | null; model: string | null } {
  if ((process.env.AI_PROVIDER || "").toLowerCase() === "off") return { on: false, provider: null, model: null };
  if (process.env.ANTHROPIC_API_KEY && (process.env.AI_PROVIDER || "claude").toLowerCase() !== "gemini")
    return { on: true, provider: "claude", model: process.env.AI_MODEL || CLAUDE_DEFAULT };
  if (process.env.GEMINI_API_KEY) return { on: true, provider: "gemini", model: process.env.AI_GEMINI_MODEL || GEMINI_DEFAULT };
  return { on: false, provider: null, model: null };
}

export class AiOffError extends Error {
  constructor() {
    super("AI is not switched on — add ANTHROPIC_API_KEY (or GEMINI_API_KEY) in the server settings · اے آئی کی چابی سرور میں لگائیں");
  }
}

async function callClaude(model: string, system: string, prompt: string, files: Attachment[], maxTokens: number): Promise<string> {
  const content: any[] = [];
  for (const f of files) {
    if (f.mime === "application/pdf") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data.toString("base64") } });
    else if (/^image\/(png|jpeg|gif|webp)$/.test(f.mime)) content.push({ type: "image", source: { type: "base64", media_type: f.mime, data: f.data.toString("base64") } });
  }
  content.push({ type: "text", text: prompt });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": String(process.env.ANTHROPIC_API_KEY), "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content }] }),
    signal: AbortSignal.timeout(170_000),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Claude ${res.status}: ${json?.error?.message || res.statusText}`);
  return (json.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
}

let gemini: GoogleGenAI | null = null;
async function callGemini(model: string, system: string, prompt: string, files: Attachment[], json: boolean): Promise<string> {
  gemini ||= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const parts: any[] = files.map((f) => ({ inlineData: { mimeType: f.mime, data: f.data.toString("base64") } }));
  parts.push({ text: prompt });
  const r = await gemini.models.generateContent({
    model,
    contents: [{ role: "user", parts }],
    config: { systemInstruction: system, ...(json ? { responseMimeType: "application/json" } : {}) },
  });
  return r.text || "";
}

/** One request to the model; returns its text. Recorded in ai_runs. */
export async function aiText(opts: { feature: string; system: string; prompt: string; files?: Attachment[]; json?: boolean; maxTokens?: number; userId?: number }): Promise<string> {
  const st = aiStatus();
  if (!st.on) throw new AiOffError();
  const started = Date.now();
  const files = opts.files || [];
  let out = "";
  let error: string | null = null;
  try {
    out =
      st.provider === "claude"
        ? await callClaude(st.model!, opts.system, opts.prompt, files, opts.maxTokens || 8000)
        : await callGemini(st.model!, opts.system, opts.prompt, files, !!opts.json);
    return out;
  } catch (e: any) {
    error = String(e?.message || e).slice(0, 500);
    throw new Error(`The AI could not answer (${error})`);
  } finally {
    await db
      .insert(schema.aiRuns)
      .values({
        feature: opts.feature,
        provider: st.provider,
        model: st.model,
        ok: !error,
        error,
        inputChars: opts.prompt.length + opts.system.length + files.reduce((s, f) => s + f.data.length, 0),
        outputChars: out.length,
        ms: Date.now() - started,
        createdBy: opts.userId,
      })
      .catch(() => {});
  }
}

/** The first JSON value in a model's reply (handles ```json fences and words around it). */
export function parseJsonLoose(text: string): any {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(t);
  } catch {}
  const start = t.search(/[[{]/);
  if (start < 0) throw new Error("The AI's answer had no data in it");
  const open = t[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return JSON.parse(t.slice(start, i + 1));
  }
  throw new Error("The AI's answer was cut off");
}

export async function aiJson(opts: Parameters<typeof aiText>[0]): Promise<any> {
  return parseJsonLoose(await aiText({ ...opts, json: true }));
}
