import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { listOrders } from "../orders/ProductionOrders";
import { type BrainCouncilView, loadBrainCouncil } from "./BrainCouncilFeed";
import { BRAIN_NAMES } from "./Council";
import { type DevBrainView, loadDevBrainView } from "./DevBrain";
import { type CouncilSession, editLine } from "./DirectorCouncil";
import { kindOf, listReferences, measuresLine, referenceTargets, targetsLine } from "./ReferenceStore";
import { cycleLine, type DevProposal, listCycles, listProposals, needsOwner, readTuning } from "./SelfImprovement";

/**
 * What the brains did, as the owner reads it (owner approval, 2 Nov 2026: "debates and lessons show in AYAS's chat
 * and in the Gelişim Merkezi"): the latest director's council, what was learned from reference videos, the idle loop's
 * cycles, the brains' own measured changes, and the code proposals that wait for the owner. Read-only, from the
 * runtime files the production and the idle loop write; nothing is produced or changed here.
 */
export interface AtolyeBrainsView {
  readonly connected: boolean;
  readonly error?: string;
  readonly kurul?: {
    readonly bolum: string;
    readonly tarih?: string;
    /** A dry run of the council (scripts/v3/yonetmen-kurulu.ts), not a production's. */
    readonly deneme: boolean;
    readonly puan: number;
    readonly beyinler: readonly { readonly ad: string; readonly puan: number; readonly notlar: readonly string[] }[];
    readonly itirazlar: readonly string[];
    readonly ayas: string;
    readonly duzeltmeler: readonly string[];
  };
  readonly referanslar: readonly { readonly baslik: string; readonly kanal: string; readonly url: string; readonly tarih: string; readonly olcum: string; readonly ozet: string; readonly dersler: readonly string[] }[];
  readonly hedefler: readonly string[];
  readonly donguler: readonly { readonly tarih: string; readonly ozet: string }[];
  readonly degisiklikler: readonly string[];
  readonly oneriler: readonly { readonly id: string; readonly beyin: string; readonly baslik: string; readonly neden: string; readonly sayi: number; readonly olcum: boolean }[];
  readonly fikirSayisi: number;
  /**
   * The ideas raised by one production so far (owner, 6 Nov 2026: "onaya bir şey düşmüyor ki nasıl onay vericem"): they
   * wait for a second production, but the owner sees them all and may decide any of them now.
   */
  readonly fikirler?: readonly { readonly id: string; readonly beyin: string; readonly baslik: string; readonly neden: string; readonly tarih: string }[];
  readonly kararlar: readonly { readonly baslik: string; readonly durum: string }[];
  /** The development queue (DevQueue): approved proposals and what the developer did with them, open ones first. */
  readonly kuyruk: readonly { readonly id: string; readonly baslik: string; readonly durum: string; readonly ayrinti: string }[];
  /** The developer brain (DevBrain): its report card, what it knows, its lessons and notes. */
  readonly gelistirici?: DevBrainView;
  /** The brains' council for AYAS's homepage (BrainCouncilFeed): who works now and their latest words. */
  readonly meclis: BrainCouncilView;
}

const EMPTY: Omit<AtolyeBrainsView, "connected"> = { referanslar: [], hedefler: [], donguler: [], degisiklikler: [], oneriler: [], fikirSayisi: 0, fikirler: [], kararlar: [], kuyruk: [], meclis: { beyinler: [], akis: [] } };

const QUEUE_LABEL: Readonly<Record<string, string>> = { yapiliyor: "Geliştiriliyor", hazir: "Hazır — uygulanmayı bekliyor", onaylandi: "Kuyrukta", yapilamadi: "Yapılamadı", yapildi: "Yapıldı" };
const QUEUE_ORDER = ["yapiliyor", "hazir", "onaylandi", "yapilamadi", "yapildi"];

