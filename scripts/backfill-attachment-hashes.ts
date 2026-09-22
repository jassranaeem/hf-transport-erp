/**
 * One-time: fill attachments.sha256 for rows uploaded before hashing existed.
 * Safe to re-run — only touches rows where sha256 is null and the file exists.
 *
 *   npx tsx scripts/backfill-attachment-hashes.ts
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { assertCoreEnv } from "../src/config/env.ts";

assertCoreEnv();

const { db } = await import("../src/db/index.ts");
const schema = await import("../src/db/schema.ts");
const { isNull, eq } = await import("drizzle-orm");

const UPLOADS_DIR = path.resolve(process.cwd(), process.env.UPLOADS_DIR || "uploads");

const rows = await db.select().from(schema.attachments).where(isNull(schema.attachments.sha256));
console.log(`[backfill] ${rows.length} attachment(s) without a hash`);

let done = 0;
let missing = 0;
for (const r of rows) {
  const abs = path.join(UPLOADS_DIR, r.diskPath);
  if (!fs.existsSync(abs)) {
    missing++;
    continue;
  }
  const sha = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
  await db.update(schema.attachments).set({ sha256: sha }).where(eq(schema.attachments.id, r.id));
  done++;
}
console.log(`[backfill] hashed ${done}, ${missing} file(s) missing on disk`);
process.exit(0);
