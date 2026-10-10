"use client";

import { useEffect, useState } from "react";
import { ayasOwnerExactPreviewAcknowledged, type AyasOwnerExactPreviewBinding } from "@/lib/brain/autonomy/AyasOwnerExactPreviewContract";

import type { AyasApprovalInboxView, AyasDevelopmentProposal, AyasPublicationDisplayState } from "@/lib/brain/autonomy/AyasApprovalInboxView";
import { selectAyasPendingOwnerApprovals } from "@/lib/brain/autonomy/AyasPendingApprovalSelector";
import type { AyasMicroBatchDevelopmentEntry, AyasMicroBatchDevelopmentItem, AyasMicroBatchDevelopmentView } from "@/lib/brain/autonomy/AyasMicroBatchDevelopmentView";
// `import type` only — erased entirely at compile time, so none of
// `AyasOwnerRecommendationsView.ts`'s own runtime imports (which reach
// node:fs/node:child_process transitively, same reason
// AYAS_PATCH_ARTIFACT_MUTATION_KIND_LITERAL below is a literal rather than an
// import) ever reach this "use client" component's bundle.
import type { AyasOwnerPendingExecutionEntry, AyasOwnerRecommendation } from "@/lib/brain/autonomy/AyasOwnerRecommendationsView";
import type { AyasApprovalBindingSnapshot } from "@/lib/brain/autonomy/AyasApprovalBinding";
import type { AyasProposalStructuredImpact } from "@/lib/brain/autonomy/AyasProposalImpact";

/** Mirrors `AyasAutonomousExecutionGate.AyasOwnerDecision`, kept a local literal for the same client-bundle reason as `AYAS_PATCH_ARTIFACT_MUTATION_KIND_LITERAL` below. */
type AyasOwnerDecisionLiteral = "APPROVE" | "REJECT";

/**
 * Approval-race UX hardening (Part A). `null` means "no extra banner" — the
 * card renders exactly as it did before this sprint. Every other value is a
 * plain-language explanation of why an item that LOOKS pending/approved may
 * not actually be actionable right now, so a human is never left to
 * discover a race's outcome only after the fact.
 */
const publicationDisplayStateNotice: Record<AyasPublicationDisplayState, string | null> = {
  NORMAL: null,
  EXECUTING_NOW: "ŞU AN UYGULANIYOR — bu tam olarak onayladığınız işlem; sonucu birazdan burada görünecek.",
  WAITING_OTHER_PUBLICATION: "BEKLE — BAŞKA BİR GELİŞTİRME ŞU AN UYGULANIYOR. O işlem bitene kadar bu öğe için onay/uygulama başlatılamaz; bitince otomatik olarak yeniden doğrulanacak.",
  REVALIDATING_FOR_NEW_HEAD: "YENİ HEAD İÇİN YENİDEN DOĞRULANIYOR — depo bu öğenin dayandığı sürümden ileri gitti; bir sonraki denetimde güncelliğini yitirmiş olarak işaretlenecek.",
  STALE_SUPERSEDED: "GÜNCELLİĞİNİ YİTİRDİ — YENİ SÜRÜM HAZIRLANIYOR. Aynı gerçek boşluk için güncel HEAD'e bağlı taze bir aday zaten oluşturuldu; onay için o adayı bekleyin.",
  STALE_AWAITING_REDISCOVERY: "GÜNCELLİĞİNİ YİTİRDİ — henüz yeniden keşfedilmedi. Konu hâlâ gerçekse AYAS bir sonraki taramada güncel HEAD'e bağlı yeni bir aday oluşturabilir.",
};

function PublicationActivityNotice({ displayState }: { readonly displayState: AyasPublicationDisplayState }) {
  const message = publicationDisplayStateNotice[displayState];
  if (!message) return null;
  const tone = displayState === "EXECUTING_NOW" ? "bc-dev__notice--safe" : displayState === "STALE_SUPERSEDED" ? "bc-dev__notice--safe" : "bc-dev__notice--warn";
  return <p className={`bc-dev__notice ${tone}`} role="status">{message}</p>;
}

/**
 * Mirrors `AyasNovelPatchDiscovery.AYAS_PATCH_ARTIFACT_MUTATION_KIND` as a
 * literal, deliberately NOT imported here: that module pulls in
 * `node:fs`/`node:child_process`, which cannot be bundled into this "use
 * client" component. `mutationKind` on the view model is already a plain
 * string, so a literal comparison is exactly as correct as importing the
 * constant would be, without pulling server-only code into the client
 * bundle.
 */
const AYAS_PATCH_ARTIFACT_MUTATION_KIND_LITERAL = "patch-artifact:v1";

/** M17 — the exact human-reviewable diff + sandbox evidence for a sandbox-drafted patch. `undefined` for a statically pre-written (M15/M16-style) proposal, which has no `patchArtifact`. Also reused by M18's micro-batch item cards. */
function PatchArtifactDiff({ artifact }: { readonly artifact: AyasDevelopmentProposal["patchArtifact"] }) {
  if (!artifact) return null;
  return (
    <div className="bc-dev__patch" aria-label="AYAS'ın oluşturduğu tam değişiklik">
      <p className="bc-dev__notice bc-dev__notice--safe">AYAS bu değişikliği kendi oluşturdu ve izole bir sandbox&apos;ta doğruladı.</p>
      <dl className="bc-dev__facts">
        <div><dt>Patch hash</dt><dd><code>{artifact.patchHash}</code></dd></div>
        <div><dt>Üretici</dt><dd><code>{artifact.generatorIdentity}</code></dd></div>
        <div><dt>Sandbox&apos;ta tekrar çalışacak validatorlar</dt><dd>{artifact.validatorScripts.join(" · ") || "Belirtilmemiş"}</dd></div>
        <div><dt>Sandbox testleri geçti mi?</dt><dd>{artifact.sandboxValidationSummary.length ? <ul>{artifact.sandboxValidationSummary.map((line) => <li key={line}>{line}</li>)}</ul> : "Kayıt yok"}</dd></div>
      </dl>
      {artifact.diffPreview.map((file) => (
        <details key={file.filePath} open>
          <summary>{file.isNewFile ? "Yeni dosya" : "Değişecek dosya"}: <code>{file.filePath}</code></summary>
          <pre className="bc-dev__diff"><code>{file.content}</code></pre>
        </details>
      ))}
    </div>
  );
}

function PatchArtifactPanel({ proposal }: { readonly proposal: AyasDevelopmentProposal }) {
  return <PatchArtifactDiff artifact={proposal.patchArtifact} />;
}

type Decision = "APPROVE" | "REJECT" | "LATER";

const statusLabel: Record<AyasDevelopmentProposal["status"], string> = {
  PENDING: "ONAY BEKLİYOR",
  APPROVED: "ONAYLANDI",
  REJECTED: "REDDEDİLDİ",
  DEFERRED: "DAHA SONRA",
  STALE: "GÜNCELLİĞİNİ YİTİRDİ",
  COMPLETED: "TAMAMLANDI",
  FAILED: "BAŞARISIZ",
  RESERVED: "YÜRÜTME İÇİN AYRILDI",
  ABANDONED: "TERK EDİLDİ",
  RECOVERY_REQUIRED: "RECOVERY_REQUIRED",
};

/** M20.1 — deterministic value classification labels (see `AyasFindingValueClass.ts`). Purely descriptive, never an authority signal. */
const valueClassLabel: Record<AyasDevelopmentProposal["valueClass"], string> = {
  TEST_QUALITY: "Test kalitesi geliştirmesi",
  PRODUCT_BEHAVIOR: "Ürün davranışı geliştirmesi",
  RELIABILITY_RECOVERY: "Güvenilirlik / kurtarma geliştirmesi",
  OBSERVABILITY: "Gözlemlenebilirlik geliştirmesi",
  PERFORMANCE: "Performans geliştirmesi",
};

