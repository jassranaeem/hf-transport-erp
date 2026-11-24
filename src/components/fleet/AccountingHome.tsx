/**
 * Accounting Home · اکاؤنٹنگ — the first sheet of the Accounting tab: what each part does, in
 * English and Urdu, with its live figure, and the daily / monthly / yearly routine.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  Calculator, ShieldCheck, BookOpenCheck, Landmark, FileBarChart, Receipt, Wallet, ListTree, ArrowRight, RefreshCw, Loader2,
  CheckCircle2, AlertTriangle, CalendarDays, CalendarRange, CalendarClock, Bot, ChevronRight,
} from "lucide-react";
import { PageHeader, Btn } from "../ui/kit.tsx";
import { enterpriseFetch } from "../../../client/api.ts";

type Nav = (wb: string, sheet: string, focus?: any) => void;
const PKR = (v: number) => (v < 0 ? "−" : "") + "PKR " + Math.abs(Math.round(v || 0)).toLocaleString("en-US");
const today = () => new Date().toISOString().slice(0, 10);
const dmy = (d: string) => (d ? d.slice(0, 10).split("-").reverse().join(".") : "");

type Tone = "good" | "bad" | "warn" | "plain";
interface Live { text: string; tone: Tone }

export default function AccountingHome({ onNavigate }: { showFeedback?: any; onNavigate?: Nav }) {
  const [live, setLive] = useState<Record<string, Live | null>>({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const now = new Date();
    const fy = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    const from = `${fy}-07-01`;
    const to = `${fy + 1}-06-30`;
    const put = (k: string, v: Live | null) => setLive((o) => ({ ...o, [k]: v }));
    const jobs = [
      enterpriseFetch("/api/books-check/summary").then((r) =>
        put("check", r.red ? { text: `${r.red.toLocaleString()} mistakes to correct · ${r.amber.toLocaleString()} to look at`, tone: "bad" } : r.amber ? { text: `No red mistakes · ${r.amber.toLocaleString()} to look at`, tone: "warn" } : { text: "All checks pass ✓", tone: "good" }),
      ),
      Promise.all([enterpriseFetch("/api/books/status"), enterpriseFetch(`/api/books/trial-balance?from=${from}&to=${to}`)]).then(([s, tb]) => {
        const ok = tb.totals.debit === tb.totals.credit;
        put("books", { text: `${ok ? "Balanced ✓" : "NOT balanced"} · ${(s.autoEntries || 0).toLocaleString()} entries · built ${s.lastRebuildAt ? new Date(s.lastRebuildAt).toLocaleString("en-GB") : "—"}`, tone: ok ? "good" : "bad" });
        put("lock", { text: s.lockedThrough ? `Books closed through ${dmy(s.lockedThrough)}` : "No month closed yet", tone: s.lockedThrough ? "good" : "plain" });
      }),
      enterpriseFetch("/api/bank/accounts").then((r) => {
        const un = r.accounts.reduce((s: number, a: any) => s + (a.unexplained || 0), 0);
        const diff = r.accounts.filter((a: any) => a.statement_balance != null && a.statement_balance !== a.books_balance).length;
        const none = r.accounts.filter((a: any) => !a.lines).length;
        put("banks", { text: `${un} line(s) to explain · ${diff} bank(s) differ · ${none} of ${r.accounts.length} without a statement`, tone: un || diff ? "bad" : none ? "warn" : "good" });
      }),
      enterpriseFetch(`/api/statements/pnl?from=${from}&to=${to}`).then((r) =>
        put("statements", { text: `FY ${fy}-${String((fy + 1) % 100).padStart(2, "0")}: income ${PKR(r.totalIncome)} · ${r.profit >= 0 ? "profit" : "loss"} ${PKR(Math.abs(r.profit))}`, tone: r.profit >= 0 ? "good" : "bad" }),
      ),
      enterpriseFetch(`/api/tax/summary?from=${from}&to=${to}`).then((r) =>
        put("tax", { text: `${r.notDeposited > 0 ? `${PKR(r.notDeposited)} not yet paid to FBR` : "Nothing pending to FBR"} · ${r.ratesMissing ? `${r.ratesMissing} rate(s) not entered` : "rates entered ✓"}`, tone: r.notDeposited > 0 ? "bad" : r.ratesMissing ? "warn" : "good" }),
      ),
      enterpriseFetch("/api/ai-accountant/status").then((r) =>
        put("ai", { text: `${r.ai.on ? `AI on (${r.ai.provider})` : "AI off — rules only"} · ${r.drafts} draft(s) to approve${r.reclass ? ` · ${r.reclass} category proposal(s)` : ""}`, tone: r.drafts ? "warn" : r.ai.on ? "good" : "plain" }),
      ),
      enterpriseFetch(`/api/cash-book/count?date=${today()}`).then((r) =>
        put("cash", !r.count ? { text: `Today not counted yet · book says ${PKR(r.book.closing)}`, tone: "warn" } : r.difference === 0 ? { text: `Today counted — matches ${PKR(r.book.closing)} ✓`, tone: "good" } : { text: `Today: ${r.difference < 0 ? "short" : "extra"} ${PKR(Math.abs(r.difference))}`, tone: "bad" }),
      ),
    ];
    Promise.allSettled(jobs).finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const go = (wb: string, sheet: string) => onNavigate?.(wb, sheet);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Accounting"
        urdu="اکاؤنٹنگ"
        icon={<Calculator />}
        subtitle="The company's accounts, kept by the system itself — today's state of each part · ہر حصے کی آج کی حالت"
        actions={<Btn kind="secondary" onClick={load} icon={loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}>Refresh · تازہ کریں</Btn>}
      />
      <details className="rounded-xl border border-[#E3E8EF] bg-white px-4 py-3 group">
        <summary className="cursor-pointer text-[13px] font-medium text-[#24539B] list-none flex items-center gap-1.5">
          <ChevronRight className="w-4 h-4 transition-transform group-open:rotate-90" /> How the system keeps the accounts · سسٹم حساب کیسے رکھتا ہے
        </summary>
        <div className="mt-2 space-y-1">
          <p className="text-[13px] text-[#374151]">
            It builds one double-entry book from every module, finds mistakes and keeps them red until corrected, matches the banks,
            and prepares the year's statements and tax figures for the chartered accountant.
          </p>
          <p className="text-[14px] text-[#374151] leading-8" dir="rtl" lang="ur">
            کمپنی کا حساب، جو سسٹم خود رکھتا ہے: ہر ماڈیول سے ایک ڈبل انٹری کتاب بناتا ہے، غلطیاں ڈھونڈ کر جب تک ٹھیک نہ ہوں لال رکھتا ہے، بینک ملاتا ہے، اور سال کے حسابات اور ٹیکس کے اعداد چارٹرڈ اکاؤنٹنٹ کے لیے تیار رکھتا ہے۔
          </p>
        </div>
      </details>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <Card icon={Bot} title="AI Accountant" urdu="اے آئی منشی" live={live.ai} onOpen={() => go("accounting", "ai_accountant")} when="All day — tell it what happened" whenUr="سارا دن — جو ہوا اسے بتائیں"
          en="The munshi's work done by the system: type, speak or photograph a payment, receipt or khata page and it writes the entries as drafts — you check and approve, and each can be undone. It also sorts khata rows into categories, answers questions from the books, writes the month's report and the reminders to parties, and lists today's to-do."
          ur="منشی کا کام سسٹم کرتا ہے: ادائیگی، وصولی یا کھاتے کا صفحہ لکھیں، بولیں یا تصویر بھیجیں — یہ اندراج کے مسودے بناتا ہے، آپ دیکھ کر منظور کرتے ہیں اور ہر ایک واپس بھی ہو سکتا ہے۔ کیٹیگری لگانا، حساب سے سوالوں کے جواب، ماہانہ رپورٹ، پارٹیوں کو یاد دہانی اور آج کے کام بھی۔" />
        <Card icon={ShieldCheck} title="Books Check" urdu="حساب صحت" live={live.check} onOpen={() => go("accounting", "books_check")} when="Every day, first thing" whenUr="روزانہ، سب سے پہلے"
          en="The system's own check of the accounts. Each time it opens it looks through every ledger, the cash book, banks, bills, tax and the books for mistakes — a wrong date, money on both sides of one row, cash below zero, money counted twice, a bank line not explained. Red must be corrected; amber is to look at once. A mistake stays on the list until the data is put right, and ‘Open’ goes straight to it."
          ur="یہ سسٹم کی اپنی جانچ ہے۔ ہر بار کھلنے پر یہ تمام کھاتوں، کیش بک، بینک، بل، ٹیکس اور کتاب میں غلطیاں ڈھونڈتا ہے — غلط تاریخ، ایک لائن میں دونوں طرف رقم، نقد صفر سے کم، دو بار گنی گئی رقم، بینک کی بغیر وضاحت لائن۔ لال کو ٹھیک کرنا ضروری ہے، پیلا ایک بار دیکھ لیں۔ جب تک اصل غلطی درست نہ ہو، فہرست میں رہتی ہے۔" />
        <Card icon={BookOpenCheck} title="Books" urdu="کتاب" live={live.books} onOpen={() => go("accounting", "books")} when="Whenever you want to see where money went — it keeps itself up to date" whenUr="جب دیکھنا ہو کہ پیسہ کہاں گیا — یہ خود تازہ رہتی ہے"
          en="The company's one double-entry book from 1 July 2025, made by the system from the cash book, truck and party ledgers, Partner P&L, household, zakat, invoices, bills, banks and tax — every rupee once. Trial balance for any dates, each account's entries, and which account each kind of truck-khata row goes to. Yellow ‘review’ accounts hold money the system could not place for sure."
          ur="یکم جولائی 2025 سے کمپنی کی ایک ڈبل انٹری کتاب، جو سسٹم خود کیش بک، ٹرک اور پارٹی کھاتوں، پارٹنر P&L، گھریلو خرچ، زکوٰۃ، انوائس، بل، بینک اور ٹیکس سے بناتا ہے — ہر روپیہ ایک دفعہ۔ کسی بھی تاریخ کا ٹرائل بیلنس، ہر کھاتے کی انٹریاں، اور ٹرک کھاتے کی ہر قسم کس کھاتے میں جائے۔ پیلے ’جانچ‘ کھاتوں میں وہ رقم ہے جس کی جگہ یقینی نہیں۔" />
        <Card icon={Landmark} title="Banks" urdu="بینک" live={live.banks} onOpen={() => go("accounting", "banks")} when="Every month (or week), when the statement comes" whenUr="ہر مہینے (یا ہفتے)، جب اسٹیٹمنٹ آئے"
          en="Upload each bank's statement as Excel or CSV. Every line is matched with its ledger entry by itself, or you match it, or say what it is — bank charges, a transfer between our own banks, bank profit, tax deducted. The statement's balance is checked against the books. First enter each bank's balance on 30 June 2025."
          ur="ہر بینک کی اسٹیٹمنٹ ایکسل یا CSV میں اپلوڈ کریں۔ ہر لائن خود اپنی انٹری سے مل جاتی ہے، ورنہ آپ ملائیں یا بتائیں کہ یہ کیا ہے — بینک چارجز، اپنے بینکوں میں منتقلی، بینک منافع، کٹا ہوا ٹیکس۔ اسٹیٹمنٹ کا بیلنس کتاب سے ملایا جاتا ہے۔ پہلے ہر بینک کا 30 جون 2025 کا بیلنس درج کریں۔" />
        <Card icon={FileBarChart} title="Statements" urdu="حسابات" live={live.statements} extra={live.lock} onOpen={() => go("accounting", "statements")} when="Every month, and at the year end" whenUr="ہر مہینے، اور سال کے آخر میں"
          en="The year's accounts: Profit & Loss by account, for each truck and month by month; the Balance Sheet on any date; Cash Flow; partners' accounts — each checked that it balances, ready to print for the chartered accountant. When a month is final, close the books through its last day so it no longer changes."
          ur="سال کے حسابات: نفع نقصان کھاتے وار، ہر ٹرک کا اور مہینہ وار؛ کسی بھی تاریخ کی بیلنس شیٹ؛ نقد کی آمد و رفت؛ شریکوں کے کھاتے — ہر ایک کی برابری جانچی ہوئی، چارٹرڈ اکاؤنٹنٹ کے لیے پرنٹ۔ جب مہینہ پکا ہو جائے تو اس کے آخری دن تک کتاب بند کر دیں تاکہ وہ نہ بدلے۔" />
        <Card icon={Receipt} title="Tax" urdu="ٹیکس" live={live.tax} onOpen={() => go("accounting", "tax")} when="When tax is deducted or paid; rates every July" whenUr="جب ٹیکس کٹے یا جمع ہو؛ شرحیں ہر جولائی"
          en="Withholding tax: what customers kept from our freight (with the certificate), what we kept from payments and its deposit to FBR (with the CPR), and the year's figures for the return. Rates come only from your tax consultant — the system never assumes one. Filing on FBR is done by you or the consultant."
          ur="ودہولڈنگ ٹیکس: کسٹمر نے ہمارے کرایے سے جو کاٹا (سرٹیفیکیٹ کے ساتھ)، ہم نے ادائیگیوں سے جو کاٹا اور ایف بی آر کو جمع کیا (CPR کے ساتھ)، اور ریٹرن کے لیے سال کے اعداد۔ شرحیں صرف آپ کے ٹیکس کنسلٹنٹ دیں گے — سسٹم خود کوئی شرح نہیں لگاتا۔ ایف بی آر پر جمع کرانا آپ یا کنسلٹنٹ کا کام ہے۔" />
        <Card icon={Wallet} title="Daily cash count" urdu="روز کی نقد گنتی" live={live.cash} onOpen={() => go("finance", "cash_book")} openLabel="Open Daily Cash Book" when="Every evening" whenUr="ہر شام"
          en="In Finance → Daily Cash Book: count the notes in the drawer every evening. The system compares them with what the cash book says; a shortage or excess shows red until the missing entry is added or the difference is recorded. The summary there gives each day, week, month and year."
          ur="فنانس ← ڈیلی کیش بک میں: ہر شام دراز کے نوٹ گنیں۔ سسٹم انہیں کیش بک سے ملاتا ہے؛ کمی یا زیادتی تب تک لال رہتی ہے جب تک چھوٹی ہوئی انٹری نہ ڈالی جائے یا فرق درج نہ ہو۔ وہاں خلاصے میں ہر دن، ہفتہ، مہینہ اور سال ملتا ہے۔" />
        <Card icon={ListTree} title="For the accountant" urdu="اکاؤنٹنٹ کے لیے" live={null} onOpen={() => go("accounting", "accounts")} openLabel="Chart of Accounts" when="Only when the accountant needs the detail" whenUr="صرف جب اکاؤنٹنٹ کو تفصیل چاہیے"
          en="Chart of Accounts, every Journal Entry and Journal Line, and the company's Bank Accounts (setup). Entries made by the system are rebuilt from the ledgers automatically — to correct one, correct its ledger entry, not the journal."
          ur="کھاتوں کی فہرست، ہر جرنل انٹری اور جرنل لائن، اور کمپنی کے بینک اکاؤنٹ۔ سسٹم کی بنائی ہوئی انٹریاں کھاتوں سے خود دوبارہ بنتی ہیں — درستی اصل کھاتے کی انٹری میں کریں، جرنل میں نہیں۔" />
      </div>

      <div className="rounded-xl border border-[#E3E8EF] bg-white p-4 space-y-3">
        <div className="font-semibold text-[14px] text-[#111827]">The routine · معمول</div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Routine icon={CalendarDays} title="Every day" ur="روزانہ"
            en={["Enter every cash in / out in the Daily Cash Book, linked to its truck or party — or just tell the AI Accountant and approve its drafts.", "Count the cash in the evening.", "Open Books Check and clear the red."]}
            urList={["ہر نقد آمد و خرچ ڈیلی کیش بک میں، ٹرک یا پارٹی سے جوڑ کر، درج کریں۔", "شام کو نقد گنیں۔", "حساب صحت کھولیں اور لال صاف کریں۔"]} />
          <Routine icon={CalendarRange} title="Every month" ur="ہر مہینے"
            en={["Upload every bank's statement and explain each line.", "Pay the tax we deducted to FBR and enter the CPR.", "Look at the month's Profit & Loss and each truck.", "Close the books through the month's last day."]}
            urList={["ہر بینک کی اسٹیٹمنٹ اپلوڈ کریں اور ہر لائن کی وضاحت کریں۔", "کاٹا ہوا ٹیکس ایف بی آر کو جمع کرائیں اور CPR درج کریں۔", "مہینے کا نفع نقصان اور ہر ٹرک دیکھیں۔", "مہینے کے آخری دن تک کتاب بند کریں۔"]} />
          <Routine icon={CalendarClock} title="Every year" ur="ہر سال"
            en={["In July the tax consultant checks the Rates.", "Print the statements for the chartered accountant (audit — Pvt Ltd).", "The consultant files the return on FBR (IRIS)."]}
            urList={["جولائی میں ٹیکس کنسلٹنٹ شرحیں چیک کریں۔", "چارٹرڈ اکاؤنٹنٹ کے لیے حسابات پرنٹ کریں (آڈٹ — پرائیویٹ لمیٹڈ)۔", "کنسلٹنٹ ایف بی آر (IRIS) پر ریٹرن جمع کرائیں۔"]} />
        </div>
      </div>
    </div>
  );
}

const TONE: Record<Tone, string> = {
  good: "text-[#166534] bg-[#F0FDF4] border-[#A7F3D0]",
  bad: "text-[#991B1B] bg-[#FEF2F2] border-[#FCA5A5]",
  warn: "text-[#92400E] bg-[#FFFBEB] border-[#FCD34D]",
  plain: "text-[#374151] bg-[#F9FAFB] border-[#E5E7EB]",
};

function LiveLine({ v }: { v: Live | null | undefined }) {
  if (v === undefined) return <div className="text-[11px] text-[#9CA3AF] flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> checking…</div>;
  if (v === null) return null;
  const Icon = v.tone === "good" ? CheckCircle2 : v.tone === "plain" ? null : AlertTriangle;
  return (
    <div className={`text-[12px] font-medium rounded-lg border px-2.5 py-1.5 flex items-start gap-1.5 ${TONE[v.tone]}`}>
      {Icon && <Icon className="w-3.5 h-3.5 shrink-0 mt-px" />} <span>{v.text}</span>
    </div>
  );
}

function Card({ icon: Icon, title, urdu, en, ur, when, whenUr, live, extra, onOpen, openLabel }: {
  icon: any; title: string; urdu: string; en: string; ur: string; when: string; whenUr: string; live: Live | null | undefined; extra?: Live | null; onOpen: () => void; openLabel?: string;
}) {
  const [more, setMore] = useState(false);
  return (
    <div className="rounded-xl border border-[#E3E8EF] bg-white p-4 flex flex-col gap-2.5 shadow-[0_1px_2px_rgba(16,24,40,.04)] hover:border-[#C9D7EC] transition-colors">
      <div className="flex items-start gap-2.5">
        <span className="w-9 h-9 rounded-lg bg-[#EAF0F8] text-[#24539B] flex items-center justify-center shrink-0"><Icon className="w-[18px] h-[18px]" /></span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[14px] text-[#111827] leading-tight">{title} <span className="text-[#9CA3AF] font-normal text-[13px]">· {urdu}</span></div>
          <div className="text-[11.5px] text-[#6B7280] mt-0.5">{when} · <span dir="rtl" lang="ur">{whenUr}</span></div>
        </div>
      </div>
      <LiveLine v={live} />
      {extra && <LiveLine v={extra} />}
      {more && (
        <div className="space-y-1.5 border-t border-[#EEF1F5] pt-2">
          <p className="text-[12.5px] text-[#374151] leading-relaxed">{en}</p>
          <p className="text-[13px] text-[#374151] leading-7" dir="rtl" lang="ur">{ur}</p>
        </div>
      )}
      <div className="mt-auto pt-1 flex items-center gap-3">
        <button onClick={onOpen} className="inline-flex items-center gap-1 rounded-lg bg-[#24539B] text-white text-[12.5px] font-medium px-3 py-1.5 hover:bg-[#1E4480]">
          {openLabel || `Open ${title}`} <ArrowRight className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => setMore((m) => !m)} className="text-[12px] text-[#6B7280] hover:text-[#24539B]">
          {more ? "Less" : "What it does · تفصیل"}
        </button>
      </div>
    </div>
  );
}

function Routine({ icon: Icon, title, ur, en, urList }: { icon: any; title: string; ur: string; en: string[]; urList: string[] }) {
  return (
    <div className="rounded-lg bg-[#F8FAFC] border border-[#EEF1F5] p-3 space-y-2">
      <div className="font-semibold text-xs flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" /> {title} · {ur}</div>
      <ol className="list-decimal pl-4 text-[12px] text-[#374151] space-y-0.5">{en.map((t) => <li key={t}>{t}</li>)}</ol>
      <ol className="list-decimal pr-4 text-[13px] text-[#374151] leading-7" dir="rtl" lang="ur">{urList.map((t) => <li key={t}>{t}</li>)}</ol>
    </div>
  );
}
