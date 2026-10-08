import type { AyasGoldenVault } from "./AyasGoldenVault";

/**
 * Stage 15O — the golden vault, the versions of record.
 *
 * Every version ever published stays here, oldest first, each chained to the
 * one before it by digest. The last one is the vault. Changing it is a reviewed
 * source change: a new version is appended, nothing is edited in place, and a
 * case that leaves is named in `AYAS_GOLDEN_VAULT_RETIRED` with the reason.
 * `scripts/ayas-golden-vault.ts --draft-next` prints the next version with
 * current pins; it writes nothing.
 *
 * Data only: no filesystem, no clock, no network, no import beyond a type.
 */
const VERSION_1: AyasGoldenVault = {
  schemaVersion: "1",
  version: 1,
  previousDigest: null,
  cases: [
    {
      id: "golden.conversation.quality-master", domain: "CONVERSATION", script: "scripts/smoke-ayas-conversation-quality-master.ts",
      covers: "Conversation behaviour contracts: referent choice, context authority, memory selection, clarification policy, prompt restraint and stream finalization.",
      pins: [
        { file: "scripts/smoke-ayas-conversation-quality-master.ts", sha256: "b79d6a839027a4e35d416e96ce9f1ebbfa087d2e807f6f95a31b9c5d0078ec6d" },
      ],
    },
    {
      id: "golden.conversation.chat-quality", domain: "CONVERSATION", script: "scripts/smoke-ayas-chat-quality.ts",
      covers: "Deterministic chat-quality mechanisms over a mocked model stream.",
      pins: [
        { file: "scripts/smoke-ayas-chat-quality.ts", sha256: "57c90b43077a80ed4dff728602e2a0941d6bfba3f6ed2ec0fdfff1a3913ee952" },
      ],
    },
    {
      id: "golden.memory.temporal-correction", domain: "MEMORY_RETRIEVAL", script: "scripts/smoke-ayas-memory-temporal.ts",
      covers: "The temporal memory matrix: current, superseded, historical, future, disputed and as-of facts, with corruption and concurrency cases.",
      pins: [
        { file: "scripts/fixtures/ayas-memory-temporal-cases.ts", sha256: "cce130c64fd2250360fb325d7920553200dc9f7062d739008e60a709b132e61d" },
        { file: "scripts/smoke-ayas-memory-temporal.ts", sha256: "3df128a6d290cc5c65a1d75725f059a2a7ca637017ce47853c69b70af82e51ef" },
      ],
    },
    {
      id: "golden.memory.integrity", domain: "MEMORY_RETRIEVAL", script: "scripts/smoke-ayas-memory-integrity.ts",
      covers: "Stage 15C adversarial memory cases against the context firewall.",
      pins: [
        { file: "scripts/fixtures/ayas-memory-temporal-cases.ts", sha256: "cce130c64fd2250360fb325d7920553200dc9f7062d739008e60a709b132e61d" },
        { file: "scripts/fixtures/ayas-retrieval-evaluation-cases.ts", sha256: "4061b710cd73e9d82701854f9882a35ad3769c52e7e7344ec8f96e29e6128e23" },
        { file: "scripts/lib/AyasRetrievalEvaluation.ts", sha256: "d3c2f021592fb945e82ee38966435baacd062ed34762fba06c99670a770a148e" },
        { file: "scripts/smoke-ayas-memory-integrity.ts", sha256: "c01804717ed4d925f353010889133048c969862e20e5b74d4e3eb20592061314" },
      ],
    },
    {
      id: "golden.memory.retrieval-evaluation", domain: "MEMORY_RETRIEVAL", script: "scripts/smoke-ayas-retrieval-evaluation.ts",
      covers: "The frozen retrieval cases with their declared known limitations.",
      pins: [
        { file: "scripts/fixtures/ayas-memory-temporal-cases.ts", sha256: "cce130c64fd2250360fb325d7920553200dc9f7062d739008e60a709b132e61d" },
        { file: "scripts/fixtures/ayas-retrieval-evaluation-cases.ts", sha256: "4061b710cd73e9d82701854f9882a35ad3769c52e7e7344ec8f96e29e6128e23" },
        { file: "scripts/lib/AyasRetrievalEvaluation.ts", sha256: "d3c2f021592fb945e82ee38966435baacd062ed34762fba06c99670a770a148e" },
        { file: "scripts/smoke-ayas-retrieval-evaluation.ts", sha256: "a92ceddb0d4a273b1148c17cc491c83d0bf8cca1397dd9ce7911e3fc9fae5f9e" },
      ],
    },
    {
      id: "golden.coding.historical-repair-vault", domain: "CODING_REPAIR", script: "scripts/smoke-ayas-local-coding-qualification-vault.ts",
      covers: "Five frozen historical repair tasks: base, fix and evaluator identities are immutable and no answer leaks into a task.",
      pins: [
        { file: "scripts/fixtures/ayas-local-coding-qualification-vault.ts", sha256: "5a97216b8dbf7d2e58faa5eba1ff7cab987b8aef15e15aafcc874effd289c957" },
        { file: "scripts/smoke-ayas-local-coding-qualification-vault.ts", sha256: "574705ca8bc43cff8d1d18e786c38abbfe73c0fdcac98d758db647755efb5c0a" },
      ],
    },
    {
      id: "golden.coding.guided-repair", domain: "CODING_REPAIR", script: "scripts/smoke-ayas-guided-repair.ts",
      covers: "Guided repair of a fixture source file in a TEMP workspace.",
      pins: [
        { file: "scripts/helpers/ayas-action-runtime-fixture.ts", sha256: "8e61d95b05cb2f83844cf0e26f1938d9b3a56dcdb3f52beffe9b528ec763333f" },
        { file: "scripts/smoke-ayas-guided-repair.ts", sha256: "8eecf033cb38407f8dbba53f137783845c00947a3e320d2735b89654450c1893" },
      ],
    },
    {
      id: "golden.security.action-firewall", domain: "SECURITY_ADVERSARIAL", script: "scripts/smoke-ayas-action-firewall.ts",
      covers: "Stage 15D adversarial checks of capability leases on a real filesystem, across restart and a contended store.",
      pins: [
        { file: "scripts/smoke-ayas-action-firewall.ts", sha256: "7c5ac18b9bb786cc78205ea7b17109aad5b95ec0617f64456c3b00b10de08219" },
      ],
    },
    {
      id: "golden.security.exact-patch-safety", domain: "SECURITY_ADVERSARIAL", script: "scripts/smoke-ayas-exact-patch-safety.ts",
      covers: "Exact reviewed patch proofs for the registered improvement strategy.",
      pins: [
        { file: "scripts/smoke-ayas-exact-patch-safety.ts", sha256: "2f5a6fb6707ba9368471c5b04d106bfd6e6f60c67f905218c78379f27a5d37ab" },
      ],
    },
    {
      id: "golden.security.access-gate", domain: "SECURITY_ADVERSARIAL", script: "scripts/smoke-ayas-access-gate.ts",
      covers: "The access gate: session signing and verification, protected paths, the same-origin backstop and the brute-force limiter.",
      pins: [
        { file: "scripts/smoke-ayas-access-gate.ts", sha256: "05d87256cd4a095f4045f07e45cc6e314bcf85160268e73c65f073291310a05f" },
      ],
    },
    {
      id: "golden.production.fault-repair", domain: "PRODUCTION_RECOVERY", script: "scripts/smoke-ayas-production-fault-repair.ts",
      covers: "Stage 15L production fault evidence, repair plans and exact bounded coding tasks.",
      pins: [
        { file: "scripts/smoke-ayas-production-fault-repair.ts", sha256: "7f67d0e6d33a2461d09076ac186a7258b2ec8f120cfa58de25b6cc390548518f" },
      ],
    },
    {
      id: "golden.production.workflow-recovery", domain: "PRODUCTION_RECOVERY", script: "scripts/smoke-ayas-workflow-recovery.ts",
      covers: "Workflow recovery classification: a stale source after restart mutates nothing and a terminal workflow does nothing more.",
      pins: [
        { file: "scripts/helpers/ayas-action-runtime-fixture.ts", sha256: "8e61d95b05cb2f83844cf0e26f1938d9b3a56dcdb3f52beffe9b528ec763333f" },
        { file: "scripts/smoke-ayas-workflow-recovery.ts", sha256: "4b9ada496cb31a6ea7c84503f09ea4739f2801dbefd7bdc7d7de8faf566df28c" },
      ],
    },
    {
      id: "golden.production.durable-task-runtime", domain: "PRODUCTION_RECOVERY", script: "scripts/smoke-ayas-durable-task-runtime.ts",
      covers: "Stage 15B durable task runtime across crash and restart in TEMP journals.",
      pins: [
        { file: "scripts/smoke-ayas-durable-task-runtime.ts", sha256: "d071cb154c3f7c4f7651fb2ec6b016658aa8dcdaf3dfc8acaa9b76e70f7b75c4" },
      ],
    },
    {
      id: "golden.video.historical-storytelling", domain: "HISTORICAL_VIDEO", script: "scripts/smoke-ayas-historical-storytelling.ts",
      covers: "Stage 15J historical fact pack, narrative contract and the local character scene engine.",
      pins: [
        { file: "scripts/smoke-ayas-historical-storytelling.ts", sha256: "5a6eea742a70a5e1ccd60bf6c03d9eb6742357ca4fec610e0b2f5275c7b24a1a" },
      ],
    },
    {
      id: "golden.video.quality-gate", domain: "HISTORICAL_VIDEO", script: "scripts/smoke-ayas-production-quality-gate.ts",
      covers: "Stage 15M production quality gate over explicit evidence fixtures.",
      pins: [
        { file: "scripts/smoke-ayas-production-quality-gate.ts", sha256: "f37fbac70c781a8a8e51083b2738fac66b89e71460e5b8bcb6eb8bfe6e43b7cb" },
      ],
    },
    {
      id: "golden.ui.brain-core", domain: "BRAIN_UI", script: "scripts/smoke-brain-core-ui.ts",
      covers: "Brain Core components rendered to static markup and the read-only snapshot loader.",
      pins: [
        { file: "scripts/smoke-brain-core-ui.ts", sha256: "bf2edd8f9d8516c321e2308789c9da253c251d369b8d2588944aa9e4fd628259" },
      ],
    },
    {
      id: "golden.ui.voice", domain: "BRAIN_UI", script: "scripts/smoke-ayas-voice.ts",
      covers: "The voice experience through a synchronous mock platform: wake word, voice selection and the engine state machine.",
      pins: [
        { file: "scripts/smoke-ayas-voice.ts", sha256: "16b405d8c9133b8ac08a64d374b577ea04f24b6eb3d0f3b648446144237603af" },
      ],
    },
  ],
  gaps: [
    {
      domain: "REVENUE_DRY_RUN",
      missing: "No revenue adapter exists before Stage 16, so there is no dry-run scenario to freeze.",
      reevaluateWhen: "A Stage 16 revenue adapter is built: its dry-run scenario becomes a golden case before the adapter is activated.",
    },
    {
      domain: "HISTORICAL_VIDEO",
      missing: "Two or three representative golden projects. The cases above cover the storytelling contracts and the quality gate, not a whole project.",
      reevaluateWhen: "Deterministic golden projects are added as a later vault version (packet 15O.3); a project rendered by a real production needs the owner.",
    },
  ],
};

