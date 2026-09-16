import fs from "node:fs";
import path from "node:path";

import type { AyasDaemonCandidate, AyasDaemonObservation } from "./AyasAutonomyDaemon";
import { isAyasMutationKindRegistered, type AyasMutationImplementation } from "./AyasMutationRegistry";

/**
 * M16 — closed, server-owned, continuous-discovery candidate registry.
 *
 * Every entry pairs a fully-authored `AyasDaemonCandidate` (identical shape
 * to what a human would hand `AyasAutonomyDaemon.discover()` via
 * `scripts/ayas-propose.ts`) with a deterministic, read-only `isApplicable`
 * detector. A detector may only read the repo/observation it is given — it
 * never reads proposal text, never calls a model, never writes anything,
 * and a throwing detector is treated as "not applicable" (fail closed, not
 * fail open). `discoverAyasSafeCandidates` is the ONLY function this module
 * exposes for production use, and it does nothing but filter this static
 * list down to `AyasDaemonCandidate[]` — the actual proposal (and its
 * dedup) is still minted exclusively by the existing, unmodified
 * `AyasAutonomyDaemon.discover()`. This module never imports
 * `AyasApprovalInboxStore`, `AyasExecutionGateStore`, `AyasAutonomyDaemon`'s
 * `decide`/`executeApproved`, or any mutation `run()` — it is structurally
 * incapable of approving, reserving, executing, or opening a gate.
 */
export interface AyasDiscoveryContext {
  readonly repoRoot: string;
  readonly observation: AyasDaemonObservation;
}

export type AyasDiscoveryDetector = (context: AyasDiscoveryContext) => boolean;

export interface AyasDiscoverySource {
  readonly candidate: AyasDaemonCandidate;
  readonly isApplicable: AyasDiscoveryDetector;
}

/**
 * `second-safe-smoke-coverage-v1` — M16's second real, observer-discovered
 * candidate. `evaluateAyasMachineHealth`'s THROTTLE-on-missing-telemetry
 * branch (`AyasMachineHealthGuard.ts:15`) only requires `gpuPercent` when
 * `workload.stage` is GPU-likely; every existing call site (grep-verified
 * across `scripts/` and `src/`) exercises it with `stage: "video"` only, so
 * the non-GPU-stage half of that condition has zero test coverage. The
 * detector below is a plain, deterministic, read-only file-existence check
 * — no proposal text, no LLM judgment, no repo mutation.
 */
