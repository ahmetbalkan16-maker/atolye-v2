/**
 * Stage 11 — AYAS Brain Control Center UI.
 *
 * Presentational only. It renders `buildAyasControlCenterView` output and the
 * sanitised server facts from `AyasControlCenterCollector`, which arrive as a
 * streamed promise (resolved with React `use` inside a Suspense boundary, so
 * the orb and chat never wait on it) or as an already-refreshed value.
 *
 * Every action here is classified (`AyasCcActionClass`) and is either
 * navigation to an existing Brain panel — whose own controls call the
 * existing approval and execution services — or a command shown for the
 * owner to run. Nothing in this module can decide, approve, execute, publish
 * or write. No fetch, no timer, no polling.
 */

import { Suspense, use, type ReactNode } from "react";

import {
  AYAS_CC_ACTION_LABEL,
  AYAS_CC_ATTENTION_LABEL,
  ayasCcCapabilityRow,
  ayasCcFormatTime,
  ayasCcShortSha,
  ayasCcSplitAttention,
  buildAyasControlCenterView,
  type AyasCcActivityItem,
  type AyasCcAttentionItem,
  type AyasCcDomainId,
  type AyasCcDomainStatus,
  type AyasCcFact,
  type AyasCcPanelTarget,
  type AyasControlCenterInput,
  type AyasControlCenterServerFacts,
  type AyasControlCenterView,
} from "@/lib/brain/ui/AyasControlCenterModel";
import type { AyasApprovalInboxView } from "@/lib/brain/autonomy/AyasApprovalInboxView";

/** Where the server facts come from: the page's streamed read, or a later refresh (`undefined` = none yet). */
export interface AyasControlCenterSources {
  readonly facts?: Promise<AyasControlCenterServerFacts | null>;
  readonly override?: AyasControlCenterServerFacts | null;
}

export type AyasControlCenterInputs = Omit<AyasControlCenterInput, "server">;

function useControlCenterFacts(sources: AyasControlCenterSources | undefined): AyasControlCenterServerFacts | null {
  if (sources?.override !== undefined) return sources.override;
  return sources?.facts ? use(sources.facts) : null;
}

function CcLoading({ label }: { label: string }) {
  return (
    <p className="bc-empty bc-cc-loading" role="status" aria-busy="true" data-testid="bc-cc-loading">
      {label} okunuyor…
    </p>
  );
}

/** Resolves the facts once, inside its own Suspense boundary, and renders `children` with them. */
function WithFacts({ sources, label, children }: { sources?: AyasControlCenterSources; label: string; children: (server: AyasControlCenterServerFacts | null) => ReactNode }) {
  return (
    <Suspense fallback={<CcLoading label={label} />}>
      <FactsResolver sources={sources}>{children}</FactsResolver>
    </Suspense>
  );
}

function FactsResolver({ sources, children }: { sources?: AyasControlCenterSources; children: (server: AyasControlCenterServerFacts | null) => ReactNode }) {
  return <>{children(useControlCenterFacts(sources))}</>;
}

const DOMAIN_SHORT: Readonly<Record<AyasCcDomainId, string>> = {
  health: "Sağlık", autonomy: "Otonomi", approvals: "Onay", development: "Geliştirme", graphify: "Graphify", research: "Araştırma",
  experiments: "Deney", memory: "Bellek", capabilities: "Yetenek", security: "Güvenlik", atolye: "Atölye", reports: "Rapor",
};

function levelClass(level: string): string { return level.toLowerCase().replace(/_/g, "-"); }

/* ------------------------------------------------------ stage blocks --- */

interface StageProps {
  readonly sources?: AyasControlCenterSources;
  readonly inputs: AyasControlCenterInputs;
  readonly onOpenPanel?: (panel: AyasCcPanelTarget) => void;
}

function useView(props: StageProps): AyasControlCenterView {
  const server = useControlCenterFacts(props.sources);
  return buildAyasControlCenterView({ ...props.inputs, server });
}

