/**
 * Synthetic smoke-test source texts for the Stage 10 test-safety classifier.
 * Data only: nothing here is executed. Kept out of the evaluator so the
 * evaluator's own source is classified by what it actually does.
 */
export const PURE_SOURCE = "/** Pure evaluator. No network, storage or dispatch. */\nimport assert from \"node:assert/strict\";\nimport { x } from \"../src/lib/ayas/developer/AyasDeveloperTaskModel\";\nassert.ok(x);";
export const CANONICAL_ISOLATED_SOURCE = "import { withCanonicalSmokeRuntime } from \"./lib/CanonicalSmokeRuntime\";\nimport { ProjectWriter } from \"../src/lib/projects/ProjectWriter\";\nprocess.env.ATOLYE_WORKSPACE_ROOT = fs.mkdtempSync(os.tmpdir());\nawait withCanonicalSmokeRuntime({ name: \"x\" }, async () => {});";
export const SCHEDULED_TASK_SOURCE = "execFileSync(PS, [\"Register-ScheduledTask\"]);";
export const RUNTIME_ROOT_NO_TEMP_SOURCE = "import { createRuntimeStorageContext } from \"../src/lib/runtime/RuntimeStoragePaths\";\nprocess.env.ATOLYE_RUNTIME_ROOT = x;";

export const SAFETY_SOURCES = {
  canonicalLegacyLive: "await withCanonicalSmokeRuntime({ name: 'x' }, async () => { new ProjectWriter(); });",
  writesWithoutTemp: "fs.writeFileSync('out.json', '{}');",
  projectWriterNoRoots: "import { ProjectWriter } from '../src/lib/projects/ProjectWriter';",
  externalNetwork: "await fetch('https://api.example.com/v1');",
  paidProvider: "process.env.OPENAI_API_KEY; process.env.AI_PROVIDER = 'openai';",
  brainStoreLive: "import { x } from '../src/lib/brain/autonomy/AyasApprovalInboxStore';",
  brainStoreTemp: "import { x } from '../src/lib/brain/autonomy/AyasApprovalInboxStore';\nconst rootDir = fs.mkdtempSync(os.tmpdir()); x({ rootDir: rootDir });",
  runtimeRootNoTemp: "process.env.ATOLYE_RUNTIME_ROOT = 'D:/runtime';",
  scheduledTaskUnregistered: "execFileSync('schtasks', ['/Query']);",
  brainRootModule: "import { BrainOrchestrator } from '../src/lib/brain/BrainOrchestrator';\nconst d = fs.mkdtempSync(os.tmpdir());",
  heldOutLocalhostServer: "const d = fs.mkdtempSync(os.tmpdir()); await fetch('http://127.0.0.1:4010/x'); fs.writeFileSync(path.join(d, 'a'), 'b');",
  heldOutLiveDispatch: "spawnSync(\"codex\", [\"exec\", \"fix\"]);",
} as const;
