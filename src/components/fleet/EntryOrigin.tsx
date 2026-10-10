/**
 * The whole of one ledger entry, opened by clicking its row: where it came from (with a button that
 * goes there — the trip, the cash book day, the AI Accountant, Partner P&L), every field, what it is
 * tied to (cash paid out of / spent from it), and who made and changed it.
 *
 *   GET /api/entry-origin/:kind/:id    (server/entry_origin.ts)
 */
import Comments from "../business/Comments.tsx";
import React, { useEffect, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import { ExternalLink, Loader2, Truck, Wallet, Bot, Handshake, FileSpreadsheet, PenLine, Landmark } from "lucide-react";

type Nav = (wb: string, sheet: string, focus?: any) => void;
const dmy = (d: any) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");
const when = (d: any) => (d ? new Date(d).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "");
const money = (n: any) => (n ? Number(n).toLocaleString() : "");

const ICON: Record<string, any> = { trip: Truck, cash_book: Wallet, ai: Bot, partnership: Handshake, profit_share: Handshake, import: FileSpreadsheet, manual: PenLine, opening: Landmark };

export default function EntryOrigin({ kind, id, onNavigate }: { kind: "tle" | "ple"; id: number; onNavigate?: Nav }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setD(null);
    setErr(null);
    enterpriseFetch(`/api/entry-origin/${kind}/${id}`).then(setD).catch((e) => setErr(e.message));
  }, [kind, id]);

  if (err) return <div className="text-[11px] text-red-600 mb-2">{err}</div>;
  if (!d) return <div className="text-[11px] text-slate-400 mb-2 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>;

  const e = d.entry;
  const origin = (o: any, main?: boolean, key?: number) => {
    const Icon = ICON[o.kind] || PenLine;
    return (
      <div key={key} className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${main ? "border-[#C9D7EC] bg-[#F2F5FA]" : "border-slate-200 bg-white"}`}>
        <Icon className="w-4 h-4 mt-0.5 text-[#24539B] shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">{main ? "Made in · کہاں سے بنی" : "Also linked to"}</div>
          <div className="text-[13px] font-semibold text-slate-800">{o.title}</div>
          {o.detail && <div className="text-[11px] text-slate-600" dir="auto">{o.detail}</div>}
        </div>
        {o.link && onNavigate && (
          <button
            onClick={() => onNavigate(o.link.wb, o.link.sheet, o.link.focus)}
            className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold rounded-lg bg-[#24539B] text-white px-3 py-1.5 hover:bg-[#1E4480]"
          >
            Open · کھولیں <ExternalLink className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  };

  const fields: Array<[string, any]> = [
    ["Date · تاریخ", e.date ? dmy(e.date) : e.rawDate || "—"],
    [kind === "tle" ? "Truck khata" : "Party", e.ledger],
    ["Category", e.category],
    ["Method", e.method],
    ...(kind === "tle"
      ? ([["Received · آیا", money(e.received)], ["Paid · گیا", money(e.paid)]] as Array<[string, any]>)
      : ([["Debit · نام", money(e.debit)], ["Credit · جمع", money(e.credit)]] as Array<[string, any]>)),
    ["Ref no.", e.refNo],
    ["From", e.partyFrom],
    ["To", e.partyTo],
    ["Route", e.route],
    ["Cargo", e.cargo],
    ["Section / page", e.section],
    ["Sr#", e.srNo],
    ["Paper balance", e.sheetBalance != null ? money(e.sheetBalance) || "0" : null],
    ["Entered", `${when(e.createdAt)}${e.createdBy ? ` · ${e.createdBy}` : ""}`],
    ["Entry no.", `#${e.id}`],
  ];

  return (
    <div className="space-y-2 mb-3">
      {origin(d.origin, true)}
      {d.alsoFrom?.map((o: any, i: number) => origin(o, false, i))}

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="text-[13px] font-semibold text-slate-800 mb-2" dir="auto">{e.description || "—"}</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1.5">
          {fields
            .filter(([, v]) => v != null && v !== "")
            .map(([k, v]) => (
              <div key={k}>
                <div className="text-[10px] text-slate-400">{k}</div>
                <div className="text-xs text-slate-800 break-words" dir="auto">{v}</div>
              </div>
            ))}
        </div>
      </div>

      {d.related?.map((r: any, i: number) => (
        <div key={i} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px]">
          <span className="font-semibold text-slate-700">{r.title}:</span> <span className="text-slate-600" dir="auto">{r.detail}</span>
        </div>
      ))}

      {d.history?.length > 0 && (
        <details className="rounded-lg border border-slate-200 bg-white">
          <summary className="cursor-pointer px-3 py-1.5 text-[11px] font-semibold text-slate-600">History · تاریخچہ ({d.history.length})</summary>
          <div className="px-3 pb-2 space-y-0.5">
            {d.history.map((h: any, i: number) => (
              <div key={i} className="text-[11px] text-slate-600">
                <span className="text-slate-400">{when(h.at)}</span> · <b>{h.action === "CREATE" ? "made" : h.action === "DELETE" ? "deleted" : "changed"}</b>
                {h.who ? ` by ${h.who}` : ""}
                {h.what ? <span className="text-slate-500" dir="auto"> — {h.what}</span> : null}
              </div>
            ))}
          </div>
        </details>
      )}
      <Comments entityType={kind === "tle" ? "truck_ledger_entry" : "party_ledger_entry"} entityId={id} compact />
    </div>
  );
}
