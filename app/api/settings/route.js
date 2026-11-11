import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSettings, saveSettings } from "@/lib/db";
import { PROVIDERS, DEFAULT_SETTINGS } from "@/lib/constants";

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const settings = getSettings(userId);
    // Mask API keys in response — return only whether they're set
    return NextResponse.json(mask(settings));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

const mask = (settings) => ({
  ...settings,
  providers: Object.fromEntries(
    Object.entries(settings.providers).map(([k, v]) => [k, { ...v, apiKey: v.apiKey ? "••••••••" : "" }])
  ),
});

export async function PUT(request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json();
    const current = getSettings(userId);

    // Merge carefully — preserve existing API keys if masked value sent
    const merged = {
      ...current,
      // Accept only known roles bound to a known provider and a plausible model id
      roles: {
        ...current.roles,
        ...Object.fromEntries(
          Object.entries(body.roles ?? {}).filter(([role, cfg]) =>
            role in DEFAULT_SETTINGS.roles && cfg && cfg.provider in PROVIDERS &&
            typeof cfg.model === "string" && /^[\w.:-]{1,80}$/.test(cfg.model)
          )
        ),
      },
      // Only known connectors, only booleans
      connectors: {
        ...current.connectors,
        ...Object.fromEntries(
          Object.entries(body.connectors ?? {})
            .filter(([k]) => k in DEFAULT_SETTINGS.connectors)
            .map(([k, v]) => [k, { enabled: v?.enabled === true }])
        ),
      },
      // Start from the stored providers so a save that omits (or only partly
      // includes) `providers` can never wipe existing API keys.
      providers: {
        ...current.providers,
        ...Object.fromEntries(
          Object.entries(body.providers ?? {}).map(([k, v]) => [
            k,
            {
              ...current.providers[k],
              enabled: v.enabled ?? current.providers[k]?.enabled,
              // Only update apiKey if a real value (not masked) was sent
              apiKey: v.apiKey && !v.apiKey.includes("•") ? v.apiKey : current.providers[k]?.apiKey ?? "",
            },
          ])
        ),
      },
    };
    delete merged._decryptFailed;

    const saved = saveSettings(userId, merged);
    return NextResponse.json(mask(saved));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Test connectivity for a provider
export async function POST(request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { provider } = await request.json();
    const settings = getSettings(userId);
    const apiKey = settings.providers[provider]?.apiKey;
    if (!apiKey) return NextResponse.json({ ok: false, error: "No API key configured" });

    let ok = false;
    let error = null;

    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      });
      ok = res.ok;
      if (!ok) error = `HTTP ${res.status}`;
    } else if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { "Authorization": `Bearer ${apiKey}` },
      });
      ok = res.ok;
      if (!ok) error = `HTTP ${res.status}`;
    } else if (provider === "gemini") {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
        headers: { "x-goog-api-key": apiKey },
      });
      ok = res.ok;
      if (!ok) error = `HTTP ${res.status}`;
    }

    return NextResponse.json({ ok, error });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message });
  }
}
