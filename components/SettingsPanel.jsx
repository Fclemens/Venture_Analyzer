"use client";
import { useState, useEffect } from "react";
import { X, Eye, EyeOff, Check, Loader, AlertCircle, ChevronDown } from "lucide-react";
import { PROVIDERS, PROVIDER_MODELS } from "@/lib/constants";

function ProviderBadge({ provider }) {
  const p = PROVIDERS[provider];
  return <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${p?.color}`}>{p?.name || provider}</span>;
}

function ApiKeyField({ provider, value, onChange, onTest }) {
  const [visible, setVisible] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // null | {ok, error}

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    const result = await onTest(provider);
    setTestResult(result);
    setTesting(false);
  };

  return (
    <div className="flex gap-2 items-center">
      <div className="relative flex-1">
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={`${PROVIDERS[provider]?.name} API key`}
          className="w-full text-xs px-2.5 py-1.5 pr-8 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 font-mono bg-white text-gray-900 placeholder-gray-400"
        />
        <button onClick={() => setVisible(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
          {visible ? <EyeOff size={12} /> : <Eye size={12} />}
        </button>
      </div>
      <button onClick={handleTest} disabled={testing || !value || value.includes("•")}
        className="text-xs px-2.5 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-100 text-gray-700 disabled:opacity-40 flex items-center gap-1 whitespace-nowrap">
        {testing ? <Loader size={10} className="animate-spin" /> : "Test"}
      </button>
      {testResult && (
        testResult.ok
          ? <Check size={14} className="text-emerald-500 flex-shrink-0" />
          : <AlertCircle size={14} className="text-red-400 flex-shrink-0" title={testResult.error} />
      )}
    </div>
  );
}

function ModelSelect({ providers, selectedProvider, selectedModel, onProviderChange, onModelChange, enabledProviders }) {
  const models = PROVIDER_MODELS[selectedProvider] || [];
  return (
    <div className="flex gap-2">
      <select value={selectedProvider} onChange={e => { onProviderChange(e.target.value); onModelChange(PROVIDER_MODELS[e.target.value]?.[0]?.id || ""); }}
        className="text-xs px-2 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 bg-white text-gray-900">
        {Object.keys(PROVIDERS).filter(p => enabledProviders.includes(p)).map(p => (
          <option key={p} value={p}>{PROVIDERS[p].name}</option>
        ))}
      </select>
      <select value={selectedModel} onChange={e => onModelChange(e.target.value)}
        className="flex-1 text-xs px-2 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 bg-white">
        {models.map(m => (
          <option key={m.id} value={m.id}>{m.name} — {m.note}</option>
        ))}
      </select>
    </div>
  );
}

export default function SettingsPanel({ onClose }) {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // local key state (unmasked while editing)
  const [keys, setKeys] = useState({ anthropic: "", openai: "", gemini: "" });

  useEffect(() => {
    fetch("/api/settings").then(r => r.json()).then(s => {
      setSettings(s);
      // Initialize key fields (masked values stay masked)
      setKeys({ anthropic: s.providers.anthropic?.apiKey || "", openai: s.providers.openai?.apiKey || "", gemini: s.providers.gemini?.apiKey || "" });
    });
  }, []);

  const handleTest = async (provider) => {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    return res.json();
  };

  const handleSave = async () => {
    setSaving(true);
    const payload = {
      ...settings,
      providers: {
        anthropic: { ...settings.providers.anthropic, apiKey: keys.anthropic },
        openai:    { ...settings.providers.openai,    apiKey: keys.openai },
        gemini:    { ...settings.providers.gemini,    apiKey: keys.gemini },
      },
    };
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const updated = await res.json();
    setSettings(updated);
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const enabledProviders = settings ? Object.entries(settings.providers).filter(([, v]) => v.enabled).map(([k]) => k) : ["anthropic"];

  if (!settings) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
      <div className="bg-white rounded-2xl p-8"><Loader size={20} className="animate-spin text-gray-400 mx-auto" /></div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-md bg-white shadow-2xl flex flex-col h-full overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h2 className="text-sm font-semibold text-gray-900">Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={16} /></button>
        </div>

        <div className="flex-1 px-5 py-4 space-y-6">
          {/* ── API Keys ── */}
          <section>
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">API Keys</h3>
            <div className="space-y-4">
              {Object.keys(PROVIDERS).map(provider => (
                <div key={provider} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <ProviderBadge provider={provider} />
                    <label className="flex items-center gap-1.5 ml-auto cursor-pointer">
                      <span className="text-xs text-gray-600">Enabled</span>
                      <div
                        onClick={() => setSettings(s => ({ ...s, providers: { ...s.providers, [provider]: { ...s.providers[provider], enabled: !s.providers[provider]?.enabled } } }))}
                        className={`w-8 h-4 rounded-full transition-colors cursor-pointer ${settings.providers[provider]?.enabled ? "bg-gray-900" : "bg-gray-200"}`}>
                        <div className={`w-3 h-3 bg-white rounded-full mt-0.5 transition-transform ${settings.providers[provider]?.enabled ? "translate-x-4" : "translate-x-0.5"}`} />
                      </div>
                    </label>
                  </div>
                  {settings.providers[provider]?.enabled && (
                    <ApiKeyField
                      provider={provider}
                      value={keys[provider]}
                      onChange={v => setKeys(k => ({ ...k, [provider]: v }))}
                      onTest={handleTest}
                    />
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* ── Model Roles ── */}
          <section>
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1">Model roles</h3>
            <p className="text-xs text-gray-500 mb-3">Assign which provider + model handles each role in the pipeline.</p>
            <div className="space-y-4">
              {[
                { role: "fast",        label: "Fast model",          desc: "Text extraction, entity scan, evidence extraction, rechunking" },
                { role: "smart",       label: "Smart model",          desc: "P0 classification, methodology execution + web search" },
                { role: "doc_chapter", label: "Chapter narrative",    desc: "Writes the narrative chapter for each completed pass" },
                { role: "doc_exec",    label: "Executive summary",    desc: "Synthesises all chapters into the executive summary and flags incoherences" },
              ].map(({ role, label, desc }) => (
                <div key={role}>
                  <p className="text-xs font-semibold text-gray-800 mb-0.5">{label}</p>
                  <p className="text-xs text-gray-500 mb-2">{desc}</p>
                  <ModelSelect
                    providers={settings.providers}
                    selectedProvider={settings.roles[role]?.provider || "anthropic"}
                    selectedModel={settings.roles[role]?.model || ""}
                    enabledProviders={enabledProviders.length ? enabledProviders : ["anthropic"]}
                    onProviderChange={p => setSettings(s => ({ ...s, roles: { ...s.roles, [role]: { ...s.roles[role], provider: p } } }))}
                    onModelChange={m => setSettings(s => ({ ...s, roles: { ...s.roles, [role]: { ...s.roles[role], model: m } } }))}
                  />
                  {settings.roles[role]?.provider === "gemini" && role === "smart" && (
                    <p className="text-xs text-amber-600 mt-1">⚠ Gemini uses Google Search grounding but rechunking is disabled. Results may lack web citations.</p>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* ── Current config summary ── */}
          <section className="bg-gray-100 rounded-xl p-3">
            <p className="text-xs font-semibold text-gray-700 mb-2">Current pipeline config</p>
            {["fast", "smart", "doc_chapter", "doc_exec"].map(role => {
              const rc = settings.roles[role];
              const model = PROVIDER_MODELS[rc?.provider]?.find(m => m.id === rc?.model);
              return (
                <div key={role} className="flex items-center justify-between text-xs py-1">
                  <span className="text-gray-600 capitalize font-medium">{role}</span>
                  <div className="flex items-center gap-1.5">
                    <ProviderBadge provider={rc?.provider} />
                    <span className="text-gray-700 font-medium">{model?.name || rc?.model}</span>
                  </div>
                </div>
              );
            })}
          </section>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 sticky bottom-0 bg-white">
          <button onClick={handleSave} disabled={saving}
            className="w-full py-2.5 bg-gray-900 text-white text-sm rounded-xl hover:bg-gray-700 disabled:opacity-40 flex items-center justify-center gap-2 transition-all">
            {saving ? <><Loader size={14} className="animate-spin" /> Saving…</> : saved ? <><Check size={14} /> Saved!</> : "Save settings"}
          </button>
        </div>
      </div>
    </div>
  );
}