/**
 * Version 2 (Stage 15O.3): the three golden historical-video projects join as one case. Every case of version 1 is kept
 * with the same pins. The video gap narrows to what only a real production can supply.
 */
const VERSION_2: AyasGoldenVault = {
  schemaVersion: "1",
  version: 2,
  previousDigest: "1532277d2b7220fbc6eb774dbd623e648e5cab74e17cdb7ad3953584eedeba1c",
  cases: [
    {
      id: "golden.conversation.quality-master", domain: "CONVERSATION", script: "scripts/smoke-ayas-conversation-quality-master.ts",
      covers: "Conversation behaviour contracts: referent choice, context authority, memory selection, clarification policy, prompt restraint and stream finalization.",
      pins: [
        { file: "scripts/smoke-ayas-conversation-quality-master.ts", sha256: "b79d6a839027a4e35d416e96ce9f1ebbfa087d2e807f6f95a31b9c5d0078ec6d" },
      ],
    },
    {
      id: "golden.conversation.chat-quality", domain: "CONVERSATION", script: "scripts/smoke-ayas-chat-quality.ts",
      covers: "Deterministic chat-quality mechanisms over a mocked model stream.",
      pins: [
        { file: "scripts/smoke-ayas-chat-quality.ts", sha256: "57c90b43077a80ed4dff728602e2a0941d6bfba3f6ed2ec0fdfff1a3913ee952" },
      ],
    },
    {
      id: "golden.memory.temporal-correction", domain: "MEMORY_RETRIEVAL", script: "scripts/smoke-ayas-memory-temporal.ts",
      covers: "The temporal memory matrix: current, superseded, historical, future, disputed and as-of facts, with corruption and concurrency cases.",
      pins: [
        { file: "scripts/fixtures/ayas-memory-temporal-cases.ts", sha256: "cce130c64fd2250360fb325d7920553200dc9f7062d739008e60a709b132e61d" },
        { file: "scripts/smoke-ayas-memory-temporal.ts", sha256: "3df128a6d290cc5c65a1d75725f059a2a7ca637017ce47853c69b70af82e51ef" },
      ],
    },
    {
      id: "golden.memory.integrity", domain: "MEMORY_RETRIEVAL", script: "scripts/smoke-ayas-memory-integrity.ts",
      covers: "Stage 15C adversarial memory cases against the context firewall.",
      pins: [
        { file: "scripts/fixtures/ayas-memory-temporal-cases.ts", sha256: "cce130c64fd2250360fb325d7920553200dc9f7062d739008e60a709b132e61d" },
        { file: "scripts/fixtures/ayas-retrieval-evaluation-cases.ts", sha256: "4061b710cd73e9d82701854f9882a35ad3769c52e7e7344ec8f96e29e6128e23" },
        { file: "scripts/lib/AyasRetrievalEvaluation.ts", sha256: "d3c2f021592fb945e82ee38966435baacd062ed34762fba06c99670a770a148e" },
        { file: "scripts/smoke-ayas-memory-integrity.ts", sha256: "c01804717ed4d925f353010889133048c969862e20e5b74d4e3eb20592061314" },
      ],
    },
    {
      id: "golden.memory.retrieval-evaluation", domain: "MEMORY_RETRIEVAL", script: "scripts/smoke-ayas-retrieval-evaluation.ts",
      covers: "The frozen retrieval cases with their declared known limitations.",
      pins: [
        { file: "scripts/fixtures/ayas-memory-temporal-cases.ts", sha256: "cce130c64fd2250360fb325d7920553200dc9f7062d739008e60a709b132e61d" },
        { file: "scripts/fixtures/ayas-retrieval-evaluation-cases.ts", sha256: "4061b710cd73e9d82701854f9882a35ad3769c52e7e7344ec8f96e29e6128e23" },
        { file: "scripts/lib/AyasRetrievalEvaluation.ts", sha256: "d3c2f021592fb945e82ee38966435baacd062ed34762fba06c99670a770a148e" },
        { file: "scripts/smoke-ayas-retrieval-evaluation.ts", sha256: "a92ceddb0d4a273b1148c17cc491c83d0bf8cca1397dd9ce7911e3fc9fae5f9e" },
      ],
    },
    {
      id: "golden.coding.historical-repair-vault", domain: "CODING_REPAIR", script: "scripts/smoke-ayas-local-coding-qualification-vault.ts",
      covers: "Five frozen historical repair tasks: base, fix and evaluator identities are immutable and no answer leaks into a task.",
      pins: [
        { file: "scripts/fixtures/ayas-local-coding-qualification-vault.ts", sha256: "5a97216b8dbf7d2e58faa5eba1ff7cab987b8aef15e15aafcc874effd289c957" },
        { file: "scripts/smoke-ayas-local-coding-qualification-vault.ts", sha256: "574705ca8bc43cff8d1d18e786c38abbfe73c0fdcac98d758db647755efb5c0a" },
      ],
    },
    {
      id: "golden.coding.guided-repair", domain: "CODING_REPAIR", script: "scripts/smoke-ayas-guided-repair.ts",
      covers: "Guided repair of a fixture source file in a TEMP workspace.",
      pins: [
        { file: "scripts/helpers/ayas-action-runtime-fixture.ts", sha256: "8e61d95b05cb2f83844cf0e26f1938d9b3a56dcdb3f52beffe9b528ec763333f" },
        { file: "scripts/smoke-ayas-guided-repair.ts", sha256: "8eecf033cb38407f8dbba53f137783845c00947a3e320d2735b89654450c1893" },
      ],
    },
    {
      id: "golden.security.action-firewall", domain: "SECURITY_ADVERSARIAL", script: "scripts/smoke-ayas-action-firewall.ts",
      covers: "Stage 15D adversarial checks of capability leases on a real filesystem, across restart and a contended store.",
      pins: [
        { file: "scripts/smoke-ayas-action-firewall.ts", sha256: "7c5ac18b9bb786cc78205ea7b17109aad5b95ec0617f64456c3b00b10de08219" },
      ],
    },
    {
      id: "golden.security.exact-patch-safety", domain: "SECURITY_ADVERSARIAL", script: "scripts/smoke-ayas-exact-patch-safety.ts",
      covers: "Exact reviewed patch proofs for the registered improvement strategy.",
      pins: [
        { file: "scripts/smoke-ayas-exact-patch-safety.ts", sha256: "2f5a6fb6707ba9368471c5b04d106bfd6e6f60c67f905218c78379f27a5d37ab" },
      ],
    },
    {
      id: "golden.security.access-gate", domain: "SECURITY_ADVERSARIAL", script: "scripts/smoke-ayas-access-gate.ts",
      covers: "The access gate: session signing and verification, protected paths, the same-origin backstop and the brute-force limiter.",
      pins: [
        { file: "scripts/smoke-ayas-access-gate.ts", sha256: "05d87256cd4a095f4045f07e45cc6e314bcf85160268e73c65f073291310a05f" },
      ],
    },
    {
      id: "golden.production.fault-repair", domain: "PRODUCTION_RECOVERY", script: "scripts/smoke-ayas-production-fault-repair.ts",
      covers: "Stage 15L production fault evidence, repair plans and exact bounded coding tasks.",
      pins: [
        { file: "scripts/smoke-ayas-production-fault-repair.ts", sha256: "7f67d0e6d33a2461d09076ac186a7258b2ec8f120cfa58de25b6cc390548518f" },
      ],
    },
    {
      id: "golden.production.workflow-recovery", domain: "PRODUCTION_RECOVERY", script: "scripts/smoke-ayas-workflow-recovery.ts",
      covers: "Workflow recovery classification: a stale source after restart mutates nothing and a terminal workflow does nothing more.",
      pins: [
        { file: "scripts/helpers/ayas-action-runtime-fixture.ts", sha256: "8e61d95b05cb2f83844cf0e26f1938d9b3a56dcdb3f52beffe9b528ec763333f" },
        { file: "scripts/smoke-ayas-workflow-recovery.ts", sha256: "4b9ada496cb31a6ea7c84503f09ea4739f2801dbefd7bdc7d7de8faf566df28c" },
      ],
    },
    {
      id: "golden.production.durable-task-runtime", domain: "PRODUCTION_RECOVERY", script: "scripts/smoke-ayas-durable-task-runtime.ts",
      covers: "Stage 15B durable task runtime across crash and restart in TEMP journals.",
      pins: [
        { file: "scripts/smoke-ayas-durable-task-runtime.ts", sha256: "d071cb154c3f7c4f7651fb2ec6b016658aa8dcdaf3dfc8acaa9b76e70f7b75c4" },
      ],
    },
    {
      id: "golden.video.historical-storytelling", domain: "HISTORICAL_VIDEO", script: "scripts/smoke-ayas-historical-storytelling.ts",
      covers: "Stage 15J historical fact pack, narrative contract and the local character scene engine.",
      pins: [
        { file: "scripts/smoke-ayas-historical-storytelling.ts", sha256: "5a6eea742a70a5e1ccd60bf6c03d9eb6742357ca4fec610e0b2f5275c7b24a1a" },
      ],
    },
    {
      id: "golden.video.quality-gate", domain: "HISTORICAL_VIDEO", script: "scripts/smoke-ayas-production-quality-gate.ts",
      covers: "Stage 15M production quality gate over explicit evidence fixtures.",
      pins: [
        { file: "scripts/smoke-ayas-production-quality-gate.ts", sha256: "f37fbac70c781a8a8e51083b2738fac66b89e71460e5b8bcb6eb8bfe6e43b7cb" },
      ],
    },
    {
      id: "golden.video.historical-projects", domain: "HISTORICAL_VIDEO", script: "scripts/smoke-ayas-golden-video-projects.ts",
      covers: "Three whole historical-video projects through the fact, narrative and character scene engines, compared with frozen reviews and rendered scene bytes.",
      pins: [
        { file: "scripts/fixtures/ayas-golden-video-projects-expected.ts", sha256: "151b55acd0c07cf7d4ca8e0938551f59f142204a0785affb5db134290458cda5" },
        { file: "scripts/fixtures/ayas-golden-video-projects.ts", sha256: "0bf9fd37e52ebe91ce2504cc9405558b77d807b61cf94952d45a3f73dda72336" },
        { file: "scripts/smoke-ayas-golden-video-projects.ts", sha256: "9f1b0be12afebdf434c06ee3225422ff84a1c16e7179cc17e0310fd356cf314d" },
      ],
    },
    {
      id: "golden.ui.brain-core", domain: "BRAIN_UI", script: "scripts/smoke-brain-core-ui.ts",
      covers: "Brain Core components rendered to static markup and the read-only snapshot loader.",
      pins: [
        { file: "scripts/smoke-brain-core-ui.ts", sha256: "bf2edd8f9d8516c321e2308789c9da253c251d369b8d2588944aa9e4fd628259" },
      ],
    },
    {
      id: "golden.ui.voice", domain: "BRAIN_UI", script: "scripts/smoke-ayas-voice.ts",
      covers: "The voice experience through a synchronous mock platform: wake word, voice selection and the engine state machine.",
      pins: [
        { file: "scripts/smoke-ayas-voice.ts", sha256: "16b405d8c9133b8ac08a64d374b577ea04f24b6eb3d0f3b648446144237603af" },
      ],
    },
  ],
  gaps: [
    {
      domain: "REVENUE_DRY_RUN",
      missing: "No revenue adapter exists before Stage 16, so there is no dry-run scenario to freeze.",
      reevaluateWhen: "A Stage 16 revenue adapter is built: its dry-run scenario becomes a golden case before the adapter is activated.",
    },
    {
      domain: "HISTORICAL_VIDEO",
      missing: "A project rendered by a real production: narration audio, assembled video and measured quality. The golden projects are deterministic fixtures of the local engines.",
      reevaluateWhen: "The owner supplies or approves reference productions.",
    },
  ],
};

