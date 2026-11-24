/**
 * The one way every printout / PDF of the app is made.
 *
 * Browsers print the SCREEN by default: text cut short, the browser's own date / address strip, no repeated
 * headings. Everything here instead builds its own page — company letterhead, title, summary boxes, tables
 * whose text wraps in full (Urdu too), headings repeated on every page, "Page x of y", signature lines — and
 * opens it in its own window with the print dialog ("Save as PDF").
 *
 *   openPrint(build, onError)          opens the window first (a click lets it open), fills it when build() is done
 *   tableDocHtml(doc)                  title + summary boxes + one or more tables  (data you hand over)
 *   shellHtml({... bodyHtml})          the same letterhead / footer around HTML you already have (a report on screen)
 *   fetchCompany()                     the company profile for the letterhead
 */
import { enterpriseFetch } from "../../client/api.ts";

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
export const num = (n: unknown) => Math.round(Math.abs(Number(n) || 0)).toLocaleString("en-US");
export const signed = (n: unknown) => `${Number(n) < 0 ? "−" : ""}${num(n)}`;
export const dmy = (d: unknown) => {
  const s = String(d ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : "";
};
const list = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === "string" ? v.split(/\n|,/) : []).map((x) => String(x).trim()).filter(Boolean);

let companyCache: any = null;
/** The company profile (name, logo, address, phones, NTN) for the letterhead. Never throws. */
export async function fetchCompany(): Promise<any> {
  if (companyCache) return companyCache;
  try {
    const c = await enterpriseFetch("/api/enterprise/company-profile");
    if (c && !c.error) companyCache = c;
    return c || {};
  } catch {
    return {};
  }
}

/** The six empty page-margin boxes: defining them stops the browser printing its own date / title / address strip. */
export const PRINT_MARGIN_BOXES =
  "@top-left { content: \"\"; } @top-center { content: \"\"; } @top-right { content: \"\"; } @bottom-left { content: \"\"; } @bottom-center { content: \"\"; } @bottom-right { content: \"\"; }";

export interface PCol {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  width?: string; // css, e.g. "70px"; omit for "take the rest"
  nowrap?: boolean;
  tone?: "in" | "out" | "bal"; // green / red / bold
}
export interface PTable {
  heading?: string;
  columns: PCol[];
  rows: Array<Record<string, any>>; // a cell is text / number, or { html } (your own markup)
  opening?: { label: string; values?: Record<string, any> };
  totals?: { label: string; values: Record<string, any> };
  footnote?: string;
  index?: boolean; // a leading "#" column
  labelKey?: string; // the column the "Opening balance" / "TOTAL" label goes in (default: the first)
}
export interface PCard {
  label: string;
  urdu?: string;
  value: string;
  tone?: "hi" | "pos" | "neg" | "hi neg";
}
export interface PDoc {
  title: string; // "STATEMENT OF ACCOUNT"
  titleUrdu?: string;
  fileTitle?: string; // the PDF's file name
  period?: string;
  ref?: string;
  company: any;
  info?: { kicker?: string; big?: string; lines?: Array<[string, string]> };
  cards?: PCard[];
  smallCards?: PCard[];
  notes?: Array<{ tone: "red" | "amber"; html: string }>;
  tables?: PTable[];
  bodyHtml?: string; // free HTML after the tables
  signatures?: string[];
  orientation?: "landscape" | "portrait";
  footerLeft?: string;
}

const card = (c: PCard) =>
  `<div class="card ${c.tone || ""}"><div class="cl">${esc(c.label)} <span>${esc(c.urdu || "")}</span></div><div class="cv">${esc(c.value)}</div></div>`;

