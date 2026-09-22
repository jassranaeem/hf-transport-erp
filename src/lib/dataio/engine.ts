/**
 * Generic Import / Export engine.
 *
 * Domain-agnostic: everything it needs comes from an EntitySpec (registry.ts).
 * Supports .xlsx and .csv, foreign-key resolution by natural key, per-row
 * validation with precise error locations, a dry-run preview, and insert or
 * upsert commit.
 */
import ExcelJS from "exceljs";
import { repairXlsxBuffer } from "./xlsx-repair.ts";
import { randomUUID } from "crypto";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { getEntity } from "./registry.ts";
import type {
  EntitySpec,
  FieldSpec,
  RowError,
  ValidateResult,
  CommitResult,
} from "./types.ts";

const AUDIT_EXPORT_COLS = ["id", "createdAt", "updatedAt"] as const;
const PREVIEW_LIMIT = 20;
const MAX_DATA_ROWS = 20000;

// -------------------------------------------------------------------------
// cell / value helpers
// -------------------------------------------------------------------------

function cellToPrimitive(value: ExcelJS.CellValue): string | number | boolean | Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    // rich text
    if ("richText" in value && Array.isArray((value as any).richText)) {
      return (value as any).richText.map((r: any) => r.text).join("");
    }
    // formula result
    if ("result" in value) return (value as any).result ?? null;
    // hyperlink
    if ("text" in value) return (value as any).text ?? null;
    if ("hyperlink" in value) return (value as any).hyperlink ?? null;
    return null;
  }
  return value as string | number | boolean;
}

function normKey(parts: (string | number | null | undefined)[]): string {
  return parts.map((p) => String(p ?? "").trim().toLowerCase()).join(" | ");
}

const TRUE_SET = new Set(["true", "1", "yes", "y", "haan", "ha"]);
const FALSE_SET = new Set(["false", "0", "no", "n", "nahi", "na", ""]);

function parseDateValue(raw: string | number | boolean | Date | null): Date | null | undefined {
  if (raw === null || raw === "") return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? undefined : raw;
  if (typeof raw === "number") {
    // Excel serial date (days since 1899-12-30)
    const ms = Math.round((raw - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return isNaN(d.getTime()) ? undefined : d;
  }
  const s = String(raw).trim();
  // dd/mm/yyyy or dd-mm-yyyy
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (dmy) {
    const [, dd, mm, yyyy, hh = "0", min = "0"] = dmy;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min));
    return isNaN(d.getTime()) ? undefined : d;
  }
  const d = new Date(s); // ISO and other native-parseable forms
  return isNaN(d.getTime()) ? undefined : d;
}

/**
 * Coerce one raw cell to the DB-ready value for a field.
 * Returns { value } on success or { error } with a human message.
 */
function coerceValue(
  field: FieldSpec,
  raw: string | number | boolean | Date | null
): { value?: unknown; error?: string } {
  const isBlank =
    raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "");

  if (isBlank) {
    if (field.default !== undefined) return { value: field.default };
    if (field.required) return { error: `"${field.column}" is required` };
    return { value: null };
  }

  switch (field.type) {
    case "string":
    case "text":
      return { value: String(raw).trim() };

    case "int": {
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[, ]/g, ""));
      if (!Number.isFinite(n)) return { error: `"${field.column}" must be a number` };
      return { value: Math.round(n) };
    }
    case "number": {
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[, ]/g, ""));
      if (!Number.isFinite(n)) return { error: `"${field.column}" must be a number` };
      return { value: n };
    }
    case "decimal": {
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[, ]/g, ""));
      if (!Number.isFinite(n)) return { error: `"${field.column}" must be a decimal number` };
      return { value: String(n) }; // pg numeric wants a string
    }

    case "boolean": {
      const s = String(raw).trim().toLowerCase();
      if (TRUE_SET.has(s)) return { value: true };
      if (FALSE_SET.has(s)) return { value: false };
      return { error: `"${field.column}" must be yes/no` };
    }

    case "date":
    case "datetime": {
      const d = parseDateValue(raw);
      if (d === undefined) return { error: `"${field.column}" is not a valid date` };
      return { value: d };
    }

    case "json": {
      if (typeof raw === "object") return { value: raw };
      try {
        return { value: JSON.parse(String(raw)) };
      } catch {
        return { error: `"${field.column}" must be valid JSON` };
      }
    }

    case "enum": {
      const s = String(raw).trim();
      const match = field.enumValues?.find((v) => v.toLowerCase() === s.toLowerCase());
      if (!match) {
        return { error: `"${field.column}" must be one of: ${field.enumValues?.join(", ")}` };
      }
      return { value: match };
    }

    default:
      return { value: raw };
  }
}

