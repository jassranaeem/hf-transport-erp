/**
 * Shared pieces of Personal & Household: the entry form (with receipts to attach), the
 * "view details + attachments" panel, and the Urdu names of the categories. Used by both the
 * register and the ledgers so an entry looks and behaves the same wherever it is opened.
 */
import React, { useRef } from "react";
import { Loader2, CheckCircle, X, Paperclip } from "lucide-react";
import AttachmentPanel from "../common/AttachmentPanel.tsx";
import { enterpriseFetch } from "../../../client/api.ts";

export const PKR = (n: number) => "PKR " + Math.round(Math.abs(n || 0)).toLocaleString();
export const today = () => new Date().toISOString().slice(0, 10);
export const dmy = (d: string | null | undefined) => (d ? String(d).slice(0, 10).split("-").reverse().join(".") : "—");

export const CAT_UR: Record<string, string> = {
  Household: "گھر کا خرچہ",
  PocketMoney: "جیب خرچ",
  Personal: "ذاتی",
  Groceries: "راشن",
  Utilities: "بجلی/گیس/پانی",
  Rent: "کرایہ",
  Medical: "علاج",
  Education: "تعلیم",
  Travel: "سفر",
  Gift: "تحفہ",
  Charity: "خیرات",
  "Domestic Staff": "ملازمین",
  "Vehicle (personal)": "ذاتی گاڑی",
  Entertainment: "تفریح",
  "Funds In": "رقم جمع",
  Other: "دیگر",
};

/** Keep the Urdu names in step with the categories as saved (called whenever the list is loaded). */
export function setCategoryNames(details: Array<{ name: string; nameUr: string | null }> | undefined) {
  if (!details) return;
  for (const k of Object.keys(CAT_UR)) delete CAT_UR[k];
  for (const c of details) if (c.nameUr) CAT_UR[c.name] = c.nameUr;
}

export const blankEntry = () => ({
  entryDate: today(),
  category: "Household",
  direction: "expense",
  person: "",
  description: "",
  payee: "",
  amount: "",
  method: "Cash",
  refNo: "",
  paidBy: "",
  notes: "",
});

export const entryToForm = (r: any) => ({
  entryDate: r.entryDate ? String(r.entryDate).slice(0, 10) : today(),
  category: r.category,
  direction: r.direction,
  person: r.person || "",
  description: r.description || "",
  payee: r.payee || "",
  amount: r.amount || "",
  method: r.method || "Cash",
  refNo: r.refNo || "",
  paidBy: r.paidBy || "",
  notes: r.notes || "",
});

