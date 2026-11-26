"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { AtolyeBrainsView } from "@/lib/v3/council/BrainsReport";
import { officeLiveFromCouncil } from "@/lib/office-preview/liveStatus";
import { getPreviewBrain } from "@/lib/office-preview/brains";
import { AYAS_VOICE_HREF, getRoom, getRosterEntry, roomHref } from "@/lib/office-preview/officeRoster";
import type { PreviewBrainId } from "@/lib/office-preview/roleTypes";
import { AtolyeOffice3DScene } from "@/components/office-preview/AtolyeOffice3DScene";

/**
 * The Atölye office in the homepage's centre, in place of the old central brain (the owner's explicit homepage
 * instruction, 26 Nov 2026: "ana sayfada görmek istiyorum eski beyni değil, solda yine eskisi gibi butonlar olsun").
 * The header, the left rail, the command panel and the dock stay where they were.
 *
 * Who works comes from the same read-only council view the brain council read (`refreshAtolyeBrains`, every 30 s while
 * the page is visible), mapped by `officeLiveFromCouncil`; a worker the records do not list is shown waiting, nothing is
 * invented. Clicking AYAS starts the homepage's own voice conversation; any other worker shows what it does and links to
 * its room. It decides and runs nothing.
 */
const REFRESH_MS = 30_000;
const FEED_LINES = 3;
const clock = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function AyasHomeOffice({ initial, refresh, stateLabel, stateDetail, onTalk }: {
  readonly initial?: AtolyeBrainsView;
  readonly refresh?: () => Promise<AtolyeBrainsView>;
  readonly stateLabel: string;
  readonly stateDetail: string;
  readonly onTalk?: () => void;
}) {
  const [view, setView] = useState<AtolyeBrainsView | undefined>(initial);
  const [selected, setSelected] = useState<PreviewBrainId>("ayas");

  useEffect(() => {
    let live = true;
    const read = () => {
      if (!refresh || document.visibilityState !== "visible") return;
      refresh().then((v) => { if (live) setView(v); }).catch(() => undefined);
    };
    const timer = window.setInterval(read, REFRESH_MS);
    document.addEventListener("visibilitychange", read);
    return () => { live = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", read); };
  }, [refresh]);

  const meclis = view?.connected ? view.meclis : undefined;
  const office = meclis ? officeLiveFromCouncil(meclis) : undefined;
  const source = !view ? "CANLI VERİ OKUNUYOR" : !view.connected ? "CANLI VERİ OKUNAMADI" : "CANLI" + (office?.production ? " · " + office.production : "");

  function select(id: PreviewBrainId) {
    if (id === "ayas") {
      if (onTalk) onTalk(); else window.location.assign(AYAS_VOICE_HREF);
      return;
    }
    setSelected(id);
  }

  const brain = getPreviewBrain(selected);
  const room = getRoom(getRosterEntry(selected).roomSlug);
  const work = office?.work[selected];
  const nameOf = (id: string) => meclis?.beyinler.find((m) => m.id === id)?.ad ?? id;

  return (
    <div className="ah-office" data-testid="ayas-home-office">
      <div className="ah-office-scene">
        <AtolyeOffice3DScene selectedBrainId={selected} onSelectBrain={select} statuses={office?.statuses ?? {}} sourceLabel={source} />
      </div>
      <div className="ah-office-bar">
        <div className="ah-state" role="status" aria-label={`AYAS — ${stateLabel}`}><span className="ah-dot" aria-hidden="true" /><strong>{stateLabel}</strong><span>{stateDetail}</span></div>
        {selected === "ayas"
          ? <p className="ah-office-hint">AYAS&apos;a tıkla: sesli konuşma başlar. Bir çalışana tıkla: ne yaptığını gör.</p>
          : <p className="ah-office-pick"><b>{brain.name}</b> · {work ?? "kaydı yok, bekliyor"}{room && <> · <Link href={roomHref(room.slug)}>{room.name} odası ›</Link></>}</p>}
        <Link className="ah-office-full" href="/studio/office-preview">Ofisin tamamı ↗</Link>
      </div>
      {view && !view.connected
        ? <p className="ah-council-empty" role="alert">Kayıtlar okunamadı{view.error ? `: ${view.error}` : ""}.</p>
        : meclis?.akis.length
          ? <ol className="ah-office-feed" aria-label="Beyin meclisi" aria-live="polite">{meclis.akis.slice(0, FEED_LINES).map((l) =>
            <li key={`${l.tarih}${l.kim}${l.metin.slice(0, 24)}`}><time dateTime={l.tarih}>{clock.format(new Date(l.tarih))}</time><b>{nameOf(l.kim)}</b><span title={l.metin}>{l.metin}</span></li>)}</ol>
          : null}
    </div>
  );
}
