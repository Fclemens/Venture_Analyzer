"use client";
import { Plus, Trash2, FileText, Lightbulb, Layers, Settings, LogOut, BarChart3, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Search } from "lucide-react";
import { scoreBand } from "@/components/ui";
import { useUser, useClerk, OrganizationSwitcher } from "@clerk/nextjs";

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
  const { user } = useUser();
  const { signOut } = useClerk();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all"); // all | mine | shared
  const anyShared = projects.some(p => p.shared);
  const shown = projects.filter(p =>
    (!query || p.name.toLowerCase().includes(query.toLowerCase())) &&
    (filter === "all" || (filter === "mine" ? p.is_owner !== false : p.shared))
  );

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

      {/* Choose the team workspace; deals can be shared with the active organization */}
      <div className="px-3 pt-2">
        <OrganizationSwitcher hidePersonal={false} afterSelectOrganizationUrl="/" afterSelectPersonalUrl="/"
          appearance={{ elements: { rootBox: "w-full", organizationSwitcherTrigger: "w-full justify-between text-xs px-2 py-1.5 rounded-lg hover:bg-gray-50" } }} />
      </div>
      <div className="px-3 pt-1">
        <Link href="/compare" className="flex items-center gap-2 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg px-3 py-1.5 transition-colors">
          <BarChart3 size={13} /> Compare deals
        </Link>
      </div>

      {/* New project */}
      <div className="px-3 py-2.5 border-b border-gray-100">
        <button onClick={onNew}
          className="w-full flex items-center gap-2 text-xs font-medium text-white bg-gray-900 hover:bg-gray-700 rounded-lg px-3 py-2 transition-colors">
          <Plus size={13} /> New analysis
        </button>
      </div>

      {/* Search + filter */}
      {projects.length > 3 && (
        <div className="px-3 pt-2.5 pb-1 space-y-1.5">
          <label className="flex items-center gap-1.5 px-2 py-1.5 border border-gray-200 rounded-lg focus-within:border-blue-400">
            <Search size={12} className="text-gray-500" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search deals" aria-label="Search deals"
              className="flex-1 text-xs outline-none bg-transparent text-gray-800 placeholder-gray-500" />
          </label>
          {anyShared && (
            <div className="flex gap-1 text-[11px]" role="tablist">
              {[["all", "All"], ["mine", "Mine"], ["shared", "Shared"]].map(([k, l]) => (
                <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
                  className={`px-2 py-0.5 rounded-full ${filter === k ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"}`}>{l}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Projects list */}
      <div className="flex-1 overflow-y-auto py-1">
        {projects.length === 0 && (
          <p className="text-xs text-gray-500 text-center py-8 px-4">No analyses yet.<br />Start one above.</p>
        )}
        {projects.length > 0 && shown.length === 0 && <p className="text-xs text-gray-500 text-center py-6 px-4">No deals match.</p>}
        {shown.map(p => (
          <div key={p.id}
            onClick={() => onSelect(p.id)}
            className={`group px-3 py-2.5 cursor-pointer transition-colors flex items-start gap-2.5 ${activeId === p.id ? "bg-blue-50" : "hover:bg-gray-50"}`}>
            <div className="flex-shrink-0 mt-0.5">
              {p.entry_mode === "concept"
                ? <Lightbulb size={12} className={activeId === p.id ? "text-blue-500" : "text-gray-300"} />
                : <FileText   size={12} className={activeId === p.id ? "text-blue-500" : "text-gray-300"} />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className={`text-[13px] font-medium truncate leading-snug flex-1 ${activeId === p.id ? "text-blue-800" : "text-gray-900"}`}>
                  {p.name}
                </p>
                {p.score && (
                  <span title={p.verdict || ""} className={`text-[11px] font-semibold px-1.5 rounded ${scoreBand(Number.parseFloat(p.score)).chip}`}>{Number.parseFloat(p.score).toFixed(1)}</span>
                )}
              </div>
              {p.shared && (
                <p className="flex items-center gap-1 text-[10px] text-gray-400 mt-0.5"><Users size={9} /> {p.is_owner ? "Shared with team" : "Shared with you"}</p>
              )}
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[p.status] || STATUS_DOT.setup}`} />
                <span className="text-xs text-gray-500">{timeAgo(p.updated_at)}{p.verdict ? ` · ${p.verdict}` : ""}</span>
              </div>
            </div>
            {p.is_owner !== false && (
              <button onClick={e => { e.stopPropagation(); onDelete(p.id); }} aria-label={`Delete ${p.name}`}
                className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all mt-0.5">
                <Trash2 size={11} />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Bottom: settings + user */}
      <div className="border-t border-gray-100 px-3 py-2">
        <button onClick={onSettings}
          className="w-full flex items-center gap-2 text-xs text-gray-500 hover:text-gray-800 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors mb-1">
          <Settings size={13} /> Settings
        </button>

        {user && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 group">
            {user.imageUrl
              ? <img src={user.imageUrl} alt="" className="w-5 h-5 rounded-full flex-shrink-0" />
              : <div className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 text-[9px] font-bold text-gray-500">
                  {user.firstName?.[0] || user.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() || "?"}
                </div>
            }
            <span className="text-xs text-gray-500 truncate flex-1">
              {user.firstName || user.emailAddresses?.[0]?.emailAddress}
            </span>
            <button
              onClick={() => signOut({ redirectUrl: "/sign-in" })}
              title="Sign out"
              className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-gray-600 transition-all flex-shrink-0">
              <LogOut size={11} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
