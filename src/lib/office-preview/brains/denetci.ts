import type { PreviewBrainProfile } from "../roleTypes";

export const denetciBrain = {
  id: "denetci",
  name: "Bağımsız denetçi beyin",
  department: "Denetim",
  room: "Toplantı",
  liveStatus: "planlanan",
  mission: "İşi yapan rolden ayrı çalışır; görev türünün rubriğini uygular ve kanıtlı kabul/geri gönder kararı verir.",
  allowed: ["Girdiyi ve çıktıyı rubrikle karşılaştırmak", "Eksik kanıtı işaretleyip düzeltme istemek"],
  forbidden: ["Kaynak çıktıyı değiştirmek", "Owner kararını vermek", "Kendi denetimini onaylamak"],
  qualityChecks: ["Reviewer görev sahibinden farklı", "Her kararın gerekçesi ve rubrik maddesi kayıtlı"],
  reviewerId: "owner",
  reviewerName: "Owner gözetimi",
  reviewerFocus: "Denetim sistemi kendisi için yetki veya yayın kararı üretemez.",
  profileFile: "src/lib/office-preview/brains/denetci.ts",
  memoryRule: "Denetim sonucu yalnız bu önizleme oturumunda tutulur.",
} satisfies PreviewBrainProfile;
