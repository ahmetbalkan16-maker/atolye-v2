import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { V3Budget, V3ModelChoice } from "../script/V3Budget";
import { runProcess } from "../util/Proc";
import { readJsonAnswer } from "./Council";
import {
  type DevGuess,
  firedInstincts,
  gradedFiles,
  gradeGuess,
  type Instinct,
  lastGuess,
  learnInstincts,
  listChanges,
  listLessons,
  MAX_GUESS_FILES,
  readInstincts,
  recordChange,
  recordGrade,
  recordGuess,
  recordLesson,
  researchMarkdown,
  researchNote,
  say,
  similarChanges,
  taskWords,
  writeInstincts,
} from "./DevBrain";
import { develop, type DeveloperDeps } from "./Developer";
import type { DevProposal } from "./SelfImprovement";

/**
 * The developer brain at work (DevBrain holds what it knows): it researches an approved job in the studio's own git —
 * search words from the task, `git grep` over the V3 code at the right revision, the past changes and instincts that
 * fire on the task — and a cheap model picks the files and writes the plan. It sits the same exam on every new V3 commit
 * (guessing at the commit's parent, never seeing the answer), and after the evening's builds it grades itself against
 * what Claude really changed and writes down what it missed. Runs only in the order watcher's processes (it starts git).
 */
export interface ResearchDeps {
  readonly repoRoot: string;
  readonly workRoot: string;
  readonly budget: V3Budget;
  readonly model: V3ModelChoice;
  readonly log: (s: string) => void;
}

/** Where it searches: the V3 studio's code and data. */
export const SEARCH_PATHS = ["src/lib/v3", "scripts/v3", "remotion-v3/src", "content/v3"] as const;
/** Candidates it looks at closely. */
const CANDIDATES = 20;
/** A commit is an exam question only when it changed this few graded files (a long multi-change commit tells little). */
export const EXAM_MAX_FILES = 8;
/** Commits it sits per learning pass; older unseen ones are read without an exam. */
export const EXAMS_PER_PASS = 4;

const git = (cwd: string, args: readonly string[]) => runProcess("git", ["-c", "core.quotepath=false", ...args], { cwd, timeoutMs: 120_000 });

const modelName = (m: V3ModelChoice) => (m.provider === "openai" ? (m.model ?? "openai") : m.provider);

/** The V3 files at a revision. */
async function filesAt(repoRoot: string, rev: string): Promise<string[]> {
  const r = await git(repoRoot, ["ls-tree", "-r", "--name-only", rev, "--", ...SEARCH_PATHS]);
  return r.code === 0 ? gradedFiles(r.stdout.split(/\r?\n/).filter(Boolean)) : [];
}

/** What a file says it does: the first sentence of its first doc comment. */
async function fileSummary(repoRoot: string, rev: string, file: string): Promise<string> {
  if (file.endsWith(".json")) return "veri dosyası";
  const r = await git(repoRoot, ["show", `${rev}:${file}`]);
  const doc = /\/\*\*([\s\S]*?)\*\//.exec(r.stdout.slice(0, 8_000))?.[1];
  if (!doc) return "";
  const text = doc.replace(/^\s*\*\s?/gm, " ").replace(/\s+/g, " ").trim();
  return (/^(.+?[.!?])(\s|$)/.exec(text)?.[1] ?? text).slice(0, 180);
}

/** Search words for a task: the model's English code words and the task's own words. */
async function searchTerms(task: string, folders: readonly string[], d: ResearchDeps): Promise<string[]> {
  const own = taskWords(task);
  const prompt = `You help find code in a TypeScript studio that makes animated history videos (Atölye V3). Its folders: src/lib/v3/{${folders.join(",")}}, scripts/v3 (command lines), remotion-v3/src (the renderer), content/v3 (data). Code and comments are English; log lines and JSON keys are often Turkish.
TASK (Turkish): ${task}
Give up to 12 search terms that appear in the code that does this or would change for it: identifiers (camelCase/PascalCase), English words from comments, Turkish JSON keys or log words. Return ONLY JSON: {"terimler": ["..."]}`;
  try {
    const out = await d.budget.generate("gelistirici-arama", d.model, prompt, { maxTokens: 300 });
    const raw = readJsonAnswer<{ terimler?: unknown }>(out.result.content);
    const terms = Array.isArray(raw?.terimler) ? raw.terimler.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter((t) => t.length >= 3 && t.length <= 40) : [];
    return [...new Set([...terms.slice(0, 12), ...own.slice(0, 6)])];
  } catch {
    return own.slice(0, 12);
  }
}

