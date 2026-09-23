/**
 * SheetGrid — a spreadsheet-style editable grid.
 *
 * Excel-native muscle memory:
 *   • click a cell to select, type to overwrite, F2 / double-click to edit in place
 *   • Enter / Tab / arrows move the active cell; Esc cancels an edit
 *   • Shift+arrows / Shift+click extend a rectangular selection
 *   • Ctrl/Cmd+C copies the selection as TSV (pastes straight into Excel)
 *   • Ctrl/Cmd+V pastes TSV from Excel, creating new rows as needed
 *   • a permanent ghost "＋ new row" at the bottom
 *   • edits are staged and committed together with one "Save changes" click
 *
 * It is presentational + interaction only. Data loading, pagination and the
 * actual persistence call live in the parent (see EntitySheet.tsx).
 */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Plus,
  Save,
  RotateCcw,
  Trash2,
  Paperclip,
  Maximize2,
  ArrowUp,
  ArrowDown,
  Search,
  X,
  Filter,
  Columns3,
  Keyboard,
  RefreshCw,
} from "lucide-react";

export interface SheetColumn {
  column: string;
  field: string;
  type: string;
  required?: boolean;
  readonly?: boolean;
  naturalKey?: boolean;
  enumValues?: string[] | null;
  ref?: { entity: string; by?: string } | null;
  width?: number;
}

export interface SheetOp {
  op: "create" | "update" | "delete";
  id?: number;
  data?: Record<string, any>;
}

interface Props {
  columns: SheetColumn[];
  rows: Record<string, any>[];
  idField?: string;
  loading?: boolean;
  canWrite?: boolean;
  canDelete?: boolean;
  title?: string;
  /** commit staged changes; resolve with per-op errors if any */
  onSave?: (ops: SheetOp[]) => Promise<{ errors?: { index: number; message: string }[] } | void>;
  onOpenDetail?: (row: Record<string, any>) => void;
  onAttach?: (row: Record<string, any>) => void;
  onRefresh?: () => void;
  /** server-side sort */
  sort?: { field: string; dir: "asc" | "desc" };
  onSort?: (field: string, dir: "asc" | "desc") => void;
  /** server-side per-column filter values */
  filters?: Record<string, string>;
  onFilters?: (f: Record<string, string>) => void;
  /** search box */
  search?: string;
  onSearch?: (s: string) => void;
  /** FK autocomplete: given target entity + query, return candidate natural-key strings */
  refSearch?: (entity: string, q: string) => Promise<string[]>;
  /** pagination */
  page?: { offset: number; limit: number; total: number; onPage: (offset: number) => void };
  /** extra toolbar controls (import/export) */
  toolbarExtra?: React.ReactNode;
  /** namespace for remembering hidden columns in localStorage */
  viewKey?: string;
}

type CellPos = { r: number; c: number };

const ROW_H = 30;
const GUTTER_W = 116;

