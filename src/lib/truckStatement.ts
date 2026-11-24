/**
 * Truck Ledger Statement · ٹرک کھاتے کا گوشوارہ — one truck's khata as a proper document (A4 landscape):
 * letterhead, truck details, opening → received → paid → closing, the truck's profit, the driver's cash, a
 * summary by kind, then EVERY entry in full (nothing cut short) with its running balance, and signature lines.
 *
 * It is built as its own page (not a print of the screen), so the PDF has no browser date / address strip,
 * the description is never shortened, the column headings repeat on every page, and every page is numbered.
 */
import { CAT_LABEL, bucketTotals } from "./khataKinds.ts";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
const num = (n: number) => Math.round(Math.abs(Number(n) || 0)).toLocaleString("en-US");
const signed = (n: number) => `${n < 0 ? "−" : ""}${num(n)}`;
const dmy = (d: unknown) => {
  const s = String(d ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : "";
};
const list = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === "string" ? v.split(/\n|,/) : []).map((x) => String(x).trim()).filter(Boolean);
const kind = (c: string | null | undefined) => (c && (CAT_LABEL as Record<string, string>)[c]) || c || "";

export function truckStatementHtml(detail: any, company: any): string {
  const L = detail.ledger || {};
  const B = detail.balance || {};
  const reg = String(L.registration || L.vehicleNumber || "Truck");
  const co = company || {};
  const coName = co.tradeName || co.legalName || "HFK Enterprises (Pvt) Ltd";
  const logo = typeof co.logoDataUrl === "string" && co.logoDataUrl.startsWith("data:image/") ? co.logoDataUrl : "";
  const printed = new Date();
  const printedText = `${dmy(printed.toISOString().slice(0, 10))} ${printed.toTimeString().slice(0, 5)}`;
  const period = B.from || B.to ? `${dmy(B.from) || "start"} – ${dmy(B.to) || dmy(new Date().toISOString())}` : "All dates · تمام تاریخیں";
  const ref = `TLS-${reg.replace(/[^A-Za-z0-9]/g, "")}-${printed.toISOString().slice(0, 10).replace(/-/g, "")}`;

  // every entry of the period (the khata's own "Opening" row is the opening line), oldest first, running balance
  let carry = "";
  const rows = (detail.entries || [])
    .map((e: any, i: number) => {
      if (e.entryDate) carry = String(e.entryDate).slice(0, 10);
      return { e, i, key: carry };
    })
    .filter(({ e }: any) => (e.method || "") !== "Opening")
    .sort((a: any, b: any) => a.key.localeCompare(b.key) || a.i - b.i)
    .map(({ e }: any) => e);
  const opening = Number(B.opening) || 0;
  let run = opening;
  let totIn = 0;
  let totOut = 0;
  const body = rows
    .map((e: any, n: number) => {
      const fromCash = !!e.fromCash;
      const inn = Number(e.received) || 0;
      const out = fromCash ? 0 : Number(e.shownPaid ?? e.paid) || 0;
      run += inn - out;
      totIn += inn;
      totOut += out;
      const bits = [
        e.trip?.label ? `Trip: ${e.trip.label}` : "",
        e.routeFrom || e.routeTo ? `Route: ${[e.routeFrom, e.routeTo].filter(Boolean).join(" → ")}` : "",
        e.cargo ? `Load: ${e.cargo}` : "",
        e.partyFrom || e.partyTo ? `Party: ${[e.partyFrom, e.partyTo].filter(Boolean).join(" → ")}` : "",
        fromCash ? "Paid by the driver out of the cash given to him" : "",
        e.spentFromIt ? `Includes ${num(e.spentFromIt)} spent out of it (diesel / toll …)` : "",
      ].filter(Boolean);
      return `<tr>
        <td class="c n">${n + 1}</td>
        <td class="nw">${esc(dmy(e.entryDate) || e.rawDate || "—")}</td>
        <td class="desc" dir="auto">${esc(e.description || "—")}${bits.length ? `<div class="sub">${esc(bits.join("  ·  "))}</div>` : ""}</td>
        <td><span class="kind">${esc(kind(e.category))}</span></td>
        <td class="nw">${esc(e.method || "")}</td>
        <td class="r in">${inn ? num(inn) : ""}</td>
        <td class="r out">${fromCash ? `<span class="fc">(${num(Number(e.paid) || 0)})</span>` : out ? num(out) : ""}</td>
        <td class="r bal ${run < 0 ? "neg" : ""}">${signed(run)}</td>
      </tr>`;
    })
    .join("");
  const closing = Number(B.closing) || opening + totIn - totOut;
  const drift = Math.round(closing - run);

  const t = bucketTotals(detail.pnl?.byCategory || []);
  const cats = [...(detail.pnl?.byCategory || [])]
    .filter((c: any) => Number(c.received) || Number(c.paid))
    .sort((a: any, b: any) => Number(b.paid) + Number(b.received) - (Number(a.paid) + Number(a.received)));
  const dc = B.driverCash;
  const addr = [...list(co.addressLines), co.city, co.country].filter(Boolean).join(", ");
  const contact = [list(co.phones).join(" / "), co.email, co.ntn ? `NTN ${co.ntn}` : ""].filter(Boolean).join("  ·  ");
  const pa = detail.partnerAgreement;

  const card = (label: string, urdu: string, value: string, cls = "") =>
    `<div class="card ${cls}"><div class="cl">${label} <span>${urdu}</span></div><div class="cv">${value}</div></div>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(reg)} — Truck Ledger Statement</title>
<style>
  @page {
    size: A4 landscape;
    margin: 11mm 10mm 14mm 10mm;
    @top-left { content: ""; }
    @top-center { content: ""; }
    @top-right { content: ""; }
    @bottom-left { content: "${esc(coName)}  ·  Truck Ledger Statement  ·  ${esc(reg)}  ·  ${esc(ref)}"; font: 8px Arial, sans-serif; color: #6B7280; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8px Arial, sans-serif; color: #6B7280; }
  }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; color: #111827; font: 10.5px/1.4 "Segoe UI", Arial, "Noto Naskh Arabic", Tahoma, sans-serif; background: #fff; }
  .bar { position: sticky; top: 0; z-index: 5; display: flex; gap: 10px; align-items: center; padding: 10px 16px; background: #13294B; color: #fff; font: 600 13px Arial, sans-serif; }
  .bar button { border: 0; border-radius: 8px; padding: 7px 16px; font: 700 13px Arial, sans-serif; cursor: pointer; background: #fff; color: #13294B; }
  .bar span { flex: 1; font-weight: 400; color: #C9D7EC; }
  .page { padding: 14px 18px 24px; max-width: 1120px; margin: 0 auto; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; border-bottom: 2.5px solid #13294B; padding-bottom: 8px; }
  .brand { display: flex; gap: 12px; align-items: flex-start; }
  .brand img { height: 52px; width: auto; max-width: 150px; object-fit: contain; }
  .co { font-size: 19px; font-weight: 700; color: #13294B; line-height: 1.15; }
  .muted { color: #6B7280; font-size: 9.5px; }
  .title { text-align: right; }
  .title b { display: block; font-size: 17px; letter-spacing: .4px; color: #13294B; }
  .title .ur { font-size: 13px; color: #374151; }
  .pv { font-weight: 700; color: #111827; font-size: 10.5px; }
  .meta { display: grid; grid-template-columns: minmax(250px, 1.05fr) 2fr; gap: 14px; margin-top: 10px; }
  .truck { border: 1px solid #CBD5E1; border-radius: 8px; padding: 9px 12px; }
  .truck .reg { font-size: 22px; font-weight: 800; color: #13294B; letter-spacing: .5px; }
  .truck dl { margin: 6px 0 0; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; }
  .truck dt { color: #6B7280; }
  .truck dd { margin: 0; font-weight: 600; }
  .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; align-content: start; }
  .cards.small { grid-template-columns: repeat(6, 1fr); margin-top: 8px; }
  .card { border: 1px solid #D5DCE8; border-radius: 8px; padding: 6px 10px; background: #F8FAFC; }
  .card .cl { font-size: 9px; text-transform: uppercase; letter-spacing: .3px; color: #6B7280; }
  .card .cl span { text-transform: none; letter-spacing: 0; }
  .card .cv { font-size: 15px; font-weight: 800; font-variant-numeric: tabular-nums; margin-top: 1px; }
  .cards.small .cv { font-size: 12.5px; }
  .card.hi { background: #13294B; border-color: #13294B; color: #fff; }
  .card.hi .cl { color: #C9D7EC; }
  .card.neg .cv, .neg { color: #B91C1C; }
  .card.hi.neg .cv { color: #FCA5A5; }
  .card.pos .cv { color: #166534; }
  .note { margin-top: 8px; padding: 6px 10px; border-radius: 6px; font-size: 9.5px; }
  .note.red { background: #FEF2F2; border: 1px solid #FECACA; color: #7F1D1D; }
  .note.amber { background: #FFFBEB; border: 1px solid #FDE68A; color: #78350F; }
  h3 { margin: 14px 0 5px; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: #13294B; }
  table.led { width: 100%; border-collapse: collapse; margin-top: 4px; table-layout: fixed; }
  table.led thead { display: table-header-group; }
  table.led tfoot { display: table-row-group; }
  table.led th { background: #13294B; color: #fff; text-align: left; padding: 5px 6px; font-size: 9.5px; letter-spacing: .3px; }
  table.led th.r, table.led td.r { text-align: right; }
  table.led td { padding: 4px 6px; border-bottom: 1px solid #E5E9F0; vertical-align: top; }
  table.led tr { page-break-inside: avoid; break-inside: avoid; }
  table.led tbody tr:nth-child(even) td { background: #F8FAFC; }
  td.c, th.c { text-align: center; }
  td.n { color: #9CA3AF; }
  td.nw { white-space: nowrap; }
  td.desc { word-break: break-word; overflow-wrap: anywhere; font-weight: 500; }
  .sub { margin-top: 1px; font-size: 8.8px; font-weight: 400; color: #6B7280; }
  .kind { display: inline-block; border: 1px solid #CBD5E1; border-radius: 10px; padding: 0 6px; font-size: 9px; color: #374151; background: #fff; white-space: nowrap; }
  td.in { color: #166534; font-weight: 700; font-variant-numeric: tabular-nums; }
  td.out { color: #B91C1C; font-weight: 700; font-variant-numeric: tabular-nums; }
  td.bal { font-weight: 700; font-variant-numeric: tabular-nums; }
  .fc { color: #9CA3AF; font-weight: 400; font-style: italic; }
  tr.open td { background: #EEF2F8 !important; font-weight: 700; border-bottom: 1.5px solid #13294B; }
  tr.total td { background: #13294B !important; color: #fff; font-weight: 800; padding: 6px; font-variant-numeric: tabular-nums; border: 0; }
  tr.total td.neg { color: #FCA5A5; }
  .two { display: grid; grid-template-columns: 1.4fr 1fr; gap: 14px; align-items: start; break-inside: avoid; page-break-inside: avoid; }
  h3 { break-after: avoid; page-break-after: avoid; }
  table.sm { width: 100%; border-collapse: collapse; }
  table.sm th { text-align: left; background: #EEF2F8; padding: 4px 6px; font-size: 9px; color: #13294B; }
  table.sm th.r, table.sm td.r { text-align: right; }
  table.sm td { padding: 3px 6px; border-bottom: 1px solid #E5E9F0; font-variant-numeric: tabular-nums; }
  .foot { margin-top: 8px; font-size: 9px; color: #6B7280; }
  .sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 36px; margin-top: 34px; page-break-inside: avoid; break-inside: avoid; }
  .sign div { border-top: 1px solid #111827; padding-top: 4px; text-align: center; font-size: 9.5px; color: #374151; }
  @media screen {
    body { background: #E5E9F0; }
    .page { background: #fff; margin: 14px auto; box-shadow: 0 6px 24px rgba(15,23,42,.18); min-width: 1000px; }
    .bar { flex-wrap: wrap; }
  }
  @media screen and (max-width: 760px) { .bar span { display: none; } .bar { justify-content: space-between; } }
  @media print { .bar { display: none !important; } .page { max-width: none; padding: 0; margin: 0; } }
</style></head>
<body>
<div class="bar"><b>Truck Ledger Statement</b><span>Choose “Save as PDF” in the print window · پرنٹ ونڈو میں “Save as PDF” چنیں</span><button onclick="window.print()">Print / Save as PDF</button></div>
<div class="page">
  <div class="head">
    <div class="brand">
      ${logo ? `<img src="${esc(logo)}" alt="">` : ""}
      <div>
        <div class="co">${esc(coName)}</div>
        ${addr ? `<div class="muted">${esc(addr)}</div>` : ""}
        ${contact ? `<div class="muted">${esc(contact)}</div>` : ""}
      </div>
    </div>
    <div class="title">
      <b>TRUCK LEDGER STATEMENT</b>
      <div class="ur">ٹرک کھاتے کا گوشوارہ</div>
      <div class="muted">Period: <span class="pv">${esc(period)}</span></div>
      <div class="muted">Printed: ${esc(printedText)}  ·  Ref: ${esc(ref)}</div>
    </div>
  </div>

  <div class="meta">
    <div class="truck">
      <div class="muted">TRUCK · ٹرک</div>
      <div class="reg">${esc(reg)}</div>
      <dl>
        ${L.title && L.title !== reg ? `<dt>Ledger</dt><dd>${esc(L.title)}</dd>` : ""}
        ${L.ownerName ? `<dt>Owner · مالک</dt><dd dir="auto">${esc(L.ownerName)}</dd>` : ""}
        <dt>Driver · ڈرائیور</dt><dd dir="auto">${esc(L.driverName || "—")}${L.driverPhone ? `  ·  ${esc(L.driverPhone)}` : ""}</dd>
        ${pa ? `<dt>Agreement</dt><dd>${esc(pa.agreementNumber)} · price ${num(pa.agreedPrice)} · to pay ${num(pa.currentBalance)}</dd>` : L.isPartnership ? `<dt>Type</dt><dd>Partnership truck</dd>` : ""}
        <dt>Entries</dt><dd>${rows.length}</dd>
      </dl>
    </div>
    <div>
      <div class="cards">
        ${card("Opening balance", "ابتدائی", signed(opening), opening < 0 ? "neg" : "")}
        ${card("Total received · In", "آیا", num(totIn), "pos")}
        ${card("Total paid · Out", "گیا", num(totOut))}
        ${card(closing < 0 ? "Closing balance (short)" : "Closing balance", "اختتامی", signed(closing), `hi ${closing < 0 ? "neg" : ""}`)}
      </div>
      <div class="cards small">
        ${card("Income", "آمدن", num(t.income), "pos")}
        ${card("Expense", "خرچ", num(t.expense))}
        ${card("Truck's profit", "منافع", signed(t.profit), t.profit < 0 ? "neg" : "pos")}
        ${card("Shakhsi bardasht", "شخصی", num(t.shakhsi))}
        ${card("Safi bachat", "صافی بچت", num(t.safi))}
        ${dc ? card("Cash with driver", "ڈرائیور کے پاس", num(dc.withDriver)) : card("Entries", "اندراجات", String(rows.length))}
      </div>
    </div>
  </div>
  ${closing < 0 ? `<div class="note red">A negative balance is not an error: so far more went out of this khata than came in. It becomes normal once the truck's income is entered, or when money that was not for this truck is moved to its own ledger. · بیلنس منفی ہے یعنی اب تک آمدن سے زیادہ خرچ ہوا ہے۔</div>` : ""}
  ${dc ? `<div class="note amber">Driver's cash · ڈرائیور کی نقد: given <b>${num(dc.given)}</b> − spent out of it <b>${num(dc.spent)}</b>${dc.returned ? ` − returned <b>${num(dc.returned)}</b>` : ""} = still with the driver <b>${num(dc.withDriver)}</b>.</div>` : ""}

  <h3>All entries · تمام اندراجات</h3>
  <table class="led">
    <colgroup>
      <col style="width:28px"><col style="width:66px"><col><col style="width:92px"><col style="width:66px"><col style="width:78px"><col style="width:78px"><col style="width:88px">
    </colgroup>
    <thead><tr>
      <th class="c">#</th><th>Date · تاریخ</th><th>Description · تفصیل</th><th>Kind · قسم</th><th>Method</th><th class="r">In · آیا</th><th class="r">Out · گیا</th><th class="r">Balance · بقایا</th>
    </tr></thead>
    <tbody>
      <tr class="open"><td></td><td class="nw">${esc(dmy(B.from || B.openingDate))}</td><td colspan="3">Opening balance · ابتدائی بقایا${B.from ? " (carried forward)" : ""}</td><td></td><td></td><td class="r bal ${opening < 0 ? "neg" : ""}">${signed(opening)}</td></tr>
      ${body || `<tr><td colspan="8" style="text-align:center;padding:14px;color:#6B7280">No entries in this period · اس مدت میں کوئی اندراج نہیں</td></tr>`}
    </tbody>
    <tfoot><tr class="total"><td></td><td></td><td colspan="3">TOTAL · کل  &nbsp;(${rows.length} entries)</td><td class="r">${num(totIn)}</td><td class="r">${num(totOut)}</td><td class="r ${closing < 0 ? "neg" : ""}">${signed(closing)}</td></tr></tfoot>
  </table>
  <div class="foot">Amounts in (brackets) were paid by the driver out of the cash already given to him — they are part of that cash entry, not an extra payment. Closing = opening + in − out.${drift ? ` <b style="color:#B91C1C">Note: the rows above add up ${signed(run)} but the ledger's closing is ${signed(closing)} (difference ${signed(drift)}) — some entries may be outside this period.</b>` : ""}</div>

  <div class="two">
    <div>
      <h3>Summary by kind · قسم وار خلاصہ</h3>
      <table class="sm">
        <thead><tr><th>Kind · قسم</th><th class="r">Entries</th><th class="r">In · آیا</th><th class="r">Out · گیا</th></tr></thead>
        <tbody>
          ${cats.map((c: any) => `<tr><td>${esc(kind(c.category) || "—")}</td><td class="r">${Number(c.entries) || 0}</td><td class="r">${Number(c.received) ? num(c.received) : ""}</td><td class="r">${Number(c.paid) ? num(c.paid) : ""}</td></tr>`).join("") || `<tr><td colspan="4">—</td></tr>`}
        </tbody>
      </table>
    </div>
    <div>
      <h3>How to read this · کیسے پڑھیں</h3>
      <div class="muted" style="font-size:9.5px;line-height:1.55">
        <b>Income</b> = freight received; <b>Expense</b> = diesel, trip cash, repairs and other running costs; <b>Truck's profit</b> = income − expense.<br>
        <b>Shakhsi bardasht</b> (money taken for home) and <b>Safi bachat</b> (net saving handed out) are shown apart — they are not the truck's cost.<br>
        <b>Balance</b> = opening + everything received − everything paid.
      </div>
    </div>
  </div>

  <div class="sign"><div>Prepared by · تیار کردہ</div><div>Checked by (Accounts) · تصدیق</div><div>Owner / Driver — received correct · وصول کنندہ</div></div>
</div>
</body></html>`;
}

/** Opens the statement in its own window and offers the print dialog ("Save as PDF"). */
export function openTruckStatement(detail: any, company: any, existing?: Window | null): boolean {
  const w = existing || window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(truckStatementHtml(detail, company));
  w.document.close();
  // let the logo and fonts settle, then open the print window (the bar also has a Print button)
  setTimeout(() => {
    try {
      w.focus();
      w.print();
    } catch {
      /* the Print button is on the page */
    }
  }, 600);
  return true;
}