// -------------------------------------------------------------------------
// foreign-key resolution
// -------------------------------------------------------------------------

interface RefMap {
  byKey: Map<string, number>; // normalised natural key -> id
  idToKey: Map<number, string>; // id -> display key
  keyColumns: string[];
}

async function loadRefMap(targetKey: string): Promise<RefMap> {
  const target = getEntity(targetKey);
  if (!target) throw new Error(`Unknown ref target entity "${targetKey}"`);

  const keyFields = target.fields.filter((f) => f.naturalKey);
  if (keyFields.length === 0) {
    throw new Error(`Ref target "${targetKey}" has no naturalKey field`);
  }

  const table: any = target.table;
  const selectCols: Record<string, any> = { id: table.id };
  for (const kf of keyFields) selectCols[kf.field] = table[kf.field];

  let rows: any[];
  if (target.softDelete && table.isDeleted) {
    rows = await db.select(selectCols).from(table).where(eq(table.isDeleted, false));
  } else {
    rows = await db.select(selectCols).from(table);
  }

  const byKey = new Map<string, number>();
  const idToKey = new Map<number, string>();
  for (const r of rows) {
    const parts = keyFields.map((kf) => r[kf.field]);
    const nk = normKey(parts);
    byKey.set(nk, r.id);
    idToKey.set(r.id, parts.map((p) => String(p ?? "")).join(" | "));
  }
  return { byKey, idToKey, keyColumns: keyFields.map((k) => k.column) };
}

// -------------------------------------------------------------------------
// template
// -------------------------------------------------------------------------

export function buildTemplateWorkbook(entity: EntitySpec): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HF Transport ERP";
  wb.created = new Date();

  const importable = entity.fields.filter((f) => !f.readonly);

  const data = wb.addWorksheet("Data");
  data.columns = importable.map((f) => ({
    header: f.column,
    key: f.field,
    width: Math.max(14, Math.min(40, f.column.length + 6)),
  }));
  const headerRow = data.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } };
  headerRow.alignment = { vertical: "middle" };
  data.views = [{ state: "frozen", ySplit: 1 }];

  // enum dropdowns for the first 1000 rows
  importable.forEach((f, idx) => {
    if (f.type === "enum" && f.enumValues?.length) {
      const colLetter = data.getColumn(idx + 1).letter;
      for (let r = 2; r <= 1000; r++) {
        data.getCell(`${colLetter}${r}`).dataValidation = {
          type: "list",
          allowBlank: !f.required,
          formulae: [`"${f.enumValues.join(",")}"`],
        };
      }
    }
  });

  // Instructions sheet
  const info = wb.addWorksheet("Instructions");
  info.columns = [
    { header: "Column", key: "c", width: 30 },
    { header: "Required", key: "r", width: 10 },
    { header: "Type", key: "t", width: 12 },
    { header: "Allowed values / Notes", key: "n", width: 70 },
    { header: "Example", key: "e", width: 22 },
  ];
  info.getRow(1).font = { bold: true };
  for (const f of importable) {
    const notes: string[] = [];
    if (f.enumValues?.length) notes.push(`One of: ${f.enumValues.join(", ")}`);
    if (f.ref) {
      const t = getEntity(f.ref.entity);
      notes.push(
        `Must match an existing ${t?.label ?? f.ref.entity} (by its natural key). Composite keys: write "A | B".`
      );
    }
    if (f.naturalKey) notes.push("Part of the unique key used to match rows for update.");
    if (f.note) notes.push(f.note);
    info.addRow({
      c: f.column,
      r: f.required ? "YES" : "",
      t: f.ref ? "lookup" : f.type,
      n: notes.join("  •  "),
      e: f.example ?? "",
    });
  }
  info.addRow({});
  info.addRow({ c: "Tip", n: "Delete this Instructions sheet before uploading, or leave it - the importer only reads the 'Data' sheet." });

  return wb;
}

// -------------------------------------------------------------------------
// export
// -------------------------------------------------------------------------

