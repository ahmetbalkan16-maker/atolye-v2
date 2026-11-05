import { planAyasAdaptation, type AyasAdaptationRouting } from "../../brain/autonomy/AyasAdaptationPipeline";
import type { AyasExternalResearchFinding } from "../../brain/autonomy/AyasExternalResearchStore";
import type { AtolyeStage, CostClass, KnowledgeRecord } from "./AyasSharedKnowledge";

/**
 * Atölye's real production chain as the code runs it today (V3, feature/cop-adam-v3, 5 Nov 2026), each capability
 * with the file that proves it, and the gaps the owner's reviews named. The research knowledge is compared with
 * THIS, not with technology news: a finding matters only when it addresses a named gap at an acceptable cost.
 * Edit it when the pipeline changes; the facts here are pinned by smoke-ayas-web-research against the files they cite.
 */
export interface StageCapability {
  readonly asama: AtolyeStage;
  readonly bugun: readonly { readonly ne: string; readonly kanit: string }[];
  readonly eksikler: readonly { readonly ne: string; readonly kaynak: string; readonly olcut: string }[];
}

export const ATOLYE_CAPABILITIES: readonly StageCapability[] = [
  { asama: "research", bugun: [{ ne: "Wikipedia/Commons kaynak bankası ve doğrulama turu", kanit: "src/lib/v3/research/SourceResearch.ts" }], eksikler: [{ ne: "birincil kaynak ve akademik doğrulama zayıf (yalnız ansiklopedik kaynaklar)", kaynak: "owner 5 Kasım: tarihsel doğruluk korunmalı", olcut: "her iddiada ≥ 2 bağımsız kaynak" }] },
  { asama: "script", bugun: [{ ne: "gpt-4.1 yazar + gpt-4.1-mini denetçi (OpenAI), Ollama seçeneği; Short tarifi ve zaman haritası", kanit: "src/lib/v3/script/ScriptPrompts.ts" }], eksikler: [{ ne: "ilk 1–3 saniye yeterince güçlü değil (%48 kaydırıp geçiyor)", kaynak: "Crowns & Doodles Studio, 5 Kasım 2026", olcut: "izlemeyi seçenler %52 → %58–60" }] },
  { asama: "scenes", bugun: [{ ne: "yönetmen planı: sahne düzeni, oyun, geçiş, kamera ipuçları", kanit: "src/lib/v3/director/Director.ts" }], eksikler: [{ ne: "yakın plan, zoom ve pan az; kamera dili sinematik değil", kaynak: "owner 5 Kasım: Caesar Short analizi", olcut: "Short'ta her sahnede kamera hareketi (QC sahne planı satırı)" }] },
  { asama: "visuals", bugun: [{ ne: "dönem görseli (Wikimedia Commons, lisans süzgeci) + yerel SDXL set/an tasarımı + gemma4 hakem", kanit: "src/lib/v3/backgrounds/BackgroundDesigner.ts" }], eksikler: [{ ne: "arka plan ve set kalitesi tutarsız", kaynak: "owner 22 Ekim: \"arka planlar anlamsız\"", olcut: "kalite beyni set puanı ≥ 8/10" }] },
  { asama: "animation", bugun: [{ ne: "Remotion çöp adam kuklaları, yaşayan harita, Rhubarb ağız senkronu", kanit: "src/lib/v3/lipsync/LipSync.ts" }], eksikler: [{ ne: "yüz ifadeleri ve karakter canlandırması zayıf; görüntüden video (image-to-video) modeli yok", kaynak: "owner 5 Kasım: yüz ifadelerinin daha etkili animasyonu", olcut: "kalite beyni 'anlatılanı gösterme' ≥ 7/10" }] },
  { asama: "voice", bugun: [{ ne: "İngilizce VoxCPM / Kokoro, Türkçe Chatterbox (yerel)", kanit: "src/lib/v3/tts/Tts.ts" }], eksikler: [{ ne: "duygu ve karakter sesi çeşitliliği sınırlı", kaynak: "Caesar analizi: farklı karakter sesleri hikâyeye hareket katıyor", olcut: "görünür karakter başına ayrı ses (QC satırı) + dinleyici testi" }] },
  { asama: "audio", bugun: [{ ne: "ACE-Step 1.5 (MIT) yerel müzik, Kenney CC0 + MOSS-SoundEffect v2 efektler, miks ve vızıltı ölçümü", kanit: "src/lib/v3/mix/MusicComposer.ts" }], eksikler: [{ ne: "önemli hareketlerde ses efekti eksik", kaynak: "owner 5 Kasım: önemli hareketlerde ses efektleri", olcut: "Short'ta her sahnede efekt (QC sahne planı satırı)" }] },
  { asama: "assembly", bugun: [{ ne: "Remotion parçalı render + ffmpeg birleştirme, −14 LUFS", kanit: "src/lib/v3/render/ChunkedRender.ts" }], eksikler: [{ ne: "üretim süresi uzun (45 sn'lik Short ~1 sa 25 dk)", kaynak: "ilk Caesar Short denemesi, 2 Kasım 2026", olcut: "Short ≤ 45 dk" }] },
  { asama: "thumbnail", bugun: [{ ne: "kapak tasarımcısı + hakem", kanit: "src/lib/v3/thumbnail/ThumbnailDesigner.ts" }], eksikler: [] },
  { asama: "seo", bugun: [{ ne: "başlık, açıklama, bölüm, etiket paketi", kanit: "src/lib/v3/thumbnail/YoutubePackage.ts" }], eksikler: [{ ne: "arama trafiği %0,8 — Short'larda başlık/SEO etkisi küçük", kaynak: "Crowns & Doodles Studio, 5 Kasım 2026", olcut: "önce açılış; SEO ikinci öncelik" }] },
  { asama: "youtube", bugun: [{ ne: "elle yükleme (owner kararı 3 Kasım); yayın sonrası ölçüm kaydı", kanit: "scripts/v3/kanal.ts" }], eksikler: [{ ne: "Analytics API bağlı değil; ölçümler elle giriliyor", kaynak: "owner 3 Kasım: API bağlantısı yok", olcut: "her video 48 sa ve 7 gün ölçümü kayıtlı" }] },
  { asama: "quality", bugun: [{ ne: "gemma4 kare hakemi + yerleşim/piksel ölçümü + yönetmen kurulu", kanit: "src/lib/v3/council/QualityBrain.ts" }], eksikler: [{ ne: "görsel model hakemi gürültülü (aynı gün 90 ve 73)", kaynak: "kalite sınavı, 2 Kasım 2026", olcut: "sınav dengeli doğruluk ≥ %90, ±5 içinde tekrar" }] },
  { asama: "cost", bugun: [{ ne: "video başına bütçe tavanı ($1 Short, $4 uzun); yerel modeller tercih", kanit: "src/lib/v3/script/V3Budget.ts" }], eksikler: [{ ne: "senaryo/kurul OpenAI'ye bağlı (kredi biterse sipariş senaryoda durur)", kaynak: "3 Kasım 2026 kredi bitişi", olcut: "OpenAI olmadan Short teslim edilebilir" }] },
];

