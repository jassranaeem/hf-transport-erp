/**
 * "What is this money?" for a truck khata row — Income, Expense, Shakhsi bardasht, Safi bachat
 * or the owner's money. The same picker sits in Truck Ledger "Add entry" and in the Daily Cash
 * Book once a truck is chosen, so a row lands in the same place whichever screen it was typed on.
 */
import React from "react";
import { KHATA_KINDS, KhataKind, catLabel } from "../../lib/khataKinds.ts";

export interface KhataKindValue {
  kind: KhataKind;
  category: string;
  direction: "In" | "Out";
}

export const DEFAULT_KIND: KhataKindValue = { kind: "expense", category: "Other", direction: "Out" };

/** The picker's value for a kind chosen fresh (its usual category and direction). */
export function kindValue(kind: KhataKind, prev?: KhataKindValue): KhataKindValue {
  const k = KHATA_KINDS.find((x) => x.kind === kind)!;
  // an expense starts on "Other" (left for review) until its kind is picked — never guessed as diesel
  const category = prev && k.cats.includes(prev.category) ? prev.category : kind === "expense" ? "Other" : k.cats[0];
  const direction = k.dir === "either" ? (prev?.kind === kind ? prev.direction : "Out") : k.dir;
  return { kind, category, direction };
}

const TONE: Record<KhataKind, string> = {
  income: "#166534",
  expense: "#B91C1C",
  shakhsi: "#7C3AED",
  safi: "#0F766E",
  capital: "#4338CA",
};

const EITHER_LABEL: Partial<Record<KhataKind, { Out: string; In: string }>> = {
  safi: { Out: "Taken out · نکالی", In: "Came back · واپس آئی" },
  capital: { In: "Put in · ڈالا", Out: "Taken back · واپس لیا" },
};

