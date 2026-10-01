/**
 * Post-freeze 15C: deterministic admission of a complete prompt against a known model window. Never authority.
 *
 * Mandatory context (system and security text, runtime state, the current request, protected memory) is kept or the
 * call is refused. Everything else is shed lowest value first. An unknown window refuses; it is never guessed.
 */
export type AyasContextClass = "SYSTEM_OWNER_SECURITY" | "ACTIVE_TASK_RECOVERY" | "PROTECTED_MEMORY" | "VERIFIED_RETRIEVAL" | "TRUSTED_MEMORY" | "EXTERNAL_DATA";
export interface AyasContextCandidate {
  readonly id: string;
  readonly class: AyasContextClass;
  readonly trust: "TRUSTED" | "LOW_TRUST" | "QUARANTINED";
  readonly provenance: "RUNTIME" | "OWNER" | "MEMORY" | "RETRIEVAL" | "EXTERNAL";
  readonly protected: boolean;
  readonly tokenEstimate: number;
  readonly relevance: number;
  readonly recency: number;
}
type AyasContextExclusion = { readonly id: string; readonly reason: "QUARANTINED" | "BUDGET"; readonly class: AyasContextClass; readonly trust: AyasContextCandidate["trust"]; readonly provenance: AyasContextCandidate["provenance"]; readonly tokenEstimate: number };
/** Ids, classes and numbers only. No entry body is ever part of the evidence. */
export interface AyasContextBudgetEvidence {
  readonly status: "ALLOW" | "CONTEXT_BUDGET_UNSAFE";
  readonly ceiling: number | null;
  readonly outputReserve: number;
  readonly estimatedPromptTokens: number;
  readonly protectedRetained: boolean;
  readonly selected: readonly string[];
  readonly excluded: readonly AyasContextExclusion[];
}
const PRIORITY: Readonly<Record<AyasContextClass, number>> = Object.freeze({ SYSTEM_OWNER_SECURITY: 0, ACTIVE_TASK_RECOVERY: 1, PROTECTED_MEMORY: 2, VERIFIED_RETRIEVAL: 3, TRUSTED_MEMORY: 4, EXTERNAL_DATA: 5 });
const mandatory = (item: AyasContextCandidate) => item.protected || PRIORITY[item.class] < 3;
export class AyasContextBudgetError extends Error {
  readonly code = "CONTEXT_BUDGET_UNSAFE";
  constructor(readonly evidence: AyasContextBudgetEvidence) { super("CONTEXT_BUDGET_UNSAFE"); this.name = "AyasContextBudgetError"; }
}
/** Chat template and role markers the transport adds around a prompt. */
const FRAMING_TOKENS = 64;
/**
 * A deterministic estimate, not a tokenizer measurement. An ASCII digit, punctuation mark or line break counts as one
 * token, which is the densest a byte-pair tokenizer makes them. Letters, spaces and non-ASCII characters count as one
 * token per two UTF-8 bytes. Parts never estimate lower than their concatenation. Where the transport reports the
 * prompt size it actually evaluated, that measurement decides (`assertAyasMeasuredPromptFits`).
 */