export function EntryForm({
  value,
  onChange,
  meta,
  onSubmit,
  saving,
  onCancel,
  submitLabel,
  compact,
  files,
  onFiles,
}: {
  value: any;
  onChange: (v: any) => void;
  meta: any;
  onSubmit: () => void;
  saving: boolean;
  onCancel: () => void;
  submitLabel: string;
  compact?: boolean;
  /** when given, a "receipts / proof" picker is shown and the chosen files are uploaded after saving */
  files?: File[];
  onFiles?: (f: File[]) => void;
}) {
  const set = (k: string, v: any) => onChange({ ...value, [k]: v });
  const fileRef = useRef<HTMLInputElement>(null);
  const cats: string[] = [...(meta.categories || []), ...(value.category && !(meta.categories || []).includes(value.category) ? [value.category] : [])];
  return (
    <div className={`rounded-lg border border-[#C9D7EC] bg-[#F2F5FA] p-3 ${compact ? "" : "shadow-sm"}`}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <label className="flex flex-col text-[10px] text-slate-500">Date · تاریخ
          <input type="date" value={value.entryDate} onChange={(e) => set("entryDate", e.target.value)} className="border rounded px-2 py-1 text-slate-800" />
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Category · مد
          <select
            value={value.category}
            onChange={(e) => {
              if (e.target.value !== "__new") return set("category", e.target.value);
              const n = (window.prompt("Name of the new ledger — it is made now · نئے کھاتے کا نام (ابھی بن جائے گا)", "") || "").trim().slice(0, 40);
              if (!n) return;
              enterpriseFetch("/api/personal-expenses/categories", { method: "POST", body: JSON.stringify({ name: n }) })
                .then((r) => {
                  window.dispatchEvent(new Event("pe-categories-changed"));
                  onChange({ ...value, category: r.name });
                })
                .catch((err) => {
                  // already there (or could not be made): use the name as it is if it exists
                  window.alert(err.message);
                });
            }}
            className="border rounded px-2 py-1 text-slate-800"
          >
            {cats.map((c) => <option key={c} value={c}>{c}{CAT_UR[c] ? ` · ${CAT_UR[c]}` : ""}</option>)}
            <option value="__new">＋ New category… · نئی مد</option>
          </select>
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Type
          <select value={value.direction} onChange={(e) => set("direction", e.target.value)} className="border rounded px-2 py-1 text-slate-800">
            <option value="expense">Expense · خرچہ</option>
            <option value="income">Funds in · رقم جمع</option>
          </select>
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Amount (PKR) · رقم
          <input inputMode="numeric" value={value.amount} onChange={(e) => set("amount", e.target.value.replace(/[^\d]/g, ""))} className="border rounded px-2 py-1 text-slate-800 font-semibold" />
        </label>
        <label className="flex flex-col text-[10px] text-slate-500 col-span-2 md:col-span-4">Description * · تفصیل (what it was for · کس لیے)
          <input dir="auto" value={value.description} onChange={(e) => set("description", e.target.value)} placeholder="e.g. Ration for the month, Dr. fee for son · مثلاً مہینے کا راشن" className="border rounded px-2 py-1 text-slate-800" />
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Person · فرد <span className="text-slate-400">(pocket money)</span>
          <input dir="auto" list="pe-people" value={value.person} onChange={(e) => set("person", e.target.value)} className="border rounded px-2 py-1 text-slate-800" placeholder="e.g. son / wife / self" />
          <datalist id="pe-people">{(meta.people || []).map((p: string) => <option key={p} value={p} />)}</datalist>
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Payee · کس کو دیا
          <input dir="auto" value={value.payee} onChange={(e) => set("payee", e.target.value)} className="border rounded px-2 py-1 text-slate-800" />
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Method · ذریعہ
          <select value={value.method} onChange={(e) => set("method", e.target.value)} className="border rounded px-2 py-1 text-slate-800">
            {(meta.methods || ["Cash"]).map((m: string) => <option key={m}>{m}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Ref no.
          <input value={value.refNo} onChange={(e) => set("refNo", e.target.value)} className="border rounded px-2 py-1 text-slate-800" />
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Paid by · کس نے دیا
          <input dir="auto" value={value.paidBy} onChange={(e) => set("paidBy", e.target.value)} className="border rounded px-2 py-1 text-slate-800" />
        </label>
        <label className="flex flex-col text-[10px] text-slate-500 col-span-2 md:col-span-3">Notes · نوٹ
          <input dir="auto" value={value.notes} onChange={(e) => set("notes", e.target.value)} className="border rounded px-2 py-1 text-slate-800" />
        </label>
      </div>
      {onFiles && (
        <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
          <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 border border-slate-300 rounded px-2.5 py-1 bg-white hover:bg-slate-50">
            <Paperclip className="w-3.5 h-3.5" /> Attach receipt / photo · رسید لگائیں
          </button>
          <input ref={fileRef} type="file" multiple accept="image/*,.pdf" className="hidden" onChange={(e) => onFiles(Array.from(e.target.files || []))} />
          {(files || []).map((f) => (
            <span key={f.name} className="text-[11px] rounded bg-white border border-slate-200 px-2 py-0.5">{f.name}</span>
          ))}
          {!(files || []).length && <span className="text-[11px] text-slate-400">optional — you can also attach later from the entry · بعد میں بھی لگا سکتے ہیں</span>}
        </div>
      )}
      <div className="flex items-center gap-2 mt-3">
        <button onClick={onSubmit} disabled={saving} className="bg-[#24539B] text-white rounded px-4 py-1.5 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-60">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />} {submitLabel}
        </button>
        <button onClick={onCancel} className="border border-slate-300 rounded px-3 py-1.5 text-xs flex items-center gap-1"><X className="w-3.5 h-3.5" /> Cancel</button>
      </div>
    </div>
  );
}

/** "View details": every field of the entry, and its attachments (receipts, photos). */
export function EntryDetail({ row, onChanged }: { row: any; onChanged?: () => void }) {
  const f = (label: string, v: any) => (
    <div>
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="text-xs text-slate-800 break-words" dir="auto">{v || v === 0 ? v : "—"}</div>
    </div>
  );
  return (
    <div className="rounded-lg border border-[#C9D7EC] bg-white p-3 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {f("Date · تاریخ", dmy(row.entryDate))}
        {f("Category · مد", `${row.category}${CAT_UR[row.category] ? " · " + CAT_UR[row.category] : ""}`)}
        {f("Type", row.direction === "income" ? "Funds in · رقم جمع" : "Expense · خرچہ")}
        {f("Amount · رقم", (row.direction === "income" ? "+" : "−") + PKR(row.amount))}
        <div className="col-span-2 md:col-span-4">{f("Description · تفصیل", row.description)}</div>
        {f("Person · فرد", row.person)}
        {f("Payee · کس کو دیا", row.payee)}
        {f("Method · ذریعہ", row.method)}
        {f("Ref no.", row.refNo)}
        {f("Paid by · کس نے دیا", row.paidBy)}
        <div className="col-span-2 md:col-span-3">{f("Notes · نوٹ", row.notes)}</div>
        {f("Entered", row.createdAt ? new Date(row.createdAt).toLocaleString("en-GB") : "")}
        {f("Last changed", row.updatedAt && row.updatedAt !== row.createdAt ? new Date(row.updatedAt).toLocaleString("en-GB") : "")}
      </div>
      <div onClick={() => { setTimeout(() => onChanged?.(), 1500); setTimeout(() => onChanged?.(), 5000); }}>
        <AttachmentPanel entityType="personal_expenses" entityId={row.id} title="Receipts / attachments · رسیدیں اور فائلیں" />
      </div>
    </div>
  );
}

/** Upload the chosen files to a saved entry; returns how many went up. */
export async function uploadEntryFiles(entryId: number, files: File[], upload: (path: string, fd: FormData) => Promise<any>): Promise<number> {
  let n = 0;
  for (const f of files) {
    const fd = new FormData();
    fd.append("file", f);
    fd.append("entityType", "personal_expenses");
    fd.append("entityId", String(entryId));
    try {
      await upload("/api/attachments", fd);
      n++;
    } catch {
      /* reported by the caller as "x of y attached" */
    }
  }
  return n;
}
