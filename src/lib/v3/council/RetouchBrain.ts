import type { DebateEntry } from "./Council";

/**
 * The retouch brain (Rötuş beyni, owner direction 20 Oct 2026: "hand these fixes to the helper brains, so that they
 * can correct such faults when neither Codex nor Claude is around"). After a finished production it reads what the
 * other brains measured — the side-by-side likeness scores and the set judge's verdicts — and decides on a retouch
 * from a fixed menu, then the production reruns itself from the earliest step concerned (at most MAX_RETOUCH_ROUNDS times):
 * - a real person whose cartoon scored below LIKENESS_OK next to the portrait is redesigned, with the art director's
 *   list of differences as the instruction (the people library keeps both versions);
 * - a set the judge left under its bar is redrawn with fresh seeds.
 * Nothing here changes code, and there are never more than MAX_RETOUCH_ROUNDS rounds, so a production always ends.
 */
export const MAX_RETOUCH_ROUNDS = 2;
/**
 * A likeness below this side-by-side score is redesigned (and not reused by later episodes). Owner decision
 * (20 Oct 2026): "the worst acceptable is 8/10, the best 10/10; everything below gets corrected".
 */
export const LIKENESS_OK = 8;

export interface RetouchPlan {
  /** The round this plan starts (1 = the first retouch). */
  readonly tur: number;
  /** The earliest step to run again. */
  readonly adim: "gardirop" | "gorsel";
  readonly kisiler: readonly { readonly castId: string; readonly kisi: string; readonly puan: number; readonly farklar: readonly string[] }[];
  readonly setler: readonly { readonly sahne: string; readonly neden: string }[];
}

export interface RetouchInput {
  /** Rounds already done (0 after the first production). */
  readonly round: number;
  readonly likenesses: readonly { readonly castId: string; readonly kisi: string; readonly kaynak: string; readonly benzerlik?: number; readonly farklar?: readonly string[] }[];
  readonly sets: readonly { readonly sahne: string; readonly esikAlti?: boolean; readonly secim?: { readonly puan: number; readonly donem?: number; readonly sorun?: string } }[];
}

export function planRetouch(input: RetouchInput): RetouchPlan | undefined {
  if (input.round >= MAX_RETOUCH_ROUNDS) return undefined;
  const kisiler = input.likenesses
    .filter((l) => l.kaynak === "tasarim" && l.benzerlik !== undefined && l.benzerlik < LIKENESS_OK)
    .map((l) => ({ castId: l.castId, kisi: l.kisi, puan: l.benzerlik!, farklar: l.farklar ?? [] }));
  const setler = input.sets
    .filter((s) => s.esikAlti)
    .map((s) => ({ sahne: s.sahne, neden: s.secim ? `hakem ${s.secim.puan}/10, dönem ${s.secim.donem ?? "?"}/10${s.secim.sorun ? ` — ${s.secim.sorun}` : ""}` : "hakem puanı yok" }));
  if (!kisiler.length && !setler.length) return undefined;
  return { tur: input.round + 1, adim: kisiler.length ? "gardirop" : "gorsel", kisiler, setler };
}

/** The retouch decision as a council transcript (Turkish, for KURUL.md and AYAS's inbox). */
export function retouchDebate(plan: RetouchPlan): DebateEntry[] {
  return [
    ...plan.kisiler.map((k) => ({ rol: "Sanat yönetmeni", metin: `${k.kisi} portreyle yan yana ${k.puan}/10: ${k.farklar.join("; ") || "fark listesi yok"}` })),
    ...plan.setler.map((s) => ({ rol: "Ortam beyni", metin: `${s.sahne} seti eşiğin altında (${s.neden})` })),
    { rol: "Rötuş beyni", metin: `${plan.tur}. rötuş turu: ${[plan.kisiler.length ? `${plan.kisiler.length} kişi farklarla yeniden tasarlanacak` : "", plan.setler.length ? `${plan.setler.length} set yeni tohumlarla yeniden çizilecek` : ""].filter(Boolean).join(", ")}; üretim "${plan.adim}" adımından bir kez yeniden çalışacak` },
  ];
}
