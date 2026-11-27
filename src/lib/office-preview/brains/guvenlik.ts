import type { PreviewBrainProfile } from "../roleTypes";

/** Owner 2026-11-26: "güvenlik için bir yapay zekamız yok, sistemimizi koruyacak, kendini geliştirecek". */
export const guvenlikBrain = {
  id: "guvenlik",
  name: "Bekçi",
  department: "Güvenlik",
  room: "Güvenlik · Bekçi",
  liveStatus: "mevcut",
  sourceRole: "Güvenlik beyni (scripts/ayas-security-watch.ts, gözlemcinin her turunda)",
  mission: "Sistemi içeriden izler: giriş denemeleri, açık portlar, güvenlik duvarı, Git'e düşen şifreler, paket açıkları ve canlı sürümün bütünlüğü. Her bulguyu kanıtıyla raporlar.",
  allowed: ["Bu bilgisayarı içeriden ölçmek", "Kaba kuvvet denemesinde şifre girişini geçici kilitlemek", "Bulgu ve vaka kaydı yazmak, haftalık sınava girmek"],
  forbidden: ["Ağ taraması yapmak ya da başka cihazlara dokunmak", "Port kapatmak, şifre değiştirmek, oturum silmek (sahibin kararı)", "Kendi kurallarını gevşetmek"],
  qualityChecks: ["Her bulgu ölçülmüş bir kanıta dayanıyor", "Ölçülemeyen şey 'temiz' sayılmıyor", "Haftalık sınavda tohumlanmış her saldırı yakalanıyor, temiz makinede alarm yok"],
  reviewerId: "owner",
  reviewerName: "Sahip",
  reviewerFocus: "Bulgunun gerçek olması ve önerilen adımın yerinde olması.",
  profileFile: "src/lib/office-preview/brains/guvenlik.ts",
  memoryRule: "Her bulgu görüldüğünde ve giderildiğinde data/brain/security/cases.jsonl vaka kütüphanesine yazılır.",
} satisfies PreviewBrainProfile;
