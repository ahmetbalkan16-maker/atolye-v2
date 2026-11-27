"use client";

import { useCallback, useEffect, useState } from "react";
import type { SecurityWatchView } from "@/lib/brain/security/SecurityWatchStore";
import { liftSecurityLoginLockAction, readSecurityWatchAction } from "../../../app/brain/actions";

/**
 * The security brain's ("Bekçi", owner 2026-11-26) section of the Güvenlik panel: its latest round, every finding with
 * its evidence and advice, the weekly exam, the case library and — while a brute-force lock is on — the owner's
 * "Kilidi kaldır" button. Reads through the session-guarded actions; refreshes every 60 s while visible.
 */
const REFRESH_MS = 60_000;
const SEVERITY_LABEL: Record<string, string> = { kritik: "KRİTİK", yuksek: "YÜKSEK", orta: "ORTA", dusuk: "DÜŞÜK" };
const clock = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const when = (iso: string) => clock.format(new Date(iso));

export function SecurityWatchPanel() {
  const [view, setView] = useState<SecurityWatchView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    readSecurityWatchAction().then((v) => { setView(v); setFailed(null); }).catch((e: unknown) => setFailed(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => {
    const first = window.setTimeout(load, 0);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") load(); }, REFRESH_MS);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [load]);

  const lift = () => {
    setBusy(true);
    liftSecurityLoginLockAction().then(load).catch((e: unknown) => setFailed(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false));
  };

  const report = view?.report ?? null;
  return (
    <section className="bc-security-watch" data-testid="bc-security-watch" aria-label="Bekçi — güvenlik beyni">
      <h3>Bekçi — güvenlik beyni</h3>
      <p className="bc-security-watch__lead">Bu bilgisayarı yalnız içeriden ölçer (ağ taraması yapmaz); her gün internetteki resmî güvenlik tavsiyelerini kurulu sürümlerimizle karşılaştırır (dışarıya yalnız paket adı ve sürümü gider). Kendi başına yalnız kaba kuvvet denemesinde şifre girişini kilitler; geri kalan her işi sana bırakır.</p>
      {failed && <p role="alert">Bekçi okunamadı: {failed}</p>}
      {!view && !failed && <p>Okunuyor…</p>}
      {view?.error && <p role="alert">Rapor okunamadı: {view.error}</p>}
      {view?.lockedUntil && (
        <div className="bc-security-watch__lock" role="alert">
          <strong>Şifre girişi {when(view.lockedUntil)} saatine kadar kilitli.</strong> Açık oturumların çalışıyor.
          <button type="button" onClick={lift} disabled={busy}>{busy ? "Kaldırılıyor…" : "Kilidi kaldır"}</button>
        </div>
      )}
      {view && !report && !view.error && <p>Bekçi henüz bir tur yapmadı; gözlemci 15 dakika içinde ilk turu atar.</p>}
      {report && (
        <>
          <p className="bc-security-watch__meta">Son tur: {when(report.checkedAt)} · {report.findings.length === 0 ? "bulgu yok" : `${report.findings.length} bulgu`}{report.exam ? ` · haftalık sınav ${report.exam.passed}/${report.exam.total}${report.exam.falseAlarms ? `, ${report.exam.falseAlarms} yanlış alarm` : ""}` : ""}</p>
          {report.findings.length > 0 && (
            <ul className="bc-security-watch__findings">
              {report.findings.map((f) => (
                <li key={f.id} data-severity={f.severity}>
                  <b>{SEVERITY_LABEL[f.severity] ?? f.severity}</b> {f.title}
                  <small>Kanıt: {f.evidence}</small>
                  <small>Ne yapmalı: {f.advice}{f.ownerAction ? " (senin kararın)" : ""}</small>
                </li>
              ))}
            </ul>
          )}
          {report.scanner && (
            <p className="bc-security-watch__meta" data-testid="bc-security-scanner">
              Şifre taraması: {report.scanner.tool === "gitleaks" ? `Gitleaks ${report.scanner.version ?? ""} (tüm Git geçmişi) + yerleşik desenler` : `yalnız yerleşik desenler — ${report.scanner.reason ?? "Gitleaks çalışmadı"}`}
            </p>
          )}
          {report.research && (
            <details className="bc-security-watch__cases" data-testid="bc-security-research">
              <summary>Güvenlik araştırması: {report.research.components} bileşen, {report.research.advisories} tavsiye okundu, {report.research.affecting === 0 ? "bizi etkileyen yok" : `${report.research.affecting} tanesi bizi etkiliyor`} ({when(report.research.checkedAt)})</summary>
              <ul>
                {report.research.sources.map((s) => <li key={s.id}>{s.ok ? "✓" : "✗"} {s.label}{s.okAt ? ` · son başarılı ${when(s.okAt)}` : ""}{s.error ? ` · ${s.error}` : ""}</li>)}
              </ul>
            </details>
          )}
        </>
      )}
      {view && view.cases.length > 0 && (
        <details className="bc-security-watch__cases">
          <summary>Vaka kütüphanesi (son {view.cases.length})</summary>
          <ul>
            {view.cases.map((c, i) => <li key={`${c.at}${c.id}${i}`}>{when(c.at)} · {c.event === "goruldu" ? "görüldü" : "giderildi"} · {c.title}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
