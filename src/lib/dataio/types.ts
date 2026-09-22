/**
 * Shared types for the generic Import / Export engine.
 *
 * The engine itself (engine.ts) is completely generic - it knows nothing about
 * the transport domain. Everything domain-specific lives in registry.ts as a
 * list of EntitySpec objects. To make a new table importable/exportable, add an
 * entry there; no engine changes required.
 */
import type { PgTable } from "drizzle-orm/pg-core";

export type FieldType =
  | "string"
  | "text"
  | "int"
  | "number"
  | "decimal"
  | "boolean"
  | "date"
  | "datetime"
  | "json"
  | "enum";

export interface FieldSpec {
  /** Column header shown in the spreadsheet (human friendly). */
  column: string;
  /** Drizzle/DB column key on the table object. */
  field: string;
  type: FieldType;
  required?: boolean;
  /** Allowed values for `type: "enum"` - also rendered as an Excel dropdown. */
  enumValues?: readonly string[];
  /** Part of the natural key used to match rows for upsert / dedupe. */
  naturalKey?: boolean;
  /**
   * Foreign key: the spreadsheet carries a human value (e.g. vehicleNumber),
   * the engine resolves it to the referenced row's id before insert.
   */
  ref?: {
    entity: string; // EntitySpec.key of the target
    /**
     * Optional: human column on the target to look up by. When omitted the
     * engine uses the target entity's naturalKey field(s), joining composite
     * keys with " | ".
     */
    by?: string;
  };
  /** Shown only on export, never imported (id, timestamps, computed). */
  readonly?: boolean;
  /** Default applied when the cell is blank on import. */
  default?: unknown;
  /** Hint text placed in the Instructions sheet. */
  note?: string;
  /** Example value placed in the Instructions sheet. */
  example?: unknown;
}

export interface EntitySpec {
  /** URL slug, e.g. "vehicles". */
  key: string;
  /** Display name, e.g. "Vehicles / Fleet". */
  label: string;
  /** Short description for the picker UI. */
  description?: string;
  table: PgTable;
  fields: FieldSpec[];
  /** Table uses the standard isDeleted soft-delete flag. */
  softDelete?: boolean;
  /** RBAC resource this maps to (for permission checks). */
  resource?: string;
}

export interface RowError {
  row: number; // 1-based spreadsheet row (header = row 1, first data row = 2)
  column?: string;
  message: string;
}

export interface ValidateResult {
  entity: string;
  summary: {
    dataRows: number;
    valid: number;
    invalid: number;
    toInsert: number;
    toUpdate: number;
    unknownColumns: string[];
  };
  errors: RowError[];
  /** First N normalised rows, for a preview table in the UI. */
  preview: Record<string, unknown>[];
  /** Opaque token the client passes back to /commit to avoid re-uploading. */
  batchToken: string;
}

export interface CommitResult {
  entity: string;
  mode: "insert" | "upsert";
  inserted: number;
  updated: number;
  skipped: number;
  errors: RowError[];
}