export async function buildExportWorkbook(
  entity: EntitySpec,
  rows: Record<string, any>[]
): Promise<ExcelJS.Workbook> {
  // reverse maps for ref columns
  const refMaps = new Map<string, RefMap>();
  for (const f of entity.fields) {
    if (f.ref && !refMaps.has(f.ref.entity)) {
      refMaps.set(f.ref.entity, await loadRefMap(f.ref.entity));
    }
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "HF Transport ERP";
  wb.created = new Date();
  const ws = wb.addWorksheet(entity.label.slice(0, 28) || "Export");

  const cols = [
    { header: "id", key: "id", width: 8 },
    ...entity.fields
      .filter((f) => !f.readonly)
      .map((f) => ({ header: f.column, key: f.field, width: Math.max(14, f.column.length + 4) })),
    { header: "createdAt", key: "createdAt", width: 20 },
    { header: "updatedAt", key: "updatedAt", width: 20 },
  ];
  ws.columns = cols;
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  for (const row of rows) {
    const out: Record<string, unknown> = { id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt };
    for (const f of entity.fields) {
      if (f.readonly) continue;
      let v = row[f.field];
      if (f.ref && v != null) {
        v = refMaps.get(f.ref.entity)?.idToKey.get(Number(v)) ?? v;
      } else if (f.type === "json" && v != null && typeof v === "object") {
        v = JSON.stringify(v);
      }
      out[f.field] = v ?? null;
    }
    ws.addRow(out);
  }
  return wb;
}

// -------------------------------------------------------------------------
// parse + validate (dry run)
// -------------------------------------------------------------------------

interface ParsedBatch {
  entityKey: string;
  mode: "insert" | "upsert";
  rows: { sheetRow: number; values: Record<string, unknown>; nk: string; exists: boolean }[];
  createdAt: number;
}

const BATCHES = new Map<string, ParsedBatch>();
const BATCH_TTL_MS = 30 * 60 * 1000;

function gcBatches() {
  const now = Date.now();
  for (const [k, b] of BATCHES) if (now - b.createdAt > BATCH_TTL_MS) BATCHES.delete(k);
}

async function readWorkbook(buffer: Buffer, filename: string, sheetName?: string): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  if (filename.toLowerCase().endsWith(".csv")) {
    // exceljs csv reader takes a stream
    const { Readable } = await import("stream");
    await wb.csv.read(Readable.from(buffer));
    return wb.worksheets[0];
  }
  await wb.xlsx.load(await repairXlsxBuffer(buffer));
  if (sheetName) {
    const s = wb.getWorksheet(sheetName);
    if (s) return s;
  }
  const byName = wb.getWorksheet("Data");
  return byName ?? wb.worksheets[0];
}

/** Sheet names in a workbook (xlsx only; csv has none). */
export async function listWorkbookSheets(buffer: Buffer, filename: string): Promise<string[]> {
  if (filename.toLowerCase().endsWith(".csv")) return [];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await repairXlsxBuffer(buffer));
  return wb.worksheets.map((w) => w.name);
}

