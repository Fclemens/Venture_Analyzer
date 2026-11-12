"use client";
// Markdown renderer that turns citation / claim markers into chips.
import { Children, isValidElement, cloneElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckCircle2, AlertCircle, XCircle } from "lucide-react";
import { splitCitations } from "@/lib/citations";

const CLAIM = {
  VERIFIED:     { label: "Verified",     cls: "bg-emerald-50 text-emerald-800 border-emerald-200", Icon: CheckCircle2, tip: "Independently confirmed" },
  UNVERIFIED:   { label: "Unverified",   cls: "bg-amber-50 text-amber-800 border-amber-200",       Icon: AlertCircle,  tip: "Company assertion only - not independently confirmed" },
  CONTRADICTED: { label: "Contradicted", cls: "bg-red-50 text-red-800 border-red-200",             Icon: XCircle,      tip: "Conflicts with the evidence" },
};
const PASSAGE = { Doc: "a passage from the uploaded documents", Web: "a fact found by web search", New: "evidence from a document added later" };

function Tokens({ text, onCite, evidenceIds }) {
  return splitCitations(text).map((t, i) => {
    if (t.type === "text") return t.value;
    if (t.type === "claim") {
      const c = CLAIM[t.kind];
      return <span key={i} title={c.tip} className={`inline-flex items-center gap-0.5 align-baseline mx-0.5 px-1.5 rounded-md border text-[0.85em] font-medium not-italic ${c.cls}`}><c.Icon size={11} />{c.label}</span>;
    }
    if (t.type === "evidence") {
      const known = !evidenceIds || evidenceIds.has(t.id);
      return onCite && known
        ? <button key={i} type="button" onClick={(e) => { e.stopPropagation(); onCite(t.id); }} title="Show this evidence"
            className="mx-0.5 px-1.5 rounded-md bg-violet-50 text-violet-800 border border-violet-200 text-[0.8em] font-semibold hover:bg-violet-100 align-baseline">{t.id}</button>
        : <span key={i} className="mx-0.5 px-1.5 rounded-md bg-gray-100 text-gray-600 text-[0.8em] align-baseline" title="Evidence item not found in the current bundle">{t.id}</span>;
    }
    return <span key={i} title={`Refers to ${PASSAGE[t.ref.replace(/\d+$/, "")]} used while writing this analysis`}
      className="mx-0.5 px-1.5 rounded-md bg-gray-100 text-gray-600 text-[0.8em] align-baseline">{t.ref}</span>;
  });
}

function chip(children, ctx) {
  return Children.map(children, ch => {
    if (typeof ch === "string") return <Tokens text={ch} {...ctx} />;
    if (isValidElement(ch) && ch.props?.children && typeof ch.type === "string" && ["strong", "em", "span"].includes(ch.type)) {
      return cloneElement(ch, {}, chip(ch.props.children, ctx));
    }
    return ch;
  });
}

export default function CitedMarkdown({ children, onCite, evidenceIds }) {
  const ctx = { onCite, evidenceIds };
  const wrap = (Tag) => function Wrapped({ node, children: kids, ...props }) { // eslint-disable-line no-unused-vars
    return <Tag {...props}>{chip(kids, ctx)}</Tag>;
  };
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ p: wrap("p"), li: wrap("li"), td: wrap("td"), th: wrap("th"), strong: wrap("strong"), em: wrap("em") }}>
      {children}
    </ReactMarkdown>
  );
}
