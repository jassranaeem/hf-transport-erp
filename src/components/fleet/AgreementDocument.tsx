/**
 * The lease-to-own agreement as a document · معاہدہ — on the company letterhead, every term
 * written out in English and Urdu: the two parties, the truck, the price / advance / balance, how
 * it is paid (each trip's net), what happens when it is paid (partnership), the signatures, the
 * witnesses — and the company's authorisation, which only an administrator can give and which is
 * cleared if a term is changed afterwards.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Printer, X, Loader2, ShieldCheck, FilePenLine, AlertTriangle, Plus, Trash2, RotateCcw } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";
import { rupeesInWords } from "../../lib/share.ts";

const money = (n: number) => "PKR " + Math.round(n || 0).toLocaleString("en-PK");
const dmy = (d?: string | null) => (d ? String(d).slice(0, 10).split("-").reverse().join(".") : "__________");
const has = (v?: string | number | null) => !!v && String(v).trim() !== "" && String(v).trim().toUpperCase() !== "TBD"; // "TBD" is an unfilled import value
const blank = (v?: string | number | null, w = 22) => (has(v) ? String(v) : "_".repeat(w));

type Clause = { en: string; ur: string };

/** The standard terms, written from the agreement's own figures. */
export function standardClauses(a: any, company: string, doc: any): Clause[] {
  const price = Number(a.agreed_price || 0);
  const adv = Number(a.advance_paid || 0);
  const bal = Number(a.opening_balance || 0);
  const share = Number(a.company_share_percent ?? 100);
  const check = Number(a.expense_ratio_benchmark ?? 55);
  const k = Number(doc?.partnershipPercent || 50);
  const place = doc?.place || "Quetta";
  const n = (x: number) => Math.round(x).toLocaleString("en-PK");
  return [
    {
      en: `Ownership. The Truck remains one hundred percent (100%) the property of the Company until the whole Price is paid. Until then its registration and documents stay in the Company's name and keeping.`,
      ur: `ملکیت: جب تک پوری قیمت ادا نہیں ہو جاتی، ٹرک سو فیصد (100%) کمپنی کی ملکیت رہے گا۔ اس وقت تک ٹرک کی رجسٹریشن اور کاغذات کمپنی کے نام اور قبضے میں رہیں گے۔`,
    },
    {
      en: `Price. The agreed price of the Truck is PKR ${n(price)} (${rupeesInWords(price)}). ${adv > 0 ? `The Second Party has paid an advance of PKR ${n(adv)} (${rupeesInWords(adv)}).` : "No advance has been paid."} The balance to be paid is PKR ${n(bal)} (${rupeesInWords(bal)}).`,
      ur: `قیمت: ٹرک کی طے شدہ قیمت ${n(price)} روپے ہے۔ ${adv > 0 ? `فریقِ دوم نے ${n(adv)} روپے پیشگی (ایڈوانس) ادا کر دیے ہیں۔` : "کوئی پیشگی رقم ادا نہیں کی گئی۔"} باقی واجب الادا رقم ${n(bal)} روپے ہے۔`,
    },
    {
      en: `Payment from the trips. The Second Party will run the Truck on the routes. After every trip, the trip's earnings (freight) less the trip's expenses is the net; ${share === 100 ? "the whole of the net" : `${share}% of the net`} is paid to the Company towards the Price. Each such payment is one instalment (qist). The Second Party may also pay any amount in cash or through a bank at any time.`,
      ur: `ادائیگی کا طریقہ: فریقِ دوم ٹرک کو روٹ پر چلائے گا۔ ہر ٹرپ کے بعد کرایہ میں سے ٹرپ کا خرچہ نکال کر جو بچت ہوگی، ${share === 100 ? "وہ پوری بچت" : `اس بچت کا ${share} فیصد`} ٹرک کی قیمت کی مد میں کمپنی کو ادا کی جائے گی۔ ہر ایسی ادائیگی ایک قسط شمار ہوگی۔ فریقِ دوم کسی بھی وقت نقد یا بینک کے ذریعے بھی رقم ادا کر سکتا ہے۔`,
    },
    {
      en: `Trip expenses. The expenses of a trip (diesel, tolls, food, loading and repairs on the way) are paid out of that trip's earnings and are shown to the Company with their slips. If the expenses of a trip are more than ${check}% of its earnings, the Second Party will explain them to the Company.`,
      ur: `ٹرپ کے اخراجات: ٹرپ کے اخراجات (ڈیزل، ٹول، خوراک، لوڈنگ اور راستے کی مرمت) اسی ٹرپ کے کرایہ سے ادا ہوں گے اور ان کی رسیدیں کمپنی کو دکھائی جائیں گی۔ اگر کسی ٹرپ کا خرچہ اس کے کرایہ کے ${check} فیصد سے زیادہ ہو تو فریقِ دوم اس کی وضاحت کمپنی کو دے گا۔`,
    },
    {
      en: `Record. The Company's account of each trip's earnings, expenses and instalments is the record of what has been paid and what remains. The Second Party may ask for a statement of this account at any time.`,
      ur: `حساب کا ریکارڈ: ہر ٹرپ کے کرایہ، اخراجات اور قسطوں کا جو حساب کمپنی کے پاس درج ہے وہی ادا شدہ اور باقی رقم کا ریکارڈ ہوگا۔ فریقِ دوم کسی بھی وقت اس حساب کا گوشوارہ طلب کر سکتا ہے۔`,
    },
    {
      en: `After full payment. On the day the whole Price is paid, the Second Party becomes a ${k}% partner in the Truck and the Company keeps ${100 - k}%. From that day the Truck's profit and loss are shared in that proportion.`,
      ur: `پوری ادائیگی کے بعد: جس دن پوری قیمت ادا ہو جائے گی، فریقِ دوم ٹرک میں ${k} فیصد کا شریک بن جائے گا اور کمپنی کا حصہ ${100 - k} فیصد رہے گا۔ اس دن سے ٹرک کا نفع اور نقصان اسی تناسب سے تقسیم ہوگا۔`,
    },
    {
      en: `Until the Price is paid, the Second Party will not sell, pledge, hand over or give the Truck on hire to anyone else, and will keep it in good running order.`,
      ur: `جب تک قیمت ادا نہیں ہو جاتی، فریقِ دوم ٹرک کو نہ فروخت کرے گا، نہ گروی رکھے گا، نہ کسی اور کے حوالے کرے گا اور نہ کرائے پر دے گا، اور ٹرک کو چالو اور اچھی حالت میں رکھے گا۔`,
    },
    {
      en: `Any dispute under this agreement is subject to the jurisdiction of the courts at ${place}.`,
      ur: `اس معاہدے سے متعلق کوئی بھی تنازعہ ${place} کی عدالتوں کے دائرۂ اختیار میں ہوگا۔`,
    },
  ];
}

