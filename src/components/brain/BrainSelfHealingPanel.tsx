/**
 * Atölye Brain — AYAS Raporları (Report Center) panel (emir §7–§15, §18).
 *
 * Read-only presentational. Two modes:
 *  - `reportCenter` provided  → the full Report Center: system-health bar, the
 *    count row, status/category filters, and a per-incident chain (SORUN → KANIT
 *    → ZAMAN ÇİZELGESİ → KÖK NEDEN → GÜVEN → ŞÜPHELİ DOSYALAR → ÖNERİLEN ÇÖZÜM →
 *    SANDBOX → REGRESSION → SECURITY → RİSK → SONUÇ → OPERATÖR KARARI → WATCHDOG
 *    → ÖĞRENME) with ONAYLA / REDDET / DAHA SONRA buttons on a verified incident.
 *  - `reportCenter` absent     → the compact snapshot view (unchanged).
 *
 * The buttons only RECORD an operator decision (§10 / §11). They never run git,
 * touch the working tree, or open the execution gate — the staged apply still
 * happens through the Node operator CLI (`npm run selfheal -- apply <id>`).
 * Filter/expand/decision state is owned by `BrainCoreConsole`; this stays pure.
 */

import type { ReactNode } from "react";

import type { BrainSelfHealSnapshot } from "@/lib/brain/selfheal/BrainSelfHealSnapshot";
import {
  BRAIN_REPORT_CATEGORIES,
  BRAIN_REPORT_STATUS_FILTERS,
  filterReports,
  type BrainIncidentReportView,
  type BrainReportCenterView,
  type BrainReportStatusFilter,
} from "@/lib/brain/selfheal/BrainReportCenter";
import type { BrainSelfHealDecisionKind } from "@/lib/brain/selfheal/BrainSelfHealDecision";

const HEALTH_TR: Record<BrainSelfHealSnapshot["health"]["state"], string> = {
  healthy: "SAĞLIKLI",
  watching: "İZLİYOR",
  healing: "ONARIYOR",
  "needs-human": "İNSAN GEREKLİ",
};

const STATUS_FILTER_TR: Record<BrainReportStatusFilter, string> = {
  all: "Tümü",
  investigating: "İnceleniyor",
  awaiting: "Onay Bekliyor",
  resolved: "Çözüldü",
  rolledBack: "Geri Alındı",
  failed: "Başarısız",
};

const SEV_LABEL: Record<BrainIncidentReportView["severityTone"], string> = {
  critical: "🔴 KRİTİK",
  high: "🟠 YÜKSEK",
  medium: "🟡 ORTA",
  info: "🔵 BİLGİ",
  resolved: "🟢 ÇÖZÜLDÜ",
};

const DECISION_TR: Record<BrainSelfHealDecisionKind, string> = {
  APPROVE: "ONAYLANDI",
  REJECT: "REDDEDİLDİ",
  LATER: "SONRAYA BIRAKILDI",
};

export interface BrainReportPanelHandlers {
  readonly filter?: { readonly status: BrainReportStatusFilter; readonly category: string };
  readonly onFilter?: (next: { readonly status: BrainReportStatusFilter; readonly category: string }) => void;
  readonly expandedReportId?: string | null;
  readonly onToggleReport?: (id: string | null) => void;
  readonly onDecision?: (input: { readonly incidentId: string; readonly decision: BrainSelfHealDecisionKind }) => void;
  /** incidentId whose decision is currently being submitted. */
  readonly decisionPending?: string | null;
}

