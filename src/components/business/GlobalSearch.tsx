/**
 * One search for the whole app · ہر جگہ تلاش — Ctrl+K (or /) anywhere. Type a truck number,
 * party, invoice, trip, driver, bill or an amount; ↑ ↓ to choose, Enter to open it.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, Loader2, CornerDownLeft } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";

export interface SearchHit {
  group: string;
  title: string;
  sub?: string;
  wb: string;
  sheet: string;
  focus?: any;
}

export default function GlobalSearch({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (h: SearchHit) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const s = q.trim();
    if (s.length < 2) {
      setHits([]);
      return;
    }
    setBusy(true);
    const t = setTimeout(() => {
      enterpriseFetch(`/api/search?q=${encodeURIComponent(s)}`)
        .then((r) => {
          setHits(r.results || []);
          setSel(0);
        })
        .catch(() => setHits([]))
        .finally(() => setBusy(false));
    }, 220);
    return () => clearTimeout(t);
  }, [q, open]);

  const groups = useMemo(() => {
    const m = new Map<string, Array<SearchHit & { i: number }>>();
    hits.forEach((h, i) => m.set(h.group, [...(m.get(h.group) || []), { ...h, i }]));
    return [...m.entries()];
  }, [hits]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;
  const pick = (h: SearchHit) => {
    onPick(h);
    onClose();
    setQ("");
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[10vh] px-4" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-[rgba(15,23,42,.35)]" />
      <div className="relative w-full max-w-xl bg-white rounded-xl shadow-2xl border border-[#E3E8EF] overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 border-b border-[#EEF1F5]">
          {busy ? <Loader2 className="w-5 h-5 text-[#9CA3AF] animate-spin" /> : <Search className="w-5 h-5 text-[#9CA3AF]" />}
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(hits.length - 1, s + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              } else if (e.key === "Enter" && hits[sel]) pick(hits[sel]);
            }}
            placeholder="Search trucks, parties, invoices, trips, amounts… · تلاش کریں"
            className="flex-1 border-0 outline-none py-3.5 text-[15px] bg-transparent"
            style={{ boxShadow: "none" }}
            dir="auto"
          />
          <kbd className="text-[10px] text-[#9CA3AF] border border-[#E3E8EF] rounded px-1.5 py-0.5 bg-white">Esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto">
          {q.trim().length < 2 ? (
            <div className="px-4 py-6 text-[13px] text-[#6B7280]">
              Type at least 2 letters. Try a truck number (<b>TLG 704</b>), a party, an invoice number, a driver or an amount (<b>185609</b>).
            </div>
          ) : !busy && hits.length === 0 ? (
            <div className="px-4 py-6 text-[13px] text-[#6B7280]">Nothing found for “{q}” · کچھ نہیں ملا</div>
          ) : (
            groups.map(([g, list]) => (
              <div key={g} className="py-1">
                <div className="px-4 pt-2 pb-1 text-[11px] font-semibold text-[#9CA3AF]">{g}</div>
                {list.map((h) => (
                  <button
                    key={h.i}
                    data-i={h.i}
                    onMouseEnter={() => setSel(h.i)}
                    onClick={() => pick(h)}
                    className={`w-full text-left px-4 py-2 flex items-center gap-3 ${sel === h.i ? "bg-[#EAF0F8]" : ""}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-medium text-[#111827] truncate" dir="auto">{h.title}</div>
                      {h.sub && <div className="text-[11.5px] text-[#6B7280] truncate" dir="auto">{h.sub}</div>}
                    </div>
                    {sel === h.i && <CornerDownLeft className="w-4 h-4 text-[#24539B] shrink-0" />}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
