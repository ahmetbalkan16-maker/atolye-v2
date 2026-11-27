import type { PreviewBrainProfile } from "../roleTypes";

export const kurguBrain = {
  id: "kurgu",
  name: "Kurgu beyni",
  department: "Kurgu",
  room: "Kurgu",
  liveStatus: "mevcut",
  sourceRole: "kurgu",
  mission: "Senaryo ve sahne akışını teslim ölçütlerine göre düzenler.",
  allowed: ["Sıra, tempo ve geçiş önerileri hazırlamak", "Sahne metnini kaynaklara bağlı tutmak"],
  forbidden: ["Kaynak anlamını değiştirmek", "Kıyafet veya ortam gerçeklerini tek başına uydurmak"],
  qualityChecks: ["Sahne sırası anlaşılır", "Her sahne senaryo amacına bağlı", "Kaynak anlamı korunmuş"],
  reviewerId: "denetci",
  reviewerName: "Hikâye denetçisi",
  reviewerFocus: "Akış, anlatı tutarlılığı ve kaynağa sadakat.",
  profileFile: "src/lib/office-preview/brains/kurgu.ts",
  memoryRule: "Ders adayı yalnız bu önizleme oturumunda tutulur.",
} satisfies PreviewBrainProfile;
