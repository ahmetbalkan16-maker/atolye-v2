import crypto from "node:crypto";

/** Developer eval evidence, never an execution, promotion or approval authority. */
export interface AyasEvalPin { readonly file: string; readonly sha256: string; }
export interface AyasEvalSuite {
  readonly id: string;
  readonly kind: "CAPABILITY" | "REGRESSION" | "FROZEN_HELD_OUT";
  readonly script: string;
  readonly args: readonly string[];
  readonly grading: "EXIT_STATUS" | "COGNITIVE_REPORT" | "DEVELOPER_REPORT";
  readonly pins: readonly AyasEvalPin[];
  readonly slices: readonly string[];
}
export interface AyasEvalManifest {
  readonly schemaVersion: "1";
  readonly version: string;
  readonly definitionReview: "SOURCE_REVIEWED_OWNER_CALIBRATION_PENDING";
  readonly modelGrader: "NONE";
  readonly suites: readonly AyasEvalSuite[];
  readonly excluded: readonly { readonly scope: string; readonly reason: string }[];
}
export interface AyasEvalTrial {
  readonly outcome: "PASS" | "PASS_WITH_KNOWN_LIMITATIONS" | "FAIL" | "NOT_RUN";
  readonly durationMs: number;
  readonly stdoutDigest: string;
  readonly stderrDigest: string;
  readonly exitCode: number | null;
  readonly quality?: { readonly passed: number; readonly total: number; readonly heldOutPassed: number; readonly heldOutTotal: number; readonly knownLimitations: readonly string[] };
}
const HASH = /^[a-f0-9]{64}$/;
const SCRIPT = /^scripts\/smoke-ayas-[a-z0-9-]+\.ts$/;
const PIN = /^scripts\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.tsx?$/;
const plain = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const exact = (x: Record<string, unknown>, keys: readonly string[]) => Object.keys(x).length === keys.length && keys.every((k) => Object.hasOwn(x, k));

export function isAyasEvalManifest(raw: unknown): raw is AyasEvalManifest {
  if (!plain(raw) || !exact(raw, ["schemaVersion", "version", "definitionReview", "modelGrader", "suites", "excluded"]) || raw.schemaVersion !== "1" ||
      typeof raw.version !== "string" || !/^15F\.4-v[1-9][0-9]*$/.test(raw.version) || raw.definitionReview !== "SOURCE_REVIEWED_OWNER_CALIBRATION_PENDING" || raw.modelGrader !== "NONE" ||
      !Array.isArray(raw.suites) || raw.suites.length === 0 || raw.suites.length > 250 || !Array.isArray(raw.excluded)) return false;
  const seen = new Set<string>();
  for (const suite of raw.suites) {
    if (!plain(suite) || !exact(suite, ["id", "kind", "script", "args", "grading", "pins", "slices"]) || typeof suite.id !== "string" || !/^[a-z0-9-]{2,90}$/.test(suite.id) || seen.has(suite.id) ||
        !["CAPABILITY", "REGRESSION", "FROZEN_HELD_OUT"].includes(String(suite.kind)) || typeof suite.script !== "string" || !SCRIPT.test(suite.script) ||
        !Array.isArray(suite.args) || suite.args.length > 1 || suite.args.some((arg) => arg !== "--gate") || !["EXIT_STATUS", "COGNITIVE_REPORT", "DEVELOPER_REPORT"].includes(String(suite.grading)) ||
        !Array.isArray(suite.pins) || !suite.pins.length || suite.pins.length > 30 || !Array.isArray(suite.slices) || !suite.slices.every((s) => typeof s === "string" && /^[a-z0-9-]{2,80}$/.test(s))) return false;
    seen.add(suite.id); const files = new Set<string>();
    for (const pin of suite.pins) {
      if (!plain(pin) || !exact(pin, ["file", "sha256"]) || typeof pin.file !== "string" || !PIN.test(pin.file) || files.has(pin.file) || typeof pin.sha256 !== "string" || !HASH.test(pin.sha256)) return false;
      files.add(pin.file);
    }
    if (!files.has(suite.script)) return false;
  }
  return raw.excluded.every((e) => plain(e) && exact(e, ["scope", "reason"]) && typeof e.scope === "string" && typeof e.reason === "string" && e.scope.length <= 120 && e.reason.length <= 500);
}

/** Every script/grader/fixture identity must match before and after the run. */
export function verifyAyasEvalPins(manifest: AyasEvalManifest, read: (file: string) => Uint8Array): readonly string[] {
  if (!isAyasEvalManifest(manifest)) return ["MANIFEST_INVALID"];
  const failures = new Set<string>();
  for (const suite of manifest.suites) for (const pin of suite.pins) {
    try { if (crypto.createHash("sha256").update(read(pin.file)).digest("hex") !== pin.sha256) failures.add(pin.file); }
    catch { failures.add(pin.file); }
  }
  return [...failures].sort();
}