export default function KhataKindPicker({
  value,
  onChange,
  isPartnership,
  onOpenPartnerPnl,
}: {
  value: KhataKindValue;
  onChange: (v: KhataKindValue) => void;
  /** a truck shared with a partner: money for home goes through Partner P&L, from that person's share */
  isPartnership?: boolean;
  onOpenPartnerPnl?: () => void;
}) {
  const cur = KHATA_KINDS.find((k) => k.kind === value.kind) || KHATA_KINDS[1];
  const lbl = "flex flex-col gap-1 text-[11.5px] font-medium text-[#4B5563]";
  const inp = "border border-[#CBD5E1] rounded-lg px-3 py-2 text-[13px] text-[#111827] bg-white";
  const either = EITHER_LABEL[value.kind];
  return (
    <div className="space-y-2.5">
      <div className={lbl}>
        What is this money? · یہ رقم کیا ہے؟
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="What is this money?">
          {KHATA_KINDS.map((k) => {
            const on = value.kind === k.kind;
            const blocked = k.kind === "shakhsi" && isPartnership;
            return (
              <button
                key={k.kind}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onChange(kindValue(k.kind, value))}
                title={blocked ? "This truck is shared with a partner — record money for home in Partner P&L" : k.hint}
                className={`rounded-lg border px-3 py-1.5 text-[12.5px] leading-tight text-left transition ${on ? "font-semibold text-white" : "bg-white border-[#CBD5E1] text-[#374151] hover:bg-[#F4F6FA]"} ${blocked && !on ? "opacity-60" : ""}`}
                style={on ? { backgroundColor: TONE[k.kind], borderColor: TONE[k.kind], color: "#fff" } : undefined}
              >
                {k.en} · <span dir="rtl">{k.ur}</span>
              </button>
            );
          })}
        </div>
        <span className="text-[11px] font-normal text-[#6B7280]">{cur.hint}</span>
      </div>

      {value.kind === "shakhsi" && isPartnership && (
        <div className="rounded-lg border border-[#FCD34D] bg-[#FFFBEB] px-3 py-2 text-[12px] text-[#92400E]" dir="auto">
          This truck is shared with a partner. Money taken for home is cut from that person's share, so record it in{" "}
          {onOpenPartnerPnl ? (
            <button type="button" onClick={onOpenPartnerPnl} className="font-semibold underline">Partner P&amp;L → Money taken for home</button>
          ) : (
            <b>Partner P&amp;L → Money taken for home</b>
          )}
          . · یہ ٹرک شراکت کا ہے، شخصی برداشت Partner P&amp;L میں لکھیں تاکہ اسی کے حصے سے کٹے۔
        </div>
      )}

      {(cur.cats.length > 1 || either) && (
        <div className="flex flex-wrap gap-3">
          {cur.cats.length > 1 && (
            <label className={`${lbl} min-w-[180px]`}>
              {value.kind === "income" ? "Which income · کونسی آمدن" : "Which expense · کونسا خرچہ"}
              <select value={value.category} onChange={(e) => onChange({ ...value, category: e.target.value })} className={inp}>
                {cur.cats.map((c) => (
                  <option key={c} value={c}>
                    {value.kind === "expense" && c === "Freight" ? "Freight / hire paid to others" : catLabel(c)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {either && (
            <div className={lbl}>
              Which way · کس طرف
              <div className="grid grid-cols-2 rounded-lg border border-[#CBD5E1] bg-white p-0.5">
                {(["Out", "In"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => onChange({ ...value, direction: d })}
                    className={`rounded-md px-3 py-1.5 text-[12.5px] ${value.direction === d ? "font-semibold text-white" : "text-[#4B5563]"}`}
                    style={value.direction === d ? { backgroundColor: TONE[value.kind], color: "#fff" } : undefined}
                  >
                    {either[d]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The five totals of a truck's khata as a row of small figures. */
export function KhataBuckets({
  t,
  onPick,
}: {
  t: { income: number; expense: number; profit: number; shakhsi: number; safi: number; capitalIn: number; capitalOut: number };
  onPick?: (kind: KhataKind | "profit") => void;
}) {
  const pkr = (n: number) => (n < 0 ? "−" : "") + "PKR " + Math.abs(Math.round(n)).toLocaleString();
  const cells: Array<{ key: KhataKind | "profit"; en: string; ur: string; v: number; color: string; show: boolean }> = [
    { key: "income", en: "Income", ur: "آمدن", v: t.income, color: TONE.income, show: true },
    { key: "expense", en: "Expense", ur: "خرچہ", v: t.expense, color: TONE.expense, show: true },
    { key: "profit", en: "Truck's profit", ur: "ٹرک کا منافع", v: t.profit, color: t.profit >= 0 ? "#166534" : "#B91C1C", show: true },
    { key: "shakhsi", en: "Shakhsi bardasht", ur: "شخصی برداشت", v: t.shakhsi, color: TONE.shakhsi, show: true },
    { key: "safi", en: "Safi bachat", ur: "صافی بچت", v: t.safi, color: TONE.safi, show: true },
    { key: "capital", en: "Owner's money (net in)", ur: "سرمایہ", v: t.capitalIn - t.capitalOut, color: TONE.capital, show: !!(t.capitalIn || t.capitalOut) },
  ];
  return (
    <div className="flex flex-wrap gap-px rounded-lg border border-[#E3E8EF] bg-[#E3E8EF] overflow-hidden">
      {cells
        .filter((c) => c.show)
        .map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={onPick ? () => onPick(c.key) : undefined}
            disabled={!onPick}
            className="flex-1 basis-[140px] bg-white px-3 py-2 text-left disabled:cursor-default enabled:hover:bg-[#F8FAFC]"
          >
            <div className="text-[11px] text-[#6B7280]">
              {c.en} · <span dir="rtl">{c.ur}</span>
            </div>
            <div className="text-[14px] font-semibold tabular-nums" style={{ color: c.color }}>{pkr(c.v)}</div>
          </button>
        ))}
    </div>
  );
}