export async function parseAndValidate(
  entityKey: string,
  buffer: Buffer,
  filename: string,
  mode: "insert" | "upsert",
  sheetName?: string
): Promise<ValidateResult> {
  const entity = getEntity(entityKey);
  if (!entity) throw new Error(`Unknown entity "${entityKey}"`);

  const ws = await readWorkbook(buffer, filename, sheetName);
  const errors: RowError[] = [];

  // header map: column label (lower) -> field
  const fieldByHeader = new Map<string, FieldSpec>();
  for (const f of entity.fields) if (!f.readonly) fieldByHeader.set(f.column.trim().toLowerCase(), f);

  const headerRow = ws.getRow(1);
  const headerCells: { col: number; header: string; field?: FieldSpec }[] = [];
  const unknownColumns: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const header = String(cellToPrimitive(cell.value) ?? "").trim();
    if (!header) return;
    const field = fieldByHeader.get(header.toLowerCase());
    if (!field) unknownColumns.push(header);
    headerCells.push({ col, header, field });
  });

  if (headerCells.filter((h) => h.field).length === 0) {
    throw new Error(
      "No recognised columns found in the sheet header. Download the template and keep the header row."
    );
  }

  // which recognised fields actually have a column in the uploaded sheet
  const presentFields = new Set(headerCells.filter((h) => h.field).map((h) => h.field!.field));

  // required fields whose column is missing from the sheet entirely - reported
  // once (not per row)
  const missingRequiredColumns = entity.fields.filter(
    (f) => !f.readonly && f.required && !presentFields.has(f.field)
  );
  for (const f of missingRequiredColumns) {
    errors.push({ row: 1, column: f.column, message: `Required column "${f.column}" is missing from the sheet` });
  }

  // preload ref maps
  const refMaps = new Map<string, RefMap>();
  for (const f of entity.fields) {
    if (f.ref && !refMaps.has(f.ref.entity)) refMaps.set(f.ref.entity, await loadRefMap(f.ref.entity));
  }

  const keyFields = entity.fields.filter((f) => f.naturalKey);
  const table: any = entity.table;

  // Pass 1: coerce every row
  const staged: { sheetRow: number; values: Record<string, unknown>; nk: string }[] = [];
  const seenInFile = new Map<string, number>();
  let dataRows = 0;

  const lastRow = ws.rowCount;
  for (let r = 2; r <= lastRow; r++) {
    const row = ws.getRow(r);
    // skip completely empty rows
    const hasAny = headerCells.some((h) => {
      const v = cellToPrimitive(row.getCell(h.col).value);
      return v !== null && v !== "";
    });
    if (!hasAny) continue;
    dataRows++;
    if (dataRows > MAX_DATA_ROWS) {
      errors.push({ row: r, message: `File exceeds ${MAX_DATA_ROWS} rows - split it into smaller files` });
      break;
    }

    const values: Record<string, unknown> = {};
    let rowOk = true;

    for (const h of headerCells) {
      if (!h.field) continue;
      const raw = cellToPrimitive(row.getCell(h.col).value);
      const f = h.field;

      if (f.ref) {
        const isBlank = raw === null || (typeof raw === "string" && raw.trim() === "");
        if (isBlank) {
          if (f.required) {
            errors.push({ row: r, column: f.column, message: `"${f.column}" is required` });
            rowOk = false;
          } else {
            values[f.field] = null;
          }
          continue;
        }
        const rm = refMaps.get(f.ref.entity)!;
        const nk = normKey(String(raw).split("|").map((s) => s.trim()));
        const id = rm.byKey.get(nk);
        if (id === undefined) {
          errors.push({
            row: r,
            column: f.column,
            message: `No ${getEntity(f.ref.entity)?.label ?? f.ref.entity} found matching "${raw}"`,
          });
          rowOk = false;
        } else {
          values[f.field] = id;
        }
        continue;
      }

      const { value, error } = coerceValue(f, raw);
      if (error) {
        errors.push({ row: r, column: f.column, message: error });
        rowOk = false;
      } else {
        values[f.field] = value;
      }
    }

    // if a required column is missing from the whole sheet, every row is invalid
    // (the header-level error above already explains why)
    if (missingRequiredColumns.length > 0) rowOk = false;

    const nk = keyFields.length
      ? normKey(keyFields.map((kf) => values[kf.field] as any))
      : `__row_${r}`;

    if (keyFields.length && seenInFile.has(nk)) {
      errors.push({
        row: r,
        message: `Duplicate of row ${seenInFile.get(nk)} (same ${keyFields.map((k) => k.column).join(" + ")})`,
      });
      rowOk = false;
    } else if (keyFields.length) {
      seenInFile.set(nk, r);
    }

    if (rowOk) staged.push({ sheetRow: r, values, nk });
  }

  // Pass 2: which natural keys already exist in DB
  const existing = new Set<string>();
  if (keyFields.length && staged.length) {
    const rowsInDb: any[] = await (entity.softDelete && table.isDeleted
      ? db.select().from(table).where(eq(table.isDeleted, false))
      : db.select().from(table));
    for (const dbRow of rowsInDb) {
      existing.add(normKey(keyFields.map((kf) => dbRow[kf.field])));
    }
  }

  let toInsert = 0;
  let toUpdate = 0;
  const finalRows = staged.map((s) => {
    const exists = existing.has(s.nk);
    if (exists) toUpdate++;
    else toInsert++;
    return { ...s, exists };
  });

  // In insert mode, existing rows are conflicts
  if (mode === "insert") {
    for (const fr of finalRows) {
      if (fr.exists) {
        errors.push({
          row: fr.sheetRow,
          message: `A record with this key already exists. Use "Update existing" mode to overwrite.`,
        });
      }
    }
  }

  gcBatches();
  const batchToken = randomUUID();
  BATCHES.set(batchToken, {
    entityKey,
    mode,
    rows: finalRows,
    createdAt: Date.now(),
  });

  return {
    entity: entityKey,
    summary: {
      dataRows,
      valid: finalRows.length,
      invalid: dataRows - finalRows.length,
      toInsert,
      toUpdate,
      unknownColumns,
    },
    errors: errors.sort((a, b) => a.row - b.row).slice(0, 500),
    preview: finalRows.slice(0, PREVIEW_LIMIT).map((r) => r.values),
    batchToken,
  };
}

