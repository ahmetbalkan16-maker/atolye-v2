"use client";

import { useEffect, useState } from "react";
import type { AtolyeBrainsView, QueueRow } from "@/lib/v3/council/BrainsReport";
import { applyAyasCodeChangeAction, rejectAyasCodeChangeAction, requestAyasDevelopmentAction } from "../../../app/brain/actions";

/**
 * Atölye V3's brains in the Gelişim Merkezi (owner approval, 2 Nov 2026): AYAS's director's council on the latest cut,
 * what the brains learned from reference videos, the idle loop's cycles and the brains' own measured changes, and the
 * code proposals that wait for the owner. Approving a proposal records the decision only; nothing is built by it.
 * Since 9 Nov 2026 (owner: "ayas tamamen otomatik çalışacak, benim onay uygula diye tıklama ile onay alıp yapacak") the
 * development queue also takes the owner's own requests for main AYAS, and a ready build carries "ONAYLA VE UYGULA":
 * the one click that lets the observer commit, push and take that exact build live.
 */
type Decision = "onaylandi" | "reddedildi";
type ViewResult = { readonly ok: boolean; readonly code?: string; readonly view: AtolyeBrainsView };

const errorLabel: Record<string, string> = {
  authentication_required: "Oturum doğrulanamadı; yeniden giriş yap.",
  brain_report_decision_unavailable: "Erişim kapısı kapalı; karar kaydedilemedi.",
  V3_PROPOSAL_NOT_FOUND: "Öneri bulunamadı (silinmiş olabilir).",
  V3_PROPOSAL_DECIDED: "Bu öneriye zaten karar verilmiş.",
  V3_REQUEST_TOO_SHORT: "İstek çok kısa; ne istediğini bir iki cümleyle yaz.",
  V3_REQUEST_LIMIT: "Kuyrukta zaten 5 açık isteğin var; biri bitince yenisini yaz.",
  V3_BUILD_NOT_READY: "Bu iş artık hazır durumda değil.",
  V3_BUILD_APPLYING: "Bu değişiklik zaten uygulanıyor.",
  CODE_APPLY_BUILD_NOT_FOUND: "Hazır yapı bulunamadı (yeniden yapılıyor olabilir).",
  CODE_APPLY_BUILD_CHANGED: "Yapı, kartı gördüğünden beri değişti; sayfayı yenileyip yeniden bak.",
  CODE_APPLY_OUTSIDE_LANE: "Bu değişiklik tek tıkla uygulanamayacak bir dosyaya dokunuyor.",
  CODE_APPLY_ALREADY_DECIDED: "Bu yapı için onay zaten verildi.",
  CODE_APPLY_ADMISSION_REJECTED: "Onay mühürlenemedi; yeniden giriş yapıp tekrar dene.",
  OWNER_ADMISSION_REQUIRED: "Oturum doğrulanamadı; yeniden giriş yap.",
  OWNER_ADMISSION_GATE_UNAVAILABLE: "Erişim anahtarı yok; onay kaydedilemedi.",
  AYAS_SAFE_READ_ONLY: "AYAS güvenli salt-okunur modda; önce o moddan çık.",
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

  const run = async (id: string, act: () => Promise<ViewResult>): Promise<boolean> => {
    if (pending) return false;
    setPending(id);
    setError(null);
    try {
      const r = await act();
      setView(r.view);
      if (!r.ok) setError({ id, text: errorLabel[r.code ?? ""] ?? `Karar kaydedilemedi (${r.code ?? "bilinmeyen"}).` });
      return r.ok;
    } catch {
      setError({ id, text: "Bağlantı koptu; sayfayı yenileyip tekrar dene." });
      return false;
    } finally {
      setPending(null);
    }
  };
  const onDecide = async (id: string, decision: Decision) => {
    if (!decide) return;
    await run(id, () => decide({ id, decision }));
  };

  const k = view.kurul;
  return (
    <section className="bc-dev bc-dev--sub" aria-label="Atölye Beyinleri" data-testid="atolye-brains">
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
        <p className="bc-dev__notice bc-dev__notice--warn">Beyinler kodu kendileri değiştiremez. Onayladığın öneri geliştirme kuyruğuna girer; gün içinde geliştirici beyni onu araştırır, her akşam 16:30&apos;dan sonra Claude onu sipariş yokken ayrı bir kopyada yapar, testlerden geçerse &quot;hazır&quot; olur. Hazır değişiklik ancak sen &quot;ONAYLA VE UYGULA&quot;ya bastığında commit&apos;lenir, gönderilir ve canlıya alınır; kendiliğinden hiçbir şey canlıya geçmez.</p>
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
        {view.fikirSayisi ? <p className="bc-empty">{view.fikirSayisi} fikir daha bekliyor; başka bir üretimde tekrar ederse yukarıya gelir. Aynı isteği farklı sözlerle tekrar edenler anlamca birleştirilip sayılır.</p> : null}
        {view.fikirler?.length ? (
          <details data-testid="atolye-ideas">
            <summary>Diğer fikirler ({view.fikirler.length}) — tek bir üretimden geldi; istersen şimdi onaylayabilirsin</summary>
            <div className="bc-dev__timeline">
              {view.fikirler.map((o) => (
                <article key={o.id} className="bc-dev__proposal" data-testid={`atolye-idea-${o.id}`}>
                  <header className="bc-dev__proposal-head"><div><span className="bc-dev__status">FİKİR</span><h3>{o.baslik}</h3></div><span>{o.beyin} · {when(o.tarih)}</span></header>
                  <p>{o.neden}</p>
                  {error?.id === o.id ? <p className="bc-dev__notice bc-dev__notice--danger" role="alert">{error.text}</p> : null}
                  <div className="bc-dev__actions">
                    <button type="button" disabled={!decide || pending !== null} onClick={() => void onDecide(o.id, "onaylandi")}>{pending === o.id ? "KAYDEDİLİYOR…" : "ONAYLA"}</button>
                    <button type="button" disabled={!decide || pending !== null} onClick={() => void onDecide(o.id, "reddedildi")}>REDDET</button>
                  </div>
                </article>
              ))}
            </div>
          </details>
        ) : null}
        <DevelopmentRequest pending={pending} error={error?.id === REQUEST_ID ? error.text : undefined} onSend={(metin) => run(REQUEST_ID, () => requestAyasDevelopmentAction({ metin }))} />
        {view.kuyruk.some((k) => k.yapi) ? (
          <div className="bc-dev__timeline" data-testid="atolye-ready-builds">
            {view.kuyruk.filter((k) => k.yapi).map((k) => (
              <ReadyBuild key={k.id} k={k} pending={pending} error={error?.id === k.id ? error.text : undefined}
                onApply={(buildHash) => void run(k.id, () => applyAyasCodeChangeAction({ id: k.id, buildHash }))}
                onReject={() => void run(k.id, () => rejectAyasCodeChangeAction({ id: k.id }))} />
            ))}
          </div>
        ) : null}
        {view.kuyruk.length ? (
          <>
            <p><b>Geliştirme kuyruğu:</b></p>
            <ul className="bc-dev__micro-items">{view.kuyruk.map((k) => <li key={k.id} className="bc-dev__micro-item" data-testid={`atolye-queue-${k.id}`}><b>{k.durum}</b>{k.kapsam === "ayas" ? " · ana AYAS" : ""}{k.kaynak === "SENİN İSTEĞİN" ? " · senin isteğin" : ""} — {k.baslik}{k.ayrinti ? <> · <span>{k.ayrinti}</span></> : null}{k.uygulama ? <> · <span>{k.uygulama.durum}{k.uygulama.ayrinti ? ` (${k.uygulama.ayrinti})` : ""}</span></> : null}</li>)}</ul>
          </>
        ) : null}
        {view.kararlar.length ? <details><summary>Son kararların ({view.kararlar.length})</summary><ul>{view.kararlar.map((x) => <li key={x.baslik}>{x.durum === "onaylandi" ? "Onaylandı" : x.durum === "reddedildi" ? "Reddedildi" : x.durum}: {x.baslik}</li>)}</ul></details> : null}
      </section>

      {view.gelistirici ? <DevBrainSection g={view.gelistirici} /> : null}
    </section>
  );
}

