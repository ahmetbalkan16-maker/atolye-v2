/**
 * Atölye Brain — Voice Lab latency feed for the optimization loop (pure).
 *
 * The Voice Lab (`/brain/voice-lab/wake`) and the Brain Console already produce
 * per-turn latency marks — `lastCaptureMs` (command capture window),
 * `lastSttMs` (STT round-trip), `lastWakeToCaptureMs` (wake→capture-end) — on
 * `WakeAdapterStatus` / `BrainLifecycleTelemetry`. This module is the safe seam
 * that turns those UNTRUSTED marks into a decision the optimization loop can act
 * on:
 *
 *   VOICE LAB REPORT (untrusted)
 *      → extractLatencySamples()   validate: number, non-negative, sane range,
 *                                  known metric, sane timestamp; a value that
 *                                  carries instruction-shaped text is rejected
 *      → normalizeLatencySamples() dedupe, clamp, drop -1 / 0 sentinels, sort
 *      → observeVoiceLatency()     median-of-N baseline vs a recent window →
 *                                  a per-metric finding: REGRESSION / STABLE /
 *                                  IMPROVED / UNKNOWN (never a fabricated
 *                                  regression when the data is thin)
 *      → buildLatencyIncident()    a confident REGRESSION → a `performance`
 *                                  incident draft for the Report Center chain
 *
 * PURE: no fs, no git, no network, no clock beyond an injected `now`. It NEVER
 * runs a sandbox, stages a patch, or touches the execution gate. A latency
 * finding is an OBSERVATION — the operator decides, the Node CLI applies.
 */

import { buildBrainIncident, type BrainIncident } from "./BrainIncident";
import { sanitizeUntrustedNote } from "./BrainUntrustedInput";

export const brainVoiceLatencySchemaVersion = "1" as const;

/** The real latency-mark contract from the voice pipeline (ms). */
export type BrainLatencyMetric = "captureMs" | "sttMs" | "wakeToCaptureMs" | "totalTurnMs";

export const BRAIN_LATENCY_METRICS: readonly BrainLatencyMetric[] = Object.freeze([
  "captureMs",
  "sttMs",
  "wakeToCaptureMs",
  "totalTurnMs",
]);

/** A single validated + normalized latency measurement. */
export interface BrainVoiceLatencySample {
  readonly schemaVersion: typeof brainVoiceLatencySchemaVersion;
  readonly metric: BrainLatencyMetric;
  /** > 0, <= MAX_LATENCY_MS. */
  readonly valueMs: number;
  /** ISO timestamp of the turn. */
  readonly at: string;
  /** Where it came from — sanitized enum-ish string. */
  readonly source: string;
  /** Optional session id — sanitized, short. */
  readonly sessionId?: string;
}

/** A latency mark above this (2 minutes) is not a real turn — it is noise / a bug / an attack. */
export const MAX_LATENCY_MS = 120_000;
/** Marks this old are ignored entirely. */
const DEFAULT_MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Small client-clock differences are tolerated; farther-future marks are untrusted. */
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

const METRIC_TR: Record<BrainLatencyMetric, string> = {
  captureMs: "komut yakalama süresi",
  sttMs: "konuşma tanıma (STT) süresi",
  wakeToCaptureMs: "uyandırmadan yakalama sonuna",
  totalTurnMs: "toplam tur gecikmesi",
};

/* --------------------------------------------------------------- validate */

export interface BrainLatencyValidation {
  readonly valid: readonly BrainVoiceLatencySample[];
  readonly rejected: readonly { readonly reason: string; readonly raw: string }[];
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isCleanShortString(v: unknown, max = 40): v is string {
  if (typeof v !== "string") return false;
  const cleaned = sanitizeUntrustedNote(v, max);
  // reject if sanitizing changed it materially (an instruction / secret / control char)
  return cleaned.length > 0 && cleaned === v.replace(/\s+/g, " ").trim().slice(0, max);
}

/** Validate one raw `{ metric, valueMs, at, source?, sessionId? }`. */
export function validateLatencySample(
  raw: unknown,
  fallbackNow: string,
): { readonly ok: true; readonly sample: BrainVoiceLatencySample } | { readonly ok: false; readonly reason: string } {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "not an object" };
  const r = raw as Record<string, unknown>;

