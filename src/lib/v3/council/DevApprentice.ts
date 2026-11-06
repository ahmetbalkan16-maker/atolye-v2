import { promises as fs } from "node:fs";
import path from "node:path";
import type { V3Budget, V3ModelChoice } from "../script/V3Budget";
import { runProcess } from "../util/Proc";
import { readJsonAnswer } from "./Council";
import { codeExperienceLines, devBrainDir, gradedFiles, isV3Smoke, listLessons, listWriteExams, recordLesson, recordWriteExam, say, similarChanges, listChanges, type WriteExam, writeReadiness } from "./DevBrain";
import { forbiddenChanges } from "./DevQueue";
import { dropWorktree, linkShared } from "./Developer";
import { codeOf, commitFiles, commitTask, guessTask, meaningNeighbours, type ResearchDeps, v3Commits } from "./DevResearch";
import { listSkills, pickSkills, skillsText } from "./DevSkills";
import { runChecks, sandboxChanges, sandboxDiff, writeChange, writerChecks, type WriterResult, type WriterTask } from "./DevWriter";

/**
 * The apprentice's writing exams and its place in the development queue (owner, 6 Nov 2026: "hem öğrenmesi hızlansın
 * hem de Claude olmadan yazabilecek duruma gelsin").
 *
 * An exam is a past V3 commit written again: a sandbox at the commit's parent, the commit's own new smoke scenarios
 * laid in as the spec (they must fail there, or the exam does not count), the apprentice writes the code with its
 * research, the similar changes' code, its lessons and the project's skills (DevWriter), and it passes when the type
 * check and those scenarios pass. A failed exam is checked against the real change (scenarios that fail even with it
 * say the environment, not the apprentice, failed) and teaches a lesson from the real code. Its pass rate decides
 * whether it may build an approved job itself when Claude cannot (DevBrain.writeReadiness); such a build still has to
 * pass every check of the development queue. Watcher processes only.
 */

/** A commit fit for a writing exam: a small change of the V3 studio's code with new smoke scenarios. */
export interface ExamCommit {
  readonly sha: string;
  readonly tarih: string;
  readonly gorev: string;
  readonly kod: readonly string[];
  readonly testler: readonly string[];
}

/** Graded files a writing exam may ask for (the larger a change, the less a test-led rewrite says). */
export const EXAM_MAX_CODE_FILES = 4;

/** The commits fit for an exam, newest first, that it has not sat yet. */
export async function examCandidates(repoRoot: string, workRoot: string, limit = 400): Promise<ExamCommit[]> {
  const sat = new Set((await listWriteExams(workRoot)).map((x) => x.id));
  const out: ExamCommit[] = [];
  for (const c of (await v3Commits(repoRoot, limit)).reverse()) {
    if (sat.has(c.sha)) continue;
    const files = (await commitFiles(repoRoot, c.sha)).map((f) => f.replace(/\\/g, "/"));
    const kod = gradedFiles(files);
    const testler = files.filter(isV3Smoke);
    // Only what the apprentice may write: anything else in the commit (AYAS, the app, packages) rules it out.
    const outside = forbiddenChanges(files.filter((f) => !/\.md$/i.test(f)));
    const gorev = commitTask(c.konu);
    if (kod.length >= 1 && kod.length <= EXAM_MAX_CODE_FILES && testler.length >= 1 && testler.length <= 2 && !outside.length && gorev) out.push({ sha: c.sha, tarih: c.tarih, gorev, kod, testler });
  }
  return out;
}

const git = (cwd: string, args: readonly string[]) => runProcess("git", ["-c", "core.quotepath=false", ...args], { cwd, timeoutMs: 120_000 });

/** The lines a commit added to its test files (the exam's spec), with the hunks' context names. */
export async function addedTestCode(repoRoot: string, sha: string, tests: readonly string[], max = 9_000): Promise<string> {
  const diff = await git(repoRoot, ["show", "--format=", "--no-color", "-U3", sha, "--", ...tests]);
  const out: string[] = [];
  for (const line of diff.stdout.split(/\r?\n/)) {
    if (/^diff --git /.test(line)) out.push(`--- ${line.replace(/^diff --git a\/\S+ b\//, "")}`);
    else if (/^@@/.test(line)) out.push(line.replace(/^@@ [^@]+ @@ ?/, "@@ "));
    else if (/^\+(?!\+\+)/.test(line) || /^ /.test(line)) out.push(line);
  }
  const text = out.join("\n");
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
}