const REQUEST_ID = "__gelistirme-istegi";

/**
 * The owner's own request to AYAS (owner decision 2026-11-09): what to build, in their words. It goes straight into the
 * development queue as a main-AYAS job; the finished change comes back here for "ONAYLA VE UYGULA".
 */
function DevelopmentRequest({ pending, error, onSend }: { readonly pending: string | null; readonly error?: string; readonly onSend: (metin: string) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <details className="bc-dev__proposal" data-testid="atolye-dev-request">
      <summary>AYAS&apos;tan geliştirme iste</summary>
      <p>Ne istediğini yaz (ör. &quot;Gelişim Merkezi&apos;nde araştırma kartlarına tarih ekle&quot;). İş geliştirme kuyruğuna girer; akşam 16:30&apos;dan sonra Claude onu ayrı bir kopyada yazıp test eder, hazır olunca burada &quot;ONAYLA VE UYGULA&quot; ile onayına gelir. Ana sayfa, güvenlik/yetki/yayın düzeneği ve üretim katmanı bu yolla hiç değişmez.</p>
      <textarea aria-label="Geliştirme isteği" rows={3} maxLength={4000} value={text} onChange={(e) => { setText(e.target.value); setSent(false); }} />
      {error ? <p className="bc-dev__notice bc-dev__notice--danger" role="alert">{error}</p> : null}
      {sent ? <p className="bc-dev__notice bc-dev__notice--safe" role="status">İstek kuyruğa alındı.</p> : null}
      <div className="bc-dev__actions">
        <button type="button" disabled={pending !== null || text.trim().length < 10} onClick={() => void onSend(text).then((ok) => { if (ok) { setText(""); setSent(true); } })}>{pending === REQUEST_ID ? "KAYDEDİLİYOR…" : "KUYRUĞA EKLE"}</button>
      </div>
    </details>
  );
}

