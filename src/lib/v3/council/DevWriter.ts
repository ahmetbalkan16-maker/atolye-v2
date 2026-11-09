import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { V3Budget, V3ModelChoice } from "../script/V3Budget";
import { runProcess } from "../util/Proc";
import { type CodeExperience, codeExperienceLines, declarationSpans, isV3Smoke, parseDiff } from "./DevBrain";
import { forbiddenChanges } from "./DevQueue";

/**
 * The studio's own developer writing code (owner, 6 Nov 2026: "hem öğrenmesi hızlansın hem de Claude olmadan
 * yazabilecek duruma gelsin"). Until now the apprentice only guessed where a change goes and Claude wrote it; here it
 * writes the change itself, in a sandbox copy of the repository, the way a developer does: it reads the files its
 * research names (and asks for more when it needs them), answers with search/replace edit blocks, the studio applies
 * them and runs the checks (type check, the smoke scenarios), and the checks' words come back for the next round until
 * they pass or the rounds run out. It never runs a command itself, never touches git, and an edit outside the V3
 * studio's own files is refused. The edit blocks are plain text, not JSON: code inside JSON strings was the usual way a
 * model broke its own answer.
 */

/** One edit: in `dosya`, the exact text `ara` becomes `yerine` (an empty `ara` creates a new file). */
export interface EditBlock {
  readonly dosya: string;
  readonly ara: string;
  readonly yerine: string;
}

export interface WriterAnswer {
  /** Files (or parts) it wants to read before writing. */
  readonly oku: readonly string[];
  readonly duzenlemeler: readonly EditBlock[];
  /** Its own Turkish summary. */
  readonly ozet: string;
}

const SEARCH_OPEN = /^<{5,9}\s*(ARA|SEARCH)\s*$/i;
const DIVIDER = /^={5,9}\s*$/;
const REPLACE_CLOSE = /^>{5,9}\s*(YER[İI]NE|REPLACE)\s*$/i;
const FENCE = /^\s*```[\w-]*\s*$/;

const cleanPath = (s: string) => s.trim().replace(/^[`"']+|[`"']+$/g, "").replace(/\\/g, "/").replace(/^\.\//, "");

/** A block's text without the code fence a model sometimes puts around it. */
function unfence(lines: string[]): string {
  const l = [...lines];
  if (l.length >= 2 && FENCE.test(l[0]!) && FENCE.test(l[l.length - 1]!)) return l.slice(1, -1).join("\n");
  return l.join("\n");
}

/** Reads the model's answer: OKU lines, DOSYA headers with their ARA/YERINE blocks, the OZET line. */
export function parseWriterAnswer(text: string): WriterAnswer {
  const oku: string[] = [];
  const edits: EditBlock[] = [];
  let ozet = "";
  let file = "";
  let state: "out" | "ara" | "yerine" = "out";
  let ara: string[] = [];
  let yerine: string[] = [];
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    if (state === "out") {
      const read = /^\s*OKU:\s*(.+)$/i.exec(raw);
      const head = /^\s*(?:DOSYA|FILE):\s*(.+)$/i.exec(raw);
      const sum = /^\s*(?:OZET|ÖZET|SUMMARY):\s*(.*)$/i.exec(raw);
      if (read) oku.push(cleanPath(read[1]!));
      else if (head) file = cleanPath(head[1]!);
      else if (sum) ozet = sum[1]!.trim();
      else if (SEARCH_OPEN.test(raw.trim()) && file) {
        state = "ara";
        ara = [];
        yerine = [];
      }
      continue;
    }
    if (state === "ara") {
      if (DIVIDER.test(raw.trim())) state = "yerine";
      else ara.push(raw);
      continue;
    }
    if (REPLACE_CLOSE.test(raw.trim())) {
      edits.push({ dosya: file, ara: unfence(ara), yerine: unfence(yerine) });
      state = "out";
    } else yerine.push(raw);
  }
  return { oku: [...new Set(oku)].slice(0, 8), duzenlemeler: edits, ozet };
}

/** Where `needle`'s lines stand in `lines` when each line is compared through `norm` (all the places). */
function findLines(lines: readonly string[], needle: readonly string[], norm: (s: string) => string): number[] {
  const want = needle.map(norm);
  const at: number[] = [];
  for (let i = 0; i + want.length <= lines.length; i++) if (want.every((w, k) => norm(lines[i + k]!) === w)) at.push(i);
  return at;
}

