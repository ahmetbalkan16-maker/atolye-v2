import type { AyasDaemonCandidate } from "./AyasAutonomyDaemon";
import type { AyasInboxProposal } from "./AyasApprovalInboxStore";
import type { AyasExternalResearchFinding } from "./AyasExternalResearchStore";
import { neutralizeAyasUntrustedText } from "./AyasDeepAnalysis";
import { ayasFindingMayEnterDiscovery } from "./AyasResearchDisposition";

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

export function discoverAyasResearchProposalCandidates(
  findings: readonly AyasExternalResearchFinding[],
  existingProposals: readonly Pick<AyasInboxProposal, "sourceReference">[],
): readonly AyasDaemonCandidate[] {
  const alreadyBridged = new Set(existingProposals.map((proposal) => proposal.sourceReference).filter((value): value is string => Boolean(value)));
  return findings
    .filter((finding) => finding.disposition !== undefined && ayasFindingMayEnterDiscovery(finding.disposition))
    .filter((finding) => !alreadyBridged.has(finding.findingId))
    .map((finding, index) => {
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
        evidence: [`finding:${finding.findingId}`, `source:${finding.sourceUrl}`, `provider:${safeText(finding.provider, 120)}`, "treatedSourceAsUntrusted:true"],
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