/** Scores files by the search words they contain (rarer words weigh more) and by words in their path. */
async function grepScores(repoRoot: string, rev: string, terms: readonly string[], all: readonly string[]): Promise<Map<string, { puan: number; kelimeler: string[] }>> {
  const scores = new Map<string, { puan: number; kelimeler: string[] }>();
  const known = new Set(all);
  for (const term of terms) {
    const r = await git(repoRoot, ["grep", "-I", "-i", "-c", "-F", "-e", term, rev, "--", ...SEARCH_PATHS]);
    const hits = r.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => /^[^:]+:(.+):(\d+)$/.exec(l))
      .flatMap((m) => (m && known.has(m[1]!) ? [{ file: m[1]!, count: Number(m[2]) }] : []));
    const lower = term.toLowerCase();
    const inPath = all.filter((f) => path.posix.basename(f).toLowerCase().includes(lower));
    if (!hits.length && !inPath.length) continue;
    const idf = Math.log(1 + all.length / Math.max(1, hits.length));
    for (const h of hits) {
      const s = scores.get(h.file) ?? { puan: 0, kelimeler: [] };
      scores.set(h.file, { puan: s.puan + idf * (1 + Math.log(h.count)), kelimeler: [...s.kelimeler, term] });
    }
    for (const f of inPath) {
      const s = scores.get(f) ?? { puan: 0, kelimeler: [] };
      scores.set(f, { puan: s.puan + 2 * idf, kelimeler: s.kelimeler.includes(term) ? s.kelimeler : [...s.kelimeler, term] });
    }
  }
  return scores;
}

/** The brain's guess for a task at a revision, with what it found on the way (for the research note). */
export async function guessTask(
  input: { readonly id: string; readonly kaynak: DevGuess["kaynak"]; readonly gorev: string; readonly rev: string; readonly before?: string },
  d: ResearchDeps,
): Promise<{ guess: DevGuess; benzer: { mesaj: string; dosyalar: readonly string[] }[]; icguduler: Instinct[]; ozetler: Record<string, string> }> {
  const all = await filesAt(d.repoRoot, input.rev);
  const folders = [...new Set(all.filter((f) => f.startsWith("src/lib/v3/")).map((f) => f.split("/")[3]!).filter((x) => !x.includes(".")))];
  const terms = await searchTerms(input.gorev, folders, d);
  const scores = await grepScores(d.repoRoot, input.rev, terms, all);
  const why = new Map<string, string[]>();
  const add = (f: string, puan: number, neden: string) => {
    if (!all.includes(f)) return;
    const s = scores.get(f) ?? { puan: 0, kelimeler: [] };
    scores.set(f, { ...s, puan: s.puan + puan });
    why.set(f, [...(why.get(f) ?? []), neden]);
  };
  const benzer = similarChanges(await listChanges(d.workRoot), input.gorev, { ...(input.before ? { before: input.before } : {}), exclude: input.id });
  for (const c of benzer) for (const f of c.dosyalar) add(f, 6 * c.benzerlik, `benzer değişiklik "${c.mesaj.slice(0, 60)}"`);
  const icguduler = firedInstincts(await readInstincts(d.workRoot), input.gorev).slice(0, 12);
  for (const i of icguduler) add(i.dosya, 8 * i.guven, `içgüdü ${i.guven}`);
  const ranked = [...scores.entries()].sort((a, b) => b[1].puan - a[1].puan).slice(0, CANDIDATES).map(([f]) => f);
  const ozetler: Record<string, string> = {};
  for (const f of ranked) ozetler[f] = await fileSummary(d.repoRoot, input.rev, f);
  const lessons = (await listLessons(d.workRoot)).slice(-6).map((l) => l.metin);
  const prompt = `You are the apprentice developer of Atölye V3, a TypeScript studio that makes animated history videos. Before the senior developer builds a task you guess where the change goes; you are graded on it later.
TASK (Turkish): ${input.gorev}

CANDIDATE FILES your search found (path — what the file says it does — why it came up):
${ranked.map((f, i) => `${i + 1}. ${f} — ${ozetler[f] || "?"} — ${[...(scores.get(f)?.kelimeler.length ? [`words: ${scores.get(f)!.kelimeler.slice(0, 5).join(", ")}`] : []), ...(why.get(f) ?? []).slice(0, 2)].join("; ")}`).join("\n") || "(none)"}
${benzer.length ? `\nSIMILAR PAST CHANGES:\n${benzer.map((c) => `- "${c.mesaj}" → ${c.dosyalar.slice(0, 6).join(", ")}`).join("\n")}\n` : ""}${lessons.length ? `\nYOUR LESSONS FROM EARLIER GUESSES:\n${lessons.map((l) => `- ${l}`).join("\n")}\n` : ""}
Decide which files (at most ${MAX_GUESS_FILES}; usually 1-4) a developer would change for this task, whether the studio already does it, and how. Name only real paths, preferably from the candidates.
Return ONLY JSON: {"dosyalar": ["path", ...], "karar": "var" | "yapilmali", "plan": "<Turkish, 2-4 sentences: what changes where>", "test": "scripts/smoke-v3-<name>.ts"}`;
  let guess: DevGuess = { id: input.id, kaynak: input.kaynak, tarih: new Date().toISOString(), gorev: input.gorev, dosyalar: ranked.slice(0, 3), karar: "yapilmali", plan: "", adaylar: ranked, model: modelName(d.model) };
  try {
    const out = await d.budget.generate("gelistirici-tahmin", d.model, prompt, { maxTokens: 700 });
    const raw = readJsonAnswer<{ dosyalar?: unknown; karar?: unknown; plan?: unknown; test?: unknown }>(out.result.content);
    if (raw) {
      const named = Array.isArray(raw.dosyalar) ? gradedFiles(raw.dosyalar.filter((f): f is string => typeof f === "string").map((f) => f.trim())).filter((f) => all.includes(f)).slice(0, MAX_GUESS_FILES) : [];
      guess = {
        ...guess,
        dosyalar: named.length || raw.karar === "var" ? named : guess.dosyalar,
        karar: raw.karar === "var" ? "var" : "yapilmali",
        plan: typeof raw.plan === "string" ? raw.plan.replace(/\s+/g, " ").trim().slice(0, 700) : "",
        ...(typeof raw.test === "string" && /^scripts\/smoke-v3-[\w-]+\.ts$/.test(raw.test.trim()) ? { test: raw.test.trim() } : {}),
        model: modelName(out.used),
      };
    }
  } catch (e) {
    d.log(`  geliştirici beyni: model cevap vermedi, arama sırası kullanıldı (${(e as Error).message.slice(0, 120)})`);
  }
  return { guess, benzer, icguduler, ozetler };
}