/**
 * One edit on a file's content (undefined: the file does not exist). Exact text first; when the model's copy differs
 * only in trailing spaces or indentation, the lines are matched that way — but only a single place counts: an edit that
 * fits two places is refused, it would be a guess.
 */
export function applyEdit(content: string | undefined, e: EditBlock): { ok: true; icerik: string } | { ok: false; neden: string } {
  if (!e.ara.trim()) {
    if (content !== undefined) return { ok: false, neden: `${e.dosya} zaten var; ARA bölümü boş olamaz (yeni dosya değil, değiştirilecek satırları ARA'ya kopyala)` };
    return { ok: true, icerik: e.yerine.endsWith("\n") ? e.yerine : `${e.yerine}\n` };
  }
  if (content === undefined) return { ok: false, neden: `${e.dosya} yok; yeni dosya için ARA bölümünü boş bırak` };
  const crlf = content.includes("\r\n");
  const text = crlf ? content.replace(/\r\n/g, "\n") : content;
  const back = (s: string) => (crlf ? s.replace(/\n/g, "\r\n") : s);
  const ara = e.ara.replace(/\r\n/g, "\n");
  const yerine = e.yerine.replace(/\r\n/g, "\n");
  const first = text.indexOf(ara);
  if (first >= 0) {
    if (text.indexOf(ara, first + 1) >= 0) return { ok: false, neden: `${e.dosya}: ARA metni birden çok yerde geçiyor; tek bir yeri gösterecek kadar satır ekle` };
    return { ok: true, icerik: back(text.slice(0, first) + yerine + text.slice(first + ara.length)) };
  }
  const lines = text.split("\n");
  const needle = ara.replace(/\n+$/, "").split("\n");
  for (const norm of [(s: string) => s.trimEnd(), (s: string) => s.trim()]) {
    const at = findLines(lines, needle, norm);
    if (at.length > 1) return { ok: false, neden: `${e.dosya}: ARA satırları birden çok yerde geçiyor; tek bir yeri gösterecek kadar satır ekle` };
    if (at.length === 1) {
      const out = [...lines.slice(0, at[0]), ...yerine.replace(/\n+$/, "").split("\n"), ...lines.slice(at[0]! + needle.length)];
      return { ok: true, icerik: back(out.join("\n")) };
    }
  }
  const hint = needle.find((l) => l.trim().length > 8)?.trim().slice(0, 80);
  return { ok: false, neden: `${e.dosya}: ARA metni dosyada bulunamadı${hint ? ` ("${hint}" satırı dosyanın şu anki halinde yok)` : ""}; dosyanın gösterilen içeriğinden birebir kopyala` };
}

/** A repo-relative path inside `dir` that the apprentice may read (no git internals, no dependencies, no secrets). */
export function readablePath(dir: string, rel: string): string | undefined {
  const clean = cleanPath(rel);
  if (!clean || /(^|\/)(\.git|node_modules)(\/|$)|(^|\/)\.env/i.test(clean)) return undefined;
  const full = path.resolve(dir, clean);
  const root = path.resolve(dir);
  return full === root || !full.startsWith(root + path.sep) ? undefined : full;
}

/** Characters of one file shown whole; a longer one is shown as its outline and the declarations in focus. */
export const FULL_FILE_CHARS = 24_000;
const SPAN_CHARS = 8_000;
const READ_CHARS = 30_000;

/** A file as the prompt shows it: whole when short, else its declarations with line numbers and the focused ones' code. */
export function fileView(rel: string, content: string, focus: readonly string[] = []): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (content.length <= FULL_FILE_CHARS) return `=== ${rel} (${lines.length} satır)\n${content.replace(/\r\n/g, "\n")}`;
  const spans = declarationSpans(content);
  const wanted = spans.filter((s) => focus.includes(s.ad));
  const out = [`=== ${rel} (${lines.length} satır; uzun dosya — bildirimleri ve odaktakilerin kodu. Başka bir bildirimi okumak için: OKU: ${rel}#Ad)`, "Bildirimler: " + spans.map((s) => `${s.ad} (${s.bas}-${s.son})`).join(", ")];
  let budget = FULL_FILE_CHARS;
  for (const s of wanted) {
    const code = lines.slice(s.bas - 1, s.son).join("\n").slice(0, SPAN_CHARS);
    if (budget - code.length < 0) break;
    budget -= code.length;
    out.push(`--- ${rel}#${s.ad} (satır ${s.bas}-${s.son})\n${code}`);
  }
  if (!wanted.length) out.push(`--- ${rel} (satır 1-120)\n${lines.slice(0, 120).join("\n")}`);
  return out.join("\n");
}

