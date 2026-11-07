/**
 * What the AI Accountant knows about HFK, and the plain-rules reader.
 *
 *   loadDirectory()      trucks (one per plate), parties, the books' dates — for prompts and matching
 *   matchTruck / matchParty   the system — not the model — decides which truck / party a line means
 *   readByRules(text)    understands simple typed / spoken lines without any AI:
 *                        "TLE-730 driver ko diesel 25 hazar diye", "Haji Akbar se 2 lakh online mile kal"
 *   shapeDraft(row)      turns one read line into a draft: target, trip, duplicates, warnings
 */
import { sql } from "drizzle-orm";
import { db } from "../../src/db/index.ts";
import { normPlate, tripSpansForTruck, spanOf } from "../trip_close.ts";

const rows = async (q: any) => ((await db.execute(q)) as any).rows as any[];

export const MONEY_KINDS = ["cash", "diesel", "toll", "khurak", "labour", "repair", "tyre", "permit", "other"] as const;
export const KIND_CATEGORY: Record<string, string> = {
  cash: "TripCash", diesel: "Diesel", toll: "Toll", khurak: "Khurak", labour: "Labour", repair: "Garage", tyre: "Tyre", permit: "Permit", other: "Other",
};
/** Truck-khata categories a person (or the AI) may choose; each has a posting rule in the books. */
export const TRUCK_CATEGORIES = [
  "Freight", "Diesel", "Toll", "Tyre", "Battery", "MobilOil", "Garage", "PartsBill", "Khurak", "Labour", "TripCash",
  "Salary", "Permit", "Carnet", "Visa", "Insurance", "TomanFX", "Capital", "OnlineTransfer", "Other",
] as const;
export const METHODS = ["Cash", "Bank", "Online", "Cheque"] as const;

export type Directory = {
  trucks: Array<{ id: number; plate: string; registration: string }>;
  parties: Array<{ id: number; name: string; norm: string }>;
  booksStart: string;
  lockedThrough: string | null;
  today: string;
};

const normName = (s: string) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\b(haji|hajji|mr|mian|sahib|sahab|saab|bhai|seth|sb)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Today in Pakistan time, YYYY-MM-DD. */
export const todayPk = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

export async function loadDirectory(): Promise<Directory> {
  const [veh, par, st] = await Promise.all([
    rows(sql`select id, vehicle_number from vehicles where not is_deleted order by id`),
    rows(sql`select id, name from parties where not is_deleted order by id`),
    rows(sql`select to_char(books_start, 'YYYY-MM-DD') s, to_char(locked_through, 'YYYY-MM-DD') l from books_settings where id = 1`).catch(() => []),
  ]);
  const seen = new Set<string>();
  const trucks: Directory["trucks"] = [];
  for (const v of veh) {
    const plate = normPlate(v.vehicle_number);
    if (!plate || seen.has(plate)) continue;
    seen.add(plate);
    trucks.push({ id: v.id, plate, registration: v.vehicle_number });
  }
  const seenP = new Set<string>();
  const parties: Directory["parties"] = [];
  for (const p of par) {
    const k = String(p.name || "").trim().toLowerCase().replace(/\s+/g, " ");
    if (!k || seenP.has(k)) continue;
    seenP.add(k);
    parties.push({ id: p.id, name: p.name, norm: normName(p.name) });
  }
  return { trucks, parties, booksStart: st[0]?.s || "2025-07-01", lockedThrough: st[0]?.l || null, today: todayPk() };
}

// ------------------------------------------------------------------ matching
const PLATE_RE = /\b([A-Za-z]{1,4})[\s\-.]{0,2}(\d{2,5})\b/g;

/** Every truck whose plate is written in the text. */
export function trucksInText(dir: Directory, text: string) {
  const byPlate = new Map(dir.trucks.map((t) => [t.plate, t]));
  const found: Directory["trucks"] = [];
  for (const m of String(text || "").matchAll(PLATE_RE)) {
    const t = byPlate.get(normPlate(m[1] + m[2]));
    if (t && !found.includes(t)) found.push(t);
  }
  return found;
}

export function matchTruck(dir: Directory, plateOrText: string | null | undefined) {
  if (!plateOrText) return null;
  const exact = dir.trucks.find((t) => t.plate === normPlate(plateOrText));
  return exact || trucksInText(dir, plateOrText)[0] || null;
}