/** Whether a job needs (new) research: never researched, or tried again since its last research. */
export async function needsResearch(workRoot: string, p: DevProposal): Promise<boolean> {
  const g = await lastGuess(workRoot, p.id);
  return !g || (!!p.is?.bitis && g.tarih < p.is.bitis);
}

const jobTask = (p: Pick<DevProposal, "baslik" | "neden" | "karar">) => `${p.baslik} — ${p.neden}${p.karar?.not ? ` (owner: ${p.karar.not})` : ""}`.slice(0, 900);

/** Researches one approved job at the checkout's HEAD; the guess is recorded before anyone builds it. */
export async function researchJob(p: DevProposal, d: ResearchDeps): Promise<DevGuess> {
  const { guess, benzer, icguduler, ozetler } = await guessTask({ id: p.id, kaynak: "is", gorev: jobTask(p), rev: "HEAD" }, d);
  await recordGuess(d.workRoot, guess);
  const note = researchNote(d.workRoot, p.id);
  await fs.mkdir(path.dirname(note), { recursive: true });
  await fs.writeFile(note, researchMarkdown(guess, { benzer, icguduler, ozetler }));
  await say(d.workRoot, `"${p.baslik.slice(0, 80)}" işini araştırdım: ${guess.karar === "var" ? "stüdyoda zaten var gibi görünüyor, akşam Claude doğrulayacak" : `${guess.dosyalar.length} dosyada değişiklik bekliyorum${guess.dosyalar[0] ? ` (en güçlü aday ${path.posix.basename(guess.dosyalar[0])})` : ""}`}.`);
  return guess;
}