function SafetyNotice({ proposal }: { readonly proposal: AyasDevelopmentProposal }) {
  if (proposal.safetyClassification === "REVIEW_REQUIRED") return <p className="bc-dev__notice bc-dev__notice--warn">İNSAN İNCELEMESİ GEREKİYOR</p>;
  if (proposal.safetyClassification === "FORBIDDEN_AUTONOMOUS") return <p className="bc-dev__notice bc-dev__notice--danger">AYAS BUNU KENDİ BAŞINA UYGULAYAMAZ</p>;
  if (!proposal.approvalReady) return <p className="bc-dev__notice bc-dev__notice--warn">Açıklama eksik — onay istenemez</p>;
  return <p className="bc-dev__notice bc-dev__notice--safe">SAFE · Açıklama ve kapsam onaya hazır</p>;
}

function RecoveryNotice() {
  return (
    <div className="bc-dev__recovery" role="alert">
      <strong>İnsan incelemesi gerekiyor</strong>
      <span>Yürütme sonucu belirsiz olabilir. AYAS bunu otomatik olarak tekrar çalıştırmaz; yeniden çalıştırma seçeneği sunulmaz.</span>
    </div>
  );
}

function ProposalDetails({ proposal }: { readonly proposal: AyasDevelopmentProposal }) {
  const sourceLabel = proposal.discoverySource === "RESEARCH_LIGHT" ? "LIGHT araştırma" : proposal.discoverySource === "RESEARCH_DEEP" ? "DEEP araştırma" : "Yerel discovery";
  return (
    <div className="bc-dev__details">
      <div className="bc-dev__benefit">
        <span>Bunu onaylarsam bana ne faydası olacak?</span>
        <strong>{proposal.expectedUserBenefit || "Açıklama eksik"}</strong>
      </div>
      <dl className="bc-dev__facts">
        <div><dt>Kaynak</dt><dd>{sourceLabel}{proposal.sourceReference ? ` · ${proposal.sourceReference}` : ""}</dd></div>
        <div><dt>Mevcut sorun</dt><dd>{proposal.currentProblem || "Belirtilmemiş"}</dd></div>
        <div><dt>AYAS neden seçti?</dt><dd>{proposal.selectionReason || proposal.rationale || "Belirtilmemiş"}</dd></div>
        <div><dt>Ne değişecek?</dt><dd>{proposal.expectedBehaviorChange || "Belirtilmemiş"}</dd></div>
        <div><dt>Ne değişmeyecek?</dt><dd>{proposal.unchangedBehavior || "Belirtilmemiş"}</dd></div>
        <div><dt>Yapılmazsa risk</dt><dd>{proposal.riskIfNotDone || "Belirtilmemiş"}</dd></div>
        <div><dt>Teknik risk</dt><dd>{proposal.technicalRisk || proposal.risk}</dd></div>
        <div><dt>Üretim etkisi</dt><dd>{proposal.productionImpact || "Belirtilmemiş"}</dd></div>
        <div><dt>Etkilenen dosyalar</dt><dd>{proposal.exactFiles.join(", ") || "Belirtilmemiş"}</dd></div>
        <div><dt>Beklenen kapsam</dt><dd>{proposal.expectedDiffScope || "Belirtilmemiş"}</dd></div>
        <div><dt>Test planı</dt><dd>{proposal.testsPlanned.join(" · ") || "Belirtilmemiş"}</dd></div>
        <div><dt>Graphify kanıtı</dt><dd>{proposal.graphifyEvidence?.join(" · ") || "Belirtilmemiş"}</dd></div>
        <div><dt>Base HEAD</dt><dd><code>{proposal.baseHead}</code></dd></div>
      </dl>
      <PatchArtifactPanel proposal={proposal} />
    </div>
  );
}

const proposalOnaylaErrorLabel: Record<string, string> = {
  NOT_FOUND: "Öneri bulunamadı — sayfa güncel olmayabilir.",
  NOT_READY: "Bu öneri artık PENDING durumunda değil — sayfa güncel olmayabilir.",
  PROPOSAL_HASH_MISMATCH: "Öneri, gösterildiğinden beri değişti — sayfayı yenile ve tekrar incele.",
  NOT_SAFE: "Bu öneri SAFE sınıfında değil — tek onaylı yürütme için uygun değil.",
  NOT_PATCH_ARTIFACT: "Bu öneri türü için tek onaylı yürütme henüz bağlanmadı.",
  AYAS_GRAPHIFY_UNEXPECTED_DEPENDENCY: "Graphify, uygulanan dosyada beklenmeyen bir bağımlılık buldu — işlem güvenli şekilde durduruldu.",
  AYAS_GRAPHIFY_UNAVAILABLE: "Graphify bu makinede kullanılamıyor — işlem güvenli şekilde durduruldu.",
  AYAS_PROPOSAL_STAGE_SCOPE_MISMATCH: "Uygulanan değişikliğin kapsamı onaylanan öneriyle eşleşmiyor — işlem durduruldu.",
  AYAS_PROPOSAL_PUSH_FAILED: "Commit oluşturuldu ama remote'a push başarısız oldu — manuel inceleme gerekiyor.",
  NETWORK_ERROR: "Bağlantı hatası oluştu — tekrar dene.",
  RESULT_UNKNOWN: "Sunucudan yanıt alınamadı — işlem arka planda sürüyor olabilir. Tekrar denemeden önce sayfayı yenileyip güncel durumu kontrol et.",
  AYAS_OWNER_PUBLICATION_WORKER_FAILED: "İşlem çalıştırıcısı başlatılamadı ya da sonuç bildirmeden kapandı — işlem yarıda kalmış olabilir. Tekrar denemeden önce sayfayı yenileyip güncel durumu kontrol et.",
};

const ayasOwnerDecisionErrorLabel: Record<string, string> = {
  AUTONOMOUS_EXECUTION_DISABLED: "Otonom yürütme şu an kapalı — bu sürümde etkinleştirilmedi.",
  BASE_HEAD_CHANGED: "Depo bu öneriden sonra ilerledi — onay artık geçersiz. AYAS aynı konuyu güncel sürüme göre yeniden değerlendirebilir.",
  SCOPE_CHANGED: "Önerinin kapsamı değişti — onay artık geçersiz.",
  PATCH_ARTIFACT_CHANGED: "Değişikliğin kendisi değişti — onay artık geçersiz.",
  RISK_CLASSIFICATION_CHANGED: "Risk sınıflandırması değişti — onay artık geçersiz.",
  PROPOSAL_HASH_CHANGED: "Öneri, gösterildiğinden beri değişti — onay artık geçersiz.",
  NOT_PENDING: "Bu öneri artık beklemede değil — muhtemelen zaten karar verildi.",
  PROPOSAL_NOT_FOUND: "Bu öneri artık bulunamıyor.",
  NOT_EXECUTABLE_CLASSIFICATION: "AYAS bu değişikliği kendi başına uygulayamaz — güvenlik sınıflandırması buna izin vermiyor.",
  NETWORK_ERROR: "Bağlantı hatası oluştu — tekrar dene.",
  RESULT_UNKNOWN: "Sunucudan yanıt alınamadı — işlem arka planda sürüyor olabilir. Tekrar denemeden önce sayfayı yenileyip güncel durumu kontrol et.",
  AYAS_OWNER_PUBLICATION_WORKER_FAILED: "İşlem çalıştırıcısı başlatılamadı ya da sonuç bildirmeden kapandı — işlem yarıda kalmış olabilir. Tekrar denemeden önce sayfayı yenileyip güncel durumu kontrol et.",
};

