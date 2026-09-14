import { runAyasReadOnlyAction } from "./AyasActionRuntime";

export interface AyasFaultCandidate { readonly filePath: string; readonly score: number; readonly anchors: readonly string[]; }
export type AyasFaultLocalization =
  | { readonly status: "located"; readonly anchors: readonly string[]; readonly candidate: AyasFaultCandidate; readonly alternatives: readonly AyasFaultCandidate[] }
  | { readonly status: "ambiguous"; readonly anchors: readonly string[]; readonly candidates: readonly AyasFaultCandidate[]; readonly clarification: string }
  | { readonly status: "insufficient"; readonly anchors: readonly string[] };

const SAFE_PATH = /\b(?:src|scripts|app)\/[A-Za-z0-9_.\-/]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md)(?::\d+(?::\d+)?)?/gu;
const IDENTIFIER = /\b(?:[A-Z][A-Z0-9_]{4,}|[A-Z][A-Za-z0-9]+(?:Error|Provider|Manager|Pipeline)|(?:validate|build|create|resolve|run|inspect)[A-Z][A-Za-z0-9]{2,})\b/gu;
const TEST_NAME = /\bsmoke-[a-z0-9-]{3,}\b/giu;
const SUBSYSTEM_ANCHORS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  assembly: ["VIDEO_ASSEMBLY_FAILED", "validateProbe", "VideoAssemblyManager"],
  video: ["VideoPipeline", "FFmpegVideoAssemblyProvider"],
  audio: ["AudioPipeline", "AudioManager"],
  thumbnail: ["ThumbnailPipeline"],
  youtube: ["YouTubePackagePipeline"],
  memory: ["AyasMemoryStore"],
  reasoning: ["AyasReasoningCore"],
});

/** Deterministic bounded fault localization. It has no write or shell surface. */
export async function localizeAyasFault(text: string, requestedBy: string): Promise<AyasFaultLocalization> {
  if (text.length > 8_000 || !/(hata|error|failed|exception|mismatch|çöktü|çalışmıyor)/iu.test(text)) return { status: "insufficient", anchors: [] };
  const explicitPaths = [...text.matchAll(SAFE_PATH)].map((match) => match[0]!.replace(/:\d+(?::\d+)?$/u, ""));
  const identifiers = [...text.matchAll(IDENTIFIER), ...text.matchAll(TEST_NAME)].map((match) => match[0]!);
  const lower = text.toLowerCase();
  const matchedSubsystems = Object.keys(SUBSYSTEM_ANCHORS).filter((key) => lower.includes(key));
  const subsystem = matchedSubsystems.flatMap((key) => SUBSYSTEM_ANCHORS[key] ?? []);
  const anchors = [...new Set([...identifiers, ...subsystem])].slice(0, 6);
  const scores = new Map<string, { score: number; anchors: Set<string> }>();
  for (const filePath of explicitPaths.slice(0, 2)) {
    const inspected = await runAyasReadOnlyAction({ rawRequest: { schemaVersion: "1", action: "inspect-source-file", requestedBy, intent: "stack path validation", plan: { filePath } } });
    if (inspected.executed && inspected.result.data.exists === true) scores.set(filePath, { score: 100, anchors: new Set(["stack-path"]) });
  }
  for (let index = 0; index < anchors.length; index++) {
    const anchor = anchors[index]!;
    const outcome = await runAyasReadOnlyAction({ rawRequest: { schemaVersion: "1", action: "search-project-source", requestedBy, intent: "fault localization", plan: { query: anchor } } });
    if (!outcome.executed || !Array.isArray(outcome.result.data.results)) continue;
    for (const item of outcome.result.data.results as Array<{ filePath?: unknown }>) {
      if (typeof item.filePath !== "string") continue;
      const current = scores.get(item.filePath) ?? { score: 0, anchors: new Set<string>() };
      current.score += Math.max(5, 30 - index * 3); current.anchors.add(anchor); scores.set(item.filePath, current);
    }
  }
  const candidates = [...scores.entries()].map(([filePath, value]) => ({ filePath, score: value.score + value.anchors.size * 10, anchors: [...value.anchors] })).sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath)).slice(0, 8);
  if (candidates.length === 0) return { status: "insufficient", anchors };
  const first = candidates[0]!; const second = candidates[1];
  if (matchedSubsystems.length > 1 && second && first.score < second.score + 40) return { status: "ambiguous", anchors, candidates: candidates.slice(0, 4), clarification: "Hata birden fazla kod akışına uyuyor. Hangi işlem sırasında çıktı: hazırlık aşamasında mı, gerçek çıktı oluşturulurken mi?" };
  if (first.score >= 90 || first.anchors.length >= 2 || !second || first.score >= second.score + 20) return { status: "located", anchors, candidate: first, alternatives: candidates.slice(1, 4) };
  return { status: "ambiguous", anchors, candidates: candidates.slice(0, 4), clarification: "Hata birden fazla kod akışına uyuyor. Hangi işlem sırasında çıktı: hazırlık aşamasında mı, gerçek çıktı oluşturulurken mi?" };
}
