/**
 * Statement of Account · کھاتے کا گوشوارہ — a party's khata for dates on the company letterhead:
 * opening, every entry with its running balance, closing and "amount due". Print / save as PDF,
 * send by WhatsApp (opens the chat with the message ready) or by email.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Printer, X, Loader2, Mail, MessageCircle } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";
import { waLink, pkr, dmy } from "../../lib/share.ts";
import { Btn } from "../ui/kit.tsx";

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const money = (n: number) => Math.round(Math.abs(n || 0)).toLocaleString("en-PK");
const drcr = (n: number) => (n > 0 ? "Dr" : n < 0 ? "Cr" : "");

export default function StatementOfAccount({
  partyId,
  onClose,
  showFeedback,
}: {
  partyId: number;
  onClose: () => void;
  showFeedback: (t: "success" | "error", m: string) => void;
}) {
  const fy = (() => {
    const n = new Date();
    const y = n.getMonth() >= 6 ? n.getFullYear() : n.getFullYear() - 1;
    return { from: `${y}-07-01`, to: iso(n) };
  })();
  const [range, setRange] = useState<"all" | "fy" | "custom">("all");
  const [from, setFrom] = useState(fy.from);
  const [to, setTo] = useState(fy.to);
  const [st, setSt] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mailTo, setMailTo] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setSt(null);
    const q = range === "all" ? "" : `?from=${from}&to=${to}`;
    enterpriseFetch(`/api/doc-mail/statement/${partyId}${q}`)
      .then((r) => {
        setSt(r);
        setMailTo((m) => m || r.party.email || "");
      })
      .catch((e) => setErr(e.message));
  }, [partyId, range, from, to]);

  const p = st?.company || {};
  const period = range === "all" ? `up to ${dmy(new Date())}` : `${dmy(from)} – ${dmy(to)}`;
  const message = useMemo(() => {
    if (!st) return "";
    const due = st.closing;
    return `Assalam o Alaikum ${st.party.name}.\n${p.trade_name || "HFK Enterprises"} — Statement of account (${period}).\nOpening: PKR ${money(st.opening)} ${drcr(st.opening)}\nDebit: PKR ${money(st.debit)} · Credit: PKR ${money(st.credit)}\n${due > 0 ? `Amount due from you: ${pkr(due)}` : due < 0 ? `Amount payable to you: ${pkr(-due)}` : "Your account is clear."}\nThe full statement is attached. Shukriya.`;
  }, [st, period, p.trade_name]);

  const email = async () => {
    if (!mailTo.trim()) return showFeedback("error", "Type the email address · ای میل لکھیں");
    setSending(true);
    try {
      await enterpriseFetch(`/api/doc-mail/statement/${partyId}`, {
        method: "POST",
        body: JSON.stringify({ to: mailTo.trim(), ...(range === "all" ? {} : { from, toDate: to }) }),
      });
      showFeedback("success", `Statement emailed to ${mailTo.trim()} · ای میل ہو گئی`);
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(15,23,42,.45)] flex items-start justify-center overflow-y-auto p-4 print:p-0 print:bg-white print:static">
      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body * { visibility: hidden !important; }
          #soa-doc, #soa-doc * { visibility: visible !important; }
          #soa-doc { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none !important; border-radius: 0 !important; padding: 0 !important; }
          #soa-doc tr { page-break-inside: avoid; }
          .no-print { display: none !important; }
        }
      `}</style>
      <div className="w-full max-w-4xl my-6 print:my-0">
        {/* controls */}
        <div className="no-print bg-white rounded-xl border border-[#E3E8EF] p-3 mb-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-[#CBD5E1] p-0.5">
            {([["all", "All · سب"], ["fy", "This year · یہ سال"], ["custom", "Dates · تاریخیں"]] as const).map(([k, l]) => (
              <button
                key={k}
                onClick={() => {
                  setRange(k);
                  if (k === "fy") {
                    setFrom(fy.from);
                    setTo(fy.to);
                  }
                }}
                className={`rounded-md px-2.5 py-1 text-xs ${range === k ? "bg-[#24539B] text-white font-semibold" : "text-[#4B5563]"}`}
              >
                {l}
              </button>
            ))}
          </div>
          {range === "custom" && (
            <>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-[#CBD5E1] rounded-md px-2 py-1 text-xs" />
              <span className="text-[#9CA3AF]">→</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-[#CBD5E1] rounded-md px-2 py-1 text-xs" />
            </>
          )}
          <div className="flex-1" />
          <Btn kind="primary" onClick={() => window.print()} disabled={!st} icon={<Printer />} title="Opens the print window — choose “Save as PDF” to get the file">
            Print / PDF
          </Btn>
          <a
            href={st ? waLink(st.party.phone, message) : undefined}
            target="_blank"
            rel="noreferrer"
            className={`inline-flex items-center gap-1.5 rounded-lg text-[13px] font-medium px-3.5 py-2 border ${st ? "bg-white border-[#86EFAC] text-[#166534] hover:bg-[#F0FDF4]" : "opacity-50 pointer-events-none border-[#CBD5E1]"}`}
            title="Opens WhatsApp with the summary ready — attach the PDF there and press Send"
          >
            <MessageCircle className="w-4 h-4" /> WhatsApp
          </a>
          <div className="flex items-center gap-1 border border-[#CBD5E1] rounded-lg pl-2 bg-white">
            <Mail className="w-4 h-4 text-[#9CA3AF]" />
            <input value={mailTo} onChange={(e) => setMailTo(e.target.value)} placeholder="email@…" className="text-xs w-44 border-0 outline-none py-1.5" style={{ boxShadow: "none" }} />
            <Btn size="sm" kind="ghost" onClick={email} disabled={!st || sending} icon={sending ? <Loader2 className="animate-spin" /> : undefined}>
              Email
            </Btn>
          </div>
          <Btn kind="ghost" onClick={onClose} icon={<X />} title="Close" />
        </div>

        {err ? (
          <div className="bg-white rounded-xl p-8 text-center text-red-600 text-sm">{err}</div>
        ) : !st ? (
          <div className="bg-white rounded-xl p-10 text-center text-[#9CA3AF] flex items-center justify-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Preparing the statement…
          </div>
        ) : (
          <div id="soa-doc" className="bg-white rounded-xl shadow-xl p-8 text-[#111827] text-[12.5px]">
            <div className="flex justify-between items-start border-b-2 border-[#13294B] pb-3">
              <div className="flex items-start gap-3">
                {p.logo_data_url && <img src={p.logo_data_url} alt="" className="h-14 w-auto max-w-[150px] object-contain" />}
                <div>
                  <div className="text-xl font-bold text-[#13294B]">{p.trade_name || p.legal_name || "HFK Enterprises"}</div>
                  <div className="text-[11px] text-[#6B7280]">{[p.address_lines, p.city, p.country].filter(Boolean).join(", ")}</div>
                  <div className="text-[11px] text-[#6B7280]">
                    {[Array.isArray(p.phones) ? p.phones.join(" / ") : p.phones, p.email].filter(Boolean).join(" · ")}
                    {p.ntn ? ` · NTN ${p.ntn}` : ""}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold">STATEMENT OF ACCOUNT</div>
                <div className="text-[11px] text-[#6B7280]">Period: {period}</div>
                <div className="text-[11px] text-[#6B7280]">Printed: {dmy(new Date())}</div>
              </div>
            </div>

            <div className="flex justify-between mt-3 mb-3">
              <div>
                <div className="text-[10px] font-semibold text-[#9CA3AF]">ACCOUNT OF</div>
                <div className="font-semibold text-[14px]">{st.party.name}</div>
                <div className="text-[11.5px] text-[#4B5563]">{[st.party.address, st.party.city].filter(Boolean).join(", ")}</div>
                {st.party.phone && <div className="text-[11.5px] text-[#4B5563]">{st.party.phone}</div>}
              </div>
              <div className="text-right text-[11.5px] text-[#4B5563]">
                <div>{st.party.party_code}</div>
                {st.party.ntn && <div>NTN {st.party.ntn}</div>}
              </div>
            </div>

            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-[#F1F4F9]" style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}>
                  <th className="text-left px-2 py-1.5 border-b border-[#CBD5E1]">Date</th>
                  <th className="text-left px-2 py-1.5 border-b border-[#CBD5E1]">Details</th>
                  <th className="text-right px-2 py-1.5 border-b border-[#CBD5E1]">Debit</th>
                  <th className="text-right px-2 py-1.5 border-b border-[#CBD5E1]">Credit</th>
                  <th className="text-right px-2 py-1.5 border-b border-[#CBD5E1]">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-[#EEF1F5]">
                  <td className="px-2 py-1.5" />
                  <td className="px-2 py-1.5 font-semibold">Opening balance</td>
                  <td />
                  <td />
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{money(st.opening)} {drcr(st.opening)}</td>
                </tr>
                {st.lines.map((l: any) => (
                  <tr key={l.id} className="border-b border-[#EEF1F5]">
                    <td className="px-2 py-1 whitespace-nowrap tabular-nums">{l.day ? dmy(l.day) : l.raw_date || ""}</td>
                    <td className="px-2 py-1" dir="auto">{[l.description, l.ref_no].filter(Boolean).join(" · ")}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{l.debit ? money(l.debit) : ""}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{l.credit ? money(l.credit) : ""}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{money(l.balance)} {drcr(l.balance)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-[#13294B] font-semibold">
                  <td />
                  <td className="px-2 py-1.5">Closing balance</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(st.debit)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(st.credit)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(st.closing)} {drcr(st.closing)}</td>
                </tr>
              </tbody>
            </table>

            <div className="mt-4 flex justify-end">
              <div className={`rounded-lg border-2 px-4 py-2 text-right ${st.closing > 0 ? "border-[#B91C1C]" : "border-[#13294B]"}`}>
                <div className="text-[11px] text-[#6B7280]">{st.closing > 0 ? "Amount due from you" : st.closing < 0 ? "Amount payable to you" : "Balance"}</div>
                <div className={`text-lg font-bold tabular-nums ${st.closing > 0 ? "text-[#B91C1C]" : "text-[#13294B]"}`}>{st.closing ? `PKR ${money(st.closing)}` : "Clear"}</div>
              </div>
            </div>
            <p className="mt-4 text-[11px] text-[#6B7280]">
              Dr = owed to {p.trade_name || "HFK Enterprises"} · Cr = owed to you. Please tell us within 7 days if anything does not match your records.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