/** Phase 6/7 — the first thing on the home screen: overall state and what needs the owner now. */
export function AyasOwnerAttention(props: StageProps) {
  return (
    <Suspense fallback={<CcLoading label="Kontrol merkezi" />}>
      <OwnerAttentionBody {...props} />
    </Suspense>
  );
}

function OwnerAttentionBody(props: StageProps) {
  const view = useView(props);
  const now = view.generatedAt;
  return (
    <section className="bc-cc" aria-labelledby="bc-cc-title" data-testid="bc-control-center" data-overall={view.overall.level}>
      <header className="bc-cc__head">
        <h2 id="bc-cc-title" className="bc-cc__title">Kontrol Merkezi</h2>
        <p className={`bc-cc-overall bc-cc--${levelClass(view.overall.level)}`} role="status" data-testid="bc-cc-overall">
          <span className="bc-cc-level">{AYAS_CC_ATTENTION_LABEL[view.overall.level]}</span>
          <span>{view.overall.label}</span>
        </p>
        <p className="bc-cc-meta">
          Sunucu okuması: {view.generatedAt ? ayasCcFormatTime(view.generatedAt, now) : "yok"}
          {" · "}Yol haritası, sıradaki aşama: {view.roadmapNextStage ?? "—"}
        </p>
      </header>
      <h3 className="bc-cc__subtitle" id="bc-cc-attention-title">Sahibin dikkatine</h3>
      {view.attention.length === 0 ? (
        <p className="bc-empty" data-testid="bc-cc-attention-empty">Şu an kararını veya müdahaleni bekleyen bir şey yok.</p>
      ) : (
        <AttentionList items={view.attention} now={now} onOpenPanel={props.onOpenPanel} />
      )}
    </section>
  );
}

function AttentionList({ items, now, onOpenPanel }: { items: readonly AyasCcAttentionItem[]; now: string | null; onOpenPanel?: (panel: AyasCcPanelTarget) => void }) {
  const { shown, folded } = ayasCcSplitAttention(items);
  return (
    <>
      <ul className="bc-cc-attention" aria-labelledby="bc-cc-attention-title" data-testid="bc-cc-attention">
        {shown.map((item) => <AttentionItem key={item.id} item={item} now={now} onOpenPanel={onOpenPanel} />)}
      </ul>
      {folded.length > 0 ? (
        <details className="bc-cc-details bc-cc-more" data-testid="bc-cc-attention-more">
          <summary>Diğer {folded.length} madde ({folded.filter((item) => item.level === "WARNING").length} uyarı · {folded.filter((item) => item.level === "IN_PROGRESS").length} süren)</summary>
          <ul className="bc-cc-attention">
            {folded.map((item) => <AttentionItem key={item.id} item={item} now={now} onOpenPanel={onOpenPanel} />)}
          </ul>
        </details>
      ) : null}
    </>
  );
}

function AttentionItem({ item, now, onOpenPanel }: { item: AyasCcAttentionItem; now: string | null; onOpenPanel?: (panel: AyasCcPanelTarget) => void }) {
  const next = item.next;
  const panel = next.panel;
  return (
    <li className={`bc-cc-item bc-cc--${levelClass(item.level)}`} data-testid={`bc-cc-attention-${item.id}`} data-level={item.level}>
      <p className="bc-cc-item__head">
        <span className="bc-cc-level">{AYAS_CC_ATTENTION_LABEL[item.level]}</span>
        <strong>{item.title}</strong>
      </p>
      <p className="bc-cc-item__reason">{item.reason}</p>
      <p className="bc-cc-meta">Kaynak: {item.source} · {item.at ? ayasCcFormatTime(item.at, now) : "zaman bilgisi yok"}</p>
      {item.details.length > 0 ? (
        <details className="bc-cc-details">
          <summary>Ayrıntılar ({item.details.length})</summary>
          <ul>{item.details.map((line, index) => <li key={index}>{line}</li>)}</ul>
        </details>
      ) : null}
      <div className="bc-cc-next" data-action-kind={next.kind}>
        <span className="bc-cc-action">{AYAS_CC_ACTION_LABEL[next.kind]}</span>
        {panel && onOpenPanel ? (
          <button type="button" className="bc-btn bc-btn--ghost bc-cc-go" onClick={() => onOpenPanel(panel)} data-testid={`bc-cc-go-${item.id}`}>
            {next.label} →
          </button>
        ) : (
          <span className="bc-cc-next__label">{next.label}</span>
        )}
        {next.command ? <code className="bc-cc-command">{next.command}</code> : null}
      </div>
    </li>
  );
}

