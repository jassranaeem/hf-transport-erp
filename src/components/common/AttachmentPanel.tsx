import React, { useCallback, useEffect, useRef, useState } from "react";
import { Paperclip, Upload, Trash2, FileText, Loader2, X } from "lucide-react";
import { enterpriseFetch, uploadAttachment, fetchBlobUrl } from "../../../client/api.ts";

interface Attachment {
  id: number;
  entityType: string;
  entityId: number;
  fileName: string;
  mimeType: string | null;
  size: number | null;
  caption: string | null;
  category: string;
  createdAt: string;
  fileUrl: string;
}

/**
 * Drop-in "receipts / proof" widget for any record in any module.
 *   <AttachmentPanel entityType="trip" entityId={trip.id} />
 */
export default function AttachmentPanel({
  entityType,
  entityId,
  readOnly = false,
  title = "Attachments & proof",
}: {
  entityType: string;
  entityId: number;
  readOnly?: boolean;
  title?: string;
}) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dupWarn, setDupWarn] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!entityId) return;
    setLoading(true);
    setErr(null);
    try {
      const rows: Attachment[] = await enterpriseFetch(
        `/api/attachments?entityType=${encodeURIComponent(entityType)}&entityId=${entityId}`
      );
      setItems(rows);
      // lazy-load image thumbnails as authed blob URLs
      for (const r of rows) {
        if (r.mimeType && r.mimeType.startsWith("image/") && !thumbs[r.id]) {
          fetchBlobUrl(r.fileUrl)
            .then((u) => setThumbs((t) => ({ ...t, [r.id]: u })))
            .catch(() => {});
        }
      }
    } catch (e: any) {
      setErr(e.message || "Failed to load attachments");
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  const doUpload = async (files: FileList | File[]) => {
    if (readOnly) return;
    setBusy(true);
    setErr(null);
    setDupWarn(null);
    try {
      for (const f of Array.from(files)) {
        const res: any = await uploadAttachment(entityType, entityId, f);
        if (res?.duplicate && Array.isArray(res.duplicateOf)) {
          const others = res.duplicateOf.filter((d: any) => d.id !== res.id);
          if (others.length) {
            setDupWarn(
              `⚠ "${f.name}" ki bilkul yehi copy pehle bhi lagi hai — ` +
                others.map((d: any) => `${d.entityType} #${d.entityId} (${new Date(d.createdAt).toLocaleDateString()})`).join(", ") +
                `. Yeh double slip to nahi?`,
            );
          }
        } else if (res?.sameSlipCount > 0) {
          const others = (res.sameSlip || []).filter((d: any) => d.id !== res.id);
          if (others.length) {
            setDupWarn(
              `⚠ Isi naam/size ki file pehle bhi lagi hai (${others.map((d: any) => `${d.entityType} #${d.entityId}`).join(", ")}) — same slip dobara to nahi lagayi?`,
            );
          }
        }
      }
      await load();
    } catch (e: any) {
      setErr(e.message || "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async (id: number) => {
    if (readOnly) return;
    try {
      await enterpriseFetch(`/api/attachments/${id}`, { method: "DELETE" });
      setItems((x) => x.filter((i) => i.id !== id));
    } catch (e: any) {
      setErr(e.message || "Delete failed");
    }
  };

  const open = async (a: Attachment) => {
    try {
      const url = thumbs[a.id] || (await fetchBlobUrl(a.fileUrl));
      window.open(url, "_blank", "noopener");
    } catch {
      setErr("Could not open file");
    }
  };

  return (
    <div className="border border-slate-200 rounded-xl p-4 bg-white">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Paperclip className="w-4 h-4 text-slate-400" />
          {title}
          {items.length > 0 && (
            <span className="text-[11px] font-medium text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">
              {items.length}
            </span>
          )}
        </div>
        {!readOnly && (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 flex items-center gap-1.5 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Add file
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
          className="hidden"
          onChange={(e) => e.target.files && doUpload(e.target.files)}
        />
      </div>

      {err && <p className="text-[11px] text-red-600 mb-2">{err}</p>}

      {dupWarn && (
        <div className="mb-2 rounded-lg border border-red-300 bg-red-600 text-white px-3 py-2 text-[11px] flex items-start gap-2" dir="auto">
          <span className="font-bold">DUPLICATE</span>
          <span className="flex-1">{dupWarn}</span>
          <button onClick={() => setDupWarn(null)} className="shrink-0" title="Dismiss">
            <X className="w-3.5 h-3.5" style={{ color: "#fff", stroke: "#fff" }} />
          </button>
        </div>
      )}

      {!readOnly && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.length) doUpload(e.dataTransfer.files);
          }}
          className={`text-[11px] text-center rounded-lg border border-dashed py-2 mb-3 transition ${
            dragOver ? "border-emerald-400 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-400"
          }`}
        >
          Drop receipts / scans here, or use “Add file”
        </div>
      )}

      {loading ? (
        <div className="text-xs text-slate-400 flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> loading…
        </div>
      ) : items.length === 0 ? (
        <p className="text-[11px] text-slate-400">No attachments yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {items.map((a) => (
            <div key={a.id} className="group relative border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
              <button onClick={() => open(a)} className="block w-full" title={a.fileName}>
                {thumbs[a.id] ? (
                  <img src={thumbs[a.id]} alt={a.fileName} className="h-24 w-full object-cover" />
                ) : (
                  <div className="h-24 w-full flex items-center justify-center text-slate-400">
                    <FileText className="w-7 h-7" />
                  </div>
                )}
                <div className="px-2 py-1 text-[10px] text-slate-600 truncate text-left">{a.fileName}</div>
              </button>
              {!readOnly && (
                <button
                  onClick={() => remove(a.id)}
                  className="absolute top-1 right-1 bg-white/90 hover:bg-red-50 text-red-600 rounded-full p-1 opacity-0 group-hover:opacity-100 transition"
                  title="Delete"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
