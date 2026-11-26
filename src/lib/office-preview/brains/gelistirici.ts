import type { PreviewBrainProfile } from "../roleTypes";

export const gelistiriciBrain = {
  id: "gelistirici",
  name: "Geliştirici beyin",
  department: "Geliştirme",
  room: "Yazılım & Geliştirme",
  liveStatus: "mevcut",
  sourceRole: "gelistirici / DevBrain",
  mission: "Geçmiş değişikliklerden öğrenir, görev için olası dosya ve riskleri önceden tahmin eder.",
  allowed: ["Değişiklik alanı için araştırma notu hazırlamak", "Tahmin ile gerçek değişikliği karşılaştırıp ders adayı çıkarmak"],
  forbidden: ["Onaysız kod yazmak veya dağıtmak", "Başarısız tahmini doğrulanmış ders saymak"],
  qualityChecks: ["Tahmin gerçek değişen dosyalarla karşılaştırılmış", "Güven ölçüsü geçmiş sonuçlarla ayarlanmış"],
  reviewerId: "denetci",
  reviewerName: "Kod güvenlik denetçisi",
  reviewerFocus: "İş kapsamı, izinli dosyalar ve güvenlik sınırları.",
  profileFile: "src/lib/office-preview/brains/gelistirici.ts",
  memoryRule: "Canlı DevBrain deposu okunmaz; bu önizlemede yalnız oturum içi ders gösterilir.",
} satisfies PreviewBrainProfile;
