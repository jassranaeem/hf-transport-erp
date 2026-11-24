/**
 * Importing a truck's sheet INTO the khata that truck already has, instead of making a new
 * khata per sheet (or per table of a PDF-converted file — "TLE 730" came out as four).
 *
 *   - a row the khata already has (same date + amounts + words, or same amounts + words, or
 *     same date + amounts) is an ANCHOR and is not added again;
 *   - a new row is placed where it sits on the paper: after the anchor written above it, or
 *     before the first anchor when it comes from older pages — via sort_key, so no existing
 *     row is renumbered (attachments, Cash Book links and partnership cycles keep working);
 *   - a new row on a paper page the khata already has takes that page's label, so it carries
 *     on that page's balance; pages the khata doesn't have keep their own (prefixed) label.
 *
 * Nothing already in the khata is changed or removed.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";
import type { ParsedLedger } from "./truck-workbook.ts";

type ParsedEntry = ParsedLedger["entries"][number];

export const normPlate = (s: string | null | undefined) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
// sub-khatas made by the Daily-work cash-book and trip-log importers are views of other books
const DERIVED_TITLE = /\((cash book|trip log) from/i;

/** Every khata of this truck, main-candidate first: its partnership khata, then the biggest. */
export async function khataCandidates(plate: string) {
  const p = normPlate(plate);
  if (!p) return [];
  const rows = await db
    .select({
      id: schema.truckLedgers.id,
      title: schema.truckLedgers.title,
      sourceSheet: schema.truckLedgers.sourceSheet,
      entries: sql<number>`(select count(*)::int from truck_ledger_entries e where e.ledger_id = "truck_ledgers"."id" and not e.is_deleted)`,
      partnership: sql<boolean>`exists (select 1 from partnership_accounts a where a.truck_ledger_id = "truck_ledgers"."id" and not a.is_deleted)`,
    })
    .from(schema.truckLedgers)
    .where(and(eq(schema.truckLedgers.isDeleted, false), sql`regexp_replace(upper(${schema.truckLedgers.registration}), '[^A-Z0-9]', '', 'g') = ${p}`));
  return rows
    .map((r) => ({ ...r, derived: DERIVED_TITLE.test(r.title || "") }))
    .sort((a, b) => Number(b.partnership) - Number(a.partnership) || Number(a.derived) - Number(b.derived) || b.entries - a.entries);
}

/** The khata a new sheet of this truck should join, or null when the truck has none yet. */
export async function mainKhataForPlate(plate: string) {
  const c = (await khataCandidates(plate)).filter((k) => !k.derived || k.partnership);
  return c[0] ?? null;
}

const words = (s: string | null | undefined) => String(s || "").toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, "");
const day = (d: Date | string | null | undefined) => {
  if (!d) return "";
  const x = new Date(d as any);
  return isNaN(x.getTime()) ? "" : x.toISOString().slice(0, 10);
};

export interface MergePlan {
  targetId: number;
  already: number; // rows the khata already has
  add: Array<{ e: ParsedEntry; sortKey: number | null; sectionLabel: string }>;
  // rows NOT added because the file itself reads them wrong (the same amount in both columns,
  // or a balance that doesn't agree with the paper) — a badly converted file must never put
  // garbage into a real khata; listed so the user can see them
  unclear: ParsedEntry[];
  notes: number; // rows without money (notes / headers) — the khata's own copy is enough
}

