"use client";
import { createContext, useContext, useState, useCallback } from "react";
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from "lucide-react";

const ToastCtx = createContext(null);

const STYLES = {
  success: { bg: "bg-emerald-50 border-emerald-200", icon: "text-emerald-600", text: "text-emerald-800", Icon: CheckCircle2 },
  error:   { bg: "bg-red-50 border-red-200",         icon: "text-red-500",     text: "text-red-800",     Icon: AlertCircle },
  warning: { bg: "bg-amber-50 border-amber-200",     icon: "text-amber-500",   text: "text-amber-800",   Icon: AlertTriangle },
  info:    { bg: "bg-blue-50 border-blue-200",       icon: "text-blue-500",    text: "text-blue-800",    Icon: Info },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const add = useCallback((message, type = "info", duration = 4500) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, message, type }]);
    if (duration > 0) {
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
    }
    return id;
  }, []);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastCtx.Provider value={add}>
      {children}
      <div
        className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2 pointer-events-none"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map(t => {
          const s = STYLES[t.type] || STYLES.info;
          const Icon = s.Icon;
          return (
            <div
              key={t.id}
              className={`flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border shadow-lg max-w-xs w-full pointer-events-auto ${s.bg} ${s.text}`}
              role="alert"
            >
              <Icon size={14} className={`flex-shrink-0 mt-0.5 ${s.icon}`} />
              <p className="text-xs flex-1 leading-relaxed">{t.message}</p>
              <button
                onClick={() => dismiss(t.id)}
                className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity ml-1 mt-0.5"
                aria-label="Dismiss"
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

/** Returns a toast function with .success / .error / .warning / .info helpers */
export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");

  const toast = useCallback(
    (msg, type = "info", dur) => ctx(msg, type, dur),
    [ctx]
  );
  toast.success = (msg, dur) => ctx(msg, "success", dur);
  toast.error   = (msg, dur) => ctx(msg, "error",   dur);
  toast.warning = (msg, dur) => ctx(msg, "warning",  dur);
  toast.info    = (msg, dur) => ctx(msg, "info",    dur);
  return toast;
}
