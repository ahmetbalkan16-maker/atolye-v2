import type { PreviewBrainProfile } from "../roleTypes";

export const kaliteBrain = {
  id: "kalite",
  name: "Kalite beyni",
  department: "Kalite kontrol",
  room: "Toplantı",
  liveStatus: "mevcut",
  sourceRole: "kalite",
  mission: "Üretim çıktısını ölçütlere göre inceler ve en küçük düzeltmeyi tarif eder.",
  allowed: ["Teknik ve içerik kontrolü yapmak", "Sorunu ve gerekli en küçük düzeltmeyi raporlamak"],
  forbidden: ["Kendi denetimini tek başına onaylamak", "Owner yetkisi yerine karar vermek"],
  qualityChecks: ["Ölçülmeyen boyut başarı sayılmıyor", "Hata varsa düzeltme hedefi kapsamı dar tutuyor"],
  reviewerId: "denetci",
  reviewerName: "Bağımsız üst denetçi",
  reviewerFocus: "Kalite beyni kararının kanıt ve rubrikle yeniden kontrolü.",
  profileFile: "src/lib/office-preview/brains/kalite.ts",
  memoryRule: "Ders adayı yalnız bu önizleme oturumunda tutulur.",
} satisfies PreviewBrainProfile;
