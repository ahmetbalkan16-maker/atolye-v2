"use client";

import { useEffect, useState } from "react";
import type { AtolyeBrainsView } from "@/lib/v3/council/BrainsReport";

/**
 * Atölye V3's brains in the Gelişim Merkezi (owner approval, 2 Nov 2026): AYAS's director's council on the latest cut,
 * what the brains learned from reference videos, the idle loop's cycles and the brains' own measured changes, and the
 * code proposals that wait for the owner. Approving a proposal records the decision only; nothing is built by it.
 */
type Decision = "onaylandi" | "reddedildi";

const errorLabel: Record<string, string> = {
  authentication_required: "Oturum doğrulanamadı; yeniden giriş yap.",
  brain_report_decision_unavailable: "Erişim kapısı kapalı; karar kaydedilemedi.",
  V3_PROPOSAL_NOT_FOUND: "Öneri bulunamadı (silinmiş olabilir).",
  V3_PROPOSAL_DECIDED: "Bu öneriye zaten karar verilmiş.",
};

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }) : "");

export function AtolyeBrainsPanel({ initial, refresh, decide }: {
  readonly initial?: AtolyeBrainsView;
  readonly refresh?: () => Promise<AtolyeBrainsView>;
  readonly decide?: (input: { id: string; decision: Decision }) => Promise<{ readonly ok: boolean; readonly code?: string; readonly view: AtolyeBrainsView }>;
}) {
  const [view, setView] = useState<AtolyeBrainsView | undefined>(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);

  useEffect(() => {
    if (!refresh) return;
    let live = true;
    refresh().then((v) => live && setView(v)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [refresh]);

  if (!view) return null;
  if (!view.connected) return <section className="bc-dev__section" aria-labelledby="atolye-brains"><h3 id="atolye-brains">Atölye Beyinleri</h3><p className="bc-empty" role="alert">Kayıtlar okunamadı: {view.error}</p></section>;

  const onDecide = async (id: string, decision: Decision) => {
    if (!decide || pending) return;
    setPending(id);
    setError(null);
    try {
      const r = await decide({ id, decision });
      setView(r.view);
      if (!r.ok) setError({ id, text: errorLabel[r.code ?? ""] ?? `Karar kaydedilemedi (${r.code ?? "bilinmeyen"}).` });
    } catch {
      setError({ id, text: "Bağlantı koptu; sayfayı yenileyip tekrar dene." });
    } finally {
      setPending(null);
    }
  };

  const k = view.kurul;
  return (
    <section className="bc-dev" aria-label="Atölye Beyinleri" data-testid="atolye-brains">
      <header className="bc-dev__hero"><span>Atölye V3</span><h2>Atölye Beyinleri</h2><p>Yönetmen kurulunun tartışması, benzer videolardan öğrenilenler, boşta kendini geliştirme ve onayını bekleyen kod önerileri.</p></header>

      <section className="bc-dev__section" aria-labelledby="atolye-kurul">
        <h3 id="atolye-kurul">AYAS Yönetmen Kurulu {k ? <span>{k.puan}/10</span> : null}</h3>
        {k ? (
          <article className="bc-dev__proposal">
            <header className="bc-dev__proposal-head"><div><span className="bc-dev__status">{k.deneme ? "DENEME" : "SON KESİM"}</span><h3>{k.bolum}</h3></div><span>{when(k.tarih)}</span></header>
            <ul className="bc-dev__micro-items">{k.beyinler.map((b) => <li key={b.ad} className="bc-dev__micro-item"><b>{b.ad}: {b.puan}/10</b>{b.notlar.length ? ` — ${b.notlar.length} not` : " — not yok"}</li>)}</ul>
            <p><b>AYAS:</b> {k.ayas}</p>
            {k.duzeltmeler.length ? <><p><b>Düzeltmeler (bir sonraki rötuş turunda):</b></p><ul>{k.duzeltmeler.map((d) => <li key={d}>{d}</li>)}</ul></> : null}
            <details>
              <summary>Tartışma ({k.beyinler.reduce((a, b) => a + b.notlar.length, 0)} not, {k.itirazlar.length} itiraz)</summary>
              {k.beyinler.map((b) => (b.notlar.length ? <div key={b.ad}><p><b>{b.ad}</b></p><ul>{b.notlar.map((n) => <li key={n}>{n}</li>)}</ul></div> : null))}
              {k.itirazlar.length ? <><p><b>İtirazlar</b></p><ul>{k.itirazlar.map((x) => <li key={x}>{x}</li>)}</ul></> : null}
            </details>
          </article>
        ) : <p className="bc-empty">Henüz bir yönetmen kurulu toplanmadı; ilk kesimden sonra her üretimde toplanır.</p>}
      </section>

      <section className="bc-dev__section" aria-labelledby="atolye-referans">
        <h3 id="atolye-referans">Benzer Videolardan Öğrenilenler <span>{view.referanslar.length}</span></h3>
        {view.hedefler.length ? <p className="bc-dev__notice bc-dev__notice--safe">{view.hedefler.join(" ")}</p> : null}
        {view.referanslar.length ? (
          <div className="bc-dev__timeline">
            {view.referanslar.map((r) => (
              <article key={r.url} className="bc-dev__timeline-card">
                <p><b><a href={r.url} target="_blank" rel="noreferrer">{r.baslik}</a></b> — {r.kanal} <span>{when(r.tarih)}</span></p>
                {r.ozet ? <p>{r.ozet}</p> : null}
                <details><summary>Ölçüm ve dersler ({r.dersler.length})</summary><p>{r.olcum}</p><ul>{r.dersler.map((d) => <li key={d}>{d}</li>)}</ul></details>
              </article>
            ))}
          </div>
        ) : <p className="bc-empty">Henüz referans video incelenmedi. AYAS&apos;a bir YouTube bağlantısıyla &quot;bu videodan öğren&quot; diyebilirsin; videonun hiçbir parçası kullanılmaz.</p>}
      </section>

      <section className="bc-dev__section" aria-labelledby="atolye-gelisim">
        <h3 id="atolye-gelisim">Kendini Geliştirme <span>{view.donguler.length}</span></h3>
        {view.donguler.length ? <ul className="bc-dev__micro-items">{view.donguler.map((c) => <li key={c.tarih} className="bc-dev__micro-item"><b>{when(c.tarih)}</b> — {c.ozet}</li>)}</ul> : <p className="bc-empty">Henüz bir gelişim döngüsü çalışmadı; sipariş yokken kendiliğinden başlar.</p>}
        {view.degisiklikler.length ? <><p><b>Beyinlerin kendi değişiklikleri (sınavla ölçülür, iyileşmeyen geri alınır):</b></p><ul>{view.degisiklikler.map((d) => <li key={d}>{d}</li>)}</ul></> : null}
      </section>

      <section className="bc-dev__section" aria-labelledby="atolye-oneriler">
        <h3 id="atolye-oneriler">Kod Önerileri — Onayını Bekleyenler <span>{view.oneriler.length}</span></h3>
        <p className="bc-dev__notice bc-dev__notice--warn">Beyinler kodu değiştiremez. Onayladığın öneri bir geliştirme oturumunda yapılır; onay hiçbir şeyi kendiliğinden kurmaz ya da yayınlamaz.</p>
        {view.oneriler.length ? (
          <div className="bc-dev__timeline">
            {view.oneriler.map((o) => (
              <article key={o.id} className="bc-dev__proposal" data-testid={`atolye-proposal-${o.id}`}>
                <header className="bc-dev__proposal-head"><div><span className="bc-dev__status">{o.olcum ? "ÖLÇÜLDÜ" : `${o.sayi} ÜRETİMDE`}</span><h3>{o.baslik}</h3></div><span>{o.beyin}</span></header>
                <p>{o.neden}</p>
                {error?.id === o.id ? <p className="bc-dev__notice bc-dev__notice--danger" role="alert">{error.text}</p> : null}
                <div className="bc-dev__actions">
                  <button type="button" disabled={!decide || pending !== null} onClick={() => void onDecide(o.id, "onaylandi")}>{pending === o.id ? "KAYDEDİLİYOR…" : "ONAYLA"}</button>
                  <button type="button" disabled={!decide || pending !== null} onClick={() => void onDecide(o.id, "reddedildi")}>REDDET</button>
                </div>
              </article>
            ))}
          </div>
        ) : <p className="bc-empty">Onayını bekleyen kod önerisi yok.</p>}
        {view.fikirSayisi ? <p className="bc-empty">{view.fikirSayisi} fikir daha bekliyor; başka bir üretimde tekrar ederse buraya gelir.</p> : null}
        {view.kararlar.length ? <details><summary>Son kararların ({view.kararlar.length})</summary><ul>{view.kararlar.map((x) => <li key={x.baslik}>{x.durum === "onaylandi" ? "Onaylandı" : x.durum === "reddedildi" ? "Reddedildi" : x.durum}: {x.baslik}</li>)}</ul></details> : null}
      </section>
    </section>
  );
}
