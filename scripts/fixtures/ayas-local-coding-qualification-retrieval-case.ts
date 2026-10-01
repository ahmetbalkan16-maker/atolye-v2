/** Additional host-only frozen case. The original five-case vault is untouched. */
import { parseAyasLocalCodingTaskContract } from "../../src/lib/brain/autonomy/AyasLocalCodingTaskContract";

export const AYAS_LOCAL_CODING_RETRIEVAL_CASE = Object.freeze({
  caseId: "historical-two-source-identity-retrieval", split: "PRIMARY", domain: "MEMORY_RETRIEVAL",
  taskId: "ayas-coding-22222222-3333-4444-8555-666666666666",
  baseHead: "4fc5b642850075ad00e882d83ab63e205a32b0cd",
  fixHead: "309c1fe0b0c5b576562996be9639a213b0821471",
  exactFiles: Object.freeze(["src/lib/ayas/memory/AyasMemoryRetrieval.ts", "src/lib/ayas/memory/AyasMemoryCandidate.ts"]),
  maxChangedLines: 80,
  objective: "Save explicit identity durably and retrieve current identity for name questions, refusing simultaneous conflicts and accepting later equally-trusted corrections; corrupt stores must degrade safely.",
  evaluatorScript: "scripts/smoke-ayas-memory.ts",
  evaluatorBlob: "7f621a3992d7fdf46f0e2eab8e4cfe34e1bfd82f",
});

export function projectAyasLocalCodingRetrievalTask() {
  const item = AYAS_LOCAL_CODING_RETRIEVAL_CASE;
  return parseAyasLocalCodingTaskContract({ schemaVersion: "1", taskId: item.taskId, baseHead: item.baseHead,
    objective: item.objective, exactFiles: item.exactFiles, maxChangedLines: item.maxChangedLines });
}
