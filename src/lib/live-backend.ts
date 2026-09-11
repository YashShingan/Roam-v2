// ─── Live backend (Render) client ───────────────────────────────────────────
// All live-mode behavior is hidden unless NEXT_PUBLIC_API_URL is set at build
// time. Every call: 1 retry on network error, never throws to the UI layer
// without a caller-side catch → toast.
export function sanitizeApiBase(url?: string): string {
  const base = (url || "").trim() || "https://roam-cmtg.onrender.com";
  return base.replace(/\/+$/, "").replace(/\/(api|health)$/, "").replace(/\/+$/, "");
}

export const API_BASE = sanitizeApiBase(process.env.NEXT_PUBLIC_API_URL);
export const liveMode = API_BASE.length > 0;

export interface ProbeState {
  ok: boolean;
  at: number;
  dataMode?: string;
  version?: string;
}

let probeCache: ProbeState | null = null;
const PROBE_TTL = 5 * 60 * 1000;

/** Probe /health — first ping tolerates a 30–60 s Render cold start (90 s budget). */
export async function probeBackend(): Promise<ProbeState> {
  if (!liveMode) return { ok: false, at: 0 };
  if (probeCache && Date.now() - probeCache.at < PROBE_TTL) return probeCache;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), attempt === 0 ? 90_000 : 15_000);
      const res = await fetch(`${API_BASE}/health`, { signal: ctrl.signal, cache: "no-store" });
      clearTimeout(t);
      if (res.ok) {
        const j = (await res.json().catch(() => ({}))) as { dataMode?: string; version?: string };
        probeCache = { ok: true, at: Date.now(), dataMode: j.dataMode, version: j.version };
        return probeCache;
      }
    } catch {
      /* network error → retry once */
    }
  }
  probeCache = { ok: false, at: Date.now() };
  return probeCache;
}

export interface JobState {
  job_id: string;
  status: "running" | "done" | "error";
  result?: { city?: string; collected?: number; stored?: number };
  error?: string;
  poll?: string;
}

/** Kick off a backend scrape → 202 { job_id }. */
export async function startLiveScrape(city: string): Promise<JobState> {
  const res = await fetch(`${API_BASE}/api/collect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ city }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { detail?: string; error?: string };
    throw new Error(j.detail ?? j.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as JobState;
}

export async function pollJob(jobId: string): Promise<JobState> {
  const res = await fetch(`${API_BASE}/api/v1/jobs/${jobId}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as JobState;
}