/** The V3 modules the new test lines import (repo paths) and the names they import from them. */
export function testImports(testCode: string, testFile = "scripts/smoke-v3-x.ts"): { dosyalar: string[]; adlar: string[] } {
  const dosyalar = new Set<string>();
  const adlar = new Set<string>();
  for (const m of testCode.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)) {
    const spec = m[2]!;
    if (!spec.startsWith(".")) continue;
    const rel = path.posix.normalize(path.posix.join(path.posix.dirname(testFile), spec));
    if (!/^(src\/lib\/v3|scripts\/v3|remotion-v3\/src)\//.test(rel)) continue;
    dosyalar.add(/\.(m?[jt]sx?)$/.test(rel) ? rel : `${rel}.ts`);
    for (const n of m[1]!.split(",")) {
      const name = n.replace(/^\s*type\s+/, "").split(/\s+as\s+/)[0]!.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) adlar.add(name);
    }
  }
  return { dosyalar: [...dosyalar], adlar: [...adlar] };
}

export interface ExamDeps {
  readonly repoRoot: string;
  readonly workRoot: string;
  /** The research (guess) and the lesson: the developer brain's own budget and models. */
  readonly research: ResearchDeps;
  /** The writer's budget and model (BrainModels.writerBudget). */
  readonly writer: { readonly budget: V3Budget; readonly model: V3ModelChoice };
  readonly log: (s: string) => void;
  readonly worktreeRoot?: string;
  /** The checks of a round (default: DevWriter.writerChecks — the type checks, then the suites). */
  readonly checks?: (dir: string, changed: readonly string[], suites: readonly string[]) => string[][];
  /** Running only the exam's suites, before and after (default: each suite through tsx). */
  readonly suites?: (suites: readonly string[]) => string[][];
  readonly maxTurns?: number;
  /** Stops the exam between rounds (an order came in); a stopped exam does not count. */
  readonly stop?: () => Promise<string | undefined>;
}

const suiteCommands = (suites: readonly string[]) => suites.map((s) => [process.execPath, path.join("node_modules", "tsx", "dist", "cli.mjs"), s]);

const short = (sha: string) => sha.slice(0, 10);

/**
 * The research, similar changes, lessons and skills for a task at a revision — what the apprentice is given besides
 * the task itself, for an exam (at the commit's parent) and for a job (at HEAD).
 */
async function context(d: ResearchDeps, input: { readonly id: string; readonly gorev: string; readonly rev: string; readonly before?: string; readonly extraFiles?: readonly string[]; readonly extraNames?: readonly string[] }): Promise<Pick<WriterTask, "dosyalar" | "semboller" | "benzer" | "dersler" | "rehber">> {
  const { guess } = await guessTask({ id: input.id, kaynak: "commit", gorev: input.gorev, rev: input.rev, ...(input.before ? { before: input.before } : {}) }, d);
  const near = await meaningNeighbours(d, input.gorev, { ...(input.before ? { before: input.before } : {}), exclude: input.id, k: 4 });
  const words = similarChanges(await listChanges(d.workRoot), input.gorev, { ...(input.before ? { before: input.before } : {}), exclude: input.id, limit: 3 });
  const benzer = await codeOf(d.workRoot, [...new Set([...near, ...words].map((c) => c.id))].slice(0, 4));
  const dosyalar = [...new Set([...(input.extraFiles ?? []), ...guess.dosyalar])].slice(0, 6);
  return {
    dosyalar,
    semboller: [...new Set([...(input.extraNames ?? []), ...(guess.semboller ?? [])])],
    benzer,
    dersler: (await listLessons(d.workRoot)).slice(-8).map((l) => l.metin),
    rehber: skillsText(pickSkills(await listSkills(d.repoRoot), input.gorev, dosyalar)),
  };
}

