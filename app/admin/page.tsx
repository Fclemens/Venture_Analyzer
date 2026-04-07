"use client";
import { useEffect, useState } from "react";
import { Users, Activity, Layers, TrendingUp, AlertCircle, RefreshCw } from "lucide-react";

type UserStat = {
  userId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  projectCount: number;
  calls7d: number;
  calls30d: number;
  tokens30d: number;
  lastActive: number | null;
  signInCount: number;
  topStep: string | null;
  inactive: boolean;
  clerkCreatedAt: number | null;
};

type DayVolume = { day: string; calls: number };

type Stats = {
  users: UserStat[];
  totals: {
    totalCalls30d: number;
    totalTokens30d: number;
    totalProjects: number;
    activeUsers7d: number;
    userCount: number;
  };
  dailyVolume: DayVolume[];
};

function timeAgo(ts: number | null) {
  if (!ts) return "Never";
  const diff = Date.now() - ts;
  if (diff < 60_000)      return "Just now";
  if (diff < 3_600_000)   return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)  return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function fmtTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function Sparkline({ data }: { data: DayVolume[] }) {
  if (!data.length) return <span className="text-xs text-gray-300">No data</span>;
  const max = Math.max(...data.map(d => d.calls), 1);
  const W = 120, H = 28;
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1 || 1)) * W;
    const y = H - (d.calls / max) * H;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={W} height={H} className="overflow-visible">
      <polyline points={pts} fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinejoin="round" />
      {data.map((d, i) => (
        <circle key={i}
          cx={(i / (data.length - 1 || 1)) * W}
          cy={H - (d.calls / max) * H}
          r="2" fill="#3b82f6" opacity="0.6">
          <title>{d.day}: {d.calls} calls</title>
        </circle>
      ))}
    </svg>
  );
}

export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/admin/stats");
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      setStats(await res.json());
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { load(); }, []);

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-sm text-gray-400">Loading…</div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-sm text-red-500">{error}</div>
    </div>
  );

  const { users, totals, dailyVolume } = stats!;
  const inactiveCount = users.filter(u => u.inactive).length;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Header */}
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Admin Dashboard</h1>
            <p className="text-xs text-gray-400 mt-0.5">Usage & user monitoring</p>
          </div>
          <button onClick={load} disabled={refreshing}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors disabled:opacity-40">
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {/* Totals row */}
        <div className="grid grid-cols-5 gap-3 mb-6">
          {[
            { icon: <Users size={14} />,    label: "Total users",        value: totals.userCount,                   color: "text-blue-600" },
            { icon: <Activity size={14} />, label: "Active (7d)",         value: totals.activeUsers7d,               color: "text-emerald-600" },
            { icon: <Layers size={14} />,   label: "Total projects",      value: totals.totalProjects,               color: "text-purple-600" },
            { icon: <TrendingUp size={14}/>,label: "Pipeline calls (30d)",value: totals.totalCalls30d,               color: "text-orange-600" },
            { icon: <AlertCircle size={14}/>,label: "Inactive users",     value: inactiveCount,                      color: inactiveCount > 0 ? "text-red-500" : "text-gray-400" },
          ].map(({ icon, label, value, color }) => (
            <div key={label} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className={`flex items-center gap-1.5 ${color} mb-1`}>{icon}<span className="text-xs font-medium">{label}</span></div>
              <p className="text-2xl font-bold text-gray-900">{value}</p>
            </div>
          ))}
        </div>

        {/* Sparkline */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-gray-700">Pipeline calls — last 30 days</p>
            <p className="text-xs text-gray-400">~{fmtTokens(totals.totalTokens30d)} tokens estimated</p>
          </div>
          <Sparkline data={dailyVolume} />
        </div>

        {/* User table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-3 text-left font-semibold text-gray-500">User</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-500">Projects</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-500">Calls 7d</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-500">Calls 30d</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-500">Tokens 30d</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-500">Sign-ins</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-500">Top step</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-500">Last active</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.userId} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {u.avatarUrl
                        ? <img src={u.avatarUrl} alt="" className="w-6 h-6 rounded-full flex-shrink-0" />
                        : <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[9px] font-bold text-gray-500 flex-shrink-0">
                            {u.email?.[0]?.toUpperCase() || "?"}
                          </div>
                      }
                      <div>
                        {u.name && <p className="font-medium text-gray-800">{u.name}</p>}
                        <p className="text-gray-400">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">{u.projectCount}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={u.calls7d > 0 ? "text-blue-600 font-medium" : "text-gray-300"}>{u.calls7d}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">{u.calls30d}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{fmtTokens(u.tokens30d)}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{u.signInCount}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {u.topStep
                      ? <code className="bg-gray-100 px-1.5 py-0.5 rounded text-[10px]">{u.topStep}</code>
                      : <span className="text-gray-300">—</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-right text-gray-400">{timeAgo(u.lastActive)}</td>
                  <td className="px-4 py-3 text-center">
                    {u.inactive
                      ? <span className="inline-block px-2 py-0.5 rounded-full bg-red-50 text-red-500 font-medium">Inactive</span>
                      : <span className="inline-block px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 font-medium">Active</span>
                    }
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-gray-300">No users yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