/** Phase 5 — one tile per domain, status in words, freshness of the data itself. */
export function AyasDomainTiles(props: StageProps) {
  return (
    <Suspense fallback={<CcLoading label="Alan durumları" />}>
      <DomainTilesBody {...props} />
    </Suspense>
  );
}

function DomainTilesBody(props: StageProps) {
  const view = useView(props);
  return (
    <section className="bc-cc bc-cc--plain" aria-labelledby="bc-cc-domains-title">
      <h3 className="bc-cc__subtitle" id="bc-cc-domains-title">Alanlar</h3>
      <div className="bc-cc-tiles" data-testid="bc-cc-domains">
        {view.domains.map((domain) => <DomainTile key={domain.id} domain={domain} now={view.generatedAt} onOpenPanel={props.onOpenPanel} />)}
      </div>
      <ActivityList items={view.activity} now={view.generatedAt} />
    </section>
  );
}

function DomainTile({ domain, now, onOpenPanel }: { domain: AyasCcDomainStatus; now: string | null; onOpenPanel?: (panel: AyasCcPanelTarget) => void }) {
  const body = (
    <>
      <span className="bc-cc-tile__k">{domain.title}</span>
      <span className="bc-cc-tile__v">
        <span className="bc-cc-level">{AYAS_CC_ATTENTION_LABEL[domain.attention]}</span> {domain.statusLabel}
      </span>
      <span className="bc-cc-tile__s">{domain.summary}</span>
      <span className="bc-cc-tile__t">{domain.dataAtLabel}: {domain.dataAt ? ayasCcFormatTime(domain.dataAt, now) : "—"}</span>
    </>
  );
  const className = `bc-cc-tile bc-cc--${levelClass(domain.attention)}`;
  const panel = domain.panel;
  if (panel && onOpenPanel) {
    return (
      <button type="button" className={`${className} bc-cc-tile--link`} onClick={() => onOpenPanel(panel)} data-testid={`bc-cc-domain-${domain.id}`} data-attention={domain.attention} data-availability={domain.availability}>
        {body}
      </button>
    );
  }
  return <div className={className} data-testid={`bc-cc-domain-${domain.id}`} data-attention={domain.attention} data-availability={domain.availability}>{body}</div>;
}