  const metric = r.metric;
  if (typeof metric !== "string" || !BRAIN_LATENCY_METRICS.includes(metric as BrainLatencyMetric)) {
    return { ok: false, reason: `unknown metric ${JSON.stringify(metric)}` };
  }

  const valueMs = r.valueMs;
  if (typeof valueMs !== "number" || !Number.isFinite(valueMs)) {
    return { ok: false, reason: "valueMs is not a finite number" };
  }
  if (valueMs < 0) return { ok: false, reason: `negative latency (${valueMs})` };
  if (valueMs === 0) return { ok: false, reason: "zero latency — a sentinel, not a measurement" };
  if (valueMs > MAX_LATENCY_MS) return { ok: false, reason: `latency ${valueMs} ms exceeds the sane ceiling (${MAX_LATENCY_MS})` };

  let at = fallbackNow;
  if (r.at !== undefined) {
    if (typeof r.at !== "string" || !ISO_RE.test(r.at) || Number.isNaN(Date.parse(r.at))) {
      return { ok: false, reason: `invalid timestamp ${JSON.stringify(r.at)}` };
    }
    const sampleAtMs = Date.parse(r.at);
    const fallbackNowMs = Date.parse(fallbackNow);
    if (!Number.isNaN(fallbackNowMs) && sampleAtMs > fallbackNowMs + MAX_FUTURE_SKEW_MS) {
      return { ok: false, reason: `future timestamp ${JSON.stringify(r.at)}` };
    }
    at = r.at;
  }

  if (r.source !== undefined && !isCleanShortString(r.source, 40)) {
    return { ok: false, reason: "source carries unexpected / instruction-shaped text" };
  }
  if (r.sessionId !== undefined && !isCleanShortString(r.sessionId, 64)) {
    return { ok: false, reason: "sessionId carries unexpected / instruction-shaped text" };
  }

  return {
    ok: true,
    sample: {
      schemaVersion: brainVoiceLatencySchemaVersion,
      metric: metric as BrainLatencyMetric,
      valueMs: Math.round(valueMs),
      at,
      source: typeof r.source === "string" ? r.source : "unknown",
      ...(typeof r.sessionId === "string" ? { sessionId: r.sessionId } : {}),
    },
  };
}

/**
 * Pull latency samples out of a Voice Lab report JSON (the object the wake lab
 * page exports, or the Brain Console's lifecycle telemetry). UNTRUSTED — every
 * field is validated. Reads `lifecycle.lastCaptureMs` / `lastSttMs` /
 * `lastWakeToCaptureMs` and the report's `capturedAt` (or the injected `now`).
 * Also accepts an explicit `{ samples: [...] }` array.
 */