/**
 * Version 3 (Stage 17, CF49 exact12 succession): the frozen retrieval case runs its sibling successor grader, which no
 * longer lists the 12 CF49-reviewed improvements as known limitations. The original grader stays pinned by versions 1
 * and 2 and keeps its raw gate. Every other case, pin and gap is version 2's.
 */
const VERSION_3: AyasGoldenVault = {
  schemaVersion: "1",
  version: 3,
  previousDigest: "5f2fbf0b529f381caecd44651af2e642280bbfbc1bd7e761ca79d87dc2024a3f",
  cases: [
    {
      id: "golden.conversation.quality-master", domain: "CONVERSATION", script: "scripts/smoke-ayas-conversation-quality-master.ts",
      covers: "Conversation behaviour contracts: referent choice, context authority, memory selection, clarification policy, prompt restraint and stream finalization.",
      pins: [
        { file: "scripts/smoke-ayas-conversation-quality-master.ts", sha256: "b79d6a839027a4e35d416e96ce9f1ebbfa087d2e807f6f95a31b9c5d0078ec6d" },
      ],
    },
    {
      id: "golden.conversation.chat-quality", domain: "CONVERSATION", script: "scripts/smoke-ayas-chat-quality.ts",
      covers: "Deterministic chat-quality mechanisms over a mocked model stream.",
      pins: [
        { file: "scripts/smoke-ayas-chat-quality.ts", sha256: "57c90b43077a80ed4dff728602e2a0941d6bfba3f6ed2ec0fdfff1a3913ee952" },
      ],
    },
    {
      id: "golden.memory.temporal-correction", domain: "MEMORY_RETRIEVAL", script: "scripts/smoke-ayas-memory-temporal.ts",
      covers: "The temporal memory matrix: current, superseded, historical, future, disputed and as-of facts, with corruption and concurrency cases.",
      pins: [
        { file: "scripts/fixtures/ayas-memory-temporal-cases.ts", sha256: "cce130c64fd2250360fb325d7920553200dc9f7062d739008e60a709b132e61d" },
        { file: "scripts/smoke-ayas-memory-temporal.ts", sha256: "3df128a6d290cc5c65a1d75725f059a2a7ca637017ce47853c69b70af82e51ef" },
      ],
    },
    {
      id: "golden.memory.integrity", domain: "MEMORY_RETRIEVAL", script: "scripts/smoke-ayas-memory-integrity.ts",
      covers: "Stage 15C adversarial memory cases against the context firewall.",
      pins: [
        { file: "scripts/fixtures/ayas-memory-temporal-cases.ts", sha256: "cce130c64fd2250360fb325d7920553200dc9f7062d739008e60a709b132e61d" },
        { file: "scripts/fixtures/ayas-retrieval-evaluation-cases.ts", sha256: "4061b710cd73e9d82701854f9882a35ad3769c52e7e7344ec8f96e29e6128e23" },
        { file: "scripts/lib/AyasRetrievalEvaluation.ts", sha256: "d3c2f021592fb945e82ee38966435baacd062ed34762fba06c99670a770a148e" },
        { file: "scripts/smoke-ayas-memory-integrity.ts", sha256: "c01804717ed4d925f353010889133048c969862e20e5b74d4e3eb20592061314" },
      ],
    },
    {
      id: "golden.memory.retrieval-evaluation", domain: "MEMORY_RETRIEVAL", script: "scripts/smoke-ayas-retrieval-evaluation-v3.ts",
      covers: "The frozen retrieval cases graded by the CF49 exact12 successor: 16 declared known limitations remain; the original grader keeps its raw gate outside the vault.",
      pins: [
        { file: "scripts/fixtures/ayas-memory-temporal-cases.ts", sha256: "cce130c64fd2250360fb325d7920553200dc9f7062d739008e60a709b132e61d" },
        { file: "scripts/fixtures/ayas-retrieval-evaluation-cases.ts", sha256: "4061b710cd73e9d82701854f9882a35ad3769c52e7e7344ec8f96e29e6128e23" },
        { file: "scripts/lib/AyasRetrievalEvaluation.ts", sha256: "d3c2f021592fb945e82ee38966435baacd062ed34762fba06c99670a770a148e" },
        { file: "scripts/smoke-ayas-retrieval-evaluation-v3.ts", sha256: "3c207d69d3cddc977386cc07535c96b5c4c97ce8a33517991346780e86277d00" },
      ],
    },
    {
      id: "golden.coding.historical-repair-vault", domain: "CODING_REPAIR", script: "scripts/smoke-ayas-local-coding-qualification-vault.ts",
      covers: "Five frozen historical repair tasks: base, fix and evaluator identities are immutable and no answer leaks into a task.",
      pins: [
        { file: "scripts/fixtures/ayas-local-coding-qualification-vault.ts", sha256: "5a97216b8dbf7d2e58faa5eba1ff7cab987b8aef15e15aafcc874effd289c957" },
        { file: "scripts/smoke-ayas-local-coding-qualification-vault.ts", sha256: "574705ca8bc43cff8d1d18e786c38abbfe73c0fdcac98d758db647755efb5c0a" },
      ],
    },
    {
      id: "golden.coding.guided-repair", domain: "CODING_REPAIR", script: "scripts/smoke-ayas-guided-repair.ts",
      covers: "Guided repair of a fixture source file in a TEMP workspace.",
      pins: [
        { file: "scripts/helpers/ayas-action-runtime-fixture.ts", sha256: "8e61d95b05cb2f83844cf0e26f1938d9b3a56dcdb3f52beffe9b528ec763333f" },
        { file: "scripts/smoke-ayas-guided-repair.ts", sha256: "8eecf033cb38407f8dbba53f137783845c00947a3e320d2735b89654450c1893" },
      ],
    },
    {
      id: "golden.security.action-firewall", domain: "SECURITY_ADVERSARIAL", script: "scripts/smoke-ayas-action-firewall.ts",
      covers: "Stage 15D adversarial checks of capability leases on a real filesystem, across restart and a contended store.",
      pins: [
        { file: "scripts/smoke-ayas-action-firewall.ts", sha256: "7c5ac18b9bb786cc78205ea7b17109aad5b95ec0617f64456c3b00b10de08219" },
      ],
    },
    {
      id: "golden.security.exact-patch-safety", domain: "SECURITY_ADVERSARIAL", script: "scripts/smoke-ayas-exact-patch-safety.ts",
      covers: "Exact reviewed patch proofs for the registered improvement strategy.",
      pins: [
        { file: "scripts/smoke-ayas-exact-patch-safety.ts", sha256: "2f5a6fb6707ba9368471c5b04d106bfd6e6f60c67f905218c78379f27a5d37ab" },
      ],
    },
    {
      id: "golden.security.access-gate", domain: "SECURITY_ADVERSARIAL", script: "scripts/smoke-ayas-access-gate.ts",
      covers: "The access gate: session signing and verification, protected paths, the same-origin backstop and the brute-force limiter.",
      pins: [
        { file: "scripts/smoke-ayas-access-gate.ts", sha256: "05d87256cd4a095f4045f07e45cc6e314bcf85160268e73c65f073291310a05f" },
      ],
    },
    {
      id: "golden.production.fault-repair", domain: "PRODUCTION_RECOVERY", script: "scripts/smoke-ayas-production-fault-repair.ts",
      covers: "Stage 15L production fault evidence, repair plans and exact bounded coding tasks.",
      pins: [
        { file: "scripts/smoke-ayas-production-fault-repair.ts", sha256: "7f67d0e6d33a2461d09076ac186a7258b2ec8f120cfa58de25b6cc390548518f" },
      ],
    },
    {
      id: "golden.production.workflow-recovery", domain: "PRODUCTION_RECOVERY", script: "scripts/smoke-ayas-workflow-recovery.ts",
      covers: "Workflow recovery classification: a stale source after restart mutates nothing and a terminal workflow does nothing more.",
      pins: [
        { file: "scripts/helpers/ayas-action-runtime-fixture.ts", sha256: "8e61d95b05cb2f83844cf0e26f1938d9b3a56dcdb3f52beffe9b528ec763333f" },
        { file: "scripts/smoke-ayas-workflow-recovery.ts", sha256: "4b9ada496cb31a6ea7c84503f09ea4739f2801dbefd7bdc7d7de8faf566df28c" },
      ],
    },
    {
      id: "golden.production.durable-task-runtime", domain: "PRODUCTION_RECOVERY", script: "scripts/smoke-ayas-durable-task-runtime.ts",
      covers: "Stage 15B durable task runtime across crash and restart in TEMP journals.",
      pins: [
        { file: "scripts/smoke-ayas-durable-task-runtime.ts", sha256: "d071cb154c3f7c4f7651fb2ec6b016658aa8dcdaf3dfc8acaa9b76e70f7b75c4" },
      ],
    },
    {
      id: "golden.video.historical-storytelling", domain: "HISTORICAL_VIDEO", script: "scripts/smoke-ayas-historical-storytelling.ts",
      covers: "Stage 15J historical fact pack, narrative contract and the local character scene engine.",
      pins: [
        { file: "scripts/smoke-ayas-historical-storytelling.ts", sha256: "5a6eea742a70a5e1ccd60bf6c03d9eb6742357ca4fec610e0b2f5275c7b24a1a" },
      ],
    },
    {
      id: "golden.video.quality-gate", domain: "HISTORICAL_VIDEO", script: "scripts/smoke-ayas-production-quality-gate.ts",
      covers: "Stage 15M production quality gate over explicit evidence fixtures.",
      pins: [
        { file: "scripts/smoke-ayas-production-quality-gate.ts", sha256: "f37fbac70c781a8a8e51083b2738fac66b89e71460e5b8bcb6eb8bfe6e43b7cb" },
      ],
    },
    {
      id: "golden.video.historical-projects", domain: "HISTORICAL_VIDEO", script: "scripts/smoke-ayas-golden-video-projects.ts",
      covers: "Three whole historical-video projects through the fact, narrative and character scene engines, compared with frozen reviews and rendered scene bytes.",
      pins: [
        { file: "scripts/fixtures/ayas-golden-video-projects-expected.ts", sha256: "151b55acd0c07cf7d4ca8e0938551f59f142204a0785affb5db134290458cda5" },
        { file: "scripts/fixtures/ayas-golden-video-projects.ts", sha256: "0bf9fd37e52ebe91ce2504cc9405558b77d807b61cf94952d45a3f73dda72336" },
        { file: "scripts/smoke-ayas-golden-video-projects.ts", sha256: "9f1b0be12afebdf434c06ee3225422ff84a1c16e7179cc17e0310fd356cf314d" },
      ],
    },
    {
      id: "golden.ui.brain-core", domain: "BRAIN_UI", script: "scripts/smoke-brain-core-ui.ts",
      covers: "Brain Core components rendered to static markup and the read-only snapshot loader.",
      pins: [
        { file: "scripts/smoke-brain-core-ui.ts", sha256: "bf2edd8f9d8516c321e2308789c9da253c251d369b8d2588944aa9e4fd628259" },
      ],
    },
    {
      id: "golden.ui.voice", domain: "BRAIN_UI", script: "scripts/smoke-ayas-voice.ts",
      covers: "The voice experience through a synchronous mock platform: wake word, voice selection and the engine state machine.",
      pins: [
        { file: "scripts/smoke-ayas-voice.ts", sha256: "16b405d8c9133b8ac08a64d374b577ea04f24b6eb3d0f3b648446144237603af" },
      ],
    },
  ],
  gaps: [
    {
      domain: "REVENUE_DRY_RUN",
      missing: "No revenue adapter exists before Stage 16, so there is no dry-run scenario to freeze.",
      reevaluateWhen: "A Stage 16 revenue adapter is built: its dry-run scenario becomes a golden case before the adapter is activated.",
    },
    {
      domain: "HISTORICAL_VIDEO",
      missing: "A project rendered by a real production: narration audio, assembled video and measured quality. The golden projects are deterministic fixtures of the local engines.",
      reevaluateWhen: "The owner supplies or approves reference productions.",
    },
  ],
};


