import React, { useEffect, useState } from "react";
import { Paperclip, ChevronDown, ChevronRight } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";
import AttachmentPanel from "./AttachmentPanel.tsx";

/**
 * Self-contained "attach receipts / proof" toggle for any record on any screen.
 * Renders a compact button with a count badge; expands the full AttachmentPanel
 * inline on click. No parent state needed.
 *
 *   <RecordAttachments entityType="trip" entityId={t.id} />
 */
export default function RecordAttachments({
  entityType,
  entityId,
  label = "Attachments / proof",
  defaultOpen = false,
  compact = false,
}: {
  entityType: string;
  entityId: number;
  label?: string;
  defaultOpen?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!entityId) return;
    enterpriseFetch(`/api/attachments?entityType=${encodeURIComponent(entityType)}&entityId=${entityId}`)
      .then((rows: any[]) => setCount(Array.isArray(rows) ? rows.length : 0))
      .catch(() => setCount(null));
  }, [entityType, entityId]);

  return (
    <div className={compact ? "" : "mt-2"}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <Paperclip className="w-3.5 h-3.5 text-slate-400" />
        {label}
        {count != null && count > 0 && (
          <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 rounded-full px-1.5 py-0.5">{count}</span>
        )}
      </button>
      {open && (
        <div className="mt-2">
          <AttachmentPanel entityType={entityType} entityId={entityId} title={label} />
        </div>
      )}
    </div>
  );
}