/** What an OKU line asks for: a file, one of its declarations (`path#Name`) or a line range (`path:10-80`). */
export async function readRequest(dir: string, repoRoot: string, req: string): Promise<string> {
  const m = /^(.+?)(?:#([A-Za-z_$][\w$]*)|:(\d+)-(\d+))?$/.exec(cleanPath(req));
  const rel = m?.[1] ?? req;
  // The project's skills are read from the checkout (some are not tracked, so a sandbox copy may lack them).
  const base = rel.startsWith(".claude/skills/") ? repoRoot : dir;
  const full = readablePath(base, rel);
  if (!full || !existsSync(full)) return `=== ${rel}: okunamadı (yok ya da izin dışı)`;
  const st = await fs.stat(full);
  if (st.isDirectory()) return `=== ${rel}/ (klasör)\n${(await fs.readdir(full)).slice(0, 200).join("\n")}`;
  const content = await fs.readFile(full, "utf8");
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (m?.[2]) {
    const s = declarationSpans(content).find((x) => x.ad === m[2]);
    return s ? `=== ${rel}#${m[2]} (satır ${s.bas}-${s.son})\n${lines.slice(s.bas - 1, s.son).join("\n").slice(0, READ_CHARS)}` : `=== ${rel}#${m[2]}: bu adla üst düzey bildirim yok`;
  }
  if (m?.[3]) {
    const from = Math.max(1, Number(m[3])), to = Math.min(lines.length, Number(m[4]));
    return `=== ${rel} (satır ${from}-${to})\n${lines.slice(from - 1, to).join("\n").slice(0, READ_CHARS)}`;
  }
  return content.length <= READ_CHARS ? `=== ${rel} (${lines.length} satır)\n${content.replace(/\r\n/g, "\n")}` : fileView(rel, content);
}

/** What the apprentice is asked to write. */
export interface WriterTask {
  /** Turkish. */
  readonly gorev: string;
  /** An exam's spec: the new smoke scenarios that must pass (the commit's added test lines). */
  readonly testKodu?: string;
  /** Files it may not change (an exam's tests). */
  readonly korunan?: readonly string[];
  /** Files its research expects to change, shown first. */
  readonly dosyalar: readonly string[];
  /** Declarations in focus (a long file shows these). */
  readonly semboller: readonly string[];
  /** How similar past changes were done (their code and recipe). */
  readonly benzer: readonly CodeExperience[];
  readonly dersler: readonly string[];
  /** The project's skills that fit the task (DevSkills.skillsText). */
  readonly rehber: string;
  /** A job: the developer brain's research note. */
  readonly arastirma?: string;
  /** A job: it must add a smoke scenario itself. */
  readonly testZorunlu?: boolean;
}

export interface WriterDeps {
  /** The sandbox copy it writes in. */
  readonly dir: string;
  /** The checkout (the skills are read from it). */
  readonly repoRoot: string;
  readonly budget: V3Budget;
  readonly model: V3ModelChoice;
  /** The files changed so far in the sandbox (repo-relative, forward slashes; an exam's own test files left out). */
  readonly changed: () => Promise<string[]>;
  /** The checks for the files changed so far. */
  readonly check: (changed: readonly string[]) => Promise<{ ok: boolean; cikti: string }>;
  readonly log: (s: string) => void;
  readonly maxTurns?: number;
  /** Rounds it may spend only reading. */
  readonly maxReads?: number;
  /** Asked before every round: a reason stops the writing there (an order came in — the studio's work comes first). */
  readonly stop?: () => Promise<string | undefined>;
  /**
   * Its own edits so far as a diff (DevWriter.sandboxDiff). Shown every round and their declarations put in focus: in
   * the first real exam (6 Nov 2026) a long file showed only the focused declarations, the apprentice never saw the
   * function it had added a round before and added it again ("Cannot redeclare exported variable 'newFacts'").
   */
  readonly diff?: () => Promise<string>;
}

export interface WriterResult {
  readonly gecti: boolean;
  readonly turlar: number;
  readonly dosyalar: readonly string[];
  readonly ozet: string;
  readonly neden?: string;
  readonly maliyetUsd: number;
  readonly model: string;
  /** Set when `stop` ended it early (not the apprentice's failure). */
  readonly durdu?: string;
}

export const WRITER_TURNS = 6;
const FEEDBACK_CHARS = 6_000;
const FILES_SHOWN = 8;

const tail = (s: string, n: number) => (s.length > n ? `…${s.slice(-n)}` : s);

/** Characters of its own diff shown in a round (the newest part when longer). */
const DIFF_CHARS = 8_000;

/** The prompt of one round. */
export function writerPrompt(task: WriterTask, views: readonly string[], reads: readonly string[], feedback: string, canRead: boolean, ownDiff = ""): string {
  const parts = [
    `You are the Atölye V3 studio's own developer — an apprentice learning to work without Claude. You change this TypeScript repository yourself: the studio applies your edits in a sandbox copy and runs the checks, then shows you what they said.`,
    `TASK (Turkish): ${task.gorev}`,
  ];
  if (task.testKodu) parts.push(`THE SPEC — new smoke scenarios that must pass. They are already in the repository; you may NOT change ${task.korunan?.join(", ") || "the test files"}. Write the code they call, with the exact names they use:\n${task.testKodu}`);
  if (task.testZorunlu) parts.push("You must also prove the change: add a scenario to the matching scripts/smoke-v3-*.ts (node:assert/strict, no network, no model) — the checks run it.");
  if (task.arastirma?.trim()) parts.push(`THE DEVELOPER BRAIN'S RESEARCH (a guess — check it):\n${task.arastirma.trim().slice(0, 4_000)}`);
  if (task.rehber.trim()) parts.push(`GUIDES — the project's skills; follow them:\n${task.rehber}`);
  if (task.dersler.length) parts.push(`YOUR LESSONS FROM EARLIER WORK:\n${task.dersler.map((d) => `- ${d}`).join("\n")}`);
  if (task.benzer.length) parts.push(`SIMILAR PAST CHANGES AND HOW THEY WERE DONE:\n${task.benzer.slice(0, 3).map((x, k) => [`- "${x.gorev}"`, ...codeExperienceLines(x, k === 0 ? { ornek: 900 } : { ornek: 300 })].join("\n")).join("\n")}`);
  // What stays the same from round to round comes first — the task, the guides, how to answer, the files it read (only
  // added to), the files it has not touched — and what changes last: OpenAI bills a repeated prompt head from its cache
  // at a quarter of the price (gpt-4.1), so more writing exams fit the same day's cap (9 Nov 2026).
  parts.push(
    [
      "HOW TO ANSWER — plain text, no JSON:",
      "- To read more before writing (only when the last line of this message allows it; at most 6 lines, nothing else in that answer): OKU: <repo path> | OKU: <path>#<DeclarationName> | OKU: <path>:<from>-<to>",
      "- To change code, one block per edit (several blocks may follow one DOSYA line):",
      "DOSYA: <repo path>",
      "<<<<<<< ARA",
      "<lines copied exactly from the file's current content, enough to be unique>",
      "=======",
      "<the new lines>",
      ">>>>>>> YERINE",
      "  A new file: leave the ARA part empty.",
      "- End with one line: OZET: <Turkish, 1-3 sentences: what you changed and how it is tested>",
      "Rules: change only src/lib/v3/, scripts/v3/, scripts/smoke-v3-*.ts, remotion-v3/src/, content/v3/; never package.json or a new npm package; match the file's style (English code comments, Turkish log and user text); keep the change small; do not break other scenarios; never declare a name the file (or your edits so far) already declares — change the existing one; use only fields and functions you have seen in the files (read a type with OKU before using it).",
    ].join("\n"),
  );
  if (reads.length) parts.push(`FILES YOU ASKED TO READ:\n${reads.join("\n\n")}`);
  parts.push(`FILES (their current content in the sandbox):\n${views.join("\n\n") || "(none yet — ask with OKU)"}`);
  if (ownDiff.trim()) parts.push(`YOUR EDITS SO FAR — already applied in the sandbox. Do NOT add them again; to change them, use ARA on their current text:\n${tail(ownDiff, DIFF_CHARS)}`);
  if (feedback) parts.push(`YOUR LAST ROUND — your applied edits stay; the FILES above show the result. Fix what this says:\n${feedback}`);
  parts.push(canRead ? "NOW: answer with edit blocks and the OZET line as described above — or, only if you must read first, with OKU lines alone." : "NOW: no more reading — answer with edit blocks and the OZET line as described above.");
  return parts.join("\n\n");
}

/**
 * Writes the task in `deps.dir`, round by round: show the files, take the answer (reads or edits), apply the edits,
 * run the checks, feed back what failed. Passes when an applied round's checks pass with no refused edit.
 */
export async function writeChange(task: WriterTask, deps: WriterDeps): Promise<WriterResult> {
  const maxTurns = deps.maxTurns ?? WRITER_TURNS;
  const maxReads = deps.maxReads ?? 2;
  const korunan = new Set((task.korunan ?? []).map((f) => f.replace(/\\/g, "/")));
  const reads = new Map<string, string>();
  const spent0 = deps.budget.spentUsd;
  const modelName = deps.model.provider === "openai" ? (deps.model.model ?? "openai") : deps.model.provider;
  let feedback = "";
  let ozet = "";
  let readRounds = 0;
  let turn = 0;
  const result = (gecti: boolean, dosyalar: readonly string[], neden?: string): WriterResult => ({ gecti, turlar: turn, dosyalar, ozet, ...(neden ? { neden: neden.slice(-1_500) } : {}), maliyetUsd: Math.round((deps.budget.spentUsd - spent0) * 1e6) / 1e6, model: modelName });
  for (turn = 1; turn <= maxTurns; turn++) {
    const stop = await deps.stop?.();
    if (stop) return { ...result(false, await deps.changed(), `durdu: ${stop}`), turlar: turn - 1, durdu: stop };
    const changedNow = await deps.changed();
    const picked = [...new Set([...changedNow.filter((f) => !korunan.has(f)), ...task.dosyalar.map((f) => f.replace(/\\/g, "/"))])].slice(0, FILES_SHOWN);
    // Untouched files before the ones it edited: the prompt's head then repeats round to round (OpenAI's prompt cache).
    const edited = new Set(changedNow);
    const show = [...picked.filter((f) => !edited.has(f)), ...picked.filter((f) => edited.has(f))];
    // Its own edits: shown as a diff, and the declarations they touched join the focus of a long file's view.
    const ownDiff = changedNow.length && deps.diff ? await deps.diff() : "";
    const focus = [...new Set([...task.semboller, ...parseDiff(ownDiff).flatMap((f) => f.satirSembolleri)])];
    const views: string[] = [];
    for (const rel of show) {
      const full = readablePath(deps.dir, rel);
      views.push(full && existsSync(full) ? fileView(rel, await fs.readFile(full, "utf8"), focus) : `=== ${rel}: henüz yok (yeni dosya olabilir)`);
    }
    const canRead = readRounds < maxReads && turn < maxTurns;
    let answer: WriterAnswer;
    try {
      const out = await deps.budget.generate("cirak-yaz", deps.model, writerPrompt(task, views, [...reads.values()], feedback, canRead, ownDiff), { maxTokens: 8_000 });
      answer = parseWriterAnswer(out.result.content);
    } catch (e) {
      return result(false, changedNow, `model çağrısı yapılamadı: ${(e as Error).message.slice(0, 300)}`);
    }
    if (answer.ozet) ozet = answer.ozet;
    if (answer.oku.length && !answer.duzenlemeler.length && canRead) {
      readRounds++;
      for (const r of answer.oku.slice(0, 6)) reads.set(r, (await readRequest(deps.dir, deps.repoRoot, r)).slice(0, READ_CHARS));
      deps.log(`  çırak: ${answer.oku.slice(0, 6).join(", ")} okunuyor (tur ${turn})`);
      feedback = "";
      continue;
    }
    if (!answer.duzenlemeler.length) {
      feedback = "Cevabında hiç DOSYA / <<<<<<< ARA / ======= / >>>>>>> YERINE bloğu yoktu. Değişikliği bu bloklarla yaz.";
      continue;
    }
    const refused: string[] = [];
    for (const e of answer.duzenlemeler) {
      const rel = e.dosya.replace(/\\/g, "/");
      if (korunan.has(rel)) {
        refused.push(`${rel} sınavın testi; değiştirilemez — kodu teste uydur`);
        continue;
      }
      if (forbiddenChanges([rel]).length) {
        refused.push(`${rel} izin dışı; yalnız V3 dosyaları değişir`);
        continue;
      }
      const full = readablePath(deps.dir, rel);
      if (!full) {
        refused.push(`${rel} geçersiz yol`);
        continue;
      }
      const r = applyEdit(existsSync(full) ? await fs.readFile(full, "utf8") : undefined, { ...e, dosya: rel });
      if (!r.ok) {
        refused.push(r.neden);
        continue;
      }
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, r.icerik);
    }
    const changed = (await deps.changed()).filter((f) => !korunan.has(f));
    if (task.testZorunlu && changed.length && !changed.some(isV3Smoke)) refused.push("Değişikliği kanıtlayan bir scripts/smoke-v3-*.ts senaryosu eklemedin.");
    if (!changed.length) {
      feedback = refused.length ? refused.join("\n") : "Hiçbir dosya değişmedi.";
      continue;
    }
    const c = await deps.check(changed);
    deps.log(`  çırak: tur ${turn} — ${changed.length} dosya, ${refused.length} reddedilen düzenleme, kontroller ${c.ok ? "geçti" : "geçmedi"}`);
    if (c.ok && !refused.length) return result(true, changed);
    feedback = [...(refused.length ? [`UYGULANAMAYAN DÜZENLEMELER:\n${refused.join("\n")}`] : []), ...(c.ok ? ["Kontroller geçti; yalnız yukarıdakileri düzelt."] : [`KONTROLLER GEÇMEDİ:\n${tail(c.cikti, FEEDBACK_CHARS)}`])].join("\n\n");
  }
  turn = maxTurns;
  return result(false, (await deps.changed()).filter((f) => !korunan.has(f)), feedback || "tur hakkı bitti");
}

