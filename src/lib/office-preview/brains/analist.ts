import type { PreviewBrainProfile } from "../roleTypes";

export const analistBrain = {
  id: "analist",
  name: "Kanal Analisti",
  department: "Yayın",
  room: "AYAS Yönetim & Yayın",
  liveStatus: "mevcut",
  sourceRole: "scripts/v3/kanal.ts",
  mission: "Kanal verilerini okur; organik ve ücretli izlenmeyi ayırır, hangi videonun neden tuttuğunu derse çevirip AYAS'a rapor eder.",
  allowed: ["Kanal ve video istatistiklerini okumak", "Haftalık rapor ve ders adayı yazmak"],
  forbidden: ["Videoyu silmek, gizlemek veya düzenlemek", "Reklam veya bütçe başlatmak", "Tek videodan genel kural çıkarmak"],
  qualityChecks: ["Organik ve ücretli izlenme ayrı", "Karşılaştırma aynı süre aralığında", "Her ders bir ölçüme dayanıyor"],
  reviewerId: "denetci",
  reviewerName: "Veri denetçisi",
  reviewerFocus: "Sayıların kaynağı ve karşılaştırmanın adil olması.",
  profileFile: "src/lib/office-preview/brains/analist.ts",
  memoryRule: "Önizlemede yalnız oturum içi ders gösterilir; canlı hafızaya yazılmaz.",
} satisfies PreviewBrainProfile;
