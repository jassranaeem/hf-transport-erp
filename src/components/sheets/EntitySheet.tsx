/**
 * EntitySheet — a data-bound spreadsheet for any registered entity.
 *
 * Wires SheetGrid to the generic /api/entities/:key API: paginated load,
 * server sort / search / filter, batched save (entityBulk), foreign-key
 * autocomplete, per-row attachments and per-sheet Import/Export.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import SheetGrid, { SheetColumn, SheetOp } from "../grid/SheetGrid.tsx";
import ModuleDataIO from "../common/ModuleDataIO.tsx";
import AttachmentPanel from "../common/AttachmentPanel.tsx";
import {
  entityList,
  entityBulk,
  EntityField,
  EntityListResponse,
} from "../../../client/api.ts";

const PAGE = 200;

interface Props {
  entityKey: string;
  title?: string;
  /** hide the import/export control */
  noImport?: boolean;
  /** fixed server-side filters that the user can't change (e.g. ledgerId) */
  lockedFilters?: Record<string, string>;
  showFeedback?: (type: "success" | "error", msg: string) => void;
}

const refCache = new Map<string, string[]>();

export default function EntitySheet({ entityKey, title, noImport, lockedFilters, showFeedback }: Props) {
  const [data, setData] = useState<EntityListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const viewLs = `hf_sheet_view_${entityKey}`;
  const savedView = (() => {
    try {
      return JSON.parse(localStorage.getItem(viewLs) || "null") || {};
    } catch {
      return {};
    }
  })();
  const [search, setSearch] = useState<string>(savedView.search || "");
  const [sort, setSort] = useState<{ field: string; dir: "asc" | "desc" }>(
    savedView.sort || { field: "id", dir: "desc" },
  );
  const [filters, setFilters] = useState<Record<string, string>>(savedView.filters || {});
  const [attachRow, setAttachRow] = useState<Record<string, any> | null>(null);
  const [detailRow, setDetailRow] = useState<Record<string, any> | null>(null);
  const reqId = useRef(0);

  const effFilters = useMemo(() => ({ ...filters, ...(lockedFilters || {}) }), [filters, lockedFilters]);

  const load = useCallback(async () => {
    const my = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await entityList(entityKey, {
        limit: PAGE,
        offset,
        search: search || undefined,
        sort: sort.field,
        dir: sort.dir,
        filters: effFilters,
      });
      if (my === reqId.current) setData(res);
    } catch (e: any) {
      if (my === reqId.current) setError(e.message || "Failed to load");
    } finally {
      if (my === reqId.current) setLoading(false);
    }
  }, [entityKey, offset, search, sort.field, sort.dir, effFilters]);

  useEffect(() => {
    load();
  }, [load]);

  // remember this sheet's view (search / sort / filters)
  useEffect(() => {
    try {
      localStorage.setItem(viewLs, JSON.stringify({ search, sort, filters }));
    } catch {
      /* ignore */
    }
  }, [viewLs, search, sort, filters]);

  const columns: SheetColumn[] = useMemo(
    () =>
      (data?.fields || []).map((f: EntityField) => ({
        column: f.column,
        field: f.field,
        type: f.type,
        required: f.required,
        readonly: f.readonly,
        naturalKey: f.naturalKey,
        enumValues: f.enumValues,
        ref: f.ref,
      })),
    [data?.fields],
  );

  const onSave = async (ops: SheetOp[]) => {
    try {
      const res = await entityBulk(entityKey, ops);
      const n = (res.created || 0) + (res.updated || 0) + (res.deleted || 0);
      if (res.errors?.length) {
        showFeedback?.("error", `${res.errors.length} row(s) failed, ${n} saved`);
      } else {
        showFeedback?.("success", `${n} change${n === 1 ? "" : "s"} saved`);
      }
      return { errors: res.errors };
    } catch (e: any) {
      showFeedback?.("error", e.message || "Save failed");
      return { errors: ops.map((_, i) => ({ index: i, message: e.message || "Save failed" })) };
    }
  };

  const refSearch = useCallback(async (entity: string, q: string): Promise<string[]> => {
    const key = `${entity}:${q.toLowerCase()}`;
    if (refCache.has(key)) return refCache.get(key)!;
    try {
      const res = await entityList(entity, { limit: 20, search: q || undefined });
      // build a natural-key string per row from that entity's natural-key fields
      const nkFields = res.fields.filter((f) => f.naturalKey).map((f) => f.field);
      const opts = res.rows.map((row) =>
        (nkFields.length ? nkFields : ["id"]).map((f) => row[f]).filter((v) => v != null).join(" | "),
      );
      refCache.set(key, opts);
      return opts;
    } catch {
      return [];
    }
  }, []);

  const attachType = attachRow ? entityKey : "";

  return (
    <div className="flex flex-col h-full min-h-0 gap-2">
      {title && (
        <div className="flex items-center justify-between shrink-0">
          <h2 className="text-sm font-semibold">{title}</h2>
        </div>
      )}

      {error && (
        <div className="text-xs text-[#B91C1C] bg-[#FEF2F2] border border-[#FCA5A5] rounded px-3 py-2 shrink-0">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0">
        <SheetGrid
          viewKey={entityKey}
          columns={columns}
          rows={data?.rows || []}
          loading={loading}
          canWrite={!!data?.canWrite}
          canDelete={!!data?.canDelete}
          onSave={onSave}
          onRefresh={load}
          onAttach={(row) => setAttachRow(row)}
          onOpenDetail={(row) => setDetailRow(row)}
          sort={sort}
          onSort={(field, dir) => setSort({ field, dir })}
          filters={filters}
          onFilters={setFilters}
          search={search}
          onSearch={(s) => {
            setOffset(0);
            setSearch(s);
          }}
          refSearch={refSearch}
          page={{ offset, limit: PAGE, total: data?.total || 0, onPage: setOffset }}
          toolbarExtra={
            !noImport ? (
              <ModuleDataIO entityKey={entityKey} label={data?.label || entityKey} onImported={load} />
            ) : undefined
          }
        />
      </div>

      {/* attachments drawer */}
      {attachRow && (
        <div className="fixed inset-0 z-50 flex" onMouseDown={() => setAttachRow(null)}>
          <div className="flex-1 bg-black/20" />
          <div
            className="w-[420px] max-w-[92vw] bg-white h-full shadow-2xl border-l border-[#E5E7EB] p-4 overflow-y-auto"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">
                {data?.label} #{attachRow.id} — attachments
              </h3>
              <button onClick={() => setAttachRow(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <AttachmentPanel entityType={attachType} entityId={Number(attachRow.id)} />
          </div>
        </div>
      )}

      {/* detail drawer — raw field view / full-form fallback */}
      {detailRow && (
        <div className="fixed inset-0 z-50 flex" onMouseDown={() => setDetailRow(null)}>
          <div className="flex-1 bg-black/20" />
          <div
            className="w-[520px] max-w-[94vw] bg-white h-full shadow-2xl border-l border-[#E5E7EB] p-4 overflow-y-auto"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">
                {data?.label} #{detailRow.id}
              </h3>
              <button onClick={() => setDetailRow(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <table className="w-full text-xs">
              <tbody>
                {(data?.fields || []).map((f) => (
                  <tr key={f.field} className="border-b border-[#F0F0F0]">
                    <td className="py-1.5 pr-3 font-medium text-[#4B5563] align-top w-40">{f.column}</td>
                    <td className="py-1.5 break-words">
                      {detailRow[f.field] == null
                        ? "—"
                        : typeof detailRow[f.field] === "object"
                        ? JSON.stringify(detailRow[f.field])
                        : String(detailRow[f.field])}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4">
              <AttachmentPanel entityType={entityKey} entityId={Number(detailRow.id)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
