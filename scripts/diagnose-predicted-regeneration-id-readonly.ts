import { sha256, canonicalRegenerationJson } from "../src/lib/pipeline/PipelineStageRegenerationStore";

const regenerationId = "pipeline-regen-" + sha256(canonicalRegenerationJson({
  projectSlug: "i-stanbul-un-fethi-1453",
  projectId: "6813e662-5523-483f-b94d-5e09f64c3ffd",
  fromStage: "animation",
  generationOrdinal: 3,
  planFingerprint: "4b180356340160a35c3b98c23519ac6ba8838fe0afd02a2901a67d599d335342",
  reasonCode: "ANIMATION_QUALITY_REMEDIATION",
})).slice(0, 48);

console.log("predicted regenerationId:", regenerationId);
