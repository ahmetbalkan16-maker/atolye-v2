import type { PreviewBrainId } from "./roleTypes";

export type PreviewScenarioId = "research" | "costume" | "developer";
export type PreviewStepKind = "assign" | "work" | "review" | "rework" | "verify" | "learn" | "owner";

export interface PreviewDialogueStep {
  readonly id: string;
  readonly brainId: PreviewBrainId;
  readonly speakerLabel?: string;
  readonly room: string;
  readonly kind: PreviewStepKind;
  readonly text: string;
}

export interface PreviewScenario {
  readonly id: PreviewScenarioId;
  readonly title: string;
  readonly summary: string;
  readonly assignedBrain: PreviewBrainId;
  readonly reviewer: PreviewBrainId;
  readonly lesson: string;
  readonly steps: readonly PreviewDialogueStep[];
}

export const PREVIEW_SCENARIOS: readonly PreviewScenario[] = [
  {
    id: "research",
    title: "Kaynak araştırması",
    summary: "Bir kaynak eksikliği denetimde geri döner; Araştırma düzeltir, denetçi yeniden bakar.",
    assignedBrain: "arastirma",
    reviewer: "denetci",
    lesson: "Taslağı göndermeden önce her iddianın kaynak ve tarih bağını denetle.",
    steps: [
      { id: "r1", brainId: "ayas", room: "Yönetim", kind: "assign", text: "Örnek görevi Araştırma'ya atıyorum: kaynak dayanağını hazırla, doğrulanmayanı kesin bilgi gibi yazma." },
      { id: "r2", brainId: "arastirma", room: "Araştırma", kind: "work", text: "Taslak hazır. Bir satırın tarih ve kaynak bağı eksik; onu doğrulanmış sonuç olarak sunmadım." },
      { id: "r3", brainId: "denetci", speakerLabel: "Kaynak denetçisi", room: "Denetim", kind: "review", text: "Geri gönderiyorum: eksik satıra kanıt ekle veya çıkar; belirsizlik düzeyini görünür kıl." },
      { id: "r4", brainId: "arastirma", room: "Araştırma", kind: "rework", text: "Düzelttim. Dayanağı olmayan satırı belirsiz işaretledim; kalan ifadeleri kaynaklarıyla eşledim." },
      { id: "r5", brainId: "denetci", speakerLabel: "Kaynak denetçisi", room: "Denetim", kind: "verify", text: "Kaynak rubriği geçti. Bu karar yalnızca örnek senaryo kaydıdır." },
      { id: "r6", brainId: "kalite", room: "Montaj & Kalite", kind: "verify", text: "Çıktı sınır içinde. Gerçek üretim, dış yayın veya owner adına onay yapılmadı." },
      { id: "r7", brainId: "arastirma", room: "Araştırma", kind: "learn", text: "Ders adayı oluştu: taslağı göndermeden önce kaynak ve tarih bağını kontrol et. Bu oturum dışında saklanmıyor." },
      { id: "r8", brainId: "ayas", room: "Yönetim", kind: "owner", text: "Örnek görev tamamlandı. Canlı görev kuyruğuna veya kalıcı hafızaya kayıt yazılmadı." },
    ],
  },
  {
    id: "costume",
    title: "Kostüm sürekliliği",
    summary: "Kostüm beyni taslak üretir; bağımsız süreklilik denetçisi bulguyu geri gönderir.",
    assignedBrain: "kostum",
    reviewer: "denetci",
    lesson: "Sahne değişiminde kostüm referansı yoksa değişikliği gerçek gibi sunma.",
    steps: [
      { id: "c1", brainId: "ayas", room: "Yönetim", kind: "assign", text: "Kostüm, örnek sahne paketinde karakter devamlılığını incele. Referans dışı ayrıntıyı öneri olarak ayır." },
      { id: "c2", brainId: "kostum", room: "Kostüm", kind: "work", text: "Taslakta bir sahne geçişinin kostüm dayanağı eksik. Bunu doğrulanmış bilgi değil, kontrol noktası olarak işaretledim." },
      { id: "c3", brainId: "denetci", speakerLabel: "Kostüm süreklilik denetçisi", room: "Denetim", kind: "review", text: "Geri gönderiyorum: eksik referansı ekle veya sahne geçişini belirsiz olarak bırak." },
      { id: "c4", brainId: "kostum", room: "Kostüm", kind: "rework", text: "Güncelledim. Referansı olmayan geçiş artık kesin kostüm tarifi olarak görünmüyor." },
      { id: "c5", brainId: "denetci", speakerLabel: "Kostüm süreklilik denetçisi", room: "Denetim", kind: "verify", text: "Süreklilik rubriği geçti. Kaynaksız görsel iddia kalmadı (simülasyon)." },
      { id: "c6", brainId: "kalite", room: "Montaj & Kalite", kind: "verify", text: "Görsel süreklilik kontrolü tamamlandı. Üretim dosyası değiştirilmedi." },
      { id: "c7", brainId: "kostum", room: "Kostüm", kind: "learn", text: "Ders adayı: referans yoksa sahne değişimini kesin kostüm bilgisine çevirmeme." },
      { id: "c8", brainId: "ayas", room: "Yönetim", kind: "owner", text: "Örnek görev tamamlandı. Bu simülasyon canlı prodüksiyon kararı değildir." },
    ],
  },
  {
    id: "developer",
    title: "Geliştirici beyin ve çırak",
    summary: "Dosya tahmini, yalıtılmış yazım, kod denetimi ve owner uygulama kapısı.",
    assignedBrain: "gelistirici",
    reviewer: "denetci",
    lesson: "Tahmin ile gerçek diff'i karşılaştır; yalnız owner onaylı kapsamda yaz ve sınamaları göster.",
    steps: [
      { id: "d1", brainId: "ayas", room: "Yönetim", kind: "assign", text: "Önceden onaylanmış örnek kod işi. Değişiklik kapsamını araştır; yalnız ayrılmış kopyada çalış." },
      { id: "d2", brainId: "gelistirici", room: "Geliştirici masası", kind: "work", text: "DevBrain olası dosya ve riskleri not ediyor. Bu bir tahmin; henüz kod değişikliği değil." },
      { id: "d3", brainId: "cirak", room: "Geliştirici masası", kind: "work", text: "Çırak örnek diff'i ayrı worktree'de hazırlıyor ve hedefe yönelik smoke senaryosu ekliyor (simülasyon)." },
      { id: "d4", brainId: "denetci", speakerLabel: "Kod güvenlik denetçisi", room: "Denetim", kind: "review", text: "Diff'i kontrol ediyorum: görev dışı yol, izin dışı dosya veya doğrulanmamış test var mı?" },
      { id: "d5", brainId: "cirak", room: "Geliştirici masası", kind: "rework", text: "Örnek kontrolden sonra kapsam dışı dosya çıkarıldı; yalnız izinli diff kaldı." },
      { id: "d6", brainId: "denetci", speakerLabel: "Kod güvenlik denetçisi", room: "Denetim", kind: "verify", text: "Örnek izinli diff ve kontrol raporu geçti. Gerçek shell, test veya Git işlemi çalıştırılmadı." },
      { id: "d7", brainId: "ayas", room: "Yönetim", kind: "owner", text: "Hazır değişiklik gerçek sistemde ayrıca owner ONAYLA VE UYGULA kararı bekler; bu önizleme hiçbir şeyi push etmez." },
      { id: "d8", brainId: "gelistirici", room: "Geliştirici masası", kind: "learn", text: "Ders adayı: ilk dosya tahminini gerçek diff ve test kanıtıyla karşılaştır. Kalıcı hafıza değişmedi." },
    ],
  },
];
