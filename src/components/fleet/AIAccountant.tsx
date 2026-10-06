/**
 * AI Accountant · اے آئی منشی — the munshi's daily work, done by the system with a person approving.
 *
 *   Today        what needs doing now (cash book, cash count, mistakes, banks, overdue parties)
 *   Enter by AI  type / speak a sentence or attach a photo, PDF or Excel → drafts → check → Approve
 *                (posted through the ordinary Cash Book / khata / party / trip routes; Undo takes it out)
 *   Categories   truck-khata rows in "Other" → a proposed category → applied only when a person says so
 *   Ask          questions about the books, answered from the books
 *   Report       the month's report in Roman Urdu and English
 *   Reminders    who owes HFK, with a ready message to send
 *   Your part    what the AI cannot do — it stays with people
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot, RefreshCw, Loader2, Mic, MicOff, Paperclip, Send, CheckCircle2, XCircle, Undo2, AlertTriangle, AlertOctagon, Info, ExternalLink,
  Sparkles, ListChecks, Tags, MessageSquare, FileText, BellRing, UserCheck, Copy, Printer, Trash2,
} from "lucide-react";
import { enterpriseFetch, uploadFile } from "../../../client/api.ts";

type Feedback = (type: "success" | "error", message: string) => void;
type Nav = (wb: string, sheet: string, focus?: any) => void;
const PKR = (v: number | null | undefined) => (v == null ? "" : (v < 0 ? "−" : "") + "PKR " + Math.abs(Math.round(v)).toLocaleString("en-US"));
const dmy = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join(".") : "—");
const btn = "inline-flex items-center gap-1.5 text-xs border border-[#D1D5DB] rounded-lg px-3 py-1.5 hover:bg-[#F9FAFB] disabled:opacity-50";
const btnGreen = "inline-flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 bg-[#24539B] text-white hover:bg-[#166534] disabled:opacity-50";
const input = "border border-[#D1D5DB] rounded px-1.5 py-1 text-xs bg-white";

const TABS = [
  { id: "today", label: "Today · آج", Icon: ListChecks },
  { id: "enter", label: "Enter by AI · اے آئی سے درج", Icon: Sparkles },
  { id: "categories", label: "Categories · کیٹیگری", Icon: Tags },
  { id: "ask", label: "Ask · پوچھیں", Icon: MessageSquare },
  { id: "report", label: "Monthly report · ماہانہ رپورٹ", Icon: FileText },
  { id: "reminders", label: "Reminders · یاد دہانی", Icon: BellRing },
  { id: "people", label: "Your part · آپ کا کام", Icon: UserCheck },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function AIAccountant({ showFeedback, onNavigate }: { showFeedback: Feedback; onNavigate?: Nav }) {
  const [tab, setTab] = useState<TabId>(() => {
    try {
      return (localStorage.getItem("ai_accountant_tab") as TabId) || "today";
    } catch {
      return "today";
    }
  });
  const [status, setStatus] = useState<any>(null);
  const loadStatus = useCallback(() => {
    enterpriseFetch("/api/ai-accountant/status").then(setStatus).catch(() => {});
  }, []);
  useEffect(loadStatus, [loadStatus]);
  const pick = (t: TabId) => {
    setTab(t);
    try {
      localStorage.setItem("ai_accountant_tab", t);
    } catch {}
  };
  const aiOn = !!status?.ai?.on;

  return (
    <div className="p-3 space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0 basis-72 space-y-1">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Bot className="w-5 h-5" /> AI Accountant <span className="text-[#9CA3AF] font-normal">· اے آئی منشی</span>
          </h2>
          <p className="text-[13px] text-[#374151]">
            Does the munshi's bookkeeping: reads what you type, say or photograph and writes it as entries, sorts khata rows into categories, answers questions from the books,
            writes the month's report and the reminders. <b>Nothing goes into the books until you approve it</b>, and every approved entry can be undone.
          </p>
          <p className="text-[14px] text-[#374151] leading-8" dir="rtl" lang="ur">
            منشی کا کام: جو آپ لکھیں، بولیں یا تصویر بھیجیں، اسے اندراج بناتا ہے، کھاتے کی کیٹیگری لگاتا ہے، حساب سے سوالوں کے جواب دیتا ہے، ماہانہ رپورٹ اور یاد دہانی لکھتا ہے۔ آپ کی منظوری کے بغیر کتاب میں کچھ نہیں جاتا۔
          </p>
        </div>
        <span className={`text-xs rounded-full px-3 py-1 border ${aiOn ? "bg-[#F0FDF4] border-[#86EFAC] text-[#166534]" : "bg-[#FFFBEB] border-[#FCD34D] text-[#92400E]"}`}>
          {status ? (aiOn ? `AI on · ${status.ai.provider} (${status.ai.model})` : "AI off — rules only · اے آئی بند") : "…"}
        </span>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-[#E5E7EB]">
        {TABS.map(({ id, label, Icon }) => (
          <div
            key={id}
            role="button"
            tabIndex={0}
            onClick={() => pick(id)}
            onKeyDown={(e) => e.key === "Enter" && pick(id)}
            className={`inline-flex items-center gap-1.5 text-xs px-3 py-2 -mb-px border-b-2 cursor-pointer select-none ${tab === id ? "border-[#24539B] text-[#14532D] font-semibold" : "border-transparent text-[#4B5563] hover:text-[#111827]"}`}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
            {id === "enter" && status?.drafts ? <span className="ml-1 rounded-full bg-[#F59E0B] text-white px-1.5 text-[10px]">{status.drafts}</span> : null}
            {id === "categories" && status?.reclass ? <span className="ml-1 rounded-full bg-[#24539B] text-white px-1.5 text-[10px]">{status.reclass}</span> : null}
          </div>
        ))}
      </div>

      {tab === "today" && <Today onNavigate={onNavigate} showFeedback={showFeedback} />}
      {tab === "enter" && <EnterByAi aiOn={aiOn} showFeedback={showFeedback} onNavigate={onNavigate} onChanged={loadStatus} />}
      {tab === "categories" && <Categories aiOn={aiOn} showFeedback={showFeedback} onChanged={loadStatus} />}
      {tab === "ask" && <Ask aiOn={aiOn} showFeedback={showFeedback} />}
      {tab === "report" && <Report aiOn={aiOn} showFeedback={showFeedback} />}
      {tab === "reminders" && <Reminders showFeedback={showFeedback} />}
      {tab === "people" && <YourPart />}
    </div>
  );
}

// ================================================================== Today
const LEVEL = {
  red: { box: "border-[#FCA5A5] bg-[#FEF2F2]", text: "text-[#991B1B]", Icon: AlertOctagon },
  amber: { box: "border-[#FCD34D] bg-[#FFFBEB]", text: "text-[#92400E]", Icon: AlertTriangle },
  info: { box: "border-[#C9D7EC] bg-[#F2F5FA]", text: "text-[#1E3A6E]", Icon: Info },
  green: { box: "border-[#86EFAC] bg-[#F0FDF4]", text: "text-[#166534]", Icon: CheckCircle2 },
} as const;

function Today({ onNavigate, showFeedback }: { onNavigate?: Nav; showFeedback: Feedback }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    enterpriseFetch("/api/ai-accountant/briefing")
      .then(setData)
      .catch((e) => showFeedback("error", e.message))
      .finally(() => setLoading(false));
  }, [showFeedback]);
  useEffect(load, [load]);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-sm font-semibold">To do — {dmy(data?.today)} · آج کے کام</div>
        <button className={btn} onClick={load}>
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh
        </button>
      </div>
      <div className="space-y-2">
        {(data?.items || []).map((it: any, i: number) => {
          const L = LEVEL[it.level as keyof typeof LEVEL] || LEVEL.info;
          return (
            <div key={i} className={`border rounded-lg p-3 flex gap-3 items-start ${L.box}`}>
              <L.Icon className={`w-4 h-4 mt-0.5 shrink-0 ${L.text}`} />
              <div className="flex-1 min-w-0">
                <div className={`text-[13px] font-semibold ${L.text}`}>{it.title}</div>
                <div className="text-[13px] text-[#374151]" dir="rtl" lang="ur">{it.urdu}</div>
                {it.detail && <div className="text-xs text-[#4B5563] mt-0.5">{it.detail}</div>}
              </div>
              {it.link && onNavigate && (
                <button className={btn} onClick={() => onNavigate(it.link.wb, it.link.sheet)}>
                  Open <ExternalLink className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
        {data && !data.items?.length && <div className="text-sm text-[#6B7280]">Nothing to do right now.</div>}
      </div>
    </div>
  );
}

// ================================================================== Enter by AI
const TARGETS = [
  { v: "cash", l: "Cash Book · کیش بک" },
  { v: "trip", l: "Trip money · ٹرپ" },
  { v: "truck", l: "Truck khata (bank/online) · ٹرک" },
  { v: "party", l: "Party ledger (bank/online) · پارٹی" },
];
const KINDS = ["cash", "diesel", "toll", "khurak", "labour", "repair", "tyre", "permit", "other"];
const CATS = ["Freight", "Diesel", "Toll", "Tyre", "Battery", "MobilOil", "Garage", "PartsBill", "Khurak", "Labour", "TripCash", "Salary", "Permit", "Carnet", "Visa", "Insurance", "TomanFX", "Capital", "OnlineTransfer", "Other"];

function EnterByAi({ aiOn, showFeedback, onNavigate, onChanged }: { aiOn: boolean; showFeedback: Feedback; onNavigate?: Nav; onChanged: () => void }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [reading, setReading] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [show, setShow] = useState("open");
  const [drafts, setDrafts] = useState<any[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [opts, setOpts] = useState<{ trucks: any[]; parties: any[] }>({ trucks: [], parties: [] });
  const [trips, setTrips] = useState<Record<number, any[]>>({});
  const [listening, setListening] = useState(false);
  const [lang, setLang] = useState("ur-PK");
  const recRef = useRef<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const voiceUsed = useRef(false);

  const load = useCallback(() => {
    enterpriseFetch(`/api/ai-accountant/drafts?status=${show}`)
      .then((r) => setDrafts(r.drafts))
      .catch((e) => showFeedback("error", e.message));
  }, [show, showFeedback]);
  useEffect(load, [load]);
  useEffect(() => {
    enterpriseFetch("/api/cash-book/link-options").then(setOpts).catch(() => {});
  }, []);
  const tripsFor = useCallback(
    (vehicleId: number | null) => {
      if (!vehicleId || trips[vehicleId]) return;
      enterpriseFetch(`/api/ai-accountant/trips?vehicleId=${vehicleId}`).then((r) => setTrips((t) => ({ ...t, [vehicleId]: r.trips }))).catch(() => {});
    },
    [trips],
  );
  useEffect(() => {
    drafts.filter((d) => d.target === "trip" && d.vehicle_id).forEach((d) => tripsFor(d.vehicle_id));
  }, [drafts, tripsFor]);

  const speech = typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;
  const toggleMic = () => {
    if (!speech) return showFeedback("error", "This browser cannot listen — use Chrome, or type · یہ براؤزر آواز نہیں سنتا");
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new speech();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      let said = "";
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) said += e.results[i][0].transcript;
      if (said) {
        voiceUsed.current = true;
        setText((t) => (t ? t + "\n" : "") + said.trim());
      }
    };
    rec.onend = () => setListening(false);
    rec.onerror = (e: any) => {
      setListening(false);
      if (e.error !== "no-speech") showFeedback("error", `Microphone: ${e.error}`);
    };
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  const read = async () => {
    if (!text.trim() && !files.length) return showFeedback("error", "Type, speak or attach something · کچھ لکھیں یا فائل لگائیں");
    setReading(true);
    setProblems([]);
    try {
      const fd = new FormData();
      fd.append("text", text);
      fd.append("source", voiceUsed.current ? "voice" : "text");
      files.forEach((f) => fd.append("files", f));
      const r = await uploadFile("/api/ai-accountant/read", fd);
      setProblems(r.problems || []);
      showFeedback(r.drafts ? "success" : "error", r.drafts ? `${r.drafts} draft(s) ready — check and approve · ${r.drafts} مسودے تیار` : "Nothing to enter was found · کچھ نہیں ملا");
      if (r.drafts) {
        setText("");
        setFiles([]);
        voiceUsed.current = false;
        if (fileRef.current) fileRef.current.value = "";
      }
      setShow("open");
      load();
      onChanged();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setReading(false);
    }
  };

  const save = async (d: any, patch: Record<string, any>) => {
    setDrafts((list) => list.map((x) => (x.id === d.id ? { ...x, ...toLocal(patch) } : x)));
    try {
      const r = await enterpriseFetch(`/api/ai-accountant/drafts/${d.id}`, { method: "PUT", body: JSON.stringify(patch) });
      setDrafts((list) => list.map((x) => (x.id === d.id ? { ...x, ...r, truck: x.truck, party: x.party, trip: x.trip } : x)));
      if (patch.vehicleId) tripsFor(Number(patch.vehicleId));
    } catch (e: any) {
      showFeedback("error", e.message);
      load();
    }
  };

  const open = drafts.filter((d) => d.status === "pending" || d.status === "failed");
  const chosen = drafts.filter((d) => sel.has(d.id));
  const approve = async (ids: number[]) => {
    const list = drafts.filter((d) => ids.includes(d.id));
    const total = list.reduce((s, d) => s + Number(d.amount || 0), 0);
    if (!window.confirm(`Post ${list.length} entr${list.length === 1 ? "y" : "ies"} (${PKR(total)}) into the books?\n\nEach goes through the ordinary Cash Book / khata / party / trip entry, with your name. You can undo any of them later.\n\nکتاب میں درج کریں؟`)) return;
    setBusy(true);
    try {
      const r = await enterpriseFetch("/api/ai-accountant/drafts/approve", { method: "POST", body: JSON.stringify({ ids }) });
      showFeedback(r.failed ? "error" : "success", `${r.posted} posted · درج ہو گئے${r.failed ? ` — ${r.failed} could not be posted (see the red note on each)` : ""}`);
      setSel(new Set());
      load();
      onChanged();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(false);
    }
  };
  const reject = async (ids: number[]) => {
    if (!window.confirm(`Throw away ${ids.length} draft(s)? Nothing was posted from them. · مسودے رد کریں؟`)) return;
    try {
      const r = await enterpriseFetch("/api/ai-accountant/drafts/reject", { method: "POST", body: JSON.stringify({ ids }) });
      showFeedback("success", `${r.rejected} rejected · رد`);
      setSel(new Set());
      load();
      onChanged();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };
  const undo = async (d: any) => {
    if (!window.confirm(`Take this entry back out of the books?\n${dmy(d.entry_date)} · ${d.direction} · ${PKR(Number(d.amount))} · ${d.description || ""}\n\nواپس لیں؟`)) return;
    try {
      await enterpriseFetch(`/api/ai-accountant/drafts/${d.id}/undo`, { method: "POST" });
      showFeedback("success", "Taken out of the books · واپس ہو گیا");
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    }
  };
  const openPosted = (d: any) => {
    if (!onNavigate || !d.posted) return;
    if (d.posted.table === "cash_transactions") onNavigate("finance", "cash_book", { date: d.entry_date });
    else if (d.posted.table === "party_ledger_entries") onNavigate("khata", "parties", { partyId: d.party_id, entryId: d.posted.id });
    else onNavigate("khata", "truck_ledgers", { entryId: d.posted.id, date: d.entry_date });
  };

  return (
    <div className="space-y-4">
      <div className="border border-[#E5E7EB] rounded-lg p-3 space-y-2 bg-white">
        <div className="text-[13px] font-semibold">Tell the AI Accountant · بتائیں</div>
        <textarea
          id="ai-acc-text"
          dir="auto"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder={"e.g.  TLE-730 driver ko diesel 25 hazar diye\n       Haji Akbar se 2 lakh online mile kal\n       ghar ke liye 20,000 kharcha\n(one line per entry · ہر اندراج نئی لائن میں)"}
          className="w-full border border-[#D1D5DB] rounded-lg p-2 text-[13px] leading-6"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button className={`${btn} ${listening ? "bg-[#FEE2E2] border-[#FCA5A5]" : ""}`} onClick={toggleMic}>
            {listening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />} {listening ? "Stop · روکیں" : "Speak · بولیں"}
          </button>
          <select id="ai-acc-lang" className={input} value={lang} onChange={(e) => setLang(e.target.value)} title="Language you will speak">
            <option value="ur-PK">اردو</option>
            <option value="en-PK">English / Roman</option>
          </select>
          <button className={btn} onClick={() => fileRef.current?.click()}>
            <Paperclip className="w-3.5 h-3.5" /> Photo / PDF / Excel
          </button>
          <input ref={fileRef} id="ai-acc-files" type="file" multiple accept="image/*,.pdf,.xlsx,.csv" className="hidden" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
          {files.map((f) => (
            <span key={f.name} className="text-[11px] rounded bg-[#F3F4F6] px-2 py-0.5">{f.name}</span>
          ))}
          <div className="flex-1" />
          <button className={btnGreen} onClick={read} disabled={reading}>
            {reading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Read · پڑھیں
          </button>
        </div>
        {!aiOn && (
          <div className="text-[11px] text-[#92400E]">
            AI is off: simple typed / spoken lines and Excel sheets with Date and Amount headings are read by rules. Photos and PDFs need the AI key. · تصویر اور PDF کے لیے اے آئی کی چابی چاہیے
          </div>
        )}
        {problems.map((p, i) => (
          <div key={i} className="text-[12px] text-[#991B1B]">• {p}</div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select id="ai-acc-show" className={input} value={show} onChange={(e) => { setShow(e.target.value); setSel(new Set()); }}>
          <option value="open">To approve · منظوری باقی</option>
          <option value="posted">Posted · درج شدہ</option>
          <option value="rejected">Rejected · رد</option>
          <option value="undone">Undone · واپس</option>
          <option value="all">All · سب</option>
        </select>
        <span className="text-xs text-[#6B7280]">{drafts.length} draft(s)</span>
        <div className="flex-1" />
        {show === "open" && (
          <>
            <button className={btnGreen} disabled={busy || !chosen.length} onClick={() => approve(chosen.map((d) => d.id))}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Approve selected ({chosen.length})
            </button>
            <button className={btn} disabled={!chosen.length} onClick={() => reject(chosen.map((d) => d.id))}>
              <XCircle className="w-3.5 h-3.5" /> Reject
            </button>
          </>
        )}
      </div>

      <div className="overflow-x-auto border border-[#E5E7EB] rounded-lg">
        <table className="w-full text-[12.5px]">
          <thead className="bg-[#F9FAFB] text-[#374151]">
            <tr>
              {show === "open" && (
                <th className="p-2 w-6">
                  <input type="checkbox" aria-label="Select all" checked={!!open.length && open.every((d) => sel.has(d.id))} onChange={(e) => setSel(e.target.checked ? new Set(open.map((d) => d.id)) : new Set())} />
                </th>
              )}
              <th className="p-2 text-left">Goes to · کہاں</th>
              <th className="p-2 text-left">Date · تاریخ</th>
              <th className="p-2 text-left">In / Out</th>
              <th className="p-2 text-right">Amount · رقم</th>
              <th className="p-2 text-left">How</th>
              <th className="p-2 text-left">Truck / trip · ٹرک</th>
              <th className="p-2 text-left">Party · پارٹی</th>
              <th className="p-2 text-left">For · کس لیے</th>
              <th className="p-2 text-left min-w-[180px]">Description · تفصیل</th>
              <th className="p-2 text-left min-w-[200px]">Check · دیکھیں</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((d) => {
              const editable = d.status === "pending" || d.status === "failed";
              const notes: string[] = Array.isArray(d.notes) ? d.notes : [];
              return (
                <tr key={d.id} className={`border-t border-[#F3F4F6] align-top ${d.status === "failed" ? "bg-[#FEF2F2]" : d.duplicate ? "bg-[#FFFBEB]" : ""}`}>
                  {show === "open" && (
                    <td className="p-2">
                      <input type="checkbox" aria-label={`Select draft ${d.id}`} checked={sel.has(d.id)} onChange={(e) => setSel((s) => { const n = new Set(s); e.target.checked ? n.add(d.id) : n.delete(d.id); return n; })} />
                    </td>
                  )}
                  <td className="p-2">
                    {editable ? (
                      <select className={input} value={d.target || ""} onChange={(e) => save(d, { target: e.target.value })}>
                        {TARGETS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                      </select>
                    ) : (
                      TARGETS.find((t) => t.v === d.target)?.l || d.target
                    )}
                  </td>
                  <td className="p-2">
                    {editable ? <input type="date" className={input} value={d.entry_date || ""} onChange={(e) => save(d, { entryDate: e.target.value })} /> : dmy(d.entry_date)}
                  </td>
                  <td className="p-2">
                    {editable ? (
                      <select className={input} value={d.direction || ""} onChange={(e) => save(d, { direction: e.target.value })}>
                        <option value="">?</option>
                        <option value="In">In · آیا</option>
                        <option value="Out">Out · گیا</option>
                      </select>
                    ) : (
                      d.direction
                    )}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {editable ? (
                      <input type="number" className={`${input} w-28 text-right`} defaultValue={d.amount} onBlur={(e) => Number(e.target.value) !== Number(d.amount) && save(d, { amount: e.target.value })} />
                    ) : (
                      PKR(Number(d.amount))
                    )}
                  </td>
                  <td className="p-2">
                    {editable ? (
                      <select className={input} value={d.method || "Cash"} onChange={(e) => save(d, { method: e.target.value })}>
                        {["Cash", "Bank", "Online", "Cheque"].map((m) => <option key={m}>{m}</option>)}
                      </select>
                    ) : (
                      d.method
                    )}
                  </td>
                  <td className="p-2 space-y-1">
                    {editable ? (
                      <>
                        <select className={`${input} max-w-[130px]`} value={d.vehicle_id || ""} onChange={(e) => save(d, { vehicleId: e.target.value || null, tripId: null })}>
                          <option value="">— no truck —</option>
                          {opts.trucks.map((t) => <option key={t.id} value={t.id}>{t.registration}</option>)}
                        </select>
                        {d.target === "trip" && (
                          <select className={`${input} block max-w-[180px]`} value={d.trip_id || ""} onChange={(e) => save(d, { tripId: e.target.value || null })}>
                            <option value="">— pick trip —</option>
                            {(trips[d.vehicle_id] || []).map((t: any) => <option key={t.id} value={t.id}>{t.label}</option>)}
                          </select>
                        )}
                      </>
                    ) : (
                      <>{d.truck || "—"}{d.trip ? <div className="text-[#6B7280]">{d.trip}</div> : null}</>
                    )}
                  </td>
                  <td className="p-2">
                    {editable && d.target !== "trip" ? (
                      <select className={`${input} max-w-[150px]`} value={d.party_id || ""} onChange={(e) => save(d, { partyId: e.target.value || null })}>
                        <option value="">— no party —</option>
                        {opts.parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    ) : (
                      d.party || (d.person === "personal" ? "Personal · شخصی" : "—")
                    )}
                  </td>
                  <td className="p-2">
                    {editable ? (
                      d.target === "trip" ? (
                        <select className={input} value={d.kind || "other"} onChange={(e) => save(d, { kind: e.target.value })}>
                          {KINDS.map((k) => <option key={k}>{k}</option>)}
                        </select>
                      ) : d.vehicle_id ? (
                        <select className={input} value={d.category || "Other"} onChange={(e) => save(d, { category: e.target.value })}>
                          {CATS.map((k) => <option key={k}>{k}</option>)}
                        </select>
                      ) : (
                        <span className="text-[#9CA3AF]">—</span>
                      )
                    ) : (
                      d.kind || d.category || "—"
                    )}
                  </td>
                  <td className="p-2">
                    {editable ? (
                      <input dir="auto" className={`${input} w-full`} defaultValue={d.description || ""} onBlur={(e) => e.target.value !== (d.description || "") && save(d, { description: e.target.value })} />
                    ) : (
                      <span dir="auto">{d.description}</span>
                    )}
                    <div className="text-[10px] text-[#9CA3AF] mt-0.5" title={d.source_text || ""}>
                      {d.source}{d.source_name ? ` · ${d.source_name}` : ""} · {d.read_by === "rules" ? "rules" : "AI"} · {d.confidence}
                    </div>
                  </td>
                  <td className="p-2 space-y-0.5">
                    {d.status === "failed" && <div className="text-[#991B1B] font-medium">✗ {d.error}</div>}
                    {notes.map((n, i) => (
                      <div key={i} className={/already|duplicate|پہلے سے/i.test(n) ? "text-[#92400E] font-medium" : "text-[#4B5563]"}>• {n}</div>
                    ))}
                    {d.status === "posted" && <div className="text-[#166534]">✓ posted {d.decided_at ? new Date(d.decided_at).toLocaleString("en-GB") : ""}</div>}
                    {!notes.length && editable && d.status !== "failed" && <div className="text-[#166534]">Looks complete · مکمل</div>}
                  </td>
                  <td className="p-2 whitespace-nowrap space-x-1">
                    {editable && (
                      <>
                        <button className={btnGreen} disabled={busy} onClick={() => approve([d.id])} title="Approve · منظور">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        </button>
                        <button className={btn} onClick={() => reject([d.id])} title="Reject · رد">
                          <XCircle className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                    {d.status === "posted" && (
                      <>
                        <button className={btn} onClick={() => openPosted(d)} title="Open the entry">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                        <button className={btn} onClick={() => undo(d)} title="Undo · واپس">
                          <Undo2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {!drafts.length && (
              <tr>
                <td colSpan={12} className="p-4 text-center text-[#6B7280]">No drafts here · یہاں کوئی مسودہ نہیں</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
// the PUT takes camelCase; the list shows snake_case columns
function toLocal(p: Record<string, any>) {
  const map: Record<string, string> = { entryDate: "entry_date", vehicleId: "vehicle_id", tripId: "trip_id", partyId: "party_id" };
  return Object.fromEntries(Object.entries(p).map(([k, v]) => [map[k] || k, v]));
}

// ================================================================== Categories
function Categories({ aiOn, showFeedback, onChanged }: { aiOn: boolean; showFeedback: Feedback; onChanged: () => void }) {
  const [status, setStatus] = useState("pending");
  const [filter, setFilter] = useState<{ proposed?: string; confidence?: string }>({});
  const [data, setData] = useState<any>({ rows: [], summary: [] });
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [allYears, setAllYears] = useState(false);
  const load = useCallback(() => {
    const q = new URLSearchParams({ status, ...(filter.proposed ? { proposed: filter.proposed } : {}), ...(filter.confidence ? { confidence: filter.confidence } : {}) });
    enterpriseFetch(`/api/ai-accountant/reclass?${q}`)
      .then(setData)
      .catch((e) => showFeedback("error", e.message));
  }, [status, filter, showFeedback]);
  useEffect(load, [load]);

  const propose = async (ai: boolean) => {
    setBusy(true);
    try {
      const r = await enterpriseFetch("/api/ai-accountant/reclass/propose", { method: "POST", body: JSON.stringify({ ai, all: allYears }) });
      showFeedback("success", `Looked at ${r.looked.toLocaleString()} rows: ${r.byRules} proposed by words${r.aiUsed ? `, ${r.byAi} by AI` : ""}; ${r.noProposal.toLocaleString()} left — the words do not say what they were for.`);
      load();
      onChanged();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(false);
    }
  };
  const act = async (what: "apply" | "reject" | "undo", body: any, label: string) => {
    if (!window.confirm(`${label}\n\nجاری رکھیں؟`)) return;
    setBusy(true);
    try {
      const r = await enterpriseFetch(`/api/ai-accountant/reclass/${what}`, { method: "POST", body: JSON.stringify(body) });
      showFeedback("success", what === "apply" ? `${r.applied} changed${r.skipped ? `, ${r.skipped} skipped (changed by hand, deleted, or in a closed month)` : ""} · تبدیل` : what === "undo" ? `${r.undone} put back · واپس` : `${r.rejected} rejected · رد`);
      setSel(new Set());
      load();
      onChanged();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(false);
    }
  };
  const ids = [...sel];

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-[#374151]">
        Truck-khata rows in <b>"Other"</b> go to a review account in the books, so the truck's profit is not split into diesel, tyres, toll… Here the system proposes a category from the
        words in each row. <b>Nothing changes until you apply it</b>; every change is in the audit log and can be put back.
      </p>
      <p className="text-[13px] text-[#374151]" dir="rtl" lang="ur">"دیگر" والی لائنوں کے لیے تجویز — جب تک آپ لاگو نہ کریں کچھ نہیں بدلتا، اور ہر تبدیلی واپس ہو سکتی ہے۔</p>
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} disabled={busy} onClick={() => propose(false)}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Tags className="w-3.5 h-3.5" />} Find proposals (by words)
        </button>
        <button className={btn} disabled={busy || !aiOn} onClick={() => propose(true)} title={aiOn ? "" : "Needs the AI key"}>
          <Sparkles className="w-3.5 h-3.5" /> …and ask the AI for the rest
        </button>
        <label className="text-xs inline-flex items-center gap-1">
          <input id="ai-acc-allyears" type="checkbox" checked={allYears} onChange={(e) => setAllYears(e.target.checked)} /> include rows before the books start
        </label>
        <div className="flex-1" />
        <select id="ai-acc-reclass-status" className={input} value={status} onChange={(e) => { setStatus(e.target.value); setSel(new Set()); setFilter({}); }}>
          <option value="pending">Proposed · تجویز</option>
          <option value="applied">Applied · لاگو</option>
          <option value="rejected">Rejected · رد</option>
          <option value="undone">Put back · واپس</option>
        </select>
      </div>

      {!!data.summary.length && (
        <div className="overflow-x-auto border border-[#E5E7EB] rounded-lg">
          <table className="w-full text-[12.5px]">
            <thead className="bg-[#F9FAFB]">
              <tr>
                <th className="p-2 text-left">Proposed category</th>
                <th className="p-2 text-left">Confidence</th>
                <th className="p-2 text-right">Rows</th>
                <th className="p-2 text-right">Amount</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.summary.map((s: any) => (
                <tr key={s.proposed + s.confidence} className={`border-t border-[#F3F4F6] ${filter.proposed === s.proposed && filter.confidence === s.confidence ? "bg-[#F0FDF4]" : ""}`}>
                  <td className="p-2 font-medium">{s.proposed}</td>
                  <td className="p-2">{s.confidence}</td>
                  <td className="p-2 text-right tabular-nums">{s.rows.toLocaleString()}</td>
                  <td className="p-2 text-right tabular-nums">{PKR(Number(s.amount))}</td>
                  <td className="p-2 whitespace-nowrap space-x-1 text-right">
                    <button className={btn} onClick={() => setFilter({ proposed: s.proposed, confidence: s.confidence })}>See rows</button>
                    {status === "pending" && (
                      <button className={btnGreen} disabled={busy} onClick={() => act("apply", { proposed: s.proposed, confidence: [s.confidence] }, `Change ${s.rows} row(s) from "Other" to "${s.proposed}" (${s.confidence} confidence, ${PKR(Number(s.amount))})?`)}>
                        Apply all
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-[#6B7280]">
          {data.rows.length.toLocaleString()} row(s){filter.proposed ? ` · ${filter.proposed} / ${filter.confidence}` : ""}{data.rows.length >= 1000 ? " (first 1,000)" : ""}
        </span>
        {filter.proposed && <button className={btn} onClick={() => setFilter({})}>Show all</button>}
        <div className="flex-1" />
        {status === "pending" && (
          <>
            <button className={btnGreen} disabled={busy || !ids.length} onClick={() => act("apply", { ids }, `Apply ${ids.length} selected proposal(s)?`)}>Apply selected ({ids.length})</button>
            <button className={btn} disabled={busy || !ids.length} onClick={() => act("reject", { ids }, `Reject ${ids.length} proposal(s)? The rows stay "Other".`)}>Reject selected</button>
          </>
        )}
        {status === "applied" && (
          <button className={btn} disabled={busy || !ids.length} onClick={() => act("undo", { ids }, `Put ${ids.length} row(s) back to their old category?`)}>
            <Undo2 className="w-3.5 h-3.5" /> Put back selected ({ids.length})
          </button>
        )}
      </div>
      <div className="overflow-x-auto border border-[#E5E7EB] rounded-lg max-h-[560px] overflow-y-auto">
        <table className="w-full text-[12.5px]">
          <thead className="bg-[#F9FAFB] sticky top-0">
            <tr>
              <th className="p-2 w-6">
                <input type="checkbox" aria-label="Select all" checked={!!data.rows.length && data.rows.every((r: any) => sel.has(r.id))} onChange={(e) => setSel(e.target.checked ? new Set(data.rows.map((r: any) => r.id)) : new Set())} />
              </th>
              <th className="p-2 text-left">Date</th>
              <th className="p-2 text-left">Truck</th>
              <th className="p-2 text-left">Description</th>
              <th className="p-2 text-right">In</th>
              <th className="p-2 text-right">Out</th>
              <th className="p-2 text-left">Proposed</th>
              <th className="p-2 text-left">Why</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r: any) => (
              <tr key={r.id} className="border-t border-[#F3F4F6]">
                <td className="p-2">
                  <input type="checkbox" aria-label={`Select ${r.id}`} checked={sel.has(r.id)} onChange={(e) => setSel((s) => { const n = new Set(s); e.target.checked ? n.add(r.id) : n.delete(r.id); return n; })} />
                </td>
                <td className="p-2 whitespace-nowrap">{dmy(r.date)}</td>
                <td className="p-2 whitespace-nowrap">{r.truck}</td>
                <td className="p-2" dir="auto">{r.description}</td>
                <td className="p-2 text-right tabular-nums">{Number(r.received) ? Number(r.received).toLocaleString() : ""}</td>
                <td className="p-2 text-right tabular-nums">{Number(r.paid) ? Number(r.paid).toLocaleString() : ""}</td>
                <td className="p-2 whitespace-nowrap">
                  <b>{r.proposed}</b> <span className="text-[#6B7280]">({r.confidence}{r.by_ai ? ", AI" : ""})</span>
                </td>
                <td className="p-2 text-[#4B5563]" dir="auto">{r.reason}</td>
              </tr>
            ))}
            {!data.rows.length && (
              <tr>
                <td colSpan={8} className="p-4 text-center text-[#6B7280]">Nothing here — press "Find proposals" · کوئی تجویز نہیں</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ================================================================== Ask
const SUGGEST = [
  "Is saal ab tak munafa kitna hai?",
  "Kaun se truck nuqsan mein hain?",
  "Kin parties se paise lene hain, sab se zyada kis se?",
  "Pichhle mahine diesel par kitna kharcha hua?",
  "How much cash should be in hand today?",
];
function Ask({ aiOn, showFeedback }: { aiOn: boolean; showFeedback: Feedback }) {
  const [q, setQ] = useState("");
  const [chat, setChat] = useState<Array<{ q: string; a: string; used?: any[] }>>([]);
  const [busy, setBusy] = useState(false);
  const ask = async (question: string) => {
    if (!question.trim()) return;
    setBusy(true);
    try {
      const r = await enterpriseFetch("/api/ai-accountant/ask", { method: "POST", body: JSON.stringify({ question, history: chat.slice(-4) }) });
      setChat((c) => [...c, { q: question, a: r.answer, used: r.used }]);
      setQ("");
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(false);
    }
  };
  if (!aiOn)
    return (
      <div className="border border-[#FCD34D] bg-[#FFFBEB] rounded-lg p-3 text-[13px] text-[#92400E]">
        Asking questions needs the AI switched on (ANTHROPIC_API_KEY or GEMINI_API_KEY in the server settings). Until then the figures are in Statements, Books and the ledgers.
        <div dir="rtl" lang="ur">سوال پوچھنے کے لیے اے آئی کی چابی لگانی ہوگی۔</div>
      </div>
    );
  return (
    <div className="space-y-3 max-w-3xl">
      <div className="flex flex-wrap gap-1.5">
        {SUGGEST.map((s) => (
          <button key={s} className={btn} disabled={busy} onClick={() => ask(s)}>{s}</button>
        ))}
      </div>
      <div className="space-y-3">
        {chat.map((m, i) => (
          <div key={i} className="space-y-1">
            <div className="text-[13px] font-semibold" dir="auto">🙋 {m.q}</div>
            <div className="text-[13px] whitespace-pre-wrap border border-[#E5E7EB] rounded-lg p-3 bg-white leading-6" dir="auto">{m.a}</div>
            {!!m.used?.length && <div className="text-[10px] text-[#9CA3AF]">looked at: {m.used.map((u) => u.tool).join(", ")}</div>}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          id="ai-acc-question"
          dir="auto"
          className="flex-1 border border-[#D1D5DB] rounded-lg px-3 py-2 text-[13px]"
          placeholder="Ask about the books · حساب کے بارے میں پوچھیں"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && ask(q)}
        />
        <button className={btnGreen} disabled={busy} onClick={() => ask(q)}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Ask
        </button>
      </div>
      <div className="text-[11px] text-[#6B7280]">The AI only reads the books to answer — it cannot change anything. Check important figures in Statements before acting on them.</div>
    </div>
  );
}

// ================================================================== Monthly report
function Report({ aiOn, showFeedback }: { aiOn: boolean; showFeedback: Feedback }) {
  const prevMonth = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 7);
  }, []);
  const [month, setMonth] = useState(prevMonth);
  const [list, setList] = useState<any[]>([]);
  const [cur, setCur] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    enterpriseFetch("/api/ai-accountant/reports").then((r) => setList(r.reports)).catch(() => {});
  }, []);
  useEffect(load, [load]);
  const make = async () => {
    setBusy(true);
    try {
      const r = await enterpriseFetch("/api/ai-accountant/report", { method: "POST", body: JSON.stringify({ month }) });
      setCur(r);
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(false);
    }
  };
  const view = (id: number) => enterpriseFetch(`/api/ai-accountant/reports/${id}`).then(setCur).catch((e) => showFeedback("error", e.message));
  const del = async (id: number) => {
    if (!window.confirm("Delete this saved report? (The books are not touched.)")) return;
    await enterpriseFetch(`/api/ai-accountant/reports/${id}`, { method: "DELETE" }).catch(() => {});
    if (cur?.id === id) setCur(null);
    load();
  };
  const print = () => {
    if (!cur) return;
    const w = window.open("", "_blank");
    if (!w) return;
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(cur.title || "Report")}</title><body style="font-family:Arial,sans-serif;max-width:760px;margin:24px auto;line-height:1.6"><h2>HFK Enterprises (Pvt) Ltd — ${esc(cur.title || "")}</h2><pre style="white-space:pre-wrap;font-family:inherit">${esc(cur.narrative || "")}</pre></body>`);
    w.document.close();
    w.print();
  };
  const d = cur?.data;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input id="ai-acc-month" type="month" className={input} value={month} onChange={(e) => setMonth(e.target.value)} />
        <button className={btnGreen} disabled={busy} onClick={make}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />} Write the report · رپورٹ لکھیں
        </button>
        {!aiOn && <span className="text-[11px] text-[#92400E]">AI off — a short report from the figures</span>}
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="basis-56 grow-0 shrink-0 space-y-1">
          {list.map((r) => (
            <div key={r.id} className={`flex items-center gap-1 text-xs border rounded px-2 py-1 ${cur?.id === r.id ? "border-[#24539B] bg-[#F0FDF4]" : "border-[#E5E7EB]"}`}>
              <div role="button" tabIndex={0} className="flex-1 cursor-pointer" onClick={() => view(r.id)} onKeyDown={(e) => e.key === "Enter" && view(r.id)}>
                {r.period} <span className="text-[#9CA3AF]">· {new Date(r.created_at).toLocaleDateString("en-GB")}</span>
              </div>
              <button aria-label="Delete report" onClick={() => del(r.id)} className="text-[#9CA3AF] hover:text-[#991B1B]"><Trash2 className="w-3 h-3" /></button>
            </div>
          ))}
          {!list.length && <div className="text-xs text-[#6B7280]">No reports yet.</div>}
        </div>
        {cur && (
          <div className="flex-1 min-w-0 basis-96 space-y-2">
            <div className="flex items-center gap-2">
              <div className="font-semibold text-sm flex-1">{cur.title}</div>
              <button className={btn} onClick={() => navigator.clipboard?.writeText(cur.narrative || "")}><Copy className="w-3.5 h-3.5" /> Copy</button>
              <button className={btn} onClick={print}><Printer className="w-3.5 h-3.5" /> Print</button>
            </div>
            {d && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                {[["Income · آمدنی", d.income], ["Expenses · خرچ", d.expenses], [d.profit >= 0 ? "Profit · منافع" : "Loss · نقصان", d.profit], ["Last month · پچھلا", d.previous?.profit]].map(([l, v]: any) => (
                  <div key={l} className="border border-[#E5E7EB] rounded-lg p-2">
                    <div className="text-[#6B7280]">{l}</div>
                    <div className="font-semibold tabular-nums">{PKR(v)}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="whitespace-pre-wrap text-[13px] leading-6 border border-[#E5E7EB] rounded-lg p-3 bg-white" dir="auto">{cur.narrative}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ================================================================== Reminders
function Reminders({ showFeedback }: { showFeedback: Feedback }) {
  const [list, setList] = useState<any[]>([]);
  const [urdu, setUrdu] = useState(false);
  useEffect(() => {
    enterpriseFetch("/api/ai-accountant/reminders").then((r) => setList(r.parties)).catch((e) => showFeedback("error", e.message));
  }, [showFeedback]);
  const wa = (phone: string | null, text: string) => {
    const digits = String(phone || "").replace(/\D/g, "");
    const intl = digits.startsWith("0") ? "92" + digits.slice(1) : digits;
    return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
  };
  const total = list.reduce((s, p) => s + p.balance, 0);
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-[#374151]">
        Parties whose ledger says they owe HFK — {list.length} parties, {PKR(total)}. The message is ready; <b>you</b> send it (copy, or open WhatsApp). Check the balance first — a party
        ledger with undated or wrong rows gives a wrong figure.
      </p>
      <label className="text-xs inline-flex items-center gap-1">
        <input id="ai-acc-urdu" type="checkbox" checked={urdu} onChange={(e) => setUrdu(e.target.checked)} /> Message in Urdu script · اردو میں
      </label>
      <div className="overflow-x-auto border border-[#E5E7EB] rounded-lg">
        <table className="w-full text-[12.5px]">
          <thead className="bg-[#F9FAFB]">
            <tr>
              <th className="p-2 text-left">Party</th>
              <th className="p-2 text-right">Owes HFK</th>
              <th className="p-2 text-left">Last payment</th>
              <th className="p-2 text-left min-w-[320px]">Message</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => {
              const text = urdu ? p.message.urdu : p.message.roman;
              return (
                <tr key={p.id} className="border-t border-[#F3F4F6] align-top">
                  <td className="p-2 font-medium" dir="auto">{p.name}<div className="text-[#9CA3AF] font-normal">{p.phone || "no phone"}</div></td>
                  <td className="p-2 text-right tabular-nums">{PKR(p.balance)}</td>
                  <td className="p-2">{dmy(p.last_payment)}</td>
                  <td className="p-2 text-[#374151]" dir="auto">{text}</td>
                  <td className="p-2 whitespace-nowrap space-x-1">
                    <button className={btn} onClick={() => { navigator.clipboard?.writeText(text); showFeedback("success", "Copied · کاپی"); }}><Copy className="w-3.5 h-3.5" /></button>
                    {p.phone && <a className={btn} href={wa(p.phone, text)} target="_blank" rel="noreferrer">WhatsApp</a>}
                  </td>
                </tr>
              );
            })}
            {!list.length && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-[#6B7280]">No party owes HFK · کوئی بقایا نہیں</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ================================================================== what stays with people
function YourPart() {
  const done = [
    ["Writing entries from what you type, say, photograph or upload (drafts you approve)", "جو آپ لکھیں، بولیں یا تصویر بھیجیں، اس کے اندراج"],
    ["Double entry, trial balance, P&L, Balance Sheet, Cash Flow — built by the books engine", "ڈبل انٹری اور تمام حسابات خود بنتے ہیں"],
    ["Finding mistakes (Books Check) and possible double entries", "غلطیاں اور دوہرے اندراج ڈھونڈنا"],
    ["Sorting khata rows into categories (you apply)", "کھاتے کی کیٹیگری لگانا"],
    ["Matching bank statements to the books", "بینک اسٹیٹمنٹ ملانا"],
    ["Answering questions from the books, the monthly report, reminders to parties", "سوالوں کے جواب، ماہانہ رپورٹ، یاد دہانی"],
    ["Tax registers and the year's figures for the consultant", "ٹیکس رجسٹر اور سال کے اعداد"],
  ];
  const people = [
    ["Tell the system what happened — every payment, receipt, diesel, kharcha (a sentence, a voice note or a photo is enough)", "ہر لین دین سسٹم کو بتانا — ایک جملہ، آواز یا تصویر کافی ہے", "Daily · روزانہ"],
    ["Approve or correct the AI's drafts — the AI can misread a slip", "اے آئی کے مسودے منظور یا درست کرنا", "Daily · روزانہ"],
    ["Count the cash in the drawer and write the count", "گلے کا کیش گننا", "Daily · روزانہ"],
    ["Keep the papers: slips, bills, bilty, bank receipts (attach them)", "پرچیاں، بل، بلٹی سنبھالنا اور لگانا", "Daily · روزانہ"],
    ["Download each bank's statement and upload it", "ہر بینک کی اسٹیٹمنٹ ڈاؤن لوڈ کر کے لگانا", "Weekly / monthly · ماہانہ"],
    ["Give dates to old rows without dates, decide what old imported sheets are", "پرانی بغیر تاریخ لائنوں کو تاریخ دینا", "Once · ایک بار"],
    ["Send reminders and talk to parties about money", "پارٹیوں سے بات اور یاد دہانی بھیجنا", "As needed"],
    ["Pay: banks, FBR, salaries, partners — the system never moves money", "ادائیگی کرنا — سسٹم پیسے نہیں بھیجتا", "As needed"],
    ["Close each month after checking it", "ہر مہینہ چیک کر کے بند کرنا", "Monthly · ماہانہ"],
  ];
  const ca = [
    ["Tax rates and filing: withholding statements, sales tax, income tax return", "ٹیکس ریٹ اور گوشوارے"],
    ["Signing the annual accounts; the statutory audit of a (Pvt) Ltd company; SECP returns", "سالانہ حسابات پر دستخط، آڈٹ، ایس ای سی پی"],
    ["Decisions: opening equity split, trucks as fixed assets & depreciation, partner accounting", "اکاؤنٹنگ کے فیصلے"],
  ];
  return (
    <div className="space-y-4 max-w-4xl">
      <section className="space-y-1">
        <h3 className="text-sm font-semibold text-[#166534]">The system does · سسٹم کرتا ہے</h3>
        {done.map(([e, u]) => (
          <div key={e} className="text-[13px] flex gap-2"><CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" /><span>{e} <span className="text-[#6B7280]" dir="rtl" lang="ur">· {u}</span></span></div>
        ))}
      </section>
      <section className="space-y-1">
        <h3 className="text-sm font-semibold text-[#92400E]">A person in the office does (no accounting knowledge needed) · دفتر کا آدمی</h3>
        {people.map(([e, u, when]) => (
          <div key={e} className="text-[13px] flex gap-2"><UserCheck className="w-4 h-4 text-[#D97706] shrink-0 mt-0.5" /><span>{e} <span className="text-[#6B7280]" dir="rtl" lang="ur">· {u}</span> <span className="text-[11px] text-[#9CA3AF]">({when})</span></span></div>
        ))}
      </section>
      <section className="space-y-1">
        <h3 className="text-sm font-semibold text-[#1E3A6E]">The chartered accountant / tax consultant does (a few times a year) · ٹیکس کنسلٹنٹ</h3>
        {ca.map(([e, u]) => (
          <div key={e} className="text-[13px] flex gap-2"><Info className="w-4 h-4 text-[#24539B] shrink-0 mt-0.5" /><span>{e} <span className="text-[#6B7280]" dir="rtl" lang="ur">· {u}</span></span></div>
        ))}
      </section>
    </div>
  );
}