/** Exit success alone cannot hide missing/failed deterministic grader reports. */
export function gradeAyasEvalTrial(suite: AyasEvalSuite, input: { readonly exitCode: number | null; readonly stdout: string; readonly stderr: string; readonly durationMs: number }): AyasEvalTrial {
  const digest = (text: string) => crypto.createHash("sha256").update(text).digest("hex");
  const base = { durationMs: Math.max(0, Math.round(input.durationMs)), stdoutDigest: digest(input.stdout), stderrDigest: digest(input.stderr), exitCode: input.exitCode };
  if (input.exitCode !== 0) return { ...base, outcome: "FAIL" };
  if (suite.grading === "EXIT_STATUS") return { ...base, outcome: "PASS" };
  if (suite.grading === "DEVELOPER_REPORT") {
    try {
      const report: unknown = JSON.parse(input.stdout.slice(input.stdout.indexOf("{"), input.stdout.lastIndexOf("}") + 1));
      if (!plain(report) || !plain(report.flow) || !plain(report.components) || !Object.keys(report.components).length) return { ...base, outcome: "FAIL" };
      const ratio = (value: unknown): readonly [number, number] | null => { const match = typeof value === "string" ? /^(\d+)\/(\d+)$/.exec(value) : null;
        return match && Number(match[2]) > 0 && Number(match[1]) === Number(match[2]) ? [Number(match[1]), Number(match[2])] : null; };
      const main = ratio(report.flow.mainPass); const held = ratio(report.flow.heldOut);
      if (!main || !held || !ratio(report.componentHeldOut) || !ratio(report.integration) || !Object.values(report.components).every((v) => ratio(v))) return { ...base, outcome: "FAIL" };
      return { ...base, outcome: "PASS", quality: { passed: main[0] + held[0], total: main[1] + held[1], heldOutPassed: held[0], heldOutTotal: held[1], knownLimitations: [] } };
    } catch { return { ...base, outcome: "FAIL" }; }
  }
  let r: Record<string, unknown> | undefined;
  for (const line of input.stdout.split("\n")) { try { const parsed: unknown = JSON.parse(line); if (plain(parsed) && Object.hasOwn(parsed, "unexpectedFailures")) r = parsed; } catch { /* Other stdout is not a grader report. */ } }
  if (!r || !Array.isArray(r.unexpectedFailures) || r.unexpectedFailures.length || !Array.isArray(r.knownLimitations) || !Array.isArray(r.failures) || r.failures.length !== r.knownLimitations.length ||
      !Number.isSafeInteger(r.caseCount) || Number(r.caseCount) < 1 || !Number.isSafeInteger(r.passed) || Number(r.passed) < 0 || Number(r.passed) + r.knownLimitations.length !== r.caseCount ||
      !plain(r.heldOut) || !Number.isSafeInteger(r.heldOut.passed) || !Number.isSafeInteger(r.heldOut.total) || Number(r.heldOut.passed) < 0 || Number(r.heldOut.passed) > Number(r.heldOut.total)) return { ...base, outcome: "FAIL" };
  const ids = r.knownLimitations.map((f) => plain(f) && typeof f.id === "string" && /^[a-z0-9-]{2,90}$/.test(f.id) && f.knownLimitation === true && f.error === false ? f.id : null);
  if (ids.some((id) => id === null) || new Set(ids).size !== ids.length) return { ...base, outcome: "FAIL" };
  return { ...base, outcome: ids.length ? "PASS_WITH_KNOWN_LIMITATIONS" : "PASS", quality: { passed: Number(r.passed), total: Number(r.caseCount), heldOutPassed: Number(r.heldOut.passed), heldOutTotal: Number(r.heldOut.total), knownLimitations: ids as string[] } };
}

/** Empirical suite-level pass@1 and pass^k; no independence estimate or model promotion. */
export function summarizeAyasEvalTrials(trials: readonly AyasEvalTrial[], k: number) {
  if (!Number.isSafeInteger(k) || k < 1 || k > 3) throw new Error("AYAS_EVAL_TRIAL_BOUND_INVALID");
  const pass = (t: AyasEvalTrial) => t.outcome === "PASS" || t.outcome === "PASS_WITH_KNOWN_LIMITATIONS";
  const completed = trials.length === k && trials.every((t) => t.outcome !== "NOT_RUN");
  return { trials: trials.length, requiredTrials: k, passAt1: trials.length && trials[0]!.outcome !== "NOT_RUN" ? Number(pass(trials[0]!)) : null,
    passPowerK: completed ? Number(trials.every(pass)) : null, rawQualityPassedAllTrials: completed ? trials.every((t) => t.outcome === "PASS") : null,
    status: !completed ? "NOT_RUN" : trials.some((t) => t.outcome === "FAIL") ? "FAIL" : trials.some((t) => t.outcome === "PASS_WITH_KNOWN_LIMITATIONS") ? "PASS_WITH_KNOWN_LIMITATIONS" : "PASS" };
}
