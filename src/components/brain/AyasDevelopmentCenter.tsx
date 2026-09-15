"use client";

import { useState } from "react";

import type { AyasApprovalInboxView, AyasDevelopmentProposal } from "@/lib/brain/autonomy/AyasApprovalInboxView";

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

function TimelineCard({ proposal }: { readonly proposal: AyasDevelopmentProposal }) {
  return (
    <article className="bc-dev__timeline-card">
      <div><span className="bc-dev__status">{statusLabel[proposal.status]}</span><strong>{proposal.objective}</strong></div>
      <span>{new Date(proposal.lastUpdatedAt || proposal.createdAt).toLocaleString("tr-TR")}</span>
      {proposal.decision ? <p className="bc-dev__outcome">Karar: {proposal.decision.decision} · {new Date(proposal.decision.decidedAt).toLocaleString("tr-TR")}</p> : null}
      {proposal.result ? <p className="bc-dev__outcome">Yürütme sonucu: {proposal.result.outcome} · Testler: {proposal.result.testResults.join(" · ") || "kayıt yok"}</p> : null}
      {proposal.status === "RECOVERY_REQUIRED" ? <RecoveryNotice /> : null}
      <details><summary>Ayrıntıları göster</summary><ProposalDetails proposal={proposal} /></details>
    </article>
  );
}

export function AyasDevelopmentCenter({ inbox, pendingId, onDecision }: { readonly inbox: AyasApprovalInboxView; readonly pendingId?: string | null; readonly onDecision?: (input: { proposalId: string; decision: Decision }) => void }) {
  if (!inbox.connected) return <div className="bc-empty" role="alert"><strong>Gelişim Merkezi okunamadı</strong><p>{inbox.error || "Kalıcı durum deposuna ulaşılamıyor."}</p></div>;
  return (
    <section className="bc-dev" aria-label="AYAS Gelişim Merkezi" data-testid="ayas-development-center">
      <header className="bc-dev__hero"><span>İnsan denetimli gelişim</span><h2>AYAS Gelişim Merkezi</h2><p>AYAS’ın neyi neden geliştirmek istediğini, sana sağlayacağı faydayı ve güvenlik sınırlarını karar vermeden önce gör.</p></header>
      <section className="bc-dev__section" aria-labelledby="ayas-dev-pending"><h3 id="ayas-dev-pending">Onay Bekleyenler <span>{inbox.pending.length}</span></h3>{inbox.pending.length ? inbox.pending.map((proposal) => <PendingProposal key={proposal.proposalId} proposal={proposal} pendingId={pendingId} onDecision={onDecision} />) : <p className="bc-empty">Onay bekleyen gerçek bir öneri yok.</p>}</section>
      <section className="bc-dev__section" aria-labelledby="ayas-dev-today"><h3 id="ayas-dev-today">Bugün Neleri Geliştirmeye Çalıştı? <span>{inbox.today.length}</span></h3>{inbox.today.length ? <div className="bc-dev__timeline">{inbox.today.map((proposal) => <TimelineCard key={proposal.proposalId} proposal={proposal} />)}</div> : <p className="bc-empty">Bugün değerlendirilmiş bir gelişim adayı yok.</p>}</section>
      <section className="bc-dev__section" aria-labelledby="ayas-dev-history"><h3 id="ayas-dev-history">Geçmiş Kararlar <span>{inbox.history.length}</span></h3>{inbox.history.length ? <div className="bc-dev__timeline">{inbox.history.map((proposal) => <TimelineCard key={proposal.proposalId} proposal={proposal} />)}</div> : <p className="bc-empty">Henüz kalıcı bir karar veya yürütme sonucu yok.</p>}</section>
    </section>
  );
}
