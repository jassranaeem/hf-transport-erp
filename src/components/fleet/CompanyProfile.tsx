/**
 * Company Profile — the invoice letterhead: name, address, tax numbers, bank
 * accounts, footer, defaults, and the LOGO. Everything here is snapshotted onto
 * each invoice at the moment it is created.
 *
 *   GET/PUT /api/enterprise/company-profile   (Admin / Super Admin)
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import { Building2, Loader2, Save, Upload, Trash2, Plus, ImageIcon } from "lucide-react";

type Bank = { bankName?: string; title?: string; accountNo?: string; iban?: string; branch?: string };

const DEFAULT_TERMS = [
  "50% advance is payable when the empty vehicle is placed for loading.",
  "The remaining 50% is payable once the vehicle has been loaded.",
  "Please quote the invoice number with every payment.",
  "Goods once transported are at the consignee's risk; claims must be raised within 7 days of delivery.",
  "Any dispute is subject to the jurisdiction of Quetta courts.",
].join("\n");

/** shrink a raster logo to a sane letterhead size; pass SVG through untouched */
function fileToLogoDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > 1_400_000 && !file.type.includes("svg")) {
      // fall through to canvas downscale below; oversize hard-stop is server-side
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file"));
    if (file.type === "image/svg+xml") {
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(file);
      return;
    }
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Not a valid image"));
      img.onload = () => {
        const max = 360;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        const ctx = cv.getContext("2d")!;
        ctx.drawImage(img, 0, 0, w, h);
        const type = file.type === "image/jpeg" ? "image/jpeg" : "image/png";
        resolve(cv.toDataURL(type, 0.92));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export default function CompanyProfile({
  showFeedback,
}: {
  showFeedback: (t: "success" | "error", m: string) => void;
}) {
  const [p, setP] = useState<any>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [phones, setPhones] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    enterpriseFetch(`/api/enterprise/company-profile`)
      .then((d) => {
        setP(d);
        setBanks(Array.isArray(d.bankAccountsJson) ? d.bankAccountsJson : []);
        setPhones(Array.isArray(d.phones) ? d.phones.join(", ") : "");
      })
      .catch((e) => showFeedback("error", e.message));
  }, [showFeedback]);
  useEffect(() => { load(); }, [load]);

  const set = (k: string, v: any) => setP((cur: any) => ({ ...cur, [k]: v }));

  const pickLogo = async (file: File) => {
    try {
      const dataUrl = await fileToLogoDataUrl(file);
      if (dataUrl.length > 1_900_000) {
        showFeedback("error", "The logo is still too large — use a smaller image (about 200 KB). · لوگو اب بھی بہت بڑا ہے — چھوٹی تصویر استعمال کریں۔");
        return;
      }
      set("logoDataUrl", dataUrl);
      showFeedback("success", "Logo added — now click Save. · لوگو لگ گیا — اب محفوظ کریں۔");
    } catch (e: any) {
      showFeedback("error", e.message || "Could not load the logo · لوگو لوڈ نہیں ہو سکا");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        legalName: p.legalName || null,
        tradeName: p.tradeName || "HF Transport",
        tagline: p.tagline || null,
        addressLines: p.addressLines || null,
        city: p.city || null,
        country: p.country || null,
        phones: phones.split(",").map((s) => s.trim()).filter(Boolean),
        email: p.email || null,
        website: p.website || null,
        ntn: p.ntn || null,
        strn: p.strn || null,
        logoDataUrl: p.logoDataUrl || null,
        invoicePrefix: p.invoicePrefix || "INV",
        invoiceFooterNote: p.invoiceFooterNote || null,
        invoiceTerms: (p.invoiceTerms ?? "").trim() ? p.invoiceTerms.trim() : null,
        defaultSalesTaxPercent: "0",
        defaultWhtPercent: "0",
        defaultPaymentTerms: p.defaultPaymentTerms || "Net 30",
        bankAccountsJson: banks.filter((b) => b.bankName || b.accountNo || b.iban),
      };
      const r = await enterpriseFetch(`/api/enterprise/company-profile`, { method: "PUT", body: JSON.stringify(body) });
      showFeedback("success", "Company profile saved · محفوظ ہو گیا");
      if (r?.profile) { setP(r.profile); setBanks(r.profile.bankAccountsJson || []); }
    } catch (e: any) {
      showFeedback("error", e.message || "Could not save (Admin access required) · محفوظ نہیں ہوا (ایڈمن درکار ہے)");
    } finally {
      setSaving(false);
    }
  };

  if (!p) return <div className="p-6 text-sm text-slate-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> loading…</div>;

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h2 className="text-base font-bold flex items-center gap-2">
          <Building2 className="w-4 h-4" /> Company Profile <span className="text-[#9CA3AF] font-normal text-sm">· کمپنی پروفائل / لیٹر ہیڈ</span>
        </h2>
        <p className="text-[12px] text-[#6B7280]" dir="auto">
          This is printed at the top of every invoice. It is copied when an invoice is created, so later changes do not affect old invoices. · یہ ہر انوائس کے اوپر چھپتا ہے۔ انوائس بنتے وقت کاپی ہو جاتا ہے، اس لیے بعد کی تبدیلی پرانی انوائسز کو نہیں بدلتی۔
        </p>
      </div>

      {/* logo */}
      <section className="rounded-xl border border-[#E5E7EB] bg-white p-4">
        <div className="text-xs font-bold text-slate-600 flex items-center gap-1.5 mb-2"><ImageIcon className="w-3.5 h-3.5" /> Logo</div>
        <div className="flex items-center gap-4">
          <div className="w-40 h-20 border border-dashed border-slate-300 rounded flex items-center justify-center bg-slate-50 overflow-hidden">
            {p.logoDataUrl ? <img src={p.logoDataUrl} alt="logo" className="max-h-full max-w-full object-contain" /> : <span className="text-[10px] text-slate-400">no logo</span>}
          </div>
          <div className="space-y-1.5">
            <button onClick={() => fileRef.current?.click()} className="h-9 px-3 rounded-lg border border-[#E5E7EB] bg-white text-xs flex items-center gap-1.5">
              <Upload className="w-3.5 h-3.5" /> {p.logoDataUrl ? "Change logo" : "Upload logo"}
            </button>
            {p.logoDataUrl && (
              <button onClick={() => set("logoDataUrl", null)} className="h-9 px-3 rounded-lg border border-red-200 text-red-600 text-xs flex items-center gap-1.5">
                <Trash2 className="w-3.5 h-3.5" /> Remove
              </button>
            )}
            <p className="text-[10px] text-slate-400">PNG / JPG / SVG. Large images are resized automatically · بڑی تصویر خود چھوٹی ہو جائے گی۔</p>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && pickLogo(e.target.files[0])} />
          </div>
        </div>
      </section>

      {/* identity */}
      <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
        <F l="Trade name · نام"><input className="i" value={p.tradeName || ""} onChange={(e) => set("tradeName", e.target.value)} dir="auto" /></F>
        <F l="Legal name"><input className="i" value={p.legalName || ""} onChange={(e) => set("legalName", e.target.value)} dir="auto" /></F>
        <F l="Tagline"><input className="i" value={p.tagline || ""} onChange={(e) => set("tagline", e.target.value)} dir="auto" /></F>
        <F l="Address (multi-line) · پتہ" wide><textarea className="i" rows={2} value={p.addressLines || ""} onChange={(e) => set("addressLines", e.target.value)} dir="auto" /></F>
        <F l="City"><input className="i" value={p.city || ""} onChange={(e) => set("city", e.target.value)} dir="auto" /></F>
        <F l="Country"><input className="i" value={p.country || ""} onChange={(e) => set("country", e.target.value)} dir="auto" /></F>
        <F l="Phones (comma-separated) · فون"><input className="i" value={phones} onChange={(e) => setPhones(e.target.value)} dir="auto" /></F>
        <F l="Email"><input className="i" value={p.email || ""} onChange={(e) => set("email", e.target.value)} /></F>
        <F l="Website"><input className="i" value={p.website || ""} onChange={(e) => set("website", e.target.value)} /></F>
        <F l="NTN *"><input className="i" value={p.ntn || ""} onChange={(e) => set("ntn", e.target.value)} /></F>
        <F l="STRN"><input className="i" value={p.strn || ""} onChange={(e) => set("strn", e.target.value)} /></F>
      </section>

      {/* invoice defaults */}
      <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
        <F l="Invoice prefix"><input className="i" value={p.invoicePrefix || "INV"} onChange={(e) => set("invoicePrefix", e.target.value)} /></F>
        <F l="Default payment terms"><input className="i" value={p.defaultPaymentTerms || "Net 30"} onChange={(e) => set("defaultPaymentTerms", e.target.value)} /></F>
        <F l="Invoice footer note · فوٹر" wide><input className="i" value={p.invoiceFooterNote || ""} onChange={(e) => set("invoiceFooterNote", e.target.value)} dir="auto" /></F>
        <label className="flex flex-col text-[10px] text-slate-500 col-span-2 md:col-span-3">
          <span dir="auto">Terms &amp; conditions — printed on every invoice (one line = one point) · شرائط و ضوابط — ہر انوائس پر چھپتی ہیں (ایک سطر = ایک نکتہ)</span>
          <textarea
            className="i"
            rows={6}
            dir="auto"
            value={p.invoiceTerms ?? DEFAULT_TERMS}
            onChange={(e) => set("invoiceTerms", e.target.value)}
          />
          <span className="text-[9px] text-slate-400 mt-0.5">Leave blank to use the default terms (50% advance on an empty truck, 50% on loading). · خالی چھوڑیں تو ڈیفالٹ شرائط لگیں گی (خالی گاڑی پر 50% ایڈوانس، لوڈنگ پر 50%)۔</span>
        </label>
      </section>

      {/* bank accounts */}
      <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 space-y-2">
        <div className="text-xs font-bold text-slate-600">Bank accounts (payment details on the invoice) · بینک تفصیل</div>
        {banks.map((bk, i) => (
          <div key={i} className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs items-end">
            {(["bankName", "branch", "title", "accountNo", "iban"] as const).map((k) => (
              <label key={k} className="flex flex-col text-[10px] text-slate-500">
                {k === "bankName" ? "Bank" : k === "title" ? "A/C title" : k === "accountNo" ? "A/C no" : k === "iban" ? "IBAN" : "Branch"}
                <input className="i" value={bk[k] || ""} onChange={(e) => setBanks((bs) => bs.map((b, idx) => (idx === i ? { ...b, [k]: e.target.value } : b)))} />
              </label>
            ))}
            <button onClick={() => setBanks((bs) => bs.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-600 h-8"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
        <button onClick={() => setBanks((bs) => [...bs, {}])} className="text-xs flex items-center gap-1 text-emerald-700 font-semibold">
          <Plus className="w-3.5 h-3.5" /> Add bank account
        </button>
      </section>

      <button onClick={save} disabled={saving} className="h-10 px-5 rounded-lg bg-[#24539B] text-white text-sm font-bold flex items-center gap-2 disabled:opacity-60">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save profile · محفوظ کریں
      </button>

      <style>{`.i{border:1px solid #E5E7EB;border-radius:6px;padding:4px 8px;font-size:12px;width:100%;color:#1f2937}`}</style>
    </div>
  );
}

function F({ l, children, wide }: { l: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`flex flex-col text-[10px] text-slate-500 ${wide ? "col-span-2 md:col-span-3" : ""}`}>
      <span dir="auto">{l}</span>
      {children}
    </label>
  );
}
