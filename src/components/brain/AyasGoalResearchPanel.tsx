"use client";

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
        <div><dt>Son 24 saat</dt><dd>{status.digest.sourcesRegistered} kaynak izleniyor · {status.digest.sourcesChangedLast24h} değişti · {status.digest.findingsLast24h} yeni bulgu · {status.digest.sourcesFailingNow} kaynak hata veriyor</dd></div>
        {status.lastError ? <div><dt>Son hata</dt><dd>{status.lastError}</dd></div> : null}
      </dl>
    </section>
  );
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