/** Oldest first. Append; never edit a published version. */
export const AYAS_GOLDEN_VAULT_VERSIONS: readonly AyasGoldenVault[] = Object.freeze([VERSION_1, VERSION_2, VERSION_3]);

/** `retired[version][caseId] = reason`: the cases that version dropped from the one before it. */
export const AYAS_GOLDEN_VAULT_RETIRED: Readonly<Record<number, Readonly<Record<string, string>>>> = Object.freeze({});

/** The vault: the last published version. */
export const AYAS_GOLDEN_VAULT: AyasGoldenVault = AYAS_GOLDEN_VAULT_VERSIONS[AYAS_GOLDEN_VAULT_VERSIONS.length - 1]!;

/** The vault's own modules. An autonomous change may never write them. */
export const AYAS_GOLDEN_VAULT_MODULE_DIR = "src/lib/ayas/golden/";

/**
 * Every file any published version pins. A grader or fixture that was golden once stays protected from an autonomous
 * change, also after a later version re-pins or retires it.
 */
export const AYAS_GOLDEN_VAULT_PINNED_FILES: readonly string[] = Object.freeze(
  [...new Set(AYAS_GOLDEN_VAULT_VERSIONS.flatMap((vault) => vault.cases.flatMap((item) => item.pins.map((pin) => pin.file))))].sort(),
);