/** Runs one writing exam on a commit and records it. */
export async function writeExam(c: ExamCommit, d: ExamDeps): Promise<WriteExam> {
  const root = d.worktreeRoot ?? path.join(path.dirname(path.resolve(d.repoRoot)), "gelistirme");
  const dir = path.join(root, `sinav-${short(c.sha)}`);
  const checksFor = d.checks ?? ((dir: string, changed: readonly string[], suites: readonly string[]) => writerChecks(dir, changed, suites));
  const runTests = (tests: readonly string[]) => runChecks(dir, (d.suites ?? suiteCommands)(tests));
  const base: Omit<WriteExam, "sonuc" | "turlar" | "maliyetUsd" | "dosyalar" | "model"> = { id: c.sha, tarih: new Date().toISOString(), gorev: c.gorev, gercek: c.kod, testler: c.testler };
  const record = async (x: WriteExam) => {
    await recordWriteExam(d.workRoot, x);
    await say(d.workRoot, x.sonuc === "gecti" ? `Yazma sınavı — "${c.gorev.slice(0, 70)}": kodu kendim yazdım, testler geçti (${x.turlar} tur).` : x.sonuc === "kaldi" ? `Yazma sınavı — "${c.gorev.slice(0, 70)}": yazdım ama testleri geçemedim (${x.turlar} tur); Claude'un çözümünden ders çıkardım.` : `Yazma sınavı — "${c.gorev.slice(0, 70)}" sayılmadı: ${x.neden?.slice(0, 120) ?? ""}`);
    return x;
  };
  try {
    await dropWorktree(d.repoRoot, dir);
    await fs.mkdir(root, { recursive: true });
    const add = await git(d.repoRoot, ["worktree", "add", "--detach", dir, `${c.sha}^`]);
    if (add.code !== 0) return await record({ ...base, sonuc: "gecersiz", turlar: 0, maliyetUsd: 0, dosyalar: [], model: "", neden: `çalışma kopyası açılamadı: ${(add.stderr || add.stdout).slice(-200)}` });
    await linkShared(d.repoRoot, dir);
    // The spec: the commit's own test files, laid into the parent.
    for (const t of c.testler) {
      const r = await git(d.repoRoot, ["show", `${c.sha}:${t}`]);
      await fs.mkdir(path.dirname(path.join(dir, t)), { recursive: true });
      await fs.writeFile(path.join(dir, t), r.stdout);
    }
    const before = await runTests(c.testler);
    if (before.ok) return await record({ ...base, sonuc: "gecersiz", turlar: 0, maliyetUsd: 0, dosyalar: [], model: "", neden: "yeni senaryolar değişiklikten önce de geçiyor" });
    const testKodu = await addedTestCode(d.repoRoot, c.sha, c.testler);
    const imports = testImports(testKodu, c.testler[0]);
    const ctx = await context(d.research, { id: c.sha, gorev: c.gorev, rev: `${c.sha}^`, before: c.tarih, extraFiles: imports.dosyalar, extraNames: imports.adlar });
    const changed = async () => (await sandboxChanges(dir)).filter((f) => !c.testler.includes(f));
    d.log(`  çırak: yazma sınavı "${c.gorev.slice(0, 70)}" (${short(c.sha)}) — ${c.kod.length} dosya, test ${c.testler.join(", ")}`);
    const w: WriterResult = await writeChange(
      { gorev: c.gorev, testKodu, korunan: c.testler, ...ctx },
      { dir, repoRoot: d.repoRoot, budget: d.writer.budget, model: d.writer.model, changed, diff: () => sandboxDiff(dir, c.testler), check: async (ch) => runChecks(dir, checksFor(dir, ch, c.testler)), log: d.log, ...(d.maxTurns ? { maxTurns: d.maxTurns } : {}), ...(d.stop ? { stop: d.stop } : {}) },
    );
    if (w.durdu) return await record({ ...base, sonuc: "gecersiz", turlar: w.turlar, maliyetUsd: w.maliyetUsd, dosyalar: w.dosyalar, model: w.model, neden: `yarıda kaldı: ${w.durdu}` });
    // What it wrote is kept to read later (the exam's tests left out).
    const patchDir = path.join(devBrainDir(d.workRoot), "yazma");
    await fs.mkdir(patchDir, { recursive: true });
    await git(dir, ["add", "-A"]);
    const patch = await git(dir, ["diff", "--cached", "--no-color", "--", ".", ...c.testler.map((t) => `:!${t}`)]);
    await fs.writeFile(path.join(patchDir, `${short(c.sha)}.diff`), patch.stdout);
    const done = { ...base, turlar: w.turlar, maliyetUsd: w.maliyetUsd, dosyalar: w.dosyalar, model: w.model };
    if (w.gecti) return await record({ ...done, sonuc: "gecti" });
    // Did the scenarios pass with the real change here? If not, the environment failed, not the apprentice.
    await git(dir, ["reset", "-q", "--hard"]);
    // Only the files it created go (one by one; never a `git clean` beside the linked dependencies).
    for (const f of (await git(dir, ["ls-files", "--others", "--exclude-standard"])).stdout.split(/\r?\n/).filter(Boolean)) await fs.rm(path.join(dir, f), { force: true });
    await git(dir, ["checkout", c.sha, "--", ...c.kod, ...c.testler]);
    const real = await runTests(c.testler);
    if (!real.ok) return await record({ ...done, sonuc: "gecersiz", neden: `gerçek değişiklikle de geçmiyor (ortam): ${real.cikti.slice(-300)}` });
    await examLesson(d, c, w);
    return await record({ ...done, sonuc: "kaldi", neden: w.neden ?? "" });
  } catch (e) {
    return record({ ...base, sonuc: "gecersiz", turlar: 0, maliyetUsd: 0, dosyalar: [], model: "", neden: `sınav hatası: ${(e as Error).message.slice(0, 300)}` });
  } finally {
    await dropWorktree(d.repoRoot, dir).catch(() => undefined);
  }
}