/** A ready build: what changed and how it was checked, and the one click that applies exactly this build. */
function ReadyBuild({ k, pending, error, onApply, onReject }: { readonly k: QueueRow; readonly pending: string | null; readonly error?: string; readonly onApply: (buildHash: string) => void; readonly onReject: () => void }) {
  const y = k.yapi!;
  const busy = k.uygulama?.bekliyor ?? false;
  return (
    <article className="bc-dev__proposal" data-testid={`atolye-build-${k.id}`}>
      <header className="bc-dev__proposal-head"><div><span className="bc-dev__status">{k.kapsam === "ayas" ? "ANA AYAS" : "ATÖLYE V3"} · HAZIR</span><h3>{k.baslik}</h3></div><span>{k.kaynak ?? ""}</span></header>
      {y.ozet ? <p>{y.ozet}</p> : null}
      <details><summary>{y.dosyalar.length} dosya · {y.kontroller} kontrol geçti{y.tabandaDusen.length ? ` · ${y.tabandaDusen.length} test zaten tabanda düşüyordu` : ""}</summary><ul>{y.dosyalar.map((f) => <li key={f}>{f}</li>)}</ul>{y.tabandaDusen.length ? <p>Tabanda da düşen (yapının hatası sayılmadı): {y.tabandaDusen.join(", ")}</p> : null}</details>
      {k.uygulama ? <p className="bc-dev__notice bc-dev__notice--safe" role="status">{k.uygulama.durum}{k.uygulama.ayrinti ? ` — ${k.uygulama.ayrinti}` : ""}</p> : null}
      {y.engel ? <p className="bc-dev__notice bc-dev__notice--warn">{y.engel}</p> : null}
      {error ? <p className="bc-dev__notice bc-dev__notice--danger" role="alert">{error}</p> : null}
      <div className="bc-dev__actions">
        {y.buildHash ? <button type="button" disabled={pending !== null || busy} onClick={() => onApply(y.buildHash!)}>{pending === k.id ? "KAYDEDİLİYOR…" : busy ? "UYGULANIYOR…" : "ONAYLA VE UYGULA"}</button> : null}
        <button type="button" disabled={pending !== null || busy} onClick={onReject}>REDDET</button>
      </div>
    </article>
  );
}

