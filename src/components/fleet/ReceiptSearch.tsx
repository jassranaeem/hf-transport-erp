/**
 * "3-6-12 mahine baad koi purani receipt mil jaye" — search by reference
 * number, description text, or amount (and an optional date range) across
 * EVERY khata (party + truck) and Finance expense, plus the filename of any
 * receipt scan already uploaded, so one search answers "yeh kis ke khate
 * mein jama hui thi?" — or, if nothing comes back, confirms the entry was
 * never made at all (the other half of the same real problem: a party gave
 * the money and the log entry got forgotten, or it landed under the wrong
 * account by mistake).
 */
import React, { useState } from "react";
import { Search, Loader2, ExternalLink, Paperclip, AlertTriangle, Receipt } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";

const fmt = (n: number) => "PKR " + Math.abs(Math.round(n || 0)).toLocaleString();

const SOURCE_LABEL: Record<string, string> = { party: "Party Khata", truck: "Truck Khata", expense: "Finance Expense" };
const SOURCE_COLOR: Record<string, string> = {
  party: "bg-blue-50 text-blue-700 border-blue-200",
  truck: "bg-emerald-50 text-emerald-700 border-emerald-200",
  expense: "bg-amber-50 text-amber-700 border-amber-200",
};

interface Hit {
  source: "party" | "truck" | "expense";
  id: number;
  label: string;
  entryDate: string | null;
  amount: number;
  direction: "In" | "Out" | null;
  description: string | null;
  refNo: string | null;
  matchedVia: string;
  focus: { partyId?: number; ledgerId?: number };
  attachments: Array<{ id: number; fileName: string }>;
}

export default function ReceiptSearch({
  showFeedback,
  onOpen,
}: {
  showFeedback: (type: "success" | "error", message: string) => void;
  onOpen?: (focus: { partyId?: number; ledgerId?: number }) => void;
}) {
  const [q, setQ] = useState("");
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<Hit[] | null>(null);

  const doSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!q.trim() && !amount.trim()) {
      showFeedback("error", "Receipt number, koi text, ya amount likhein search karne ke liye.");
      return;
    }
    setSearching(true);
    try {
      const p = new URLSearchParams();
      if (q.trim()) p.set("q", q.trim());
      if (amount.trim()) p.set("amount", amount.trim());
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      const r = await enterpriseFetch(`/api/operations/receipt-search?${p}`);
      setResults(r.results || []);
    } catch (err: any) {
      showFeedback("error", err.message);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white p-4 border border-slate-200 rounded-xl space-y-3">
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <Receipt className="w-4 h-4 text-emerald-600" /> Receipt Search — purani receipt kahan gayi thi?
        </h2>
        <p className="text-[12px] text-slate-500">
          Receipt number, bank reference, ya description ka koi lafz likhein — aur/ya amount daalein. System har party
          khata, truck khata aur Finance expense mein dhoondega, aur agar koi scanned receipt already lagi hai uska naam
          bhi check karega. Kuch na mile tou iska matlab yeh entry kabhi ki hi nahi gayi.
        </p>
        <form onSubmit={doSearch} className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <input
              type="text"
              autoFocus
              placeholder="Receipt number / reference / description…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-4 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              type="number"
              placeholder="Amount (optional)"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="flex-1 min-w-[140px] bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-800 placeholder-slate-400 focus:border-emerald-500 focus:outline-none"
            />
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              title="From date (optional)"
              className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-800 focus:border-emerald-500 focus:outline-none"
            />
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              title="To date (optional)"
              className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-800 focus:border-emerald-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={searching}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg px-4 py-1.5 flex items-center gap-2 disabled:opacity-60"
            >
              {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Search
            </button>
          </div>
        </form>
      </div>

      {results && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 text-xs font-bold text-slate-500 uppercase tracking-wide">
            {results.length} result{results.length === 1 ? "" : "s"}
          </div>

          {results.length === 0 ? (
            <div className="p-6 text-center">
              <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700">Yeh receipt kahin bhi nahi mili.</p>
              <p className="text-[12px] text-slate-500 mt-1">
                Records mein is number/amount ki koi entry darj nahi hai — matlab yeh entry karna reh gaya hai. Party
                khata ya Truck khata mein jaa kar isko naya entry ki tarah daal dein.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {results.map((h) => (
                <div key={`${h.source}:${h.id}`} className="px-4 py-3 hover:bg-slate-50">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-bold rounded-full border px-2 py-0.5 ${SOURCE_COLOR[h.source]}`}>{SOURCE_LABEL[h.source]}</span>
                        <span className="text-sm font-semibold text-slate-800">{h.label}</span>
                        {h.refNo && <span className="text-[11px] text-slate-400 font-mono">Ref: {h.refNo}</span>}
                      </div>
                      <p className="text-[12px] text-slate-600 mt-0.5">{h.description || "—"}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">matched via {h.matchedVia}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`text-sm font-bold ${h.direction === "In" ? "text-emerald-700" : "text-red-600"}`}>{fmt(h.amount)}</div>
                      <div className="text-[11px] text-slate-400">{h.entryDate || "—"}</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-1.5">
                      {h.attachments.length > 0 ? (
                        <span className="text-[11px] text-slate-500 flex items-center gap-1">
                          <Paperclip className="w-3 h-3" /> {h.attachments.length} receipt file{h.attachments.length === 1 ? "" : "s"}: {h.attachments.map((a) => a.fileName).join(", ")}
                        </span>
                      ) : (
                        <span className="text-[11px] text-amber-600 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> Koi scanned receipt attach nahi hai
                        </span>
                      )}
                    </div>
                    {onOpen && (h.focus.partyId || h.focus.ledgerId) && (
                      <button onClick={() => onOpen(h.focus)} className="text-[12px] font-semibold text-emerald-700 hover:text-emerald-800 flex items-center gap-1">
                        Open <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
