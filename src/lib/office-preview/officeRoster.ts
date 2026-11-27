import type { PreviewBrainId } from "./roleTypes";

/**
 * Who each office worker reports to, how far its authority goes, which of its outputs need the owner, the
 * independent auditor that questions its work, and what opens when it is clicked.
 *
 * Owner 2026-11-26: "her ajana orda sınırlı yetki ver … ne iş yapacağını kime ne rapor vereceğini bilsin kime
 * tıkladığımda ne açılacağını bilsin" and "her işin kendine ait bağımsız denetleyicisi ve kalite beyni olsun çıkan
 * işi sorgulasın". So every worker's output passes its own auditor first and then the quality brain's measurement
 * before it reaches the one it reports to; the quality brain is itself questioned by a second eye, and the
 * independent auditor reports to the owner directly so nobody it checks can overrule it.
 */
export type AuthorityLevel = "yonetir" | "uretir" | "durdurur" | "okur" | "yayinlar" | "gozler";

export const AUTHORITY_LABEL: Record<AuthorityLevel, string> = {
  yonetir: "Yönetir · plan ve dağıtım",
  uretir: "Üretir · taslak teslim eder",
  durdurur: "Durdurur · geri çevirebilir",
  okur: "Okur · rapor yazar",
  yayinlar: "Yayınlar · yalnız sahip onayıyla",
  gozler: "Gözler · alarm verir",
};

export interface OfficeAuditor {
  /** The independent auditor that questions this worker's output before anyone else sees it. */
  readonly name: string;
  /** The questions it asks of every output; an unanswered question sends the work back. */
  readonly questions: readonly string[];
}

export interface OfficeRosterEntry {
  readonly id: PreviewBrainId;
  readonly reportsTo: PreviewBrainId | "owner";
  readonly authority: AuthorityLevel;
  /** Actions that always wait for the owner's own approval. */
  readonly ownerGate: readonly string[];
  readonly auditor: OfficeAuditor;
  /** `false` only for the quality brain itself (it cannot grade its own work; the second eye does). */
  readonly qualityGate: boolean;
  /** The real AYAS page this worker's work lives on. AYAS's own entry opens the voice conversation. */
  readonly opens: { readonly label: string; readonly href: string };
  readonly roomSlug: OfficeRoomSlug;
}

/**
 * Owner 2026-11-27: "herkese bir oda ver ve odalar aynı büyüklükte olsun sadece ayasın kendi odası farklı olsun
 * diğerlerinden daha gösterişli ve büyük olsun". Every worker has a room of its own (AYAS's is "yonetim", the
 * developer's is Gelişim Merkezi "gelistirme"); the meeting room and the lounge are shared.
 */
export type OfficeRoomSlug =
  | "yonetim" | "arastirma" | "radar" | "kurgu" | "mizah" | "kostum" | "kalite" | "tarih" | "ortam" | "yayinci"
  | "analist" | "muhasebe" | "onarim" | "gozcu" | "guvenlik" | "denetci" | "ses" | "gelistirme" | "cirak"
  | "toplanti" | "dinlenme";

/** The link that drops the owner into the existing AYAS chat with voice started (BrainCoreConsole startConversation). */
export const AYAS_VOICE_HREF = "/brain?panel=chat&konus=1";

const PRODUCTION = { label: "Atölye üretim paneli", href: "/brain?panel=production" } as const;