export function extractLatencySamples(report: unknown, opts: { readonly now: string; readonly source?: string }): BrainLatencyValidation {
  const valid: BrainVoiceLatencySample[] = [];
  const rejected: { reason: string; raw: string }[] = [];
  const source = opts.source && isCleanShortString(opts.source, 40) ? opts.source : "voice-lab";

  if (!report || typeof report !== "object") {
    return { valid, rejected: [{ reason: "report is not an object", raw: String(report).slice(0, 60) }] };
  }
  const r = report as Record<string, unknown>;

  // form 1 — an explicit samples array
  if (Array.isArray(r.samples)) {
    for (const raw of r.samples.slice(0, 5000)) {
      const v = validateLatencySample(raw, opts.now);
      if (v.ok) valid.push(v.sample);
      else rejected.push({ reason: v.reason, raw: JSON.stringify(raw).slice(0, 120) });
    }
    return { valid, rejected };
  }

  // form 2 — a Voice Lab / Brain Console report with a `lifecycle` block
  const lifecycle = (r.lifecycle ?? r) as Record<string, unknown>;
  const at =
    typeof r.capturedAt === "string" && ISO_RE.test(r.capturedAt) && !Number.isNaN(Date.parse(r.capturedAt))
      ? r.capturedAt
      : opts.now;

  const marks: [BrainLatencyMetric, unknown][] = [
    ["captureMs", lifecycle.lastCaptureMs],
    ["sttMs", lifecycle.lastSttMs],
    ["wakeToCaptureMs", lifecycle.lastWakeToCaptureMs],
  ];
  for (const [metric, value] of marks) {
    if (value === undefined || value === null) continue;
    const v = validateLatencySample({ metric, valueMs: value, at, source }, opts.now);
    if (v.ok) valid.push(v.sample);
    else if (value !== -1) rejected.push({ reason: `${metric}: ${v.reason}`, raw: String(value).slice(0, 60) });
  }

  // derived: a full turn = wake→capture-end + STT round-trip, when both present
  const wake = valid.find((s) => s.metric === "wakeToCaptureMs");
  const stt = valid.find((s) => s.metric === "sttMs");
  if (wake && stt) {
    const total = wake.valueMs + stt.valueMs;
    if (total > 0 && total <= MAX_LATENCY_MS) {
      valid.push({ schemaVersion: brainVoiceLatencySchemaVersion, metric: "totalTurnMs", valueMs: total, at, source });
    }
  }

  return { valid, rejected };
}

/* --------------------------------------------------------------- normalize */