/** The jobs waiting for the evening, researched by day: approved and not yet researched (or tried again since). */
export async function researchQueue(proposals: readonly DevProposal[], d: ResearchDeps, max = 3): Promise<string[]> {
  const done: string[] = [];
  for (const p of proposals.filter((x) => x.durum === "onaylandi" || x.durum === "yapilamadi")) {
    if (done.length >= max) break;
    if (!(await needsResearch(d.workRoot, p))) continue;
    const g = await researchJob(p, d);
    done.push(`"${p.baslik.slice(0, 60)}": ${g.karar === "var" ? "zaten var gibi" : `${g.dosyalar.length} dosya`}`);
  }
  return done;
}

/** The V3 commits on HEAD, oldest first. */
async function v3Commits(repoRoot: string, limit = 400): Promise<{ sha: string; tarih: string; konu: string }[]> {
  const r = await git(repoRoot, ["log", "--no-merges", "-n", String(limit), "--format=%H%x09%cI%x09%s", "HEAD", "--", ...SEARCH_PATHS]);
  return r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.split("\t"))
    .filter((x) => x.length >= 3)
    .map(([sha, tarih, ...konu]) => ({ sha: sha!, tarih: tarih!, konu: konu.join("\t") }))
    .reverse();
}

async function commitFiles(repoRoot: string, sha: string): Promise<string[]> {
  const r = await git(repoRoot, ["diff-tree", "--no-commit-id", "--name-only", "-r", sha]);
  return r.stdout.split(/\r?\n/).filter(Boolean);
}

/** A commit subject as a task (the type prefix says nothing about where the change goes). */
export const commitTask = (subject: string) => subject.replace(/^(feat|fix|docs|chore|refactor|perf|test|wip)(\([^)]*\))?!?:\s*/i, "").trim();

/**
 * Learns from the V3 commits it has not seen: the newest few are exam questions (guessed at the parent, graded against
 * the commit's files, only commits of at most EXAM_MAX_FILES graded files), every one then joins its memory of past
 * changes and its instincts. The first pass reads the whole history this way, oldest first.
 */
export async function learnFromCommits(d: ResearchDeps, exams = EXAMS_PER_PASS): Promise<{ okunan: number; sinav: number; ozet: string }> {
  const seen = new Set((await listChanges(d.workRoot)).map((c) => c.id));
  const fresh = (await v3Commits(d.repoRoot)).filter((c) => !seen.has(c.sha));
  if (!fresh.length) return { okunan: 0, sinav: 0, ozet: "yeni commit yok" };
  let instincts = await readInstincts(d.workRoot);
  const examFrom = Math.max(0, fresh.length - exams);
  const results: string[] = [];
  let sinav = 0;
  for (const [k, c] of fresh.entries()) {
    const files = await commitFiles(d.repoRoot, c.sha);
    const graded = gradedFiles(files);
    const task = commitTask(c.konu);
    if (k >= examFrom && graded.length >= 1 && graded.length <= EXAM_MAX_FILES && task) {
      // The exam comes before the answer joins the memory: the guess is made at the parent, with what was known then.
      const { guess } = await guessTask({ id: c.sha, kaynak: "commit", gorev: task, rev: `${c.sha}^`, before: c.tarih }, d);
      await recordGuess(d.workRoot, guess);
      const grade = gradeGuess(guess, files);
      await recordGrade(d.workRoot, grade);
      sinav++;
      results.push(`"${task.slice(0, 50)}": %${Math.round(grade.isabet * 100)}`);
      await say(d.workRoot, `Commit sınavı — "${task.slice(0, 70)}": değişen ${grade.gercek.length} dosyanın ${Math.round(grade.isabet * grade.gercek.length)} tanesini buldum${grade.isabet < 1 && grade.adayIsabet > grade.isabet ? " (kalanlar aramamda vardı, seçemedim)" : ""}.`);
    }
    // Every commit is recorded, so it is read once (one that changed only notes has no files to learn).
    await recordChange(d.workRoot, { id: c.sha, tarih: c.tarih, mesaj: task, dosyalar: graded });
    if (graded.length) instincts = learnInstincts(instincts, task, graded, c.sha.slice(0, 10));
  }
  await writeInstincts(d.workRoot, instincts);
  const okunan = fresh.length;
  const ozet = `${okunan} commit okundu${sinav ? `, ${sinav} sınav: ${results.join(" · ")}` : ""}`;
  if (okunan > sinav) await say(d.workRoot, `${okunan - sinav} değişikliği hafızama ekledim (toplam içgüdü ${instincts.length}).`);
  return { okunan, sinav, ozet };
}