export const OFFICE_ROSTER: readonly OfficeRosterEntry[] = [
  { id: "ayas", reportsTo: "owner", authority: "yonetir", roomSlug: "yonetim",
    ownerGate: ["Yayın", "Bütçe aşımı", "Kod değişikliğini canlıya alma", "Yeni çalışan ekleme"],
    auditor: { name: "Sahip (sen)", questions: ["Plan bütçe ve süre içinde mi?", "İş doğru çalışana mı verildi?", "Rapor gerçek sonuçlara mı dayanıyor?"] },
    qualityGate: true, opens: { label: "Sesli konuşmayı başlat", href: AYAS_VOICE_HREF } },
  { id: "arastirma", reportsTo: "ayas", authority: "uretir", roomSlug: "arastirma", ownerGate: ["Ücretli kaynak kullanımı"],
    auditor: { name: "Kaynak denetçisi", questions: ["Her alıntı makalede birebir geçiyor mu?", "Tarih ve sayılar kaynakla aynı mı?", "Telif durumu yazıldı mı?"] },
    qualityGate: true, opens: { label: "Araştırma paneli", href: "/brain?panel=research" } },
  { id: "radar", reportsTo: "ayas", authority: "okur", roomSlug: "radar", ownerGate: ["Güncellemeyi uygulama", "Model indirme"],
    auditor: { name: "Güvenlik denetçisi", questions: ["Bilinen güvenlik açığı var mı?", "Ayrı kopyada denendi mi?", "Faydası ölçüldü mü?"] },
    qualityGate: true, opens: { label: "Güncelleme radarı", href: "/brain?panel=research" } },
  { id: "kurgu", reportsTo: "ayas", authority: "uretir", roomSlug: "kurgu", ownerGate: [],
    auditor: { name: "Senaryo denetçisi", questions: ["Soru başlığı ilk saniyede soruluyor mu?", "Her iddianın kaynağı var mı?", "Sahne sırası tarifle uyumlu mu?"] },
    qualityGate: true, opens: PRODUCTION },
  { id: "mizah", reportsTo: "kurgu", authority: "uretir", roomSlug: "mizah", ownerGate: [],
    auditor: { name: "Ton denetçisi", questions: ["Espri gerçeği çarpıtıyor mu?", "Kırıcı ya da uygunsuz mu?", "Gerçek alıntıyı silip yerine şaka koydu mu?"] },
    qualityGate: true, opens: PRODUCTION },
  { id: "kostum", reportsTo: "ayas", authority: "uretir", roomSlug: "kostum", ownerGate: [],
    auditor: { name: "Dönem denetçisi", questions: ["Kıyafet o yıla ve bölgeye uyuyor mu?", "Yüz portreye benziyor mu?", "Herkes birbirinden ayırt ediliyor mu?"] },
    qualityGate: true, opens: PRODUCTION },
  { id: "kalite", reportsTo: "ayas", authority: "durdurur", roomSlug: "kalite", ownerGate: [],
    auditor: { name: "İkinci göz", questions: ["'0 hata' dediği karelere gerçekten bakıldı mı?", "Puan tek kareye mi dayanıyor?", "Sınav doğruluğu düştü mü?"] },
    qualityGate: false, opens: PRODUCTION },
  { id: "tarih", reportsTo: "ayas", authority: "durdurur", roomSlug: "tarih", ownerGate: ["Durdurulan siparişi yeniden başlatma"],
    auditor: { name: "Kaynak denetçisi", questions: ["Durdurma gerekçesi kaynakla kanıtlı mı?", "Yer değiştirmiş olay ya da kişi kaldı mı?"] },
    qualityGate: true, opens: PRODUCTION },
  { id: "ortam", reportsTo: "ayas", authority: "uretir", roomSlug: "ortam", ownerGate: ["CC BY-SA dışı görsel kullanımı"],
    auditor: { name: "Harita denetçisi", questions: ["Sınırlar ve cepheler o tarihe doğru mu?", "Yazı bir karakterin üstüne biniyor mu?", "Görselin lisansı ve kaynağı yazıldı mı?"] },
    qualityGate: true, opens: PRODUCTION },
  { id: "yayinci", reportsTo: "owner", authority: "yayinlar", roomSlug: "yayinci", ownerGate: ["Her yükleme ve yayın saati"],
    auditor: { name: "Yayın denetçisi", questions: ["Dosya 1080x1920 ve doğru sürede mi?", "Onay tam bu dosyaya mı bağlı?", "Açıklamada kaynaklar ve krediler var mı?"] },
    qualityGate: true, opens: PRODUCTION },
  { id: "analist", reportsTo: "ayas", authority: "okur", roomSlug: "analist", ownerGate: ["Reklam ya da ücretli tanıtım"],
    auditor: { name: "Veri denetçisi", questions: ["Organik ve ücretli izlenme ayrıldı mı?", "Karşılaştırma aynı süre aralığında mı?"] },
    qualityGate: true, opens: PRODUCTION },
  { id: "muhasebe", reportsTo: "owner", authority: "okur", roomSlug: "muhasebe", ownerGate: ["Bütçe tavanını değiştirme"],
    auditor: { name: "Bütçe denetçisi", questions: ["Sayaç gerçek faturayla tutuyor mu?", "Video başına tavan aşıldı mı?"] },
    qualityGate: true, opens: { label: "Gelir ve maliyet", href: "/brain/revenue" } },
  { id: "onarim", reportsTo: "ayas", authority: "uretir", roomSlug: "onarim", ownerGate: ["Durmuş siparişi yeniden başlatma"],
    auditor: { name: "Onarım denetçisi", questions: ["Seçilen çare sabit listeden mi?", "Aynı hata tekrar etti mi?", "Kök neden yazıldı mı?"] },
    qualityGate: true, opens: { label: "AYAS raporları", href: "/brain?panel=selfheal" } },
  // Owner 2026-11-26: the security brain (Bekçi); it reports straight to the owner.
  { id: "guvenlik", reportsTo: "owner", authority: "durdurur", roomSlug: "guvenlik", ownerGate: ["Port ya da hizmet kapatma", "Şifre ya da anahtar değiştirme", "Oturumları silme", "Kendi kurallarını değiştirme"],
    auditor: { name: "Sahip", questions: ["Bulgu ölçülmüş bir kanıta mı dayanıyor?", "Ölçülemeyen bir şey temiz mi sayıldı?", "Haftalık sınav tam mı, yanlış alarm var mı?"] },
    qualityGate: true, opens: { label: "Güvenlik paneli", href: "/brain?panel=safety" } },
  { id: "gozcu", reportsTo: "owner", authority: "gozler", roomSlug: "gozcu", ownerGate: ["Bir servisi kapatma"],
    auditor: { name: "Sağlık denetçisi", questions: ["Alarm gerçek bir ölçüme mi dayanıyor?", "Aynı alarm tekrar mı gönderildi?"] },
    qualityGate: true, opens: { label: "Sistem paneli", href: "/brain?panel=system" } },
  { id: "ses", reportsTo: "ayas", authority: "uretir", roomSlug: "ses", ownerGate: [],
    auditor: { name: "Ses denetçisi", questions: ["Islık ya da ötme var mı?", "Anlatım ile görüntü senkron mu?", "Müziğin lisansı uygun mu?"] },
    qualityGate: true, opens: PRODUCTION },
  { id: "denetci", reportsTo: "owner", authority: "durdurur", roomSlug: "denetci", ownerGate: [],
    auditor: { name: "Sahip (sen)", questions: ["Bulgu kanıtlı mı?", "Denetlediği işten bağımsız mı?"] },
    qualityGate: true, opens: { label: "Güvenlik paneli", href: "/brain?panel=safety" } },
  { id: "gelistirici", reportsTo: "ayas", authority: "uretir", roomSlug: "gelistirme", ownerGate: ["Her kod değişikliğini uygulama (ONAYLA VE UYGULA)", "Canlıya alma"],
    auditor: { name: "Kod denetçisi", questions: ["Yalnız izinli dosyalar mı değişti?", "TypeScript, lint ve testler geçti mi?", "Ders ve vaka kaydı yazıldı mı?"] },
    qualityGate: true, opens: { label: "Gelişim Merkezi", href: "/brain?panel=development" } },
  { id: "cirak", reportsTo: "gelistirici", authority: "uretir", roomSlug: "cirak", ownerGate: ["Her kod değişikliğini uygulama"],
    auditor: { name: "Kod denetçisi", questions: ["Sınav kodu gerçek değişiklikle aynı işi yapıyor mu?", "Sınırlı dosya kapsamında mı kaldı?"] },
    qualityGate: true, opens: { label: "Gelişim Merkezi", href: "/brain?panel=development" } },
];

