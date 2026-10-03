"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AyasExecutiveOwnerView } from "@/lib/ayas/briefing/AyasExecutiveBriefingService";
import { refreshOwnerExecutiveBriefing, recordOwnerExecutiveAttention } from "../../../app/brain/briefing/actions";
export function AyasExecutiveBriefingPanel({ initial, compact = false }: { readonly initial?: AyasExecutiveOwnerView; readonly compact?: boolean }) {
  const [view,setView] = useState(initial), [error,setError] = useState<string|null>(null), [busy,setBusy] = useState(false);
  const delivered = useRef(new Set<string>()), started = useRef(false);
  const refresh = useCallback(async () => { setBusy(true); try { setView(await refreshOwnerExecutiveBriefing()); setError(null); } catch { setError("Owner oturumu veya bildirim kaydı doğrulanamadı."); } finally { setBusy(false); } }, []);
  useEffect(() => { if (started.current) return; started.current = true; void refresh(); }, [refresh]);
  useEffect(() => {
    if (!view || view.persistence !== "VERIFIED" || !view.ownerAuthenticated) return;
    let active = true, running = false;
    const deliver = async () => {
      if (!active || document.visibilityState !== "visible" || running) return;
      running = true;
      try {
      for (const a of view.alerts) {
        if (!active || document.visibilityState !== "visible") break;
        if (!a.notificationEligible || a.priority === "ROUTINE" || (compact && a.priority === "MATERIAL_INFO")) continue;
        const key = a.alertId + ":" + a.fingerprint;
        if (delivered.current.has(key)) continue; delivered.current.add(key);
        // React committed the visible owner packet. A queued or merely planned notification is never marked delivered.
        await recordOwnerExecutiveAttention({operation:"DELIVERED",alertId:a.alertId,fingerprint:a.fingerprint}).catch(() => {
          delivered.current.delete(key); if (active) setError("Bildirim gösterildi; kalıcı teslim kaydı doğrulanamadı.");
        });
      }
      } finally { running = false; }
    };
    const visible = () => { void deliver(); };
    visible(); document.addEventListener("visibilitychange",visible); return () => { active = false; document.removeEventListener("visibilitychange",visible); };
  }, [view,compact]);
  const visible = view?.alerts.filter(a => a.priority !== "ROUTINE" && (!compact || a.priority === "CRITICAL" || a.priority === "ACTION_REQUIRED")) ?? [];
  // ROUTINE is audit-only: listed with its evidence, never stored as an alert, never delivered.
  const routine = view?.signals.filter(s => s.priority === "ROUTINE") ?? [];
  return <section className="bc-cc" aria-labelledby={compact ? "executive-alert-title" : "executive-brief-title"} data-testid="executive-briefing">
    <h2 id={compact ? "executive-alert-title" : "executive-brief-title"}>{compact ? "Öncelikli owner bildirimleri" : "AYAS Owner Briefing"}</h2>
    {!view ? <p role="status">Gerçek kaynaklar okunuyor…</p> : null}
    {error ? <p role="status">{error}</p> : null}
    {view && view.persistence !== "VERIFIED" ? <p>Kalıcı bildirim kaydı: {view.persistence}. Teslim ve acknowledgement doğrulanmadı.</p> : null}
    {visible.map(a => <article key={a.alertId} role={a.priority === "CRITICAL" && a.notificationEligible ? "alert" : undefined} data-priority={a.priority}>
      <p><strong>{a.priority}</strong> — {a.summary}</p><p>{a.consequence}</p>
      {a.requestedDecision ? <p>{a.requestedDecision}</p> : null}
      <details><summary>Kanıt ve bildirim geçmişi</summary><p>{a.evidence.source} / {a.evidence.reference}</p><p>Kanıt SHA-256: {a.evidence.digest}</p>
        <p>İlk görüldü: {a.firstSeen}; değişti: {a.lastChanged}; bildirildi: {a.lastNotified ?? "henüz yok"}</p>
        <p>Sonraki uygun zaman: {a.nextEligibleNotification ?? "şimdi"}; escalation: {a.escalationReason ?? "yok"}</p>
      </details>
      <button type="button" disabled={busy || view?.persistence !== "VERIFIED" || !view?.ownerAuthenticated || a.acknowledgedFingerprint === a.fingerprint}
        onClick={() => { setBusy(true); void recordOwnerExecutiveAttention({operation:"ACKNOWLEDGE",alertId:a.alertId,fingerprint:a.fingerprint})
          .then(refresh).catch(() => setError("Acknowledgement kaydedilemedi; güncel kanıtı yenile.")).finally(() => setBusy(false)); }}>
        {a.acknowledgedFingerprint === a.fingerprint ? "Görüldü" : "Gördüm"}
      </button>
    </article>)}
    {view && !visible.length ? <p>Yeni öncelikli bildirim yok.</p> : null}
    {!compact && view ? <dl>{view.sections.map(s => <div key={s.domain}><dt><strong>{s.title}</strong> · {s.status}</dt><dd>{s.summary}
      <details><summary>Kaynak</summary>{s.evidence.map((e,n) => <p key={n}>{e}</p>)}</details></dd></div>)}</dl> : null}
    {!compact && routine.length ? <details data-testid="executive-briefing-routine"><summary>Rutin olaylar ({routine.length}) — yalnız denetim kaydı, bildirim yok</summary>
      {routine.map(s => <p key={s.issueKey}>{s.summary} — {s.evidence.source} / {s.evidence.reference} · SHA-256 {s.evidence.digest}</p>)}</details> : null}
    <p><a href="/brain/briefing">Tam briefing ve kanıtlar</a> · <a href="/brain">Mevcut onay ve sistem kontrolleri</a></p>
    <button type="button" disabled={busy} onClick={() => void refresh()}>{busy ? "Kaynaklar okunuyor…" : "Briefing'i yenile"}</button>
  </section>;
}
