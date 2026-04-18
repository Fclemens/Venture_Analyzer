"use client";
import { Check, FileText } from "lucide-react";

/**
 * Horizontal pipeline stepper shown at the top of the pipeline screen.
 * Shows all passes + a Document step. Clicking navigates to that pass.
 * All-passes-visible layout is preserved — this is purely a progress overview.
 */
export default function PipelineStepper({ passGroups, activePass, p0Done, onSelectPass }) {
  // Build step list: P0 Scope, then all analysis passes, then Document
  const steps = [
    {
      id: "p0",
      label: "Scope",
      done: p0Done,
      partial: false,
      count: null,
    },
    ...passGroups.slice(1).map(pg => ({
      id: pg.id,
      label: pg.title,
      done: pg.totalActive > 0 && pg.doneCount === pg.totalActive,
      partial: pg.doneCount > 0 && pg.doneCount < pg.totalActive,
      count: pg.totalActive > 0 ? `${pg.doneCount}/${pg.totalActive}` : null,
    })),
    {
      id: "__document__",
      label: "Document",
      done: false,
      partial: false,
      count: null,
      isDoc: true,
    },
  ];

  return (
    <div className="flex items-center gap-0.5 overflow-x-auto bg-white border-b border-gray-100 px-4 py-2 flex-shrink-0 scrollbar-none">
      {steps.map((step, i) => {
        const isActive = activePass === step.id;
        return (
          <div key={step.id} className="flex items-center flex-shrink-0">
            {/* Connector line */}
            {i > 0 && (
              <div className={`w-5 h-px flex-shrink-0 mx-0.5 ${step.done || steps[i - 1]?.done ? "bg-emerald-200" : "bg-gray-200"}`} />
            )}

            <button
              onClick={() => onSelectPass(step.id)}
              title={step.label}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap
                ${isActive
                  ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200"
                  : step.done
                    ? "text-emerald-700 hover:bg-emerald-50"
                    : step.partial
                      ? "text-amber-700 hover:bg-amber-50"
                      : "text-gray-500 hover:bg-gray-50"
                }`}
            >
              {/* Status dot / icon */}
              {step.done ? (
                <Check size={10} className="text-emerald-500 flex-shrink-0" />
              ) : step.isDoc ? (
                <FileText size={10} className="flex-shrink-0 opacity-60" />
              ) : step.partial ? (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
              ) : isActive ? (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-gray-200 flex-shrink-0" />
              )}

              <span>{step.label}</span>

              {/* Progress fraction (only when partial or not started but has methods) */}
              {step.count && !step.done && (
                <span className={`font-normal text-[10px] ${step.partial ? "text-amber-500" : "text-gray-400"}`}>
                  {step.count}
                </span>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
