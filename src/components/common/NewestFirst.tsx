/**
 * Newest entries on top — one shared choice for every ledger / entry list
 * (Truck & Party ledgers, Daily Cash Book, Partner P&L, partner settlements).
 * Balances are still worked out oldest → newest on the server; only the
 * display order flips. Click the Date heading to switch; the choice is remembered.
 */
import React, { useEffect, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

const LS = "hf_newest_first";
const EVT = "hf-newest-first";

function read(): boolean {
  try {
    return localStorage.getItem(LS) !== "0";
  } catch {
    return true;
  }
}

export function useNewestFirst(): [boolean, () => void] {
  const [on, setOn] = useState(read);
  useEffect(() => {
    const sync = () => setOn(read());
    window.addEventListener(EVT, sync);
    return () => window.removeEventListener(EVT, sync);
  }, []);
  const toggle = () => {
    try {
      localStorage.setItem(LS, read() ? "0" : "1");
    } catch {}
    window.dispatchEvent(new Event(EVT));
  };
  return [on, toggle];
}

/** The list in display order (input is oldest → newest). */
export function inOrder<T>(list: T[], newestFirst: boolean): T[] {
  return newestFirst ? [...list].reverse() : list;
}

/** A clickable "Date" heading that shows and switches the order. */
export function DateHead({ newestFirst, onToggle, label = "Date" }: { newestFirst: boolean; onToggle: () => void; label?: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex items-center gap-1 hover:text-[#24539B]"
      title={newestFirst ? "Newest on top — click for oldest on top · نئی اوپر" : "Oldest on top — click for newest on top · پرانی اوپر"}
    >
      {label}
      {newestFirst ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />}
      <span className="font-normal text-[10px] opacity-70">{newestFirst ? "newest" : "oldest"}</span>
    </button>
  );
}
