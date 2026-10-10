/**
 * Home · ہوم — what needs you today across the company, on one page: cash, who owes / whom we
 * owe, overdue invoices, trucks on the road, things waiting for approval, reminders due, the
 * books' health, low stock. Each card opens its page. "Customize" hides the cards you don't use
 * (remembered on this computer).
 */
import React, { useEffect, useState } from "react";
import {
  Wallet, Users, FileWarning, Truck, ShieldCheck, BellRing, Repeat, Activity, Package, Bot, Settings2, ArrowRight, Search, Loader2,
} from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";
import { Btn } from "../ui/kit.tsx";
import { pkr } from "../../lib/share.ts";

type Nav = (wb: string, sheet: string, focus?: any) => void;
const LS = "hfk_home_hidden_v1";
const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

type Widget = { id: string; title: string; urdu: string; icon: any; wb: string; sheet: string; load: () => Promise<{ value: React.ReactNode; sub?: React.ReactNode; tone?: "good" | "bad" | "warn"; lines?: Array<[string, React.ReactNode]> }> };

const WIDGETS: Widget[] = [
  {
    id: "cash", title: "Cash today", urdu: "آج کی نقد", icon: Wallet, wb: "finance", sheet: "cash_book",
    load: async () => {
      const [d, c] = await Promise.all([enterpriseFetch(`/api/cash-book/day?date=${today()}`), enterpriseFetch(`/api/cash-book/count?date=${today()}`).catch(() => null)]);
      return {
        value: pkr(d.closingBalance),
        tone: d.closingBalance < 0 ? "bad" : undefined,
        lines: [["In today", pkr(d.totalIn)], ["Out today", pkr(d.totalOut)], ["Counted", c?.count ? (c.difference === 0 ? "matches ✓" : `${c.difference < 0 ? "short" : "extra"} ${pkr(c.difference)}`) : "not yet"]],
      };
    },
  },
  {
    id: "parties", title: "Parties — lena / dena", urdu: "لینا دینا", icon: Users, wb: "khata", sheet: "dues",
    load: async () => {
      const s = await enterpriseFetch("/api/parties/summary");
      const t = s.totals || {};
      return { value: pkr(t.totalReceivable), sub: "they owe us · لینا", lines: [["We owe them · دینا", pkr(t.totalPayable)], ["Net", (t.net < 0 ? "−" : "") + pkr(t.net)]] };
    },
  },
  {
    id: "invoices", title: "Invoices owed", urdu: "انوائس باقی", icon: FileWarning, wb: "finance", sheet: "invoices",
    load: async () => {
      const a = await enterpriseFetch("/api/finance/invoices/aging");
      const over = (a.overdue30 || 0) + (a.overdue60 || 0) + (a.overdue90 || 0) + (a.overdue120 || 0) + (a.overdue120Plus || 0);
      return { value: pkr(a.totalAR || 0), tone: over ? "bad" : undefined, lines: [["Not yet due", pkr(a.current || 0)], ["Overdue", pkr(over)], ["Over 90 days", pkr((a.overdue120 || 0) + (a.overdue120Plus || 0) + (a.overdue90 || 0))]] };
    },
  },
  {
    id: "trips", title: "Trucks on the road", urdu: "سڑک پر", icon: Truck, wb: "fleet", sheet: "fleet_desk",
    load: async () => {
      const list = await enterpriseFetch("/api/trip-desk");
      const live = (Array.isArray(list) ? list : []).filter((t: any) => !t.closedAt && t.status !== "Completed" && !t.parentTripId);
      const lost = live.filter((t: any) => t.gps && t.gps.status && /lost|offline/i.test(t.gps.status)).length;
      return { value: live.length, sub: "trips running", tone: lost ? "warn" : undefined, lines: live.slice(0, 3).map((t: any) => [t.vehicleNumber, `${t.origin || ""} → ${t.destination || ""}`]) as any };
    },
  },
  {
    id: "approvals", title: "Waiting for approval", urdu: "منظوری", icon: ShieldCheck, wb: "accounting", sheet: "approvals",
    load: async () => {
      const a = await enterpriseFetch("/api/approvals?status=pending");
      return { value: a.pending, tone: a.pending ? "warn" : "good", sub: a.config?.enabled ? `payments of ${pkr(a.config.threshold)}+` : "rule is off", lines: a.list.slice(0, 3).map((x: any) => [pkr(x.amount), x.summary]) };
    },
  },
  {
    id: "reminders", title: "Payment reminders due", urdu: "یاد دہانی", icon: BellRing, wb: "khata", sheet: "reminders",
    load: async () => {
      const q = await enterpriseFetch("/api/reminders/queue");
      const total = q.items.reduce((s: number, x: any) => s + x.balance, 0);
      return { value: q.items.length, tone: q.items.length ? "warn" : "good", sub: q.items.length ? `${pkr(total)} to collect` : "nobody due", lines: q.items.slice(0, 3).map((x: any) => [x.name, pkr(x.balance)]) };
    },
  },
  {
    id: "recurring", title: "Recurring to approve", urdu: "ہر ماہ کی", icon: Repeat, wb: "accounting", sheet: "recurring",
    load: async () => {
      const r = await enterpriseFetch("/api/recurring");
      return { value: r.pending.length, tone: r.pending.length ? "warn" : "good", sub: `${r.list.filter((x: any) => x.is_active).length} set up`, lines: r.pending.slice(0, 3).map((x: any) => [x.source_name, pkr(x.amount)]) };
    },
  },
  {
    id: "books", title: "Books check", urdu: "حساب صحت", icon: Activity, wb: "accounting", sheet: "books_check",
    load: async () => {
      const r = await enterpriseFetch("/api/books-check/summary");
      return { value: r.red ? `${r.red} to correct` : "All clear ✓", tone: r.red ? "bad" : r.amber ? "warn" : "good", sub: r.amber ? `${r.amber} to look at` : undefined };
    },
  },
  {
    id: "ai", title: "AI drafts to approve", urdu: "اے آئی منشی", icon: Bot, wb: "accounting", sheet: "ai_accountant",
    load: async () => {
      const r = await enterpriseFetch("/api/ai-accountant/status");
      return { value: r.drafts, tone: r.drafts ? "warn" : undefined, sub: r.ai?.on ? `AI on (${r.ai.provider})` : "AI off — rules only" };
    },
  },
  {
    id: "stock", title: "Parts running low", urdu: "اسٹاک کم", icon: Package, wb: "workshop", sheet: "stock",
    load: async () => {
      const r = await enterpriseFetch("/api/stock/items");
      const low = r.items.filter((i: any) => i.reorder_level > 0 && i.on_hand <= i.reorder_level);
      return { value: low.length, tone: low.length ? "warn" : undefined, sub: `stock worth ${pkr(r.totals.value)}`, lines: low.slice(0, 3).map((i: any) => [i.name, `${i.on_hand} ${i.unit}`]) };
    },
  },
];