const LEVEL: Readonly<Record<NonNullable<AtolyeBrainsView["gelistirici"]>["hazirlik"]["seviye"], string>> ={ baslangic: "YENİ BAŞLADI", ogreniyor: "ÖĞRENİYOR", yaklasiyor: "YAKLAŞIYOR", hazir: "HAZIR OLABİLİR" };

/** The developer brain: its report card against Claude's real changes, what it knows, its lessons and notes. */
function DevBrainSection({ g }: { readonly g: NonNullable<AtolyeBrainsView["gelistirici"]> }) {
  return (
    <section className="bc-dev__section" aria-labelledby="atolye-gelistirici" data-testid="atolye-dev-brain">
      <h3 id="atolye-gelistirici">Geliştirici Beyni <span>{LEVEL[g.hazirlik.seviye]}</span></h3>
      <p className="bc-dev__notice bc-dev__notice--safe">Gün içinde onaylanan işleri araştırır ve tahminini yazar; her akşam 16:30&apos;dan sonra işi Claude yapar, beyin kendi tahminini Claude&apos;un yaptığıyla karşılaştırıp öğrenir. Her yeni commit&apos;te de aynı sınava girer. Boşta geçmiş bir değişikliği kendisi yeniden yazar (yazma sınavı); yeterince geçince Claude yokken onaylı işi kendisi yazabilir — yine de her kontrolden geçmeyen iş tutulmaz, hiçbir şey kendiliğinden canlıya geçmez.</p>
      <p><b>Karne:</b> {g.hazirlik.ozet}</p>
      {g.yazma ? <p data-testid="atolye-dev-writing"><b>Kendi kodu:</b> {g.yazma.ozet}</p> : <p data-testid="atolye-dev-writing"><b>Kendi kodu:</b> henüz yazma sınavına girmedi</p>}
      {g.yazma?.son.length ? <ul className="bc-dev__micro-items">{g.yazma.son.map((w) => <li key={`${w.tarih}${w.gorev}`} className="bc-dev__micro-item"><b>{when(w.tarih)}</b> — yazma sınavı: {w.gorev.slice(0, 90)} — {w.sonuc === "gecti" ? "geçti" : w.sonuc === "kaldi" ? "kaldı" : "sayılmadı"} ({w.turlar} tur)</li>)}</ul> : null}
      <p>Hafıza: {g.gecmis} değişiklik · {g.icgudu.toplam} içgüdü ({g.icgudu.dogrulanan} doğrulandı, {g.icgudu.reddedilen} bırakıldı)</p>
      {g.kod?.toplam ? <p>Kod deneyimi: {g.kod.toplam} değişikliğin kodu (hangi dosyada hangi fonksiyon, eklenen kod, testi) · {g.kod.tarifli} tanesinin nasıl yapıldığını kendi sözleriyle yazdı</p> : null}
      {g.kod?.sonTarif ? <details><summary>Son tarifi — {g.kod.sonTarif.gorev.slice(0, 80)}</summary><p>{g.kod.sonTarif.nasil}</p></details> : null}
      {g.notlar.length ? <ul className="bc-dev__micro-items">{g.notlar.map((n) => <li key={`${n.tarih}${n.gorev}`} className="bc-dev__micro-item"><b>{when(n.tarih)}</b> — {n.gorev.slice(0, 90)}: {n.satir}</li>)}</ul> : null}
      {g.dersler.length ? <details><summary>Dersleri ({g.dersler.length})</summary><ul>{g.dersler.map((d) => <li key={d}>{d}</li>)}</ul></details> : null}
      {g.akis.length ? <details><summary>Notları ({g.akis.length})</summary><ul>{g.akis.map((t) => <li key={`${t.tarih}${t.metin}`}><b>{when(t.tarih)}</b>{t.kime ? ` → ${t.kime}` : ""}: {t.metin}</li>)}</ul></details> : null}
    </section>
  );
}
