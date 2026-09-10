/**
 * Atölye Brain — Self-Healing panel (pure presentational, emir §18).
 *
 * Read-only. Shows: system health, active incidents, recent repairs,
 * optimizations, learning, last self-healing action. It restates that the Brain
 * reaches AWAITING_APPROVAL on its own and never applies a patch to the live
 * tree without an operator, and that the execution gate is CLOSED.
 *
 * No handlers — the loop is driven by the operator CLI (`npm run selfheal:*`),
 * not from this page.
 */

import type { BrainSelfHealSnapshot } from "@/lib/brain/selfheal/BrainSelfHealSnapshot";

const HEALTH_TR: Record<BrainSelfHealSnapshot["health"]["state"], string> = {
  healthy: "SAĞLIKLI",
  watching: "İZLİYOR",
  healing: "ONARIYOR",
  "needs-human": "İNSAN GEREKLİ",
};

export function BrainSelfHealingPanel({
  snapshot,
  executionGate,
}: {
  readonly snapshot: (BrainSelfHealSnapshot & { readonly error?: string | null }) | null;
  readonly executionGate: string;
}) {
  const hasAnything =
    snapshot &&
    (snapshot.activeIncidents.length > 0 ||
      snapshot.recentRepairs.length > 0 ||
      snapshot.recentRollbacks.length > 0 ||
      snapshot.learning.length > 0 ||
      snapshot.optimizations.length > 0);
  if (!hasAnything) {
    return (
      <div className="bc-empty" data-testid="bc-selfheal-empty">
        <strong>Self-Healing — beklemede</strong>
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

  const h = snapshot.health;
  return (
    <div data-testid="bc-selfheal">
      <dl className="bc-kv">
        <dt>Canlı durum</dt>
        <dd data-testid="bc-selfheal-live" style={{ color: snapshot.liveState === "NEEDS_HUMAN" ? "var(--bc-danger, #f66)" : undefined }}>
          {snapshot.liveState}
          {snapshot.currentRisk !== "NONE" ? ` · risk ${snapshot.currentRisk}` : ""}
        </dd>
        <dt>Sistem sağlığı</dt>
        <dd data-testid="bc-selfheal-health" style={{ color: h.state === "needs-human" ? "var(--bc-danger, #f66)" : undefined }}>
          {HEALTH_TR[h.state]} — {h.summary}
        </dd>
        <dt>Açık incident / insan gerekli / P0</dt>
        <dd>
          {h.openIncidents} / {h.needsHuman} / {h.p0}
        </dd>
        <dt>Son kök neden</dt>
        <dd data-testid="bc-selfheal-rootcause">{snapshot.lastRootCause ?? "—"}</dd>
        <dt>Son eylem</dt>
        <dd data-testid="bc-selfheal-last">{snapshot.lastAction ? `${snapshot.lastAction.at.slice(0, 19)} — ${snapshot.lastAction.text}` : "—"}</dd>
        <dt>Yürütme kapısı</dt>
        <dd>
          {executionGate} · self-healing gate&apos;i açamaz, push/merge/deploy yapamaz. SAFE otomatik
          düzeltmeler working tree&apos;ye <strong>staged</strong> uygulanır, commit edilmez; başarısız
          olursa watchdog otomatik geri alır.
        </dd>
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
    </div>
  );
}

export default BrainSelfHealingPanel;
