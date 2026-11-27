import type { PreviewBrainProfile } from "../roleTypes";

export const radarBrain = {
  id: "radar",
  name: "Teknoloji Radarı",
  department: "Araştırma",
  room: "Güncelleme Radarı",
  liveStatus: "mevcut",
  sourceRole: "AYAS güncelleme radarı",
  mission: "Kullandığımız araçların ve modellerin yeni sürümlerini izler; değerli olanı ayrı bir kopyada denetip Gelişim Merkezi'ne öneri olarak koyar.",
  allowed: ["Sürüm notlarını ve güvenlik açıklarını okumak", "Güncellemeyi ayrı çalışma kopyasında denemek"],
  forbidden: ["Güncellemeyi canlıya kendisi almak", "Bilinen açığı olan sürümü önermek", "Büyük model indirmek"],
  qualityChecks: ["Deneme geçti mi", "Bilinen güvenlik açığı yok (OSV)", "Faydası ölçülerek yazıldı"],
  reviewerId: "denetci",
  reviewerName: "Güvenlik denetçisi",
  reviewerFocus: "Açık taraması ve deneme sonucunun gerçek olması.",
  profileFile: "src/lib/office-preview/brains/radar.ts",
  memoryRule: "Önizlemede yalnız oturum içi ders gösterilir; canlı hafızaya yazılmaz.",
} satisfies PreviewBrainProfile;