export default function AgreementDocument({ agreementId, onClose, showFeedback }: { agreementId: number; onClose: () => void; showFeedback: (t: "success" | "error", m: string) => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [auth, setAuth] = useState<{ open: boolean; name: string; title: string }>({ open: false, name: "", title: "" });

  const load = () =>
    enterpriseFetch(`/api/partnerships/agreements/${agreementId}/document`)
      .then((r) => {
        setD(r);
        const doc = r.agreement.doc || {};
        setF({
          fatherName: doc.fatherName || "",
          place: doc.place || "Quetta",
          partnershipPercent: String(doc.partnershipPercent || 50),
          signatoryName: doc.signatoryName || "",
          signatoryTitle: doc.signatoryTitle || "",
          witnesses: [0, 1].map((i) => ({ name: doc.witnesses?.[i]?.name || "", cnic: doc.witnesses?.[i]?.cnic || "" })),
          guarantor: { name: doc.guarantor?.name || "", cnic: doc.guarantor?.cnic || "", phone: doc.guarantor?.phone || "" },
          partner: { cnic: r.agreement.partner_cnic || "", phone: r.agreement.partner_phone || "", address: r.agreement.partner_address || "" },
          clauses: Array.isArray(doc.clauses) && doc.clauses.length ? doc.clauses : null,
        });
      })
      .catch((e) => setErr(e.message));
  useEffect(() => {
    load();
  }, [agreementId]); // eslint-disable-line react-hooks/exhaustive-deps

  const a = d?.agreement;
  const c = d?.company || {};
  const doc = a?.doc || {};
  const company = c.legal_name || c.trade_name || "HFK Enterprises (Pvt) Ltd";
  const clauses: Clause[] = useMemo(() => (a ? (Array.isArray(doc.clauses) && doc.clauses.length ? doc.clauses : standardClauses(a, company, doc)) : []), [a, company]); // eslint-disable-line react-hooks/exhaustive-deps
  const authorised = !!a?.authorized_at;
  const missing = a
    ? [
        !has(a.partner_cnic) && "the driver's CNIC",
        !doc.fatherName && "father's name",
        !a.partner_address && "the driver's address",
        !has(a.chassis_number) && "the truck's chassis number (Fleet Desk → Trucks)",
        !has(a.engine_number) && "the truck's engine number (Fleet Desk → Trucks)",
        !(doc.witnesses?.[0]?.name && doc.witnesses?.[1]?.name) && "two witnesses",
        Number(a.agreed_price) - Number(a.advance_paid) !== Number(a.opening_balance) && "price − advance does not equal the balance (Edit agreement)",
      ].filter(Boolean)
    : [];

  const save = async () => {
    setBusy(true);
    try {
      const r = await enterpriseFetch(`/api/partnerships/agreements/${agreementId}/document`, { method: "PUT", body: JSON.stringify(f) });
      showFeedback("success", r.authorisationCleared ? "Saved — the terms changed, so it must be authorised again · دوبارہ منظوری درکار" : "Saved · محفوظ");
      setEditing(false);
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(false);
    }
  };
  const authorise = async () => {
    setBusy(true);
    try {
      await enterpriseFetch(`/api/partnerships/agreements/${agreementId}/authorize`, { method: "POST", body: JSON.stringify({ name: auth.name, title: auth.title }) });
      showFeedback("success", "Authorised · منظور شدہ");
      setAuth({ ...auth, open: false });
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(false);
    }
  };
  const unauthorise = async () => {
    if (!window.confirm("Remove the authorisation from this agreement? · منظوری ہٹائیں؟")) return;
    await enterpriseFetch(`/api/partnerships/agreements/${agreementId}/unauthorize`, { method: "POST", body: "{}" }).catch((e) => showFeedback("error", e.message));
    load();
  };

  const lbl = "flex flex-col gap-1 text-[11.5px] font-medium text-[#4B5563]";
  const inp = "border border-[#CBD5E1] rounded-lg px-3 py-2 text-[13px] bg-white";
  const editClauses: Clause[] = f?.clauses || (a ? standardClauses(a, company, { ...doc, partnershipPercent: Number(f?.partnershipPercent) || 50, place: f?.place }) : []);
  const setClause = (i: number, patch: Partial<Clause>) => setF({ ...f, clauses: editClauses.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(15,23,42,.45)] flex items-start justify-center overflow-y-auto p-4 print:p-0 print:bg-white print:static">
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm; }
          body * { visibility: hidden !important; }
          #agreement-doc, #agreement-doc * { visibility: visible !important; }
          #agreement-doc { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none !important; border-radius: 0 !important; padding: 0 !important; }
          #agreement-doc .clause, #agreement-doc .sign { page-break-inside: avoid; }
          .no-print { display: none !important; }
        }
      `}</style>
      <div className="w-full max-w-4xl my-6 print:my-0">
        {/* controls */}
        <div className="no-print bg-white rounded-xl border border-[#E3E8EF] p-3 mb-3 flex flex-wrap items-center gap-2">
          <div className={`rounded-full px-3 py-1 text-[12px] font-semibold ${authorised ? "bg-[#DCFCE7] text-[#166534]" : "bg-[#FEF3C7] text-[#92400E]"}`}>
            {authorised ? `Authorised by ${a.authorized_by_name}${a.authorized_by_title ? `, ${a.authorized_by_title}` : ""} · ${dmy(a.authorized_day)}` : "Draft — not authorised yet · ابھی منظور نہیں"}
          </div>
          <div className="flex-1" />
          <button onClick={() => setEditing((e) => !e)} disabled={!d} className="inline-flex items-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-white text-[13px] px-3 py-2 hover:bg-[#F4F6FA]">
            <FilePenLine className="w-4 h-4" /> Details &amp; terms · تفصیل
          </button>
          {d?.canAuthorise &&
            (authorised ? (
              <button onClick={unauthorise} className="inline-flex items-center gap-1.5 rounded-lg border border-[#FECACA] text-[#B91C1C] bg-white text-[13px] px-3 py-2">Remove authorisation</button>
            ) : (
              <button onClick={() => setAuth({ open: true, name: doc.signatoryName || d.me.name || "", title: doc.signatoryTitle || "" })} className="inline-flex items-center gap-1.5 rounded-lg text-white text-[13px] font-medium px-3 py-2" style={{ backgroundColor: "#166534", color: "#fff" }}>
                <ShieldCheck className="w-4 h-4" /> Authorise · منظور کریں
              </button>
            ))}
          <button onClick={() => window.print()} disabled={!d} className="inline-flex items-center gap-1.5 rounded-lg bg-[#24539B] text-white text-[13px] font-medium px-3.5 py-2" title="Opens the print window — choose “Save as PDF” to get the file">
            <Printer className="w-4 h-4" /> Print / PDF
          </button>
          <button onClick={onClose} className="p-2 rounded-lg text-[#6B7280] hover:bg-[#F1F4F9]"><X className="w-5 h-5" /></button>
        </div>

        {!authorised && d && !d.canAuthorise && (
          <div className="no-print rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 mb-3">Only an administrator can authorise an agreement for the company. Until then it prints as a draft.</div>
        )}
        {missing.length > 0 && (
          <div className="no-print rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 mb-3">
            <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
            Still blank (they print as a line to fill by hand): {missing.join(" · ")}
          </div>
        )}

        {auth.open && (
          <div className="no-print bg-white rounded-xl border border-[#BBF7D0] p-4 mb-3">
            <div className="text-[13px] font-semibold text-[#14532D] mb-2">Authorise this agreement for {company}</div>
            <div className="flex flex-wrap items-end gap-3">
              <label className={lbl}>Authorised by (name)<input value={auth.name} onChange={(e) => setAuth({ ...auth, name: e.target.value })} className={inp} /></label>
              <label className={lbl}>Position<input value={auth.title} onChange={(e) => setAuth({ ...auth, title: e.target.value })} className={inp} placeholder="Chief Executive / Director" /></label>
              <button onClick={authorise} disabled={busy || !auth.name.trim()} className="rounded-lg text-white text-[13px] font-medium px-3.5 py-2 disabled:opacity-50" style={{ backgroundColor: "#166534", color: "#fff" }}>
                {busy ? "…" : "Authorise"}
              </button>
              <button onClick={() => setAuth({ ...auth, open: false })} className="rounded-lg border border-[#CBD5E1] bg-white text-[13px] px-3.5 py-2">Cancel</button>
            </div>
            <p className="text-[11.5px] text-[#6B7280] mt-2">Your name, the date and time are recorded. If a term is changed afterwards the authorisation is removed and it must be authorised again.</p>
          </div>
        )}

        {editing && f && (
          <div className="no-print bg-white rounded-xl border border-[#C9D7EC] p-4 mb-3 space-y-4">
            <div>
              <div className="text-[13px] font-semibold text-[#1F2937] mb-2">The second party (driver) · فریقِ دوم</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <label className={lbl}>Father's name · ولدیت<input value={f.fatherName} onChange={(e) => setF({ ...f, fatherName: e.target.value })} className={inp} dir="auto" /></label>
                <label className={lbl}>CNIC<input value={f.partner.cnic} onChange={(e) => setF({ ...f, partner: { ...f.partner, cnic: e.target.value } })} className={inp} placeholder="00000-0000000-0" /></label>
                <label className={lbl}>Phone<input value={f.partner.phone} onChange={(e) => setF({ ...f, partner: { ...f.partner, phone: e.target.value } })} className={inp} /></label>
                <label className={lbl}>Address · پتہ<input value={f.partner.address} onChange={(e) => setF({ ...f, partner: { ...f.partner, address: e.target.value } })} className={inp} dir="auto" /></label>
              </div>
            </div>
            <div>
              <div className="text-[13px] font-semibold text-[#1F2937] mb-2">Signing · دستخط</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <label className={lbl}>Signs for the company<input value={f.signatoryName} onChange={(e) => setF({ ...f, signatoryName: e.target.value })} className={inp} dir="auto" /></label>
                <label className={lbl}>His position<input value={f.signatoryTitle} onChange={(e) => setF({ ...f, signatoryTitle: e.target.value })} className={inp} placeholder="Chief Executive" /></label>
                <label className={lbl}>Place<input value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} className={inp} /></label>
                <label className={lbl}>His share once paid (%)<input inputMode="numeric" value={f.partnershipPercent} onChange={(e) => setF({ ...f, partnershipPercent: e.target.value.replace(/\D/g, "") })} className={inp} /></label>
                {[0, 1].map((i) => (
                  <React.Fragment key={i}>
                    <label className={lbl}>Witness {i + 1} · گواہ<input value={f.witnesses[i].name} onChange={(e) => setF({ ...f, witnesses: f.witnesses.map((w: any, j: number) => (j === i ? { ...w, name: e.target.value } : w)) })} className={inp} dir="auto" /></label>
                    <label className={lbl}>Witness {i + 1} CNIC<input value={f.witnesses[i].cnic} onChange={(e) => setF({ ...f, witnesses: f.witnesses.map((w: any, j: number) => (j === i ? { ...w, cnic: e.target.value } : w)) })} className={inp} /></label>
                  </React.Fragment>
                ))}
                <label className={lbl}>Guarantor (optional) · ضامن<input value={f.guarantor.name} onChange={(e) => setF({ ...f, guarantor: { ...f.guarantor, name: e.target.value } })} className={inp} dir="auto" /></label>
                <label className={lbl}>Guarantor CNIC<input value={f.guarantor.cnic} onChange={(e) => setF({ ...f, guarantor: { ...f.guarantor, cnic: e.target.value } })} className={inp} /></label>
                <label className={lbl}>Guarantor phone<input value={f.guarantor.phone} onChange={(e) => setF({ ...f, guarantor: { ...f.guarantor, phone: e.target.value } })} className={inp} /></label>
              </div>
            </div>
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="text-[13px] font-semibold text-[#1F2937]">Terms · شرائط</div>
                <span className="text-[11.5px] text-[#6B7280]">{f.clauses ? "your own wording" : "standard wording — the figures follow the agreement"}</span>
                {f.clauses && <button onClick={() => setF({ ...f, clauses: null })} className="text-[12px] text-[#24539B] hover:underline inline-flex items-center gap-1"><RotateCcw className="w-3 h-3" /> back to the standard terms</button>}
              </div>
              <div className="space-y-2">
                {editClauses.map((cl, i) => (
                  <div key={i} className="grid grid-cols-[22px_1fr_1fr_22px] gap-2 items-start">
                    <div className="text-[12px] text-[#6B7280] pt-2">{i + 1}.</div>
                    <textarea value={cl.en} onChange={(e) => setClause(i, { en: e.target.value })} rows={3} className={`${inp} text-[12.5px]`} />
                    <textarea value={cl.ur} onChange={(e) => setClause(i, { ur: e.target.value })} rows={3} className={`${inp} text-[13px]`} dir="rtl" lang="ur" />
                    <button onClick={() => setF({ ...f, clauses: editClauses.filter((_, j) => j !== i) })} className="text-[#9CA3AF] hover:text-red-600 pt-2" title="Remove this term"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
              <button onClick={() => setF({ ...f, clauses: [...editClauses, { en: "", ur: "" }] })} className="mt-2 text-[12px] text-[#24539B] hover:underline inline-flex items-center gap-1"><Plus className="w-3 h-3" /> add a term</button>
            </div>
            <div className="flex gap-2">
              <button onClick={save} disabled={busy} className="rounded-lg bg-[#24539B] text-white text-[13px] font-medium px-3.5 py-2 disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
              <button onClick={() => { setEditing(false); load(); }} className="rounded-lg border border-[#CBD5E1] bg-white text-[13px] px-3.5 py-2">Cancel</button>
              {authorised && <span className="text-[12px] text-[#B45309] self-center">Changing anything here removes the authorisation.</span>}
            </div>
          </div>
        )}

        {err ? (
          <div className="bg-white rounded-xl p-8 text-center text-red-600 text-sm">{err}</div>
        ) : !d ? (
          <div className="bg-white rounded-xl p-10 text-center text-[#9CA3AF] flex items-center justify-center gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Preparing the agreement…</div>
        ) : (
          <div id="agreement-doc" className="relative bg-white rounded-xl shadow-xl p-10 text-[#111827] text-[13px] leading-relaxed">
            {/* authorised / draft mark */}
            <div
              className="absolute right-10 top-28 border-[3px] rounded-lg px-3 py-1 text-center rotate-[-10deg] select-none opacity-80"
              style={{ color: authorised ? "#166534" : "#9CA3AF", borderColor: authorised ? "#166534" : "#9CA3AF", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
            >
              <div className="text-[15px] font-extrabold tracking-widest">{authorised ? "AUTHORISED" : "DRAFT"}</div>
              <div className="text-[9.5px] font-semibold">{authorised ? `${a.authorized_by_name} · ${dmy(a.authorized_day)}` : "NOT AUTHORISED"}</div>
            </div>

            {/* letterhead */}
            <div className="flex justify-between items-start border-b-2 border-[#13294B] pb-3">
              <div className="flex items-start gap-3">
                {c.logo_data_url && <img src={c.logo_data_url} alt="" className="h-16 w-auto max-w-[160px] object-contain" />}
                <div>
                  <div className="text-xl font-bold text-[#13294B]">{c.trade_name || company}</div>
                  {c.legal_name && c.legal_name !== c.trade_name && <div className="text-[11px] text-[#6B7280]">{c.legal_name}</div>}
                  <div className="text-[11px] text-[#6B7280]">{[c.address_lines, c.city, c.country].filter(Boolean).join(", ")}</div>
                  <div className="text-[11px] text-[#6B7280]">{[Array.isArray(c.phones) ? c.phones.join(" / ") : c.phones, c.email].filter(Boolean).join(" · ")}{c.ntn ? ` · NTN ${c.ntn}` : ""}</div>
                </div>
              </div>
              <div className="text-right text-[11.5px] text-[#4B5563]">
                <div>Agreement no. <b className="text-[#111827]">{a.agreement_number}</b></div>
                <div>Date: {dmy(a.start_day)}</div>
                <div>Place: {doc.place || "Quetta"}</div>
              </div>
            </div>

            <div className="text-center mt-5 mb-4">
              <div className="text-[17px] font-bold tracking-wide">TRUCK LEASE-TO-OWN AGREEMENT</div>
              <div className="text-[17px] font-bold" dir="rtl" lang="ur">ٹرک قسطوں پر دینے کا معاہدہ</div>
            </div>

            <p>
              This agreement is made at {doc.place || "Quetta"} on {dmy(a.start_day)} between:
            </p>
            <div className="grid grid-cols-2 gap-4 mt-3">
              <div className="border border-[#E3E8EF] rounded-lg p-3">
                <div className="text-[10.5px] font-bold text-[#6B7280]">THE FIRST PARTY — THE COMPANY · فریقِ اول</div>
                <div className="font-semibold text-[14px]">{company}</div>
                <div className="text-[12px] text-[#4B5563]">{[c.address_lines, c.city].filter(Boolean).join(", ")}</div>
                {c.ntn && <div className="text-[12px] text-[#4B5563]">NTN {c.ntn}</div>}
                <div className="text-[12px] text-[#4B5563]">through {blank(doc.signatoryName || a.authorized_by_name)}{doc.signatoryTitle || a.authorized_by_title ? `, ${doc.signatoryTitle || a.authorized_by_title}` : ""}</div>
              </div>
              <div className="border border-[#E3E8EF] rounded-lg p-3">
                <div className="text-[10.5px] font-bold text-[#6B7280]">THE SECOND PARTY · فریقِ دوم</div>
                <div className="font-semibold text-[14px]" dir="auto">{a.partner_name}</div>
                <div className="text-[12px] text-[#4B5563]">s/o {blank(doc.fatherName)}</div>
                <div className="text-[12px] text-[#4B5563]">CNIC {blank(a.partner_cnic, 18)}</div>
                <div className="text-[12px] text-[#4B5563]">Phone {blank(a.partner_phone, 14)}</div>
                <div className="text-[12px] text-[#4B5563]" dir="auto">Address: {blank(a.partner_address, 30)}</div>
              </div>
            </div>

            {/* the truck and the money */}
            <div className="grid grid-cols-2 gap-4 mt-4">
              <table className="w-full text-[12.5px] border border-[#E3E8EF]">
                <tbody>
                  <tr className="bg-[#F1F4F9]" style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}><td colSpan={2} className="px-3 py-1.5 font-semibold">The Truck · ٹرک</td></tr>
                  {([
                    ["Registration no.", a.vehicle_number || a.registration_number],
                    ["Make / model", [a.truck_brand, a.model].filter((x: any) => x && x !== "TBD").join(" ")],
                    ["Year", a.year],
                    ["Chassis no.", a.chassis_number],
                    ["Engine no.", a.engine_number],
                  ] as const).map(([l, v]) => (
                    <tr key={l} className="border-t border-[#EEF1F5]"><td className="px-3 py-1.5 text-[#6B7280] w-[42%]">{l}</td><td className="px-3 py-1.5 font-medium">{blank(v ? String(v) : "", 16)}</td></tr>
                  ))}
                </tbody>
              </table>
              <table className="w-full text-[12.5px] border border-[#E3E8EF] self-start">
                <tbody>
                  <tr className="bg-[#F1F4F9]" style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}><td colSpan={2} className="px-3 py-1.5 font-semibold">The Price · قیمت</td></tr>
                  <tr className="border-t border-[#EEF1F5]"><td className="px-3 py-1.5 text-[#6B7280]">Agreed price · طے شدہ قیمت</td><td className="px-3 py-1.5 text-right tabular-nums font-medium">{money(a.agreed_price)}</td></tr>
                  <tr className="border-t border-[#EEF1F5]"><td className="px-3 py-1.5 text-[#6B7280]">Advance paid · پیشگی</td><td className="px-3 py-1.5 text-right tabular-nums">{money(a.advance_paid)}</td></tr>
                  <tr className="border-t-2 border-[#13294B]"><td className="px-3 py-1.5 font-semibold">Balance to pay · باقی</td><td className="px-3 py-1.5 text-right tabular-nums font-bold">{money(a.opening_balance)}</td></tr>
                  <tr className="border-t border-[#EEF1F5]"><td colSpan={2} className="px-3 py-1.5 text-[11.5px] text-[#4B5563]">{rupeesInWords(a.opening_balance)}</td></tr>
                  <tr className="border-t border-[#EEF1F5]"><td className="px-3 py-1.5 text-[#6B7280]">Paid from each trip's net</td><td className="px-3 py-1.5 text-right">{a.company_share_percent}%</td></tr>
                  <tr className="border-t border-[#EEF1F5]"><td className="px-3 py-1.5 text-[#6B7280]">His share once it is paid</td><td className="px-3 py-1.5 text-right">{doc.partnershipPercent || 50}%</td></tr>
                </tbody>
              </table>
            </div>

            {/* the terms */}
            <div className="mt-5 font-semibold text-[14px] border-b border-[#E3E8EF] pb-1 flex justify-between"><span>Terms and conditions</span><span dir="rtl" lang="ur">شرائط و ضوابط</span></div>
            <div className="mt-2">
              {clauses.map((cl, i) => (
                <div key={i} className="clause grid grid-cols-[22px_1fr_1fr] gap-3 py-2 border-b border-[#F1F4F9]">
                  <div className="font-semibold">{i + 1}.</div>
                  <div className="text-[12.5px] text-justify">{cl.en}</div>
                  <div className="text-[13.5px] leading-8 text-justify" dir="rtl" lang="ur">{cl.ur}</div>
                </div>
              ))}
            </div>

            <p className="mt-4 text-[12.5px]">
              Both parties have read and understood this agreement — it was read out to the Second Party in his own language — and sign it of their own free will in the presence of the witnesses.
            </p>
            <p className="text-[13.5px] leading-8" dir="rtl" lang="ur">
              دونوں فریقین نے یہ معاہدہ پڑھ اور سمجھ لیا ہے (فریقِ دوم کو اس کی اپنی زبان میں پڑھ کر سنایا گیا) اور گواہوں کی موجودگی میں اپنی رضامندی سے اس پر دستخط کرتے ہیں۔
            </p>

            {/* signatures */}
            <div className="sign grid grid-cols-2 gap-8 mt-8">
              <div>
                <div className="h-16" style={{ borderBottom: "1.5px solid #111827" }} />
                <div className="mt-1 font-semibold">For {company}</div>
                <div className="text-[12px] text-[#4B5563]">{blank(doc.signatoryName || a.authorized_by_name)}{doc.signatoryTitle || a.authorized_by_title ? ` — ${doc.signatoryTitle || a.authorized_by_title}` : ""}</div>
                <div className="text-[11px] text-[#6B7280]">Authorised signatory · مجاز دستخط کنندہ</div>
                <div className="mt-2 w-28 h-20 border border-dashed border-[#9CA3AF] rounded flex items-center justify-center text-[10px] text-[#9CA3AF]">Company stamp</div>
              </div>
              <div>
                <div className="flex gap-3 items-end">
                  <div className="flex-1 h-16" style={{ borderBottom: "1.5px solid #111827" }} />
                  <div className="w-16 h-20 border border-dashed border-[#9CA3AF] rounded flex items-end justify-center text-[9px] text-[#9CA3AF] pb-1">Thumb · انگوٹھا</div>
                </div>
                <div className="mt-1 font-semibold" dir="auto">{a.partner_name}</div>
                <div className="text-[12px] text-[#4B5563]">CNIC {blank(a.partner_cnic, 18)}</div>
                <div className="text-[11px] text-[#6B7280]">The Second Party · فریقِ دوم</div>
              </div>
            </div>
            <div className="sign grid grid-cols-2 gap-8 mt-8">
              {[0, 1].map((i) => (
                <div key={i}>
                  <div className="h-12" style={{ borderBottom: "1.5px solid #111827" }} />
                  <div className="mt-1 text-[12.5px]"><b>Witness {i + 1} · گواہ:</b> {blank(doc.witnesses?.[i]?.name)}</div>
                  <div className="text-[12px] text-[#4B5563]">CNIC {blank(doc.witnesses?.[i]?.cnic, 18)}</div>
                </div>
              ))}
            </div>
            {doc.guarantor?.name && (
              <div className="sign grid grid-cols-2 gap-8 mt-8">
                <div>
                  <div className="h-12" style={{ borderBottom: "1.5px solid #111827" }} />
                  <div className="mt-1 text-[12.5px]"><b>Guarantor · ضامن:</b> {doc.guarantor.name}</div>
                  <div className="text-[12px] text-[#4B5563]">CNIC {blank(doc.guarantor.cnic, 18)}{doc.guarantor.phone ? ` · ${doc.guarantor.phone}` : ""}</div>
                </div>
              </div>
            )}

            <div className="mt-8 pt-2 border-t border-[#E3E8EF] text-[10.5px] text-[#6B7280] flex justify-between">
              <span>{a.agreement_number} · {company}</span>
              <span>{authorised ? `Authorised in the company's system by ${a.authorized_by_name}${a.authorized_by_title ? ` (${a.authorized_by_title})` : ""} on ${dmy(a.authorized_day)}` : "Draft — not valid until authorised and signed"}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
