import assert from "node:assert/strict";

import type { AyasInboxProposal } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import type { AyasExternalResearchFinding } from "../src/lib/brain/autonomy/AyasExternalResearchStore";
import { ayasResearchProposalTitle, discoverAyasResearchProposalCandidates } from "../src/lib/brain/autonomy/AyasResearchProposalBridge";
import { makeFinding } from "./fixtures/ayas-research-improvement-findings";

/**
 * Research proposals the owner can read and that survive code changes (2026-10-16). The heading names the tool, the
 * release and the source's verified words instead of the model's category word; a proposal that went STALE only
 * because the code moved on is offered again for a finding with a verified quote, while every owner decision and
 * every pre-quote finding stays final. Pure: no store, network or model.
 */
let count = 0;
const scenario = (name: string, fn: () => void): void => {
  try { fn(); } catch (error) { console.error(`FAIL: ${name}`); throw error; }
  count += 1;
};

const finding = (over: Partial<AyasExternalResearchFinding> = {}): AyasExternalResearchFinding => ({
  ...makeFinding({ category: "IMAGE_AI", capability: "EXPORT" }),
  provider: "ComfyUI", sourceUrl: "https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.40.0", evidenceQuote: "Implement the asset export API locally", ...over,
});
const proposal = (reference: string, status?: AyasInboxProposal["status"]) => ({ sourceReference: reference, ...(status ? { status } : {}) });

scenario("the heading names the tool, the release and the verified source words, not the model's category word", () => {
  assert.equal(ayasResearchProposalTitle(finding()), 'ComfyUI v0.40.0: "Implement the asset export API locally" — Atölye için uyarlama tasarımını incele', "assert.equal(ayasResearchProposalTitle(finding()), 'ComfyUI v0.40.0: \"Implement the asset export API locally\" — Atölye için uyarlama tasarımını incele')");
  assert.equal(ayasResearchProposalTitle(finding({ provider: "LangChain", sourceUrl: "https://github.com/langchain-ai/langchain/releases/tag/langchain-core%3D%3D1.6.11", evidenceQuote: undefined, capability: "TRANSCRIPTION" })),
    "LangChain langchain-core==1.6.11 — Atölye için uyarlama tasarımını incele", "no quote and a category word: only the tool and release");
  assert.equal(ayasResearchProposalTitle(finding({ releaseVersion: "0.40.5", provider: "Ollama", evidenceQuote: undefined, capability: "Tool calling for local models" })),
    "Ollama 0.40.5: Tool calling for local models — Atölye için uyarlama tasarımını incele", "a real capability name is kept; the recorded release wins over the URL tag");
  assert.equal(ayasResearchProposalTitle(finding({ provider: "", sourceUrl: "https://example.org/notes", evidenceQuote: undefined, capability: "AUDIO_AI" })),
    "AUDIO_AI bulgusunu Atölye için bağımsız ve güvenli bir adaptasyon tasarımına dönüştür", "nothing better to say: the earlier wording");
  assert.ok(ayasResearchProposalTitle(finding({ evidenceQuote: "x".repeat(400) })).length < 260, "the quote is bounded");
});

scenario("bridged candidates carry that heading", () => {
  const [candidate] = discoverAyasResearchProposalCandidates([finding()], []);
  assert.equal(candidate!.objective, ayasResearchProposalTitle(finding()), "assert.equal(candidate!.objective, ayasResearchProposalTitle(finding()))");
});

scenario("a quoted finding whose proposals all went STALE is offered again; any live or decided proposal keeps it bridged", () => {
  const f = finding();
  assert.equal(discoverAyasResearchProposalCandidates([f], [proposal(f.findingId, "STALE"), proposal(f.findingId, "STALE")]).length, 1, "assert.equal(discoverAyasResearchProposalCandidates([f], [proposal(f.findingId, \"STALE\"), proposal(f.findingId, \"STALE\")]).length, 1)");
  for (const status of ["PENDING", "APPROVED", "REJECTED", "COMPLETED", "RECOVERY_REQUIRED", "ABANDONED"] as const) {
    assert.equal(discoverAyasResearchProposalCandidates([f], [proposal(f.findingId, "STALE"), proposal(f.findingId, status)]).length, 0, status);
  }
  assert.equal(discoverAyasResearchProposalCandidates([f], [proposal(f.findingId)]).length, 0, "a caller that passes no status keeps the earlier rule");
});

scenario("an owner's APPROVE or REJECT stays final after its proposal went STALE; LATER asks again", () => {
  const f = finding();
  const staled = (id: string) => ({ ...proposal(f.findingId, "STALE"), proposalId: id });
  const history = [staled("p1"), staled("p2")];
  for (const decision of ["APPROVE", "REJECT"] as const) {
    assert.equal(discoverAyasResearchProposalCandidates([f], history, undefined, [{ proposalId: "p2", decision }]).length, 0, `${decision} on a proposal that later went STALE retires the finding`);
  }
  assert.equal(discoverAyasResearchProposalCandidates([f], history, undefined, [{ proposalId: "p2", decision: "LATER" }]).length, 1, "LATER is not a final decision");
  assert.equal(discoverAyasResearchProposalCandidates([f], history, undefined, [{ proposalId: "elsewhere", decision: "APPROVE" }]).length, 1, "a decision on another proposal does not retire this finding");
  assert.equal(discoverAyasResearchProposalCandidates([f], [proposal(f.findingId, "STALE")], undefined, [{ proposalId: "p1", decision: "APPROVE" }]).length, 1, "a proposal without an id cannot be matched to a decision");
});

scenario("a finding without a verified quote (before 2026-10-15) is bridged once and never comes back after going STALE", () => {
  const old = finding({ evidenceQuote: undefined, capability: "AUDIO_AI" });
  assert.equal(discoverAyasResearchProposalCandidates([old], []).length, 1, "assert.equal(discoverAyasResearchProposalCandidates([old], []).length, 1)");
  assert.equal(discoverAyasResearchProposalCandidates([old], [proposal(old.findingId, "STALE")]).length, 0, "assert.equal(discoverAyasResearchProposalCandidates([old], [proposal(old.findingId, \"STALE\")]).length, 0)");
});

scenario("the design-review gate still decides: a finding it refuses is not offered, stale or not", () => {
  const f = finding();
  assert.equal(discoverAyasResearchProposalCandidates([f], [proposal(f.findingId, "STALE")], () => null).length, 0, "assert.equal(discoverAyasResearchProposalCandidates([f], [proposal(f.findingId, \"STALE\")], () => null).length, 0)");
  const [candidate] = discoverAyasResearchProposalCandidates([f], [proposal(f.findingId, "STALE")], () => ["loop:gap-measured"]);
  assert.ok(candidate!.evidence.includes("loop:gap-measured"), "assert.ok(candidate!.evidence.includes(\"loop:gap-measured\"))");
  assert.equal(candidate!.sourceReference, f.findingId, "assert.equal(candidate!.sourceReference, f.findingId)");
});

console.log(JSON.stringify({ status: "PASS", suite: "ayas-research-proposal-bridge", scenarios: count, modelRuns: 0, networkCalls: 0 }));
