/**
 * Atölye V3 — the studio's own apprentice as the development queue's agent (owner, 6 Nov 2026: "Claude olmadan
 * yazabilecek duruma gelsin"). Developer.develop starts it in a job's sandbox worktree in Claude's place: the task packet
 * comes in on stdin, the apprentice (DevWriter) writes the change and its smoke scenario there, round by round until the
 * type check and the touched suites pass, and prints its Turkish summary. Exit 0 = it has a change that passed its own
 * checks (the queue then runs all of its own); 1 = it could not. It never runs git and never pushes.
 *
 *   npx tsx scripts/v3/cirak-yaz.ts --calisma <runtime root> --depo <checkout>  < görev.md     (cwd: the worktree)
 */
import { existsSync, promises as fs } from "node:fs";
import { brainBudget, writerBudget } from "../../src/lib/v3/council/BrainModels";
import { writeJob } from "../../src/lib/v3/council/DevApprentice";
import { researchNote } from "../../src/lib/v3/council/DevBrain";
import { localEmbedder } from "../../src/lib/v3/council/MeaningCache";
import { listProposals } from "../../src/lib/v3/council/SelfImprovement";
import { loadV3Settings, resolveV3Paths } from "../../src/lib/v3/V3Paths";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** One job's spend at most (`ATOLYE_V3_CIRAK_IS_USD`). */
const JOB_CAP_USD = Number(process.env.ATOLYE_V3_CIRAK_IS_USD) || 0.6;

async function main() {
  const workRoot = arg("--calisma");
  const repoRoot = arg("--depo");
  if (!workRoot || !repoRoot) throw new Error("Kullanım: cirak-yaz.ts --calisma <runtime root> --depo <checkout>  < görev");
  loadV3Settings(repoRoot);
  const paths = { ...resolveV3Paths(repoRoot), workRoot };
  let packet = "";
  for await (const chunk of process.stdin) packet += chunk;
  const id = /GELİŞTİRME İŞİ (\S+)/.exec(packet)?.[1];
  const p = id ? (await listProposals(workRoot)).find((x) => x.proposal.id === id)?.proposal : undefined;
  if (!p) throw new Error(`görev paketinde bilinen bir öneri yok (${id ?? "?"})`);
  const writer = writerBudget(paths, JOB_CAP_USD);
  if (!writer) throw new Error("çırak OpenAI olmadan yazmaz (ATOLYE_V3_SCRIPT_PROVIDER=openai ve anahtar gerekir)");
  const brains = brainBudget(paths, 0.1);
  const meaning = localEmbedder();
  const note = researchNote(workRoot, p.id);
  const log = (s: string) => console.error(s);
  const r = await writeJob(
    process.cwd(),
    { id: p.id, gorev: `${p.baslik} — ${p.neden}${p.karar?.not ? ` (owner: ${p.karar.not})` : ""}`, ...(existsSync(note) ? { arastirma: await fs.readFile(note, "utf8") } : {}) },
    { repoRoot, workRoot, budget: brains.budget, model: brains.critic, guessModel: brains.director, ...(meaning ? { meaning } : {}), log },
    writer,
  );
  console.log(`${r.gecti ? "Çırak yazdı" : "Çırak yazamadı"} (${r.turlar} tur, $${r.maliyetUsd.toFixed(3)}, ${r.model}): ${r.ozet || "—"}${r.dosyalar.length ? `\nDosyalar: ${r.dosyalar.join(", ")}` : ""}${r.gecti ? "" : `\nNeden: ${(r.neden ?? "").slice(-600)}`}`);
  process.exitCode = r.gecti ? 0 : 1;
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