function css(orientation: "landscape" | "portrait", footerLeft: string, fs: number): string {
  return `
  @page {
    size: A4 ${orientation};
    margin: 11mm 10mm 14mm 10mm;
    @top-left { content: ""; } @top-center { content: ""; } @top-right { content: ""; }
    @bottom-left { content: "${footerLeft.replace(/"/g, "'")}"; font: 8px Arial, sans-serif; color: #6B7280; }
    @bottom-center { content: ""; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8px Arial, sans-serif; color: #6B7280; }
  }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; color: #111827; font: ${fs}px/1.4 "Segoe UI", Arial, "Noto Naskh Arabic", Tahoma, sans-serif; background: #fff; }
  .bar { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 10px 16px; background: #13294B; color: #fff; font: 600 13px Arial, sans-serif; }
  .bar button { border: 0; border-radius: 8px; padding: 7px 16px; font: 700 13px Arial, sans-serif; cursor: pointer; background: #fff; color: #13294B; }
  .bar span { flex: 1; font-weight: 400; color: #C9D7EC; }
  .page { padding: 14px 18px 24px; max-width: ${orientation === "landscape" ? 1120 : 800}px; margin: 0 auto; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; border-bottom: 2.5px solid #13294B; padding-bottom: 8px; }
  .brand { display: flex; gap: 12px; align-items: flex-start; }
  .brand img { height: 52px; width: auto; max-width: 150px; object-fit: contain; }
  .co { font-size: 19px; font-weight: 700; color: #13294B; line-height: 1.15; }
  .muted { color: #6B7280; font-size: 9.5px; }
  .title { text-align: right; }
  .title b { display: block; font-size: 17px; letter-spacing: .4px; color: #13294B; }
  .title .ur { font-size: 13px; color: #374151; }
  .pv { font-weight: 700; color: #111827; font-size: 10.5px; }
  .meta { display: grid; grid-template-columns: ${orientation === "landscape" ? "minmax(250px, 1.05fr) 2fr" : "1fr"}; gap: 14px; margin-top: 10px; }
  .meta.one { grid-template-columns: 1fr; }
  .info { border: 1px solid #CBD5E1; border-radius: 8px; padding: 9px 12px; }
  .info .big { font-size: 20px; font-weight: 800; color: #13294B; letter-spacing: .4px; }
  .info dl { margin: 6px 0 0; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; }
  .info dt { color: #6B7280; } .info dd { margin: 0; font-weight: 600; }
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
  h3 { margin: 14px 0 5px; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; color: #13294B; break-after: avoid; page-break-after: avoid; }
  table.led { width: 100%; border-collapse: collapse; margin-top: 4px; table-layout: fixed; }
  table.led thead { display: table-header-group; }
  table.led tfoot { display: table-row-group; }
  table.led th { background: #13294B; color: #fff; text-align: left; padding: 5px 6px; font-size: ${Math.max(7.5, fs - 1)}px; letter-spacing: .3px; vertical-align: bottom; }
  table.led th.r, table.led td.r { text-align: right; }
  table.led th.c, table.led td.c { text-align: center; }
  table.led td { padding: 4px 6px; border-bottom: 1px solid #E5E9F0; vertical-align: top; word-break: break-word; overflow-wrap: anywhere; }
  table.led tr { page-break-inside: avoid; break-inside: avoid; }
  table.led tbody tr:nth-child(even) td { background: #F8FAFC; }
  td.nw { white-space: nowrap; word-break: normal; overflow-wrap: normal; }
  td.n { color: #9CA3AF; }
  td.in { color: #166534; font-weight: 700; font-variant-numeric: tabular-nums; }
  td.out { color: #B91C1C; font-weight: 700; font-variant-numeric: tabular-nums; }
  td.bal { font-weight: 700; font-variant-numeric: tabular-nums; }
  td.bal.neg { color: #B91C1C; }
  tr.open td { background: #EEF2F8 !important; font-weight: 700; border-bottom: 1.5px solid #13294B; }
  tr.total td { background: #13294B !important; color: #fff; font-weight: 800; padding: 6px; font-variant-numeric: tabular-nums; border: 0; }
  tr.total td.neg { color: #FCA5A5; }
  .foot { margin-top: 8px; font-size: 9px; color: #6B7280; }
  .sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 36px; margin-top: 34px; page-break-inside: avoid; break-inside: avoid; }
  .sign div { border-top: 1px solid #111827; padding-top: 4px; text-align: center; font-size: 9.5px; color: #374151; }
  .body { margin-top: 10px; }
  @media screen {
    body { background: #E5E9F0; }
    .page { background: #fff; margin: 14px auto; box-shadow: 0 6px 24px rgba(15,23,42,.18); min-width: ${orientation === "landscape" ? 1000 : 720}px; }
  }
  @media screen and (max-width: 760px) { .bar span { display: none; } .bar { justify-content: space-between; } }
  @media print { .bar { display: none !important; } .page { max-width: none; padding: 0; margin: 0; min-width: 0; } .noprint { display: none !important; } }`;
}

