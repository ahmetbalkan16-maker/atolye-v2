import type { Embedder } from "./ExperienceMemory";
import { cachedVectors, cosine, vectorFile } from "./MeaningCache";
import { absorbProposal, type DevProposal, improvementDir, listProposals } from "./SelfImprovement";

/**
 * The same want in other words (owner, 6 Nov 2026: "onaya bir şey düşmüyor ki"): an idea reaches the owner once a second
 * production raises it, but the brains word it anew each time — "anlatılan metinle sahne animasyonlarını senkronize
 * eden modül", "anlatım metni ile senkronize hareket ve animasyon öneri modülü" — and word overlap never matched them,
 * so 34 ideas each stood at "1 production" and none was ever shown. Here proposals are compared by meaning: a waiting
 * one alike enough to an earlier one is counted there (absorbProposal), so a want the productions keep raising does
 * reach the owner, and one already built or rejected stays answered.
 */

/**
 * Cosine from which two proposals ask for the same thing (title and reason, qwen3-embedding:0.6b). Calibrated on the
 * 39 proposals of 6 Nov 2026: the same want 0.74–0.90 (text sync 0.90/0.80/0.79, likeness 0.84/0.75, old place names
 * 0.81/0.76); different wants of one brain up to 0.71 (mix vs music analysis), across brains up to 0.69.
 */
export const SAME_MEANING = 0.74;

/** The text a proposal is compared by. */
export const proposalText = (p: Pick<DevProposal, "baslik" | "neden">) => `${p.baslik}. ${p.neden}`.slice(0, 500);

/**
 * Which waiting proposals are paraphrases, oldest first: each is matched against every proposal before it (by date) and
 * counted on the most alike one at SAME_MEANING or above — through it on the one that one was counted on, so a want
 * whose closest wording was itself merged still joins the group (6 Nov 2026: the third likeness want matched the
 * second at 0.84, the first only below the line). Pure: the vectors come in.
 */
export function planMerges(proposals: readonly DevProposal[], vectorOf: (p: DevProposal) => readonly number[] | undefined, min = SAME_MEANING): { id: string; hedef: string; benzerlik: number }[] {
  const order = [...proposals].sort((a, b) => a.tarih.localeCompare(b.tarih) || a.id.localeCompare(b.id));
  const root = new Map(order.filter((p) => p.durum === "birlesti" && p.birlesti).map((p) => [p.id, p.birlesti!.hedef]));
  const rootOf = (id: string) => {
    let at = id;
    for (let hops = 0; root.has(at) && hops < 20; hops++) at = root.get(at)!;
    return at;
  };
  const out: { id: string; hedef: string; benzerlik: number }[] = [];
  for (const [k, p] of order.entries()) {
    if (p.durum !== "bekliyor") continue;
    const v = vectorOf(p);
    if (!v) continue;
    let best: { hedef: string; benzerlik: number } | undefined;
    for (const q of order.slice(0, k)) {
      const w = vectorOf(q);
      if (!w) continue;
      const s = cosine(v, w);
      if (s >= min && (!best || s > best.benzerlik)) best = { hedef: q.id, benzerlik: s };
    }
    if (best && rootOf(best.hedef) !== p.id) {
      out.push({ id: p.id, hedef: rootOf(best.hedef), benzerlik: best.benzerlik });
      root.set(p.id, rootOf(best.hedef));
    }
  }
  return out;
}

/** Finds and counts the paraphrased proposals; returns what was merged where (Turkish lines for the cycle's report). */
export async function mergeParaphrasedProposals(workRoot: string, e: Embedder, min = SAME_MEANING): Promise<{ birlesen: number; satirlar: string[] }> {
  const proposals = (await listProposals(workRoot)).map((x) => x.proposal);
  if (!proposals.some((p) => p.durum === "bekliyor")) return { birlesen: 0, satirlar: [] };
  const vectors = await cachedVectors(vectorFile(improvementDir(workRoot), e), proposals.map(proposalText), e);
  const plan = planMerges(proposals, (p) => vectors.get(proposalText(p)), min);
  const byId = new Map(proposals.map((p) => [p.id, p]));
  const satirlar: string[] = [];
  for (const m of plan) {
    await absorbProposal(workRoot, m.id, m.hedef, m.benzerlik);
    satirlar.push(`"${byId.get(m.id)!.baslik.slice(0, 60)}" → "${byId.get(m.hedef)!.baslik.slice(0, 60)}" (${m.benzerlik.toFixed(2)})`);
  }
  return { birlesen: plan.length, satirlar };
}
