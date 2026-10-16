/**
 * Design-review proposal kinds (owner request 2026-10-16): proposals whose whole
 * purpose is for the owner to read and decide, never to execute. Their mutation
 * kinds are deliberately UNREGISTERED (`AyasResearchProposalBridge`,
 * `AyasEvolutionIntegration`), so an owner APPROVE only records a decision.
 *
 * Dependency-free on purpose: imported by the internal review, the read-only
 * inbox view and the "use client" Gelişim Merkezi component alike. The literals
 * mirror the producers' exported constants; a smoke compares them.
 */
export const AYAS_DESIGN_REVIEW_MUTATION_KINDS: readonly string[] = Object.freeze([
  "research-adaptation-plan:v1",
  "evolution-opportunity-plan:v1",
]);

export function isAyasDesignReviewMutationKind(mutationKind: string | undefined | null): boolean {
  return typeof mutationKind === "string" && AYAS_DESIGN_REVIEW_MUTATION_KINDS.includes(mutationKind);
}
