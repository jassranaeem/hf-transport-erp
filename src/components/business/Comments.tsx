/**
 * Comments on a record · تبصرے — write a note, @name someone to ask them (they get a
 * notification). Used on khata rows, parties, invoices and trips.
 */
import React, { useEffect, useState } from "react";
import { MessageSquare, Send, Trash2, Loader2 } from "lucide-react";
import { enterpriseFetch } from "../../../client/api.ts";

let peopleCache: Array<{ id: number; name: string }> | null = null;

export default function Comments({ entityType, entityId, compact }: { entityType: string; entityId: number; compact?: boolean }) {
  const [list, setList] = useState<any[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState(peopleCache || []);
  const [err, setErr] = useState<string | null>(null);

  const load = () =>
    enterpriseFetch(`/api/comments?entityType=${entityType}&entityId=${entityId}`)
      .then((r) => setList(r.comments))
      .catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    if (!peopleCache)
      enterpriseFetch("/api/comments/people")
        .then((r) => {
          peopleCache = r.people;
          setPeople(r.people);
        })
        .catch(() => {});
  }, [entityType, entityId]); // eslint-disable-line react-hooks/exhaustive-deps

  // "@al" at the end of the text → suggest names
  const m = /@([^@\n]{0,20})$/.exec(text);
  const hints = m ? people.filter((p) => p.name.toLowerCase().startsWith(m[1].toLowerCase())).slice(0, 5) : [];

  const post = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await enterpriseFetch("/api/comments", { method: "POST", body: JSON.stringify({ entityType, entityId, body: text.trim() }) });
      setText("");
      load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const del = async (id: number) => {
    await enterpriseFetch(`/api/comments/${id}`, { method: "DELETE" }).catch((e) => setErr(e.message));
    load();
  };

  return (
    <div className={`rounded-lg border border-[#E3E8EF] bg-white ${compact ? "p-2.5" : "p-3"} mt-3`}>
      <div className="text-[12px] font-semibold text-[#374151] flex items-center gap-1.5 mb-2">
        <MessageSquare className="w-3.5 h-3.5 text-[#24539B]" /> Comments · تبصرے {list && list.length > 0 && <span className="text-[#9CA3AF] font-normal">{list.length}</span>}
      </div>
      {err && <div className="text-[11.5px] text-red-600 mb-1">{err}</div>}
      {list === null ? (
        <div className="text-[12px] text-[#9CA3AF]"><Loader2 className="w-3.5 h-3.5 animate-spin inline" /> …</div>
      ) : (
        <div className="space-y-2">
          {list.map((c) => (
            <div key={c.id} className="group flex gap-2">
              <div className="w-6 h-6 rounded-full bg-[#EAF0F8] text-[#24539B] text-[10px] font-bold flex items-center justify-center shrink-0 uppercase">{(c.author || "?").slice(0, 2)}</div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-[#6B7280]">
                  <b className="text-[#374151]">{c.author || "—"}</b> · {new Date(c.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  <button onClick={() => del(c.id)} className="ml-2 opacity-0 group-hover:opacity-100 text-[#9CA3AF] hover:text-red-600" title="Delete"><Trash2 className="w-3 h-3 inline" /></button>
                </div>
                <div className="text-[12.5px] text-[#1F2937] whitespace-pre-wrap break-words" dir="auto">
                  {String(c.body)
                    .split(/(@[A-Za-z][\w .]{0,30}?)(?=\s|$|[,.!?])/)
                    .map((part: string, i: number) => (part.startsWith("@") ? <span key={i} className="text-[#24539B] font-medium">{part}</span> : <React.Fragment key={i}>{part}</React.Fragment>))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="relative mt-2 flex gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) post();
          }}
          rows={1}
          placeholder="Write a comment… @name to ask someone · تبصرہ"
          className="flex-1 border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 text-[12.5px] resize-y min-h-[34px]"
          dir="auto"
        />
        <button onClick={post} disabled={busy || !text.trim()} className="self-end rounded-lg bg-[#24539B] text-white px-3 py-1.5 disabled:opacity-40" title="Post (Ctrl+Enter)">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
        {hints.length > 0 && (
          <div className="absolute left-0 bottom-full mb-1 bg-white border border-[#E3E8EF] rounded-lg shadow-lg z-20 w-56">
            {hints.map((p) => (
              <button key={p.id} onClick={() => setText(text.replace(/@([^@\n]{0,20})$/, `@${p.name} `))} className="block w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-[#F4F6FA]">
                @{p.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
