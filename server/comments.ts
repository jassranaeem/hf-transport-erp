/**
 * Comments · تبصرے — a note on any record (a khata row, an invoice, a trip, a party…), with
 * @name to ask someone; the person named gets a notification.
 *
 *   GET    /api/comments?entityType=&entityId=
 *   POST   /api/comments          { entityType, entityId, body }
 *   DELETE /api/comments/:id      your own (or an admin)
 *   GET    /api/comments/people   who can be @named
 */
import { Router, Response } from "express";
import { sql } from "drizzle-orm";
import { requireAuth, requireApproved, AuthRequest } from "../src/middleware/auth.ts";
import { db } from "../src/db/index.ts";

const router = Router();
router.use(requireAuth, requireApproved);
const rows = async (q: any) => ((await db.execute(q)) as any).rows as any[];
const TYPE_RE = /^[a-z_]{2,40}$/;

router.get("/people", async (_req, res: Response) => {
  try {
    res.json({ people: await rows(sql`select id, name, role from users where coalesce(status, 'approved') <> 'rejected' and name is not null order by name`) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const t = String(req.query.entityType || "");
    const id = parseInt(String(req.query.entityId || ""));
    if (!TYPE_RE.test(t) || !id) return res.status(400).json({ error: "entityType and entityId are required" });
    const list = await rows(sql`select c.id, c.body, c.mentions, c.created_at, c.created_by, u.name author
      from record_comments c left join users u on u.id = c.created_by
      where c.entity_type = ${t} and c.entity_id = ${id} and not c.is_deleted order by c.created_at`);
    res.json({ comments: list });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/", async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body || {};
    const t = String(b.entityType || "");
    const id = parseInt(b.entityId);
    const body = String(b.body || "").trim().slice(0, 2000);
    if (!TYPE_RE.test(t) || !id) return res.status(400).json({ error: "entityType and entityId are required" });
    if (!body) return res.status(400).json({ error: "Write something · کچھ لکھیں" });
    // @Name → the users with that name (longest names first, so "@Ali Khan" beats "@Ali")
    const people = await rows(sql`select id, name from users where name is not null`);
    const mentioned = new Set<number>();
    const lower = body.toLowerCase();
    for (const p of [...people].sort((a, b) => String(b.name).length - String(a.name).length)) {
      if (lower.includes("@" + String(p.name).toLowerCase())) mentioned.add(p.id);
    }
    const arr = `{${[...mentioned].join(",")}}`;
    const [c] = await rows(sql`insert into record_comments (entity_type, entity_id, body, mentions, created_by)
      values (${t}, ${id}, ${body}, ${arr}::int[], ${req.user?.id ?? null}) returning *`);
    for (const uid of mentioned) {
      if (uid === req.user?.id) continue;
      await db
        .execute(sql`insert into notifications (user_id, type, title, message, channel, created_by)
          values (${uid}, 'Mention', ${`${req.user?.name || "Someone"} mentioned you`}, ${`${body.slice(0, 300)} — on ${t.replace(/_/g, " ")} #${id}`}, 'in-app', ${req.user?.id ?? null})`)
        .catch(() => {});
    }
    res.json({ ...c, author: req.user?.name || null });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:id(\\d+)", async (req: AuthRequest, res: Response) => {
  try {
    const admin = ["Super Admin", "Admin"].includes(req.user?.role || "");
    const [c] = await rows(sql`update record_comments set is_deleted = true where id = ${parseInt(req.params.id)}
      and (${admin} or created_by = ${req.user?.id ?? 0}) returning id`);
    if (!c) return res.status(404).json({ error: "Not found, or not yours" });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
