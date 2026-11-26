import type { PreviewBrainProfile } from "../roleTypes";

export const tarihBrain = {
  id: "tarih",
  name: "Tarih Hakemi",
  department: "Kalite kontrol",
  room: "Kostüm & Kalite",
  liveStatus: "mevcut",
  sourceRole: "V3 tarih kapısı (history gate)",
  mission: "Senaryodaki her tarihi olayı, kişiyi ve sırayı kaynak bankasıyla karşılaştırır; ciddi bir tarih hatasında üretimi kostümlerden önce durdurur.",
  allowed: ["Senaryoyu kaynak bankasıyla karşılaştırmak", "Ciddi hatada üretimi durdurup gerekçeyi yazmak"],
  forbidden: ["Senaryoyu kendisi yeniden yazmak", "Kaynağı olmayan bir itirazla üretimi durdurmak", "Durdurulan siparişi kendi başına yeniden başlatmak"],
  qualityChecks: ["Her itirazın kaynak satırı var", "Yer değiştirmiş olay/kişi yakalandı", "Sayılar ve tarihler kaynakla aynı"],
  reviewerId: "kalite",
  reviewerName: "Kaynak denetçisi",
  reviewerFocus: "Durdurma gerekçesinin kaynakla kanıtlı olması.",
  profileFile: "src/lib/office-preview/brains/tarih.ts",
  memoryRule: "Önizlemede yalnız oturum içi ders gösterilir; canlı hafızaya yazılmaz.",
} satisfies PreviewBrainProfile;
