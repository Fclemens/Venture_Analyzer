"use client";
import { Plus, Trash2, FileText, Lightbulb, Layers, Settings, LogOut, ShieldCheck } from "lucide-react";
import { useUser, useClerk } from "@clerk/nextjs";

function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000)    return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/** Mini progress bar — shown for the currently active project. */
function ProgressBar({ done, total }) {
  if (!total) return null;
  const pct = Math.round((done / total) * 100);
  return (
    <div className="mt-1.5 h-0.5 bg-gray-100 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${done === total ? "bg-emerald-400" : "bg-blue-400"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

const STATUS_DOT = {
  setup:   "bg-gray-300",
  running: "bg-blue-400 animate-pulse",
  done:    "bg-emerald-400",
  error:   "bg-red-400",
};

export default function Sidebar({
  projects,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onSettings,
  /** { done: number, total: number } — completion for the active project */
  activeProgress,
}) {
  const { user } = useUser();
  const { signOut } = useClerk();

  // Admin check — publicMetadata is available client-side for the signed-in user
  const isAdmin = user?.publicMetadata?.role === "admin";

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
        <button
          onClick={onNew}
          className="w-full flex items-center gap-2 text-xs font-medium text-white bg-gray-900 hover:bg-gray-700 rounded-lg px-3 py-2 transition-colors"
        >
          <Plus size={13} /> New analysis
        </button>
      </div>

      {/* Projects list */}
      <div className="flex-1 overflow-y-auto py-1">
        {projects.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-8 px-4">
            No analyses yet.<br />Start one above.
          </p>
        )}
        {projects.map(p => {
          const isActive = p.id === activeId;
          const showProgress = isActive && activeProgress?.total > 0;
          return (
            <div
              key={p.id}
              onClick={() => onSelect(p.id)}
              className={`group px-3 py-2.5 cursor-pointer transition-colors flex items-start gap-2.5 ${isActive ? "bg-blue-50" : "hover:bg-gray-50"}`}
            >
              <div className="flex-shrink-0 mt-0.5">
                {p.entry_mode === "concept"
                  ? <Lightbulb size={12} className={isActive ? "text-blue-500" : "text-gray-300"} />
                  : <FileText   size={12} className={isActive ? "text-blue-500" : "text-gray-300"} />}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-medium truncate leading-snug ${isActive ? "text-blue-700" : "text-gray-800"}`}>
                  {p.name}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[p.status] || STATUS_DOT.setup}`} />
                  {showProgress ? (
                    <span className={`text-xs font-medium ${activeProgress.done === activeProgress.total ? "text-emerald-600" : "text-blue-500"}`}>
                      {activeProgress.done}/{activeProgress.total} done
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">{timeAgo(p.updated_at)}</span>
                  )}
                </div>
                {showProgress && (
                  <ProgressBar done={activeProgress.done} total={activeProgress.total} />
                )}
              </div>
              <button
                onClick={e => { e.stopPropagation(); onDelete(p.id); }}
                className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all mt-0.5"
                title="Delete project"
              >
                <Trash2 size={11} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Bottom: settings + admin + user */}
      <div className="border-t border-gray-100 px-3 py-2 space-y-0.5">
        <button
          onClick={onSettings}
          className="w-full flex items-center gap-2 text-xs text-gray-500 hover:text-gray-800 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <Settings size={13} /> Settings
        </button>

        {isAdmin && (
          <a
            href="/admin"
            className="w-full flex items-center gap-2 text-xs text-violet-600 hover:text-violet-800 px-2 py-1.5 rounded-lg hover:bg-violet-50 transition-colors"
          >
            <ShieldCheck size={13} /> Admin dashboard
          </a>
        )}

        {user && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 group mt-0.5">
            {user.imageUrl
              ? <img src={user.imageUrl} alt="" className="w-5 h-5 rounded-full flex-shrink-0" />
              : (
                <div className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 text-[9px] font-bold text-gray-500">
                  {user.firstName?.[0] || user.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() || "?"}
                </div>
              )
            }
            <span className="text-xs text-gray-500 truncate flex-1">
              {user.firstName || user.emailAddresses?.[0]?.emailAddress}
            </span>
            <button
              onClick={() => signOut({ redirectUrl: "/sign-in" })}
              title="Sign out"
              className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-gray-600 transition-all flex-shrink-0"
            >
              <LogOut size={11} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
