import { parseAyasLocalCodingTaskContract, type AyasLocalCodingTaskContract } from "../../src/lib/brain/autonomy/AyasLocalCodingTaskContract";

/** Host-side frozen history. Never copy this vault or its evaluator into a model workspace. */
export interface AyasLocalCodingQualificationCase {
  readonly caseId: string;
  readonly split: "PRIMARY" | "HELD_OUT";
  readonly domain: "MEMORY_TEMPORAL" | "SECURITY" | "UI" | "GRAPHIFY";
  readonly taskId: string;
  readonly baseHead: string;
  readonly fixHead: string;
  readonly objective: string;
  readonly exactFiles: readonly string[];
  readonly maxChangedLines: number;
  readonly evaluatorScript: string;
  readonly evaluatorBlob: string;
}

const source = "src/lib/ayas/memory/AyasMemoryTemporal.ts";
export const AYAS_LOCAL_CODING_QUALIFICATION_VAULT: readonly AyasLocalCodingQualificationCase[] = Object.freeze([
  Object.freeze({
    caseId: "historical-explicit-computer-plan", split: "PRIMARY", domain: "MEMORY_TEMPORAL",
    taskId: "ayas-coding-11111111-2222-3333-4444-555555555555",
    baseHead: "747c6d292f599fec1bab1f00fe1d36037cc73851",
    fixHead: "9e51840c2645447e3b8ee18d9277c209ffa4b852",
    objective: "Explicit computer purchase decisions must supersede earlier explicit plans without retyping unrelated free text.",
    exactFiles: Object.freeze([source]), maxChangedLines: 80,
    evaluatorScript: "scripts/smoke-ayas-memory-temporal.ts",
    evaluatorBlob: "39c786bc544fa9c706ccf3139e8e967ad71ec369",
  }),
  Object.freeze({
    caseId: "heldout-render-tool-supersession", split: "HELD_OUT", domain: "MEMORY_TEMPORAL",
    taskId: "ayas-coding-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    baseHead: "71f554eb72e6f5aaafb272f31bff402664f602cc",
    fixHead: "3367d415b12a6214a7f58fb95d6d849ccd0cd66a",
    objective: "A later explicit render-tool decision must be current while the earlier decision stays available as history without rewriting records.",
    exactFiles: Object.freeze([source]), maxChangedLines: 80,
    evaluatorScript: "scripts/smoke-ayas-stage15-7-temporal-acceptance.ts",
    evaluatorBlob: "2934d7402abdc048e02e6ce95d54fc98eeb49e78",
  }),
  Object.freeze({
    caseId: "historical-atomic-bounded-write", split: "PRIMARY", domain: "SECURITY",
    taskId: "ayas-coding-99999999-8888-7777-6666-555555555555",
    baseHead: "2397edf0b55233d101668657f1451e37c5334fdf",
    fixHead: "1c1ab791411df904b904d52b26b6415da89b8f05",
    objective: "When a second bounded file update fails, the first file must be restored, and allowed paths must not escape the repository.",
    exactFiles: Object.freeze(["src/lib/brain/autonomy/AyasBoundedFileWrite.ts"]), maxChangedLines: 80,
    evaluatorScript: "scripts/smoke-ayas-bounded-file-write.ts",
    evaluatorBlob: "70df46f3c7a474a449c78e2c8f2f0da3383beebc",
  }),
  Object.freeze({
    caseId: "historical-daily-development-view", split: "PRIMARY", domain: "UI",
    taskId: "ayas-coding-12345678-1234-4234-8234-123456789abc",
    baseHead: "ce6652beb3d845f29132264265e5a1342292fb93",
    fixHead: "2a13c348c75aabc3e839a51bfad75124167750d1",
    objective: "Keep the development center's daily proposal view focused on today's records while older action-required proposals remain visible.",
    exactFiles: Object.freeze(["src/lib/brain/autonomy/AyasApprovalInboxView.ts"]), maxChangedLines: 80,
    evaluatorScript: "scripts/smoke-ayas-development-center.ts",
    evaluatorBlob: "6ff859f5996ea8623f823a5f7986296c5e965adb",
  }),
  Object.freeze({
    caseId: "historical-windows-graphify-launch", split: "PRIMARY", domain: "GRAPHIFY",
    taskId: "ayas-coding-abcdef01-2345-4234-8234-abcdef012345",
    baseHead: "88d662eaf4534b668159639a7195b7bd761bf430",
    fixHead: "0e54633ff36a32d1620fb7ef423049b6712d25dc",
    objective: "Launch the fixed local Graphify refresh command on Windows and preserve failure reporting when that command fails.",
    exactFiles: Object.freeze(["src/lib/brain/autonomy/AyasPostPublicationClosure.ts"]), maxChangedLines: 80,
    evaluatorScript: "scripts/smoke-ayas-post-publication-closure-windows-launcher.ts",
    evaluatorBlob: "58c7d098272f6d7d83c1b78ca4b8940839fdbc5b",
  }),
]);

/** Only this bounded request may be passed to a local coding model. */
export function projectAyasLocalCodingQualificationTask(item: AyasLocalCodingQualificationCase): AyasLocalCodingTaskContract {
  return parseAyasLocalCodingTaskContract({
    schemaVersion: "1", taskId: item.taskId, baseHead: item.baseHead,
    objective: item.objective, exactFiles: item.exactFiles, maxChangedLines: item.maxChangedLines,
  });
}
