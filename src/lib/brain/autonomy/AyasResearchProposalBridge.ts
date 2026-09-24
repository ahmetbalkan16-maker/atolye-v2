import type { AyasDaemonCandidate } from "./AyasAutonomyDaemon";
import type { AyasInboxProposal } from "./AyasApprovalInboxStore";
import type { AyasExternalResearchFinding } from "./AyasExternalResearchStore";
import { neutralizeAyasUntrustedText } from "./AyasDeepAnalysis";
import { ayasFindingMayEnterDiscovery } from "./AyasResearchDisposition";
import { AYAS_RESEARCH_EXPERIMENT_PROPOSAL_MUTATION_KIND, verifyAyasExperimentEvidence, type AyasExperimentEvidence } from "./AyasResearchExperimentEvaluation";

/**
 * Converts only already-corroborated, already-classified research findings
 * into governed proposal candidates. The bridge deliberately declares an
 * UNREGISTERED mutation kind: research evidence can request a design review,
 * but can never become executable until a separate, committed generator and
 * validator are added to the closed mutation registry.
 */
export const AYAS_RESEARCH_ADAPTATION_PLAN_MUTATION_KIND = "research-adaptation-plan:v1";

const safeText = (value: string, max: number): string => neutralizeAyasUntrustedText(value).slice(0, max).trim();
const safeId = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120);

/**
 * Stage 8 gate for design-review proposals: given a finding, returns the
 * loop's evidence lines when a design review is the honest next step (a
 * measured gap without a registered experiment, or a real capability with no
 * local evaluator), or `null` when the loop found no local gap, a duplicate,
 * unsafe content, insufficient evidence, or has not finished measuring.
 */
export type AyasResearchDesignReviewGate = (finding: AyasExternalResearchFinding) => readonly string[] | null;

export function discoverAyasResearchProposalCandidates(
  findings: readonly AyasExternalResearchFinding[],
  existingProposals: readonly Pick<AyasInboxProposal, "sourceReference">[],
  designReviewGate?: AyasResearchDesignReviewGate,
): readonly AyasDaemonCandidate[] {
  const alreadyBridged = new Set(existingProposals.map((proposal) => proposal.sourceReference).filter((value): value is string => Boolean(value)));
  return findings
    .filter((finding) => finding.disposition !== undefined && ayasFindingMayEnterDiscovery(finding.disposition))
    .filter((finding) => !alreadyBridged.has(finding.findingId))
    .map((finding) => ({ finding, loopEvidence: designReviewGate ? designReviewGate(finding) : [] }))
    .filter((entry): entry is { finding: AyasExternalResearchFinding; loopEvidence: readonly string[] } => entry.loopEvidence !== null)
    .map(({ finding, loopEvidence }, index) => {
      const capability = safeText(finding.capability, 200);
      const problem = safeText(finding.problemSolved, 500);
      const gap = safeText(finding.atolyeGapNotes, 500);
      const planningFile = `docs/brain/proposals/research-${safeId(finding.findingId)}.md`;
      return {
        objective: `${capability} bulgusunu Atölye için bağımsız ve güvenli bir adaptasyon tasarımına dönüştür`,
        currentProblem: `${problem}${gap ? ` Atölye gap kanıtı: ${gap}` : ""}`,
        selectionReason: "Resmî kaynaktan gelen, yüksek güvenli, ücretsiz/açık ve mevcut bir Atölye alanındaki gerçek boşlukla corroborate edilmiş araştırma bulgusu.",
        expectedUserBenefit: "Değerli dış araştırma yalnız bilgi olarak kalmaz; sahibin görebildiği, kaynaklı ve yönetişim altında bir geliştirme kaydına dönüşür.",
        expectedBehaviorChange: "Bu aşama yalnız bağımsız adaptasyon tasarımını inceleme kuyruğuna alır; üretim kodu veya çalışma zamanı davranışı değişmez.",
        unchangedBehavior: "Owner approval, execution gate, mutation registry, production pipeline ve runtime authority sınırları değişmez.",
        riskIfNotDone: "Kanıtlı dış araştırma bulgusu kalıcı araştırma kaydında kalır fakat geliştirme yaşam döngüsüne hiç ulaşmaz.",
        technicalRisk: "Düşük; proposal non-executable ve fail-closed'dur. Ayrı bir kayıtlı generator/validator olmadan onay veya yürütme yoluna giremez.",
        productionImpact: "none — research-to-proposal planning record only",
        rationale: `Research finding ${finding.findingId}, ${finding.dispositionReason ?? "OFFICIAL_HIGH_CONFIDENCE_GAP"} nedeniyle proposal adayı olmaya hak kazandı.`,
        evidence: [`finding:${finding.findingId}`, `source:${finding.sourceUrl}`, `provider:${safeText(finding.provider, 120)}`, "treatedSourceAsUntrusted:true", ...loopEvidence],
        graphifyEvidence: [`category:${finding.category ?? "UNCLASSIFIED"}; adaptation planning targets a documentation artifact only; no authority or production edge is introduced`],
        exactFiles: [planningFile],
        expectedDiffScope: `Ayrı owner-reviewed tasarım/generator çalışması gerekirse yalnız ${planningFile} plan kaydıyla başlar; bu proposal kendi başına dosya yazamaz.`,
        testsPlanned: ["dedicated adaptation generator + validator required before execution eligibility"],
        risk: "low; non-executable research planning candidate",
        rank: 10_000 + index,
        mutationKind: AYAS_RESEARCH_ADAPTATION_PLAN_MUTATION_KIND,
        discoverySource: finding.researchMode === "LIGHT" ? "RESEARCH_LIGHT" : "RESEARCH_DEEP",
        sourceReference: finding.findingId,
      };
    });
}

