/**
 * New Invoice — make a proper, professional invoice for a client and print it.
 *
 * Flow:  pick client (or add one) -> shipment details (bilty, cargo, route,
 * vehicle) -> line items -> tax / advance -> "Create & preview" hits
 * POST /api/finance/invoices (createDetailedInvoice) and opens the printable
 * InvoiceDocument (letterhead + logo from Company Profile).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { enterpriseFetch } from "../../../client/api.ts";
import InvoiceDocument from "./InvoiceDocument.tsx";
import {
  FileText, Plus, Trash2, Loader2, CheckCircle, AlertTriangle, Building2, X, Lock,
} from "lucide-react";

const PKR = (n: number) => "Rs " + Math.round(n || 0).toLocaleString("en-PK");
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

type Line = { description: string; qty: string; unit: string; rate: string };
const BLANK_LINE: Line = { description: "", qty: "1", unit: "trip", rate: "" };

export default function NewInvoice({
  showFeedback,
  onCreated,
  editInvoiceId,
}: {
  showFeedback: (t: "success" | "error", m: string) => void;
  onCreated?: (invoiceId: number) => void;
  editInvoiceId?: number;
}) {
  const isEdit = !!editInvoiceId;
  const [profile, setProfile] = useState<any>(null);
  const [contractors, setContractors] = useState<any[]>([]);
  const [contractorId, setContractorId] = useState<number | "">("");
  const [trips, setTrips] = useState<any[]>([]);
  const [tripId, setTripId] = useState<number | "">("");
  const [addingClient, setAddingClient] = useState(false);
  const [newClient, setNewClient] = useState<any>({ company: "", contactPerson: "", phone: "", email: "", ntn: "", strn: "", address: "" });
  const [savingClient, setSavingClient] = useState(false);

  const [f, setF] = useState<any>({
    invoiceDate: today(),
    dueDate: plusDays(30),
    paymentTerms: "Net 30",
    containerNo: "",
    routeFrom: "",
    routeTo: "",
    borderCrossing: "",
    cargoDescription: "",
    cargoWeightKg: "",
    rateBasis: "",
    vehicleId: "",
    driverId: "",
    advanceReceived: "",
    notes: "",
  });
  const [lines, setLines] = useState<Line[]>([{ ...BLANK_LINE }]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [existingBilty, setExistingBilty] = useState<string>("");

  // edit mode — load the invoice and prefill the whole form
  useEffect(() => {
    if (!editInvoiceId) return;
    enterpriseFetch(`/api/finance/invoices/${editInvoiceId}`)
      .then((d) => {
        setContractorId(d.contractorId || "");
        setExistingBilty(d.biltyNumber || "");
        setF({
          invoiceDate: d.invoiceDate ? d.invoiceDate.slice(0, 10) : today(),
          dueDate: d.dueDate ? d.dueDate.slice(0, 10) : plusDays(30),
          paymentTerms: d.paymentTerms || "Net 30",
          containerNo: d.containerNo || "",
          routeFrom: d.routeFrom || "",
          routeTo: d.routeTo || "",
          borderCrossing: d.borderCrossing || "",
          cargoDescription: d.cargoDescription || "",
          cargoWeightKg: d.cargoWeightKg ? String(d.cargoWeightKg) : "",
          rateBasis: d.rateBasis || "",
          vehicleId: d.vehicleId ? String(d.vehicleId) : "",
          driverId: d.driverId ? String(d.driverId) : "",
          advanceReceived: d.advanceReceived ? String(d.advanceReceived) : "",
          notes: d.notes || "",
        });
        setLines(
          (d.lines || []).length
            ? d.lines.map((l: any) => ({ description: l.description || "", qty: String(l.qty ?? 1), unit: l.unit || "trip", rate: String(l.rate ?? 0) }))
            : [{ ...BLANK_LINE }],
        );
      })
      .catch((e) => showFeedback("error", e.message));
  }, [editInvoiceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadRefs = useCallback(() => {
    enterpriseFetch(`/api/enterprise/company-profile`).then((p) => {
      setProfile(p);
      setF((cur: any) => ({ ...cur, paymentTerms: cur.paymentTerms || p?.defaultPaymentTerms || "Net 30" }));
    }).catch(() => {});
    enterpriseFetch(`/api/entities/contractors?limit=500&sort=company&dir=asc`).then((r) => setContractors(r.rows || [])).catch(() => {});
    enterpriseFetch(`/api/entities/vehicles?limit=500`).then((r) => setVehicles(r.rows || [])).catch(() => {});
    enterpriseFetch(`/api/entities/drivers?limit=500`).then((r) => setDrivers(r.rows || [])).catch(() => {});
    enterpriseFetch(`/api/operations/trips?status=Completed`).then((r) => setTrips(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);
  useEffect(() => { loadRefs(); }, [loadRefs]);

  // prefill the whole form from a completed trip
  const applyTrip = (id: number | "") => {
    setTripId(id);
    if (!id) return;
    const t = trips.find((x) => x.id === id);
    if (!t) return;
    if (t.contractorId) setContractorId(t.contractorId);
    setF((cur: any) => ({
      ...cur,
      routeFrom: t.origin || cur.routeFrom,
      routeTo: t.destination || cur.routeTo,
      vehicleId: t.vehicleId ? String(t.vehicleId) : cur.vehicleId,
      driverId: t.driverId ? String(t.driverId) : cur.driverId,
      rateBasis: cur.rateBasis || "per trip",
    }));
    if (t.revenue) {
      setLines([{
        description: `Freight — ${[t.origin, t.destination].filter(Boolean).join(" to ")} (trip ${t.tripNumber})`,
        qty: "1", unit: "trip", rate: String(t.revenue),
      }]);
      // This description already carries real trip context (the trip
      // number) that the plain Route-from/to auto-fill effect doesn't know
      // about — mark it as "settled" so that effect (which also fires here,
      // since it watches routeFrom/routeTo and applyTrip just changed both)
      // doesn't immediately clobber it with its simpler generic text.
      descManuallyEditedRef.current = true;
    }
  };

  const client = useMemo(() => contractors.find((c) => c.id === contractorId), [contractors, contractorId]);
  const letterheadReady = !!(profile && profile.ntn && profile.addressLines);

  // no sales tax / income tax on freight invoices — total is just the line items
  const subtotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
  const total = subtotal;
  const balanceDue = total - (Number(f.advanceReceived) || 0);

  // Whether line 1's description has ever been typed into directly by the
  // user (as opposed to written by the auto-fill effect below). Starts
  // false: nothing has been typed into it yet.
  const descManuallyEditedRef = useRef(false);

  const setLine = (i: number, k: keyof Line, v: string) => {
    if (i === 0 && k === "description") descManuallyEditedRef.current = true;
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));
  };

  // Auto-fill the first line's description from the actual typed Route
  // from/to, in the order they were actually typed. The description input
  // only ever had a generic, hardcoded EXAMPLE as its placeholder text
  // ("Freight — Lahore to Karachi (bilty 4471)") — gray placeholder text
  // that reads exactly like a real filled-in value, so it was easy to
  // assume the line was already complete and click straight to "Create
  // Invoice", which then failed with a confusing "need at least one line
  // item" (the field was never actually filled — placeholders aren't
  // values). And because that example string is fixed regardless of the
  // real route, seeing "Lahore to Karachi" next to a Karachi→Lahore route
  // looked like a reversed-direction bug, when it was really just an
  // unrelated example sitting there unfilled.
  //
  // This regenerates the description on EVERY Route from/to keystroke, not
  // just once — the first version only filled it in when the description
  // was still blank, which is true for exactly one keystroke: the moment
  // Route To's very first character makes both fields non-empty. From then
  // on the description was non-blank, so the guard skipped every further
  // keystroke, freezing it at whatever single letter Route To had at that
  // instant ("Quetta to S", never "Quetta to Sukkur"). Regenerating on
  // every change instead — and only stopping once the user actually types
  // into the description field themselves — fixes that regardless of which
  // field reaches its final value first.
  useEffect(() => {
    if (!f.routeFrom || !f.routeTo) return;
    if (descManuallyEditedRef.current) return;
    setLines((ls) => {
      const next = [...ls];
      next[0] = { ...next[0], description: `Freight — ${f.routeFrom} to ${f.routeTo}` };
      return next;
    });
  }, [f.routeFrom, f.routeTo]);

  const addClient = async () => {
    for (const k of ["company", "contactPerson", "phone", "email", "ntn"] as const) {
      if (!newClient[k]?.trim()) { showFeedback("error", "Client ka company, contact, phone, email aur NTN zaroori hai."); return; }
    }
    setSavingClient(true);
    try {
      const r = await enterpriseFetch(`/api/entities/contractors`, { method: "POST", body: JSON.stringify({ ...newClient, status: "Active", paymentTerms: f.paymentTerms || "Net 30" }) });
      const created = r?.row || r;
      showFeedback("success", `Client "${created.company}" add ho gaya`);
      await new Promise((res) => setTimeout(res, 150));
      const list = await enterpriseFetch(`/api/entities/contractors?limit=500&sort=company&dir=asc`);
      setContractors(list.rows || []);
      setContractorId(created.id);
      setAddingClient(false);
      setNewClient({ company: "", contactPerson: "", phone: "", email: "", ntn: "", strn: "", address: "" });
    } catch (e: any) {
      showFeedback("error", e.message || "Client add nahi hua (NTN / email pehle se to nahi?)");
    } finally {
      setSavingClient(false);
    }
  };

  const create = async () => {
    if (!contractorId) { showFeedback("error", "Pehle client chunein · کلائنٹ منتخب کریں"); return; }
    const goodLines = lines
      .filter((l) => l.description.trim() && (Number(l.rate) || 0) > 0)
      .map((l) => ({ description: l.description.trim(), qty: Number(l.qty) || 1, unit: l.unit || "trip", rate: Number(l.rate) || 0 }));
    if (!goodLines.length) {
      // Say specifically what's missing instead of a generic "add a line
      // item" — the field can visually look filled (gray placeholder text)
      // while actually being empty, so naming the exact gap here matters.
      const noDescription = !lines.some((l) => l.description.trim());
      const noRate = !lines.some((l) => (Number(l.rate) || 0) > 0);
      const missing = [noDescription && "Description", noRate && "Rate"].filter(Boolean).join(" aur ");
      showFeedback("error", `Line item mein ${missing} bharein (kam az kam ek line ka).`);
      return;
    }

    setBusy(true);
    try {
      const body: any = {
        contractorId,
        tripId: tripId ? Number(tripId) : undefined,
        lines: goodLines,
        invoiceDate: f.invoiceDate,
        dueDate: f.dueDate,
        paymentTerms: f.paymentTerms,
        // sales-tax % and withholding % are NOT sent — the server fixes them from
        // the company profile so they can't be tampered with per invoice.
        advanceReceived: Number(f.advanceReceived) || 0,
        // bilty / GR number is issued by the system (unique, non-forgeable)
        containerNo: f.containerNo || undefined,
        routeFrom: f.routeFrom || undefined,
        routeTo: f.routeTo || undefined,
        borderCrossing: f.borderCrossing || undefined,
        cargoDescription: f.cargoDescription || undefined,
        cargoWeightKg: f.cargoWeightKg ? Number(f.cargoWeightKg) : undefined,
        rateBasis: f.rateBasis || undefined,
        vehicleId: f.vehicleId ? Number(f.vehicleId) : undefined,
        driverId: f.driverId ? Number(f.driverId) : undefined,
        notes: f.notes || undefined,
      };
      if (isEdit) {
        body.contractorId = contractorId; // allow re-pointing to the right client
        const r = await enterpriseFetch(`/api/finance/invoices/${editInvoiceId}`, { method: "PUT", body: JSON.stringify(body) });
        const inv = r?.invoice || r;
        showFeedback("success", `Invoice ${inv.invoiceNumber || ""} update ho gayi`);
        if (onCreated) onCreated(inv.id); else setPreviewId(inv.id);
      } else {
        const r = await enterpriseFetch(`/api/finance/invoices`, { method: "POST", body: JSON.stringify(body) });
        const inv = r?.invoice || r;
        showFeedback("success", `Invoice ${inv.invoiceNumber || ""} ban gayi`);
        if (onCreated) onCreated(inv.id); else setPreviewId(inv.id);
      }
    } catch (e: any) {
      showFeedback("error", e.message || (isEdit ? "Update nahi hui" : "Invoice nahi bani"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <h2 className="text-base font-bold flex items-center gap-2">
          <FileText className="w-4 h-4" /> {isEdit ? "Edit Invoice" : "New Invoice"} <span className="text-[#9CA3AF] font-normal text-sm">· {isEdit ? "انوائس درست کریں" : "نیا انوائس"}</span>
          {isEdit && existingBilty && <span className="text-[10px] font-normal text-slate-400">({existingBilty})</span>}
        </h2>
        <p className="text-[12px] text-[#6B7280]" dir="auto">
          {isEdit
            ? "Ghalti theek karein — invoice number aur bilty number wahi rahenge, baaki sab change ho sakta hai. Tabdeeli audit log mein bhi jati hai."
            : "Client, bilty / serial, cargo aur rate bharein · تفصیل بھریں — invoice ban ke record + print / PDF ke liye ready ho jati hai."}
        </p>
      </div>

      {!letterheadReady && (
        <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-[12px] text-[#B45309] flex items-start gap-2" dir="auto">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            Company Profile abhi adhoora hai (address / NTN missing) — invoice ka letterhead poora nahi lagega.
            <b> Console → Company Profile</b> mein details + logo daal dein.
          </span>
        </div>
      )}

      {/* client */}
      <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 space-y-3">
        <div className="text-xs font-bold text-slate-600 flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> Bill To · کلائنٹ</div>

        {!isEdit && trips.length > 0 && (
          <label className="flex flex-col text-[10px] text-slate-500">
            Prefill from a completed trip (optional) · مکمل شدہ ٹرپ سے
            <select value={tripId} onChange={(e) => applyTrip(e.target.value ? Number(e.target.value) : "")} className="border rounded px-2 py-1.5 text-sm text-slate-800">
              <option value="">— none —</option>
              {trips.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.tripNumber} · {t.company} · {[t.origin, t.destination].filter(Boolean).join(" → ")}{t.revenue ? ` · Rs ${Number(t.revenue).toLocaleString()}` : ""}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-[10px] text-slate-500 min-w-[240px] flex-1">
            Client
            <select value={contractorId} onChange={(e) => setContractorId(e.target.value ? Number(e.target.value) : "")} className="border rounded px-2 py-1.5 text-sm text-slate-800">
              <option value="">— select client —</option>
              {contractors.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
            </select>
          </label>
          <button onClick={() => setAddingClient((s) => !s)} className="h-9 px-3 rounded-lg border border-[#E5E7EB] bg-white text-xs flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> New client
          </button>
        </div>

        {client && (
          <div className="text-[11px] text-slate-500 border-t border-slate-100 pt-2" dir="auto">
            {client.address || "no address on file"} · {client.contactPerson} · {client.phone}
            {client.ntn ? ` · NTN ${client.ntn}` : ""}{client.strn ? ` · STRN ${client.strn}` : ""}
          </div>
        )}

        {addingClient && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            {([
              ["company", "Company name *"], ["contactPerson", "Contact person *"], ["phone", "Phone *"],
              ["email", "Email *"], ["ntn", "NTN *"], ["strn", "STRN"],
            ] as [string, string][]).map(([k, lbl]) => (
              <label key={k} className="flex flex-col text-[10px] text-slate-500">
                {lbl}
                <input dir="auto" value={newClient[k]} onChange={(e) => setNewClient({ ...newClient, [k]: e.target.value })} className="border rounded px-2 py-1 text-slate-800" />
              </label>
            ))}
            <label className="flex flex-col text-[10px] text-slate-500 col-span-2 md:col-span-3">
              Address
              <input dir="auto" value={newClient.address} onChange={(e) => setNewClient({ ...newClient, address: e.target.value })} className="border rounded px-2 py-1 text-slate-800" />
            </label>
            <div className="col-span-2 md:col-span-3">
              <button onClick={addClient} disabled={savingClient} className="bg-emerald-600 text-white rounded px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-60">
                {savingClient ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />} Save client
              </button>
            </div>
          </div>
        )}
      </section>

      {/* invoice + shipment */}
      <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <Field label="Invoice date · تاریخ"><input type="date" value={f.invoiceDate} onChange={(e) => setF({ ...f, invoiceDate: e.target.value })} className="i" /></Field>
        <Field label="Due date · مقررہ تاریخ"><input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} className="i" /></Field>
        <Field label="Payment terms"><input value={f.paymentTerms} onChange={(e) => setF({ ...f, paymentTerms: e.target.value })} className="i" /></Field>
        <Field label="Rate basis"><input dir="auto" placeholder="per trip / per ton" value={f.rateBasis} onChange={(e) => setF({ ...f, rateBasis: e.target.value })} className="i" /></Field>

        <Field label="Bilty / GR no · بلٹی">
          <div className="i flex items-center gap-1 bg-slate-50 text-slate-500" title="System assigns a unique bilty number — cannot be typed or changed">
            <Lock className="w-3 h-3" /> {isEdit ? (existingBilty || "—") : "Auto — assigned on save"}
          </div>
        </Field>
        <Field label="Container no"><input dir="auto" value={f.containerNo} onChange={(e) => setF({ ...f, containerNo: e.target.value })} className="i" /></Field>
        <Field label="Vehicle">
          <select value={f.vehicleId} onChange={(e) => setF({ ...f, vehicleId: e.target.value })} className="i">
            <option value="">—</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.vehicleNumber || v.registrationNumber || `#${v.id}`}</option>)}
          </select>
        </Field>
        <Field label="Driver">
          <select value={f.driverId} onChange={(e) => setF({ ...f, driverId: e.target.value })} className="i">
            <option value="">—</option>
            {drivers.map((dr) => <option key={dr.id} value={dr.id}>{dr.driverName || dr.name || `#${dr.id}`}</option>)}
          </select>
        </Field>

        <Field label="Route from · سے"><input dir="auto" value={f.routeFrom} onChange={(e) => setF({ ...f, routeFrom: e.target.value })} className="i" /></Field>
        <Field label="Route to · تک"><input dir="auto" value={f.routeTo} onChange={(e) => setF({ ...f, routeTo: e.target.value })} className="i" /></Field>
        <Field label="Border crossing"><input dir="auto" value={f.borderCrossing} onChange={(e) => setF({ ...f, borderCrossing: e.target.value })} className="i" /></Field>
        <Field label="Cargo weight (kg)"><input inputMode="numeric" value={f.cargoWeightKg} onChange={(e) => setF({ ...f, cargoWeightKg: e.target.value.replace(/[^\d]/g, "") })} className="i" /></Field>

        <Field label="Cargo description · مال کی تفصیل" wide>
          <input dir="auto" value={f.cargoDescription} onChange={(e) => setF({ ...f, cargoDescription: e.target.value })} className="i" />
        </Field>
      </section>

      {/* line items */}
      <section className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="px-3 py-2 text-xs font-bold bg-[#F3F7F4]">Line items · تفصیل</div>
        <table className="w-full text-xs">
          <thead className="bg-[#F9FAFB] text-[#6B7280]">
            <tr>
              <th className="text-left px-2 py-1.5">Description</th>
              <th className="text-right px-2 py-1.5 w-16">Qty</th>
              <th className="text-left px-2 py-1.5 w-20">Unit</th>
              <th className="text-right px-2 py-1.5 w-28">Rate</th>
              <th className="text-right px-2 py-1.5 w-32">Amount</th>
              <th className="px-1"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-t border-[#F3F4F6]">
                <td className="px-2 py-1"><input dir="auto" value={l.description} onChange={(e) => setLine(i, "description", e.target.value)} className="w-full border rounded px-2 py-1" placeholder="Type a description, e.g. Freight — [Route] (bilty #)" /></td>
                <td className="px-2 py-1"><input value={l.qty} onChange={(e) => setLine(i, "qty", e.target.value.replace(/[^\d.]/g, ""))} className="w-full border rounded px-2 py-1 text-right" /></td>
                <td className="px-2 py-1"><input value={l.unit} onChange={(e) => setLine(i, "unit", e.target.value)} className="w-full border rounded px-2 py-1" /></td>
                <td className="px-2 py-1"><input value={l.rate} onChange={(e) => setLine(i, "rate", e.target.value.replace(/[^\d.]/g, ""))} className="w-full border rounded px-2 py-1 text-right" /></td>
                <td className="px-2 py-1 text-right tabular-nums">{PKR((Number(l.qty) || 0) * (Number(l.rate) || 0))}</td>
                <td className="px-1">
                  {lines.length > 1 && (
                    <button onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-3 py-2">
          <button onClick={() => setLines((ls) => [...ls, { ...BLANK_LINE }])} className="text-xs flex items-center gap-1 text-emerald-700 font-semibold">
            <Plus className="w-3.5 h-3.5" /> Add line
          </button>
        </div>
      </section>

      {/* totals */}
      <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 grid md:grid-cols-2 gap-4">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Field label="Advance received"><input value={f.advanceReceived} onChange={(e) => setF({ ...f, advanceReceived: e.target.value.replace(/[^\d]/g, "") })} className="i" /></Field>
          <Field label="Notes / terms"><input dir="auto" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="i" /></Field>
        </div>
        <div className="text-xs">
          <Row k="Invoice total" v={PKR(total)} bold />
          {Number(f.advanceReceived) > 0 && <Row k="Less: advance received" v={"- " + PKR(Number(f.advanceReceived))} />}
          <Row k="Balance Due" v={PKR(balanceDue)} bold big />
        </div>
      </section>

      <div className="flex items-center gap-2">
        <button onClick={create} disabled={busy} className="h-10 px-5 rounded-lg bg-[#16A34A] text-white text-sm font-bold flex items-center gap-2 disabled:opacity-60">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
          {isEdit ? "Save changes · تبدیلیاں محفوظ کریں" : "Create invoice · انوائس بنائیں"}
        </button>
        <span className="text-[11px] text-slate-400" dir="auto">
          {isEdit ? "Totals, status aur ledger sab dobara calculate ho jayenge." : "Invoice record ban jayega — phir print / Save-PDF ho sakta hai."}
        </span>
      </div>

      <style>{`.i{border:1px solid #E5E7EB;border-radius:6px;padding:4px 8px;font-size:12px;width:100%}`}</style>

      {previewId != null && <InvoiceDocument invoiceId={previewId} onClose={() => setPreviewId(null)} />}
    </div>
  );
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`flex flex-col text-[10px] text-slate-500 ${wide ? "col-span-2 md:col-span-4" : ""}`}>
      <span dir="auto">{label}</span>
      {children}
    </label>
  );
}
function Row({ k, v, bold, big }: { k: string; v: string; bold?: boolean; big?: boolean }) {
  return (
    <div className={`flex justify-between py-1 ${bold ? "font-bold" : "text-slate-500"} ${big ? "text-[14px] border-t-2 border-slate-800 mt-1 pt-1.5" : "border-b border-slate-100"}`}>
      <span>{k}</span><span className="tabular-nums text-slate-800">{v}</span>
    </div>
  );
}