const TONE: Record<string, string> = { good: "text-[#166534]", bad: "text-[#B91C1C]", warn: "text-[#B45309]" };

function Tile({ w, onOpen }: { w: Widget; onOpen: () => void }) {
  const [s, setS] = useState<any>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    w.load().then(setS).catch(() => setErr(true));
  }, [w]);
  const Icon = w.icon;
  return (
    <button onClick={onOpen} className="group text-left bg-white border border-[#E3E8EF] rounded-xl p-4 shadow-[0_1px_2px_rgba(16,24,40,.04)] hover:border-[#C9D7EC] hover:shadow-md transition flex flex-col gap-2 min-h-[150px]">
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-lg bg-[#EAF0F8] text-[#24539B] flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-[#1F2937] truncate">{w.title}</div>
          <div className="text-[11px] text-[#9CA3AF]" dir="rtl">{w.urdu}</div>
        </div>
        <ArrowRight className="w-4 h-4 text-[#CBD5E1] group-hover:text-[#24539B]" />
      </div>
      {err ? (
        <div className="text-[12px] text-[#9CA3AF]">Not available for your role</div>
      ) : !s ? (
        <Loader2 className="w-4 h-4 animate-spin text-[#CBD5E1]" />
      ) : (
        <>
          <div>
            <div className={`text-[22px] font-semibold tabular-nums leading-tight ${s.tone ? TONE[s.tone] : "text-[#111827]"}`}>{s.value}</div>
            {s.sub && <div className="text-[11.5px] text-[#6B7280]">{s.sub}</div>}
          </div>
          {s.lines?.length > 0 && (
            <div className="mt-auto space-y-0.5 border-t border-[#F1F4F9] pt-2">
              {s.lines.map(([a, b]: [string, React.ReactNode], i: number) => (
                <div key={i} className="flex justify-between gap-2 text-[11.5px]">
                  <span className="text-[#6B7280] truncate" dir="auto">{a}</span>
                  <span className="text-[#374151] tabular-nums truncate text-right" dir="auto">{b}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </button>
  );
}

export default function HomeDashboard({ dbUser, onNavigate }: { dbUser: any; showFeedback: (t: "success" | "error", m: string) => void; onNavigate?: Nav }) {
  const [hidden, setHidden] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(LS) || "[]");
    } catch {
      return [];
    }
  });
  const [customize, setCustomize] = useState(false);
  const save = (h: string[]) => {
    setHidden(h);
    try {
      localStorage.setItem(LS, JSON.stringify(h));
    } catch {
      /* ignore */
    }
  };
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const name = String(dbUser?.name || "").split(" ")[0];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <h1 className="text-[22px] font-semibold text-[#111827]">{greet}{name ? `, ${name}` : ""}</h1>
          <p className="text-[13px] text-[#6B7280]">
            {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · what needs you today · آج کیا دیکھنا ہے
          </p>
        </div>
        <Btn onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))} icon={<Search />}>Search everything</Btn>
        <Btn kind={customize ? "primary" : "secondary"} onClick={() => setCustomize((c) => !c)} icon={<Settings2 />}>{customize ? "Done" : "Customize"}</Btn>
      </div>

      {customize && (
        <div className="rounded-xl border border-[#C9D7EC] bg-[#F7F9FD] p-3 flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
          {WIDGETS.map((w) => (
            <label key={w.id} className="flex items-center gap-1.5">
              <input type="checkbox" checked={!hidden.includes(w.id)} onChange={(e) => save(e.target.checked ? hidden.filter((x) => x !== w.id) : [...hidden, w.id])} />
              {w.title}
            </label>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
        {WIDGETS.filter((w) => !hidden.includes(w.id)).map((w) => (
          <React.Fragment key={w.id}>
            <Tile w={w} onOpen={() => onNavigate?.(w.wb, w.sheet)} />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
