/**
 * AlertsCenter — one red board for every warning in the system.
 *
 * Each alert is RED with WHITE text (consistent everywhere). Click a row to see
 * exactly WHAT it is and the PROOF (which receipts, which truck, which entries),
 * jump to the right sheet, or acknowledge / resolve it so it stops showing.
 *
 * Feed: GET /api/alerts  (duplicate receipts, fuel theft, ledger review,
 * overdue dues, do-not-pay, document expiry).
 */
import React, { useCallback, useEffect, useState } from "react";
import { enterpriseFetch, fetchBlobUrl } from "../../../client/api.ts";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  FileWarning,
  Fuel,
  Clock,
  Ban,
} from "lucide-react";

interface AlertRow {
  key: string;
  type: string;
  severity: "critical" | "high" | "medium" | "low";
  module: string;
  title: string;
  message: string;
  detail?: any;
  links?: { label: string; wb: string; sheet: string; focus?: { ledgerId?: number; partyId?: number } }[];
  count?: number;
  createdAt: string;
  ack?: { status: string; note: string | null } | null;
}

const TYPE_ICON: Record<string, any> = {
  duplicate_receipt: FileWarning,
  duplicate_entry: FileWarning,
  fuel_theft: Fuel,
  ledger_review: AlertTriangle,
  dues_overdue: Clock,
  do_not_pay: Ban,
  doc_expiry: ShieldCheck,
};

const SEV_BG: Record<string, string> = {
  critical: "#991B1B",
  high: "#DC2626",
  medium: "#EA580C",
  low: "#B45309",
};

