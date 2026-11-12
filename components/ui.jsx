"use client";
// Small shared visual primitives. Status colours are defined once here so the
// same meaning always has the same colour across the app.
import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

export const STATUS_COLOR = {
  done: "#059669",      // emerald-600
  review: "#d97706",    // amber-600
  running: "#2563eb",   // blue-600
  error: "#dc2626",     // red-600
  idle: "#d1d5db",      // gray-300
};

// Score bands shared by report, overview and compare
export function scoreBand(v) {
  if (v == null) return { word: "not assessed", bar: "#e5e7eb", text: "text-gray-400", chip: "bg-gray-50 text-gray-400" };
  if (v >= 7.5) return { word: "strong", bar: "#059669", text: "text-emerald-700", chip: "bg-emerald-50 text-emerald-700" };
  if (v >= 6) return { word: "solid", bar: "#0284c7", text: "text-sky-700", chip: "bg-sky-50 text-sky-700" };
  if (v >= 4.5) return { word: "weak", bar: "#d97706", text: "text-amber-700", chip: "bg-amber-50 text-amber-700" };
  return { word: "poor", bar: "#dc2626", text: "text-red-700", chip: "bg-red-50 text-red-700" };
}

export function ProgressRing({ value = 0, total = 0, size = 18, stroke = 2.5, color = STATUS_COLOR.done, label }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? Math.min(1, value / total) : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label || `${value} of ${total} complete`} className="flex-shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
      {frac > 0 && (
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      )}
    </svg>
  );
}

// Horizontal bars per rubric dimension; unscored dimensions are hatched, not zero
export function ScoreBars({ breakdown = [], compact = false }) {
  return (
    <div className="space-y-2.5">
      {breakdown.map(d => {
        const b = scoreBand(d.score);
        return (
          <div key={d.id}>
            <div className="flex items-baseline justify-between text-xs mb-1">
              <span className="text-gray-700 font-medium">{d.label} <span className="text-gray-400 font-normal">· {Math.round(d.weight * 100)}%</span></span>
              <span className={`font-semibold ${b.text}`}>{d.score ?? "n/a"}<span className="font-normal text-gray-400"> {d.score != null ? `/10 · ${b.word}` : ""}</span></span>
            </div>
            <div className="w-full h-2 rounded-full overflow-hidden" role="img"
              aria-label={`${d.label}: ${d.score == null ? "not assessed" : `${d.score} out of 10`}`}
              style={d.score == null ? { backgroundImage: "repeating-linear-gradient(135deg, #e5e7eb 0 3px, #ffffff 3px 7px)" } : { background: "#f3f4f6" }}>
              {d.score != null && <div className="h-full rounded-full" style={{ width: `${d.score * 10}%`, background: b.bar }} />}
            </div>
            {!compact && d.evidence?.length > 0 && <p className="text-xs text-gray-500 mt-1 leading-snug">{d.evidence.join("; ")}{d.confidence ? ` · ${d.confidence} confidence` : ""}</p>}
          </div>
        );
      })}
    </div>
  );
}

// points: oldest → newest
export function Sparkline({ points = [], width = 72, height = 22, color = "#111827", label }) {
  const pts = points.filter(p => p != null);
  if (pts.length < 2) return null;
  const min = Math.min(...pts), max = Math.max(...pts);
  const x = (i) => 2 + (i / (pts.length - 1)) * (width - 4);
  const y = (v) => height - 3 - ((v - min) / (max - min || 1)) * (height - 6);
  const last = pts.at(-1), prev = pts.at(-2);
  return (
    <span className="inline-flex items-center gap-1.5" title={label}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label || `Score trend: ${pts.join(" → ")}`}>
        <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" points={pts.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
        <circle cx={x(pts.length - 1)} cy={y(last)} r="2.5" fill={color} />
      </svg>
      <span className={`text-xs font-medium ${last > prev ? "text-emerald-700" : last < prev ? "text-red-700" : "text-gray-500"}`}>
        {last > prev ? `▲ +${(last - prev).toFixed(1)}` : last < prev ? `▼ ${(last - prev).toFixed(1)}` : "no change"}
      </span>
    </span>
  );
}

export function Pill({ children, tone = "gray", title, icon }) {
  const tones = { gray: "bg-gray-100 text-gray-700", blue: "bg-blue-50 text-blue-700", green: "bg-emerald-50 text-emerald-700", amber: "bg-amber-50 text-amber-800", red: "bg-red-50 text-red-700", violet: "bg-violet-50 text-violet-700" };
  return <span title={title} className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${tones[tone]}`}>{icon}{children}</span>;
}

// ── Toasts ───────────────────────────────────────────────────────────────────
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const toast = useCallback((message, tone = "info") => {
    const id = Math.random().toString(36).slice(2);
    setItems(t => [...t, { id, message, tone }]);
    setTimeout(() => setItems(t => t.filter(x => x.id !== id)), tone === "error" ? 8000 : 4000);
  }, []);
  const Icon = { info: Info, success: CheckCircle2, error: AlertTriangle };
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 print:hidden" role="status" aria-live="polite">
        {items.map(t => {
          const I = Icon[t.tone] || Info;
          return (
            <div key={t.id} className={`flex items-start gap-2 max-w-sm px-3.5 py-2.5 rounded-xl shadow-lg border text-sm ${t.tone === "error" ? "bg-red-50 border-red-200 text-red-800" : t.tone === "success" ? "bg-white border-emerald-200 text-gray-800" : "bg-white border-gray-200 text-gray-800"}`}>
              <I size={15} className={`mt-0.5 flex-shrink-0 ${t.tone === "error" ? "text-red-600" : t.tone === "success" ? "text-emerald-600" : "text-blue-600"}`} />
              <span className="flex-1">{t.message}</span>
              <button onClick={() => setItems(x => x.filter(y => y.id !== t.id))} aria-label="Dismiss" className="text-gray-400 hover:text-gray-700"><X size={13} /></button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