/** The queue's rows: every open job, and the last five finished ones. */
function queueRows(proposals: readonly DevProposal[]): AtolyeBrainsView["kuyruk"] {
  const open = proposals.filter((p) => QUEUE_ORDER.slice(0, 4).includes(p.durum)).sort((a, b) => QUEUE_ORDER.indexOf(a.durum) - QUEUE_ORDER.indexOf(b.durum));
  const done = proposals.filter((p) => p.durum === "yapildi").sort((a, b) => (b.is?.bitis ?? b.karar?.tarih ?? "").localeCompare(a.is?.bitis ?? a.karar?.tarih ?? "")).slice(0, 5);
  return [...open, ...done].map((p) => ({
    id: p.id,
    baslik: p.baslik,
    durum: QUEUE_LABEL[p.durum] ?? p.durum,
    ayrinti:
      p.durum === "hazir" ? `dal ${p.is?.dal ?? "?"} · ${p.is?.dosyalar?.length ?? 0} dosya · testler geçti` : p.durum === "yapilamadi" ? `${(p.is?.sorunlar ?? []).join(" | ").slice(0, 240)} (deneme ${p.is?.deneme ?? 0})` : (p.is?.ozet ?? "").replace(/\s+/g, " ").slice(0, 240),
  }));
}

/** The latest council of a production (or of a dry run) among the orders' work folders. */
async function latestCouncil(workRoot: string): Promise<AtolyeBrainsView["kurul"]> {
  const orders = (await listOrders(workRoot)).map((x) => x.order).filter((o) => /^[\w-]+$/.test(o.id)).sort((a, b) => (b.bitis ?? b.olusturuldu).localeCompare(a.bitis ?? a.olusturuldu));
  for (const o of orders.slice(0, 10)) {
    const dir = path.join(workRoot, "bolumler", o.id);
    for (const [name, deneme] of [["yonetmen-kurulu.json", false], ["yonetmen-kurulu-deneme.json", true]] as const) {
      const file = path.join(dir, name);
      if (!existsSync(file)) continue;
      // A production writes the session itself; a dry run wraps it as { tarih, olcum, oturum }.
      const raw = JSON.parse(await fs.readFile(file, "utf8")) as { tarih?: unknown; oturum?: unknown; raporlar?: unknown };
      // (Array.isArray on the typed session would widen its reports to any.)
      if (!Array.isArray((raw.oturum as { raporlar?: unknown } | undefined)?.raporlar ?? raw.raporlar)) continue;
      const s = (raw.oturum ?? raw) as CouncilSession;
      const tarih = typeof raw.tarih === "string" ? raw.tarih : (await fs.stat(file)).mtime.toISOString();
      return {
        bolum: o.konu,
        tarih,
        deneme,
        puan: s.puan,
        beyinler: s.raporlar.map((r) => ({ ad: BRAIN_NAMES[r.beyin], puan: r.puan, notlar: r.notlar.map((n) => `${n.sahne}${n.satir !== undefined ? `#${n.satir}` : ""}: ${n.sorun} → ${n.oneri}`) })),
        itirazlar: s.yanitlar.flatMap((y) => y.itiraz.map((x) => `${BRAIN_NAMES[y.beyin]} (${x.id}): ${x.neden}`)),
        ayas: s.karar ? s.karar.ozet : (s.kararYok ?? ""),
        duzeltmeler: (s.karar?.duzeltmeler ?? []).map(editLine),
      };
    }
  }
  return undefined;
}

export async function loadAtolyeBrainsView(workRoot: string): Promise<AtolyeBrainsView> {
  try {
    const refs = await listReferences(workRoot);
    const cycles = await listCycles(workRoot);
    const tuning = await readTuning(workRoot);
    const proposals = (await listProposals(workRoot)).map((x) => x.proposal);
    const kurul = await latestCouncil(workRoot).catch(() => undefined);
    const gelistirici = await loadDevBrainView(workRoot).catch(() => undefined);
    const meclis = await loadBrainCouncil(workRoot, kurul).catch((): BrainCouncilView => ({ beyinler: [], akis: [] }));
    const degisiklikler = [
      ...Object.entries(tuning.ekler).flatMap(([b, list]) => (list ?? []).map((a) => ({ tarih: a.tarih, metin: `${BRAIN_NAMES[b as keyof typeof BRAIN_NAMES] ?? b} istem eki ${a.durum === "kalici" ? "kalıcı" : a.durum === "geri_alindi" ? "geri alındı" : "deneniyor"}: "${a.metin}" (sınav %${a.olcumOnce ?? "?"} → %${a.olcumSonra ?? "?"})` }))),
      ...tuning.ayarGecmisi.map((h) => ({ tarih: h.tarih, metin: `${BRAIN_NAMES[h.beyin]} ayarı ${h.anahtar}=${h.deger ? "açık" : "kapalı"}: sınav %${h.once} → %${h.sonra}, ${h.kalici ? "kalıcı" : "geri alındı"}` })),
    ].sort((a, b) => b.tarih.localeCompare(a.tarih)).slice(0, 8).map((x) => x.metin);
    return {
      connected: true,
      ...(kurul ? { kurul } : {}),
      referanslar: [...refs].sort((a, b) => b.tarih.localeCompare(a.tarih)).slice(0, 6).map((r) => ({ baslik: r.baslik, kanal: r.kanal, url: r.url, tarih: r.tarih, olcum: measuresLine(r.olcum), ozet: r.ozet, dersler: r.dersler.map((d) => `${BRAIN_NAMES[d.beyin]}: ${d.tr || d.metin}`) })),
      hedefler: (["short", "uzun"] as const).flatMap((k) => {
        const t = referenceTargets(refs, k);
        return t && refs.some((r) => kindOf(r.olcum.sureSn) === k) ? [`${k === "short" ? "Short" : "Uzun video"}: ${targetsLine(t)}`] : [];
      }),
      donguler: cycles.slice(-5).reverse().map((c) => ({ tarih: c.bitis, ozet: cycleLine(c) })),
      degisiklikler,
      oneriler: proposals.filter(needsOwner).sort((a, b) => b.sayi - a.sayi || b.tarih.localeCompare(a.tarih)).slice(0, 12).map((p) => ({ id: p.id, beyin: BRAIN_NAMES[p.beyin] ?? p.beyin, baslik: p.baslik, neden: p.neden, sayi: p.sayi, olcum: p.kaynakTuru === "olcum" })),
      fikirSayisi: proposals.filter((p) => p.durum === "bekliyor" && !needsOwner(p)).length,
      fikirler: proposals.filter((p) => p.durum === "bekliyor" && !needsOwner(p)).sort((a, b) => b.tarih.localeCompare(a.tarih)).slice(0, 40).map((p) => ({ id: p.id, beyin: BRAIN_NAMES[p.beyin] ?? p.beyin, baslik: p.baslik, neden: p.neden, tarih: p.tarih })),
      kararlar: proposals.filter((p) => p.karar).sort((a, b) => (b.karar?.tarih ?? "").localeCompare(a.karar?.tarih ?? "")).slice(0, 5).map((p) => ({ baslik: p.baslik, durum: p.durum })),
      kuyruk: queueRows(proposals),
      ...(gelistirici ? { gelistirici } : {}),
      meclis,
    };
  } catch (e) {
    return { connected: false, error: (e as Error).message.slice(0, 200), ...EMPTY };
  }
}

/** The view as AYAS's chat answer ("beyinler ne öğrendi", "kurul ne dedi"), in Turkish. */
export function brainsReportText(v: AtolyeBrainsView): string {
  if (!v.connected) return `Atölye beyinlerinin kayıtları okunamadı: ${v.error ?? "bilinmeyen hata"}`;
  const parts: string[] = [];
  if (v.kurul) {
    const k = v.kurul;
    parts.push(`Son yönetmen kurulu${k.deneme ? " (deneme)" : ""} — "${k.bolum}": ${k.beyinler.map((b) => `${b.ad} ${b.puan}/10`).join(", ")}; ortalama ${k.puan}/10. ${k.itirazlar.length ? `${k.itirazlar.length} itiraz oldu. ` : ""}AYAS: ${k.ayas}${k.duzeltmeler.length ? ` Düzeltmeler: ${k.duzeltmeler.slice(0, 4).join("; ")}${k.duzeltmeler.length > 4 ? ` (+${k.duzeltmeler.length - 4})` : ""}.` : ""}`);
  } else parts.push("Henüz bir yönetmen kurulu toplanmadı (ilk kesimden sonra her üretimde toplanır).");
  if (v.referanslar.length) {
    const r = v.referanslar[0]!;
    parts.push(`İncelenen ${v.referanslar.length} referans videonun sonuncusu "${r.baslik}" (${r.kanal}): ${r.ozet} Dersler: ${r.dersler.slice(0, 4).join(" · ")}.`);
  } else parts.push('Henüz referans video incelenmedi; bir YouTube bağlantısıyla "bu videodan öğren" diyebilirsin.');
  if (v.hedefler.length) parts.push(`Hedef tempo: ${v.hedefler.join(" ")}`);
  if (v.donguler.length) parts.push(`Son gelişim döngüsü: ${v.donguler[0]!.ozet}.`);
  if (v.degisiklikler.length) parts.push(`Beyinlerin kendi değişiklikleri: ${v.degisiklikler.slice(0, 3).join(" · ")}.`);
  parts.push(v.oneriler.length ? `Onayını bekleyen ${v.oneriler.length} kod önerisi var (Gelişim Merkezi): ${v.oneriler.slice(0, 3).map((o) => `"${o.baslik}"${o.sayi > 1 ? ` (${o.sayi} üretimde)` : ""}`).join("; ")}. Kod yalnız senin onayınla değişir.` : `Onayını bekleyen kod önerisi yok${v.fikirSayisi ? ` (${v.fikirSayisi} fikir, başka bir üretimde tekrar ederse sana gelir)` : ""}.`);
  if (v.oneriler.length && v.fikirSayisi) parts.push(`Ayrıca tek bir üretimden gelen ${v.fikirSayisi} fikir var; Gelişim Merkezi'nde "Diğer fikirler" altında istediğini şimdi onaylayabilirsin.`);
  else if (v.fikirSayisi) parts.push(`Bu ${v.fikirSayisi} fikri Gelişim Merkezi'nde "Diğer fikirler" altında görüp istediğini şimdi onaylayabilirsin.`);
  const open = v.kuyruk.filter((k) => k.durum !== "Yapıldı");
  if (v.kuyruk.length) parts.push(`Geliştirme kuyruğu: ${open.length ? open.map((k) => `"${k.baslik}" — ${k.durum}`).join("; ") : "açık iş yok"}${v.kuyruk.length > open.length ? ` (${v.kuyruk.length - open.length} iş yapıldı)` : ""}.`);
  if (v.gelistirici) parts.push(`Geliştirici beyni (gündüz araştırır, akşam 16:30'dan sonra Claude yapar, o da Claude'dan öğrenir): ${v.gelistirici.hazirlik.ozet}; hafızasında ${v.gelistirici.gecmis} değişiklik, ${v.gelistirici.icgudu.dogrulanan} doğrulanmış içgüdü${v.gelistirici.kod?.toplam ? `, ${v.gelistirici.kod.toplam} değişikliğin kodu (${v.gelistirici.kod.tarifli} tanesinin nasıl yapıldığını yazdı)` : ""}.${v.gelistirici.yazma ? ` Kendi kodu: ${v.gelistirici.yazma.ozet}.` : ""}${v.gelistirici.dersler[0] ? ` Son dersi: ${v.gelistirici.dersler[0]}` : ""}`);
  return parts.join("\n");
}