export function BrainSelfHealingPanel({
  snapshot,
  reportCenter,
  executionGate,
  filter,
  onFilter,
  expandedReportId,
  onToggleReport,
  onDecision,
  decisionPending,
}: {
  readonly snapshot: (BrainSelfHealSnapshot & { readonly error?: string | null }) | null;
  readonly reportCenter?: BrainReportCenterView | null;
  readonly executionGate: string;
} & BrainReportPanelHandlers) {
  const rc = reportCenter ?? null;

  const hasAnything = rc
    ? rc.reports.length > 0 ||
      rc.learning.length > 0 ||
      rc.optimizations.length > 0 ||
      (rc.latency != null && rc.latency.totalSamples > 0)
    : snapshot &&
      (snapshot.activeIncidents.length > 0 ||
        snapshot.recentRepairs.length > 0 ||
        snapshot.recentRollbacks.length > 0 ||
        snapshot.learning.length > 0 ||
        snapshot.optimizations.length > 0);

  if (!hasAnything) {
    return (
      <div className="bc-empty" data-testid="bc-selfheal-empty">
        <strong>AYAS Raporları — beklemede</strong>
        <p style={{ margin: "6px 0 0" }}>
          Henüz kayıtlı bir olay yok. Beyin telemetriyi izliyor; gerçek bir anomali tespit
          ederse otomatik olarak bir <em>incident</em> açar, sandbox&apos;ta düzeltir ve test eder
          — ama canlı working tree&apos;ye <strong>operatör onayı olmadan</strong> asla yazmaz.
          {snapshot?.error ? (
            <>
              <br />
              <span style={{ color: "var(--bc-danger, #f66)" }}>Store okunamadı: {snapshot.error}</span>
            </>
          ) : null}
        </p>
      </div>
    );
  }

  const h = snapshot?.health;
  const gateNote = (
    <>
      {executionGate} · self-healing gate&apos;i açamaz, push/merge/deploy yapamaz. SAFE otomatik
      düzeltmeler working tree&apos;ye <strong>staged</strong> uygulanır, commit edilmez; başarısız
      olursa watchdog otomatik geri alır. Onay butonları yalnızca kararı kaydeder — uygulama
      operatör CLI&apos;siyle yapılır.
    </>
  );

  return (
    <div data-testid="bc-selfheal">
      {rc ? <ReportCenter rc={rc} filter={filter} onFilter={onFilter} expandedReportId={expandedReportId} onToggleReport={onToggleReport} onDecision={onDecision} decisionPending={decisionPending} gateNote={gateNote} /> : null}

      {!rc && snapshot ? (
        <>
          <dl className="bc-kv">
            <dt>Canlı durum</dt>
            <dd data-testid="bc-selfheal-live" style={{ color: snapshot.liveState === "NEEDS_HUMAN" ? "var(--bc-danger, #f66)" : undefined }}>
              {snapshot.liveState}
              {snapshot.currentRisk !== "NONE" ? ` · risk ${snapshot.currentRisk}` : ""}
            </dd>
            <dt>Sistem sağlığı</dt>
            <dd data-testid="bc-selfheal-health" style={{ color: h?.state === "needs-human" ? "var(--bc-danger, #f66)" : undefined }}>
              {h ? `${HEALTH_TR[h.state]} — ${h.summary}` : "—"}
            </dd>
            <dt>Açık incident / insan gerekli / P0</dt>
            <dd>
              {h?.openIncidents ?? 0} / {h?.needsHuman ?? 0} / {h?.p0 ?? 0}
            </dd>
            <dt>Son kök neden</dt>
            <dd data-testid="bc-selfheal-rootcause">{snapshot.lastRootCause ?? "—"}</dd>
            <dt>Son eylem</dt>
            <dd data-testid="bc-selfheal-last">{snapshot.lastAction ? `${snapshot.lastAction.at.slice(0, 19)} — ${snapshot.lastAction.text}` : "—"}</dd>
            <dt>Yürütme kapısı</dt>
            <dd>{gateNote}</dd>
          </dl>

          {snapshot.recentRollbacks.length > 0 ? (
            <>
              <p className="bc-panel__title" style={{ margin: "14px 0 6px" }}>Son geri almalar</p>
              <ul className="bc-reasons" data-testid="bc-selfheal-rollbacks">
                {snapshot.recentRollbacks.map((i) => (
                  <li key={i.id}>
                    <strong>{i.id}</strong> · {i.symptom} — {i.disposition}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {snapshot.activeIncidents.length > 0 ? (
            <>
              <p className="bc-panel__title" style={{ margin: "14px 0 6px" }}>Aktif incident&apos;lar</p>
              <ul className="bc-reasons" data-testid="bc-selfheal-active">
                {snapshot.activeIncidents.map((i) => (
                  <li key={i.id}>
                    <strong>{i.id}</strong> · {i.category}/{i.severity} · <em>{i.status}</em>
                    {i.needsHuman ? " · ⚠ İNSAN GEREKLİ" : ""}
                    <br />
                    {i.symptom}
                    <br />
                    <span style={{ opacity: 0.8 }}>
                      Kök neden: {i.rootCause ?? "belirlenmedi"}
                      {i.confidence != null ? ` (güven ${i.confidence.toFixed(2)})` : ""}
                      {i.changedFiles.length ? ` · dosya: ${i.changedFiles.join(", ")} · risk ${i.risk ?? "—"}` : ""}
                      {` · testler: ${i.checksSummary}`}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {snapshot.recentRepairs.length > 0 ? (
            <>
              <p className="bc-panel__title" style={{ margin: "14px 0 6px" }}>Son sonuçlar</p>
              <ul className="bc-reasons" data-testid="bc-selfheal-repairs">
                {snapshot.recentRepairs.map((i) => (
                  <li key={i.id} style={{ color: i.status === "FAILED" ? "var(--bc-danger, #f66)" : undefined }}>
                    <strong>{i.id}</strong> · {i.status}
                    {i.status === "FAILED" ? " · ⚠ İNSAN GEREKLİ" : ""} · {i.symptom}
                    {i.changedFiles.length ? ` — ${i.changedFiles.join(", ")}` : ""}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {snapshot.optimizations.length > 0 ? (
            <>
              <p className="bc-panel__title" style={{ margin: "14px 0 6px" }}>Optimizasyonlar</p>
              <ul className="bc-reasons" data-testid="bc-selfheal-optim">
                {snapshot.optimizations.map((o) => (
                  <li key={o.id}>
                    {o.verdict} — {o.headline} <span style={{ opacity: 0.7 }}>({o.at.slice(0, 19)})</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {snapshot.learning.length > 0 ? (
            <>
              <p className="bc-panel__title" style={{ margin: "14px 0 6px" }}>Öğrenilenler</p>
              <ul className="bc-reasons" data-testid="bc-selfheal-learning">
                {snapshot.learning.map((l) => (
                  <li key={l.id}>
                    <strong>{l.rootCause}</strong> → {l.fix}
                    <br />
                    <span style={{ opacity: 0.75 }}>
                      {l.status} · doğrulandı {l.confirmed}× / başarısız {l.failed}× · imza: {l.signature}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------- report center --- */

function ReportCenter({
  rc,
  filter,
  onFilter,
  expandedReportId,
  onToggleReport,
  onDecision,
  decisionPending,
  gateNote,
}: {
  readonly rc: BrainReportCenterView;
  readonly gateNote: ReactNode;
} & BrainReportPanelHandlers) {
  const status = filter?.status ?? "all";
  const category = filter?.category ?? "all";
  const visible = filterReports(rc.reports, { status, category });
  const c = rc.counts;

  return (
    <div data-testid="bc-report">
      <div className="bc-report__top">
        <div className="bc-report__healthwrap">
          <div className="bc-report__healthbar" role="img" aria-label={`Sistem sağlığı %${rc.systemHealthPercent}`}>
            <span style={{ width: `${rc.systemHealthPercent}%` }} data-testid="bc-report-healthbar" />
          </div>
          <p className="bc-report__healthnum" data-testid="bc-report-health">
            Sistem Sağlığı %{rc.systemHealthPercent}
            <span className="bc-report__live" data-testid="bc-report-live">
              {rc.liveState}
            </span>
          </p>
          <p className="bc-report__headline" data-testid="bc-report-headline">{rc.headline}</p>
        </div>
      </div>

      <dl className="bc-report__counts" data-testid="bc-report-counts">
        <div>
          <dt>Açık Sorunlar</dt>
          <dd>{c.open}</dd>
        </div>
        <div className={c.awaitingApproval > 0 ? "bc-report__count--warn" : undefined}>
          <dt>Onay Bekleyenler</dt>
          <dd>{c.awaitingApproval}</dd>
        </div>
        <div>
          <dt>İncelenenler</dt>
          <dd>{c.investigating}</dd>
        </div>
        <div>
          <dt>Çözülenler</dt>
          <dd>{c.resolved}</dd>
        </div>
        <div className={c.failed > 0 ? "bc-report__count--warn" : undefined}>
          <dt>Başarısız</dt>
          <dd>{c.failed}</dd>
        </div>
        <div>
          <dt>Öğrenilen Pattern</dt>
          <dd>{c.learnedPatterns}</dd>
        </div>
      </dl>

      {rc.latency && rc.latency.totalSamples > 0 ? (
        <div className="bc-report__latency" data-testid="bc-report-latency">
          <p className="bc-panel__title" style={{ margin: "0 0 6px" }}>Ses gecikmesi (optimizasyon)</p>
          {rc.latency.headline ? (
            <p
              className={`bc-report__latencyhead bc-report__latencyhead--${rc.latency.headline.verdict.toLowerCase()}`}
              data-testid="bc-report-latency-headline"
            >
              {rc.latency.headline.metricTr}: {rc.latency.headline.verdict}
              {rc.latency.headline.baselineMs != null
                ? ` — ${rc.latency.headline.baselineMs} ms → ${rc.latency.headline.currentMs} ms`
                : ""}
              {rc.latency.headline.deltaPct != null
                ? ` (${rc.latency.headline.deltaPct > 0 ? "+" : ""}${Math.round(rc.latency.headline.deltaPct * 1000) / 10}%)`
                : ""}
              {` · güven ${rc.latency.headline.confidence.toFixed(2)}`}
            </p>
          ) : (
            <p className="bc-report__latencyhead" data-testid="bc-report-latency-headline">
              Belirgin bir gecikme değişimi yok ({rc.latency.totalSamples} ölçüm).
            </p>
          )}
          <ul className="bc-report__mini">
            {rc.latency.findings
              .filter((f) => f.verdict !== "UNKNOWN")
              .map((f) => (
                <li key={f.metric}>
                  {f.metricTr}: baz {f.baselineMs ?? "—"} ms · güncel {f.currentMs ?? "—"} ms · trend {f.trend} · örnek {f.baselineSamples}+{f.recentSamples}
                </li>
              ))}
            {rc.latency.findings.every((f) => f.verdict === "UNKNOWN") ? (
              <li>yeterli ölçüm yok — durum bilinmiyor (Voice Lab&apos;den <code>selfheal latency</code> ile besle)</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {onFilter ? (
        <div className="bc-report__filters" data-testid="bc-report-filters">
          <div className="bc-report__filterrow">
            {BRAIN_REPORT_STATUS_FILTERS.map((s) => (
              <button
                key={s}
                type="button"
                className={`bc-chip${status === s ? " bc-chip--on" : ""}`}
                aria-pressed={status === s}
                onClick={() => onFilter({ status: s, category })}
                data-testid={`bc-report-filter-${s}`}
              >
                {STATUS_FILTER_TR[s]}
              </button>
            ))}
          </div>
          <div className="bc-report__filterrow">
            <button
              type="button"
              className={`bc-chip${category === "all" ? " bc-chip--on" : ""}`}
              aria-pressed={category === "all"}
              onClick={() => onFilter({ status, category: "all" })}
            >
              Tüm alanlar
            </button>
            {BRAIN_REPORT_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`bc-chip${category === cat ? " bc-chip--on" : ""}`}
                aria-pressed={category === cat}
                onClick={() => onFilter({ status, category: cat })}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <ul className="bc-report__list" data-testid="bc-report-list">
        {visible.length === 0 ? (
          <li className="bc-empty" style={{ margin: 0 }}>Bu filtreyle eşleşen rapor yok.</li>
        ) : (
          visible.map((r) => (
            <ReportItem
              key={r.id}
              r={r}
              expanded={expandedReportId === r.id}
              onToggle={onToggleReport}
              onDecision={onDecision}
              pending={decisionPending === r.id}
            />
          ))
        )}
      </ul>

      {rc.optimizations.length > 0 ? (
        <>
          <p className="bc-panel__title" style={{ margin: "16px 0 6px" }}>Optimizasyonlar</p>
          <ul className="bc-reasons" data-testid="bc-selfheal-optim">
            {rc.optimizations.map((o) => (
              <li key={o.id}>
                {o.verdict} — {o.headline} <span style={{ opacity: 0.7 }}>({o.at.slice(0, 19)})</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {rc.learning.length > 0 ? (
        <>
          <p className="bc-panel__title" style={{ margin: "16px 0 6px" }}>Öğrenilenler</p>
          <ul className="bc-reasons" data-testid="bc-selfheal-learning">
            {rc.learning.map((l) => (
              <li key={l.id}>
                <strong>{l.rootCause}</strong> → {l.fix}
                <br />
                <span style={{ opacity: 0.75 }}>
                  {l.status} · doğrulandı {l.confirmed}× / başarısız {l.failed}× · imza: {l.signature}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p className="bc-note" style={{ marginTop: 14 }} data-testid="bc-selfheal-gatenote">
        Yürütme kapısı: {gateNote}
      </p>
    </div>
  );
}

function ReportItem({
  r,
  expanded,
  onToggle,
  onDecision,
  pending,
}: {
  readonly r: BrainIncidentReportView;
  readonly expanded: boolean;
  readonly onToggle?: (id: string | null) => void;
  readonly onDecision?: (input: { readonly incidentId: string; readonly decision: BrainSelfHealDecisionKind }) => void;
  readonly pending: boolean;
}) {
  return (
    <li className={`bc-report__item bc-report__item--${r.severityTone}`} data-testid="bc-report-item">
      <button
        type="button"
        className="bc-report__summary"
        aria-expanded={expanded}
        onClick={() => onToggle?.(expanded ? null : r.id)}
        data-testid={`bc-report-summary-${r.id}`}
      >
        <span className="bc-report__sev">{SEV_LABEL[r.severityTone]}</span>
        <span className="bc-report__title">{r.headline}</span>
        <span className="bc-report__state">
          {r.result}
          {r.needsHumanDirect ? " · ⚠ İNSAN GEREKLİ" : ""}
        </span>
      </button>

      {expanded ? (
        <div className="bc-report__detail" data-testid="bc-report-detail">
          <dl className="bc-kv">
            <dt>Sorun</dt>
            <dd>{r.symptom}</dd>

            <dt>Kanıt</dt>
            <dd>
              {r.evidence.length ? (
                <ul className="bc-report__mini">
                  {r.evidence.map((e, i) => (
                    <li key={i}>
                      <span style={{ opacity: 0.7 }}>{e.source}</span> — {e.note}
                    </li>
                  ))}
                </ul>
              ) : (
                "—"
              )}
            </dd>

            <dt>Zaman çizelgesi</dt>
            <dd>
              <ul className="bc-report__mini" data-testid="bc-report-timeline">
                {r.timeline.map((t, i) => (
                  <li key={i}>
                    <span style={{ opacity: 0.6 }}>{t.at.slice(0, 19)}</span> — {t.label}
                  </li>
                ))}
              </ul>
            </dd>

            <dt>Kök neden</dt>
            <dd>
              {r.rootCause ?? "belirlenmedi"}
              {r.confidence != null ? ` · güven ${r.confidence.toFixed(2)}` : ""}
            </dd>

            {r.counterEvidence.length ? (
              <>
                <dt>Karşıt kanıt</dt>
                <dd>{r.counterEvidence.join("; ")}</dd>
              </>
            ) : null}

            <dt>Şüpheli dosyalar</dt>
            <dd>{r.suspectFiles.length ? r.suspectFiles.join(", ") : "—"}</dd>

            <dt>Önerilen çözüm</dt>
            <dd>{r.proposedFix ? r.proposedFix.summary : "henüz taslak yok"}</dd>

            <dt>Sandbox / Regression / Security</dt>
            <dd data-testid="bc-report-checks">
              {r.sandbox} / {r.regression} / {r.security}
            </dd>

            <dt>Risk</dt>
            <dd>{r.proposedFix?.risk ?? "—"}</dd>

            <dt>Sonuç</dt>
            <dd>{r.result}</dd>

            <dt>Operatör kararı</dt>
            <dd data-testid="bc-report-decision">
              {r.operatorDecision
                ? `${DECISION_TR[r.operatorDecision.decision]} · ${r.operatorDecision.decidedAt.slice(0, 19)} · approvalId ${r.operatorDecision.operatorApprovalId}`
                : r.needsHumanDirect
                  ? "İNSAN GEREKLİ — operatör doğrudan incelemeli (bu alan otomatik onaylanamaz)"
                  : "karar bekliyor"}
            </dd>

            <dt>Watchdog</dt>
            <dd>
              {r.watchdog.verdict ?? "—"}
              {r.watchdog.evidence.length ? ` — ${r.watchdog.evidence.join("; ")}` : ""}
            </dd>

            <dt>Öğrenme</dt>
            <dd>
              {r.learning.learned
                ? `${r.learning.fix ?? "kayıtlı"} · doğrulandı ${r.learning.confirmed}× / başarısız ${r.learning.failed}×`
                : "henüz öğrenilmedi"}
            </dd>
          </dl>

          {r.operatorDecision?.decision === "APPROVE" ? (
            <p className="bc-report__applyhint" data-testid="bc-report-applyhint">
              ✓ Onaylandı. Uygulama için operatör: <code>npm run selfheal -- apply {r.id}</code> — patch{" "}
              <strong>staged</strong> edilir, commit/push edilmez.
            </p>
          ) : null}

          {r.canDecide && onDecision ? (
            <div className="bc-report__actions" data-testid="bc-report-actions">
              <button
                type="button"
                className="bc-btn"
                disabled={pending}
                onClick={() => onDecision({ incidentId: r.id, decision: "APPROVE" })}
                data-testid={`bc-report-approve-${r.id}`}
              >
                Çözümü Onayla
              </button>
              <button
                type="button"
                className="bc-btn bc-btn--ghost"
                disabled={pending}
                onClick={() => onDecision({ incidentId: r.id, decision: "REJECT" })}
                data-testid={`bc-report-reject-${r.id}`}
              >
                Reddet
              </button>
              <button
                type="button"
                className="bc-btn bc-btn--ghost"
                disabled={pending}
                onClick={() => onDecision({ incidentId: r.id, decision: "LATER" })}
                data-testid={`bc-report-later-${r.id}`}
              >
                Daha Sonra
              </button>
            </div>
          ) : null}

          {r.needsHumanDirect ? (
            <p className="bc-report__applyhint" data-testid="bc-report-needshuman">
              ⚠ Bu alan otonom düzeltme kapsamı dışında (İNSAN GEREKLİ). Operatör{" "}
              <code>npm run selfheal -- report {r.id}</code> ile inceler.
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export default BrainSelfHealingPanel;
