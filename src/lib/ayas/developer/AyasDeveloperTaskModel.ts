/**
 * Stage 10 developer task model. Pure and advisory: it classifies a developer
 * request and the areas a change touches, and derives a bounded change plan.
 * It never reads the repository, runs a tool, dispatches an agent, or grants
 * approval. Unknown wording stays a read-only investigation.
 */

export type AyasDeveloperTaskKind =
  | "investigation" | "bug-fix" | "feature" | "refactor" | "test-creation" | "security-fix"
  | "documentation" | "code-review" | "architecture-review" | "recovery-continuation"
  | "migration" | "performance" | "integration";

export type AyasChangeArea =
  | "authority" | "execution-gate" | "security" | "storage" | "production-pipeline" | "video-audio"
  | "router" | "memory" | "conversational" | "trace" | "developer" | "frontend" | "tests"
  | "documentation" | "config" | "generated" | "data" | "secret" | "other-source" | "other";

export type AyasDeveloperAgentId = "claude" | "codex";

export interface AyasDeveloperTask {
  readonly kind: AyasDeveloperTaskKind;
  readonly mutating: boolean;
  readonly question: boolean;
  readonly external: boolean;
  readonly multiComponent: boolean;
  readonly areas: readonly AyasChangeArea[];
  readonly authoritySensitive: boolean;
  readonly dataSensitive: boolean;
  readonly securitySensitive: boolean;
  readonly requiresTests: boolean;
  readonly requiresRuntimeValidation: boolean;
  readonly requiresGraphify: boolean;
  readonly failureTriage: boolean;
  readonly scopeConcern: boolean;
  readonly lifecycleClaim: boolean;
  /** A read-only state question the existing local read tools can answer without a developer agent. */
  readonly handledLocally: boolean;
  readonly packetStyle: "IMPLEMENTATION" | "ANALYSIS";
  readonly namedAgent: AyasDeveloperAgentId | null;
  readonly unavailableAgents: readonly AyasDeveloperAgentId[];
  readonly privateLocal: boolean;
  readonly reasonCodes: readonly string[];
}