function letterhead(company: any, title: string, titleUrdu: string | undefined, period: string | undefined, ref: string, printedText: string) {
  const co = company || {};
  const name = co.tradeName || co.legalName || "HFK Enterprises (Pvt) Ltd";
  const logo = typeof co.logoDataUrl === "string" && co.logoDataUrl.startsWith("data:image/") ? co.logoDataUrl : "";
  const addr = [...list(co.addressLines), co.city, co.country].filter(Boolean).join(", ");
  const contact = [list(co.phones).join(" / "), co.email, co.ntn ? `NTN ${co.ntn}` : ""].filter(Boolean).join("  ·  ");
  return `<div class="head">
    <div class="brand">
      ${logo ? `<img src="${esc(logo)}" alt="">` : ""}
      <div><div class="co">${esc(name)}</div>${addr ? `<div class="muted">${esc(addr)}</div>` : ""}${contact ? `<div class="muted">${esc(contact)}</div>` : ""}</div>
    </div>
    <div class="title">
      <b>${esc(title)}</b>
      ${titleUrdu ? `<div class="ur">${esc(titleUrdu)}</div>` : ""}
      ${period ? `<div class="muted">Period: <span class="pv">${esc(period)}</span></div>` : ""}
      <div class="muted">Printed: ${esc(printedText)}  ·  Ref: ${esc(ref)}</div>
    </div>
  </div>`;
}

function frame(doc: { title: string; fileTitle?: string; company: any; orientation: "landscape" | "portrait"; footerLeft?: string; ref: string; fs: number }, inner: string, titleUrdu: string | undefined, period: string | undefined) {
  const printed = new Date();
  const printedText = `${dmy(printed.toISOString().slice(0, 10))} ${printed.toTimeString().slice(0, 5)}`;
  const name = doc.company?.tradeName || doc.company?.legalName || "HFK Enterprises (Pvt) Ltd";
  const footerLeft = doc.footerLeft || `${name}  ·  ${doc.title}  ·  ${doc.ref}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.fileTitle || doc.title)}</title><style>${css(doc.orientation, footerLeft, doc.fs)}</style></head><body>
<div class="bar"><b>${esc(doc.title)}</b><span>Choose “Save as PDF” in the print window · پرنٹ ونڈو میں “Save as PDF” چنیں</span><button onclick="window.print()">Print / Save as PDF</button></div>
<div class="page">${letterhead(doc.company, doc.title, titleUrdu, period, doc.ref, printedText)}${inner}</div></body></html>`;
}

const cellText = (v: any) => (v && typeof v === "object" && "html" in v ? String(v.html) : esc(v ?? ""));

const isNeg = (v: unknown) => /^[−-]/.test(String(v ?? ""));

function tableHtml(t: PTable): string {
  const cols = t.index ? [{ key: "__n", label: "#", align: "center" as const, width: "30px" }, ...t.columns] : t.columns;
  const labelKey = t.labelKey || t.columns[0]?.key;
  const al = (c: PCol) => (c.align === "right" ? "r" : c.align === "center" ? "c" : "");
  const colgroup = `<colgroup>${cols.map((c) => `<col${c.width ? ` style="width:${c.width}"` : ""}>`).join("")}</colgroup>`;
  const head = `<thead><tr>${cols.map((c) => `<th class="${al(c)}">${esc(c.label)}</th>`).join("")}</tr></thead>`;
  // opening / total rows: the label in one column, the figures in the others
  const special = (cls: string, label: string, values: Record<string, any>) =>
    `<tr class="${cls}">${cols.map((c) => `<td class="${al(c)}${c.tone === "bal" && isNeg(values[c.key]) ? " neg" : ""}">${c.key === labelKey ? esc(label) : cellText(values[c.key])}</td>`).join("")}</tr>`;
  const open = t.opening ? special("open", t.opening.label, t.opening.values || {}) : "";
  const body = t.rows
    .map((r, n) => `<tr>${cols.map((c) => `<td class="${[al(c), c.nowrap ? "nw" : "", c.tone || "", c.key === "__n" ? "n" : "", c.tone === "bal" && isNeg(r[c.key]) ? "neg" : ""].filter(Boolean).join(" ")}"${c.key === "__n" ? "" : ' dir="auto"'}>${c.key === "__n" ? n + 1 : cellText(r[c.key])}</td>`).join("")}</tr>`)
    .join("");
  const empty = `<tr><td colspan="${cols.length}" style="text-align:center;padding:14px;color:#6B7280">No records · کوئی اندراج نہیں</td></tr>`;
  const foot = t.totals ? `<tfoot>${special("total", t.totals.label, t.totals.values)}</tfoot>` : "";
  return `${t.heading ? `<h3>${esc(t.heading)}</h3>` : ""}<table class="led">${colgroup}${head}<tbody>${open}${body || (t.opening ? "" : empty)}</tbody>${foot}</table>${t.footnote ? `<div class="foot">${t.footnote}</div>` : ""}`;
}