/**
 * Raw structured-impact fields (Step 2) — enum values, not prose, so this is
 * only ever rendered inside the existing `<details>` "Teknik ayrıntılar"
 * disclosure alongside `proposalId`/`baseHead`, never inline: the plain-
 * language `request.dependencyDisclosure` sentence above is what an owner is
 * expected to read to decide.
 */
function AyasStructuredImpactFacts({ impact }: { readonly impact: AyasProposalStructuredImpact }) {
  return (
    <>
      <div><dt>Bağımlılık etkisi</dt><dd><code>{impact.dependencyImpact}</code></dd></div>
      <div><dt>Dış servis etkisi</dt><dd><code>{impact.externalServiceImpact}</code></dd></div>
      <div><dt>Maliyet</dt><dd><code>{impact.estimatedCost}</code></dd></div>
      <div><dt>Ücretli taahhüt gerektiriyor mu</dt><dd><code>{String(impact.paidCommitmentRequired)}</code></dd></div>
      <div><dt>Lisans durumu</dt><dd><code>{impact.licensingStatus}</code></dd></div>
      <div><dt>Geri alınabilirlik</dt><dd><code>{impact.reversibility}</code></dd></div>
      <div><dt>Doğrulama güveni</dt><dd><code>{impact.validationConfidence}</code></dd></div>
    </>
  );
}

/**
 * Owner-approval model — the plain-language recommendation card. Shows only
 * `AyasOwnerRecommendation`s the server has already filtered to
 * RECOMMEND_FOR_APPROVAL + executable (see `AyasOwnerRecommendationsView.ts`)
 * — no hashes, no patch internals, no Graphify output in the primary view;
 * that detail is available behind the `<details>` disclosure below, matching
 * `PatchArtifactDiff`'s existing convention, never required to decide.
 */