export const AYAS_RESEARCH_EXPERIMENT_EVIDENCE_PREFIX = "experiment-evidence-sha256:";

/**
 * Stage 8 — the second, evidence-backed input of the same bridge. Only a
 * verified IMPROVED experiment measured at the CURRENT head may become a
 * proposal. Every field is built from server-owned registry text, ids and
 * measured numbers; no external research text reaches the proposal. The
 * mutation kind is unregistered, so the proposal enters the normal owner
 * flow but can never execute. Its evidence list binds the exact evidence
 * hash, so any change to the evidence yields a different proposal hash.
 */
export function discoverAyasResearchExperimentProposalCandidates(
  evidences: readonly { readonly evidence: AyasExperimentEvidence; readonly evidenceHash: string }[],
  existingProposals: readonly Pick<AyasInboxProposal, "sourceReference">[],
  currentHead: string,
): readonly AyasDaemonCandidate[] {
  const alreadyBridged = new Set(existingProposals.map((proposal) => proposal.sourceReference).filter((value): value is string => Boolean(value)));
  return evidences
    .filter(({ evidence, evidenceHash }) => verifyAyasExperimentEvidence(evidence, evidenceHash))
    .filter(({ evidence }) => evidence.verdict === "IMPROVED" && evidence.baseHead === currentHead && evidence.hypothesis.riskClass !== "FORBIDDEN_AUTONOMOUS")
    .filter(({ evidence }) => !alreadyBridged.has(evidence.experimentId))
    .slice(0, 5)
    .map(({ evidence, evidenceHash }, index) => {
      const h = evidence.hypothesis;
      const base = evidence.baseline && "passed" in evidence.baseline ? evidence.baseline : null;
      const after = evidence.experiment && "passed" in evidence.experiment ? evidence.experiment : null;
      const files = evidence.change?.files.map((file) => `${file.filePath} (+${file.addedLines}/-${file.removedLines})`).join(", ") ?? h.exactFiles.join(", ");
      return {
        objective: `${h.capability} için sandbox deneyinde ölçülmüş iyileştirmeyi sahip incelemesine sun`,
        currentProblem: `${h.benchmarkId} ${h.targetDimension} boyutunda ${h.targetCaseIds.length} hedef vaka ${evidence.baseHead.slice(0, 12)} üzerinde başarısızdı.`,
        selectionReason: "Araştırma bulgusu yerel ölçülebilir bir boşluğa eşlendi; eşleşmiş baseline ile yalıtılmış sandbox deneyi IMPROVED sonucu verdi ve hiçbir koruma ihlal edilmedi.",
        expectedUserBenefit: `${h.targetDimension} hedef vakalarında +${evidence.targetGain} düzeltme; yeni başarısız vaka yok, held-out değişimi ${evidence.regressions.heldOutDelta}.`,
        expectedBehaviorChange: h.expectedImprovement.statement,
        unchangedBehavior: "Owner approval, execution gate, mutation registry, runtime authority ve canlı veri değişmez; bu öneri kendi başına dosya yazamaz veya yürütülemez.",
        riskIfNotDone: "Ölçülmüş ve regresyonsuz bir iyileştirme kanıtı yalnız deney kaydında kalır.",
        technicalRisk: `${h.riskClass}; değişiklik ${h.exactFiles.length} dosya ve en fazla ${h.maxChangedLines} satırla sınırlı. Geri alma: uygulayan ayrı commit geri alınır; deney sandbox'ı zaten silindi.`,
        productionImpact: "none — research experiment evidence only; implementation requires a separate owner-reviewed change",
        rationale: `Experiment ${evidence.experimentId} (hypothesis ${h.hypothesisId}) verdict IMPROVED: ${base ? `${base.passed}/${base.caseCount}` : "?"} → ${after ? `${after.passed}/${after.caseCount}` : "?"}.`,
        evidence: [
          `experiment:${evidence.experimentId}`,
          `${AYAS_RESEARCH_EXPERIMENT_EVIDENCE_PREFIX}${evidenceHash}`,
          `hypothesis:${h.hypothesisId}`,
          ...evidence.findingIds.map((findingId) => `finding:${findingId}`),
          ...evidence.sourceIds.map((sourceId) => `source:${sourceId}`),
          `baseline:${base ? `${base.passed}/${base.caseCount}` : "missing"}`,
          `after:${after ? `${after.passed}/${after.caseCount}` : "missing"}`,
          `heldOutDelta:${evidence.regressions.heldOutDelta}`,
          `newlyFailing:${evidence.regressions.newlyFailingCaseIds.length}`,
          "treatedSourceAsUntrusted:true",
        ],
        graphifyEvidence: [`component:${h.component}; benchmark:${h.benchmarkId}; research evidence carries no mutation, approval or execution authority`],
        exactFiles: [...h.exactFiles],
        expectedDiffScope: `${files}; diff sha256 ${evidence.change?.diffSha256 ?? "none"}`,
        testsPlanned: [`benchmark:${h.benchmarkId}`, ...h.regressionSuites],
        risk: `${h.riskClass.toLowerCase()}; non-executable research experiment proposal`,
        rank: 20_000 + index,
        mutationKind: AYAS_RESEARCH_EXPERIMENT_PROPOSAL_MUTATION_KIND,
        discoverySource: "RESEARCH_DEEP",
        sourceReference: evidence.experimentId,
      };
    });
}
