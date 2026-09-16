"use client";

import { useState } from "react";

import type { AyasApprovalInboxView, AyasDevelopmentProposal } from "@/lib/brain/autonomy/AyasApprovalInboxView";

/** M17 — the exact human-reviewable diff + sandbox evidence for a sandbox-drafted patch. Renders nothing for a statically pre-written (M15/M16-style) proposal, which has no `patchArtifact`. */
function PatchArtifactPanel({ proposal }: { readonly proposal: AyasDevelopmentProposal }) {
  const artifact = proposal.patchArtifact;
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
  return (
    <div className="bc-dev__details">
      <div className="bc-dev__benefit">
        <span>Bunu onaylarsam bana ne faydası olacak?</span>
        <strong>{proposal.expectedUserBenefit || "Açıklama eksik"}</strong>
      </div>
      <dl className="bc-dev__facts">
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

function PendingProposal({ proposal, pendingId, onDecision }: { readonly proposal: AyasDevelopmentProposal; readonly pendingId?: string | null; readonly onDecision?: (input: { proposalId: string; decision: Decision }) => void }) {
  const [confirming, setConfirming] = useState(false);
  const busy = pendingId === proposal.proposalId;
  const decide = (decision: Decision) => onDecision?.({ proposalId: proposal.proposalId, decision });
  return (
    <article className="bc-dev__proposal" data-testid={`ayas-dev-proposal-${proposal.proposalId}`}>
      <header className="bc-dev__proposal-head">
        <div><span className="bc-dev__status">{statusLabel[proposal.status]}</span><h3>{proposal.objective}</h3></div>
        <span className={`bc-dev__safety bc-dev__safety--${proposal.safetyClassification.toLowerCase()}`}>{proposal.safetyClassification}</span>
      </header>
      <SafetyNotice proposal={proposal} />
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
          {proposal.safetyClassification === "SAFE" && proposal.approvalReady ? <button type="button" className="bc-btn" disabled={busy || !onDecision} onClick={() => setConfirming(true)}>ONAYLA</button> : null}
          <button type="button" className="bc-btn bc-btn--ghost" disabled={busy || !onDecision} onClick={() => decide("REJECT")}>REDDET</button>
          <button type="button" className="bc-btn bc-btn--ghost" disabled={busy || !onDecision} onClick={() => decide("LATER")}>DAHA SONRA</button>
        </div>
      )}
    </article>
  );
}

const executionErrorLabel: Record<string, string> = {
  NOT_FOUND: "Öneri bulunamadı.",
  NOT_APPROVED: "Bu öneri artık onaylı değil — sayfa güncel değil olabilir.",
  NOT_READY: "Öneri yürütmeye hazır değil.",
  AYAS_MUTATION_KIND_UNKNOWN: "Bu öneri için kayıtlı bir uygulama bulunamadı.",
  AYAS_MUTATION_SCOPE_MISMATCH: "Uygulamanın dosya kapsamı öneriyle eşleşmiyor.",
  STALE_APPROVAL: "Onay durumu değişti — sayfayı yenile.",
  INVALID_INPUT: "Geçersiz istek.",
  NETWORK_ERROR: "Bağlantı hatası oluştu — tekrar dene.",
};

/** Visible/enabled only for APPROVED — the one status where execution is eligible. Every other status (including RESERVED/COMPLETED/ABANDONED/RECOVERY_REQUIRED) renders no execution control at all — RECOVERY_REQUIRED in particular must never offer an ordinary replay. */
function ExecuteControl({ proposal, executingId, executionError, onExecute }: { readonly proposal: AyasDevelopmentProposal; readonly executingId?: string | null; readonly executionError?: { readonly proposalId: string; readonly code: string } | null; readonly onExecute?: (input: { proposalId: string }) => void }) {
  const [confirming, setConfirming] = useState(false);
  if (proposal.status !== "APPROVED") return null;
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

function TimelineCard({ proposal, executingId, executionError, onExecute }: { readonly proposal: AyasDevelopmentProposal; readonly executingId?: string | null; readonly executionError?: { readonly proposalId: string; readonly code: string } | null; readonly onExecute?: (input: { proposalId: string }) => void }) {
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

export function AyasDevelopmentCenter({ inbox, pendingId, onDecision, executingId, executionError, onExecute }: { readonly inbox: AyasApprovalInboxView; readonly pendingId?: string | null; readonly onDecision?: (input: { proposalId: string; decision: Decision }) => void; readonly executingId?: string | null; readonly executionError?: { readonly proposalId: string; readonly code: string } | null; readonly onExecute?: (input: { proposalId: string }) => void }) {
  if (!inbox.connected) return <div className="bc-empty" role="alert"><strong>Gelişim Merkezi okunamadı</strong><p>{inbox.error || "Kalıcı durum deposuna ulaşılamıyor."}</p></div>;
  return (
    <section className="bc-dev" aria-label="AYAS Gelişim Merkezi" data-testid="ayas-development-center">
      <header className="bc-dev__hero"><span>İnsan denetimli gelişim</span><h2>AYAS Gelişim Merkezi</h2><p>AYAS’ın neyi neden geliştirmek istediğini, sana sağlayacağı faydayı ve güvenlik sınırlarını karar vermeden önce gör.</p></header>
      <section className="bc-dev__section" aria-labelledby="ayas-dev-pending"><h3 id="ayas-dev-pending">Onay Bekleyenler <span>{inbox.pending.length}</span></h3>{inbox.pending.length ? inbox.pending.map((proposal) => <PendingProposal key={proposal.proposalId} proposal={proposal} pendingId={pendingId} onDecision={onDecision} />) : <p className="bc-empty">Onay bekleyen gerçek bir öneri yok.</p>}</section>
      <section className="bc-dev__section" aria-labelledby="ayas-dev-today"><h3 id="ayas-dev-today">Bugün Neleri Geliştirmeye Çalıştı? <span>{inbox.today.length}</span></h3>{inbox.today.length ? <div className="bc-dev__timeline">{inbox.today.map((proposal) => <TimelineCard key={proposal.proposalId} proposal={proposal} executingId={executingId} executionError={executionError} onExecute={onExecute} />)}</div> : <p className="bc-empty">Bugün değerlendirilmiş bir gelişim adayı yok.</p>}</section>
      <section className="bc-dev__section" aria-labelledby="ayas-dev-history"><h3 id="ayas-dev-history">Geçmiş Kararlar <span>{inbox.history.length}</span></h3>{inbox.history.length ? <div className="bc-dev__timeline">{inbox.history.map((proposal) => <TimelineCard key={proposal.proposalId} proposal={proposal} executingId={executingId} executionError={executionError} onExecute={onExecute} />)}</div> : <p className="bc-empty">Henüz kalıcı bir karar veya yürütme sonucu yok.</p>}</section>
    </section>
  );
}