/** The party a name means: exact name first, then the one name that contains / is contained in it. */
export function matchParty(dir: Directory, name: string | null | undefined): { party: Directory["parties"][number] | null; sure: boolean; others: string[] } {
  const k = normName(name || "");
  if (k.length < 3) return { party: null, sure: false, others: [] };
  const exact = dir.parties.filter((p) => p.norm === k);
  if (exact.length === 1) return { party: exact[0], sure: true, others: [] };
  const near = dir.parties.filter((p) => p.norm.length >= 3 && (p.norm.includes(k) || k.includes(p.norm)));
  if (near.length === 1) return { party: near[0], sure: false, others: [] };
  if (near.length > 1) {
    near.sort((a, b) => Math.abs(a.norm.length - k.length) - Math.abs(b.norm.length - k.length));
    return { party: near[0], sure: false, others: near.slice(1, 4).map((p) => p.name) };
  }
  return { party: null, sure: false, others: [] };
}

/** A party named anywhere in a sentence (longest name wins). */
export function partyInText(dir: Directory, text: string) {
  const k = ` ${normName(text)} `;
  const hits = dir.parties.filter((p) => p.norm.length >= 4 && k.includes(` ${p.norm} `)).sort((a, b) => b.norm.length - a.norm.length);
  return hits[0] || null;
}

// ------------------------------------------------------------------ plain-rules reader
const KIND_WORDS: Array<[string, RegExp]> = [
  ["diesel", /\b(diesel|disel|deisel|dsl|hsd|tel)\b|ڈیزل|تیل/i],
  ["toll", /\b(toll|tol|motorway)\b|ٹول/i],
  ["khurak", /\b(khurak|khoraak|khana|food|roti)\b|خوراک|کھانا/i],
  ["labour", /\b(mazdoori|mazdori|labour|labor|loading|unloading|palledari)\b|مزدوری/i],
  ["repair", /\b(repair|mistri|mechanic|workshop|garage|welding|puncture)\b|مرمت|مستری/i],
  ["tyre", /\b(tyre|tyres|tire|tires)\b|ٹائر/i],
  ["permit", /\b(permit|border|custom|customs)\b|پرمٹ|بارڈر/i],
  ["cash", /\b(kharcha|kharch|advance|pocket|driver ko)\b|خرچہ|ایڈوانس/i],
];
const IN_WORDS = /\b(mila|mile|mili|milay|received|receive|recd|wusool|wasool|wusul|jama|aya|aaya|aye|aaye|kiraya|kiraa|freight)\b|ملے|ملا|وصول|جمع|آیا|کرایہ/i;
const OUT_WORDS = /\b(diye|diya|diyay|di|dey|de|paid|pay|bheje|bheja|kharcha|kharch|lagaya|lage|lagay|kharida|bought)\b|دیے|دیا|ادا|خرچ/i;
const PERSONAL_WORDS = /\b(ghar|personal|shakhsi|zaati|household)\b|گھر|شخصی|ذاتی/i;