function fmtValue(col: SheetColumn, v: any): string {
  if (v == null || v === "") return "";
  if (col.type === "boolean") return v === true || v === "true" ? "✓" : v === false || v === "false" ? "" : String(v);
  if (col.type === "date" || col.type === "datetime") {
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return col.type === "date" ? d.toISOString().slice(0, 10) : d.toISOString().slice(0, 16).replace("T", " ");
  }
  if ((col.type === "int" || col.type === "number" || col.type === "decimal") && typeof v !== "object") {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    // identifiers / years / codes read better without thousands separators
    if (/year|(^|_)id$|Id$|percent|rating|count|odometer|imei|phone|mobile|cnic|ntn|strn|number|code|iban|pin|no$/i.test(col.field)) {
      return String(v);
    }
    return n.toLocaleString();
  }
  if (col.type === "json" && typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** value to put in the editor input */
function editValue(col: SheetColumn, v: any): string {
  if (v == null) return "";
  if (col.type === "date" || col.type === "datetime") {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return col.type === "date" ? d.toISOString().slice(0, 10) : d.toISOString().slice(0, 16);
  }
  if (col.type === "json" && typeof v === "object") return JSON.stringify(v);
  return String(v);
}

const HIDE_LS = "hf_sheet_hidden_";

export default function SheetGrid(props: Props) {
  const {
    columns: allColumns,
    rows,
    idField = "id",
    canWrite = false,
    canDelete = false,
    loading,
    onSave,
    onOpenDetail,
    onAttach,
    onRefresh,
    sort,
    onSort,
    filters = {},
    onFilters,
    search = "",
    onSearch,
    refSearch,
    page,
    toolbarExtra,
    viewKey,
  } = props;

  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(HIDE_LS + (viewKey || "")) || "[]"));
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(HIDE_LS + (viewKey || ""), JSON.stringify([...hiddenCols]));
    } catch {
      /* ignore */
    }
  }, [hiddenCols, viewKey]);
  const columns = useMemo(
    () => allColumns.filter((c) => !hiddenCols.has(c.field)),
    [allColumns, hiddenCols],
  );
  const [showColMenu, setShowColMenu] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // staged edits: rowId -> { field -> newValue }
  const [edits, setEdits] = useState<Map<number, Record<string, any>>>(new Map());
  const [newRows, setNewRows] = useState<Record<string, any>[]>([]);
  const [deleted, setDeleted] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [active, setActive] = useState<CellPos>({ r: 0, c: 0 });
  const [selEnd, setSelEnd] = useState<CellPos | null>(null);
  const [editing, setEditing] = useState<{ pos: CellPos; value: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [showFilters, setShowFilters] = useState(false);
  const [refOptions, setRefOptions] = useState<string[]>([]);
  const [localSearch, setLocalSearch] = useState(search);

  const scrollRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);

  useEffect(() => setLocalSearch(search), [search]);

  // combined display rows: live rows (minus pending-deleted) + ghost new rows + 1 empty ghost
  const displayRows = useMemo(() => {
    const live = rows.filter((r) => !deleted.has(r[idField]));
    return [...live, ...newRows, {}];
  }, [rows, newRows, deleted, idField]);

  const liveCount = rows.filter((r) => !deleted.has(r[idField])).length;

  const dirty = edits.size > 0 || newRows.some((r) => Object.keys(r).length) || deleted.size > 0;

  const rowVirt = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });

  // ---- value access -------------------------------------------------------
  const isGhost = (r: number) => r >= liveCount;
  const newRowIndex = (r: number) => r - liveCount;

  function getCell(r: number, field: string): any {
    const row = displayRows[r];
    if (!row) return undefined;
    if (isGhost(r)) return row[field];
    const id = row[idField];
    const e = edits.get(id);
    return e && field in e ? e[field] : row[field];
  }

  function setCell(r: number, field: string, value: any) {
    if (isGhost(r)) {
      setNewRows((prev) => {
        const idx = newRowIndex(r);
        const next = [...prev];
        if (idx >= next.length) {
          // typing in the trailing empty ghost -> promote it to a real draft row
          while (next.length <= idx) next.push({});
        }
        next[idx] = { ...next[idx], [field]: value };
        return next;
      });
    } else {
      const id = displayRows[r][idField];
      setEdits((prev) => {
        const next = new Map(prev);
        const cur: Record<string, any> = Object.assign({}, next.get(id));
        if (String(value) === String(displayRows[r][field] ?? "")) delete cur[field];
        else cur[field] = value;
        if (Object.keys(cur).length) next.set(id, cur);
        else next.delete(id);
        return next;
      });
    }
  }

  // ---- selection / navigation ------------------------------------------------
  const clampC = (c: number) => Math.max(0, Math.min(columns.length - 1, c));
  const clampR = (r: number) => Math.max(0, Math.min(displayRows.length - 1, r));

  const move = useCallback(
    (dr: number, dc: number, extend = false) => {
      setEditing(null);
      setActive((a) => {
        const nr = clampR(a.r + dr);
        const nc = clampC(a.c + dc);
        rowVirt.scrollToIndex(nr, { align: "auto" });
        if (!extend) setSelEnd(null);
        return { r: nr, c: nc };
      });
      if (extend) setSelEnd((_) => ({ r: clampR(active.r + dr), c: clampC(active.c + dc) }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, displayRows.length, columns.length],
  );

  const selRect = useMemo(() => {
    const b = selEnd ?? active;
    return {
      r0: Math.min(active.r, b.r),
      r1: Math.max(active.r, b.r),
      c0: Math.min(active.c, b.c),
      c1: Math.max(active.c, b.c),
    };
  }, [active, selEnd]);

  const inSel = (r: number, c: number) =>
    r >= selRect.r0 && r <= selRect.r1 && c >= selRect.c0 && c <= selRect.c1;

  // ---- editing ------------------------------------------------------------
  const beginEdit = (pos: CellPos, seed?: string) => {
    const col = columns[pos.c];
    if (!col || col.readonly || !canWrite) return;
    const cur = seed != null ? seed : editValue(col, getCell(pos.r, col.field));
    setEditing({ pos, value: cur });
    if (col.ref && refSearch) {
      // Always fetch suggestions when opening a foreign-key cell, even with
      // no seed character (e.g. double-click into an empty one) — search("")
      // browses the first page of real rows. Without this, an empty FK cell
      // showed zero datalist options until you typed *something* that
      // happened to match, so the only way to find the natural key (e.g. an
      // Employee Code like "EMP-2026-0001") was to already know it; typing a
      // guess just got "No Employee matches ..." with nothing to browse.
      refSearch(col.ref.entity, seed ?? "").then(setRefOptions).catch(() => setRefOptions([]));
    } else {
      setRefOptions([]);
    }
  };

  const commitEdit = (moveDir: "down" | "right" | null) => {
    if (!editing) return;
    const col = columns[editing.pos.c];
    let val: any = editing.value;
    if (col.type === "boolean") val = /^(1|true|yes|✓)$/i.test(val.trim());
    setCell(editing.pos.r, col.field, val === "" ? null : val);
    setEditing(null);
    setRefOptions([]);
    if (moveDir === "down") move(1, 0);
    else if (moveDir === "right") move(0, 1);
  };

  useLayoutEffect(() => {
    if (editing && editorRef.current) {
      editorRef.current.focus();
      // Only text-like inputs (and textareas) support the selection API per
      // the HTML spec — number/date/datetime-local/email/etc. throw
      // InvalidStateError on selectionStart/selectionEnd. That threw
      // uncaught out of a layout effect, which crashed the whole app to a
      // blank white screen the instant you clicked into any numeric or date
      // cell (Year, Litres, Rate, Salary, entry dates, ...). Cursor-to-end
      // is a nicety, not essential, so skip it (and belt-and-braces
      // try/catch) for any type that doesn't support it.
      const el = editorRef.current;
      const supportsSelection =
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLInputElement && ["text", "search", "url", "tel", "password"].includes(el.type));
      if (supportsSelection) {
        try {
          el.selectionStart = el.selectionEnd = el.value.length;
        } catch {
          // ignore — see note above
        }
      }
    }
    // Deliberately keyed on the CELL (pos), not the whole `editing` object —
    // `editing` is a brand-new {pos, value} on every keystroke (onChange
    // calls setEditing again), so depending on it re-ran this effect, and
    // therefore re-called .focus(), on every single keystroke. Re-focusing
    // an element that already has focus is usually a no-op, but a native
    // <input type="date">/"datetime-local"> mid-edit is the exception:
    // Chromium resets that widget's per-segment multi-digit typing buffer
    // on refocus, so typing "2028" into the year segment refocused after
    // every digit and only the digit just pressed ever survived ("0008"
    // instead of "2028"). Only re-focus when editing actually MOVES to a
    // different cell, not on every value change within the same cell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.pos.r, editing?.pos.c]);

  // ---- clipboard --------------------------------------------------------------
  const copySelection = useCallback(() => {
    const lines: string[] = [];
    for (let r = selRect.r0; r <= selRect.r1; r++) {
      const cells: string[] = [];
      for (let c = selRect.c0; c <= selRect.c1; c++) {
        cells.push(fmtValue(columns[c], getCell(r, columns[c].field)).replace(/\t|\n/g, " "));
      }
      lines.push(cells.join("\t"));
    }
    const tsv = lines.join("\n");
    navigator.clipboard?.writeText(tsv).catch(() => {});
    // eslint-disable-next-line no-console
  }, [selRect, columns]);

  const pasteFromClipboard = useCallback(
    async () => {
      if (!canWrite) return;
      let text = "";
      try {
        text = await navigator.clipboard.readText();
      } catch {
        return;
      }
      if (!text) return;
      const grid = text.replace(/\r/g, "").split("\n").filter((l, i, a) => l.length || i < a.length - 1).map((l) => l.split("\t"));
      const startR = active.r;
      const startC = active.c;
      grid.forEach((line, ri) => {
        line.forEach((raw, ci) => {
          const c = startC + ci;
          if (c >= columns.length) return;
          const col = columns[c];
          if (col.readonly) return;
          setCell(startR + ri, col.field, raw === "" ? null : raw);
        });
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, columns, canWrite],
  );

  // ---- keyboard --------------------------------------------------------------
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) {
      if (e.key === "Escape") {
        e.preventDefault();
        setEditing(null);
        setRefOptions([]);
      } else if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement && e.shiftKey)) {
        e.preventDefault();
        commitEdit("down");
      } else if (e.key === "Tab") {
        e.preventDefault();
        commitEdit("right");
      }
      return;
    }

    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "c") {
      e.preventDefault();
      copySelection();
      return;
    }
    if (mod && e.key.toLowerCase() === "v") {
      e.preventDefault();
      pasteFromClipboard();
      return;
    }
    if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      doSave();
      return;
    }
    if (e.key === "?" || (e.shiftKey && e.key === "/")) {
      e.preventDefault();
      setShowHelp((s) => !s);
      return;
    }
    if (e.key === "Escape") {
      setShowHelp(false);
      setShowColMenu(false);
    }

    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        move(-1, 0, e.shiftKey);
        break;
      case "ArrowDown":
        e.preventDefault();
        move(1, 0, e.shiftKey);
        break;
      case "ArrowLeft":
        e.preventDefault();
        move(0, -1, e.shiftKey);
        break;
      case "ArrowRight":
      case "Tab":
        e.preventDefault();
        move(0, e.key === "Tab" && e.shiftKey ? -1 : 1, e.shiftKey && e.key !== "Tab");
        break;
      case "Enter":
        e.preventDefault();
        beginEdit(active);
        break;
      case "F2":
        e.preventDefault();
        beginEdit(active);
        break;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        if (canWrite && !columns[active.c].readonly) {
          for (let r = selRect.r0; r <= selRect.r1; r++)
            for (let c = selRect.c0; c <= selRect.c1; c++)
              if (!columns[c].readonly) setCell(r, columns[c].field, null);
        }
        break;
      default:
        if (e.key.length === 1 && !mod && canWrite && !columns[active.c].readonly) {
          e.preventDefault();
          const colType = columns[active.c].type;
          // enum/boolean cells edit via a native <select>, not a text input.
          // Seeding it with just the one keystroke (e.g. "M" of "Male") set
          // editing.value to that literal single character; a <select> has
          // no matching option for it, and — unlike a text input, where the
          // next keystroke keeps appending normally — that seed just sat
          // there until commit, saving "M" instead of "Male" (only visible
          // on the very first click+type; double-click opens with the real
          // current value already selected, so it never hit this). Open
          // these at their real current value instead, same as double-click.
          if (colType === "enum" || colType === "boolean") beginEdit(active);
          else beginEdit(active, e.key);
        }
    }
  };

  // ---- save / discard ------------------------------------------------------
  const doSave = async () => {
    if (!onSave || !dirty || saving) return;
    const ops: SheetOp[] = [];
    const opRowRef: number[] = []; // maps op index -> display row (for error surfacing)

    edits.forEach((data, id) => {
      ops.push({ op: "update", id, data });
      opRowRef.push(rows.findIndex((r) => r[idField] === id));
    });
    newRows.forEach((data, i) => {
      if (Object.keys(data).length) {
        ops.push({ op: "create", data });
        opRowRef.push(liveCount + i);
      }
    });
    deleted.forEach((id) => {
      ops.push({ op: "delete", id });
      opRowRef.push(-1);
    });

    if (!ops.length) return;
    setSaving(true);
    setRowErrors({});
    try {
      const res = (await onSave(ops)) || {};
      const errs = (res as any).errors as { index: number; message: string }[] | undefined;
      if (errs && errs.length) {
        const map: Record<number, string> = {};
        errs.forEach((er) => {
          const rr = opRowRef[er.index];
          if (rr != null && rr >= 0) map[rr] = er.message;
        });
        setRowErrors(map);
        // keep only failed edits staged
        const failedIds = new Set(errs.map((er) => ops[er.index]?.id).filter(Boolean));
        setEdits((prev) => {
          const next = new Map<number, Record<string, any>>();
          prev.forEach((v, k) => {
            if (failedIds.has(k)) next.set(k, v);
          });
          return next;
        });
        setNewRows((prev) => prev.filter((_, i) => errs.some((er) => opRowRef[er.index] === liveCount + i)));
      } else {
        setEdits(new Map());
        setNewRows([]);
        setDeleted(new Set());
        setSelected(new Set());
      }
      onRefresh?.();
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setEdits(new Map());
    setNewRows([]);
    setDeleted(new Set());
    setSelected(new Set());
    setRowErrors({});
    setEditing(null);
  };

  const toggleSelect = (id: number) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const allVisibleSelected = liveCount > 0 && rows.every((r) => deleted.has(r[idField]) || selected.has(r[idField]));
  const toggleSelectAll = () =>
    setSelected((prev) => {
      if (allVisibleSelected) return new Set();
      const n = new Set(prev);
      rows.forEach((r) => !deleted.has(r[idField]) && n.add(r[idField]));
      return n;
    });
  const deleteSelected = () => {
    if (!selected.size) return;
    if (!window.confirm(`Delete ${selected.size} selected row${selected.size === 1 ? "" : "s"}? Click "Save changes" after to confirm.`)) return;
    setDeleted((prev) => new Set([...prev, ...selected]));
    setSelected(new Set());
  };

  const addRow = () => {
    setNewRows((prev) => [...prev, {}]);
    setTimeout(() => rowVirt.scrollToIndex(displayRows.length, { align: "end" }), 0);
  };

  const removeRow = (r: number) => {
    if (isGhost(r)) {
      const idx = newRowIndex(r);
      setNewRows((prev) => prev.filter((_, i) => i !== idx));
    } else {
      const id = displayRows[r][idField];
      setDeleted((prev) => new Set(prev).add(id));
    }
  };
  const undeleteRow = (id: number) =>
    setDeleted((prev) => {
      const n = new Set(prev);
      n.delete(id);
      return n;
    });

  // ---- column widths -----------------------------------------------------
  const colWidth = (col: SheetColumn) =>
    col.width ??
    Math.min(
      280,
      Math.max(
        96,
        col.column.length * 8 + 28,
        col.type === "int" || col.type === "number" || col.type === "decimal" ? 110 : 140,
      ),
    );
  const gridTemplate = `${GUTTER_W}px ` + columns.map(colWidth).map((w) => `${w}px`).join(" ");
  const totalWidth = GUTTER_W + columns.reduce((s, c) => s + colWidth(c), 0);

  const toggleSort = (field: string) => {
    if (!onSort) return;
    const dir = sort?.field === field && sort.dir === "asc" ? "desc" : "asc";
    onSort(field, dir);
  };

  const setFilter = (field: string, val: string) => {
    onFilters?.({ ...filters, [field]: val });
  };

  // ---- render -----------------------------------------------------------
  return (
    <div className="sheet-grid relative flex flex-col h-full min-h-0 bg-white border border-[var(--sheet-line,#E5E7EB)] rounded-lg overflow-hidden">
      {/* toolbar */}
      <div className="flex items-center gap-2 px-2.5 py-2 border-b border-[var(--sheet-line,#E5E7EB)] bg-[var(--sheet-header,#F3F7F4)] flex-wrap">
        {onSearch && (
          <div className="flex items-center gap-1.5 bg-white border border-[#E5E7EB] rounded-md px-2 h-8">
            <Search className="w-3.5 h-3.5 text-[#4B5563]" />
            <input
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSearch(localSearch);
              }}
              onBlur={() => localSearch !== search && onSearch(localSearch)}
              placeholder="Search…"
              className="text-xs outline-none border-0 bg-transparent w-40 py-1"
              style={{ boxShadow: "none" }}
            />
            {localSearch && (
              <button onClick={() => { setLocalSearch(""); onSearch(""); }} title="Clear">
                <X className="w-3.5 h-3.5 text-[#4B5563]" />
              </button>
            )}
          </div>
        )}
        {onFilters && (
          <button
            onClick={() => setShowFilters((s) => !s)}
            className={`flex items-center gap-1 h-8 px-2 rounded-md text-xs border ${
              showFilters || Object.values(filters).some(Boolean)
                ? "bg-[#DCFCE7] border-[#16A34A]"
                : "bg-white border-[#E5E7EB]"
            }`}
          >
            <Filter className="w-3.5 h-3.5" /> Filter
          </button>
        )}
        {canWrite && (
          <button
            onClick={addRow}
            className="flex items-center gap-1 h-8 px-2.5 rounded-md text-xs bg-white border border-[#E5E7EB] hover:bg-[#F0FAF4]"
          >
            <Plus className="w-3.5 h-3.5" /> Row
          </button>
        )}
        <div className="relative">
          <button
            onClick={() => setShowColMenu((s) => !s)}
            className={`flex items-center gap-1 h-8 px-2 rounded-md text-xs border ${
              hiddenCols.size ? "bg-[#DCFCE7] border-[#16A34A]" : "bg-white border-[#E5E7EB]"
            }`}
            title="Show / hide columns"
          >
            <Columns3 className="w-3.5 h-3.5" /> Columns{hiddenCols.size ? ` (${allColumns.length - hiddenCols.size}/${allColumns.length})` : ""}
          </button>
          {showColMenu && (
            <div className="absolute z-40 mt-1 left-0 w-56 max-h-72 overflow-y-auto bg-white border border-[#E5E7EB] rounded-md shadow-lg p-1 text-xs">
              <div className="flex justify-between px-2 py-1 text-[10px] text-[#6B7280]">
                <button onClick={() => setHiddenCols(new Set())} className="hover:text-[#16A34A]">show all</button>
                <button
                  onClick={() => setHiddenCols(new Set(allColumns.filter((c) => c.readonly).map((c) => c.field)))}
                  className="hover:text-[#16A34A]"
                >
                  hide read-only
                </button>
              </div>
              {allColumns.map((c) => (
                <label key={c.field} className="flex items-center gap-2 px-2 py-1 hover:bg-[#F0FAF4] rounded cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!hiddenCols.has(c.field)}
                    onChange={(ev) =>
                      setHiddenCols((prev) => {
                        const n = new Set(prev);
                        ev.target.checked ? n.delete(c.field) : n.add(c.field);
                        return n;
                      })
                    }
                  />
                  <span className="truncate">{c.column}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="flex items-center gap-1 h-8 px-2 rounded-md text-xs bg-white border border-[#E5E7EB] hover:bg-[#F0FAF4]"
            title="Refresh · تازہ کریں"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        )}
        <button
          onClick={() => setShowHelp(true)}
          className="flex items-center justify-center h-8 w-8 rounded-md text-xs bg-white border border-[#E5E7EB] hover:bg-[#F0FAF4]"
          title="Keyboard shortcuts (?)"
        >
          <Keyboard className="w-3.5 h-3.5" />
        </button>
        <div className="flex-1" />
        {toolbarExtra}
        <span className="text-[11px] text-[#4B5563] tabular-nums">
          {page ? `${page.total.toLocaleString()} rows` : `${liveCount.toLocaleString()} rows`}
          {loading ? " · loading…" : ""}
        </span>
        {canDelete && selected.size > 0 && (
          <button
            onClick={deleteSelected}
            className="flex items-center gap-1 h-8 px-2.5 rounded-md text-xs font-semibold bg-white border border-[#DC2626] text-[#DC2626] hover:bg-[#FEF2F2]"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete {selected.size} selected
          </button>
        )}
        {dirty && (
          <>
            <button
              onClick={discard}
              className="flex items-center gap-1 h-8 px-2.5 rounded-md text-xs bg-white border border-[#E5E7EB] hover:bg-[#F0FAF4]"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Discard
            </button>
            <button
              onClick={doSave}
              disabled={saving}
              className="flex items-center gap-1 h-8 px-3 rounded-md text-xs font-semibold bg-[#16A34A] border border-[#16A34A] disabled:opacity-60"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? "Saving…" : `Save ${edits.size + newRows.filter((r) => Object.keys(r).length).length + deleted.size} change${edits.size + newRows.length + deleted.size === 1 ? "" : "s"}`}
            </button>
          </>
        )}
      </div>

      {/* filter row */}
      {showFilters && onFilters && (
        <div className="flex border-b border-[var(--sheet-line,#E5E7EB)] bg-white overflow-x-auto">
          <div style={{ width: GUTTER_W }} className="shrink-0 border-r border-[#E5E7EB]" />
          {columns.map((col) => (
            <div key={col.field} style={{ width: colWidth(col) }} className="shrink-0 p-1 border-r border-[#F0F0F0]">
              <input
                value={filters[col.field] || ""}
                onChange={(e) => setFilter(col.field, e.target.value)}
                placeholder="filter"
                className="w-full text-[11px] px-1.5 py-1 border border-[#E5E7EB] rounded"
              />
            </div>
          ))}
        </div>
      )}

      {/* grid */}
      <div
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="flex-1 min-h-0 overflow-auto outline-none relative select-none"
      >
        <div style={{ width: totalWidth, position: "relative" }}>
          {/* header */}
          <div
            className="sticky top-0 z-20 grid bg-[var(--sheet-header,#F3F7F4)] border-b border-[var(--sheet-line,#E5E7EB)] shadow-[0_1px_0_rgba(0,0,0,0.04)]"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            <div className="px-2 py-1.5 text-[10px] font-semibold text-[#4B5563] border-r border-[#E5E7EB] flex items-center gap-1">
              {canDelete && liveCount > 0 && (
                <input
                  type="checkbox"
                  title="Select all rows"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAll}
                  className="cursor-pointer"
                />
              )}
              #
            </div>
            {columns.map((col) => (
              <button
                key={col.field}
                onClick={() => toggleSort(col.field)}
                className="px-2 py-1.5 text-left text-[11px] font-semibold border-r border-[#E5E7EB] flex items-center gap-1 hover:bg-[#E8F3EC] truncate"
                title={`${col.column}  (${col.type}${col.ref ? ` → ${col.ref.entity}` : ""}${col.naturalKey ? ", key" : ""})`}
              >
                <span className="truncate">{col.column}</span>
                {col.required && <span className="text-[#DC2626]">*</span>}
                {sort?.field === col.field &&
                  (sort.dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
              </button>
            ))}
          </div>

          {/* body */}
          <div style={{ height: rowVirt.getTotalSize(), position: "relative" }}>
            {rowVirt.getVirtualItems().map((vr) => {
              const r = vr.index;
              const row = displayRows[r];
              const ghost = isGhost(r);
              const trailingGhost = ghost && newRowIndex(r) >= newRows.length;
              const id = ghost ? undefined : row[idField];
              const isDeletedRow = id != null && deleted.has(id);
              const hasEdit = id != null && edits.has(id);
              const draftFilled = ghost && !trailingGhost && Object.keys(newRows[newRowIndex(r)] || {}).length > 0;
              return (
                <div
                  key={vr.key}
                  className="grid absolute left-0 right-0"
                  style={{
                    gridTemplateColumns: gridTemplate,
                    transform: `translateY(${vr.start}px)`,
                    height: ROW_H,
                  }}
                >
                  {/* gutter */}
                  <div
                    className={`flex items-center gap-1 px-1.5 border-r border-b border-[#E5E7EB] text-[10px] text-[#4B5563] ${
                      draftFilled ? "bg-[#ECFDF3]" : hasEdit ? "bg-[#FEFCE8]" : trailingGhost ? "bg-[#FAFAFA]" : "bg-white"
                    }`}
                  >
                    {canDelete && !ghost && !isDeletedRow && (
                      <input
                        type="checkbox"
                        checked={selected.has(id!)}
                        onChange={() => toggleSelect(id!)}
                        className="cursor-pointer shrink-0"
                      />
                    )}
                    <span className="w-6 tabular-nums truncate">{ghost ? (trailingGhost ? "＋" : "new") : r + 1}</span>
                    {!trailingGhost && (
                      <>
                        {onAttach && !ghost && (
                          <button title="Attachments" onClick={() => onAttach(row)} className="opacity-50 hover:opacity-100">
                            <Paperclip className="w-3 h-3" />
                          </button>
                        )}
                        {onOpenDetail && !ghost && (
                          <button title="Open detail" onClick={() => onOpenDetail(row)} className="opacity-50 hover:opacity-100">
                            <Maximize2 className="w-3 h-3" />
                          </button>
                        )}
                        {isDeletedRow ? (
                          <button title="Undo delete" onClick={() => undeleteRow(id!)} className="text-[#16A34A]">
                            <RotateCcw className="w-3 h-3" />
                          </button>
                        ) : (
                          (canDelete || ghost) && (
                            <button
                              title={ghost ? "Remove draft" : "Delete row"}
                              onClick={() => removeRow(r)}
                              className="opacity-50 hover:opacity-100 hover:text-[#DC2626]"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )
                        )}
                      </>
                    )}
                  </div>

                  {/* cells */}
                  {columns.map((col, c) => {
                    const isActive = active.r === r && active.c === c;
                    const editingThis = editing && editing.pos.r === r && editing.pos.c === c;
                    const selected = inSel(r, c);
                    const raw = getCell(r, col.field);
                    const cellEdited =
                      (!ghost && edits.get(id!)?.[col.field] !== undefined) ||
                      (ghost && !trailingGhost && (newRows[newRowIndex(r)] || {})[col.field] !== undefined);
                    return (
                      <div
                        key={col.field}
                        dir={col.type === "string" || col.type === "text" ? "auto" : undefined}
                        onMouseDown={(e) => {
                          if (e.shiftKey) {
                            setSelEnd({ r, c });
                          } else {
                            setActive({ r, c });
                            setSelEnd(null);
                          }
                          scrollRef.current?.focus();
                        }}
                        onDoubleClick={() => beginEdit({ r, c })}
                        className={`relative px-2 text-[12px] border-r border-b border-[#EEE] flex items-center overflow-hidden whitespace-nowrap ${
                          col.type === "int" || col.type === "number" || col.type === "decimal"
                            ? "justify-end font-mono tabular-nums"
                            : ""
                        } ${
                          isDeletedRow
                            ? "bg-[#FEECEC] line-through text-[#9CA3AF]"
                            : cellEdited
                            ? "bg-[#FEFCE8]"
                            : draftFilled
                            ? "bg-[#F0FDF4]"
                            : "bg-white"
                        } ${selected && !editingThis ? "outline outline-1 outline-[#86EFAC] -outline-offset-1" : ""} ${
                          isActive ? "outline outline-2 outline-[#16A34A] -outline-offset-1 z-10" : ""
                        } ${col.readonly ? "text-[#6B7280]" : "cursor-cell"}`}
                        title={col.readonly ? "read-only" : undefined}
                      >
                        {editingThis ? (
                          <CellEditor
                            ref={editorRef as any}
                            col={col}
                            value={editing!.value}
                            options={refOptions}
                            onChange={(v) => {
                              setEditing({ pos: editing!.pos, value: v });
                              if (col.ref && refSearch) refSearch(col.ref.entity, v).then(setRefOptions).catch(() => {});
                            }}
                            onCommit={() => commitEdit(null)}
                          />
                        ) : (
                          fmtValue(col, raw)
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {!loading && displayRows.length <= 1 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-[#6B7280] pointer-events-none">
            No rows. {canWrite ? "Type in the ＋ row to add one." : ""}
          </div>
        )}
      </div>

      {/* row error strip */}
      {Object.keys(rowErrors).length > 0 && (
        <div className="border-t border-[#FCA5A5] bg-[#FEF2F2] px-3 py-1.5 text-[11px] text-[#B91C1C] max-h-24 overflow-auto">
          {Object.entries(rowErrors).map(([r, m]) => (
            <div key={r}>Row {Number(r) + 1}: {m}</div>
          ))}
        </div>
      )}

      {/* pagination */}
      {page && page.total > page.limit && (
        <div className="flex items-center justify-end gap-2 px-3 py-1.5 border-t border-[var(--sheet-line,#E5E7EB)] text-[11px] bg-[var(--sheet-header,#F3F7F4)]">
          <span className="text-[#4B5563] tabular-nums">
            {page.offset + 1}–{Math.min(page.offset + page.limit, page.total)} of {page.total.toLocaleString()}
          </span>
          <button
            disabled={page.offset === 0}
            onClick={() => page.onPage(Math.max(0, page.offset - page.limit))}
            className="px-2 py-1 rounded border border-[#E5E7EB] bg-white disabled:opacity-40"
          >
            Prev
          </button>
          <button
            disabled={page.offset + page.limit >= page.total}
            onClick={() => page.onPage(page.offset + page.limit)}
            className="px-2 py-1 rounded border border-[#E5E7EB] bg-white disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      {/* keyboard help */}
      {showHelp && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 p-4" onClick={() => setShowHelp(false)}>
          <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-xl p-4 w-80 text-xs" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-bold">Spreadsheet shortcuts</h4>
              <button onClick={() => setShowHelp(false)}><X className="w-4 h-4" /></button>
            </div>
            {[
              ["Click / arrows", "select a cell"],
              ["Type / F2 / dbl-click", "edit the cell"],
              ["Enter", "commit + move down"],
              ["Tab / Shift+Tab", "commit + move right / left"],
              ["Esc", "cancel edit"],
              ["Shift + arrows / click", "extend selection"],
              ["Ctrl/⌘ + C", "copy selection (TSV → Excel)"],
              ["Ctrl/⌘ + V", "paste TSV (new rows auto-added)"],
              ["Delete / Backspace", "clear selected cells"],
              ["Ctrl/⌘ + S", "save all staged changes"],
              ["＋ row (bottom)", "add a new record"],
              ["?", "toggle this help"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 py-0.5 border-b border-[#F3F4F6]">
                <span className="font-mono text-[#16A34A]">{k}</span>
                <span className="text-right text-[#4B5563]">{v}</span>
              </div>
            ))}
            <p className="mt-2 text-[10px] text-[#9CA3AF]">Typing works in English, اردو and پښتو — cells auto-detect direction.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// per-type cell editor
// ---------------------------------------------------------------------------
const CellEditor = React.forwardRef<
  HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  {
    col: SheetColumn;
    value: string;
    options: string[];
    onChange: (v: string) => void;
    onCommit: () => void;
  }
>(({ col, value, options, onChange, onCommit }, ref) => {
  const base =
    "absolute inset-0 w-full h-full px-2 text-[12px] border-0 bg-white outline outline-2 outline-[#16A34A] -outline-offset-1";

  if (col.type === "boolean") {
    return (
      <select
        ref={ref as any}
        value={/^(1|true|yes|✓)$/i.test(value) ? "true" : "false"}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        className={base}
      >
        <option value="true">✓ true</option>
        <option value="false">false</option>
      </select>
    );
  }

  if (col.type === "enum" && col.enumValues?.length) {
    return (
      <select ref={ref as any} value={value} onChange={(e) => onChange(e.target.value)} onBlur={onCommit} className={base}>
        <option value=""></option>
        {col.enumValues.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    );
  }

  if (col.type === "text" || col.type === "json") {
    return (
      <textarea
        ref={ref as any}
        dir={col.type === "text" ? "auto" : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        className={`${base} py-1 resize-none z-30 h-24`}
      />
    );
  }

  // A foreign-key column (Employee ID, Vehicle ID, ...) is always matched by
  // typing the OTHER entity's natural-key string (e.g. "EMP-2026-0001"), never
  // the raw internal numeric id — but the underlying DB column is genuinely
  // an int (`col.type === "int"`), and this used to pick the input type from
  // col.type alone. That rendered a real `<input type="number">`, which
  // (per the HTML spec) only accepts digits/+/-/./e — so typing "EMP-0001"
  // silently dropped every letter as you typed it ("EMP-0001" -> "E-0001"),
  // and its native datalist suggestions don't even show on a number input.
  // A ref field must always get the plain text editor, regardless of type.
  const inputType =
    col.ref ? "text" : col.type === "date" ? "date" : col.type === "datetime" ? "datetime-local" : col.type === "int" || col.type === "number" || col.type === "decimal" ? "number" : "text";

  // date / datetime-local inputs must NOT be value-controlled while editing.
  // Per the HTML spec, a native date input's `.value` reads back as the empty
  // string for as long as any segment (year/month/day) is incomplete — e.g.
  // right after typing the month and day but before all 4 year digits are
  // in. A controlled `value={...}` re-asserts that "" on every keystroke's
  // re-render, which the browser treats as authoritative and wipes every
  // segment back to placeholder — so typing a year reset the whole field
  // after ~2 digits, and a keyboard-only user could never finish a date.
  // Using defaultValue (uncontrolled) lets the browser own the segments
  // while you type; onChange still fires normally so `editing.value` — read
  // once at commit (blur/Enter) — ends up with the final, complete value.
  const isDateLike = inputType === "date" || inputType === "datetime-local";

  return (
    <>
      <input
        ref={ref as any}
        type={inputType}
        dir={inputType === "text" ? "auto" : undefined}
        {...(isDateLike ? { defaultValue: value } : { value })}
        list={col.ref ? `ref-${col.field}` : undefined}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        className={base}
      />
      {col.ref && (
        <datalist id={`ref-${col.field}`}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
    </>
  );
});
CellEditor.displayName = "CellEditor";