const SECOND_SAFE_SMOKE_COVERAGE_V1_CANDIDATE: AyasDaemonCandidate = {
  objective: "evaluateAyasMachineHealth'ın GPU dışı aşama davranışını test kapsamına al",
  currentProblem: "AyasMachineHealthGuard.ts'deki THROTTLE-on-missing-telemetry dalı, gpuPercent eksikliğini yalnızca GPU'ya bağımlı aşamalarda (visuals/animation/video/assembly) zorunlu tutuyor, ancak mevcut TÜM testler bu fonksiyonu yalnızca stage: \"video\" ile çağırıyor — koşulun diğer yarısı (GPU'ya bağımlı olmayan bir aşamada gpuPercent eksikliği) hiçbir testte doğrulanmıyor.",
  selectionReason: "Kaynak kodu doğrudan okunarak (AyasMachineHealthGuard.ts:15) GPU_LIKELY.has(workload.stage) koşulunun varlığı görüldü; scripts/ ve src/ genelinde grep ile evaluateAyasMachineHealth/guardAyasHeavyWorkload/assertAyasHeavyWorkloadAllowed çağrılarının TÜMÜNÜN stage: \"video\" kullandığı doğrulandı (AyasExecutionRevalidation.ts'in kendisi ise gerçek üretimde varsayılan olarak stage: \"script\" kullanıyor — yani bu dal üretimde fiilen çalışıyor ama hiç test edilmiyor).",
  expectedUserBenefit: "GPU_LIKELY korumasını kaldıran bir regresyon (ör. GPU dışı bir aşamayı, sadece GPU telemetrisi eksik diye gereksiz yere THROTTLE etmek) artık bir regresyon testiyle yakalanır; production revalidation gibi GPU dışı aşamaların gereksiz yere yavaşlatılması engellenir.",
  expectedBehaviorChange: "Yeni bir smoke test dosyası eklenir; mevcut hiçbir üretim/çalışma zamanı davranışı değişmez.",
  unchangedBehavior: "AyasMachineHealthGuard'ın karar mantığı, Machine Health değerlendirmesi ve tüm diğer AYAS davranışları birebir aynı kalır.",
  riskIfNotDone: "GPU'ya bağımlı olmayan aşamalarda (research/script/scenes/audio/thumbnail/seo/youtube/export) gpuPercent eksikliğinin yanlışlıkla THROTTLE'a yol açtığı bir regresyon fark edilmeden production'a girebilir.",
  technicalRisk: "Düşük; yalnızca yeni, izole bir test dosyası eklenir, mevcut hiçbir dosya değişmez.",
  productionImpact: "none",
  rationale: "AyasMachineHealthGuard.ts:15 satırındaki koşul yalnızca stage: \"video\" ile test ediliyor; scripts/smoke-ayas-machine-health.ts ve scripts/smoke-ayas-autonomous-foundation-acceptance.ts dahil hiçbir test dosyası GPU dışı bir aşamayla bu fonksiyonu çağırmıyor.",
  evidence: [
    "src/lib/ayas/machine/AyasMachineHealthGuard.ts:15 — GPU_LIKELY.has(workload.stage) koşulu",
    "grep: evaluateAyasMachineHealth/guardAyasHeavyWorkload/assertAyasHeavyWorkloadAllowed çağrılarının tümü stage: \"video\" veya (üretimde) stage: \"script\" kullanıyor, hiçbiri GPU dışı bir aşamayla bu spesifik dalı test etmiyor",
    "scripts/smoke-ayas-machine-health.ts ve scripts/smoke-ayas-autonomous-foundation-acceptance.ts: her ikisi de yalnızca stage: \"video\"",
  ],
  graphifyEvidence: ["AyasMachineHealthGuard.evaluateAyasMachineHealth has zero test coverage for a non-GPU-likely stage, confirmed via graphify update + grep across scripts/smoke-ayas-*.ts and src/"],
  exactFiles: ["scripts/smoke-ayas-machine-health-non-gpu-stage.ts"],
  expectedDiffScope: "Bir yeni dosya: scripts/smoke-ayas-machine-health-non-gpu-stage.ts (~35 satır, 36 test senaryosu)",
  testsPlanned: ["smoke-ayas-machine-health-non-gpu-stage"],
  risk: "low and reversible — test-only addition, zero product code touched",
  rank: 1,
  mutationKind: "second-safe-smoke-coverage-v1",
};

/**
 * Deliberately empty until now: this registry shipped the discovery
 * MECHANISM first (wiring, authority-boundary proofs, tests), then this one
 * real entry was added as its own separate, reviewed, source-driven change
 * — never populated dynamically, never derived from an LLM or from
 * proposal text. The detector only ever reads the filesystem.
 */
export const AYAS_DISCOVERY_SOURCES: readonly AyasDiscoverySource[] = [
  {
    candidate: SECOND_SAFE_SMOKE_COVERAGE_V1_CANDIDATE,
    isApplicable: ({ repoRoot }) => !fs.existsSync(path.join(repoRoot, "scripts", "smoke-ayas-machine-health-non-gpu-stage.ts")),
  },
];

/** `mutationRegistry` defaults to the one real, closed mutation registry; tests pass their own isolated map instead of ever depending on production registrations. */
export function discoverAyasSafeCandidates(
  context: AyasDiscoveryContext,
  sources: readonly AyasDiscoverySource[] = AYAS_DISCOVERY_SOURCES,
  mutationRegistry?: ReadonlyMap<string, AyasMutationImplementation>,
): readonly AyasDaemonCandidate[] {
  return sources
    .filter((source) => mutationRegistry ? isAyasMutationKindRegistered(source.candidate.mutationKind, mutationRegistry) : isAyasMutationKindRegistered(source.candidate.mutationKind))
    .filter((source) => {
      try {
        return source.isApplicable(context);
      } catch {
        return false;
      }
    })
    .map((source) => source.candidate);
}
