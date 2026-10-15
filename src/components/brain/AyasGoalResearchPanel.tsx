"use client";

import { useState } from "react";
import { applyAyasUpdateTrialAction, createAndScheduleAyasGoalResearchAction, controlAyasGoalResearchAction, decideAyasUpdateRadarAction } from "../../../app/brain/actions";
import { refreshAyasResearchEngineStatus } from "../../../app/brain/observerActions";

import type { AyasGoalDevelopmentView, AyasGoalDevelopmentEntry } from "@/lib/brain/autonomy/AyasGoalDevelopmentView";
import type { AyasGoalStatus } from "@/lib/brain/autonomy/AyasGoalStore";
import type { AyasExternalResearchFinding } from "@/lib/brain/autonomy/AyasExternalResearchStore";
import type { AyasResearchEngineStatusView, AyasResearchEngineSourceView, AyasResearchEngineSourceStatus } from "@/lib/brain/autonomy/AyasResearchEngineStatusView";
import type { AyasModelCandidateView, AyasModelWatchView, AyasMeasuredModelView } from "@/lib/brain/autonomy/AyasModelWatch";
import type { AyasUpdateRadarItem } from "@/lib/brain/autonomy/AyasUpdateRadar";
import type { AyasUpdateApprovalView } from "@/lib/brain/autonomy/AyasUpdateApprovalStore";
import type { AyasUpdateApplyRecord, AyasUpdateTrialView } from "@/lib/brain/autonomy/AyasUpdateTrialStore";

/**
 * M22.14 — read-only Gelişim Merkezi view of AYAS's goals and external
 * capability research. No execute buttons here by design: a goal or a
 * research finding is never itself an authority surface (AyasGoalStore has
 * no execute/approve/gate method at all — see its own smoke test). The only
 * owner controls are goal research scheduling and the update radar's
 * decisions (AyasUpdateApprovalStore: "Onayla ve dene", "Uygula"), which only
 * record; the observer's update executor carries them out. Any candidate that reaches
 * MICRO_SAFE/PRIORITY_SAFE still goes through the EXISTING
 * BatchOnaylaVeUygula / ProposalOnaylaVeUygula controls elsewhere on this
 * same page — this panel is the "what is AYAS working toward and what did
 * it learn" answer, not a second approval surface.
 */
const goalStatusLabel: Record<AyasGoalStatus, string> = {
  NEW: "YENİ",
  ANALYZING: "ANALİZ EDİLİYOR",
  ACTIVE: "AKTİF",
  WAITING_FOR_AUTHORITY: "ONAY BEKLİYOR",
  BLOCKED: "ENGELLENDİ",
  COMPLETED: "TAMAMLANDI",
  CANCELLED: "İPTAL EDİLDİ",
};

const gapStatusLabel: Record<AyasExternalResearchFinding["atolyeGapStatus"], string> = {
  "already-supported": "Atölye'de zaten var",
  "partially-supported": "Atölye'de kısmen var",
  missing: "Atölye'de yok",
};

const licenseCostLabel: Record<AyasExternalResearchFinding["licenseCostStatus"], string> = {
  "free-tier-available": "ücretsiz katman var",
  "paid-only": "yalnızca ücretli",
  "open-source": "açık kaynak",
  unknown: "lisans/ücret durumu belirsiz",
};

function ResearchFindingCard({ finding }: { readonly finding: AyasExternalResearchFinding }) {
  return (
    <article className="bc-dev__proposal" data-testid={`ayas-research-finding-${finding.findingId}`}>
      <header className="bc-dev__proposal-head">
        <div><h3>{finding.provider} — {finding.capability}</h3></div>
        <span className="bc-dev__safety bc-dev__safety--review_required">{gapStatusLabel[finding.atolyeGapStatus]}</span>
      </header>
      <dl className="bc-dev__facts">
        {finding.evidenceQuote ? <div><dt>Kaynaktan birebir alıntı</dt><dd><q>{finding.evidenceQuote}</q></dd></div> : null}
        {finding.releaseVersion ? <div><dt>Sürüm</dt><dd>kurulu {finding.installedVersion} → yeni {finding.releaseVersion}</dd></div> : null}
        <div><dt>{finding.evidenceQuote ? "AYAS'ın yorumu" : "Çözdüğü problem"}</dt><dd>{finding.problemSolved}</dd></div>
        <div><dt>Kaynak</dt><dd><a href={finding.sourceUrl} target="_blank" rel="noreferrer noopener">{finding.sourceUrl}</a> {finding.isOfficialSource ? "(resmi kaynak)" : "(resmi olmayan kaynak)"}</dd></div>
        <div><dt>Kategori</dt><dd>{finding.category ?? "belirtilmemiş"}</dd></div>
        <div><dt>Güven düzeyi</dt><dd>{finding.confidence}</dd></div>
        <div><dt>Lisans / maliyet</dt><dd>{licenseCostLabel[finding.licenseCostStatus]}{finding.licenseCostNotes ? ` — ${finding.licenseCostNotes}` : ""}</dd></div>
        <div><dt>Atölye boşluk notu</dt><dd>{finding.atolyeGapNotes}</dd></div>
        <div><dt>Son kontrol</dt><dd>{new Date(finding.lastCheckedAt).toLocaleString("tr-TR")}</dd></div>
      </dl>
    </article>
  );
}