export default function AlertsCenter({
  showFeedback,
  compact,
  onNavigate,
}: {
  showFeedback: (t: "success" | "error", m: string) => void;
  compact?: boolean;
  onNavigate?: (wb: string, sheet: string, focus?: { ledgerId?: number; partyId?: number }) => void;
}) {
  const [data, setData] = useState<{ alerts: AlertRow[]; counts: any; byType: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [includeAcked, setIncludeAcked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    enterpriseFetch(`/api/alerts${includeAcked ? "?includeAcked=1" : ""}`)
      .then(setData)
      .catch((e) => showFeedback("error", e.message))
      .finally(() => setLoading(false));
  }, [showFeedback, includeAcked]);
  useEffect(load, [load]);

  const act = async (a: AlertRow, status: "ack" | "resolved") => {
    setBusy(a.key);
    try {
      await enterpriseFetch("/api/alerts/ack", {
        method: "POST",
        body: JSON.stringify({ alertKey: a.key, alertType: a.type, status }),
      });
      showFeedback("success", status === "resolved" ? "Alert resolved" : "Alert acknowledged");
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(null);
    }
  };
  const unAck = async (a: AlertRow) => {
    setBusy(a.key);
    try {
      await enterpriseFetch(`/api/alerts/ack/${encodeURIComponent(a.key)}`, { method: "DELETE" });
      load();
    } catch (e: any) {
      showFeedback("error", e.message);
    } finally {
      setBusy(null);
    }
  };

  const alerts = data?.alerts || [];
  const c = data?.counts || { total: 0, critical: 0, high: 0, medium: 0, low: 0 };

  return (
    <div className={compact ? "flex flex-col h-full min-h-0" : "space-y-3"}>
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        {!compact && <h2 className="text-base font-bold">Alerts</h2>}
        <span className="text-[11px] rounded-full bg-[#DC2626] text-white font-bold px-2 py-0.5">
          {c.total} total
        </span>
        {c.critical > 0 && <Chip n={c.critical} label="critical" bg="#991B1B" />}
        {c.high > 0 && <Chip n={c.high} label="high" bg="#DC2626" />}
        {c.medium > 0 && <Chip n={c.medium} label="medium" bg="#EA580C" />}
        <div className="flex-1" />
        <label className="text-[11px] flex items-center gap-1 text-[#4B5563]">
          <input type="checkbox" checked={includeAcked} onChange={(e) => setIncludeAcked(e.target.checked)} />
          show acknowledged · حل شدہ دکھائیں
        </label>
        <button
          onClick={load}
          className="flex items-center gap-1 text-xs border border-[#E5E7EB] rounded-lg px-2 py-1 bg-white hover:bg-[#F0FAF4]"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className={`space-y-2 ${compact ? "flex-1 min-h-0 overflow-y-auto pr-1" : ""}`}>
        {!loading && alerts.length === 0 && (
          <div className="rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D] px-3 py-4 text-sm flex items-center gap-2">
            <Check className="w-4 h-4" /> All clear — no alerts · سب ٹھیک ہے، کوئی انتباہ نہیں
          </div>
        )}
        {alerts.map((a) => {
          const Icon = TYPE_ICON[a.type] || AlertTriangle;
          const isOpen = open === a.key;
          return (
            <div key={a.key} className="rounded-lg overflow-hidden border border-[#B91C1C]">
              <button
                onClick={() => setOpen(isOpen ? null : a.key)}
                className="w-full text-left px-3 py-2 flex items-start gap-2"
                style={{ background: SEV_BG[a.severity] || "#DC2626", color: "#fff" }}
              >
                <Icon className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#fff", stroke: "#fff" }} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="font-bold text-[13px]" style={{ color: "#fff" }}>{a.title}</span>
                    {a.ack && (
                      <span className="text-[9px] uppercase bg-white/25 rounded px-1 py-0.5">{a.ack.status}</span>
                    )}
                  </span>
                  <span className="block text-[11px] leading-snug" style={{ color: "#fff", opacity: 0.92 }} dir="auto">
                    {a.message}
                  </span>
                  <span className="block text-[9px] mt-0.5" style={{ color: "#fff", opacity: 0.7 }}>
                    {a.module} · {a.severity.toUpperCase()} · {new Date(a.createdAt).toLocaleString()}
                  </span>
                </span>
                {isOpen ? (
                  <ChevronDown className="w-4 h-4 shrink-0" style={{ color: "#fff", stroke: "#fff" }} />
                ) : (
                  <ChevronRight className="w-4 h-4 shrink-0" style={{ color: "#fff", stroke: "#fff" }} />
                )}
              </button>

              {isOpen && (
                <div className="bg-white p-3 text-xs space-y-3 border-t border-[#B91C1C]">
                  <AlertProof alert={a} />
                  <div className="flex flex-wrap gap-2 pt-1 border-t border-[#F3F4F6]">
                    {(a.links || []).map((l, i) => (
                      <button
                        key={i}
                        onClick={() => onNavigate?.(l.wb, l.sheet, l.focus)}
                        className="flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-2 py-1 hover:bg-[#F0FAF4]"
                      >
                        <ExternalLink className="w-3 h-3" /> {l.label}
                      </button>
                    ))}
                    <div className="flex-1" />
                    {a.ack ? (
                      <button
                        onClick={() => unAck(a)}
                        disabled={busy === a.key}
                        className="rounded-md border border-[#E5E7EB] px-2 py-1 hover:bg-[#F0FAF4]"
                      >
                        Un-acknowledge
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => act(a, "ack")}
                          disabled={busy === a.key}
                          className="rounded-md border border-[#E5E7EB] px-2 py-1 hover:bg-[#F0FAF4] flex items-center gap-1"
                        >
                          <Check className="w-3 h-3" /> Acknowledge
                        </button>
                        <button
                          onClick={() => act(a, "resolved")}
                          disabled={busy === a.key}
                          className="rounded-md bg-[#16A34A] text-white px-2 py-1 flex items-center gap-1"
                        >
                          <ShieldCheck className="w-3 h-3" /> Mark resolved
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Chip({ n, label, bg }: { n: number; label: string; bg: string }) {
  return (
    <span className="text-[10px] rounded-full text-white font-bold px-2 py-0.5" style={{ background: bg }}>
      {n} {label}
    </span>
  );
}

/** the "proof" panel — what makes this an alert */
function AlertProof({ alert }: { alert: AlertRow }) {
  const d = alert.detail || {};
  if (alert.type === "duplicate_receipt" && Array.isArray(d.copies)) {
    return (
      <div>
        <p className="font-semibold mb-1" dir="auto">This exact file is attached in these places · یہ فائل اِن جگہوں پر لگی ہے:</p>
        <div className="space-y-1">
          {d.copies.map((cp: any) => (
            <div key={cp.id} className="flex items-center justify-between gap-2 border border-[#FECACA] bg-[#FEF2F2] rounded px-2 py-1">
              <span className="min-w-0">
                <span className="font-medium truncate block">{cp.fileName}</span>
                <span className="text-[10px] text-[#6B7280]">
                  {cp.entityType} #{cp.entityId} · {new Date(cp.uploadedAt).toLocaleString()}
                </span>
              </span>
              <ReceiptLink url={cp.fileUrl} />
            </div>
          ))}
        </div>
        <p className="text-[10px] text-[#6B7280] mt-1">
          If it was attached twice by mistake, remove one copy from its entry · اگر غلطی سے دو بار لگی ہے تو ایک کاپی ہٹا دیں۔
        </p>
      </div>
    );
  }
  if (alert.type === "duplicate_entry") {
    return (
      <div className="space-y-1 text-[11px]">
        <Row k={d.scope === "party" ? "Party" : "Truck"} v={d.party || d.truck} />
        <Row k="Amount · رقم" v={`PKR ${Number(d.amount || 0).toLocaleString()}`} />
        <Row k="Date · تاریخ" v={d.date} />
        {d.ref && <Row k="Ref / note · حوالہ" v={d.ref} />}
        <Row k="Recorded" v={`${(d.entryIds || []).length}× — entry ids ${(d.entryIds || []).join(", ")}`} />
        <p className="text-[10px] text-[#6B7280] pt-1" dir="auto">
          Same amount, date and reference recorded more than once for the same account — someone may be claiming
          the same slip twice. Open the ledger and delete the extra entry. · ایک ہی رقم، تاریخ اور حوالہ کئی بار۔
        </p>
      </div>
    );
  }
  if (alert.type === "fuel_theft") {
    const cc = d.calc;
    const pkr = (n: number) => "PKR " + Math.round(n || 0).toLocaleString();
    return (
      <div className="space-y-2">
        <div className="text-[11px] space-y-0.5">
          <Row k="What happened · کیا ہوا" v={d.alertLabel || d.alertCode} />
          <Row k="Truck · ٹرک" v={d.vehicle} />
          <Row k="Driver · ڈرائیور" v={d.driver} />
        </div>

        {cc && cc.overdrawLitres != null ? (
          <div className="rounded-md border border-[#FECACA] bg-[#FEF2F2] p-2">
            <p className="font-semibold text-[11px] mb-1" dir="auto">Calculation — why is it suspicious? · حساب</p>
            <table className="w-full text-[11px]">
              <tbody>
                <CalcRow k="Fuel drawn · ڈلوایا" v={`${cc.litres} L`} />
                <CalcRow k="Rate · ریٹ" v={`${pkr(cc.ratePerL)} / L  →  ${pkr(cc.valuePKR)}`} />
                <CalcRow k="Distance to next fill (odometer) · اگلے فِل تک سفر" v={`${cc.legKm} km`} />
                <CalcRow k="Benchmark (loaded truck) · معیار" v={`${cc.benchmarkKmpl} km / litre`} />
                <CalcRow k="Expected fuel = km ÷ benchmark" v={`${cc.legKm} ÷ ${cc.benchmarkKmpl} = ${cc.expectedLitres} L`} />
                <CalcRow
                  k="Over-draw · زائد نکلا"
                  v={`${cc.litres} − ${cc.expectedLitres} = ${cc.overdrawLitres} L  (+${cc.overdrawPct}%)`}
                  bold
                />
                <CalcRow k="Mileage on this fill · اس فِل کی ایوریج" v={`${cc.impliedKmpl} km / litre`} />
                <CalcRow k="Suspect value · مشتبہ مالیت" v={`${cc.overdrawLitres} L × ${pkr(cc.ratePerL)} = ${pkr(cc.suspectValuePKR)}`} bold />
              </tbody>
            </table>
            <p className="text-[10px] text-[#6B7280] mt-1.5" dir="auto">
              Suspicious because more fuel was drawn than the distance to the next fill can justify, beyond the
              tolerance. · اتنا فیول ڈلوایا مگر اگلے فِل تک اتنا سفر نہیں ہوا۔
            </p>
          </div>
        ) : (
          <p className="text-[11px] text-[#6B7280]" dir="auto">
            {d.rawDescription}
            <br />
            <span className="text-[10px]">
              Odometer / next-fill data is incomplete, so the full calculation isn't available — see the per-driver
              breakdown on the Fuel Theft Audit sheet. · مکمل حساب دستیاب نہیں — Fuel Theft Audit شیٹ دیکھیں۔
            </span>
          </p>
        )}
      </div>
    );
  }
  if ((alert.type === "dues_overdue" || alert.type === "do_not_pay") && Array.isArray(d.parties)) {
    return (
      <div className="space-y-1">
        {d.parties.slice(0, 25).map((p: any) => (
          <div key={p.id} className="flex items-center justify-between border-b border-[#F3F4F6] py-1">
            <span dir="auto">{p.name}{p.phone ? ` · ${p.phone}` : ""}{p.daysSince != null ? ` · ${p.daysSince}d idle` : ""}</span>
            <span className={`font-bold tabular-nums ${p.balance > 0 ? "text-[#15803D]" : "text-[#B91C1C]"}`}>
              PKR {Math.abs(p.balance).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (alert.type === "ledger_review" && Array.isArray(d.sample)) {
    return (
      <div className="space-y-1">
        {d.sample.map((s: any) => (
          <div key={s.id} className="border-b border-[#F3F4F6] py-1">
            <span className="block" dir="auto">{s.description || "—"}</span>
            {s.reason && <span className="text-[10px] text-[#B45309]">{s.reason}</span>}
          </div>
        ))}
      </div>
    );
  }
  if (alert.type === "doc_expiry" && Array.isArray(d.items)) {
    return (
      <div className="space-y-1">
        {d.items.map((it: any, i: number) => (
          <div key={i} className="flex items-center justify-between border-b border-[#F3F4F6] py-1">
            <span>{it.vehicle || it.driver} — {it.doc}</span>
            <span className={it.past ? "text-[#B91C1C] font-bold" : "text-[#B45309]"}>
              {it.past ? "EXPIRED " : "expires "}
              {new Date(it.expiry).toLocaleDateString()}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return <pre className="text-[10px] bg-[#F9FAFB] p-2 rounded overflow-x-auto">{JSON.stringify(d, null, 1)}</pre>;
}

function Row({ k, v }: { k: string; v: any }) {
  if (v == null || v === "") return null;
  return (
    <div className="flex gap-2">
      <span className="text-[#6B7280] w-40 shrink-0" dir="auto">{k}</span>
      <span className="font-medium" dir="auto">{String(v)}</span>
    </div>
  );
}

function CalcRow({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <tr className={bold ? "font-bold text-[#B91C1C]" : ""}>
      <td className="py-0.5 pr-2 align-top text-[#4B5563]" dir="auto">{k}</td>
      <td className="py-0.5 text-right tabular-nums whitespace-nowrap" dir="auto">{v}</td>
    </tr>
  );
}

function ReceiptLink({ url }: { url: string }) {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetchBlobUrl(url)
      .then((u) => alive && setHref(u))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [url]);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="text-[#2563EB] underline shrink-0">
      view
    </a>
  ) : (
    <span className="text-[#9CA3AF] shrink-0">…</span>
  );
}
