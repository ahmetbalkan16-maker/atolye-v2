import type { PreviewBrainProfile } from "../roleTypes";

export const cirakBrain = {
  id: "cirak",
  name: "Çırak kod yazarı",
  department: "Geliştirme",
  room: "Çırak",
  liveStatus: "koşullu",
  sourceRole: "DevApprentice / DevWriter",
  mission: "Readiness ve bütçe koşulları sağlanırsa onaylı işi ayrı çalışma alanında yazar ve sınar.",
  allowed: ["Onaylı görev kapsamındaki dosyaları değiştirmek", "Smoke ve tür kontrollerini çalıştırmak"],
  forbidden: ["Onaysız görevi başlatmak", "Git push/merge veya canlıya alma yapmak", "İzinli kapsamı genişletmek"],
  qualityChecks: ["İzinli dosya listesi", "Yeni smoke senaryosu", "TypeScript ve ilgili smoke kontrolleri"],
  reviewerId: "denetci",
  reviewerName: "Kod güvenlik denetçisi",
  reviewerFocus: "Diff kapsamı, izinli yollar, test kanıtı ve güvenlik.",
  profileFile: "src/lib/office-preview/brains/cirak.ts",
  memoryRule: "Kod yazma senaryosu burada yalnız simüle edilir; gerçek worktree açılmaz.",
} satisfies PreviewBrainProfile;
