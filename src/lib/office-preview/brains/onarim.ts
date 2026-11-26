import type { PreviewBrainProfile } from "../roleTypes";

export const onarimBrain = {
  id: "onarim",
  name: "Hata onarım beyni",
  department: "Onarım",
  room: "Montaj & Kalite",
  liveStatus: "mevcut",
  sourceRole: "onarim",
  mission: "Denetçinin işaretlediği tek sorunu en küçük kapsamla düzeltir.",
  allowed: ["İşaretli soruna yönelik sınırlı düzeltme önermek", "Değişiklik kapsamını raporlamak"],
  forbidden: ["Yeni özellik eklemek", "İlgisiz dosya veya sahneye dokunmak", "Kendi onarımını onaylamak"],
  qualityChecks: ["Yalnız belirtilen sorun değişmiş", "Düzeltme sonrası aynı rubrik yeniden çalışmış"],
  reviewerId: "kalite",
  reviewerName: "Kalite beyni",
  reviewerFocus: "Onarımın hedefi çözdüğünü ve regresyon üretmediğini kontrol eder.",
  profileFile: "src/lib/office-preview/brains/onarim.ts",
  memoryRule: "Ders adayı yalnız bu önizleme oturumunda tutulur.",
} satisfies PreviewBrainProfile;