/** After a failed exam: one lesson from what it tried against how the change was really written (the cheap model). */
async function examLesson(d: ExamDeps, c: ExamCommit, w: WriterResult): Promise<void> {
  const real = (await codeOf(d.workRoot, [c.sha]))[0];
  const prompt = `You are the apprentice developer of Atölye V3. You tried to write a change yourself and the checks did not pass; compare with how the senior really wrote it and learn.
TASK: ${c.gorev}
YOU CHANGED: ${w.dosyalar.join(", ") || "nothing"}. Your summary: ${w.ozet || "—"}
THE CHECKS SAID AT THE END: ${(w.neden ?? "").slice(-1_200)}
HOW THE SENIOR DID IT:
${real ? codeExperienceLines(real, { ornek: 1_200 }).join("\n") : c.kod.join(", ")}
Write ONE lesson for writing such code next time (where it goes, which existing function to reuse, what the tests expect, a mistake to avoid), in Turkish, at most 2 sentences. Return ONLY JSON: {"ders": "..."}`;
  try {
    const out = await d.research.budget.generate("cirak-ders", d.research.model, prompt, { maxTokens: 250 });
    const ders = readJsonAnswer<{ ders?: unknown }>(out.result.content)?.ders;
    if (typeof ders === "string" && ders.trim()) {
      await recordLesson(d.workRoot, { tarih: new Date().toISOString(), id: c.sha, metin: ders });
      await say(d.workRoot, `Yazma dersi: ${ders.trim().slice(0, 200)}`);
    }
  } catch (e) {
    d.log(`  çırak: ders yazılamadı (${(e as Error).message.slice(0, 120)})`);
  }
}

/** The apprentice as the development queue's agent (Developer.develop runs it in the job's worktree). */
export function apprenticeAgent(repoRoot: string, workRoot: string): string[] {
  return [process.execPath, path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"), path.join(repoRoot, "scripts", "v3", "cirak-yaz.ts"), "--calisma", workRoot, "--depo", repoRoot];
}

/**
 * When the apprentice builds an approved job (`ATOLYE_V3_CIRAK_YAZAR`): `kapali` never; `yedek` (default) when Claude's
 * usage limit stops a job; `once` before Claude — the last two only once its writing exams allow it.
 */
export async function apprenticePolicy(repoRoot: string, workRoot: string, env: Readonly<Record<string, string | undefined>> = process.env): Promise<{ readonly agent: string[]; readonly when: "yedek" | "once" } | undefined> {
  const mode = (env.ATOLYE_V3_CIRAK_YAZAR ?? "yedek").trim();
  if (mode !== "yedek" && mode !== "once") return undefined;
  if (!writeReadiness(await listWriteExams(workRoot)).yazabilir) return undefined;
  return { agent: apprenticeAgent(repoRoot, workRoot), when: mode };
}

/** Today's spend on writing exams (the daily cap's measure). */
export async function examSpendToday(workRoot: string, now = new Date()): Promise<number> {
  const day = now.toISOString().slice(0, 10);
  return (await listWriteExams(workRoot)).filter((x) => x.tarih.slice(0, 10) === day).reduce((s, x) => s + x.maliyetUsd, 0);
}

/**
 * A job written by the apprentice in `dir` (the job's worktree): the task from the proposal, the developer brain's
 * research note, the context as for an exam; it must add its own smoke scenario. The queue's own checks follow.
 */
export async function writeJob(dir: string, job: { readonly id: string; readonly gorev: string; readonly arastirma?: string }, d: ResearchDeps, writer: { readonly budget: V3Budget; readonly model: V3ModelChoice }): Promise<WriterResult> {
  const ctx = await context(d, { id: job.id, gorev: job.gorev, rev: "HEAD" });
  return writeChange(
    { gorev: job.gorev, testZorunlu: true, ...(job.arastirma ? { arastirma: job.arastirma } : {}), ...ctx },
    { dir, repoRoot: d.repoRoot, budget: writer.budget, model: writer.model, changed: () => sandboxChanges(dir), diff: () => sandboxDiff(dir), check: async (ch) => runChecks(dir, writerChecks(dir, ch)), log: d.log },
  );
}