export function normalizeLatencySamples(
  samples: readonly BrainVoiceLatencySample[],
  opts: { readonly maxCount?: number; readonly now?: string; readonly maxWindowMs?: number } = {},
): readonly BrainVoiceLatencySample[] {
  const maxCount = opts.maxCount ?? 4000;
  const parsedNow = opts.now === undefined ? undefined : Date.parse(opts.now);
  const hasValidNow = parsedNow !== undefined && !Number.isNaN(parsedNow);
  const cutoff = hasValidNow ? parsedNow - (opts.maxWindowMs ?? DEFAULT_MAX_WINDOW_MS) : -Infinity;
  const futureCutoff = hasValidNow ? parsedNow + MAX_FUTURE_SKEW_MS : Infinity;
  const seen = new Set<string>();
  const out: BrainVoiceLatencySample[] = [];
  for (const s of samples) {
    if (!BRAIN_LATENCY_METRICS.includes(s.metric)) continue;
    if (!Number.isFinite(s.valueMs) || s.valueMs <= 0 || s.valueMs > MAX_LATENCY_MS) continue;
    const t = Date.parse(s.at);
    if (Number.isNaN(t) || t < cutoff || t > futureCutoff) continue;
    const key = `${s.metric}|${s.at}|${s.valueMs}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...s, valueMs: Math.round(Math.min(MAX_LATENCY_MS, Math.max(1, s.valueMs))) });
  }
  out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.metric.localeCompare(b.metric)));
  return out.slice(-maxCount);
}

/* --------------------------------------------------------------- baseline */

export interface BrainLatencyBaselineEntry {
  readonly metric: BrainLatencyMetric;
  readonly medianMs: number;
  readonly p90Ms: number;
  readonly sampleCount: number;
  readonly windowStart: string;
  readonly windowEnd: string;
}

export interface BrainLatencyBaseline {
  readonly generatedAt: string;
  readonly entries: readonly BrainLatencyBaselineEntry[];
}

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

/** Median-of-N baseline per metric over the given samples. */
export function buildLatencyBaseline(
  samples: readonly BrainVoiceLatencySample[],
  opts: { readonly minSamples: number; readonly now: string },
): BrainLatencyBaseline {
  const entries: BrainLatencyBaselineEntry[] = [];
  for (const metric of BRAIN_LATENCY_METRICS) {
    const forMetric = samples.filter((s) => s.metric === metric).sort((a, b) => (a.at < b.at ? -1 : 1));
    if (forMetric.length < opts.minSamples) continue;
    const values = forMetric.map((s) => s.valueMs).sort((a, b) => a - b);
    entries.push({
      metric,
      medianMs: median(values),
      p90Ms: percentile(values, 0.9),
      sampleCount: forMetric.length,
      windowStart: forMetric[0].at,
      windowEnd: forMetric[forMetric.length - 1].at,
    });
  }
  return { generatedAt: opts.now, entries };
}

/* ------------------------------------------------------- trend + findings */

export type BrainLatencyTrend = "improving" | "stable" | "degrading" | "unknown";
export type BrainLatencyVerdict = "REGRESSION" | "STABLE" | "IMPROVED" | "UNKNOWN";

export interface BrainLatencyFinding {
  readonly metric: BrainLatencyMetric;
  readonly metricTr: string;
  readonly verdict: BrainLatencyVerdict;
  readonly trend: BrainLatencyTrend;
  readonly baselineMs: number | null;
  readonly currentMs: number | null;
  /** signed fraction — positive = slower after (worse). `null` when UNKNOWN. */
  readonly deltaPct: number | null;
  readonly baselineSamples: number;
  readonly recentSamples: number;
  readonly recentWindowMs: number;
  /** 0..1 — low when the sample counts are thin or the split is uneven. */
  readonly confidence: number;
  readonly evidence: readonly string[];
}

export interface BrainLatencyObservation {
  readonly generatedAt: string;
  readonly findings: readonly BrainLatencyFinding[];
  /** The worst finding (a REGRESSION first, else the most notable). `null` when everything is UNKNOWN/STABLE. */
  readonly headline: BrainLatencyFinding | null;
  readonly baseline: BrainLatencyBaseline;
  readonly totalSamples: number;
  readonly rejectedSamples: number;
}

export interface BrainLatencyConfig {
  readonly minBaselineSamples: number;
  readonly minRecentSamples: number;
  /** `>= this` slower than baseline (median) → REGRESSION. */
  readonly regressionPct: number;
  /** `>= this` faster than baseline → IMPROVED. */
  readonly improvementPct: number;
  /** Marks newer than `now - recentWindowMs` are "recent"; older are baseline. */
  readonly recentWindowMs: number;
  /** Marks older than this are ignored entirely. */
  readonly maxWindowMs: number;
}

export const DEFAULT_LATENCY_CONFIG: BrainLatencyConfig = Object.freeze({
  minBaselineSamples: 5,
  minRecentSamples: 3,
  regressionPct: 0.2,
  improvementPct: 0.15,
  recentWindowMs: 2 * 60 * 60 * 1000,
  maxWindowMs: DEFAULT_MAX_WINDOW_MS,
});

function trendFrom(deltaPct: number, cfg: BrainLatencyConfig): BrainLatencyTrend {
  if (deltaPct >= cfg.regressionPct) return "degrading";
  if (deltaPct <= -cfg.improvementPct) return "improving";
  return "stable";
}

/**
 * Split the samples for a metric into a baseline window (older) and a recent
 * window, and decide. `UNKNOWN` when either window is under-sampled — never a
 * fabricated regression.
 */
function findingFor(
  metric: BrainLatencyMetric,
  samples: readonly BrainVoiceLatencySample[],
  cfg: BrainLatencyConfig,
  now: string,
): BrainLatencyFinding {
  const nowMs = Date.parse(now);
  const forMetric = samples
    .filter((s) => s.metric === metric && nowMs - Date.parse(s.at) <= cfg.maxWindowMs)
    .sort((a, b) => (a.at < b.at ? -1 : 1));

  const recentCut = nowMs - cfg.recentWindowMs;
  let baseline = forMetric.filter((s) => Date.parse(s.at) < recentCut);
  let recent = forMetric.filter((s) => Date.parse(s.at) >= recentCut);

  // If nothing is "recent" by the time window but there is plenty of data,
  // fall back to a last-third / first-two-thirds split so a batch import still
  // produces a reading.
  if (recent.length < cfg.minRecentSamples && forMetric.length >= cfg.minBaselineSamples + cfg.minRecentSamples) {
    const splitAt = Math.floor(forMetric.length * 0.66);
    baseline = forMetric.slice(0, splitAt);
    recent = forMetric.slice(splitAt);
  }

  const base: Omit<BrainLatencyFinding, "verdict" | "trend" | "deltaPct" | "confidence" | "evidence" | "baselineMs" | "currentMs"> = {
    metric,
    metricTr: METRIC_TR[metric],
    baselineSamples: baseline.length,
    recentSamples: recent.length,
    recentWindowMs: cfg.recentWindowMs,
  };

  if (baseline.length < cfg.minBaselineSamples || recent.length < cfg.minRecentSamples) {
    return {
      ...base,
      verdict: "UNKNOWN",
      trend: "unknown",
      baselineMs: null,
      currentMs: null,
      deltaPct: null,
      confidence: 0,
      evidence: [
        `yeterli ölçüm yok (baz ${baseline.length}/${cfg.minBaselineSamples}, güncel ${recent.length}/${cfg.minRecentSamples}) — durum bilinmiyor`,
      ],
    };
  }

  const baselineMs = median([...baseline.map((s) => s.valueMs)].sort((a, b) => a - b));
  const currentMs = median([...recent.map((s) => s.valueMs)].sort((a, b) => a - b));
  const deltaPct = baselineMs === 0 ? 0 : Math.round(((currentMs - baselineMs) / baselineMs) * 1000) / 1000;
  const trend = trendFrom(deltaPct, cfg);

  const verdict: BrainLatencyVerdict =
    deltaPct >= cfg.regressionPct ? "REGRESSION" : deltaPct <= -cfg.improvementPct ? "IMPROVED" : "STABLE";

  // confidence: more samples + a balanced split + a bigger effect → higher.
  const nBonus = Math.min(1, (baseline.length + recent.length) / 40);
  const balance = 1 - Math.abs(baseline.length - recent.length) / (baseline.length + recent.length);
  const effect = Math.min(1, Math.abs(deltaPct) / (cfg.regressionPct * 2));
  const confidence = verdict === "STABLE" ? 0 : Math.round(Math.min(0.95, 0.35 * nBonus + 0.3 * balance + 0.35 * effect) * 100) / 100;

  const pct = `${deltaPct > 0 ? "+" : ""}${Math.round(deltaPct * 1000) / 10}%`;
  return {
    ...base,
    verdict,
    trend,
    baselineMs,
    currentMs,
    deltaPct,
    confidence,
    evidence: [
      `baz çizgi (medyan) ${baselineMs} ms · güncel (medyan) ${currentMs} ms · fark ${pct}`,
      `örnek: baz ${baseline.length} / güncel ${recent.length} · pencere ${Math.round(cfg.recentWindowMs / 60000)} dk`,
      `trend: ${trend}`,
    ],
  };
}

export function observeVoiceLatency(
  samples: readonly BrainVoiceLatencySample[],
  cfg: BrainLatencyConfig = DEFAULT_LATENCY_CONFIG,
  now: string = new Date().toISOString(),
  rejectedSamples = 0,
): BrainLatencyObservation {
  const normalized = normalizeLatencySamples(samples, { now, maxWindowMs: cfg.maxWindowMs });
  const findings = BRAIN_LATENCY_METRICS.map((m) => findingFor(m, normalized, cfg, now));
  const regressions = findings.filter((f) => f.verdict === "REGRESSION").sort((a, b) => (b.deltaPct ?? 0) - (a.deltaPct ?? 0));
  const notable = findings
    .filter((f) => f.verdict === "IMPROVED")
    .sort((a, b) => (a.deltaPct ?? 0) - (b.deltaPct ?? 0));
  const headline = regressions[0] ?? notable[0] ?? null;

  return {
    generatedAt: now,
    findings,
    headline,
    baseline: buildLatencyBaseline(normalized, { minSamples: cfg.minBaselineSamples, now }),
    totalSamples: normalized.length,
    rejectedSamples,
  };
}

/* --------------------------------------------------------------- incident */

/**
 * A CONFIDENT latency regression → a `performance` incident draft for the Report
 * Center chain. Low confidence → `UNKNOWN` classification (still opened so the
 * frequency is tracked, never a fabricated CRASH). Everything else → `null`
 * (no incident; the observation still shows in the Report Center's latency block).
 *
 * The incident carries NO patch and NO hypothesis — it is an OBSERVATION. The
 * self-heal loop only ever touches it if the operator runs `selfheal heal <id>`,
 * and voice/STT files are REVIEW_REQUIRED + NEVER_AUTO_APPLY, so it can never be
 * auto-applied regardless.
 */
export function buildLatencyIncident(obs: BrainLatencyObservation, now: string): BrainIncident | null {
  const f = obs.headline;
  if (!f || f.verdict !== "REGRESSION" || f.baselineMs == null || f.currentMs == null) return null;
  if (f.confidence < 0.4) return null;

  const classification = f.confidence >= 0.7 ? "REAL_INCIDENT" : "UNKNOWN";
  const severity = (f.deltaPct ?? 0) >= 0.5 ? "P1" : "P2";

  return buildBrainIncident({
    category: "performance",
    severity,
    classification,
    symptom: `Ses gecikmesi baz çizginin üzerine çıktı — ${f.metricTr}: ${f.baselineMs} ms → ${f.currentMs} ms (${
      f.deltaPct != null ? `${f.deltaPct > 0 ? "+" : ""}${Math.round(f.deltaPct * 1000) / 10}%` : "?"
    })`,
    now,
    evidence: [
      {
        at: now,
        source: "voice-latency-observer",
        note: sanitizeUntrustedNote(f.evidence.join("; "), 300),
        signals: {
          metric: f.metric,
          baselineMs: f.baselineMs,
          currentMs: f.currentMs,
          deltaPct: f.deltaPct,
          trend: f.trend,
          confidence: f.confidence,
          baselineSamples: f.baselineSamples,
          recentSamples: f.recentSamples,
          totalSamples: obs.totalSamples,
        },
      },
    ],
    dedupeKey: `perf:voice-latency:${f.metric}`,
  });
}

/** One plain-text line for the CLI + the spoken summary. */
export function describeLatencyObservation(obs: BrainLatencyObservation): string {
  if (!obs.headline) {
    const known = obs.findings.filter((f) => f.verdict !== "UNKNOWN");
    if (known.length === 0) return `ses gecikmesi: yeterli ölçüm yok (${obs.totalSamples} örnek) — durum bilinmiyor`;
    return `ses gecikmesi: sabit — ${known.map((f) => `${f.metric} ${f.currentMs ?? f.baselineMs} ms`).join(", ")}`;
  }
  const f = obs.headline;
  const pct = f.deltaPct != null ? `${f.deltaPct > 0 ? "+" : ""}${Math.round(f.deltaPct * 1000) / 10}%` : "?";
  return `ses gecikmesi ${f.verdict}: ${f.metricTr} ${f.baselineMs} ms → ${f.currentMs} ms (${pct}), güven ${f.confidence.toFixed(2)}, ${f.baselineSamples}+${f.recentSamples} örnek`;
}
