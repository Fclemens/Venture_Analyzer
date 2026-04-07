"use client";
import { Plus, Trash2, FileText, Lightbulb, Layers, Settings } from "lucide-react";

function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000)  return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const STATUS_DOT = {
  setup:    "bg-gray-300",
  running:  "bg-blue-400 animate-pulse",
  done:     "bg-emerald-400",
  error:    "bg-red-400",
};

export default function Sidebar({ projects, activeId, onSelect, onNew, onDelete, onSettings }) {
  return (
    <aside className="w-56 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-gray-900 flex items-center justify-center flex-shrink-0">
          <Layers size={13} className="text-white" />
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-900 leading-none">Venture Analyzer</p>
          <p className="text-xs text-gray-400 mt-0.5">v3</p>
        </div>
      </div>

      {/* New project */}
      <div className="px-3 py-2.5 border-b border-gray-100">
        <button onClick={onNew}
          className="w-full flex items-center gap-2 text-xs font-medium text-white bg-gray-900 hover:bg-gray-700 rounded-lg px-3 py-2 transition-colors">
          <Plus size={13} /> New analysis
        </button>
      </div>

      {/* Projects list */}
      <div className="flex-1 overflow-y-auto py-1">
        {projects.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-8 px-4">No analyses yet.<br />Start one above.</p>
        )}
        {projects.map(p => (
          <div key={p.id}
            onClick={() => onSelect(p.id)}
            className={`group px-3 py-2.5 cursor-pointer transition-colors flex items-start gap-2.5 ${activeId === p.id ? "bg-blue-50" : "hover:bg-gray-50"}`}>
            {/* entry mode icon */}
            <div className="flex-shrink-0 mt-0.5">
              {p.entry_mode === "concept"
                ? <Lightbulb size={12} className={activeId === p.id ? "text-blue-500" : "text-gray-300"} />
                : <FileText   size={12} className={activeId === p.id ? "text-blue-500" : "text-gray-300"} />}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-medium truncate leading-snug ${activeId === p.id ? "text-blue-700" : "text-gray-800"}`}>
                {p.name}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[p.status] || STATUS_DOT.setup}`} />
                <span className="text-xs text-gray-400">{timeAgo(p.updated_at)}</span>
              </div>
            </div>
            <button onClick={e => { e.stopPropagation(); onDelete(p.id); }}
              className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all mt-0.5">
              <Trash2 size={11} />
            </button>
          </div>
        ))}
      </div>

      {/* Settings */}
      <div className="border-t border-gray-100 px-3 py-2.5">
        <button onClick={onSettings}
          className="w-full flex items-center gap-2 text-xs text-gray-500 hover:text-gray-800 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors">
          <Settings size={13} /> Settings
        </button>
      </div>
    </aside>
  );
}