/** "25 hazar" → 25000, "1.5 lakh" → 150000, "25,000" → 25000, "25k" → 25000. */
export function amountIn(text: string): number {
  const t = String(text || "").replace(/(\d),(?=\d{2,3}\b)/g, "$1");
  let best = 0;
  let year = 0;
  for (const a of t.matchAll(/(\d+(?:\.\d+)?)\s*(lakhs|lakh|lac|لاکھ|hazaar|hazar|hzr|hajar|ہزار|k\b|crore|کروڑ)?/gi)) {
    const num = Number(a[1]);
    const unit = (a[2] || "").toLowerCase();
    const v = /lakh|lac|لاکھ/.test(unit) ? num * 100_000 : /hazar|hazaar|hzr|hajar|ہزار|^k$/.test(unit) ? num * 1000 : /crore|کروڑ/.test(unit) ? num * 10_000_000 : num;
    // a bare number under 100 is a day, a count or part of a plate, not money
    if (!unit && num < 100) continue;
    // "2026" may be a year — only taken as money when nothing else in the line is
    if (!unit && /^20[1-3]\d$/.test(a[1])) {
      year = num;
      continue;
    }
    best = Math.max(best, Math.round(v));
  }
  return best || year;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** "aaj", "kal", "parson", "3-10-2026", "3/10", "3 oct" → YYYY-MM-DD (null if no date is written). */
export function dateIn(text: string, today: string): string | null {
  const t = String(text || "").toLowerCase();
  const shift = (days: number) => new Date(new Date(`${today}T12:00:00Z`).getTime() - days * 86400_000).toISOString().slice(0, 10);
  if (/\b(aaj|aj|today)\b|آج/.test(t)) return today;
  if (/\b(parson|parso)\b|پرسوں/.test(t)) return shift(2);
  if (/\b(kal|kl|yesterday)\b|کل/.test(t)) return shift(1);
  const y0 = Number(today.slice(0, 4));
  // 03/10, 03-10-2026, 03.10.2026 — but "3.5 lakh" is money, so a dot needs the year
  let m = t.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/) || t.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = m[3] ? Number(m[3]) : y0;
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  m = t.match(/\b(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s*(\d{4}))?/);
  if (m) return `${m[3] || y0}-${String(MONTHS[m[2]]).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
  return null;
}

export type ReadRow = {
  date: string | null;
  direction: "In" | "Out" | null;
  amount: number;
  method: string | null;
  plate: string | null;
  party: string | null;
  kind: string | null;
  category: string | null;
  person: string | null;
  personal?: boolean;
  description: string;
  sourceText: string;
  confidence: "high" | "medium" | "low";
  notes: string[];
};

export function readByRules(dir: Directory, text: string): ReadRow[] {
  const parts = String(text || "")
    .split(/\r?\n|[؛;]|\.\s+(?=[A-Za-z؀-ۿ])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
  const out: ReadRow[] = [];
  for (const s of parts) {
    // a plate's digits are not money: take known plates out before reading the amount
    const plates = new Set(dir.trucks.map((t) => t.plate));
    const amount = amountIn(s.replace(PLATE_RE, (m0, a1, a2) => (plates.has(normPlate(a1 + a2)) ? " " : m0)));
    if (!amount) continue;
    const truck = trucksInText(dir, s)[0] || null;
    const party = partyInText(dir, s);
    const kind = KIND_WORDS.find(([, re]) => re.test(s))?.[0] || null;
    const isIn = IN_WORDS.test(s);
    const isOut = OUT_WORDS.test(s);
    const direction = isIn && !isOut ? "In" : isOut && !isIn ? "Out" : kind ? "Out" : null;
    const method = /\b(online|onlian|ibft|easypaisa|easy paisa|jazzcash|jazz cash|raast)\b|آن لائن/i.test(s)
      ? "Online"
      : /\b(cheque|check|chq)\b|چیک/i.test(s)
        ? "Cheque"
        : /\b(bank|deposit|meezan|hbl|mcb|ubl|alfalah|askari|faysal|soneri|allied|abl)\b|بینک/i.test(s)
          ? "Bank"
          : "Cash";
    const notes: string[] = [];
    if (!direction) notes.push("Money in or out? · آیا یا گیا؟");
    const date = dateIn(s, dir.today);
    out.push({
      date: date || dir.today,
      direction,
      amount,
      method,
      plate: truck?.registration || null,
      party: party?.name || null,
      kind: direction === "Out" && truck ? kind : null,
      category: direction === "In" && truck && /kiraya|kiraa|freight|کرایہ|bilty/i.test(s) ? "Freight" : kind && truck ? KIND_CATEGORY[kind] : null,
      person: null,
      personal: PERSONAL_WORDS.test(s),
      description: s.slice(0, 200),
      sourceText: s,
      confidence: direction && (truck || party) ? "medium" : "low",
      notes: date ? notes : [...notes, "No date written — today's date used · تاریخ نہیں لکھی، آج کی لگائی"],
    });
  }
  return out;
}

// ------------------------------------------------------------------ one read line → a draft
export type DraftShape = {
  target: "cash" | "truck" | "party" | "trip" | null;
  entryDate: string | null;
  direction: "In" | "Out" | null;
  amount: number;
  method: string | null;
  vehicleId: number | null;
  tripId: number | null;
  partyId: number | null;
  kind: string | null;
  category: string | null;
  person: string | null;
  description: string | null;
  sourceText: string | null;
  confidence: string;
  notes: string[];
  duplicate: any;
};

export async function shapeDraft(dir: Directory, r: ReadRow): Promise<DraftShape> {
  const notes = [...(r.notes || [])];
  const truck = matchTruck(dir, r.plate);
  if (r.plate && !truck) notes.push(`Truck "${r.plate}" is not in the fleet list · یہ ٹرک فہرست میں نہیں`);
  let partyId: number | null = null;
  if (r.party) {
    const m = matchParty(dir, r.party);
    if (m.party) {
      partyId = m.party.id;
      if (!m.sure) notes.push(`Party read as "${r.party}" → matched to "${m.party.name}"${m.others.length ? ` (also could be: ${m.others.join(", ")})` : ""} · پارٹی چیک کریں`);
    } else notes.push(`Party "${r.party}" is not in Parties — pick one or add the party first · یہ پارٹی فہرست میں نہیں`);
  }
  const amount = Math.max(0, Math.round(Number(r.amount) || 0));
  if (!amount) notes.push("No amount · رقم نہیں");
  const date = r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null;
  if (!date) notes.push("No date · تاریخ نہیں");
  else {
    if (date > dir.today) notes.push("Date is in the future · آگے کی تاریخ");
    if (date < dir.booksStart) notes.push(`Before the books start (${dir.booksStart}) · کتاب شروع ہونے سے پہلے`);
    if (dir.lockedThrough && date <= dir.lockedThrough) notes.push(`Month is closed (through ${dir.lockedThrough}) — the books will not take it · مہینہ بند ہے`);
  }
  const method = METHODS.includes(r.method as any) ? r.method : "Cash";
  const kind = r.kind && MONEY_KINDS.includes(r.kind as any) ? r.kind : null;
  const category = r.category && TRUCK_CATEGORIES.includes(r.category as any) ? r.category : kind ? KIND_CATEGORY[kind] : null;

  // where it goes: a truck expense on the truck's current journey → that trip; cash → Cash Book
  // (which also writes the truck / party khata); bank / online → the truck's khata or the party's ledger
  let target: DraftShape["target"] = null;
  let tripId: number | null = null;
  if (truck && r.direction === "Out" && kind && date) {
    const spans = await tripSpansForTruck(truck.id, truck.registration);
    const span = spanOf(spans, { entryDate: `${date}T12:00:00` });
    if (span && !span.untilDay) {
      tripId = span.rootId;
      target = "trip";
    }
  }
  if (!target) target = method === "Cash" ? "cash" : truck ? "truck" : partyId ? "party" : "cash";
  if (target === "cash" && method !== "Cash") notes.push("Paid by bank / online but no truck or party — check where it belongs · کس کھاتے کا ہے؟");

  const draft: DraftShape = {
    target,
    entryDate: date,
    direction: r.direction,
    amount,
    method,
    vehicleId: truck?.id || null,
    tripId,
    partyId: target === "trip" ? null : partyId,
    kind: target === "trip" ? kind : null,
    category,
    person: r.person || null,
    description: (r.description || r.sourceText || "").slice(0, 300) || null,
    sourceText: (r.sourceText || "").slice(0, 1000) || null,
    confidence: ["high", "medium", "low"].includes(r.confidence) ? r.confidence : "low",
    notes,
    duplicate: null,
  };
  if ((r as any).personal && target === "cash" && !draft.vehicleId && !draft.partyId) (draft as any).personal = true;
  draft.duplicate = await findDuplicate(draft);
  if (draft.duplicate) draft.notes.push(`Looks already entered: ${draft.duplicate.where} #${draft.duplicate.id} (${draft.duplicate.date}, PKR ${Number(draft.duplicate.amount).toLocaleString()}) · شاید پہلے سے درج ہے`);
  return draft;
}