export function estimateAyasContextTextTokens(text: string): number {
  let single = 0;
  let merged = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code > 0x7f) merged += code > 0xffff ? 4 : code > 0x7ff ? 3 : 2;
    else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || code === 0x20) merged += 1;
    else single += 1;
  }
  return single + Math.ceil(merged / 2);
}
/** One rendered line of a prompt, with its line break. */
export function estimateAyasContextLineTokens(line: string): number { return estimateAyasContextTextTokens(line) + 1; }
/** A complete prompt as the transport receives it. */
export function estimateAyasContextTokens(prompt: string): number { return estimateAyasContextTextTokens(prompt) + FRAMING_TOKENS; }
export function resolveAyasContextCeiling(kind: "local" | "cloud", env: NodeJS.ProcessEnv, requestCeiling?: number): number | null {
  const raw = requestCeiling ?? (kind === "local" ? env.OLLAMA_NUM_CTX : env.AYAS_CLOUD_CONTEXT_TOKENS);
  if (raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 2048 && value <= 131072 ? value : null;
}
export function budgetAyasContext(input: {
  readonly ceiling: number | null;
  readonly outputReserve: number;
  readonly mandatoryTokens: number;
  readonly candidates: readonly AyasContextCandidate[];
}): AyasContextBudgetEvidence {
  const excluded: AyasContextExclusion[] = [];
  const base = { ceiling: input.ceiling, outputReserve: input.outputReserve };
  const unsafe = (tokens: number): AyasContextBudgetEvidence => ({ ...base, status: "CONTEXT_BUDGET_UNSAFE", estimatedPromptTokens: tokens, protectedRetained: false, selected: [], excluded });
  const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
  if (input.ceiling === null || !integer(input.ceiling) || !integer(input.outputReserve) || !integer(input.mandatoryTokens)) return unsafe(input.mandatoryTokens);
  const seen = new Set<string>();
  for (const item of input.candidates) {
    if (!/^[a-z][a-z0-9._:-]{0,79}$/.test(item.id) || seen.has(item.id) || !(item.class in PRIORITY) ||
        !["TRUSTED", "LOW_TRUST", "QUARANTINED"].includes(item.trust) || !["RUNTIME", "OWNER", "MEMORY", "RETRIEVAL", "EXTERNAL"].includes(item.provenance) ||
        !integer(item.tokenEstimate) || !Number.isFinite(item.relevance) || !Number.isFinite(item.recency) || typeof item.protected !== "boolean" ||
        (mandatory(item) && item.trust !== "TRUSTED") || (item.class !== "EXTERNAL_DATA" && item.trust === "LOW_TRUST")) return unsafe(input.mandatoryTokens);
    seen.add(item.id);
  }
  const ordered = [...input.candidates].sort((a, b) => Number(b.protected) - Number(a.protected) || PRIORITY[a.class] - PRIORITY[b.class] || b.relevance - a.relevance || b.recency - a.recency || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let tokens = input.mandatoryTokens;
  const selected: string[] = [];
  // Owner/system/task/lease/recovery and protected memory cannot be shed.
  for (const item of ordered.filter(mandatory)) { tokens += item.tokenEstimate; selected.push(item.id); }
  if (tokens + input.outputReserve > input.ceiling) return unsafe(tokens);
  for (const item of ordered.filter((item) => !mandatory(item))) {
    const reason = item.trust === "QUARANTINED" ? "QUARANTINED" : tokens + item.tokenEstimate + input.outputReserve > input.ceiling ? "BUDGET" : null;
    if (reason) excluded.push({ id: item.id, reason, class: item.class, trust: item.trust, provenance: item.provenance, tokenEstimate: item.tokenEstimate });
    else { tokens += item.tokenEstimate; selected.push(item.id); }
  }
  return { ...base, status: "ALLOW", estimatedPromptTokens: tokens, protectedRetained: true, selected, excluded };
}
/**
 * Renders the mandatory prompt, admits optional entries, then checks the exact rendered text. A rendering that still
 * does not fit sheds the lowest admitted optional entry and renders again; mandatory text is never shed.
 */
export function buildBudgetedAyasPrompt(input: {
  readonly ceiling: number | null;
  readonly outputReserve: number;
  readonly candidates: readonly AyasContextCandidate[];
  readonly render: (selected: ReadonlySet<string>) => string;
}): { readonly prompt: string; readonly evidence: AyasContextBudgetEvidence } {
  const planned = budgetAyasContext({ ...input, mandatoryTokens: estimateAyasContextTokens(input.render(new Set())) });
  if (planned.status !== "ALLOW" || planned.ceiling === null) throw new AyasContextBudgetError(planned);
  const byId = new Map(input.candidates.map((item) => [item.id, item]));
  const selected = [...planned.selected];
  const excluded = [...planned.excluded];
  for (;;) {
    const prompt = input.render(new Set(selected));
    const estimatedPromptTokens = estimateAyasContextTokens(prompt);
    if (estimatedPromptTokens + input.outputReserve <= planned.ceiling) return { prompt, evidence: { ...planned, estimatedPromptTokens, selected, excluded } };
    const shed = [...selected].reverse().map((id) => byId.get(id)!).find((item) => !mandatory(item));
    if (!shed) throw new AyasContextBudgetError({ ...planned, status: "CONTEXT_BUDGET_UNSAFE", estimatedPromptTokens, protectedRetained: false, selected: [], excluded });
    selected.splice(selected.indexOf(shed.id), 1);
    excluded.push({ id: shed.id, reason: "BUDGET", class: shed.class, trust: shed.trust, provenance: shed.provenance, tokenEstimate: shed.tokenEstimate });
  }
}
export function assertAyasPromptFits(prompt: string, ceiling: number | null, outputReserve: number): void {
  const evidence = budgetAyasContext({ ceiling, outputReserve, mandatoryTokens: estimateAyasContextTokens(prompt), candidates: [] });
  if (evidence.status !== "ALLOW") throw new AyasContextBudgetError(evidence);
}
/**
 * The prompt size a transport reports after evaluating it. A reply produced from a prompt that did not leave the
 * output reserve free may have been generated from a truncated prompt, so it is refused instead of delivered.
 * A transport that reports nothing usable leaves the estimate as the only check.
 */
export function assertAyasMeasuredPromptFits(measuredPromptTokens: unknown, ceiling: number | null, outputReserve: number): number | undefined {
  if (typeof measuredPromptTokens !== "number" || !Number.isSafeInteger(measuredPromptTokens) || measuredPromptTokens < 0) return undefined;
  if (ceiling === null || measuredPromptTokens + outputReserve > ceiling) {
    throw new AyasContextBudgetError({ status: "CONTEXT_BUDGET_UNSAFE", ceiling, outputReserve, estimatedPromptTokens: measuredPromptTokens, protectedRetained: false, selected: [], excluded: [] });
  }
  return measuredPromptTokens;
}
/** Earlier turns are the part of a conversation that can be shed: the owner's words outrank AYAS's replies, newer outranks older. */
export function ayasHistoryContextCandidates(turns: readonly { readonly role: string; readonly text: string }[], line: (turn: { readonly role: string; readonly text: string }) => string): AyasContextCandidate[] {
  return turns.map((turn, index) => ({
    id: `history:${index}`, class: turn.role === "user" ? "VERIFIED_RETRIEVAL" as const : "TRUSTED_MEMORY" as const, trust: "TRUSTED" as const,
    provenance: turn.role === "user" ? "OWNER" as const : "RUNTIME" as const, protected: false, tokenEstimate: estimateAyasContextLineTokens(line(turn)), relevance: 0, recency: index,
  }));
}
/** Recalled lines outside the protected set are ordinary trusted memory, shed in reverse retrieval order. Protected lines are not candidates: the caller always renders them. */
export function ayasMemoryContextCandidates(lines: readonly string[], protectedLines: ReadonlySet<string>): AyasContextCandidate[] {
  return lines.flatMap((line, index) => protectedLines.has(line) ? [] : [{
    id: `memory:${index}`, class: "TRUSTED_MEMORY" as const, trust: "TRUSTED" as const, provenance: "MEMORY" as const, protected: false,
    tokenEstimate: estimateAyasContextLineTokens(line), relevance: 1, recency: -index,
  }]);
}
/** Counts and flags for the trace. */
export function ayasContextBudgetTraceMetadata(evidence: AyasContextBudgetEvidence): Record<string, number | boolean | null> {
  return { contextCeiling: evidence.ceiling, outputReserve: evidence.outputReserve, contextEstimate: evidence.estimatedPromptTokens, selectedCount: evidence.selected.length, excludedCount: evidence.excluded.length, protectedRetained: evidence.protectedRetained };
}