const COST_RANK: Readonly<Record<CostClass, number>> = { ACIK_KAYNAK_YEREL: 0, UCRETSIZ_HESAPSIZ: 1, UCRETSIZ_HESAPLI: 2, DENEME_KREDISI: 4, UCRETLI: 5, BILINMIYOR: 6 };

export interface GapProposal {
  readonly asama: AtolyeStage;
  readonly eksik: string;
  readonly olcut: string;
  readonly adaylar: readonly { readonly baslik: string; readonly url: string; readonly maliyet: CostClass; readonly dogrulama: string; readonly engel: string }[];
  /** A measurable experiment the owner can approve; never applied by this report. */
  readonly deney: string;
  /**
   * The governance lane adopting the first candidate would go through (M22.8 AyasAdaptationPipeline over the stage's
   * own code-evidence files): which approval it needs, never an approval. Absent when there is no candidate.
   */
  readonly uyarlama?: { readonly yol: AyasAdaptationRouting; readonly neden: string; readonly dosyalar: readonly string[]; readonly acikSorular: readonly string[] };
}

const LICENCE_COST: Readonly<Record<CostClass, AyasExternalResearchFinding["licenseCostStatus"]>> = {
  ACIK_KAYNAK_YEREL: "open-source", UCRETSIZ_HESAPSIZ: "free-tier-available", UCRETSIZ_HESAPLI: "free-tier-available", DENEME_KREDISI: "free-tier-available", UCRETLI: "paid-only", BILINMIYOR: "unknown",
};

