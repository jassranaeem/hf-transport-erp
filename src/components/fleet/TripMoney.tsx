/**
 * Trip money · ٹرپ کے پیسے — kept as plain as the office keeps it on paper. Every rupee is one of three:
 *
 *   Cash to driver · نقد دی           new money handed to the driver (350,000; the dollars, 312,400 …)
 *   Driver spent · ڈرائیور کا خرچ       what he paid OUT OF that cash (diesel 185,609, toll …) — not new money
 *   Driver returned · واپس              cash he did not spend and gave back
 *   Office paid · دفتر نے دیا           paid by the office itself (pump account, bank) — new money
 *
 *   Given on the trip   = cash to driver + office paid − returned
 *   With the driver     = cash to driver − driver spent − returned
 *
 * (Underneath, a "driver spent" row is taken out of the cash row it came from — server/trip_desk.ts
 * paidFromEntryId — so the truck's khata and the books count every rupee once, by what it was for.)
 */
import React, { useCallback, useEffect, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import { Loader2, Pencil, Trash2, Check, X, Plus } from "lucide-react";

const fmt = (n: number) => "PKR " + Math.round(n || 0).toLocaleString();
const todayStr = () => new Date().toISOString().slice(0, 10);
const dmy = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");
// (the rows' dates are shown day-first like the paper, 03/10/2026)

const FOR = [
  { k: "diesel", l: "Diesel · ڈیزل", c: "Diesel" },
  { k: "toll", l: "Toll · ٹول", c: "Toll" },
  { k: "khurak", l: "Khurak (food) · خوراک", c: "Khurak" },
  { k: "labour", l: "Loading / unloading · مزدوری", c: "Labour" },
  { k: "repair", l: "Repair · مرمت", c: "Garage" },
  { k: "tyre", l: "Tyre · ٹائر", c: "Tyre" },
  { k: "permit", l: "Permit / border · پرمٹ", c: "Permit" },
  { k: "other", l: "Other · دیگر", c: "Other" },
];
const forLabel = (cat: string) => FOR.find((f) => f.c === cat)?.l || cat;
const kindOf = (cat: string) => FOR.find((f) => f.c === cat)?.k || "other";

type Type = "cash" | "spent" | "return" | "office";
const TYPES: Array<{ t: Type; l: string; ur: string; hint: string }> = [
  { t: "cash", l: "Cash to driver", ur: "نقد دی", hint: "money handed to the driver" },
  { t: "spent", l: "Driver spent", ur: "ڈرائیور کا خرچ", hint: "diesel, toll, food… paid out of the cash he was given" },
  { t: "return", l: "Driver returned", ur: "واپس دیے", hint: "cash he did not spend and gave back" },
  { t: "office", l: "Office paid", ur: "دفتر نے دیا", hint: "pump account, bank, office cash — on top of the driver's cash" },
];

interface Entry { id: number; entryDate: string; category: string; method: string; paid: number; received: number; description: string | null; paidFromEntryId: number | null; spentFromIt: number }

export default function TripMoney({
  root,
  stops,
  onChanged,
  showFeedback,
}: {
  root: number;
  stops: Array<{ id: number; legNo: number | null; origin: string; destination: string }>;
  onChanged: () => void;
  showFeedback: (t: "success" | "error", m: string) => void;
}) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const load = useCallback(() => {
    enterpriseFetch(`/api/trip-desk/${root}/entries`).then(setEntries).catch(() => setEntries([]));
  }, [root]);
  useEffect(load, [load]);

  const list = entries || [];
  const typeOf = (e: Entry): Type =>
    e.category === "TripCash" && (e.received || 0) > 0 && !e.paid ? "return" : e.category === "TripCash" && !e.paidFromEntryId ? "cash" : e.paidFromEntryId ? "spent" : "office";
  const byOrder = (a: Entry, b: Entry) => +new Date(a.entryDate) - +new Date(b.entryDate) || a.id - b.id;
  const cashRows = list.filter((e) => typeOf(e) === "cash").sort((a, b) => a.id - b.id); // in the order they were given
  const spentRows = list.filter((e) => typeOf(e) === "spent").sort(byOrder);
  const officeRows = list.filter((e) => typeOf(e) === "office").sort(byOrder);
  const returnRows = list.filter((e) => typeOf(e) === "return").sort(byOrder);
  // a cash row shows what was handed over; a returned row what came back
  const shown = (e: Entry) => (typeOf(e) === "cash" ? e.paid + (e.spentFromIt || 0) : typeOf(e) === "return" ? e.received : e.paid);
  const cashGiven = cashRows.reduce((s, e) => s + shown(e), 0);
  const spent = spentRows.reduce((s, e) => s + e.paid, 0);
  const office = officeRows.reduce((s, e) => s + e.paid, 0);
  const returned = returnRows.reduce((s, e) => s + (e.received || 0), 0);
  const withDriver = cashGiven - spent - returned;

  // ---- add
  const [type, setType] = useState<Type | null>(null);
  const effType: Type = type ?? (cashRows.length ? "spent" : "cash");
  const [f, setF] = useState({ date: todayStr(), kind: "diesel", amount: "", note: "", how: "Bank", stop: 0 });
  const [saving, setSaving] = useState(false);
  const add = async () => {
    const amount = Number(f.amount);
    if (!amount) return showFeedback("error", "Enter the amount · رقم لکھیں");
    if ((effType === "spent" || effType === "return") && amount > withDriver)
      return showFeedback(
        "error",
        `The driver has only ${fmt(withDriver)} of the cash — ${effType === "spent" ? "enter more Cash to driver first, or choose Office paid" : "he cannot give back more than that"} · ڈرائیور کے پاس اتنی نقد نہیں`,
      );
    setSaving(true);
    try {
      await enterpriseFetch(`/api/trip-desk/${f.stop || stops[stops.length - 1].id}/money`, {
        method: "POST",
        body: JSON.stringify({
          kind: effType === "cash" ? "cash" : effType === "return" ? "return" : f.kind,
          amount,
          note: f.note,
          date: f.date,
          method: effType === "office" ? f.how : "Cash",
          fromCash: effType === "spent",
        }),
      });
      showFeedback("success", `${fmt(amount)} saved · محفوظ`);
      setF((x) => ({ ...x, amount: "", note: "" }));
      setTimeout(() => (document.getElementById(`money-amount-${root}`) as HTMLInputElement | null)?.focus(), 50);
      load();
      onChanged();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setSaving(false);
    }
  };

  // ---- edit / delete
  const [edit, setEdit] = useState<{ id: number; type: Type; date: string; kind: string; amount: string; note: string } | null>(null);
  const startEdit = (e: Entry) =>
    setEdit({ id: e.id, type: typeOf(e), date: e.entryDate ? String(e.entryDate).slice(0, 10) : todayStr(), kind: kindOf(e.category), amount: String(shown(e)), note: e.description || "" });
  const saveEdit = async (e: Entry) => {
    if (!edit) return;
    try {
      const from = typeOf(e);
      // a cash row is edited as handed over; what was spent out of it stays spent
      const stored = from === "cash" ? Number(edit.amount) - (e.spentFromIt || 0) : Number(edit.amount);
      if (stored <= 0) throw new Error(`PKR ${(e.spentFromIt || 0).toLocaleString()} was already spent out of this cash — it cannot be less than that · اس نقد میں سے اتنا خرچ ہو چکا ہے`);
      // switching between "driver spent" and "office paid" first (it moves the money in / out of the cash)
      if (from === "spent" && edit.type === "office") await enterpriseFetch(`/api/trip-desk/entry/${e.id}/from-cash`, { method: "DELETE" });
      await enterpriseFetch(`/api/trip-desk/entry/${e.id}`, {
        method: "PUT",
        body: JSON.stringify({ entryDate: edit.date, amount: stored, description: edit.note, ...(from === "cash" || from === "return" ? {} : { kind: edit.kind }) }),
      });
      if (from === "office" && edit.type === "spent") await enterpriseFetch(`/api/trip-desk/entry/${e.id}/from-cash`, { method: "POST", body: "{}" });
      showFeedback("success", "Saved · محفوظ");
      setEdit(null);
    } catch (err: any) {
      showFeedback("error", err.message);
    } finally {
      load();
      onChanged();
    }
  };
  const del = async (e: Entry) => {
    const t = typeOf(e);
    const msg =
      t === "cash" && e.spentFromIt
        ? `Delete this cash (${fmt(shown(e))})? Delete what the driver spent out of it first.`
        : `Delete ${fmt(shown(e))}${e.description ? ` — ${e.description}` : ""}? · حذف کریں؟`;
    if (!window.confirm(msg)) return;
    try {
      await enterpriseFetch(`/api/trip-desk/entry/${e.id}`, { method: "DELETE" });
      showFeedback("success", "Deleted · حذف");
      load();
      onChanged();
    } catch (err: any) {
      showFeedback("error", err.message);
    }
  };

  const small = "border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white";

  // plain functions (not components), so an input being typed in is never re-mounted
  const row = (e: Entry) =>
    edit?.id === e.id ? (
      <tr key={e.id} className="border-t border-slate-100 bg-emerald-50/40">
        <td className="px-2 py-1.5"><input type="date" className={small} value={edit.date} onChange={(x) => setEdit({ ...edit, date: x.target.value })} /></td>
        <td className="px-2">
          {edit.type === "cash" || edit.type === "return" ? (
            <span className="text-slate-500">{edit.type === "cash" ? "Cash · نقد" : "Returned · واپس"}</span>
          ) : (
            <div className="flex flex-col gap-1">
              <select className={small} value={edit.kind} onChange={(x) => setEdit({ ...edit, kind: x.target.value })}>{FOR.map((o) => <option key={o.k} value={o.k}>{o.l}</option>)}</select>
              <select className={`${small} text-xs`} value={edit.type} onChange={(x) => setEdit({ ...edit, type: x.target.value as Type })}>
                <option value="spent">Driver spent (from his cash)</option>
                <option value="office">Office paid</option>
              </select>
            </div>
          )}
        </td>
        <td className="px-2"><input inputMode="numeric" className={`${small} w-32 text-right tabular-nums`} value={edit.amount} onChange={(x) => setEdit({ ...edit, amount: x.target.value.replace(/[^\d]/g, "") })} /></td>
        <td className="px-2"><input dir="auto" className={`${small} w-full`} value={edit.note} onChange={(x) => setEdit({ ...edit, note: x.target.value })} /></td>
        <td className="px-2 whitespace-nowrap text-right">
          <button onClick={() => saveEdit(e)} className="text-emerald-700 p-1" title="Save"><Check className="w-4 h-4" /></button>
          <button onClick={() => setEdit(null)} className="text-slate-400 p-1" title="Cancel"><X className="w-4 h-4" /></button>
        </td>
      </tr>
    ) : (
      <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50">
        <td className="px-2 py-1.5 whitespace-nowrap text-slate-600">{dmy(e.entryDate)}</td>
        <td className="px-2 whitespace-nowrap">{typeOf(e) === "cash" ? "Cash · نقد" : typeOf(e) === "return" ? "Returned · واپس" : forLabel(e.category)}</td>
        <td className="px-2 text-right tabular-nums font-semibold whitespace-nowrap">{fmt(shown(e))}</td>
        <td className="px-2 text-slate-600" dir="auto">{e.description || ""}</td>
        <td className="px-2 whitespace-nowrap text-right">
          <button onClick={() => startEdit(e)} className="text-slate-400 hover:text-emerald-700 p-1" title="Edit · درست کریں"><Pencil className="w-3.5 h-3.5" /></button>
          <button onClick={() => del(e)} className="text-slate-400 hover:text-red-600 p-1" title="Delete · حذف کریں"><Trash2 className="w-3.5 h-3.5" /></button>
        </td>
      </tr>
    );

  const group = (title: string, ur: string, rows: Entry[], total: number) =>
    rows.length ? (
      <React.Fragment key={title}>
        <tr className="bg-slate-50">
          <td colSpan={2} className="px-2 py-1 text-[11px] font-bold text-slate-600 uppercase tracking-wide">{title} <span className="font-normal normal-case">· {ur}</span></td>
          <td className="px-2 py-1 text-right text-[11px] font-bold tabular-nums text-slate-600 whitespace-nowrap">{fmt(total)}</td>
          <td colSpan={2} />
        </tr>
        {rows.map((e) => row(e))}
      </React.Fragment>
    ) : null;

  return (
    <div id={`money-${root}`} className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
      <div className="text-sm font-bold text-slate-800">Trip money · ٹرپ کے پیسے</div>

      {/* the four numbers */}
      {/* the driver's cash in one line: given − spent − returned = with him */}
      <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-700 flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums">
        <span>Cash given <b>{fmt(cashGiven)}</b></span>
        <span className="text-slate-400">−</span>
        <span>spent <b>{fmt(spent)}</b></span>
        {returned > 0 && (
          <>
            <span className="text-slate-400">−</span>
            <span>returned <b>{fmt(returned)}</b></span>
          </>
        )}
        <span className="text-slate-400">=</span>
        <span className="rounded-md bg-emerald-100 text-emerald-900 px-2 py-0.5">with the driver · ڈرائیور کے پاس <b>{fmt(withDriver)}</b></span>
        {office > 0 && <span className="text-slate-500">· office paid on top {fmt(office)}</span>}
      </div>

      {/* add */}
      <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {TYPES.map((t) => (
            <button
              key={t.t}
              onClick={() => setType(t.t)}
              className={`text-xs rounded-lg px-3 py-1.5 border ${effType === t.t ? "bg-emerald-600 border-emerald-600 text-white font-semibold" : "bg-white border-slate-300 text-slate-700 hover:bg-slate-100"}`}
              title={t.hint}
            >
              {t.l} · {t.ur}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <input id={`money-date-${root}`} type="date" className={small} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          {effType !== "cash" && (
            <select id={`money-kind-${root}`} className={small} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              {FOR.map((o) => <option key={o.k} value={o.k}>{o.l}</option>)}
            </select>
          )}
          <input
            id={`money-amount-${root}`}
            inputMode="numeric"
            placeholder="Amount · رقم"
            className={`${small} w-36 tabular-nums`}
            value={f.amount}
            onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d]/g, "") })}
            onKeyDown={(e) => e.key === "Enter" && f.amount && add()}
          />
          {effType === "office" && (
            <select className={small} value={f.how} onChange={(e) => setF({ ...f, how: e.target.value })}>
              <option value="Bank">Bank</option>
              <option value="Online">Online / Easypaisa</option>
              <option value="Cash">Office cash</option>
              <option value="Cheque">Cheque</option>
            </select>
          )}
          {stops.length > 1 && (
            <select className={small} value={f.stop || stops[stops.length - 1].id} onChange={(e) => setF({ ...f, stop: Number(e.target.value) })}>
              {stops.map((s) => <option key={s.id} value={s.id}>Stop {s.legNo || 1}: {s.origin} → {s.destination}</option>)}
            </select>
          )}
          <input
            dir="auto"
            placeholder={effType === "cash" ? "Note, e.g. $1,100 × 284 · تفصیل" : "Detail, e.g. 593 L, Al-Ahsan pump · تفصیل"}
            className={`${small} flex-1 min-w-[180px]`}
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && f.amount && add()}
          />
          <button onClick={add} disabled={saving || !f.amount} className="inline-flex items-center gap-1.5 text-sm font-semibold rounded-lg bg-emerald-600 text-white px-4 py-1.5 hover:bg-emerald-700 disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add · درج کریں
          </button>
        </div>
      </div>

      {/* the list */}
      {entries === null ? (
        <div className="text-xs text-slate-400 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>
      ) : list.length === 0 ? (
        <div className="text-xs text-slate-400">Nothing given on this trip yet · ابھی کچھ نہیں دیا</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {group("Cash to driver", "نقد دی", cashRows, cashGiven)}
              {group("Driver spent (out of the cash)", "ڈرائیور کا خرچ", spentRows, spent)}
              {group("Driver returned", "واپس دیے", returnRows, returned)}
              {group("Office paid", "دفتر نے دیا", officeRows, office)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