/** The same money already in the books: same amount, ±1 day, same truck / party (or same cash direction). */
export async function findDuplicate(d: Pick<DraftShape, "entryDate" | "amount" | "vehicleId" | "partyId" | "direction" | "target">) {
  if (!d.amount || !d.entryDate) return null;
  const day = d.entryDate;
  if (d.vehicleId) {
    const [hit] = await rows(sql`select e.id, to_char(e.entry_date, 'YYYY-MM-DD') date, greatest(e.received, e.paid) amount, e.description
      from truck_ledger_entries e join truck_ledgers l on l.id = e.ledger_id
      join vehicles v on regexp_replace(upper(v.vehicle_number), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(l.registration), '[^A-Z0-9]', '', 'g')
      where v.id = ${d.vehicleId} and not e.is_deleted and not l.is_deleted
        and e.entry_date::date between ${day}::date - 1 and ${day}::date + 1
        and ${d.direction === "In" ? sql`e.received = ${d.amount}` : sql`e.paid = ${d.amount}`}
      order by abs(e.entry_date::date - ${day}::date), e.id limit 1`);
    if (hit) return { where: "truck khata", table: "truck_ledger_entries", ...hit };
  }
  if (d.partyId) {
    const [hit] = await rows(sql`select id, to_char(entry_date, 'YYYY-MM-DD') date, greatest(debit, credit) amount, description from party_ledger_entries
      where party_id = ${d.partyId} and not is_deleted and entry_date::date between ${day}::date - 1 and ${day}::date + 1
        and ${d.direction === "In" ? sql`credit = ${d.amount}` : sql`debit = ${d.amount}`} order by id limit 1`);
    if (hit) return { where: "party ledger", table: "party_ledger_entries", ...hit };
  }
  if (!d.vehicleId && !d.partyId && d.target === "cash") {
    const [hit] = await rows(sql`select id, to_char(entry_date, 'YYYY-MM-DD') date, amount, description from cash_transactions
      where not is_deleted and amount = ${d.amount} and direction = ${d.direction || "Out"} and entry_date::date between ${day}::date - 1 and ${day}::date + 1 order by id limit 1`);
    if (hit) return { where: "cash book", table: "cash_transactions", ...hit };
  }
  return null;
}