/** The paths `git status --porcelain -uall` lists (a rename as its new path), forward slashes. */
export async function sandboxChanges(dir: string): Promise<string[]> {
  const r = await runProcess("git", ["-c", "core.quotepath=false", "status", "--porcelain", "-uall"], { cwd: dir });
  return r.stdout.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.slice(3).replace(/^.* -> /, "").replace(/^"|"$/g, "").replace(/\\/g, "/"));
}

/**
 * The sandbox's changes as one diff, new files included (they are staged as intent-to-add, so `git diff` shows them;
 * the sandbox is thrown away or committed whole later), leaving out `exclude` (an exam's own tests).
 */
export async function sandboxDiff(dir: string, exclude: readonly string[] = []): Promise<string> {
  await runProcess("git", ["add", "-N", "--", "."], { cwd: dir });
  const r = await runProcess("git", ["-c", "core.quotepath=false", "diff", "--no-color", "-U2", "--", ".", ...exclude.map((f) => `:!${f}`)], { cwd: dir });
  return r.stdout;
}

/**
 * The checks for a sandbox's changed files: the type check, the Remotion package's own when its files changed, and the
 * given smoke suites plus every V3 suite that changed. Each command must exit 0; the output of the failing one comes back.
 */
export function writerChecks(dir: string, changed: readonly string[], suites: readonly string[] = []): string[][] {
  const node = process.execPath;
  const tsx = path.join("node_modules", "tsx", "dist", "cli.mjs");
  const cmds = [[node, path.join("node_modules", "typescript", "bin", "tsc"), "--noEmit"]];
  if (changed.some((f) => f.startsWith("remotion-v3/")) && existsSync(path.join(dir, "remotion-v3", "node_modules", "typescript"))) cmds.push([node, path.join("remotion-v3", "node_modules", "typescript", "bin", "tsc"), "--noEmit", "-p", "remotion-v3"]);
  for (const s of [...new Set([...suites, ...changed.filter(isV3Smoke)])]) cmds.push([node, tsx, s]);
  return cmds;
}

export async function runChecks(dir: string, cmds: readonly (readonly string[])[], timeoutMs = 6 * 60_000): Promise<{ ok: boolean; cikti: string }> {
  for (const c of cmds) {
    const r = await runProcess(c[0]!, c.slice(1), { cwd: dir, timeoutMs });
    if (r.code !== 0) return { ok: false, cikti: `$ ${c.slice(1).join(" ")} (çıkış ${r.code})\n${tail(`${r.stdout}\n${r.stderr}`.trim(), FEEDBACK_CHARS)}` };
  }
  return { ok: true, cikti: `${cmds.length} kontrol geçti` };
}