/** Title + summary boxes + tables, on the letterhead. */
export function tableDocHtml(doc: PDoc): string {
  const orientation = doc.orientation || "landscape";
  const ref = doc.ref || `DOC-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
  const widest = Math.max(0, ...(doc.tables || []).map((t) => t.columns.length + (t.index ? 1 : 0)));
  const fs = widest > 16 ? 7.8 : widest > 11 ? 8.8 : widest > 8 ? 9.6 : 10.5;
  const hasTop = !!(doc.info || doc.cards?.length);
  const inner = `
  ${
    hasTop
      ? `<div class="meta ${doc.info && orientation === "landscape" ? "" : "one"}">
    ${
      doc.info
        ? `<div class="info">${doc.info.kicker ? `<div class="muted">${esc(doc.info.kicker)}</div>` : ""}${doc.info.big ? `<div class="big">${esc(doc.info.big)}</div>` : ""}<dl>${(doc.info.lines || []).map(([k, v]) => `<dt>${esc(k)}</dt><dd dir="auto">${esc(v)}</dd>`).join("")}</dl></div>`
        : ""
    }
    <div>${doc.cards?.length ? `<div class="cards">${doc.cards.map(card).join("")}</div>` : ""}${doc.smallCards?.length ? `<div class="cards small">${doc.smallCards.map(card).join("")}</div>` : ""}</div>
  </div>`
      : ""
  }
  ${(doc.notes || []).map((n) => `<div class="note ${n.tone}">${n.html}</div>`).join("")}
  ${(doc.tables || []).map(tableHtml).join("")}
  ${doc.bodyHtml ? `<div class="body">${doc.bodyHtml}</div>` : ""}
  ${doc.signatures?.length ? `<div class="sign">${doc.signatures.map((s) => `<div>${esc(s)}</div>`).join("")}</div>` : ""}`;
  return frame({ title: doc.title, fileTitle: doc.fileTitle, company: doc.company, orientation, footerLeft: doc.footerLeft, ref, fs }, inner, doc.titleUrdu, doc.period);
}

/** The letterhead and footer around HTML that already exists (a report as it is on screen). */
export function shellHtml(o: { title: string; titleUrdu?: string; fileTitle?: string; period?: string; company: any; bodyHtml: string; orientation?: "landscape" | "portrait"; ref?: string; extraHead?: string }): string {
  const orientation = o.orientation || "portrait";
  const ref = o.ref || `DOC-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
  const html = frame({ title: o.title, fileTitle: o.fileTitle, company: o.company, orientation, ref, fs: 10.5 }, `<div class="body">${o.bodyHtml}</div>`, o.titleUrdu, o.period);
  return o.extraHead ? html.replace("</head>", `${o.extraHead}</head>`) : html;
}

/**
 * Opens the window FIRST (a click is what lets a pop-up open), shows "Preparing…", then fills it with build()'s
 * HTML and offers the print dialog. Returns false when the browser blocked the window.
 */
export async function openPrint(build: () => Promise<string>, onError: (message: string) => void): Promise<boolean> {
  const w = window.open("", "_blank");
  if (!w) {
    onError("Allow pop-ups for this site, then press the button again · پاپ اپ کی اجازت دیں");
    return false;
  }
  w.document.write("<!doctype html><meta charset='utf-8'><title>Preparing…</title><body style='font-family:Arial,sans-serif;padding:28px;color:#13294B'>Preparing the document… · دستاویز تیار ہو رہی ہے…</body>");
  try {
    const html = await build();
    w.document.open();
    w.document.write(html);
    w.document.close();
    setTimeout(() => {
      try {
        w.focus();
        w.print();
      } catch {
        /* the Print button is on the page */
      }
    }, 700);
    return true;
  } catch (e: any) {
    w.close();
    onError(e?.message || "Could not prepare the document");
    return false;
  }
}

/** Copies the app's stylesheets into the new page, so HTML taken from the screen looks the same there. */
export function appStylesHtml(): string {
  const out: string[] = [];
  document.querySelectorAll('link[rel="stylesheet"], style').forEach((el) => {
    if (el.tagName === "LINK") out.push(`<link rel="stylesheet" href="${(el as HTMLLinkElement).href}">`);
    else out.push(`<style>${el.textContent || ""}</style>`);
  });
  return out.join("\n");
}

/** A copy of a piece of the screen made ready to print: buttons, inputs and anything marked .no-print removed. */
export function printableCopy(el: Element): string {
  const c = el.cloneNode(true) as HTMLElement;
  c.querySelectorAll(".no-print, button, input, select, textarea, [data-noprint]").forEach((n) => n.remove());
  return c.innerHTML;
}
