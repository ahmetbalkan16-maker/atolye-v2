"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import type { AtolyeBrainsView } from "@/lib/v3/council/BrainsReport";

/**
 * Atölye's brains around AYAS's central brain (the owner's explicit homepage instruction, 3 Nov 2026: "yardımcı
 * beyinler ayasın ana ekranında gözüksün; sürekli kendi aralarında konuşacak, geliştirecek ve tartışacaklar; bir video
 * yapılırken iş bölümü yapacak"). Each brain with what it does now, and the council's latest words below — all from the
 * records the brains write (BrainCouncilFeed); an unreadable store, or a brain with no record, says so. Read-only: while
 * the page is visible it re-reads the view the Gelişim Merkezi reads, every 30 seconds; it decides and runs nothing.
 */
const REFRESH_MS = 30_000;
/** A brain whose words are this recent is shown speaking. */
const SPEAKING_MS = 15 * 60_000;
const FEED_LINES = 5;

// One zone for the server and the browser, so the times render the same on both.
const clock = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function BrainFigure() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="8" r="3.6" /><path d="M5 20.5c.8-4 3.6-6 7-6s6.2 2 7 6" /><rect x="2.5" y="2.5" width="19" height="19" rx="4" opacity=".45" /></svg>;
}

type Meclis = AtolyeBrainsView["meclis"];
type Member = Meclis["beyinler"][number];

function Node({ b, speaking }: { readonly b: Member; readonly speaking: boolean }) {
  return (
    <li className="ah-council-node" data-id={b.id} data-durum={b.durum} data-speaking={speaking || undefined}>
      <BrainFigure />
      <span>
        <strong>{b.ad}</strong>
        <small>{`${b.durum === "calisiyor" ? "Çalışıyor — " : speaking ? "Konuşuyor — " : ""}${b.is}`}</small>
      </span>
    </li>
  );
}

export function AyasBrainCouncil({ initial, refresh, children }: { readonly initial?: AtolyeBrainsView; readonly refresh?: () => Promise<AtolyeBrainsView>; readonly children: ReactNode }) {
  const [view, setView] = useState<AtolyeBrainsView | undefined>(initial);
  // Set after mount only: the server's and the browser's first render must match.
  const [now, setNow] = useState<number | undefined>(undefined);

  useEffect(() => {
    let live = true;
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    const read = () => {
      if (!refresh || document.visibilityState !== "visible") return;
      refresh()
        .then((v) => {
          if (!live) return;
          setView(v);
          setNow(Date.now());
        })
        .catch(() => undefined);
    };
    const timer = window.setInterval(read, REFRESH_MS);
    document.addEventListener("visibilitychange", read);
    return () => {
      live = false;
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", read);
    };
  }, [refresh]);

  const meclis = view?.connected ? view.meclis : undefined;
  const members = meclis?.beyinler ?? [];
  const nameOf = (id: string) => members.find((m) => m.id === id)?.ad ?? id;
  const latest = meclis?.akis[0];
  const speaker = latest && now !== undefined && now - Date.parse(latest.tarih) < SPEAKING_MS ? latest.kim : undefined;
  const working = members.filter((m) => m.durum === "calisiyor").length;
  const half = Math.ceil(members.length / 2);
  const side = (list: readonly Member[], label: string) => (list.length ? <ul className="ah-council-nodes" aria-label={label}>{list.map((b) => <Node key={b.id} b={b} speaking={b.id === speaker} />)}</ul> : <span aria-hidden="true" />);

  return (
    <div className="ah-council" data-testid="ayas-brain-council">
      <div className="ah-council-stage">
        {side(members.slice(0, half), "Atölye beyinleri (1)")}
        <div className="ah-council-center">{children}</div>
        {side(members.slice(half), "Atölye beyinleri (2)")}
      </div>
      <section className="ah-council-feed ah-glass" aria-label="Beyin meclisi">
        <header>
          <strong>Beyin meclisi</strong>
          <span>{!view ? "Atölye beyinlerinin kayıtları okunuyor…" : !view.connected ? "Atölye beyinlerinin kayıtları okunamadı" : (meclis?.uretim ?? (working ? `${working} beyin çalışıyor` : "Şu an üretim yok; beyinler son kayıtlarıyla bekliyor"))}</span>
        </header>
        {view && !view.connected ? (
          <p className="ah-council-empty" role="alert">Kayıtlar okunamadı{view.error ? `: ${view.error}` : ""}.</p>
        ) : meclis?.akis.length ? (
          <ol aria-live="polite">
            {meclis.akis.slice(0, FEED_LINES).map((l) => (
              <li key={`${l.tarih}${l.kim}${l.metin.slice(0, 24)}`}>
                <time dateTime={l.tarih}>{clock.format(new Date(l.tarih))}</time>
                <b>{`${nameOf(l.kim)}${l.rol ? ` (${l.rol})` : ""}${l.kime ? ` → ${l.kime}` : ""}`}</b>
                <span title={l.metin}>{l.metin}</span>
              </li>
            ))}
          </ol>
        ) : view ? (
          <p className="ah-council-empty">Henüz bir beyin konuşması kaydedilmedi; ilk üretimde ya da gelişim döngüsünde burada görünür.</p>
        ) : null}
        <Link href="/brain?panel=development">Tartışmaların tamamı ve geliştirici beyni <span aria-hidden="true">↗</span></Link>
      </section>
    </div>
  );
}