const BY_ID = new Map(OFFICE_ROSTER.map((entry) => [entry.id, entry]));

/** The roster entry of a worker (every preview brain has exactly one). */
export function getRosterEntry(id: PreviewBrainId): OfficeRosterEntry {
  const entry = BY_ID.get(id);
  if (!entry) throw new Error(`office roster has no entry for ${id}`);
  return entry;
}

export interface OfficeRoom {
  readonly slug: OfficeRoomSlug;
  readonly name: string;
  readonly summary: string;
  /** The real AYAS page this room's work lives on (Gelişim Merkezi for the development room). */
  readonly opens?: { readonly label: string; readonly href: string };
  /** What the room page says when no worker has its desk here (the shared rooms). */
  readonly emptyNote?: string;
}

const opensOf = (id: PreviewBrainId) => getRosterEntry(id).opens;

export const OFFICE_ROOMS: readonly OfficeRoom[] = [
  { slug: "yonetim", name: "AYAS · Yönetim Ofisi", summary: "AYAS işi alır, planlar, dağıtır ve sonuçları toplar; çalışanlar raporlarını buraya getirir.", opens: { label: "AYAS ile sesli konuş", href: AYAS_VOICE_HREF } },
  { slug: "arastirma", name: "Araştırma", summary: "Kaynak bankası: her bilgi kaynağıyla gelir.", opens: opensOf("arastirma") },
  { slug: "radar", name: "Güncelleme Radarı", summary: "Teknoloji ve güncelleme takibi; ayrı kopyada denenmeden hiçbir şey uygulanmaz.", opens: opensOf("radar") },
  { slug: "ortam", name: "Ortam & Görsel", summary: "Dekorlar, haritalar, kapak görseli.", opens: opensOf("ortam") },
  { slug: "kurgu", name: "Kurgu", summary: "Senaryo, soru başlığı ve sahne sırası.", opens: opensOf("kurgu") },
  { slug: "mizah", name: "Mizah", summary: "Gerçeği çarpıtmayan espriler.", opens: opensOf("mizah") },
  { slug: "kostum", name: "Kostüm", summary: "Dönem kıyafetleri ve portreye benzeyen yüzler.", opens: opensOf("kostum") },
  { slug: "kalite", name: "Kalite", summary: "Kare kare kalite ölçümü; geçmeyen iş gerekçesiyle geri döner.", opens: opensOf("kalite") },
  { slug: "tarih", name: "Tarih Hakemi", summary: "Tarih kapısı: kaynakla kanıtlanmayan iddia üretimi durdurur.", opens: opensOf("tarih") },
  { slug: "yayinci", name: "Yayın", summary: "Yükleme ve yayın saati, yalnız sahip onayıyla.", opens: opensOf("yayinci") },
  { slug: "analist", name: "Kanal Analizi", summary: "Kanal sayıları ve izlenme karşılaştırmaları.", opens: opensOf("analist") },
  { slug: "muhasebe", name: "Muhasebe", summary: "Token ve dolar sayacı, video başına bütçe tavanı.", opens: opensOf("muhasebe") },
  { slug: "ses", name: "Ses Stüdyosu", summary: "Anlatım, müzik, efekt ve miks.", opens: opensOf("ses") },
  { slug: "denetci", name: "Bağımsız Denetim", summary: "Bağımsız denetçi; bulguları doğrudan sahibe gider.", opens: opensOf("denetci") },
  { slug: "guvenlik", name: "Güvenlik · Bekçi", summary: "Yerel güvenlik nöbeti; kapatma ve şifre işleri yalnız sahip onayıyla.", opens: opensOf("guvenlik") },
  { slug: "gozcu", name: "Nöbet · Gözcü", summary: "Gece gündüz sistemi izleyen gözcü.", opens: opensOf("gozcu") },
  { slug: "onarim", name: "Onarım", summary: "Takılan adımları sabit çare listesinden kurtaran tamirci.", opens: opensOf("onarim") },
  { slug: "gelistirme", name: "Yazılım & Geliştirme · Gelişim Merkezi", summary: "Onaylı öneriler akşamları ayrı kopyada kodlanır, denetlenir ve sahibin tek tıkına bekler.", opens: { label: "Gelişim Merkezi", href: "/brain?panel=development" } },
  { slug: "cirak", name: "Çırak", summary: "Geliştiricinin yanında sınırlı dosya kapsamında kod yazan çırak.", opens: opensOf("cirak") },
  { slug: "toplanti", name: "Toplantı Odası", summary: "Kurul toplantıları; boşta kalan çalışanlar burada toplanır.",
    emptyNote: "Bu odada sabit çalışan yok; boşta kalan çalışanlar sırayla buraya toplantıya gelir." },
  { slug: "dinlenme", name: "Dinlenme", summary: "İşi biten çalışanlar sırayla mola verir; iş yokken harcama sıfırdır.",
    emptyNote: "Bu odada sabit çalışan yok; işi biten çalışanlar sırayla buraya mola vermeye gelir." },
];

/** A room's page in the preview; workers of that room are listed there with their auditors. */
export function roomHref(slug: OfficeRoomSlug): string {
  return `/studio/office-preview/oda/${slug}`;
}

export function getRoom(slug: string): OfficeRoom | undefined {
  return OFFICE_ROOMS.find((room) => room.slug === slug);
}

export function roomMembers(slug: OfficeRoomSlug): readonly OfficeRosterEntry[] {
  return OFFICE_ROSTER.filter((entry) => entry.roomSlug === slug);
}
