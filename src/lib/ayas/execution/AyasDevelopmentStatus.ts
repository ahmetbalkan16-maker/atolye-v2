/**
 * AYAS natural-language self-improvement status (M7).
 *
 * Pure, read-only, zero-authority: everything here is derived from
 * `loadAyasApprovalInboxView()` (the SAME durable projection the Gelişim
 * Merkezi UI already uses) — no invented activity, no fabricated proposal,
 * no hardcoded demo text. This module never decides, reserves, finalizes,
 * or transitions anything; it only summarizes what the durable store
 * already says. "Today" uses the exact same Istanbul-day boundary as the
 * Gelişim Merkezi UI (`istanbulDay`, imported — not reimplemented) so a
 * natural-language answer and the UI's own "Bugün" section can never
 * disagree about which proposals count as today's.
 */

import {
  buildAyasApprovalInboxView,
  istanbulDay,
  type AyasDevelopmentProposal,
} from "../../brain/autonomy/AyasApprovalInboxView";
import { readAyasApprovalInboxState, type AyasApprovalInboxReaderOptions } from "../../brain/autonomy/AyasApprovalInboxReader";
import { buildAyasMicroBatchDevelopmentView } from "../../brain/autonomy/AyasMicroBatchDevelopmentView";
import { readAyasMicroBatchState, type AyasMicroBatchReaderOptions } from "../../brain/autonomy/AyasMicroBatchReader";