function ActivityList({ items, now }: { items: readonly AyasCcActivityItem[]; now: string | null }) {
  return (
    <>
      <h3 className="bc-cc__subtitle" id="bc-cc-activity-title">Son etkinlik</h3>
      {items.length === 0 ? (
        <p className="bc-empty" data-testid="bc-cc-activity-empty">Son 14 günde kayıtlı bir durum değişikliği yok.</p>
      ) : (
        <ol className="bc-cc-activity" aria-labelledby="bc-cc-activity-title" data-testid="bc-cc-activity">
          {items.map((item) => (
            <li key={item.id}>
              <time dateTime={item.at}>{ayasCcFormatTime(item.at, now)}</time>
              <span className="bc-cc-chip">{DOMAIN_SHORT[item.domain]}</span>
              <span className="bc-cc-activity__title">{item.title}</span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/* ---------------------------------------------------- detail blocks --- */

function FactBody<T>({ fact, absent, testid, children }: { fact: AyasCcFact<T> | undefined; absent: string; testid: string; children: (value: T, observedAt: string) => ReactNode }) {
  if (!fact) return <p className="bc-empty" role="status" data-testid={`${testid}-server-unavailable`}>Kontrol merkezi sunucu okuması başarısız — durumu yenile.</p>;
  if (fact.kind === "absent") return <p className="bc-empty" data-testid={`${testid}-absent`}>{absent}</p>;
  if (fact.kind === "unavailable") {
    return (
      <p className="bc-alert" role="alert" data-testid={`${testid}-unavailable`}>
        Okunamadı ({fact.code === "TIMEOUT" ? "zaman aşımı" : fact.code}) · {ayasCcFormatTime(fact.observedAt, null)}
      </p>
    );
  }
  return <>{children(fact.value, fact.observedAt)}</>;
}

function Facts({ rows }: { rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="bc-dev__facts">
      {rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
  );
}

function Observed({ at }: { at: string }) {
  return <p className="bc-cc-meta">Okundu: {ayasCcFormatTime(at, null)}</p>;
}

/** Phase 9 — Stage 10 repository truth, at the top of Gelişim Merkezi. */
export function AyasRepositorySection({ sources }: { sources?: AyasControlCenterSources }) {
  return (
    <section className="bc-dev__section" aria-labelledby="bc-cc-repo-title" data-testid="bc-cc-repository">
      <h3 id="bc-cc-repo-title">Depo ve geliştirme durumu</h3>
      <WithFacts sources={sources} label="Depo durumu">
        {(server) => (
          <FactBody fact={server?.development} absent="Depo durumu yok." testid="bc-cc-repository">
            {(dev, observedAt) => (
              <>
                <Facts rows={[
                  ["Dal", dev.branch ?? "—"],
                  ["HEAD", ayasCcShortSha(dev.head)],
                  ["Uzak iz", `${dev.upstream ?? "yok"} @ ${ayasCcShortSha(dev.upstreamHead)}`],
                  ["İleri / geri", `${dev.ahead ?? "?"} / ${dev.behind ?? "?"}`],
                  ["Çalışma ağacı", dev.counts.total === 0 ? "temiz" : `${dev.counts.total} değişiklik · ${dev.counts.staged} hazırlanmış · ${dev.counts.unstaged} hazırlanmamış · ${dev.counts.untracked} izlenmeyen`],
                  ["Değişen alanlar", dev.changedAreas.length ? dev.changedAreas.join(", ") : "—"],
                  ["İlk açık kapı", dev.recovery ? `${dev.recovery.firstUnfinishedGate} (${dev.recovery.mode})` : "yok — temiz ve eşit"],
                  ["Git hazırlığı", dev.recovery?.readiness ?? "—"],
                ]} />
                {dev.recovery?.reasonCodes.length ? <p className="bc-cc-meta">Neden kodları: {dev.recovery.reasonCodes.join(", ")}</p> : null}
                {dev.recovery ? (
                  <p className="bc-cc-meta">
                    Bu yüzeyde sprint kapsamı ve doğrulama kanıtı yok; kapı Stage 10 kurtarma kurallarıyla hesaplanır. Devir paketi:{" "}
                    <code className="bc-cc-command">npx tsx scripts/ayas-developer-handoff.ts --task &quot;&lt;görev&gt;&quot; --baseline {dev.upstreamHead ? ayasCcShortSha(dev.upstreamHead) : "HEAD"} --scope &lt;yol&gt;</code>
                  </p>
                ) : null}
                {dev.recentCommits.length ? (
                  <ol className="bc-cc-activity" aria-label="Son commitler">
                    {dev.recentCommits.map((commit) => (
                      <li key={commit.hash}><time dateTime={commit.committedAt}>{ayasCcFormatTime(commit.committedAt, observedAt)}</time><span className="bc-cc-chip">{commit.hash.slice(0, 7)}</span><span className="bc-cc-activity__title">{commit.subject}</span></li>
                    ))}
                  </ol>
                ) : null}
                {dev.knownUnsafeTests.map((test) => (
                  <p key={test.scriptPath} className="bc-dev__notice bc-dev__notice--danger">ÇALIŞTIRMA: {test.scriptPath} ({test.hazard})</p>
                ))}
                <Observed at={observedAt} />
              </>
            )}
          </FactBody>
        )}
      </WithFacts>
    </section>
  );
}

/** Phase 11/12 — Stage 8 experiments, non-authoritative; the linked proposal is found by `sourceReference`. */
export function AyasExperimentsSection({ sources, approvalInbox }: { sources?: AyasControlCenterSources; approvalInbox?: AyasApprovalInboxView }) {
  const proposals = approvalInbox?.connected ? [...approvalInbox.pending, ...approvalInbox.today, ...approvalInbox.history] : [];
  return (
    <section className="bc-dev__section" aria-labelledby="bc-cc-exp-title" data-testid="bc-cc-experiments">
      <h3 id="bc-cc-exp-title">Araştırma → deney hattı</h3>
      <WithFacts sources={sources} label="Deney deposu">
        {(server) => (
          <FactBody fact={server?.experiments} absent="Deney deposu henüz oluşmamış — araştırma döngüsü bir deney başlatmadı." testid="bc-cc-experiments">
            {(facts, observedAt) => (
              <>
                <Facts rows={[
                  ["Dizinlenen bulgu", String(facts.findingsIndexed)],
                  ["Bulgu sonuçları", Object.entries(facts.findingOutcomes).map(([k, v]) => `${k} ${v}`).join(" · ") || "—"],
                  ["Hipotez", String(facts.hypothesesCount)],
                  ["Kayıtlı strateji / ölçüt", `${facts.registeredStrategies} / ${facts.benchmarks}`],
                  ["Kabul ertelemesi", facts.admissionDeferredUntil ? ayasCcFormatTime(facts.admissionDeferredUntil, observedAt) : "yok"],
                ]} />
                {facts.registeredStrategies === 0 ? <p className="bc-cc-meta">Üretim strateji kayıt defteri kasıtlı olarak boş: canlı boşluklar yürütülemez tasarım incelemesinde durur.</p> : null}
                {facts.experiments.length === 0 ? (
                  <p className="bc-empty" data-testid="bc-cc-experiments-none">Henüz deney yok.</p>
                ) : (
                  <ul className="bc-cc-cards">
                    {facts.experiments.map((row) => {
                      const linked = proposals.find((proposal) => proposal.sourceReference === row.experimentId);
                      return (
                        <li key={row.experimentId} className="bc-dev__timeline-card" data-testid={`bc-cc-experiment-${row.experimentId}`}>
                          <p className="bc-cc-item__head"><span className="bc-cc-level">{row.status}</span><strong>{row.hypothesis?.capability ?? row.hypothesisId}</strong></p>
                          <Facts rows={[
                            ["Hipotez", row.hypothesis?.statement ?? "kanıt paketi yok"],
                            ["Ölçüt / boyut", row.hypothesis ? `${row.hypothesis.benchmarkId} · ${row.hypothesis.targetDimension}` : "—"],
                            ["Taban → deney", row.evidence ? `${row.evidence.baseline} → ${row.evidence.experiment}` : "—"],
                            ["Gerileme", row.evidence ? `${row.evidence.newlyFailingCases} yeni hata · held-out Δ ${row.evidence.heldOutDelta} · ${row.evidence.failingSuites} kırık suite` : "—"],
                            ["Karar", row.verdict ?? "—"],
                            ["Bağlı öneri", linked ? `${linked.proposalId} · ${linked.status}` : "yok"],
                            ["baseHead", ayasCcShortSha(row.baseHead)],
                            ["Güncelleme", ayasCcFormatTime(row.updatedAt, observedAt)],
                          ]} />
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p className="bc-cc-meta">Deneyler yetkisizdir: sonuç ancak mevcut sahip onayı ve yürütme kapısından geçen bir öneriye dönüşebilir.</p>
                <Observed at={observedAt} />
              </>
            )}
          </FactBody>
        )}
      </WithFacts>
    </section>
  );
}

/** Phase 13 — counts only; no memory title, body or value is ever sent to this component. */
export function AyasMemoryStatsSection({ sources }: { sources?: AyasControlCenterSources }) {
  return (
    <section className="bc-dev__section" aria-labelledby="bc-cc-mem-title" data-testid="bc-cc-memory">
      <h3 id="bc-cc-mem-title">Uzun süreli bellek</h3>
      <WithFacts sources={sources} label="Bellek">
        {(server) => (
          <FactBody fact={server?.memory} absent="Henüz uzun süreli bellek kaydı yok." testid="bc-cc-memory">
            {(memory, observedAt) => (
              <>
                <Facts rows={[
                  ["Kayıt / kapasite", `${memory.total} / ${memory.capacity}`],
                  ["Güncel / geçmiş olgu", `${memory.currentFacts} / ${memory.historicalFacts}`],
                  ["Süresi dolmuş", String(memory.expired)],
                  ["Revizyon", String(memory.revision)],
                  ["Türe göre", Object.entries(memory.byKind).map(([k, v]) => `${k} ${v}`).join(" · ") || "—"],
                  ["Öneme göre", Object.entries(memory.byImportance).map(([k, v]) => `${k} ${v}`).join(" · ") || "—"],
                  ["Son kayıt", ayasCcFormatTime(memory.lastObservedAt, observedAt)],
                  ["Geri getirme değerlendirmesi", "çalışma zamanında kayıt yok (yalnız smoke betiği)"],
                ]} />
                <p className="bc-cc-meta">Gizlilik: bu yüzey yalnız sayıları gösterir; bellek içerikleri gösterilmez.</p>
                <Observed at={observedAt} />
              </>
            )}
          </FactBody>
        )}
      </WithFacts>
    </section>
  );
}

/** Self-improvement health for the Autonomous panel (the owner-attention "incele" target). */
export function AyasHealthSection({ sources }: { sources?: AyasControlCenterSources }) {
  return (
    <section className="bc-dev__section" aria-labelledby="bc-cc-health-title" data-testid="bc-cc-health">
      <h3 id="bc-cc-health-title">Öz-gelişim sağlığı</h3>
      <WithFacts sources={sources} label="Sağlık">
        {(server) => (
          <FactBody fact={server?.health} absent="Sağlık verisi yok." testid="bc-cc-health">
            {(health, observedAt) => (
              <>
                <Facts rows={[
                  ["Karar", health.verdict],
                  ["Gözlemci aşaması", health.observer.phase ?? "—"],
                  ["Son kalp atışı", ayasCcFormatTime(health.observer.heartbeatAt, observedAt)],
                  ["Kalp atışı sayısı", health.observer.heartbeatCount === null ? "—" : String(health.observer.heartbeatCount)],
                  ["Araştırma zamanlayıcı", health.research.enabled ? "etkin" : "devre dışı"],
                  ["Sonraki hafif / derin", `${ayasCcFormatTime(health.research.nextLightAt, observedAt)} / ${ayasCcFormatTime(health.research.nextDeepAt, observedAt)}`],
                  ["Otonom yürütme", health.autonomousExecutionEnabled ? "AÇIK" : "KAPALI (varsayılan)"],
                ]} />
                {health.findings.length ? (
                  <ul className="bc-reasons" aria-label="Sağlık bulguları">
                    {health.findings.map((finding) => <li key={finding.code}><strong>{finding.severity}</strong> · {finding.code} — {finding.message}</li>)}
                  </ul>
                ) : <p className="bc-cc-meta">Bulgu yok.</p>}
                <Observed at={observedAt} />
              </>
            )}
          </FactBody>
        )}
      </WithFacts>
    </section>
  );
}

/** Phase 10/14/15 — the "Sistem" tab: Graphify, capabilities and security. */
export function AyasSystemPanel({ sources }: { sources?: AyasControlCenterSources }) {
  return (
    <div className="bc-dev" data-testid="bc-cc-system">
      <WithFacts sources={sources} label="Sistem durumu">
        {(server) => (
          <>
            <section className="bc-dev__section" aria-labelledby="bc-cc-graph-title" data-testid="bc-cc-graphify">
              <h3 id="bc-cc-graph-title">Graphify</h3>
              <FactBody fact={server?.graphify} absent="Graphify durumu yok." testid="bc-cc-graphify">
                {(graph, observedAt) => (
                  <>
                    <Facts rows={[
                      ["Sınıf", graph.classification],
                      ["Yapısal / anlamsal", `${graph.structuralStatus} / ${graph.semanticStatus}`],
                      ["Kaynak HEAD", ayasCcShortSha(graph.sourceHead)],
                      ["Son analiz HEAD", ayasCcShortSha(graph.lastAnalyzedHead)],
                      ["Grafik kaynağı", ayasCcShortSha(graph.graphBuiltFromHead)],
                      ["Son Graphify güncellemesi", ayasCcFormatTime(graph.analyzedAt, observedAt)],
                      ["Çalışma ağacı", `${graph.worktreeState} · ${graph.dirtyUncoveredCount} kapsanmayan`],
                      ["Grafik", graph.graph ? `${graph.graph.nodes} düğüm · ${graph.graph.links} kenar · ${graph.graph.anomalies} yapısal anomali` : "okunamadı"],
                      ["CLI / yerel MCP / uzak MCP", `${graph.localCli}${graph.cliVersion ? ` ${graph.cliVersion}` : ""} / ${graph.localMcp} / ${graph.remoteMcp}`],
                    ]} />
                    {graph.incompleteCodeFiles.length ? (
                      <details className="bc-cc-details">
                        <summary>Grafikte düğümü olmayan kod dosyaları ({graph.incompleteCodeFiles.length}, {graph.criticalIncompleteFiles.length} kritik)</summary>
                        <ul>{graph.incompleteCodeFiles.map((file) => <li key={file}>{file}{graph.criticalIncompleteFiles.includes(file) ? " — kritik, doğrudan incele" : ""}</li>)}</ul>
                      </details>
                    ) : null}
                    {graph.consumers.length ? (
                      <ul className="bc-reasons" aria-label="Graphify tüketicileri">
                        {graph.consumers.map((consumer, index) => <li key={index}><strong>{consumer.status}</strong> · {consumer.host} {consumer.mode} · {consumer.location}{consumer.findings.length ? ` · ${consumer.findings.join(", ")}` : ""}</li>)}
                      </ul>
                    ) : null}
                    <p className="bc-cc-meta">Sonraki adım: {graph.nextAction}</p>
                    {graph.recoveryCommand ? <p className="bc-cc-meta">Güvenli işlem (sen çalıştırırsın): <code className="bc-cc-command">{graph.recoveryCommand}</code></p> : null}
                    <Observed at={observedAt} />
                  </>
                )}
              </FactBody>
            </section>

            <section className="bc-dev__section" aria-labelledby="bc-cc-cap-title" data-testid="bc-cc-capabilities">
              <h3 id="bc-cc-cap-title">Model · araç · yetenek · ajan</h3>
              <FactBody fact={server?.capabilities} absent="Yetenek envanteri yok." testid="bc-cc-capabilities">
                {(caps, observedAt) => {
                  const rows = caps.items.map((item) => ayasCcCapabilityRow(item, caps.ollama));
                  const tools = rows.filter((row) => row.type === "tool");
                  const primary = ["model", "agent", "skill"].flatMap((type) => rows.filter((row) => row.type === type));
                  return (
                    <>
                      <CapabilityRows rows={primary} label="Modeller, ajanlar ve yetenekler" />
                      <details className="bc-cc-details">
                        <summary>Araçlar ({tools.length}: {tools.filter((row) => row.label !== "UNAVAILABLE").length} kullanılabilir, {tools.filter((row) => row.label === "UNAVAILABLE").length} kapalı)</summary>
                        <CapabilityRows rows={tools} label="Araçlar" />
                      </details>
                      <p className="bc-cc-meta">Model yoklaması: {ayasCcFormatTime(caps.ollama.checkedAt, observedAt)}. AYAS&apos;ın Claude/Codex gönderim adaptörü yoktur.</p>
                      <Observed at={observedAt} />
                    </>
                  );
                }}
              </FactBody>
            </section>

            <section className="bc-dev__section" aria-labelledby="bc-cc-sec-title" data-testid="bc-cc-security">
              <h3 id="bc-cc-sec-title">Güvenlik</h3>
              <FactBody fact={server?.security} absent="Güvenlik durumu yok." testid="bc-cc-security">
                {(security, observedAt) => (
                  <>
                    <Facts rows={[
                      ["Erişim kapısı", security.accessGate],
                      ["Yürütme kapısı", security.executionGate],
                      ["Otonom yürütme", security.autonomousExecutionEnabled ? "AÇIK" : "KAPALI (varsayılan)"],
                      ["Son inceleme", `${security.review.stage} · ${security.review.reviewedOn} · ${ayasCcShortSha(security.review.reviewCommit)}`],
                      ["Engelleyici / çözülmemiş majör", `${security.review.blockers} / ${security.review.unresolvedMajors}`],
                      ["Düzeltilen sınır", String(security.review.fixedBoundaries)],
                    ]} />
                    <ul className="bc-reasons" aria-label="Ertelenmiş güvenlik kontrolleri">
                      {security.review.deferredChecks.map((check) => <li key={check.id}><strong>{check.label}</strong> — {check.reason}</li>)}
                    </ul>
                    <p className="bc-cc-meta">Kayıtlı inceleme sonucudur, canlı tarama değildir; sayfa açılışında tarayıcı çalıştırılmaz. Ayrıntı: {security.review.doc}</p>
                    <Observed at={observedAt} />
                  </>
                )}
              </FactBody>
            </section>
          </>
        )}
      </WithFacts>
    </div>
  );
}

function CapabilityRows({ rows, label }: { rows: readonly ReturnType<typeof ayasCcCapabilityRow>[]; label: string }) {
  return (
    <ul className="bc-list" aria-label={label}>
      {rows.map((row) => (
        <li key={`${row.type}:${row.id}`} className="bc-row" data-testid={`bc-cc-cap-${row.id}`} data-label={row.label}>
          <span>{row.id}<span className="bc-row__meta"> · {row.type} · {row.note}</span></span>
          <span className="bc-badge bc-badge--neutral">{row.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** Phase 16 — read-only Atölye inventory; nothing here claims production readiness it did not measure. */
export function AyasAtolyePanel({ sources }: { sources?: AyasControlCenterSources }) {
  return (
    <div className="bc-dev" data-testid="bc-cc-atolye">
      <section className="bc-dev__section" aria-labelledby="bc-cc-atolye-title">
        <h3 id="bc-cc-atolye-title">Atölye üretim durumu</h3>
        <WithFacts sources={sources} label="Atölye envanteri">
          {(server) => (
            <FactBody fact={server?.atolye} absent="Proje envanteri yok." testid="bc-cc-atolye">
              {(atolye, observedAt) => (
                <>
                  <Facts rows={[
                    ["Runtime kökü", `${atolye.runtimeClassification}${atolye.external ? " (harici)" : ""}`],
                    ["Proje", String(atolye.totalProjects)],
                    ["Tamamlanan / süren", `${atolye.completed} / ${atolye.incomplete}`],
                    ["Devam ettirilebilir", String(atolye.resumable)],
                    ["Son videosu olan", String(atolye.withFinalVideo)],
                    ["project.json okunamayan", String(atolye.unreadable)],
                    ["Duruma göre", atolye.statusDistribution.map((entry) => `${entry.status} ${entry.count}`).join(" · ") || "—"],
                    ["Son güncelleme", ayasCcFormatTime(atolye.latestUpdatedAt, observedAt)],
                  ]} />
                  <ul className="bc-reasons" aria-label="Bu yüzeyde ölçülmeyenler">
                    <li><strong>Üretim runtime yaşam döngüsü</strong> — gösterilmiyor: sayfa sürecindeki anlık görüntünün başlatılan runtime ile aynı olduğu doğrulanmadı.</li>
                    <li><strong>Sağlayıcı ve medya hazırlığı</strong> — ölçülmüyor. Tam denetim operatör CLI&apos;si <code className="bc-cc-command">npm run production:acceptance:readiness</code> ile yapılır (yönetişimli; runtime deposuna geçici deneme dosyası yazar, rutin değildir).</li>
                    <li><strong>Yönetmen / medya zekâsı</strong> — henüz yok (Stage 12).</li>
                  </ul>
                  <Observed at={observedAt} />
                </>
              )}
            </FactBody>
          )}
        </WithFacts>
      </section>
    </div>
  );
}
