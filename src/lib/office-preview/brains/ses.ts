import type { PreviewBrainProfile } from "../roleTypes";

export const sesBrain = {
  id: "ses",
  name: "Ses beyni",
  department: "Ses",
  room: "Ses Stüdyosu",
  liveStatus: "mevcut",
  sourceRole: "ses",
  mission: "Anlatım, efekt ve müziğin zamanlamasını ve teknik ses ölçütlerini gözetir.",
  allowed: ["Ses yerleşimi taslağı hazırlamak", "Senkron ve seviye sorunlarını bildirmek"],
  forbidden: ["Onaysız dış ses hizmeti kullanmak", "Anlatım metnini tek başına değiştirmek"],
  qualityChecks: ["Senkron ve sessizlik ölçülmüş", "Ses seviyesi ve dosya bütünlüğü kontrol edilmiş"],
  reviewerId: "denetci",
  reviewerName: "Ses denetçisi",
  reviewerFocus: "Senkron, seviye, sessizlik ve teknik dosya kontrolü.",
  profileFile: "src/lib/office-preview/brains/ses.ts",
  memoryRule: "Ders adayı yalnız bu önizleme oturumunda tutulur.",
} satisfies PreviewBrainProfile;
