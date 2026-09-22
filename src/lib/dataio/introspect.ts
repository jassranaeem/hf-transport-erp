/**
 * Schema introspection -> EntitySpec.
 *
 * The hand-written specs in registry.ts stay the source of truth for the tables
 * that need friendly column labels, foreign-key lookups and examples. For the
 * ~40 remaining tables we derive a usable spec straight from the Drizzle table
 * object so every module gets an editable spreadsheet with near-zero upkeep.
 */
import { getTableColumns } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { EntitySpec, FieldSpec, FieldType } from "./types.ts";

/** Columns every table carries - shown read-only, never imported. */
const AUDIT_COLS = new Set([
  "id",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "createdBy",
  "updatedBy",
  "deletedBy",
  "isDeleted",
]);

function titleCase(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bId\b/g, "ID")
    .replace(/\bNtn\b/g, "NTN")
    .replace(/\bStrn\b/g, "STRN")
    .replace(/\bIban\b/g, "IBAN")
    .replace(/\bGps\b/g, "GPS")
    .replace(/\bImei\b/g, "IMEI")
    .replace(/\bUrl\b/g, "URL")
    .replace(/\bCnic\b/g, "CNIC")
    .trim();
}

function columnToFieldType(col: any): FieldType {
  if (Array.isArray(col.enumValues) && col.enumValues.length) return "enum";
  switch (col.dataType) {
    case "boolean":
      return "boolean";
    case "date":
      return col.columnType === "PgDate" ? "date" : "datetime";
    case "json":
      return "json";
    case "number": {
      if (col.columnType === "PgNumeric" || col.columnType === "PgDecimal") return "decimal";
      return "int";
    }
    case "bigint":
      return "int";
    default:
      return "string";
  }
}

export interface AutoEntityOpts {
  description?: string;
  resource?: string;
  /** Column key to treat as the natural key (upsert match). Defaults to the first unique text column. */
  naturalKey?: string;
  /** Foreign-key columns: { columnKey: "targetEntityKey" }. */
  refs?: Record<string, { entity: string; by?: string }>;
  /** Column keys to mark read-only (computed / server-managed). */
  readonly?: string[];
  /** Column keys to drop from the spec entirely. */
  omit?: string[];
  /** Force enum values for text columns that are enums by convention. */
  enums?: Record<string, readonly string[]>;
  /** Table has no soft-delete flag. */
  noSoftDelete?: boolean;
}

export function autoEntity(
  key: string,
  label: string,
  table: PgTable,
  opts: AutoEntityOpts = {},
): EntitySpec {
  const cols = getTableColumns(table as any) as Record<string, any>;
  const readonly = new Set(opts.readonly ?? []);
  const omit = new Set(opts.omit ?? []);
  const fields: FieldSpec[] = [];

  let naturalKeyPicked = false;

  for (const [fieldKey, col] of Object.entries(cols)) {
    if (omit.has(fieldKey)) continue;
    if (AUDIT_COLS.has(fieldKey)) continue;

    const ref = opts.refs?.[fieldKey];
    const forcedEnum = opts.enums?.[fieldKey];
    const type: FieldType = forcedEnum ? "enum" : columnToFieldType(col);

    const isUnique = !!col.isUnique;
    let naturalKey = false;
    if (opts.naturalKey ? opts.naturalKey === fieldKey : isUnique && type === "string" && !naturalKeyPicked) {
      naturalKey = true;
      naturalKeyPicked = true;
    }

    const spec: FieldSpec = {
      column: titleCase(fieldKey),
      field: fieldKey,
      type,
      required: !!col.notNull && !col.hasDefault && !readonly.has(fieldKey),
    };
    if (forcedEnum) spec.enumValues = forcedEnum;
    else if (Array.isArray(col.enumValues) && col.enumValues.length) spec.enumValues = col.enumValues;
    if (naturalKey) spec.naturalKey = true;
    if (ref) spec.ref = ref;
    if (readonly.has(fieldKey)) spec.readonly = true;
    if (col.hasDefault && typeof col.default !== "undefined" && col.default !== null) {
      // Drizzle stores the JS default when it is a literal (not sql``).
      if (["string", "number", "boolean"].includes(typeof col.default)) spec.default = col.default;
    }

    fields.push(spec);
  }

  return {
    key,
    label,
    description: opts.description,
    table,
    fields,
    softDelete: opts.noSoftDelete ? false : "isDeleted" in cols,
    resource: opts.resource ?? "settings",
  };
}