function AyasOwnerRecommendationCard({ recommendation, pendingId, error, onDecision }: {
  readonly recommendation: AyasOwnerRecommendation;
  readonly pendingId?: string | null;
  readonly error?: { readonly proposalId: string; readonly code: string } | null;
  readonly onDecision?: (input: { binding: AyasApprovalBindingSnapshot; decision: AyasOwnerDecisionLiteral }) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const { request, binding, afterApproval } = recommendation;
  const busy = pendingId === binding.proposalId;
  const errorMessage = error?.proposalId === binding.proposalId ? (ayasOwnerDecisionErrorLabel[error.code] ?? `İşlem başarısız oldu (${error.code}).`) : null;
  const decide = (decision: AyasOwnerDecisionLiteral) => onDecision?.({ binding, decision });
  const executesNow = afterApproval === "EXECUTES_AND_PUBLISHES";
  const busyLabel = executesNow ? "UYGULANIYOR…" : "KAYDEDİLİYOR…";

  return (
    <article className="bc-dev__proposal bc-dev__owner-rec" data-testid={`ayas-owner-rec-${binding.proposalId}`}>
      <header className="bc-dev__proposal-head">
        <div><span className="bc-dev__status">AYAS ÖNERİYOR</span><h3>{request.wantsTo}</h3></div>
        <span className={`bc-dev__safety bc-dev__safety--safe`}>{request.risk}</span>
      </header>
      <p><b>Neden:</b> {request.why}</p>
      <p><b>Beklenen fayda:</b> {request.expectedBenefit}</p>
      <p><b>Kapsam:</b> {request.scope}</p>
      <p><b>Risk açıklaması:</b> {request.riskExplanation}</p>
      <p><b>Doğrulama:</b> {request.validationSummary}</p>
      <p><b>Dış maliyet / bağımlılık / lisans:</b> {request.externalCost}</p>
      <p><b>Bağımlılık / lisans açıklaması:</b> {request.dependencyDisclosure}</p>
      <p className="bc-dev__notice bc-dev__notice--safe">AYAS tavsiyesi: DEVAM ET</p>
      <details>
        <summary>Teknik ayrıntılar</summary>
        <dl className="bc-dev__facts">
          <div><dt>Öneri ID</dt><dd><code>{binding.proposalId}</code></dd></div>
          <div><dt>Base HEAD</dt><dd><code>{binding.baseHead}</code></dd></div>
          <div><dt>Kapsam (dosyalar)</dt><dd>{binding.exactFiles.join(", ")}</dd></div>
          {binding.patchArtifactId ? <div><dt>Patch artifact</dt><dd><code>{binding.patchArtifactId}</code></dd></div> : null}
          {request.advanced?.structuredImpact ? <AyasStructuredImpactFacts impact={request.advanced.structuredImpact} /> : null}
        </dl>
      </details>
      {errorMessage ? <p className="bc-dev__notice bc-dev__notice--danger" role="alert">{errorMessage}</p> : null}
      {confirming ? (
        <div className="bc-dev__confirm" role="group" aria-label="Onaylarsam ne olacak?">
          <strong>ONAYLA — onaylarsam ne olacak?</strong>
          {executesNow
            ? <p>AYAS bu değişikliği kendisi uygulayacak, test edecek ve başarılı olursa tek bir commit olarak yayınlayacak. İkinci bir onay istenmeyecek.</p>
            : <p>Onayın kalıcı olarak kaydedilir; AYAS bu değişikliği kendiliğinden yürütmez. Yürütmek için &quot;Onaylandı — Yürütme Bekleniyor&quot; bölümünde ayrıca YÜRÜT&apos;e basman gerekir.</p>}
          <div className="bc-dev__actions">
            <button type="button" className="bc-btn" disabled={busy || !onDecision} onClick={() => decide("APPROVE")}>{busy ? busyLabel : "ONAYLA"}</button>
            <button type="button" className="bc-btn bc-btn--ghost" disabled={busy} onClick={() => setConfirming(false)}>VAZGEÇ</button>
          </div>
        </div>
      ) : (
        <div className="bc-dev__actions">
          <button type="button" className="bc-btn" disabled={busy || !onDecision} onClick={() => setConfirming(true)}>{busy ? busyLabel : "ONAYLA"}</button>
          <button type="button" className="bc-btn bc-btn--ghost" disabled={busy || !onDecision} onClick={() => decide("REJECT")}>REDDET</button>
        </div>
      )}
    </article>
  );
}

/**
 * An owner-model APPROVE that has not run yet — read entirely from the
 * server's `pendingExecution` list, never from client memory, so it reads
 * "ONAYLANDI" exactly the same after a hard reload or a server restart. It
 * never offers ONAYLA again: the decision is already durably recorded.
 * Nothing resumes it automatically (owner policy 2026-10-08). It runs only
 * through the ordinary manual YÜRÜT (`ExecuteControl`), shown here only when
 * the server verified a sealed owner APPROVE for exactly this proposal
 * (`manualExecution === "AVAILABLE"`) and the inbox still reads APPROVED;
 * the server then requires a freshly verified EXECUTE before anything runs.
 */
function AyasOwnerPendingExecutionCard({ entry, proposal, executingId, executionError, onExecute }: { readonly entry: AyasOwnerPendingExecutionEntry; readonly proposal?: AyasDevelopmentProposal; readonly executingId?: string | null; readonly executionError?: { readonly proposalId: string; readonly code: string } | null; readonly onExecute?: (input: { proposalId: string; ownerPreview?: import("@/lib/brain/autonomy/AyasOwnerExactPreviewContract").AyasOwnerExactPreviewBinding }) => void }) {
  const admitted = entry.manualExecution === "AVAILABLE";
  const approved = proposal?.status === "APPROVED";
  return (
    <article className="bc-dev__proposal bc-dev__owner-rec" data-testid={`ayas-owner-pending-execution-${entry.proposalId}`}>
      <header className="bc-dev__proposal-head">
        <div><span className="bc-dev__status">ONAYLANDI</span><h3>{entry.wantsTo}</h3></div>
      </header>
      <div className="bc-dev__confirm" role="status">
        <p>Otomatik yürütme şu anda devre dışı.</p>
        {!admitted
          ? <p>Bu onay doğrulanmış bir owner oturumuna bağlı değil (eski ya da kimliği doğrulanamayan kayıt). AYAS bunu yürütmez ve YÜRÜT sunulmaz; değişiklik hâlâ gerekiyorsa yeni bir öneri ve yeni onay gerekir.</p>
          : approved
            ? <p>Onayın kayıtlı. AYAS bunu kendiliğinden yürütmez; yürütme yalnız senin YÜRÜT eyleminle ve doğrulanmış owner oturumunla başlar.</p>
            : proposal
              ? <p>Güncel durum: {statusLabel[proposal.status]}. Bu öneri için YÜRÜT sunulmaz.</p>
              : <p>Bu öneri güncel listede bulunamadı; sayfayı yenile. YÜRÜT sunulmaz.</p>}
        <p><small>Onaylandı: {new Date(entry.approvedAt).toLocaleString("tr-TR")}</small></p>
      </div>
      {proposal?.status === "RECOVERY_REQUIRED" ? <RecoveryNotice /> : null}
      {admitted && approved && proposal ? <ExecuteControl proposal={proposal} placement="owner-pending" executingId={executingId} executionError={executionError} onExecute={onExecute} /> : null}
    </article>
  );
}

/**
 * M20.7 — "ONAYLA VE UYGULA": the individual-proposal equivalent of M18.1's
 * "BATCH ONAYLA VE UYGULA". Visible only for a PENDING, SAFE,
 * approval-ready, patch-artifact-backed proposal — every other proposal
 * (REVIEW_REQUIRED, FORBIDDEN_AUTONOMOUS, or a static-registry mutationKind)
 * keeps using the ordinary ONAYLA → (separately) YÜRÜT controls below,
 * unchanged. One click here authorizes decide → Package C execution →
 * Graphify verification → validation → exact-scope Git commit → push, with
 * no second confirmation afterward.
 */
/** Approval-race UX hardening (Part A) — neither control offers an action while the other side of a HEAD-bound race is unresolved: the human would otherwise be able to click something that is guaranteed to go stale, or is racing an execution that's already running. */
const AYAS_NON_ACTIONABLE_DISPLAY_STATES: ReadonlySet<AyasPublicationDisplayState> = new Set(["WAITING_OTHER_PUBLICATION", "REVALIDATING_FOR_NEW_HEAD"]);

function ProposalOnaylaVeUygulaControl({ proposal, pendingId, error, onApprove }: { readonly proposal: AyasDevelopmentProposal; readonly pendingId?: string | null; readonly error?: { readonly proposalId: string; readonly code: string } | null; readonly onApprove?: (input: { proposalId: string; proposalHash: string }) => void }) {
  const [confirming, setConfirming] = useState(false);
  if (proposal.mutationKind !== AYAS_PATCH_ARTIFACT_MUTATION_KIND_LITERAL || proposal.safetyClassification !== "SAFE" || !proposal.approvalReady || AYAS_NON_ACTIONABLE_DISPLAY_STATES.has(proposal.displayState)) return null;
  const busy = pendingId === proposal.proposalId;
  const errorMessage = error?.proposalId === proposal.proposalId ? (proposalOnaylaErrorLabel[error.code] ?? `İşlem başarısız oldu (${error.code}).`) : null;
  if (confirming) {
    return (
      <div className="bc-dev__confirm" role="group" aria-label="Onaylarsam ne olacak?">
        <strong>ONAYLA VE UYGULA — onaylarsam ne olacak?</strong>
        <p>Bu işlem, gösterilen bu öneriyi Package C ile uygulayacak, test edecek, Graphify ile doğrulayacak ve tüm kontroller başarılı olursa tek Git commit&apos;i oluşturup remote&apos;a push edecektir.</p>
        <p><b>Hedef:</b> {proposal.objective}</p>
        <p><b>Kapsam:</b> {proposal.exactFiles.join(", ")}</p>
        <p>Ayrı bir YÜRÜT veya Git yayınlama onayı istenmeyecek — bu tek onay hepsini kapsar.</p>
        {errorMessage ? <p className="bc-dev__notice bc-dev__notice--danger" role="alert">{errorMessage}</p> : null}
        <div className="bc-dev__actions">
          <button type="button" className="bc-btn" disabled={busy || !onApprove} onClick={() => onApprove?.({ proposalId: proposal.proposalId, proposalHash: proposal.proposalHash })}>{busy ? "UYGULANIYOR…" : "ONAYLA VE UYGULA"}</button>
          <button type="button" className="bc-btn bc-btn--ghost" disabled={busy} onClick={() => setConfirming(false)}>VAZGEÇ</button>
        </div>
      </div>
    );
  }
  return (
    <div className="bc-dev__actions">
      <button type="button" className="bc-btn" disabled={busy || !onApprove} onClick={() => setConfirming(true)}>{busy ? "UYGULANIYOR…" : "ONAYLA VE UYGULA"}</button>
      {errorMessage ? <p className="bc-dev__notice bc-dev__notice--danger" role="alert">{errorMessage}</p> : null}
    </div>
  );
}

function PendingProposal({ proposal, pendingId, onDecision, onaylaVeUygulaPendingId, onaylaVeUygulaError, onProposalOnaylaVeUygula }: { readonly proposal: AyasDevelopmentProposal; readonly pendingId?: string | null; readonly onDecision?: (input: { proposalId: string; decision: Decision }) => void; readonly onaylaVeUygulaPendingId?: string | null; readonly onaylaVeUygulaError?: { readonly proposalId: string; readonly code: string } | null; readonly onProposalOnaylaVeUygula?: (input: { proposalId: string; proposalHash: string }) => void }) {
  const [confirming, setConfirming] = useState(false);
  const busy = pendingId === proposal.proposalId;
  const decide = (decision: Decision) => onDecision?.({ proposalId: proposal.proposalId, decision });
  return (
    <article className="bc-dev__proposal" data-testid={`ayas-dev-proposal-${proposal.proposalId}`}>
      <header className="bc-dev__proposal-head">
        <div><span className="bc-dev__status">{statusLabel[proposal.status]}</span><h3>{proposal.objective}</h3></div>
        <span className={`bc-dev__safety bc-dev__safety--${proposal.safetyClassification.toLowerCase()}`}>{proposal.safetyClassification}</span>
      </header>
      <p className="bc-dev__valueclass" title="Bu bulgunun türü — dosya yollarından deterministik olarak hesaplanır, öneri metninden değil">{valueClassLabel[proposal.valueClass]}</p>
      <SafetyNotice proposal={proposal} />
      <PublicationActivityNotice displayState={proposal.displayState} />
      <ProposalDetails proposal={proposal} />
      {confirming && proposal.approvalReady ? (
        <div className="bc-dev__confirm" role="group" aria-label="Onay verirsem ne olacak?">
          <strong>Onay verirsem ne olacak?</strong>
          <p><b>Hedef:</b> {proposal.objective}</p>
          <p><b>Fayda:</b> {proposal.expectedUserBenefit}</p>
          <p><b>Kapsam:</b> {proposal.exactFiles.join(", ")} · {proposal.expectedDiffScope}</p>
          <p><b>Test:</b> {proposal.testsPlanned.join(" · ")}</p>
          <p><b>Güvenlik / üretim:</b> {proposal.safetyClassification} · {proposal.productionImpact}</p>
          <p>Bu karar tek kullanımlık bir yürütme yetkisi oluşturur; değişiklik bu ekrandaki kapsamla sınırlı kalır.</p>
          <div className="bc-dev__actions">
            <button type="button" className="bc-btn" disabled={busy || !onDecision} onClick={() => decide("APPROVE")}>ONAYI KESİNLEŞTİR</button>
            <button type="button" className="bc-btn bc-btn--ghost" disabled={busy} onClick={() => setConfirming(false)}>VAZGEÇ</button>
          </div>
        </div>
      ) : (
        <div className="bc-dev__actions">
          {proposal.safetyClassification === "SAFE" && proposal.approvalReady && !AYAS_NON_ACTIONABLE_DISPLAY_STATES.has(proposal.displayState) ? <button type="button" className="bc-btn" disabled={busy || !onDecision} onClick={() => setConfirming(true)}>ONAYLA</button> : null}
          <button type="button" className="bc-btn bc-btn--ghost" disabled={busy || !onDecision} onClick={() => decide("REJECT")}>REDDET</button>
          <button type="button" className="bc-btn bc-btn--ghost" disabled={busy || !onDecision} onClick={() => decide("LATER")}>DAHA SONRA</button>
        </div>
      )}
      <ProposalOnaylaVeUygulaControl proposal={proposal} pendingId={onaylaVeUygulaPendingId} error={onaylaVeUygulaError} onApprove={onProposalOnaylaVeUygula} />
    </article>
  );
}

const executionErrorLabel: Record<string, string> = {
  EXACT_PREVIEW_REQUIRED: "Tam değişiklik önizlemesini yeniden inceleyip onayla.",
  EXACT_PREVIEW_CHANGED: "Önizleme değişti veya doğrulanamıyor; işlem durdu. Sayfayı yenileyip yeniden incele.",
  NOT_FOUND: "Öneri bulunamadı.",
  NOT_APPROVED: "Bu öneri artık onaylı değil — sayfa güncel değil olabilir.",
  NOT_READY: "Öneri yürütmeye hazır değil.",
  AYAS_MUTATION_KIND_UNKNOWN: "Bu öneri için kayıtlı bir uygulama bulunamadı.",
  AYAS_MUTATION_SCOPE_MISMATCH: "Uygulamanın dosya kapsamı öneriyle eşleşmiyor.",
  STALE_APPROVAL: "Onay durumu değişti — sayfayı yenile.",
  INVALID_INPUT: "Geçersiz istek.",
  OWNER_ADMISSION_REQUIRED: "Doğrulanmış owner oturumu gerekiyor — yeniden giriş yap ve kartın güncel durumuna bak.",
  OWNER_ADMISSION_GATE_UNAVAILABLE: "Owner doğrulaması bu sunucuda kullanılamıyor — yürütme başlatılmadı.",
  AYAS_DAEMON_DIRTY_REPO: "Çalışma ağacında kaydedilmemiş değişiklikler var — yürütme başlatılmadı.",
  NETWORK_ERROR: "Bağlantı hatası oluştu — tekrar dene.",
};

/** Visible/enabled only for APPROVED — the one status where execution is eligible. Every other status (including RESERVED/COMPLETED/ABANDONED/RECOVERY_REQUIRED) renders no execution control at all — RECOVERY_REQUIRED in particular must never offer an ordinary replay. A proposal APPROVED via the owner-approval model (`ownerApprovedPendingExecution`) gets this control only on its "Onaylandı — Yürütme Bekleniyor" card (`placement="owner-pending"`), which renders it only after the server verified a sealed owner APPROVE; it is never resumed automatically. Every other APPROVED proposal keeps it on its timeline card. Either way the server requires a fresh verified EXECUTE before anything runs. */
function ExecuteControl({ proposal, executingId, executionError, onExecute, placement = "timeline" }: { readonly proposal: AyasDevelopmentProposal; readonly executingId?: string | null; readonly executionError?: { readonly proposalId: string; readonly code: string } | null; readonly onExecute?: (input: { proposalId: string; ownerPreview?: AyasOwnerExactPreviewBinding }) => void; readonly placement?: "timeline" | "owner-pending" }) {
  if (proposal.mutationKind === AYAS_PATCH_ARTIFACT_MUTATION_KIND_LITERAL) return <ExactPreviewExecutionControl key={proposal.exactPreview?.binding.seal ?? "unavailable"} proposal={proposal} executingId={executingId} executionError={executionError} onExecute={onExecute} placement={placement} />;
  return <ManualExecuteControl proposal={proposal} executingId={executingId} executionError={executionError} onExecute={onExecute} placement={placement} />;
}

function ExactPreviewExecutionControl({ proposal, ...controls }: { readonly proposal: AyasDevelopmentProposal; readonly executingId?: string | null; readonly executionError?: { readonly proposalId: string; readonly code: string } | null; readonly onExecute?: (input: { proposalId: string; ownerPreview?: AyasOwnerExactPreviewBinding }) => void; readonly placement: "timeline" | "owner-pending" }) {
  const [reviewedSeal, setReviewedSeal] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const preview = proposal.exactPreview;
  useEffect(() => {
    if (!preview) return;
    const timer = setTimeout(() => setExpired(true), Math.max(0, Date.parse(preview.binding.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [preview]);
  if (proposal.status !== "APPROVED" || proposal.ownerApprovedPendingExecution !== (controls.placement === "owner-pending")) return null;
  if (!preview || expired || proposal.displayState !== "NORMAL") return <p role="status">Doğrulanmış güncel önizleme yok. YÜRÜT kullanılamaz; sayfayı yenile.</p>;
  const acknowledged = ayasOwnerExactPreviewAcknowledged(preview, reviewedSeal, proposal);
  const executeWithPreview = (input: { proposalId: string }) => {
    if (!ayasOwnerExactPreviewAcknowledged(preview, reviewedSeal, proposal)) return;
    const dispatch = controls.onExecute;
    dispatch?.({ ...input, ownerPreview: preview.binding });
  };
  return <div data-testid="ayas-exact-preview">
    <dl className="bc-dev__facts">
      <div><dt>Artifact</dt><dd><code>{preview.binding.artifactId}</code></dd></div>
      <div><dt>Patch digest</dt><dd><code>{preview.binding.patchHash}</code></dd></div>
      <div><dt>Snapshot digest</dt><dd><code>{preview.binding.snapshotDigest}</code></dd></div>
      <div><dt>Base / source HEAD</dt><dd><code>{preview.binding.baseHead}</code></dd></div>
      <div><dt>Kapsam</dt><dd>{preview.exactFiles.join(", ")} · {proposal.expectedDiffScope}</dd></div>
      <div><dt>Kanıt kimliği / durumu</dt><dd><code>{preview.evidenceIdentity}</code> · {preview.evidenceStatus}</dd></div>
    </dl>
    {preview.files.map(file => <div key={file.filePath}>
      <strong>{file.filePath}</strong>
      <p>Önce</p><pre className="bc-dev__diff"><code>{file.before ?? "Yeni dosya — mevcut içerik yok"}</code></pre>
      <p>Uygulanacak tam içerik</p><pre className="bc-dev__diff"><code>{file.after}</code></pre>
    </div>)}
    <p>{preview.validationSummary.join(" · ")}</p>
    <label><input type="checkbox" checked={acknowledged} onChange={event => setReviewedSeal(event.target.checked ? preview.binding.seal : null)} /> Yukarıdaki tam değişikliği, digest, HEAD, kapsam ve kanıtı inceledim.</label>
    {acknowledged ? <ManualExecuteControl proposal={proposal} {...controls} onExecute={controls.onExecute ? executeWithPreview : undefined} /> : null}
  </div>;
}

function ManualExecuteControl({ proposal, executingId, executionError, onExecute, placement = "timeline" }: { readonly proposal: AyasDevelopmentProposal; readonly executingId?: string | null; readonly executionError?: { readonly proposalId: string; readonly code: string } | null; readonly onExecute?: (input: { proposalId: string; ownerPreview?: AyasOwnerExactPreviewBinding }) => void; readonly placement?: "timeline" | "owner-pending" }) {
  const [confirming, setConfirming] = useState(false);
  if (proposal.status !== "APPROVED" || proposal.ownerApprovedPendingExecution !== (placement === "owner-pending")) return null;
  const busy = executingId === proposal.proposalId;
  const error = executionError?.proposalId === proposal.proposalId ? executionError : null;
  const errorMessage = error ? executionErrorLabel[error.code] ?? `Yürütme başarısız oldu (${error.code}).` : null;
  if (confirming) {
    return (
      <div className="bc-dev__confirm" role="group" aria-label="Yürütürsem ne olacak?">
        <strong>Yürütürsem ne olacak?</strong>
        <p><b>Hedef:</b> {proposal.objective}</p>
        <p><b>Fayda:</b> {proposal.expectedUserBenefit}</p>
        <p><b>Kapsam:</b> {proposal.exactFiles.join(", ")}</p>
        <p><b>Test planı:</b> {proposal.testsPlanned.join(" · ")}</p>
        <p><b>Üretim etkisi:</b> {proposal.productionImpact}</p>
        <p><b>Uygulama kimliği:</b> <code>{proposal.mutationKind || "—"}</code></p>
        <p>AYAS değişikliği bu bilgisayardaki çalışma kopyasında uygular ve testleri çalıştırır; commit veya push yapmaz. Doğrulanmış owner oturumu gerekir.</p>
        <p>Bu onay tek kullanımlıktır; yürütme başladıktan sonra aynı onay tekrar kullanılamaz.</p>
        {errorMessage ? <p className="bc-dev__notice bc-dev__notice--danger" role="alert">{errorMessage}</p> : null}
        <div className="bc-dev__actions">
          <button type="button" className="bc-btn" disabled={busy || !onExecute} onClick={() => onExecute?.({ proposalId: proposal.proposalId })}>{busy ? "YÜRÜTÜLÜYOR…" : "YÜRÜTMEYİ BAŞLAT"}</button>
          <button type="button" className="bc-btn bc-btn--ghost" disabled={busy} onClick={() => setConfirming(false)}>VAZGEÇ</button>
        </div>
      </div>
    );
  }
  return (
    <div className="bc-dev__actions">
      <button type="button" className="bc-btn" disabled={busy || !onExecute} onClick={() => setConfirming(true)}>{busy ? "YÜRÜTÜLÜYOR…" : "YÜRÜT"}</button>
      {errorMessage ? <p className="bc-dev__notice bc-dev__notice--danger" role="alert">{errorMessage}</p> : null}
    </div>
  );
}

function TimelineCard({ proposal, executingId, executionError, onExecute }: { readonly proposal: AyasDevelopmentProposal; readonly executingId?: string | null; readonly executionError?: { readonly proposalId: string; readonly code: string } | null; readonly onExecute?: (input: { proposalId: string; ownerPreview?: import("@/lib/brain/autonomy/AyasOwnerExactPreviewContract").AyasOwnerExactPreviewBinding }) => void }) {
  return (
    <article className="bc-dev__timeline-card">
      <div><span className="bc-dev__status">{statusLabel[proposal.status]}</span><strong>{proposal.objective}</strong></div>
      <span>{new Date(proposal.lastUpdatedAt || proposal.createdAt).toLocaleString("tr-TR")}</span>
      {proposal.decision ? <p className="bc-dev__outcome">Karar: {proposal.decision.decision} · {new Date(proposal.decision.decidedAt).toLocaleString("tr-TR")}</p> : null}
      {proposal.result ? <p className="bc-dev__outcome">Yürütme sonucu: {proposal.result.outcome} · Testler: {proposal.result.testResults.join(" · ") || "kayıt yok"}</p> : null}
      {proposal.status === "RECOVERY_REQUIRED" ? <RecoveryNotice /> : null}
      <ExecuteControl proposal={proposal} executingId={executingId} executionError={executionError} onExecute={onExecute} />
      <details><summary>Ayrıntıları göster</summary><ProposalDetails proposal={proposal} /></details>
    </article>
  );
}

const microBatchStatusLabel: Record<AyasMicroBatchDevelopmentEntry["status"], string> = {
  ACCUMULATING: "BİRİKTİRİLİYOR",
  READY_FOR_REVIEW: "TOPLU İNCELEMEYE HAZIR",
  APPROVED: "ONAYLANDI",
  RESERVED: "YÜRÜTME İÇİN AYRILDI",
  COMPLETED: "TAMAMLANDI",
  FAILED: "BAŞARISIZ",
  STALE: "GÜNCELLİĞİNİ YİTİRDİ",
  ABANDONED: "TERK EDİLDİ",
  RECOVERY_REQUIRED: "RECOVERY_REQUIRED",
};

/** M18 — one micro item inside a batch card: the same sandbox-validated diff evidence a full individual proposal shows, just scoped to this one small item. */
function MicroBatchItemCard({ item }: { readonly item: AyasMicroBatchDevelopmentItem }) {
  return (
    <details className="bc-dev__micro-item" data-testid={`ayas-micro-item-${item.microItemId}`}>
      <summary><code>{item.semanticKey}</code> — {item.exactFiles.join(", ")}</summary>
      <PatchArtifactDiff artifact={item.patchArtifact} />
    </details>
  );
}

const batchOnaylaErrorLabel: Record<string, string> = {
  NOT_READY: "Bu paket artık toplu incelemeye hazır durumda değil — sayfa güncel olmayabilir.",
  BATCH_HASH_MISMATCH: "Paket, gösterildiğinden beri değişti — sayfayı yenile ve tekrar incele.",
  AYAS_MICRO_BATCH_ITEM_HASH_MISMATCH: "Bir öğenin içeriği değişti — paket artık güvenilir değil.",
  AYAS_GRAPHIFY_UNEXPECTED_DEPENDENCY: "Graphify, uygulanan bir dosyada beklenmeyen bir bağımlılık buldu — işlem güvenli şekilde durduruldu.",
  AYAS_GRAPHIFY_UNAVAILABLE: "Graphify bu makinede kullanılamıyor — işlem güvenli şekilde durduruldu.",
  AYAS_MICRO_BATCH_STAGE_SCOPE_MISMATCH: "Uygulanan değişikliklerin kapsamı onaylanan paketle eşleşmiyor — işlem durduruldu.",
  AYAS_MICRO_BATCH_PUSH_FAILED: "Commit oluşturuldu ama remote'a push başarısız oldu — manuel inceleme gerekiyor.",
  NETWORK_ERROR: "Bağlantı hatası oluştu — tekrar dene.",
  RESULT_UNKNOWN: "Sunucudan yanıt alınamadı — işlem arka planda sürüyor olabilir. Tekrar denemeden önce sayfayı yenileyip güncel durumu kontrol et.",
  AYAS_OWNER_PUBLICATION_WORKER_FAILED: "İşlem çalıştırıcısı başlatılamadı ya da sonuç bildirmeden kapandı — işlem yarıda kalmış olabilir. Tekrar denemeden önce sayfayı yenileyip güncel durumu kontrol et.",
};

/** M18.1 — "BATCH ONAYLA VE UYGULA": the single human authorization. Visible ONLY for a READY_FOR_REVIEW batch — never for ACCUMULATING (not yet reviewable) or a historical/terminal batch (already decided). One click here authorizes Package C execution, per-item + final Graphify verification, and — only if every check passes — one exact-scope Git commit and push. There is no second confirmation afterward. */
function BatchOnaylaVeUygulaControl({ entry, pending, error, onApprove }: { readonly entry: AyasMicroBatchDevelopmentEntry; readonly pending?: boolean; readonly error?: { readonly batchId: string; readonly code: string } | null; readonly onApprove?: (input: { batchId: string; batchHash: string }) => void }) {
  const [confirming, setConfirming] = useState(false);
  if (entry.status !== "READY_FOR_REVIEW" || AYAS_NON_ACTIONABLE_DISPLAY_STATES.has(entry.displayState)) return null;
  const errorMessage = error?.batchId === entry.batchId ? (batchOnaylaErrorLabel[error.code] ?? `İşlem başarısız oldu (${error.code}).`) : null;
  if (confirming) {
    return (
      <div className="bc-dev__confirm" role="group" aria-label="Onaylarsam ne olacak?">
        <strong>BATCH ONAYLA VE UYGULA — onaylarsam ne olacak?</strong>
        <p>Bu işlem, gösterilen exact batch&apos;i Package C ile uygulayacak, test edecek, Graphify&apos;ı güncelleyecek ve tüm kontroller başarılı olursa tek Git commit&apos;i oluşturup remote&apos;a push edecektir.</p>
        <p><b>Kapsam:</b> {entry.exactFilesUnion.join(", ")}</p>
        <p><b>Öğe sayısı:</b> {entry.items.length}</p>
        <p>Ayrı bir YÜRÜT veya Git yayınlama onayı istenmeyecek — bu tek onay hepsini kapsar.</p>
        {errorMessage ? <p className="bc-dev__notice bc-dev__notice--danger" role="alert">{errorMessage}</p> : null}
        <div className="bc-dev__actions">
          <button type="button" className="bc-btn" disabled={pending || !onApprove} onClick={() => onApprove?.({ batchId: entry.batchId, batchHash: entry.batchHash })}>{pending ? "UYGULANIYOR…" : "BATCH ONAYLA VE UYGULA"}</button>
          <button type="button" className="bc-btn bc-btn--ghost" disabled={pending} onClick={() => setConfirming(false)}>VAZGEÇ</button>
        </div>
      </div>
    );
  }
  return (
    <div className="bc-dev__actions">
      <button type="button" className="bc-btn" disabled={pending || !onApprove} onClick={() => setConfirming(true)}>{pending ? "UYGULANIYOR…" : "BATCH ONAYLA VE UYGULA"}</button>
      {errorMessage ? <p className="bc-dev__notice bc-dev__notice--danger" role="alert">{errorMessage}</p> : null}
    </div>
  );
}

/** M18 — one batch (active or historical). Read-only history; the active READY_FOR_REVIEW batch additionally shows the single BATCH ONAYLA VE UYGULA control. */
function MicroBatchEntry({ entry, onaylaPending, onaylaError, onBatchOnaylaVeUygula }: { readonly entry: AyasMicroBatchDevelopmentEntry; readonly onaylaPending?: boolean; readonly onaylaError?: { readonly batchId: string; readonly code: string } | null; readonly onBatchOnaylaVeUygula?: (input: { batchId: string; batchHash: string }) => void }) {
  return (
    <article className="bc-dev__proposal" data-testid={`ayas-micro-batch-${entry.batchId}`}>
      <header className="bc-dev__proposal-head">
        <div><span className="bc-dev__status">{microBatchStatusLabel[entry.status]}</span><h3>{entry.items.length} küçük geliştirme</h3></div>
        <span className="bc-dev__safety bc-dev__safety--safe">SAFE</span>
      </header>
      <dl className="bc-dev__facts">
        <div><dt>Toplu risk değerlendirmesi</dt><dd>{entry.aggregateRisk}</dd></div>
        <div><dt>Etkilenen dosyalar</dt><dd>{entry.exactFilesUnion.join(", ") || "Belirtilmemiş"}</dd></div>
        <div><dt>Sandbox&apos;ta tekrar çalışacak validatorlar</dt><dd>{entry.validatorUnion.join(" · ") || "Belirtilmemiş"}</dd></div>
        <div><dt>Base HEAD</dt><dd><code>{entry.baseHead}</code></dd></div>
        <div><dt>Son güncelleme</dt><dd>{new Date(entry.lastUpdatedAt || entry.createdAt).toLocaleString("tr-TR")}</dd></div>
      </dl>
      {entry.decision ? <p className="bc-dev__outcome">Karar: {entry.decision.decision} · {new Date(entry.decision.decidedAt).toLocaleString("tr-TR")}</p> : null}
      {entry.result ? <p className="bc-dev__outcome">Yürütme sonucu: {entry.result.outcome} · Testler: {entry.result.testResults.join(" · ") || "kayıt yok"}</p> : null}
      <PublicationActivityNotice displayState={entry.displayState} />
      <div className="bc-dev__micro-items">{entry.items.map((item) => <MicroBatchItemCard key={item.microItemId} item={item} />)}</div>
      <BatchOnaylaVeUygulaControl entry={entry} pending={onaylaPending} error={onaylaError} onApprove={onBatchOnaylaVeUygula} />
    </article>
  );
}

/** M18 — "Küçük Geliştirme Paketi": Lane A (MICRO_SAFE). AYAS biriktirdiği küçük, düşük riskli geliştirmeleri burada tek bir toplu paket olarak gösterir; her biri ayrı ayrı onay istemez. Toplu inceleme tamamlandığında tek bir "BATCH ONAYLA VE UYGULA" eylemi Package C yürütmesini, Graphify doğrulamasını ve Git yayınlamasını birlikte yetkilendirir. */
function MicroBatchPanel({ microBatch, onaylaPending, onaylaError, onBatchOnaylaVeUygula }: { readonly microBatch: AyasMicroBatchDevelopmentView; readonly onaylaPending?: boolean; readonly onaylaError?: { readonly batchId: string; readonly code: string } | null; readonly onBatchOnaylaVeUygula?: (input: { batchId: string; batchHash: string }) => void }) {
  if (!microBatch.connected) return <div className="bc-empty" role="alert"><strong>Küçük Geliştirme Paketi okunamadı</strong><p>{microBatch.error || "Kalıcı durum deposuna ulaşılamıyor."}</p></div>;
  return (
    <>
      <section className="bc-dev__section" aria-labelledby="ayas-dev-micro-active">
        <h3 id="ayas-dev-micro-active">Biriken Küçük Geliştirme Paketi {microBatch.active ? <span>{microBatch.active.items.length}</span> : null}</h3>
        {microBatch.active ? <MicroBatchEntry entry={microBatch.active} onaylaPending={onaylaPending} onaylaError={onaylaError} onBatchOnaylaVeUygula={onBatchOnaylaVeUygula} /> : <p className="bc-empty">Şu anda biriken küçük bir geliştirme paketi yok.</p>}
      </section>
      <section className="bc-dev__section" aria-labelledby="ayas-dev-micro-history">
        <h3 id="ayas-dev-micro-history">Geçmiş Paketler <span>{microBatch.history.length}</span></h3>
        {microBatch.history.length ? <div className="bc-dev__timeline">{microBatch.history.map((entry) => <MicroBatchEntry key={entry.batchId} entry={entry} />)}</div> : <p className="bc-empty">Henüz tamamlanmış veya karar verilmiş bir paket yok.</p>}
      </section>
    </>
  );
}

export function AyasDevelopmentCenter({ inbox, microBatch, pendingId, onDecision, executingId, executionError, onExecute, batchOnaylaPending, batchOnaylaError, onBatchOnaylaVeUygula, proposalOnaylaPendingId, proposalOnaylaError, onProposalOnaylaVeUygula, ownerRecommendations, ownerDecisionPendingId, ownerDecisionError, onOwnerApprovalDecision, ownerApprovalPendingExecution }: { readonly inbox: AyasApprovalInboxView; readonly microBatch?: AyasMicroBatchDevelopmentView; readonly pendingId?: string | null; readonly onDecision?: (input: { proposalId: string; decision: Decision }) => void; readonly executingId?: string | null; readonly executionError?: { readonly proposalId: string; readonly code: string } | null; readonly onExecute?: (input: { proposalId: string; ownerPreview?: import("@/lib/brain/autonomy/AyasOwnerExactPreviewContract").AyasOwnerExactPreviewBinding }) => void; readonly batchOnaylaPending?: boolean; readonly batchOnaylaError?: { readonly batchId: string; readonly code: string } | null; readonly onBatchOnaylaVeUygula?: (input: { batchId: string; batchHash: string }) => void; readonly proposalOnaylaPendingId?: string | null; readonly proposalOnaylaError?: { readonly proposalId: string; readonly code: string } | null; readonly onProposalOnaylaVeUygula?: (input: { proposalId: string; proposalHash: string }) => void; readonly ownerRecommendations?: readonly AyasOwnerRecommendation[]; readonly ownerDecisionPendingId?: string | null; readonly ownerDecisionError?: { readonly proposalId: string; readonly code: string } | null; readonly onOwnerApprovalDecision?: (input: { binding: AyasApprovalBindingSnapshot; decision: AyasOwnerDecisionLiteral }) => void; readonly ownerApprovalPendingExecution?: readonly AyasOwnerPendingExecutionEntry[] }) {
  if (!inbox.connected) return <div className="bc-empty" role="alert"><strong>Gelişim Merkezi okunamadı</strong><p>{inbox.error || "Kalıcı durum deposuna ulaşılamıyor."}</p></div>;
  const pendingOwnerApprovals = selectAyasPendingOwnerApprovals(inbox);
  const pendingIds = new Set(pendingOwnerApprovals.map((proposal) => proposal.proposalId));
  const pendingReview = inbox.pending.filter((proposal) => !pendingIds.has(proposal.proposalId));
  const inboxProposalById = new Map([...inbox.history, ...inbox.today, ...inbox.pending].map((proposal) => [proposal.proposalId, proposal] as const));
  return (
    <section className="bc-dev" aria-label="AYAS Gelişim Merkezi" data-testid="ayas-development-center">
      <header className="bc-dev__hero"><span>İnsan denetimli gelişim</span><h2>AYAS Gelişim Merkezi</h2><p>AYAS’ın neyi neden geliştirmek istediğini, sana sağlayacağı faydayı ve güvenlik sınırlarını karar vermeden önce gör.</p></header>
      {ownerRecommendations && ownerRecommendations.length > 0 ? (
        <section className="bc-dev__section" aria-labelledby="ayas-owner-recommendations" data-testid="ayas-owner-recommendations">
          <h3 id="ayas-owner-recommendations">AYAS&apos;ın Önerileri <span>{ownerRecommendations.length}</span></h3>
          <div className="bc-dev__timeline">
            {ownerRecommendations.map((recommendation) => (
              <AyasOwnerRecommendationCard
                key={recommendation.binding.proposalId}
                recommendation={recommendation}
                pendingId={ownerDecisionPendingId}
                error={ownerDecisionError}
                onDecision={onOwnerApprovalDecision}
              />
            ))}
          </div>
        </section>
      ) : null}
      {ownerApprovalPendingExecution && ownerApprovalPendingExecution.length > 0 ? (
        <section className="bc-dev__section" aria-labelledby="ayas-owner-pending-execution" data-testid="ayas-owner-pending-execution">
          <h3 id="ayas-owner-pending-execution">Onaylandı — Yürütme Bekleniyor <span>{ownerApprovalPendingExecution.length}</span></h3>
          <div className="bc-dev__timeline">
            {ownerApprovalPendingExecution.map((entry) => <AyasOwnerPendingExecutionCard key={entry.proposalId} entry={entry} proposal={inboxProposalById.get(entry.proposalId)} executingId={executingId} executionError={executionError} onExecute={onExecute} />)}
          </div>
        </section>
      ) : null}
      <section className="bc-dev__section" aria-labelledby="ayas-dev-pending"><h3 id="ayas-dev-pending">Onay Bekleyenler <span>{pendingOwnerApprovals.length}</span></h3>{pendingOwnerApprovals.length ? pendingOwnerApprovals.map((proposal) => <PendingProposal key={proposal.proposalId} proposal={proposal} pendingId={pendingId} onDecision={onDecision} onaylaVeUygulaPendingId={proposalOnaylaPendingId} onaylaVeUygulaError={proposalOnaylaError} onProposalOnaylaVeUygula={onProposalOnaylaVeUygula} />) : <p className="bc-empty">Onay bekleyen gerçek bir öneri yok.</p>}</section>
      {pendingReview.length ? <section className="bc-dev__section" aria-labelledby="ayas-dev-pending-review"><h3 id="ayas-dev-pending-review">İnceleme veya Yeniden Doğrulama <span>{pendingReview.length}</span></h3>{pendingReview.map((proposal) => <PendingProposal key={proposal.proposalId} proposal={proposal} pendingId={pendingId} onDecision={onDecision} onaylaVeUygulaPendingId={proposalOnaylaPendingId} onaylaVeUygulaError={proposalOnaylaError} onProposalOnaylaVeUygula={onProposalOnaylaVeUygula} />)}</section> : null}
      {microBatch ? <MicroBatchPanel microBatch={microBatch} onaylaPending={batchOnaylaPending} onaylaError={batchOnaylaError} onBatchOnaylaVeUygula={onBatchOnaylaVeUygula} /> : null}
      <section className="bc-dev__section" aria-labelledby="ayas-dev-today"><h3 id="ayas-dev-today">Bugün Neleri Geliştirmeye Çalıştı? <span>{inbox.today.length}</span></h3>{inbox.today.length ? <div className="bc-dev__timeline">{inbox.today.map((proposal) => <TimelineCard key={proposal.proposalId} proposal={proposal} executingId={executingId} executionError={executionError} onExecute={onExecute} />)}</div> : <p className="bc-empty">Bugün değerlendirilmiş bir gelişim adayı yok.</p>}</section>
      <section className="bc-dev__section" aria-labelledby="ayas-dev-history"><h3 id="ayas-dev-history">Geçmiş Kararlar <span>{inbox.history.length}</span></h3>{inbox.history.length ? <div className="bc-dev__timeline">{inbox.history.map((proposal) => <TimelineCard key={proposal.proposalId} proposal={proposal} executingId={executingId} executionError={executionError} onExecute={onExecute} />)}</div> : <p className="bc-empty">Henüz kalıcı bir karar veya yürütme sonucu yok.</p>}</section>
    </section>
  );
}