/**
 * After the master built a job: the guess is graded against what really changed (nothing changed = "already there"),
 * the instincts learn, and when the guess missed, the model writes one lesson for next time.
 */
export async function learnFromBuild(p: DevProposal, d: ResearchDeps): Promise<string> {
  if (p.durum === "yapilamadi") {
    await say(d.workRoot, `"${p.baslik.slice(0, 70)}" Claude'da da tutmadı: ${(p.is?.sorunlar ?? []).join(" | ").slice(0, 160)}`, "AYAS");
    return "iş tutulmadı, notlanmadı";
  }
  if (p.durum !== "hazir" && p.durum !== "yapildi") return "iş bitmedi";
  const changed = p.is?.dosyalar ?? [];
  const guess = await lastGuess(d.workRoot, p.id);
  await recordChange(d.workRoot, { id: p.id, tarih: new Date().toISOString(), mesaj: p.baslik, dosyalar: gradedFiles(changed) });
  if (gradedFiles(changed).length) await writeInstincts(d.workRoot, learnInstincts(await readInstincts(d.workRoot), jobTask(p), changed, p.id));
  if (!guess) return "tahmini yoktu";
  const grade = gradeGuess(guess, changed);
  await recordGrade(d.workRoot, grade);
  const line = `Claude "${p.baslik.slice(0, 60)}" işini bitirdi (${grade.gercek.length} dosya); tahminim %${Math.round(grade.isabet * 100)} tuttu${grade.kararDogru === false ? ", \"zaten var mı\" kararım yanlıştı" : ""}.`;
  await say(d.workRoot, line);
  if (grade.isabet >= 1 && grade.kararDogru !== false) return line;
  const prompt = `You are the apprentice developer of Atölye V3. Before the senior developer built a task you guessed where the change would go; compare and learn.
TASK: ${jobTask(p)}
YOUR GUESS: ${guess.karar === "var" ? "the studio already does it" : `change ${guess.dosyalar.join(", ") || "nothing named"}`}. Your plan: ${guess.plan || "—"}
WHAT THE SENIOR DID: changed ${grade.gercek.join(", ") || "nothing (the studio already did it)"}. Their summary: ${(p.is?.ozet ?? "").slice(0, 1200)}
Write ONE lesson for similar tasks next time, general enough to reuse (where such changes go, what to check first), in Turkish, at most 2 sentences. Return ONLY JSON: {"ders": "..."}`;
  try {
    const out = await d.budget.generate("gelistirici-ders", d.model, prompt, { maxTokens: 250 });
    const ders = readJsonAnswer<{ ders?: unknown }>(out.result.content)?.ders;
    if (typeof ders === "string" && ders.trim()) {
      await recordLesson(d.workRoot, { tarih: new Date().toISOString(), id: p.id, metin: ders });
      await say(d.workRoot, `Ders aldım: ${ders.trim().slice(0, 200)}`);
    }
  } catch (e) {
    d.log(`  geliştirici beyni: ders yazılamadı (${(e as Error).message.slice(0, 120)})`);
  }
  return line;
}

/**
 * One job of the evening: researched first when the day's research missed it (Claude always gets the note), built by
 * the developer (Developer.develop: Claude in its own worktree, the studio's checks), then learned from.
 */
export async function runDevJob(p: DevProposal, d: ResearchDeps, builder: Partial<Pick<DeveloperDeps, "agent" | "checks" | "worktreeRoot">> = {}): Promise<DevProposal> {
  if (await needsResearch(d.workRoot, p)) await researchJob(p, d).catch((e: Error) => d.log(`  geliştirici beyni: araştıramadı (${e.message.slice(0, 160)})`));
  const note = researchNote(d.workRoot, p.id);
  const research = existsSync(note) && (await lastGuess(d.workRoot, p.id)) ? await fs.readFile(note, "utf8") : undefined;
  await say(d.workRoot, `"${p.baslik.slice(0, 80)}" işini araştırma notumla birlikte Claude'a veriyorum.`, "Claude");
  const done = await develop(p, { ...builder, repoRoot: d.repoRoot, workRoot: d.workRoot, log: d.log, ...(research ? { research } : {}) });
  await learnFromBuild(done, d).catch((e: Error) => d.log(`  geliştirici beyni: öğrenemedi (${e.message.slice(0, 160)})`));
  return done;
}