export function foldAyasDeveloperText(text: string): string {
  return String(text ?? "").slice(0, 4_000).toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ç/g, "c").replace(/ö/g, "o").replace(/ü/g, "u")
    .replace(/[’'`]/g, " ").replace(/\s+/g, " ").trim();
}

const HIGH_RISK_AREAS: ReadonlySet<AyasChangeArea> = new Set(["authority", "execution-gate", "security", "storage", "production-pipeline", "data", "secret", "config"]);
export function isAyasHighRiskArea(area: AyasChangeArea): boolean { return HIGH_RISK_AREAS.has(area); }

/** Deterministic path → area rules. A path may belong to several areas (e.g. security + authority). */
export function classifyAyasChangeAreas(filePath: string): readonly AyasChangeArea[] {
  const p = String(filePath ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
  const areas = new Set<AyasChangeArea>();
  if (/(^|\/)\.env(\.|$)|\.(pem|key|pfx|p12)$|(^|\/)auth\.json$|credential/i.test(p)) areas.add("secret");
  if (/^(data|runtime)\//.test(p) || /AtolyeRuntime/.test(p)) areas.add("data");
  if (/^(\.graphify|\.next|node_modules|graphify-out|scripts\/\.graphify)\/|\.graphify\/|tsconfig\.tsbuildinfo$|\.log$|^next-env\.d\.ts$/.test(p)) areas.add("generated");
  if (/^(package(-lock)?\.json|tsconfig\.json|next\.config\.[cm]?[jt]s|eslint\.config\.[cm]?js|postcss\.config\.[cm]?[jt]s|\.gitignore|\.gitattributes|\.npmrc)$/.test(p)) areas.add("config");
  if (areas.size > 0) return [...areas];
  if (/\.md$/i.test(p) && !/^(src|app)\//.test(p)) return ["documentation"];
  if (/^scripts\/(smoke-[^/]+\.ts|lib\/)/.test(p)) areas.add("tests");
  if (/(Approval|AuthorityLock|MutationRegistry|AutonomousExecution|ExecutionAuthori[sz]ation|WriteActionPolicy|WriteExecutor|MicroBatch)/.test(p)) areas.add("authority");
  if (/(ExecutionGate|ExecutionJournal|ExecutionBridge|PatchArtifact|PatchSandbox|ExecutionPolicy)/.test(p)) areas.add("execution-gate");
  if (/^src\/lib\/(ayas\/)?security\/|^src\/lib\/runtime\/security\/|SafePublicFetch|BoundedFile|BoundedRequest|Redaction/.test(p)) areas.add("security");
  if (/^src\/lib\/(runtime|storage|assets\/storage|projects)\//.test(p)) areas.add("storage");
  if (/^src\/lib\/(pipeline|production)\//.test(p)) areas.add("production-pipeline");
  if (/^src\/lib\/(visuals|animation|audio|video|assembly|thumbnail|seo|youtube|export|ai)\//.test(p)) areas.add("video-audio");
  if (/^src\/lib\/ayas\/(routing|model)\/|IntentRouting|ComplexityRouter/.test(p)) areas.add("router");
  if (/^src\/lib\/ayas\/memory\/|^src\/lib\/brain\/[^/]*Memory/.test(p)) areas.add("memory");
  if (/AyasChatStream|^src\/lib\/ayas\/(context|reasoning|intake)\/|brainCore|^app\/brain\/actions|Research(Scheduler|Store)|GoalStore|AdaptationPipeline|DeepAnalysis/.test(p)) areas.add("conversational");
  if (/^src\/lib\/ayas\/trace\//.test(p)) areas.add("trace");
  if (/^src\/lib\/ayas\/developer\/|^src\/lib\/ayas\/execution\/Ayas(Developer|Workflow|GuidedRepair|FaultLocalization)|GraphifyConsistency/.test(p)) areas.add("developer");
  if (/^(app|src\/components)\//.test(p)) areas.add("frontend");
  if (areas.size === 0) areas.add(/^(src|app|scripts)\//.test(p) ? "other-source" : "other");
  return [...areas];
}

export function collectAyasChangeAreas(paths: readonly string[]): readonly AyasChangeArea[] {
  const set = new Set<AyasChangeArea>();
  for (const p of paths) for (const area of classifyAyasChangeAreas(p)) set.add(area);
  return [...set].sort();
}

const W = "\\w*";
const re = (stems: string) => new RegExp(`\\b(?:${stems})${W}`);
const QUESTION = /\?\s*$|\b(mi|mu|midir|neden|nasil|ne zaman|nerede|hangi|kim|why|how|what|where|which)\b/;
/** "düzeltir misin?" is a polite request, not a state question. */
const POLITE_REQUEST = /\b(misin|musun|misiniz|musunuz)\b/;
const MUTATION = re("duzelt|onar|fix|ekle|add|yaz(?!ilim)|olustur|create|implement|uygula|degistir|guncelle|update|refactor|sil|remove|kaldir|tasi|migrat|entegre|integrat|bagla|wire|hizlandir|optimiz|harden|sertlestir|guclendir|commit|push|gelistir|yeniden duzenle|sadelestir");
// "handoff" is a feature noun in this codebase, not a continuation request.
const RECOVERY = re("devam|kaldig|resume|continu|yarim|yarida|surdur|devral|kesil|interrupt");
const EXHAUSTED = /\b(token|limit|kota|quota|oturum|session|context)\w*\s+(\w+\s+){0,2}(bitti|doldu|asildi|tukendi|kesildi|ran out|exhausted|ended|expired|hit|reached)\b|\b(limit|kota|quota)\w*\s+(doldu|asildi|hit|reached)\b/;
const LIFECYCLE_CLAIM = /\b(commit|push|stage|closure|kapanis)\w*\s+(\w+\s+){0,2}(oldu|olmadi|edildi|edilmedi|yapildi|yapilmadi|gitti|gitmedi|done|pending|blocked|bekli\w*|engellendi|reddedildi)\b/;
const GRAPHIFY = /\bgraphify\w*|\bgraph\w*\b/;
const SCOPE_CONCERN = /\b(dosya\w*|file\w*)\b.*\b(farkli|beklenmedik|unexpected|degismis|changed|drift|kaymis|alakasiz|unrelated)\b|\b(farkli|beklenmedik|alakasiz|unrelated|unexpected)\b.*\b(dosya\w*|file\w*)\b/;
const FAILURE = /\b(permission|izin|yetki|erisim|eperm|eacces|access denied|timeout|zaman asimi|basarisiz|fail\w*|hata ver\w*|calismadi|calismiyor|patladi|kirmizi)\b/;
const TEST_WORD = re("test|smoke|dogrulama|regresyon|regression|tsc|lint");
const SECURITY = re("guvenlik|security|zafiyet|vulnerab|injection|enjeksiyon|xss|ssrf|traversal|sizinti|leak|secret|supply.chain|tedarik");
const REVIEW = re("review|gozden gecir|kod inceleme|denetle|audit|incele");
const ARCHITECTURE = re("mimari|architecture|tasarim|design|bagimlilik|dependenc|blast radius|etki alani");
const DOCUMENTATION = re("dokuman|dokumantasyon|readme|docs|belge|checkpoint|changelog|roadmap|aciklama yaz");
const TEST_CREATE = /\b(test|smoke)\w*\b.*\b(yaz|ekle|olustur|create|add|write)\w*|\b(yaz|ekle|olustur|create|add|write)\w*\b.*\b(test|smoke)\w*/;
const BUG = re("hata|bug|bozuk|calismiyor|regresyon|regression|crash|coku|patl");
const MIGRATION = re("migrat|goc|tasi|cutover");
const PERFORMANCE = re("performans|performance|hizlandir|yavas|latency|gecikme|optimiz");
const REFACTOR = re("refactor|yeniden duzenle|sadelestir|temizle");
const INTEGRATION = re("entegr|integrat|bagla|wire|baglanti");
const MULTI = re("kapsamli|genis|birden fazla|tum|butun|comprehensive|end.to.end|uctan uca|multi");
// Live-server validation only; "runtime" alone names storage symbols (RuntimeStoragePaths) and is data, not deploy.
const RUNTIME = re("canli|live|deploy|sunucu|server|build_id|restart|yeniden baslat");
const AUTHORITY = re("onay|approval|yetki|authority|execution gate|yurutme|commit|push|yayinla|publish");
const DATA = re("veri|data|storage|depolama|ledger|memory|hafiza|migration|runtime");
const EXTERNAL = re("npm audit|internet|web|dispatch|gonder|yayinla|publish|upload|dis servis");
/** Content-privacy restrictions only; "gizli anahtar" (a secret key) is a security topic, not a privacy instruction. */
const PRIVATE = /\b(gizli tut\w*|ozel (?:yerel )?dosya\w*|yerel kalsin|disari (?:gonderme|cikmasin|paylasma)|paylasma|private|confidential)\b/;
const AGENT_ASSIGN = re("devam|devral|yapsin|etsin|baksin|incelesin|gecsin|continue|take over|handle|bitirsin|tamamlasin");
const AGENT_UNAVAILABLE = /\b(bitti|doldu|asildi|tukendi|yok|kapali|ulasilamiyor|erisilemiyor|calismiyor|unavailable|ran out|exhausted|down)\b/;

function agentMentions(clause: string): AyasDeveloperAgentId[] {
  const found: AyasDeveloperAgentId[] = [];
  if (/\bclaude\b/.test(clause)) found.push("claude");
  if (/\bcodex\b/.test(clause)) found.push("codex");
  return found;
}

export function describeAyasDeveloperTask(input: { readonly text: string; readonly changedPaths?: readonly string[] }): AyasDeveloperTask {
  const t = foldAyasDeveloperText(input.text);
  const areas = collectAyasChangeAreas(input.changedPaths ?? []);
  const reasons: string[] = [];
  const question = QUESTION.test(t) && !POLITE_REQUEST.test(t);
  const exhausted = EXHAUSTED.test(t);
  const lifecycleClaim = LIFECYCLE_CLAIM.test(t);
  const recovery = RECOVERY.test(t) || exhausted || lifecycleClaim;
  const scopeConcern = SCOPE_CONCERN.test(t);
  const failureTriage = FAILURE.test(t) && TEST_WORD.test(t);
  const graphifyQuestion = GRAPHIFY.test(t) && (question || /\b(islendi|guncel|current|stale|durum)\w*/.test(t));
  const security = SECURITY.test(t) || areas.includes("security");
  const imperativeMutation = MUTATION.test(t) && !(question && !recovery);

  let kind: AyasDeveloperTaskKind;
  if (recovery) kind = "recovery-continuation";
  else if ((scopeConcern || failureTriage || graphifyQuestion) && !imperativeMutation) kind = "investigation";
  else if (security && imperativeMutation) kind = "security-fix";
  else if (REVIEW.test(t) && ARCHITECTURE.test(t) && !imperativeMutation) kind = "architecture-review";
  else if (REVIEW.test(t) && !imperativeMutation) kind = "code-review";
  else if (ARCHITECTURE.test(t) && !imperativeMutation) kind = "architecture-review";
  else if (TEST_CREATE.test(t) && imperativeMutation) kind = "test-creation";
  else if (BUG.test(t) && imperativeMutation) kind = "bug-fix";
  else if (MIGRATION.test(t) && imperativeMutation) kind = "migration";
  else if (PERFORMANCE.test(t) && imperativeMutation) kind = "performance";
  else if (REFACTOR.test(t) && imperativeMutation) kind = "refactor";
  else if (INTEGRATION.test(t) && imperativeMutation) kind = "integration";
  else if (DOCUMENTATION.test(t) && imperativeMutation) kind = "documentation";
  // An imperative change without a more specific shape is still a change, never a read-only investigation.
  else if (imperativeMutation) kind = "feature";
  else kind = "investigation";
  reasons.push(`TASK_${kind.toUpperCase().replace(/-/g, "_")}`);

  // Continuation keeps whatever mutation the interrupted sprint still owes;
  // a pure state question never becomes a mutation request.
  const mutating = kind === "recovery-continuation" ? !question || lifecycleClaim
    : kind === "investigation" || kind === "code-review" || kind === "architecture-review" ? false
    : true;
  const docsOnlyChange = areas.length > 0 && areas.every((area) => area === "documentation");
  const codeChange = mutating && kind !== "documentation" && !docsOnlyChange;
  const multiComponent = MULTI.test(t) || areas.filter((area) => area !== "documentation" && area !== "tests").length > 1;
  const authoritySensitive = AUTHORITY.test(t) || areas.includes("authority") || areas.includes("execution-gate");
  const dataSensitive = DATA.test(t) || areas.some((area) => area === "storage" || area === "memory" || area === "data");
  const external = EXTERNAL.test(t);
  const requiresRuntimeValidation = RUNTIME.test(t);
  const requiresTests = codeChange || kind === "test-creation" || failureTriage;
  const requiresGraphify = codeChange || kind === "architecture-review" || kind === "code-review" || graphifyQuestion
    || kind === "recovery-continuation" || (kind === "investigation" && !failureTriage && (scopeConcern || /\b(kod|code|modul|module|sembol|symbol|dosya|file|bagimlilik)\w*/.test(t)));
  const handledLocally = !mutating && (kind === "investigation" || kind === "recovery-continuation") && !external;
  if (handledLocally) reasons.push("LOCAL_READ_ONLY_TOOLS_SUFFICIENT");
  if (lifecycleClaim) reasons.push("LIFECYCLE_CLAIM_REQUIRES_VERIFICATION");
  if (scopeConcern) reasons.push("SCOPE_CONCERN_REQUIRES_DIFF");
  if (failureTriage) reasons.push("FAILURE_REQUIRES_TRIAGE");

  let namedAgent: AyasDeveloperAgentId | null = null;
  const unavailable = new Set<AyasDeveloperAgentId>();
  for (const clause of t.split(/[,.;!]|\b(?:ama|fakat|ancak|but|then|sonra)\b/)) {
    const agents = agentMentions(clause);
    if (agents.length === 0) continue;
    if (EXHAUSTED.test(clause) || AGENT_UNAVAILABLE.test(clause)) for (const agent of agents) unavailable.add(agent);
    // Two agents in one assignment clause is ambiguous; no brand is picked.
    else if (agents.length === 1 && AGENT_ASSIGN.test(clause)) namedAgent = agents[0]!;
  }
  if (namedAgent && unavailable.has(namedAgent)) namedAgent = null;
  if (unavailable.size) reasons.push("AGENT_REPORTED_UNAVAILABLE");

  return Object.freeze({
    kind, mutating, question, external, multiComponent, areas,
    authoritySensitive, dataSensitive, securitySensitive: security,
    requiresTests, requiresRuntimeValidation, requiresGraphify,
    failureTriage, scopeConcern, lifecycleClaim, handledLocally,
    packetStyle: mutating ? "IMPLEMENTATION" : "ANALYSIS",
    namedAgent, unavailableAgents: [...unavailable].sort(), privateLocal: PRIVATE.test(t),
    reasonCodes: Object.freeze(reasons),
  });
}

export interface AyasGraphEvidence {
  /** `.graphify` analyzed the current HEAD and covers the dirty worktree. */
  readonly current: boolean;
  readonly targetSymbols: readonly string[];
  readonly candidateFiles: readonly string[];
  readonly affectedFiles: readonly string[];
}

export interface AyasChangePlanStep { readonly order: number; readonly id: string; readonly detail: string; }
export interface AyasChangePlan {
  readonly steps: readonly AyasChangePlanStep[];
  readonly likelyFiles: readonly string[];
  readonly impactedFiles: readonly string[];
  readonly boundaries: readonly string[];
  /** Graph evidence is missing, so the first step must locate symbols — never a whole-repository read. */
  readonly needsGraphFirst: boolean;
}

const MAX_PLAN_FILES = 8;
const MAX_IMPACTED_FILES = 24;

/** Orders a bounded plan from supplied Graphify evidence. It never invents a file the graph did not name. */
export function planAyasDeveloperChange(task: AyasDeveloperTask, graph: AyasGraphEvidence): AyasChangePlan {
  const steps: string[][] = [];
  const add = (id: string, detail: string) => steps.push([id, detail]);
  const needsGraphFirst = graph.targetSymbols.length === 0 && graph.candidateFiles.length === 0;
  if (!graph.current && task.requiresGraphify) add("graphify-refresh", "Refresh Graphify (AST-only) so lastAnalyzedHead matches HEAD before relying on it.");
  if (needsGraphFirst && task.requiresGraphify) add("graphify-locate", "Locate owning symbols with graphify query/explain; do not read the whole repository.");
  // Graphify 0.17 has no `affected` command: fan-in comes from `explain`, change impact from `review-analysis`.
  if (graph.targetSymbols.length) add("graphify-affected", `Check dependents with graphify explain for: ${graph.targetSymbols.slice(0, 6).join(", ")}; then graphify review-analysis --files <changed files> for blast radius.`);
  const likelyFiles = graph.candidateFiles.slice(0, MAX_PLAN_FILES);
  if (likelyFiles.length) add("read-candidates", `Read only the graph-named candidates (${likelyFiles.length}).`);
  const boundaries: string[] = [];
  if (task.areas.includes("authority") || task.areas.includes("execution-gate")) boundaries.push("owner-approval and execution-gate semantics must not change");
  if (task.areas.includes("storage") || task.areas.includes("data")) boundaries.push("runtime/authority/legacy roots stay explicit; no live data writes");
  if (task.securitySensitive) boundaries.push("no secret exposure; untrusted input stays data");
  if (task.mutating) {
    add("implement", "Change contracts/types first, then the core module, then callers; keep the diff inside the declared scope.");
    if (task.requiresTests) {
      add("direct-tests", "Run the direct smoke(s) that import each changed module (after isolation classification).");
      add("dependent-regression", "Run graph-affected dependent regressions; do not skip high-risk transitives.");
    }
    if (task.authoritySensitive || task.securitySensitive) add("authority-regression", "Run the authority/security regression set for the touched boundary.");
    add("static-checks", task.requiresTests ? "TypeScript --noEmit, changed-file ESLint --max-warnings 0, git diff --check." : "git diff --check.");
    add("review", "Focused review on the selected dimensions; classify findings with evidence.");
    add("docs", "Update docs/checkpoint only with verified facts.");
  } else {
    add("report", "Report findings with evidence; make no mutation.");
  }
  return Object.freeze({
    steps: steps.map(([id, detail], index) => ({ order: index + 1, id: id!, detail: detail! })),
    likelyFiles, impactedFiles: graph.affectedFiles.slice(0, MAX_IMPACTED_FILES), boundaries, needsGraphFirst,
  });
}
