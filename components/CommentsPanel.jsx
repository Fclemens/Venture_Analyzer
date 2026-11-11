"use client";
import { useState, useEffect, useCallback } from "react";
import { MessageSquare, Send, Trash2, Loader } from "lucide-react";

// Team discussion. methodId = null → about the whole deal.
export default function CommentsPanel({ projectId, methodId = null, count = 0, onChanged, label = "Comments" }) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const qs = `?method=${methodId || ""}`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/comments${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setComments((await res.json()).comments);
    } catch (e) { setErr(e.message); }
  }, [projectId, qs]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/comments`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text, methodId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      setText(""); await load(); onChanged?.();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const remove = async (id) => {
    const res = await fetch(`/api/projects/${projectId}/comments?id=${id}`, { method: "DELETE" });
    if (res.ok) { await load(); onChanged?.(); }
  };

  return (
    <div onClick={e => e.stopPropagation()}>
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors">
        <MessageSquare size={11} /> {label}{count > 0 && <span className="px-1.5 rounded-full bg-blue-50 text-blue-700 font-medium">{count}</span>}
      </button>
      {open && (
        <div className="mt-1.5 border border-gray-200 rounded-lg bg-white p-2.5 space-y-2">
          {!comments && <div className="flex justify-center"><Loader size={12} className="animate-spin text-gray-400" /></div>}
          {comments?.length === 0 && <p className="text-xs text-gray-400">No comments yet.</p>}
          {comments?.map(c => (
            <div key={c.id} className="text-xs">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-800">{c.author_name}</span>
                <span className="text-gray-400">{new Date(c.created_at).toLocaleString()}</span>
                {c.mine && <button onClick={() => remove(c.id)} aria-label="Delete comment" className="ml-auto text-gray-300 hover:text-red-400"><Trash2 size={10} /></button>}
              </div>
              <p className="text-gray-700 whitespace-pre-wrap">{c.body}</p>
            </div>
          ))}
          <div className="flex gap-1.5">
            <textarea value={text} onChange={e => setText(e.target.value)} rows={1} maxLength={4000} placeholder="Add a comment…"
              onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
              className="flex-1 text-xs px-2 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 resize-y text-gray-700" />
            <button onClick={send} disabled={busy || !text.trim()} aria-label="Post comment"
              className="px-2 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-40">
              {busy ? <Loader size={11} className="animate-spin" /> : <Send size={11} />}
            </button>
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
      )}
    </div>
  );
}