// -------------------------------------------------------------------------
// commit
// -------------------------------------------------------------------------

export async function commitBatch(batchToken: string, userId: number): Promise<CommitResult> {
  const batch = BATCHES.get(batchToken);
  if (!batch) {
    throw new Error("This import preview has expired. Please upload the file again.");
  }
  const entity = getEntity(batch.entityKey)!;
  const table: any = entity.table;
  const keyFields = entity.fields.filter((f) => f.naturalKey);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const errors: RowError[] = [];

  const insertRows = batch.rows.filter((r) => !(r.exists && batch.mode === "upsert") && !r.exists);
  const updateRows = batch.mode === "upsert" ? batch.rows.filter((r) => r.exists) : [];

  if (batch.mode === "insert" && batch.rows.some((r) => r.exists)) {
    // conflicts were already reported at validate time; skip them here
    skipped += batch.rows.filter((r) => r.exists).length;
  }

  // bulk insert in chunks
  const CHUNK = 500;
  for (let i = 0; i < insertRows.length; i += CHUNK) {
    const slice = insertRows.slice(i, i + CHUNK).map((r) => ({
      ...r.values,
      createdBy: userId,
      updatedBy: userId,
    }));
    try {
      await db.insert(table).values(slice);
      inserted += slice.length;
    } catch (err: any) {
      // fall back to row-by-row to isolate the bad row
      for (const r of insertRows.slice(i, i + CHUNK)) {
        try {
          await db.insert(table).values({ ...r.values, createdBy: userId, updatedBy: userId });
          inserted++;
        } catch (e: any) {
          errors.push({ row: r.sheetRow, message: e.message?.split("\n")[0] || "Insert failed" });
        }
      }
    }
  }

  for (const r of updateRows) {
    try {
      const where = and(
        ...keyFields.map((kf) => eq(table[kf.field], r.values[kf.field])),
        ...(entity.softDelete && table.isDeleted ? [eq(table.isDeleted, false)] : [])
      );
      await db
        .update(table)
        .set({ ...r.values, updatedBy: userId, updatedAt: new Date() })
        .where(where);
      updated++;
    } catch (e: any) {
      errors.push({ row: r.sheetRow, message: e.message?.split("\n")[0] || "Update failed" });
    }
  }

  BATCHES.delete(batchToken);

  return { entity: batch.entityKey, mode: batch.mode, inserted, updated, skipped, errors };
}

export async function fetchAllForExport(entity: EntitySpec): Promise<Record<string, any>[]> {
  const table: any = entity.table;
  if (entity.softDelete && table.isDeleted) {
    return db.select().from(table).where(eq(table.isDeleted, false));
  }
  return db.select().from(table);
}

// -------------------------------------------------------------------------
// paginated list (for the editable spreadsheet grid / generic entity API)
// -------------------------------------------------------------------------

export interface ListOpts {
  limit?: number;
  offset?: number;
  search?: string;
  sort?: string; // field key
  dir?: "asc" | "desc";
  filters?: Record<string, string>;
  /** Replace foreign-key ids with the target's natural-key string. */
  resolveRefs?: boolean;
  /** Include soft-deleted rows too. */
  includeDeleted?: boolean;
}

export interface ListResult {
  rows: Record<string, any>[];
  total: number;
}