function fold(text: string): string {
  return String(text ?? "")
    .toLocaleLowerCase("tr")
    .replace(/[İıI]/g, "i")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/[.,!?;:()"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * "Bunu onaylarsam ne olur / faydası ne?" style — a question about ONE
 * specific proposal's benefit/meaning, not a general status overview. Kept
 * narrow and separate from the routing signal in `AyasComplexityRouter.ts`
 * (which only decides WHETHER to dispatch this tool at all) — this decides
 * WHICH shape of answer to build once dispatched.
 */
const BENEFIT_QUERY = /\bfayda\w*\b|\bonaylarsam\b|\bonay verirsem\b|\bonay versem\b|\byapacaksin\b|\byapamiyorsun\b/;

export function isAyasDevelopmentBenefitQuery(userText: string): boolean {
  return BENEFIT_QUERY.test(fold(userText));
}

export interface AyasDevelopmentProposalSummary {
  readonly proposalId: string;
  readonly objective: string;
  readonly status: AyasDevelopmentProposal["status"];
  readonly safetyClassification: AyasDevelopmentProposal["safetyClassification"];
  readonly currentProblem: string | null;
  readonly selectionReason: string | null;
  readonly expectedUserBenefit: string | null;
  readonly expectedBehaviorChange: string | null;
  readonly unchangedBehavior: string | null;
  readonly riskIfNotDone: string | null;
  readonly technicalRisk: string | null;
  readonly productionImpact: string | null;
  readonly exactFiles: readonly string[];
  readonly approvalReady: boolean;
  readonly missingExplanation: readonly string[];
  readonly createdDay: string;
  readonly decidedDay: string | null;
  readonly completedDay: string | null;
  readonly decision: AyasDevelopmentProposal["decision"];
  readonly result: AyasDevelopmentProposal["result"];
}

/** A blank/whitespace-only value is treated exactly like a missing one (matches `missingAyasApprovalExplanation`'s own trim-based check) — otherwise an empty string would silently skip the "belirtilmemiş" fallback below. */
function nullIfBlank(value: string | undefined): string | null {
  return value?.trim() ? value : null;
}

function summarize(proposal: AyasDevelopmentProposal): AyasDevelopmentProposalSummary {
  return {
    proposalId: proposal.proposalId,
    objective: proposal.objective,
    status: proposal.status,
    safetyClassification: proposal.safetyClassification,
    currentProblem: nullIfBlank(proposal.currentProblem),
    selectionReason: nullIfBlank(proposal.selectionReason),
    expectedUserBenefit: nullIfBlank(proposal.expectedUserBenefit),
    expectedBehaviorChange: nullIfBlank(proposal.expectedBehaviorChange),
    unchangedBehavior: nullIfBlank(proposal.unchangedBehavior),
    riskIfNotDone: nullIfBlank(proposal.riskIfNotDone),
    technicalRisk: nullIfBlank(proposal.technicalRisk),
    productionImpact: nullIfBlank(proposal.productionImpact),
    exactFiles: proposal.exactFiles,
    approvalReady: proposal.approvalReady,
    missingExplanation: proposal.missingExplanation,
    createdDay: istanbulDay(proposal.createdAt),
    decidedDay: proposal.decision ? istanbulDay(proposal.decision.decidedAt) : null,
    completedDay: proposal.result ? istanbulDay(proposal.result.completedAt) : null,
    decision: proposal.decision,
    result: proposal.result,
  };
}

export type AyasDevelopmentBenefitFocus =
  | { readonly kind: "none" }
  | { readonly kind: "single"; readonly proposal: AyasDevelopmentProposalSummary }
  | { readonly kind: "ambiguous"; readonly candidates: readonly AyasDevelopmentProposalSummary[] };

/** M18 — a compact, honest summary of Lane A's currently-accumulating batch (if any), for the natural-language status answer. Never includes a diff or artifact content — just enough to say "what" and "how many," exactly like `AyasDevelopmentProposalSummary` does for individual proposals. */
export interface AyasDevelopmentMicroBatchSummary {
  readonly batchId: string;
  readonly status: "ACCUMULATING" | "READY_FOR_REVIEW";
  readonly itemCount: number;
  readonly semanticKeys: readonly string[];
}

export interface AyasDevelopmentStatusData {
  readonly connected: boolean;
  readonly generatedAt: string;
  readonly today: string;
  readonly pendingCount: number;
  readonly pending: readonly AyasDevelopmentProposalSummary[];
  readonly todayCreated: readonly AyasDevelopmentProposalSummary[];
  readonly todayDecided: readonly AyasDevelopmentProposalSummary[];
  readonly todayCompleted: readonly AyasDevelopmentProposalSummary[];
  readonly recentRejected: readonly AyasDevelopmentProposalSummary[];
  readonly recentDeferred: readonly AyasDevelopmentProposalSummary[];
  readonly recoveryRequired: readonly AyasDevelopmentProposalSummary[];
  readonly hasAnyActivityToday: boolean;
  readonly hasAnyPending: boolean;
  /** M18 — the currently-accumulating (or ready-for-review) micro-batch, `null` when none is active. A read failure never breaks the overall status answer — it just omits this field (see `computeAyasDevelopmentStatusData`). */
  readonly microBatch: AyasDevelopmentMicroBatchSummary | null;
  /** Populated only for a benefit-style question ("bunu onaylarsam ne olur?"); `null` for a general status overview. */
  readonly benefitFocus: AyasDevelopmentBenefitFocus | null;
}

/**
 * Builds the full, honest snapshot the grounding prompt turns into a natural
 * reply. Never mutates anything, never touches the gate/store/daemon beyond
 * the read-only reader it's given. `userText` is used ONLY to decide whether
 * this is a benefit-style question (see `isAyasDevelopmentBenefitQuery`) —
 * it never changes which durable data is read.
 *
 * Reads via `readAyasApprovalInboxState`/`buildAyasApprovalInboxView`
 * directly (not the production-hardcoded `loadAyasApprovalInboxView`
 * convenience wrapper) so `readerOptions.rootDir` can point at an isolated
 * test root — the same testability convention every other reader/store in
 * this codebase already follows. Omitted, it defaults to the real durable
 * approval inbox, exactly like `loadAyasApprovalInboxView`.
 */
export function computeAyasDevelopmentStatusData(
  userText: string,
  now: string,
  readerOptions: AyasApprovalInboxReaderOptions = {},
  microBatchReaderOptions: AyasMicroBatchReaderOptions = {},
): AyasDevelopmentStatusData {
  const today = istanbulDay(now);
  let view: ReturnType<typeof buildAyasApprovalInboxView> | { readonly connected: false; readonly error: string };
  try {
    view = buildAyasApprovalInboxView(readAyasApprovalInboxState(readerOptions), now);
  } catch (error) {
    view = { connected: false, error: error instanceof Error ? error.message : String(error) };
  }

  // M18 — a failure reading the micro-batch inbox never breaks the overall
  // status answer (the same fail-soft posture as every other read here):
  // it just means "no micro-batch info available right now," not "AYAS is
  // disconnected."
  let microBatch: AyasDevelopmentMicroBatchSummary | null = null;
  try {
    const microBatchView = buildAyasMicroBatchDevelopmentView(readAyasMicroBatchState(microBatchReaderOptions));
    if (microBatchView.active && (microBatchView.active.status === "ACCUMULATING" || microBatchView.active.status === "READY_FOR_REVIEW")) {
      microBatch = {
        batchId: microBatchView.active.batchId,
        status: microBatchView.active.status,
        itemCount: microBatchView.active.items.length,
        semanticKeys: microBatchView.active.items.map((item) => item.semanticKey),
      };
    }
  } catch { /* fail-soft — the individual-proposal status answer still stands on its own */ }

  if (!view.connected) {
    return {
      connected: false,
      generatedAt: now,
      today,
      pendingCount: 0,
      pending: [],
      todayCreated: [],
      todayDecided: [],
      todayCompleted: [],
      recentRejected: [],
      recentDeferred: [],
      recoveryRequired: [],
      hasAnyActivityToday: false,
      hasAnyPending: false,
      microBatch,
      benefitFocus: null,
    };
  }

  const pending = view.pending.map(summarize);
  const todayCreated = view.today.map(summarize).filter((p) => p.createdDay === today);
  const todayDecided = view.history.map(summarize).filter((p) => p.decidedDay === today);
  const todayCompleted = view.history.map(summarize).filter((p) => p.completedDay === today);
  const recentRejected = view.history.filter((p) => p.status === "REJECTED").map(summarize).slice(0, 10);
  const recentDeferred = view.history.filter((p) => p.status === "DEFERRED").map(summarize).slice(0, 10);
  const recoveryRequired = view.history.filter((p) => p.status === "RECOVERY_REQUIRED").map(summarize).slice(0, 10);

  const benefitFocus: AyasDevelopmentBenefitFocus | null = isAyasDevelopmentBenefitQuery(userText)
    ? pending.length === 0
      ? { kind: "none" }
      : pending.length === 1
        ? { kind: "single", proposal: pending[0]! }
        : { kind: "ambiguous", candidates: pending }
    : null;

  return {
    connected: true,
    generatedAt: now,
    today,
    pendingCount: pending.length,
    pending,
    todayCreated,
    todayDecided,
    todayCompleted,
    recentRejected,
    recentDeferred,
    recoveryRequired,
    hasAnyActivityToday: todayCreated.length > 0 || todayDecided.length > 0 || todayCompleted.length > 0,
    hasAnyPending: pending.length > 0,
    microBatch,
    benefitFocus,
  };
}

function proposalLine(p: AyasDevelopmentProposalSummary): string {
  return `"${p.objective}" (${p.safetyClassification}, durum: ${p.status})`;
}

/**
 * A single, honest Turkish summary sentence set — NOT the final user-facing
 * prose (the grounding call composes that from this + `data`, exactly like
 * every other AYAS tool result). This only has to be factually complete and
 * unambiguous; it is always safe to show verbatim if the grounding call
 * itself fails (see `AyasChatStream.ts`'s fallback-to-summary behavior).
 */
export function buildAyasDevelopmentStatusSummary(data: AyasDevelopmentStatusData): string {
  if (!data.connected) {
    return "Gelişim geçmişine şu anda ulaşılamıyor (kalıcı durum deposu okunamadı).";
  }

  if (data.benefitFocus) {
    if (data.benefitFocus.kind === "none") {
      return "Şu anda onayını bekleyen bir geliştirme önerim yok, o yüzden söz ettiğin öneriyi bulamadım.";
    }
    if (data.benefitFocus.kind === "ambiguous") {
      const options = data.benefitFocus.candidates.map((c, i) => `${i + 1}. ${proposalLine(c)}`).join(" ");
      return `Şu anda onay bekleyen birden fazla öneri var, hangisini kastettiğini netleştirir misin? ${options}`;
    }
    const p = data.benefitFocus.proposal;
    return [
      `"${p.objective}" önerisi hakkında: mevcut sorun — ${p.currentProblem ?? "belirtilmemiş"}.`,
      `Onaylarsan beklenen fayda: ${p.expectedUserBenefit ?? "belirtilmemiş"}.`,
      `Ne değişecek: ${p.expectedBehaviorChange ?? "belirtilmemiş"}; ne değişmeyecek: ${p.unchangedBehavior ?? "belirtilmemiş"}.`,
      `Yapılmazsa risk: ${p.riskIfNotDone ?? "belirtilmemiş"}. Teknik/üretim etkisi: ${p.technicalRisk ?? p.productionImpact ?? "belirtilmemiş"}.`,
      `Güvenlik sınıfı: ${p.safetyClassification}.`,
    ].join(" ");
  }

  const parts: string[] = [];
  if (data.todayCreated.length > 0) {
    parts.push(`Bugün ${data.todayCreated.length} yeni geliştirme adayı değerlendirdim: ${data.todayCreated.map(proposalLine).join(", ")}.`);
  }
  if (data.todayDecided.length > 0) {
    parts.push(`Bugün ${data.todayDecided.length} öneri hakkında karar verildi.`);
  }
  if (data.todayCompleted.length > 0) {
    parts.push(`Bugün ${data.todayCompleted.length} öneri yürütüldü/tamamlandı.`);
  }
  if (!data.hasAnyActivityToday) {
    parts.push("Bugün kayıtlı yeni bir gelişim girişimim yok.");
  }
  if (data.hasAnyPending) {
    parts.push(`Şu anda onayını bekleyen ${data.pendingCount} öneri var: ${data.pending.map(proposalLine).join(", ")}.`);
  } else {
    parts.push("Şu anda senden onay bekleyen bir öneri yok.");
  }
  if (data.recoveryRequired.length > 0) {
    parts.push(
      `${data.recoveryRequired.length} öneri RECOVERY_REQUIRED durumunda — yürütme sonucu belirsiz olabilir, otomatik olarak tekrar denenmez, insan incelemesi gerekiyor.`,
    );
  }
  if (data.microBatch) {
    const keys = data.microBatch.semanticKeys.join(", ");
    parts.push(
      data.microBatch.status === "READY_FOR_REVIEW"
        ? `Ayrıca ${data.microBatch.itemCount} küçük, düşük riskli geliştirmeyi (${keys}) tek bir pakette biriktirdim ve toplu incelemene hazır — her biri için ayrı ayrı onay istemiyorum, paketin tamamını birlikte inceleyebilirsin.`
        : `Ayrıca şu anda ${data.microBatch.itemCount} küçük, düşük riskli geliştirmeyi (${keys}) bir pakette biriktiriyorum; henüz toplu incelemene sunulmadı.`,
    );
  }
  return parts.join(" ");
}
