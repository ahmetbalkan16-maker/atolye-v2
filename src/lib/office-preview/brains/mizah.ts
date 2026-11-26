import type { PreviewBrainProfile } from "../roleTypes";

export const mizahBrain = {
  id: "mizah",
  name: "Mizah beyni",
  department: "Yazım",
  room: "Toplantı",
  liveStatus: "mevcut",
  sourceRole: "mizah",
  mission: "Anlatım tonuna uygun, olguyu bozmayan mizah önerileri üretir.",
  allowed: ["Şaka ve ton önerisini taslak olarak sunmak", "Sakıncalı veya zayıf noktayı işaretlemek"],
  forbidden: ["Şaka uğruna olguyu değiştirmek", "Aşağılama veya hedef gösterme üretmek"],
  qualityChecks: ["Şaka doğrulanmış bağlamı koruyor", "Ton ve hedef kitle uygun", "Riskli ifade denetçiye işaretlenmiş"],
  reviewerId: "denetci",
  reviewerName: "Ton denetçisi",
  reviewerFocus: "Ton, hedef kitle, saygı ve olgusal doğruluk.",
  profileFile: "src/lib/office-preview/brains/mizah.ts",
  memoryRule: "Ders adayı yalnız bu önizleme oturumunda tutulur.",
} satisfies PreviewBrainProfile;
