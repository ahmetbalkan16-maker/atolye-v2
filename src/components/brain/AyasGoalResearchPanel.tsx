"use client";

import { useState } from "react";
import { createAndScheduleAyasGoalResearchAction, controlAyasGoalResearchAction } from "../../../app/brain/actions";
import { refreshAyasResearchEngineStatus } from "../../../app/brain/observerActions";

import type { AyasGoalDevelopmentView, AyasGoalDevelopmentEntry } from "@/lib/brain/autonomy/AyasGoalDevelopmentView";
import type { AyasGoalStatus } from "@/lib/brain/autonomy/AyasGoalStore";
import type { AyasExternalResearchFinding } from "@/lib/brain/autonomy/AyasExternalResearchStore";
import type { AyasResearchEngineStatusView, AyasResearchEngineSourceView, AyasResearchEngineSourceStatus } from "@/lib/brain/autonomy/AyasResearchEngineStatusView";

/**
 * M22.14 — read-only Gelişim Merkezi view of AYAS's goals and external
 * capability research. No action buttons here by design: a goal or a
 * research finding is never itself an authority surface (AyasGoalStore has
 * no execute/approve/gate method at all — see its own smoke test), so this
 * panel only ever displays durable state. Any candidate that reaches
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
        <div><dt>Çözdüğü problem</dt><dd>{finding.problemSolved}</dd></div>
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