function GoalCard({ goal }: { readonly goal: AyasGoalDevelopmentEntry }) {
  return (
    <article className="bc-dev__proposal" data-testid={`ayas-goal-${goal.goalId}`}>
      <header className="bc-dev__proposal-head">
        <div><span className="bc-dev__status">{goalStatusLabel[goal.status]}</span><h3>{goal.userIntent}</h3></div>
      </header>
      <dl className="bc-dev__facts">
        <div><dt>Kapsam</dt><dd>{goal.scope}</dd></div>
        <div><dt>İzin verilen alanlar</dt><dd>{goal.allowedDomains.join(", ") || "kısıtlama yok"}</dd></div>
        {goal.excludedDomains.length > 0 ? <div><dt>Hariç tutulan alanlar</dt><dd>{goal.excludedDomains.join(", ")}</dd></div> : null}
        <div><dt>Başarı kriterleri</dt><dd>{goal.successCriteria.join(" · ") || "belirtilmemiş"}</dd></div>
      </dl>
      {goal.progress.length > 0 ? (
        <div className="bc-dev__facts"><strong>İlerleme</strong><ul>{goal.progress.map((p, i) => <li key={i}>{p}</li>)}</ul></div>
      ) : null}
      {goal.blockers.length > 0 ? (
        <div className="bc-dev__notice bc-dev__notice--warn"><strong>Engeller</strong><ul>{goal.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></div>
      ) : null}
      {goal.candidates.length > 0 ? (
        <details open>
          <summary>Adaylar ({goal.candidates.length})</summary>
          <ul>
            {goal.candidates.map((c, i) => (
              <li key={c.candidateId}>
                {goal.resolvedCandidateFindings[i] ? `${goal.resolvedCandidateFindings[i]!.provider} — ${goal.resolvedCandidateFindings[i]!.capability}` : c.reference}: {c.note}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {goal.scheduledResearchFindings.length > 0 ? <details><summary>Bu hedef için yeni araştırma ({goal.scheduledResearchFindings.length})</summary><ul>{goal.scheduledResearchFindings.map((finding) => <li key={finding.findingId}>{finding.provider} — {finding.capability} · plan {formatAyasScheduleTime(finding.scheduledFor)} · çalıştı {formatAyasScheduleTime(finding.executedAt)}</li>)}</ul></details> : null}
    </article>
  );
}

const sourceStatusLabel: Record<AyasResearchEngineSourceStatus, string> = {
  NEVER_CHECKED: "henüz kontrol edilmedi",
  OK: "değişti",
  UNCHANGED: "değişmedi",
  ERROR: "hata",
};

function formatAyasScheduleTime(iso: string | undefined): string {
  return iso ? new Date(iso).toLocaleString("tr-TR") : "henüz planlanmadı";
}

function ResearchEngineStatusSection({ status }: { readonly status: AyasResearchEngineStatusView }) {
  if (!status.connected) return <div className="bc-empty" role="alert"><strong>Araştırma Motoru okunamadı</strong><p>{status.error || "Kalıcı durum deposuna ulaşılamıyor."}</p></div>;
  return (
    <section className="bc-dev__section" aria-labelledby="ayas-research-engine">
      <h3 id="ayas-research-engine">Araştırma Motoru</h3>
      <dl className="bc-dev__facts">
        <div><dt>Son yerel discovery</dt><dd>{status.localDiscovery ? `${formatAyasScheduleTime(status.localDiscovery.lastCompletedAt ?? status.localDiscovery.lastStartedAt)} · ${status.localDiscovery.status} · ${status.localDiscovery.candidateCount} aday / ${status.localDiscovery.proposalCount} yeni proposal` : "henüz kayıt yok"}</dd></div>
        <div><dt>Sıradaki yerel discovery</dt><dd>{formatAyasScheduleTime(status.localDiscovery?.nextExpectedAt)}</dd></div>
        <div><dt>Son hafif tarama (LIGHT)</dt><dd>{formatAyasScheduleTime(status.lastLightCompletedAt)}</dd></div>
        <div><dt>Sıradaki hafif tarama</dt><dd>{formatAyasScheduleTime(status.nextLightAt)}</dd></div>
        <div><dt>Son derin analiz (DEEP)</dt><dd>{formatAyasScheduleTime(status.lastDeepCompletedAt)}</dd></div>
        <div><dt>Sıradaki derin analiz</dt><dd>{formatAyasScheduleTime(status.nextDeepAt)}</dd></div>
        <div><dt>Hedef araştırması işleri</dt><dd>{status.pendingGoalCatchUpCount ?? 0} yakalama bekliyor · {status.awaitingOwnerGoalCount ?? 0} sahip onayı bekliyor · {status.skippedGoalCount ?? 0} atlandı · {status.runningGoalCount ?? 0} çalışıyor · {status.uncertainGoalCount ?? 0} belirsiz</dd></div>
        <div><dt>Son 24 saat</dt><dd>{status.digest.sourcesRegistered} kaynak izleniyor · {status.digest.sourcesChangedLast24h} değişti · {status.digest.findingsLast24h} yeni bulgu · {status.digest.sourcesFailingNow} kaynak hata veriyor</dd></div>
        {status.lastError ? <div><dt>Son hata</dt><dd>{status.lastError}</dd></div> : null}
      </dl>
    </section>
  );
}

const healthLabel = { HEALTHY: "sağlıklı", QUIET: "sessiz", DEGRADED: "sorunlu" } as const;
const bumpLabel = { MAJOR: "ana sürüm", MINOR: "ara sürüm", PATCH: "yama" } as const;

/** Research integration Phase 2/3b (owner plan 2026-10-15): research health, read-only. */
function ResearchHealthSection({ status }: { readonly status: AyasResearchEngineStatusView }) {
  const health = status.researchHealth;
  if (!status.connected || !health) return null;
  const tone = health.status === "DEGRADED" ? "bc-dev__notice--danger" : health.status === "HEALTHY" ? "bc-dev__notice--safe" : "bc-dev__notice--warn";
  return (
    <section className="bc-dev__section" aria-labelledby="ayas-research-health" data-testid="ayas-research-health">
      <h3 id="ayas-research-health">Araştırma Sağlığı <span className={`bc-dev__safety ${tone}`}>{healthLabel[health.status]}</span></h3>
      <dl className="bc-dev__facts">
        <div><dt>Son yeni bulgu</dt><dd>{formatAyasScheduleTime(health.lastFindingAt)}</dd></div>
        <div><dt>Son 7 gün</dt><dd>{health.findingsLast7d} bulgu · {health.groundedFindingsLast7d} tanesi kaynaktan birebir alıntıyla doğrulandı</dd></div>
        <div><dt>Güncellemesi olan araç</dt><dd>{health.trackedToolsWithUpdates}</dd></div>
      </dl>
      {health.reasons.length ? <ul>{health.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
    </section>
  );
}

const UPDATE_APPROVAL_REASON: Readonly<Record<string, string>> = {
  UPDATE_APPROVAL_ITEM_CHANGED: "Radar bu araç için değişti; kartın güncel hâlini yeniden onaylayın.",
  UPDATE_APPROVAL_ITEM_NOT_FOUND: "Bu güncelleme artık radarda yok.",
  UPDATE_APPROVAL_ALREADY_APPROVED: "Bu güncelleme zaten onaylı.",
  UPDATE_APPROVAL_NOT_APPROVED: "Geri alınacak bir onay yok.",
  UPDATE_APPROVAL_DECISION_CHANGED: "Bu araç için aynı anda başka bir karar kaydedildi; güncel durumu kontrol edin.",
  UPDATE_APPROVAL_ADMISSION_REJECTED: "Owner doğrulaması bu kararı kabul etmedi; yeniden giriş yapıp tekrar deneyin.",
  UPDATE_APPROVAL_RADAR_UNAVAILABLE: "Radar şu an okunamıyor; karar kaydedilmedi.",
  OWNER_ADMISSION_REQUIRED: "Doğrulanmış owner oturumu gerekiyor; yeniden giriş yapın.",
  OWNER_ADMISSION_GATE_UNAVAILABLE: "Owner doğrulaması bu sunucuda kullanılamıyor; karar kaydedilmedi.",
  AYAS_SAFE_READ_ONLY: "AYAS güvenli salt okunur kipte; karar kaydedilmedi.",
  AYAS_SAFE_MODE_UNAVAILABLE: "Güvenli kip durumu okunamadı; karar kaydedilmedi.",
  UPDATE_APPLY_TRIAL_NOT_FOUND: "Bu deneme bulunamadı.",
  UPDATE_APPLY_TRIAL_NOT_PASSED: "Deneme geçmediği için uygulanamaz.",
  UPDATE_APPLY_TRIAL_CHANGED: "Denenen paket dosyaları değişmiş; güncelleme yeniden denenecek.",
  UPDATE_APPLY_TRIAL_STALE: "Deneme yapıldıktan sonra kod değişti; güncelleme yeni koda göre yeniden denenecek.",
  UPDATE_APPLY_APPROVAL_WITHDRAWN: "Bu denemenin onayı geri alınmış.",
  UPDATE_APPLY_ALREADY_DECIDED: "Bu deneme için Uygula zaten kaydedildi.",
};

const TRIAL_STEP_LABEL: Readonly<Record<string, string>> = {
  WORKTREE: "ayrı kopya", NPM_CI: "mevcut bağımlılıklar", BASELINE_SMOKES: "güncelleme öncesi testler", NPM_INSTALL: "güncellemenin kurulması",
  LOCK_CHECK: "paket dosyası denetimi", SIGNATURES: "paket imzaları", TYPECHECK: "TypeScript", LINT: "lint", BUILD: "üretim derlemesi", SMOKES: "testler",
};
/** A failure in these steps means the code itself would have to change; AYAS cannot do that locally today. */
const CODE_CHANGE_STEPS = new Set(["TYPECHECK", "LINT", "BUILD", "SMOKES"]);
const APPLY_STATUS_LABEL: Readonly<Record<string, string>> = {
  RUNNING: "uygulanıyor", COMPLETED: "commit'lendi ve push'landı", STALE: "kod değiştiği için yeniden denenecek", REFUSED: "reddedildi; hiçbir şey değişmedi",
  ROLLED_BACK: "başarısız; değişiklik geri alındı", RECOVERY_REQUIRED: "yarıda kaldı; depo durumu elle doğrulanmalı", FAILED: "başarısız", ABANDONED: "yarıda kesildi; hiçbir şey değişmedi, yeniden denenecek",
};

function TrialSteps({ trial }: { readonly trial: AyasUpdateTrialView }) {
  return <ul>{trial.steps.map((step) => <li key={step.name}>{step.ok ? "✓" : "✗"} {TRIAL_STEP_LABEL[step.name] ?? step.name}: {step.summary.split("\n").at(-1)}</li>)}</ul>;
}

function UpdateTrialState({ trial, apply, onApply }: {
  readonly trial: AyasUpdateTrialView | undefined;
  readonly apply: AyasUpdateApplyRecord | undefined;
  readonly onApply: (input: { trialId: string; trialHash: string }) => Promise<string | undefined>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (!trial) return <p>Sırada: AYAS bu güncellemeyi ayrı bir kopyada deneyecek (makine uygun ve kod temizken, Observer&apos;ın bir sonraki turunda).</p>;
  if (apply) {
    const live = apply.live ? (apply.live.status === "PUBLISHED" ? "canlıda" : apply.live.status === "ROLLED_BACK" ? "canlıya alma sağlık denetiminden geçmedi; önceki sürüme dönüldü" : "canlıya alınamadı") : apply.livePending ? "canlıya alınıyor" : "";
    const tone = apply.status === "COMPLETED" && apply.live?.status === "PUBLISHED" ? "bc-dev__notice--safe" : apply.status === "RECOVERY_REQUIRED" || apply.status === "FAILED" ? "bc-dev__notice--danger" : "bc-dev__notice--warn";
    return (
      <div className={`bc-dev__notice ${tone}`} data-testid="ayas-update-apply-state">
        <strong>Uygula: {APPLY_STATUS_LABEL[apply.status] ?? apply.status}{live ? ` · ${live}` : ""}</strong>
        <p>{apply.commitSha ? `commit ${apply.commitSha.slice(0, 8)} · ` : ""}{formatAyasScheduleTime(apply.finishedAt ?? apply.startedAt)}{apply.closure && !apply.closure.ok ? " · bilgi grafiği güncellenemedi" : ""}</p>
        {apply.reasons?.length ? <ul>{apply.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
      </div>
    );
  }
  if (trial.status === "RUNNING") return <div className="bc-dev__notice bc-dev__notice--warn"><strong>Deneniyor…</strong><p>{trial.steps.length} adım bitti; sıradaki adım çalışıyor. Ana koda ve canlıya dokunulmuyor.</p><TrialSteps trial={trial} /></div>;
  if (trial.status === "ABANDONED") return <p>Deneme yarıda kesildi; AYAS yeniden deneyecek (iki kez yarıda kalırsa onayı yenileyerek yeniden başlatabilirsin).</p>;
  if (trial.status === "FAILED") {
    return (
      <div className="bc-dev__notice bc-dev__notice--danger" data-testid="ayas-update-trial-failed">
        <strong>Deneme başarısız: {TRIAL_STEP_LABEL[trial.failedStep ?? ""] ?? trial.failedStep}</strong>
        <p>{trial.failureReason} Ana koda ve canlıya hiçbir şey uygulanmadı.{trial.failedStep && CODE_CHANGE_STEPS.has(trial.failedStep) ? " Bu güncelleme kod değişikliği gerektiriyor; AYAS bunu şu an yerel olarak yapamaz." : ""}</p>
        <details><summary>Adımlar</summary><TrialSteps trial={trial} /></details>
        <p>Yeniden denemek için onayı geri alıp yeniden onayla.</p>
      </div>
    );
  }
  if (!trial.onCurrentHead || !trial.trialHash) return <p>Deneme geçti, ama o zamandan beri kod değişti; AYAS yeni koda göre yeniden deneyecek.</p>;
  const apply_ = async () => {
    setBusy(true); setMessage("");
    try {
      const code = await onApply({ trialId: trial.trialId, trialHash: trial.trialHash! });
      if (code) setMessage(UPDATE_APPROVAL_REASON[code] ?? "Karar kaydedilemedi.");
      else setConfirming(false);
    } catch { setMessage("Karar kaydedilemedi."); }
    finally { setBusy(false); }
  };
  return (
    <div className="bc-dev__notice bc-dev__notice--safe" data-testid="ayas-update-trial-passed">
      <strong>Deneme geçti</strong>
      <p>{trial.lockChanges ? `${trial.lockChanges.changed} paket değişiyor, ${trial.lockChanges.added} ekleniyor, ${trial.lockChanges.removed} kaldırılıyor. ` : ""}{trial.preExistingSmokeFailures.length ? `${trial.preExistingSmokeFailures.length} test güncellemeden önce de başarısızdı; sayılmadı.` : ""}</p>
      <details><summary>Adımlar</summary><TrialSteps trial={trial} /></details>
      {!confirming ? <button type="button" className="bc-btn" disabled={busy} onClick={() => setConfirming(true)}>Uygula</button> : (
        <div role="group" aria-label="Uygulama onayı">
          <strong>Uygularsam ne olacak?</strong>
          <p>Denenen paket dosyaları (yalnız package.json ve package-lock.json) commit&apos;lenir ve push&apos;lanır, sonra uygulama canlıya alınır. Telefon erişimi yaklaşık bir dakika kesilir. Canlı uygulama sağlık denetiminden geçmezse önceki sürüme kendiliğinden döner.</p>
          <button type="button" className="bc-btn" disabled={busy} onClick={apply_}>{busy ? "KAYDEDİLİYOR…" : "Evet, uygula"}</button>
          <button type="button" className="bc-btn" disabled={busy} onClick={() => setConfirming(false)}>Vazgeç</button>
        </div>
      )}
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}

function UpdateApprovalControl({ item, approval, trial, apply, onDecision, onApply }: {
  readonly item: AyasUpdateRadarItem;
  readonly approval: AyasUpdateApprovalView | undefined;
  readonly trial: AyasUpdateTrialView | undefined;
  readonly apply: AyasUpdateApplyRecord | undefined;
  readonly onDecision: (input: { sourceId: string; itemHash: string; decision: "APPROVE" | "WITHDRAW" }) => Promise<string | undefined>;
  readonly onApply: (input: { trialId: string; trialHash: string }) => Promise<string | undefined>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const decide = async (itemHash: string, decision: "APPROVE" | "WITHDRAW") => {
    setBusy(true); setMessage("");
    try {
      const code = await onDecision({ sourceId: item.sourceId, itemHash, decision });
      if (code) setMessage(UPDATE_APPROVAL_REASON[code] ?? "Karar kaydedilemedi.");
      else setConfirming(false);
    } catch { setMessage("Karar kaydedilemedi."); }
    finally { setBusy(false); }
  };
  const pinned = item.applyChannel === "OWNER_PINNED_RUNTIME";
  const current = approval?.itemHash === item.itemHash;
  return (
    <div className="bc-dev__facts" data-testid={`ayas-update-approval-${item.sourceId}`}>
      {approval ? (
        <div className={`bc-dev__notice ${current ? "bc-dev__notice--safe" : "bc-dev__notice--warn"}`}>
          <strong>{current ? "Onaylandı" : `${approval.targetVersion} için onayın var; şimdi ${item.latestVersion} çıktı`}</strong>
          <p>{formatAyasScheduleTime(approval.approvedAt)}{pinned ? " · yeniden sabitleme owner adımı" : ""}</p>
          {!pinned ? <UpdateTrialState trial={trial} apply={apply} onApply={onApply} /> : null}
          {apply?.status === "COMPLETED" ? null : <button type="button" className="bc-btn" disabled={busy} onClick={() => decide(approval.itemHash, "WITHDRAW")}>{busy ? "KAYDEDİLİYOR…" : "Onayı geri al"}</button>}
        </div>
      ) : null}
      {!current && !confirming ? <button type="button" className="bc-btn" disabled={busy} onClick={() => setConfirming(true)}>{approval ? `Bunun yerine ${item.latestVersion} sürümünü onayla` : pinned ? "Bu güncellemeyi onayla" : "Onayla ve dene"}</button> : null}
      {!current && confirming ? (
        <div className="bc-dev__notice bc-dev__notice--warn" role="group" aria-label="Güncelleme onayı">
          <strong>Onaylarsam ne olacak?</strong>
          <p>{pinned
            ? `Kararın ${item.toolName} ${item.installedVersion} → ${item.latestVersion} için kaydedilir. Node.js telefon erişimine sabitli; yeni sürümü kurup sabitlemek owner adımıdır.`
            : `AYAS ${item.toolName} ${item.installedVersion} → ${item.latestVersion} güncellemesini ayrı bir kopyada dener: kurar, paket imzalarını doğrular, TypeScript, lint, üretim derlemesi ve testleri çalıştırır. Bu sırada ana koda ve canlıya dokunmaz. Testler geçerse kartta "Uygula" çıkar; uygulama ancak sen ona basınca olur.`} Onayı istediğin zaman geri alabilirsin.</p>
          <button type="button" className="bc-btn" disabled={busy} onClick={() => decide(item.itemHash, "APPROVE")}>{busy ? "KAYDEDİLİYOR…" : pinned ? "Evet, onayla" : "Evet, onayla ve dene"}</button>
          <button type="button" className="bc-btn" disabled={busy} onClick={() => setConfirming(false)}>Vazgeç</button>
        </div>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}

/**
 * Update radar with a development brief per tool (owner decisions 2026-10-15: "dene, sonra uygula"). A card records
 * the owner's approval for that exact update; the observer's executor then tries it in a separate worktree and shows
 * the result here. Only a passed trial offers "Uygula", whose click is the one approval for that update's commit, push
 * and live publish. Nothing runs from this component; the hash-pinned Node.js runtime is re-pinned by the owner.
 */
function UpdateRadarSection({ status }: { readonly status: AyasResearchEngineStatusView }) {
  const [current, setCurrent] = useState(status);
  const radar = current.updateRadar;
  if (!current.connected || !radar) return null;
  const approvals = current.updateApprovals;
  const onDecision = async (input: { sourceId: string; itemHash: string; decision: "APPROVE" | "WITHDRAW" }) => {
    const result = await decideAyasUpdateRadarAction(input);
    setCurrent(result.status);
    return result.ok ? undefined : result.code ?? "UPDATE_APPROVAL_FAILED";
  };
  const onApply = async (input: { trialId: string; trialHash: string }) => {
    const result = await applyAyasUpdateTrialAction(input);
    setCurrent(result.status);
    return result.ok ? undefined : result.code ?? "UPDATE_APPLY_FAILED";
  };
  const trialFor = (approval: AyasUpdateApprovalView | undefined) => approval ? current.updateTrials?.find((trial) => trial.approvalDecisionId === approval.decisionId) : undefined;
  const applyFor = (trial: AyasUpdateTrialView | undefined) => trial ? current.updateApplies?.find((apply) => apply.trialId === trial.trialId) : undefined;
  const offRadar = (approvals ?? []).filter((approval) => !radar.some((item) => item.sourceId === approval.sourceId));
  return (
    <section className="bc-dev__section" aria-labelledby="ayas-update-radar" data-testid="ayas-update-radar">
      <h3 id="ayas-update-radar">Güncelleme Radarı <span>{radar.length}</span></h3>
      <p>AYAS&apos;ın izlediği araçlarda kurulu sürümden yeni kararlı sürümler. Hiçbiri kendiliğinden uygulanmaz: onayladığını AYAS önce ayrı bir kopyada dener; testler geçerse uygulama ancak sen &quot;Uygula&quot;ya basınca olur.</p>
      {!approvals ? <p className="bc-empty">Onay durumu okunamadı; onay düğmeleri gizlendi.</p> : null}
      {offRadar.length ? <ul data-testid="ayas-update-approvals-off-radar">{offRadar.map((approval) => <li key={approval.decisionId}>{approval.toolName} {approval.targetVersion}: {approval.status === "APPLIED" ? `uygulandı (kurulu ${approval.currentInstalledVersion})` : "onaylı, uygulanmayı bekliyor"} · onay {formatAyasScheduleTime(approval.approvedAt)}</li>)}</ul> : null}
      {radar.length ? radar.map((item) => (
        <article key={item.sourceId} className="bc-dev__proposal" data-testid={`ayas-update-radar-${item.sourceId}`}>
          <header className="bc-dev__proposal-head">
            <div><h3>{item.toolName}: {item.installedVersion} → {item.latestVersion}</h3></div>
            <span className={`bc-dev__safety ${item.bump === "MAJOR" ? "bc-dev__notice--warn" : "bc-dev__notice--safe"}`}>{bumpLabel[item.bump]}</span>
          </header>
          <dl className="bc-dev__facts">
            <div><dt>Hedef</dt><dd>{item.target} · {item.newerStableReleases} yeni kararlı sürüm</dd></div>
            <div><dt>Kaynak</dt><dd><a href={item.latestUrl} target="_blank" rel="noreferrer noopener">{item.latestUrl}</a> · görüldü {formatAyasScheduleTime(item.lastSeenAt)}</dd></div>
            <div><dt>Uygulama</dt><dd>{item.applyChannel === "OWNER_PINNED_RUNTIME" ? "Sabitlenmiş çalışma ortamı: owner yeniden sabitler" : "Onaylarsan AYAS ayrı bir kopyada dener; geçerse Uygula ile commit'lenir ve canlıya alınır"}</dd></div>
          </dl>
          {item.evidence.length ? <div className="bc-dev__facts"><strong>Kaynaktan alıntılar</strong><ul>{item.evidence.map((entry) => <li key={entry.findingId}><q>{entry.quote}</q> — <a href={entry.url} target="_blank" rel="noreferrer noopener">kaynak</a></li>)}</ul></div> : null}
          <details>
            <summary>Geliştirme özeti</summary>
            <dl className="bc-dev__facts">
              <div><dt>Özet</dt><dd>{item.brief.summary}</dd></div>
              <div><dt>Etkilenen dosyalar</dt><dd>{item.brief.affectedFileCount}{item.brief.affectedFiles.length ? `: ${item.brief.affectedFiles.join(", ")}${item.brief.affectedFileCount > item.brief.affectedFiles.length ? " …" : ""}` : ""}</dd></div>
              <div><dt>Doğrulama planı</dt><dd><ul>{item.brief.validation.map((step) => <li key={step}>{step}</li>)}</ul></dd></div>
              <div><dt>Risk</dt><dd>{item.brief.risk}</dd></div>
            </dl>
          </details>
          {approvals ? (() => {
            const approval = approvals.find((entry) => entry.sourceId === item.sourceId);
            const trial = trialFor(approval);
            return <UpdateApprovalControl item={item} approval={approval} trial={trial} apply={applyFor(trial)} onDecision={onDecision} onApply={onApply} />;
          })() : null}
        </article>
      )) : <p className="bc-empty">İzlenen araçların hepsi güncel.</p>}
    </section>
  );
}

const verdictLabel = { BETTER: "daha iyi", SIMILAR: "benzer", WORSE: "daha zayıf" } as const;
const candidateStatusLabel: Record<AyasModelCandidateView["status"], string> = {
  MEASURED: "ölçüldü", INSTALLED_UNMEASURED: "kurulu, ölçülmedi", NOT_INSTALLED: "kurulu değil",
};
const fitLabel: Record<AyasModelCandidateView["fit"], string> = {
  FITS: "ekran kartına sığar", SPILLS: "ekran kartına sığmaz, bir kısmı işlemcide çalışır", UNKNOWN: "sığıp sığmadığı bilinmiyor",
};
const categoryLabel: Record<keyof AyasMeasuredModelView["byCategory"], string> = {
  KNOWLEDGE: "bilgi", ARITHMETIC: "hesap", INSTRUCTION: "talimat", CONTEXT: "bağlam", HONESTY: "dürüstlük",
};
const formatGb = (bytes: number) => `${(bytes / 1e9).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} GB`;

function MeasuredModelCard({ entry }: { readonly entry: AyasMeasuredModelView }) {
  return (
    <article className="bc-dev__proposal" data-testid={`ayas-model-measured-${entry.model}`}>
      <header className="bc-dev__proposal-head">
        <div><h3>{entry.model}{entry.isIncumbent ? " (şu an kullanılan)" : ""}: {entry.total} sorudan {entry.passed}</h3></div>
        {entry.verdict ? <span className={`bc-dev__safety ${entry.verdict === "BETTER" ? "bc-dev__notice--safe" : "bc-dev__notice--warn"}`}>{verdictLabel[entry.verdict]}</span> : null}
      </header>
      <dl className="bc-dev__facts">
        <div><dt>Konulara göre</dt><dd>{(Object.keys(entry.byCategory) as (keyof AyasMeasuredModelView["byCategory"])[]).map((category) => `${categoryLabel[category]} ${entry.byCategory[category].passed}/${entry.byCategory[category].total}`).join(" · ")}</dd></div>
        <div><dt>Yanıt süresi (ortanca, model yükleme dahil)</dt><dd>{(entry.latencyMedianMs / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} sn</dd></div>
        {entry.gpuShare !== undefined ? <div><dt>Ekran kartında</dt><dd>%{Math.round(entry.gpuShare * 100)}</dd></div> : null}
        <div><dt>Ölçüldü</dt><dd>{formatAyasScheduleTime(entry.measuredAt)}</dd></div>
        {entry.reasons.length ? <div><dt>Not</dt><dd>{entry.reasons.join("; ")}</dd></div> : null}
      </dl>
      {entry.failedCases.length ? <details><summary>Geçemediği sorular ({entry.failedCases.length})</summary><ul>{entry.failedCases.map((failure) => <li key={failure.id}>{failure.id} ({failure.attempts} denemede {failure.passes}): {failure.reason}</li>)}</ul></details> : null}
    </article>
  );
}

/**
 * Model comparison (owner request 2026-10-15), read-only: the AYAS chat model, the measured alternatives and newer
 * candidates. Downloading or switching a model is an owner decision carried out in a development session.
 */
function ModelWatchSection({ watch }: { readonly watch: AyasModelWatchView | undefined }) {
  if (!watch) return null;
  const decide = watch.recommendation.kind === "SWITCH" || watch.recommendation.kind === "DOWNLOAD_TO_MEASURE";
  return (
    <section className="bc-dev__section" aria-labelledby="ayas-model-watch" data-testid="ayas-model-watch">
      <h3 id="ayas-model-watch">Yapay Zekâ Modeli <span>{watch.incumbentModel}</span></h3>
      <p>AYAS&apos;ın sohbet modeli, aynı donmuş Türkçe testle ({watch.benchmarkId}; her soru üç kez sorulur, çoğunlukla geçer) yeni çıkan yerel modellerle karşılaştırılır. Hiçbir model kendiliğinden indirilmez veya değiştirilmez.</p>
      <div className={`bc-dev__notice ${decide ? "bc-dev__notice--warn" : "bc-dev__notice--safe"}`} data-testid="ayas-model-recommendation"><strong>Öneri</strong><p>{watch.recommendation.text}</p></div>
      {watch.measured.map((entry) => <MeasuredModelCard key={entry.model} entry={entry} />)}
      <details>
        <summary>İzlenen yeni modeller ({watch.candidates.length})</summary>
        <ul>{watch.candidates.map((candidate) => (
          <li key={candidate.tag} data-testid={`ayas-model-candidate-${candidate.tag}`}>
            <strong>{candidate.tag}</strong> ({candidate.publisher}, {candidate.license}) · {candidateStatusLabel[candidate.status]}
            {candidate.totalBytes ? ` · ${formatGb(candidate.totalBytes)}` : ""} · {fitLabel[candidate.fit]} — {candidate.note}
          </li>
        ))}</ul>
      </details>
      <dl className="bc-dev__facts">
        <div><dt>Son ölçüm</dt><dd>{formatAyasScheduleTime(watch.lastMeasuredAt)}</dd></div>
        <div><dt>Model deposu son kontrol</dt><dd>{formatAyasScheduleTime(watch.registryCheckedAt)}</dd></div>
        {watch.gpuName ? <div><dt>Ekran kartı</dt><dd>{watch.gpuName}</dd></div> : null}
      </dl>
    </section>
  );
}

/** Stable scheduler codes only (validated `[A-Z_]`); never raw errors or source text. */
const GOAL_JOB_REASON: Readonly<Record<string, string>> = {
  INSUFFICIENT_SOURCE_EVIDENCE: "kayıtlı resmî kaynaklarda hedefe uygun yeni bilgi bulunamadı",
  RESEARCH_SOURCE_FAILURE: "kaynaklardan en az biri okunamadı",
  RESEARCH_ANALYSIS_FAILED: "yerel analiz veya kayıt başarısız oldu; otomatik tekrarlanmaz",
  OWNER_CONFIRMATION_EXPIRED: "onayın süresi doldu; yeniden onayınızı bekliyor",
  PACING_REQUIRES_OWNER: "kaynak sıklık sınırı nedeniyle zamanında çalışamadı; onayınızı bekliyor",
  PACING_WINDOW_EXCEEDED: "kaynak sıklık sınırı izin verilen süreyi aştı; atlandı",
  GOAL_TICK_FAILED: "iş işlenemedi; kaynak veya model çağrısı yapılmadan atlandı",
  EVIDENCE_ALREADY_RECORDED: "kaynaktaki bilgi zaten kayıtlı; yeni bulgu yok",
  RESEARCH_OUTCOME_UNCERTAIN: "yarıda kesildi; sonuç belirsiz, otomatik tekrarlanmaz",
  MISSED_REQUIRES_OWNER: "kaçırıldı; onayınızı bekliyor",
  MULTIPLE_MISSED_REQUIRES_OWNER: "birden çok iş kaçırıldı; onayınızı bekliyor",
  MISSED_STALE: "kaçırıldı ve bayatladı; atlandı",
  GOAL_SCOPE_STALE: "hedef değişti; eski plan atlandı",
  GOAL_UNAVAILABLE: "hedef okunamadı; atlandı",
  SOURCE_REGISTRY_CHANGED: "seçilen kaynak artık kayıtlı değil; atlandı",
};

function GoalResearchScheduleControls({ status }: { readonly status: AyasResearchEngineStatusView }) {
  const [intent, setIntent] = useState("");
  const [sourceId, setSourceId] = useState(status.sources.find((source) => source.officialSource)?.sourceId ?? "");
  const [localTime, setLocalTime] = useState("");
  const [policy, setPolicy] = useState<"CATCH_UP_ONCE" | "SKIP_AS_STALE" | "REQUIRE_OWNER_CONFIRMATION">("REQUIRE_OWNER_CONFIRMATION");
  const [jobs, setJobs] = useState(status.goalResearchJobs ?? []);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => setJobs((await refreshAyasResearchEngineStatus()).goalResearchJobs ?? []);
  const submit = async () => {
    setBusy(true); setMessage("");
    try {
      const when = new Date(localTime);
      if (!Number.isFinite(when.getTime())) throw new Error("Geçerli bir zaman seçin.");
      const roundTripLocal = new Date(when.getTime() - when.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
      if (roundTripLocal !== localTime.slice(0, 16)) throw new Error("Bu yerel saat yaz saati geçişinde mevcut değil; başka bir saat seçin.");
      const result = await createAndScheduleAyasGoalResearchAction({
        userIntent: intent, sourceIds: [sourceId], scheduledFor: when.toISOString(), catchUpPolicy: policy,
      });
      await refresh();
      setMessage(`Araştırma planlandı: ${result.jobId}`);
      setIntent("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Araştırma planlanamadı."); }
    finally { setBusy(false); }
  };
  const control = async (jobId: string, action: "CONFIRM" | "CANCEL" | "SKIP") => {
    setBusy(true); setMessage("");
    try { await controlAyasGoalResearchAction(jobId, action); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "İş güncellenemedi."); }
    finally { setBusy(false); }
  };

  return <section className="bc-dev__section" aria-label="Hedef araştırması planla">
    <h3>Hedef araştırması planla</h3>
    <p>Kayıtlı resmî kaynaktan hedefinize uygun yeni sürüm bilgilerini tarar. Bilgisayar kapalıyken çalışma gerçekleşmez.</p>
    <div className="bc-dev__facts">
      <label>Hedef <input value={intent} maxLength={300} onChange={(event) => setIntent(event.target.value)} placeholder="Araştırılacak hedef" /></label>
      <label>Resmî kaynak <select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>{status.sources.filter((source) => source.officialSource).map((source) => <option key={source.sourceId} value={source.sourceId}>{source.provider} · {source.category}</option>)}</select></label>
      <label>Planlanan zaman (tarayıcı yerel saati) <input type="datetime-local" value={localTime} onChange={(event) => setLocalTime(event.target.value)} /></label>
      {localTime && Number.isFinite(new Date(localTime).getTime()) ? <small>Kaydedilecek UTC: {new Date(localTime).toISOString()}</small> : null}
      <label>Kaçırılırsa <select value={policy} onChange={(event) => setPolicy(event.target.value as typeof policy)}><option value="REQUIRE_OWNER_CONFIRMATION">Benden onay iste</option><option value="CATCH_UP_ONCE">24 saat içinde bir kez çalıştır</option><option value="SKIP_AS_STALE">Atla</option></select></label>
      <button type="button" disabled={busy || !intent.trim() || !sourceId || !localTime} onClick={submit}>Planla</button>
    </div>
    {message ? <p role="status">{message}</p> : null}
    <button type="button" disabled={busy} onClick={() => { void refresh().catch(() => setMessage("İş durumları okunamadı.")); }}>İş durumlarını yenile</button>
    {jobs.length ? <ul>{jobs.slice(-20).reverse().map((job) => <li key={job.jobId}>
      <strong>{job.status}</strong> · {job.goalId} · plan {formatAyasScheduleTime(job.scheduledFor)}{job.executedAt ? ` · çalıştı ${formatAyasScheduleTime(job.executedAt)}` : ""}
      {job.findingsRecorded !== undefined ? ` · ${job.findingsRecorded} bulgu` : ""}{job.errorCode ? ` · ${GOAL_JOB_REASON[job.errorCode] ?? job.errorCode}` : ""}
      {job.status === "AWAITING_OWNER" ? <button type="button" disabled={busy} onClick={() => control(job.jobId, "CONFIRM")}>Yakalama çalışmasını onayla</button> : null}
      {job.status === "SCHEDULED" || job.status === "AWAITING_OWNER" ? <><button type="button" disabled={busy} onClick={() => control(job.jobId, "SKIP")}>Atla</button><button type="button" disabled={busy} onClick={() => control(job.jobId, "CANCEL")}>İptal et</button></> : null}
    </li>)}</ul> : null}
  </section>;
}

function SourceRow({ source }: { readonly source: AyasResearchEngineSourceView }) {
  const tone = source.status === "ERROR" ? "bc-dev__notice--danger" : source.status === "OK" ? "bc-dev__notice--safe" : "bc-dev__notice--warn";
  return (
    <li data-testid={`ayas-research-source-${source.sourceId}`}>
      <strong>{source.provider}</strong> <span className={`bc-dev__safety ${tone}`}>{sourceStatusLabel[source.status]}</span>
      <span> — {source.category}{source.officialSource ? " · resmi kaynak" : ""}{source.lastCheckedAt ? ` · son kontrol: ${new Date(source.lastCheckedAt).toLocaleString("tr-TR")}` : ""}{source.consecutiveFailures > 0 ? ` · ${source.consecutiveFailures} ardışık hata` : ""}</span>
    </li>
  );
}

function ResearchSourcesSection({ status }: { readonly status: AyasResearchEngineStatusView }) {
  if (!status.connected || status.sources.length === 0) return null;
  return (
    <section className="bc-dev__section" aria-labelledby="ayas-research-sources">
      <h3 id="ayas-research-sources">Kaynaklar <span>{status.sources.length}</span></h3>
      <ul>{status.sources.map((source) => <SourceRow key={source.sourceId} source={source} />)}</ul>
    </section>
  );
}

export function AyasGoalResearchPanel({ view, researchEngineStatus }: { readonly view: AyasGoalDevelopmentView; readonly researchEngineStatus?: AyasResearchEngineStatusView }) {
  if (!view.connected) return <div className="bc-empty" role="alert"><strong>Hedefler ve Araştırma okunamadı</strong><p>{view.error || "Kalıcı durum deposuna ulaşılamıyor."}</p></div>;
  return (
    <section className="bc-dev" aria-label="AYAS Hedefler ve Araştırma" data-testid="ayas-goal-research-panel">
      <header className="bc-dev__hero"><span>Hedef odaklı gelişim</span><h2>Hedefler ve Dış Araştırma</h2><p>AYAS&apos;ın hangi yüksek seviyeli hedefler üzerinde çalıştığını ve internetten hangi gerçek yetenekleri araştırıp Atölye ile karşılaştırdığını gör.</p></header>
      {researchEngineStatus ? <ResearchEngineStatusSection status={researchEngineStatus} /> : null}
      {researchEngineStatus ? <ResearchHealthSection status={researchEngineStatus} /> : null}
      {researchEngineStatus ? <UpdateRadarSection status={researchEngineStatus} /> : null}
      {researchEngineStatus?.connected ? <ModelWatchSection watch={researchEngineStatus.modelWatch} /> : null}
      {researchEngineStatus?.connected ? <GoalResearchScheduleControls status={researchEngineStatus} /> : null}
      {researchEngineStatus ? <ResearchSourcesSection status={researchEngineStatus} /> : null}
      <section className="bc-dev__section" aria-labelledby="ayas-goals-active"><h3 id="ayas-goals-active">Aktif Hedefler <span>{view.goals.filter((g) => g.status !== "COMPLETED" && g.status !== "CANCELLED").length}</span></h3>
        {view.goals.filter((g) => g.status !== "COMPLETED" && g.status !== "CANCELLED").length
          ? view.goals.filter((g) => g.status !== "COMPLETED" && g.status !== "CANCELLED").map((g) => <GoalCard key={g.goalId} goal={g} />)
          : <p className="bc-empty">Şu anda aktif bir hedef yok.</p>}
      </section>
      <section className="bc-dev__section" aria-labelledby="ayas-research-findings"><h3 id="ayas-research-findings">Bugün Neler Araştırıldı? <span>{view.research.length}</span></h3>
        {view.research.length ? view.research.slice(0, 20).map((f) => <ResearchFindingCard key={f.findingId} finding={f} />) : <p className="bc-empty">Henüz kaydedilmiş bir dış araştırma bulgusu yok.</p>}
      </section>
      {view.goals.some((g) => g.status === "COMPLETED" || g.status === "CANCELLED") ? (
        <section className="bc-dev__section" aria-labelledby="ayas-goals-history"><h3 id="ayas-goals-history">Geçmiş Hedefler <span>{view.goals.filter((g) => g.status === "COMPLETED" || g.status === "CANCELLED").length}</span></h3>
          {view.goals.filter((g) => g.status === "COMPLETED" || g.status === "CANCELLED").map((g) => <GoalCard key={g.goalId} goal={g} />)}
        </section>
      ) : null}
    </section>
  );
}