/** Work out, without writing anything, what joining sheet L into khata targetId would do. */
export async function planMerge(targetId: number, L: ParsedLedger): Promise<MergePlan> {
  const existing = await db
    .select({
      id: schema.truckLedgerEntries.id,
      sortKey: schema.truckLedgerEntries.sortKey,
      entryDate: schema.truckLedgerEntries.entryDate,
      received: schema.truckLedgerEntries.received,
      paid: schema.truckLedgerEntries.paid,
      description: schema.truckLedgerEntries.description,
      sectionLabel: schema.truckLedgerEntries.sectionLabel,
    })
    .from(schema.truckLedgerEntries)
    .where(and(eq(schema.truckLedgerEntries.ledgerId, targetId), eq(schema.truckLedgerEntries.isDeleted, false)))
    .orderBy(asc(sql`coalesce(${schema.truckLedgerEntries.sortKey}, ${schema.truckLedgerEntries.id})`));
  const K = existing.map((r) => r.sortKey ?? r.id);

  // fingerprints of the khata's rows, strongest first; each existing row can anchor only once
  const maps = [new Map<string, number[]>(), new Map<string, number[]>(), new Map<string, number[]>()];
  const fps = (d: any, rec: number, paid: number, desc: string | null | undefined): (string | null)[] => {
    const w = words(desc);
    const money = rec !== 0 || paid !== 0;
    return [
      money || w ? `${day(d)}|${rec}|${paid}|${w}` : null, // same date, amounts, words
      money && w ? `${rec}|${paid}|${w}` : null, // same amounts + words (date read differently)
      money ? `${day(d)}|${rec}|${paid}` : null, // same date + amounts (words typed differently)
    ];
  };
  existing.forEach((r, i) => {
    fps(r.entryDate, r.received || 0, r.paid || 0, r.description).forEach((k, lvl) => {
      if (k) maps[lvl].set(k, [...(maps[lvl].get(k) || []), i]);
    });
  });
  const used = new Set<number>();
  const take = (keys: (string | null)[]) => {
    for (let lvl = 0; lvl < 3; lvl++) {
      const k = keys[lvl];
      if (!k) continue;
      const i = (maps[lvl].get(k) || []).find((x) => !used.has(x));
      if (i != null) {
        used.add(i);
        return i;
      }
    }
    return -1;
  };

  // walk the sheet in its own order: anchors and the new rows between them
  type Item = { e: ParsedEntry; anchor: number };
  const items: Item[] = [];
  const unclear: ParsedEntry[] = [];
  let notes = 0;
  for (const e of L.entries) {
    const rec = e.received || 0;
    const paid = e.paid || 0;
    const marker = !!(e.isReset || e.isSafiBachat);
    if (rec === 0 && paid === 0 && !marker) {
      notes++;
      continue; // a note / header / blank line: nothing to add to the khata's money
    }
    // read wrong by the file: one amount in both columns (match it on either side), or a balance
    // that disagrees with the paper
    const both = rec > 0 && paid > 0;
    let anchor = both
      ? (() => {
          const a = take(fps(e.entryDate, rec, 0, e.description));
          return a >= 0 ? a : take(fps(e.entryDate, 0, paid, e.description));
        })()
      : take(fps(e.entryDate, rec, paid, e.description));
    const misread = both || /running balance .* != sheet/i.test(e.reviewReason || "");
    if (anchor < 0 && misread) {
      unclear.push(e);
      continue;
    }
    items.push({ e, anchor });
  }

  // a paper page the khata already has (it holds an anchor) keeps that page's label
  const pageLabel = new Map<string, string>();
  for (const it of items) {
    const s = it.e.sectionLabel || "";
    if (it.anchor >= 0 && !pageLabel.has(s)) pageLabel.set(s, existing[it.anchor].sectionLabel || s);
  }
  const labelFor = (e: ParsedEntry) => pageLabel.get(e.sectionLabel || "") ?? `${L.sourceSheet} · ${e.sectionLabel || "Page"}`;

  // placement window (lo, hi) for each new row; null hi = after everything (plain id order)
  const firstAnchor = items.findIndex((it) => it.anchor >= 0);
  // a sheet sharing no row with the khata goes where its dates fit best: the split point in the
  // khata with the most earlier-dated rows before it and later-dated rows after it (rows with a
  // typo'd date only nudge the score, they can't drag the whole sheet)
  const t = (d: any) => (d ? new Date(d).getTime() : NaN);
  const sheetDates = items.map((it) => t(it.e.entryDate)).filter((x) => !isNaN(x)).sort((a, b) => a - b);
  let split = K.length - 1; // default: after everything
  if (sheetDates.length) {
    const ref = sheetDates[Math.floor(sheetDates.length / 2)];
    let score = 0;
    let best = 0;
    split = -1;
    existing.forEach((r, i) => {
      const d = t(r.entryDate);
      if (!isNaN(d)) score += d <= ref ? 1 : -1;
      if (score > best) {
        best = score;
        split = i;
      }
    });
  }

  const groups: { lo: number; hi: number | null; rows: ParsedEntry[] }[] = [];
  let prevAnchor = -1;
  items.forEach((it, idx) => {
    if (it.anchor >= 0) {
      prevAnchor = it.anchor;
      return;
    }
    let lo: number;
    let hi: number | null;
    if (prevAnchor >= 0) {
      lo = K[prevAnchor];
      hi = prevAnchor + 1 < K.length ? K[prevAnchor + 1] : null;
    } else if (firstAnchor >= 0) {
      const f = items[firstAnchor].anchor;
      hi = K[f];
      lo = f > 0 ? K[f - 1] : K[f] - 1;
    } else if (K.length && split < K.length - 1) {
      lo = split >= 0 ? K[split] : K[0] - 1;
      hi = K[split + 1];
    } else {
      lo = Infinity;
      hi = null;
    }
    const g = groups[groups.length - 1];
    if (g && g.lo === lo && g.hi === hi && idx > 0 && items[idx - 1].anchor < 0) g.rows.push(it.e);
    else groups.push({ lo, hi, rows: [it.e] });
  });

  const add: MergePlan["add"] = [];
  for (const g of groups) {
    g.rows.forEach((e, j) => {
      const sortKey = g.hi == null ? null : g.lo + ((g.hi - g.lo) * (j + 1)) / (g.rows.length + 1);
      add.push({ e, sortKey, sectionLabel: labelFor(e) });
    });
  }
  return { targetId, already: items.filter((it) => it.anchor >= 0).length, add, unclear, notes };
}
