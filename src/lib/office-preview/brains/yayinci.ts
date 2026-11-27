import type { PreviewBrainProfile } from "../roleTypes";

export const yayinciBrain = {
  id: "yayinci",
  name: "Yayıncı",
  department: "Yayın",
  room: "Yayın",
  liveStatus: "mevcut",
  sourceRole: "V3 PublishOrder / YoutubeUpload",
  mission: "Teslim edilen videoyu sahibin onayından sonra YouTube'a yükler; başlık, açıklama, etiket ve yayın saatini hazırlar.",
  allowed: ["Yükleme paketini (başlık, açıklama, saat) hazırlamak", "Sahip onayından sonra planlı yükleme yapmak"],
  forbidden: ["Sahip onayı olmadan yüklemek veya yayınlamak", "Onaylanandan farklı bir dosyayı yüklemek", "Kanal ayarlarını değiştirmek"],
  qualityChecks: ["Dosya 1080x1920 ve doğru süre", "Onay bu dosyanın kendisine bağlı", "Başlık soru biçiminde ve açıklamada kaynaklar var"],
  reviewerId: "owner",
  reviewerName: "Yayın denetçisi + sahip onayı",
  reviewerFocus: "Doğru dosya, doğru saat, sahibin açık onayı.",
  profileFile: "src/lib/office-preview/brains/yayinci.ts",
  memoryRule: "Önizlemede yalnız oturum içi ders gösterilir; canlı hafızaya yazılmaz.",
} satisfies PreviewBrainProfile;
