"use client";
// Who did what on the deal, newest first.
import { useEffect, useState } from "react";
import { Play, AlertTriangle, MessageSquare, Check, RotateCcw, Users, FileText, Activity } from "lucide-react";

const ago = (t) => { const d = Date.now() - t; return d < 60e3 ? "just now" : d < 3600e3 ? `${Math.floor(d / 60e3)}m ago` : d < 86400e3 ? `${Math.floor(d / 3600e3)}h ago` : `${Math.floor(d / 86400e3)}d ago`; };
const ACTION = { extract: "gathered evidence for", execute: "ran", revise: "revised", run: "ran", report: "generated the report", reindex: "re-indexed the documents" };

function describe(i) {
  switch (i.type) {
    case "job_done": return { Icon: Play, tone: "text-blue-700", text: <><b>{i.who || "Someone"}</b> {ACTION[i.action] || i.action}{i.method ? <> <i>{i.method}</i></> : ""}</> };
    case "job_failed": return { Icon: AlertTriangle, tone: "text-red-700", text: <><i>{i.method || "A run"}</i> failed{i.who ? <> (started by <b>{i.who}</b>)</> : ""}</> };
    case "comment": return { Icon: MessageSquare, tone: "text-gray-700", text: <><b>{i.who}</b> commented{i.method ? <> on <i>{i.method}</i></> : ""}: “{i.body}”</> };
    case "approve": return { Icon: Check, tone: "text-emerald-700", text: <><b>{i.who || "Someone"}</b> approved <i>{i.method}</i></> };
    case "restore": return { Icon: RotateCcw, tone: "text-gray-700", text: <><b>{i.who || "Someone"}</b> restored an earlier version of <i>{i.method}</i></> };
    case "share": return { Icon: Users, tone: "text-blue-700", text: <><b>{i.who || "Someone"}</b> shared the deal with the team</> };
    case "unshare": return { Icon: Users, tone: "text-gray-700", text: <><b>{i.who || "Someone"}</b> made the deal private</> };
    case "report": return { Icon: FileText, tone: "text-gray-900", text: <>Report generated: <b>{i.verdict}</b>{i.score != null ? ` · ${i.score}/10` : ""}</> };
    default: return { Icon: Activity, tone: "text-gray-600", text: i.type };
  }
}

export default function ActivityFeed({ projectId, refreshKey }) {
  const [items, setItems] = useState(null);
  useEffect(() => {
    if (!projectId) return;
    let off = false;
    fetch(`/api/projects/${projectId}/activity`).then(r => r.ok ? r.json() : { items: [] }).then(d => !off && setItems(d.items || [])).catch(() => !off && setItems([]));
    return () => { off = true; };
  }, [projectId, refreshKey]);

  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-1.5"><Activity size={14} /> Activity</h2>
      {items === null && <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="h-4 rounded bg-gray-100 animate-pulse" style={{ width: `${80 - i * 15}%` }} />)}</div>}
      {items?.length === 0 && <p className="text-sm text-gray-500">Nothing yet. Runs, approvals, comments and reports appear here.</p>}
      {items?.length > 0 && (
        <ul className="space-y-2.5">
          {items.slice(0, 12).map((i, k) => {
            const { Icon, tone, text } = describe(i);
            return (
              <li key={k} className="flex items-start gap-2.5 text-sm">
                <Icon size={14} className={`${tone} mt-0.5 flex-shrink-0`} />
                <span className="flex-1 text-gray-800 leading-snug">{text}</span>
                <span className="text-xs text-gray-500 whitespace-nowrap">{ago(i.at)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