export async function fetchPage(entity: EntitySpec, opts: ListOpts = {}): Promise<ListResult> {
  const table: any = entity.table;
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 2000);
  const offset = Math.max(opts.offset ?? 0, 0);

  const conds: any[] = [];
  if (entity.softDelete && table.isDeleted && !opts.includeDeleted) {
    conds.push(eq(table.isDeleted, false));
  }

  // free-text search across string / text columns present on the table
  const q = (opts.search ?? "").trim();
  if (q) {
    const like = `%${q.replace(/[%_]/g, (m) => "\\" + m)}%`;
    const searchable = entity.fields.filter(
      (f) => (f.type === "string" || f.type === "text") && table[f.field],
    );
    if (searchable.length) {
      conds.push(or(...searchable.map((f) => ilike(sql`${table[f.field]}::text`, like))));
    }
  }

  // per-column filters
  for (const [key, val] of Object.entries(opts.filters ?? {})) {
    const f = entity.fields.find((ff) => ff.field === key);
    if (!f || !table[key] || val === "" || val == null) continue;
    if (f.type === "boolean") {
      conds.push(eq(table[key], /^(1|true|yes)$/i.test(String(val))));
    } else if (["int", "number", "decimal"].includes(f.type) && Number.isFinite(Number(val))) {
      conds.push(eq(table[key], f.type === "decimal" ? String(Number(val)) : Number(val)));
    } else if (f.type === "enum") {
      conds.push(eq(table[key], val));
    } else {
      conds.push(ilike(sql`${table[key]}::text`, `%${String(val)}%`));
    }
  }

  const whereExpr = conds.length ? and(...conds) : undefined;

  const sortField = opts.sort && table[opts.sort] ? table[opts.sort] : table.id;
  const orderExpr = opts.dir === "asc" ? asc(sortField) : desc(sortField);

  const [rows, totalRow] = await Promise.all([
    db.select().from(table).where(whereExpr).orderBy(orderExpr).limit(limit).offset(offset),
    db.select({ n: sql<number>`count(*)::int` }).from(table).where(whereExpr),
  ]);

  let out = rows as Record<string, any>[];

  if (opts.resolveRefs) {
    const refMaps = new Map<string, RefMap>();
    for (const f of entity.fields) {
      if (f.ref && !refMaps.has(f.ref.entity)) {
        refMaps.set(f.ref.entity, await loadRefMap(f.ref.entity));
      }
    }
    out = out.map((r) => {
      const copy = { ...r };
      for (const f of entity.fields) {
        if (f.ref && copy[f.field] != null) {
          copy[f.field] = refMaps.get(f.ref.entity)?.idToKey.get(Number(copy[f.field])) ?? copy[f.field];
        }
      }
      return copy;
    });
  }

  return { rows: out, total: Number(totalRow[0]?.n ?? 0) };
}

/**
 * Coerce a flat map of {field -> raw} for one row, resolving enum/date/number
 * and foreign-key (natural-key string -> id) values. Used by the generic entity
 * API for inline cell edits and new-row inserts.
 */
export async function coerceRecord(
  entity: EntitySpec,
  input: Record<string, unknown>,
  refMaps?: Map<string, RefMap>,
  opts: { isCreate?: boolean } = {},
): Promise<{ values: Record<string, unknown>; errors: RowError[] }> {
  const values: Record<string, unknown> = {};
  const errors: RowError[] = [];
  const maps = refMaps ?? new Map<string, RefMap>();

  for (const f of entity.fields) {
    if (f.readonly) continue;
    if (!(f.field in input)) {
      // On create, a required field the user never touched at all (e.g. a
      // ghost-row cell they skipped) wasn't in the draft object, so this
      // loop used to skip it silently — the required check a few lines
      // below only runs for fields actually present in `input`. The row
      // then went straight to the DB with that column omitted, and Postgres'
      // own NOT NULL constraint threw a raw, unreadable
      // "Failed query: insert into ... " wall of SQL instead of a clean
      // '"X" is required'. On update, a field simply not present in the
      // patch is normal (leave it alone) and must NOT be flagged.
      if (opts.isCreate && f.required && f.default === undefined) {
        errors.push({ row: 0, column: f.column, message: `"${f.column}" is required` });
      }
      continue;
    }
    const raw = input[f.field] as any;

    if (f.ref) {
      const isBlank = raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "");
      if (isBlank) {
        if (f.required) errors.push({ row: 0, column: f.column, message: `"${f.column}" is required` });
        else values[f.field] = null;
        continue;
      }
      if (typeof raw === "number") {
        values[f.field] = raw;
        continue;
      }
      if (!maps.has(f.ref.entity)) maps.set(f.ref.entity, await loadRefMap(f.ref.entity));
      const rm = maps.get(f.ref.entity)!;
      const nk = normKey(String(raw).split("|").map((s) => s.trim()));
      const id = rm.byKey.get(nk);
      if (id === undefined) {
        errors.push({ row: 0, column: f.column, message: `No ${getEntity(f.ref.entity)?.label ?? f.ref.entity} matches "${raw}"` });
      } else {
        values[f.field] = id;
      }
      continue;
    }

    const { value, error } = coerceValue(f, raw);
    if (error) errors.push({ row: 0, column: f.column, message: error });
    else values[f.field] = value;
  }

  return { values, errors };
}

export { inArray, coerceValue, loadRefMap, normKey };
export type { RefMap };