/** A knowledge record in the shape the adaptation pipeline reads (it routes on licence/cost, official source and confidence). */
export function adaptationFindingOf(record: KnowledgeRecord, stage: StageCapability): AyasExternalResearchFinding {
  return {
    schemaVersion: "1", findingId: `knowledge-${record.id}`, recordedAt: record.erisimTarihi, provider: record.yayinci ?? new URL(record.url).hostname, capability: record.baslik,
    problemSolved: record.ozet.slice(0, 300), sourceUrl: record.url, isOfficialSource: record.dogrulama.durum === "RESMI_KAYNAK", featureDate: record.yayinTarihi ?? null,
    lastCheckedAt: record.erisimTarihi, confidence: record.dogrulama.durum === "COK_KAYNAK" || record.dogrulama.durum === "RESMI_KAYNAK" ? "medium" : "low",
    licenseCostStatus: record.lisans ? LICENCE_COST[record.maliyet.sinif] : "unknown", licenseCostNotes: record.lisans?.kanit ?? "", atolyeGapStatus: "missing",
    atolyeGapNotes: stage.eksikler.map((gap) => gap.ne).join("; ").slice(0, 300), treatedSourceAsUntrusted: true,
  };
}

/**
 * For each named gap, the knowledge that speaks to its stage, cheapest and best verified first. A gap with no
 * candidate is listed too, so the next research knows where to look.
 */
export function compareWithAtolye(records: readonly KnowledgeRecord[], perGap = 3): GapProposal[] {
  return ATOLYE_CAPABILITIES.flatMap((stage) => stage.eksikler.map((gap) => {
    // A candidate is something the channel may use: readable, no instruction-shaped text, not non-commercial. A studied
    // or curated finding outranks a bare search hit (whose only evidence is the provider's one-line summary).
    const evidence = (r: KnowledgeRecord) => (r.etiketler.some((t) => t.startsWith("arama:")) ? 2 : 0) + (/\bawesome\b/i.test(r.baslik) ? 1 : 0) - (r.dogrulama.kaynaklar.length > 1 ? 1 : 0);
    const chosen = records
      .filter((r) => r.asamalar.includes(stage.asama) && r.dogrulama.durum !== "ERISILEMEDI" && !r.enjeksiyonSuphesi && !/ticari olmayan/.test(r.uygulamaEngeli))
      .sort((a, b) => evidence(a) - evidence(b) || COST_RANK[a.maliyet.sinif] - COST_RANK[b.maliyet.sinif] || (b.dogrulama.durum === "RESMI_KAYNAK" ? 1 : 0) - (a.dogrulama.durum === "RESMI_KAYNAK" ? 1 : 0))
      .slice(0, perGap);
    const adaylar = chosen.map((r) => ({ baslik: r.baslik, url: r.url, maliyet: r.maliyet.sinif, dogrulama: r.dogrulama.durum, engel: r.uygulamaEngeli }));
    const deney = adaylar.length
      ? `"${adaylar[0]!.baslik}" bir V3 deneme çalışmasında (ayrı çıktı klasörü, üretim verisine dokunmadan) ${stage.asama} aşamasında denensin; ölçüt: ${gap.olcut}; maliyet ve süre mevcutla karşılaştırılsın. Lisans/maliyet: ${adaylar[0]!.maliyet} — ${adaylar[0]!.engel}.`
      : `aday yok — "${stage.asama}" için araştırma: ${gap.ne}`;
    if (!chosen.length) return { asama: stage.asama, eksik: gap.ne, olcut: gap.olcut, adaylar, deney };
    const plan = planAyasAdaptation({ finding: adaptationFindingOf(chosen[0]!, stage), declaredTargetFiles: stage.bugun.map((c) => c.kanit), independentDesignSummary: deney });
    return { asama: stage.asama, eksik: gap.ne, olcut: gap.olcut, adaylar, deney,
      uyarlama: { yol: plan.routingDecision, neden: plan.routingReason.slice(0, 300), dosyalar: plan.declaredTargetFiles, acikSorular: plan.unresolvedConcerns } };
  }));
}
