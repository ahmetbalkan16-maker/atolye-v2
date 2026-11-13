import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { runProcess } from "../util/Proc";
import type { BrainId } from "./Council";
import { AYAS_CODE_PATHS, AYAS_CODE_SCOPE, type DevCase, devBrainDir, listAyasCodeExperience, listCases, MAX_CASE_FIELD, recordAyasCodeExperience, recordCase, recordLesson, say } from "./DevBrain";
import { commitTask, readCodeExperience } from "./DevResearch";
import { hasSimilarLesson, remember } from "./ExperienceMemory";

/**
 * What a Claude session (or any commit) did reaches the brains that need it, without a model and without cost (owner,
 * 12 Nov 2026: "burda yapılan her şeyi gerekli beyinler öğrensin", "otomatikleştir", "maliyetsiz olsun"):
 * - the developer brain learns a commit as soon as it is on the development branch (`learnRefs`), not only once it
 *   went live — its code reading is Git alone, its recipes keep their per-pass count;
 * - main AYAS's changes are read the same way into their own store (`learnAyasCode`), so an AYAS development job is
 *   handed how similar work was done before (`ayasPastChanges`);
 * - a commit's lesson trailers (`Ders-<beyin>[konu]: <English text>`), written by whoever did the work and knows why,
 *   go into that brain's experience memory (`learnCommitLessons`);
 * - its `Vaka` blocks (13 Nov 2026) — or, for a fix commit without one, a case derived from it — go into the brains'
 *   case library with the commit's files (`commitCases`, `derivedCase`; DevBrain.similarCases hands them on).
 * Run by the brains' idle cycle ("ogren"); nothing here changes code or starts a model.
 */

const git = (cwd: string, args: readonly string[]) => runProcess("git", ["-c", "core.quotepath=false", ...args], { cwd, timeoutMs: 120_000 });

/** The development branch the brains learn from besides HEAD (`ATOLYE_V3_OGREN_DALLARI`, comma separated). */
export const DEFAULT_LEARN_BRANCHES = ["feature/cop-adam-v3"] as const;

/** HEAD plus every learn branch that exists in this repository (the worktree's branch lives in the same Git store). */
export async function learnRefs(repoRoot: string, env: Readonly<Record<string, string | undefined>> = process.env): Promise<string[]> {
  const wanted = (env.ATOLYE_V3_OGREN_DALLARI ?? DEFAULT_LEARN_BRANCHES.join(","))
    .split(",")
    .map((b) => b.trim())
    .filter((b) => /^[\w./-]+$/.test(b) && !b.startsWith("-"));
  const refs = ["HEAD"];
  for (const b of wanted) {
    const r = await git(repoRoot, ["rev-parse", "--verify", "--quiet", `${b}^{commit}`]);
    if (r.code === 0) refs.push(b);
  }
  return refs;
}

/**
 * The brains a lesson trailer may teach — those whose lessons some code reads (2026-11-11 survey): kostum (part,
 * likeness designers, by konu), kurgu/arastirma/mizah/kalite (the director council's critics, by konu), gelistirici
 * (the developer brain's written lessons, read by its research and apprentice). `ses` and `sef` lessons are read by no
 * code; `kalite` frame examples need a picture (`kalite-sinavi.ts ogret`), a trailer only reaches its critic.
 */
export const LESSON_BRAINS = ["kurgu", "arastirma", "mizah", "kalite", "kostum", "gelistirici"] as const;
export type LessonBrain = (typeof LESSON_BRAINS)[number];

export interface CommitLesson {
  readonly beyin: LessonBrain;
  readonly konu: string;
  readonly metin: string;
}

/** Longest lesson text (ExperienceMemory cuts at 300 as well). */
export const MAX_LESSON_CHARS = 300;

/** `Ders-kurgu[naval map ships]: Place every ship on water …` lines of a commit message; unknown brains are ignored. */
export function commitLessons(message: string): CommitLesson[] {
  const out: CommitLesson[] = [];
  for (const line of message.split(/\r?\n/)) {
    const m = /^Ders-([a-z]+)(?:\[([^\]]{1,120})\])?:\s*(\S.*)$/.exec(line.trim());
    if (!m || !(LESSON_BRAINS as readonly string[]).includes(m[1]!)) continue;
    const metin = m[3]!.replace(/\s+/g, " ").trim().slice(0, MAX_LESSON_CHARS);
    out.push({ beyin: m[1] as LessonBrain, konu: (m[2] ?? metin).trim().slice(0, 120), metin });
  }
  return out;
}

/** A commit's `Vaka` block before it is recorded (DevBrain.DevCase without id, date, commit and files). */
export type CommitCase = Pick<DevCase, "konu" | "belirti" | "neden" | "cozum" | "kanit" | "yakala" | "beyinler" | "bolum">;

const CASE_FIELDS = { neden: "neden", cozum: "cozum", kanit: "kanit", yakala: "yakala", beyin: "beyinler", bolum: "bolum" } as const;
/** A line that starts something else (a lesson, a case field, a trailer such as Co-Authored-By), never a continuation. */
const OTHER_LINE = /^(Ders-[a-z]+(\[[^\]]*\])?:|Vaka(\[[^\]]*\])?:|Vaka-[a-z]+:|[A-Z][\w-]+:\s)/;

/**
 * The whole cases of a commit message (owner, 13 Nov 2026: every fix reaches the brains as a case, CLAUDE.md's standing
 * order): `Vaka[<konu>]: <symptom>` opens a case; `Vaka-neden:`, `Vaka-cozum:`, `Vaka-kanit:`, `Vaka-yakala:`,
 * `Vaka-beyin: kurgu, kalite` (LESSON_BRAINS; none named: gelistirici) and `Vaka-bolum: <video>` fill the latest one.
 * A line wrapped by an editor continues the field above it; a blank line ends that. Each field is cut at
 * MAX_CASE_FIELD characters; a commit may carry several cases.
 */
export function commitCases(message: string): CommitCase[] {
  type Text = "belirti" | "neden" | "cozum" | "kanit" | "yakala" | "bolum";
  const out: ({ -readonly [K in Text]?: string } & { konu: string; beyinler: string[] })[] = [];
  let last: { c: (typeof out)[number]; k: Text | "beyinler" } | undefined;
  for (const raw of message.split(/\r?\n/)) {
    const line = raw.trim();
    const open = /^Vaka(?:\[([^\]]{1,120})\])?:\s*(\S.*)$/.exec(line);
    const field = /^Vaka-([a-z]+):\s*(.*)$/.exec(line);
    if (open) {
      const c = { konu: (open[1] ?? open[2]!).trim().slice(0, 120), belirti: open[2]!.trim(), beyinler: [] };
      out.push(c);
      last = { c, k: "belirti" };
    } else if (field && out.length && field[1]! in CASE_FIELDS) {
      const c = out[out.length - 1]!;
      const k = CASE_FIELDS[field[1] as keyof typeof CASE_FIELDS];
      if (k === "beyinler") c.beyinler = field[2]!.split(/[\s,]+/).filter((b) => (LESSON_BRAINS as readonly string[]).includes(b));
      else c[k] = field[2]!.trim();
      last = { c, k };
    } else if (!line || OTHER_LINE.test(line)) last = undefined;
    else if (last && last.k !== "beyinler") last.c[last.k] = `${last.c[last.k] ?? ""} ${line}`.trim();
  }
  return out.map((c) => {
    const cut = (s: string | undefined) => s?.replace(/\s+/g, " ").trim().slice(0, MAX_CASE_FIELD) || undefined;
    const x = { konu: c.konu, belirti: cut(c.belirti) ?? c.konu, neden: cut(c.neden), cozum: cut(c.cozum), kanit: cut(c.kanit), yakala: cut(c.yakala), bolum: cut(c.bolum), beyinler: [...new Set(c.beyinler.length ? c.beyinler : ["gelistirici"])] };
    return Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)) as unknown as CommitCase;
  });
}

/**
 * The case a `fix(...)` commit carries without a Vaka block, so a forgotten block still leaves one (owner, 13 Nov 2026:
 * "otomatik"): the subject is what was seen, the body (lessons and trailers left out) how it was solved, the brains its
 * Ders- lines name. Marked derived (`turetilmis`): a session's own case says more. Undefined for anything but a fix.
 */
export function derivedCase(message: string): CommitCase | undefined {
  const [subject = "", ...rest] = message.split(/\r?\n/);
  const m = /^fix(?:\(([^)]{0,40})\))?!?:\s*(\S.*)$/.exec(subject.trim());
  if (!m) return undefined;
  const body = rest.map((l) => l.trim()).filter((l) => l && !OTHER_LINE.test(l)).join(" ");
  const beyinler = [...new Set(commitLessons(message).map((l) => l.beyin as string))];
  const belirti = m[2]!.trim().slice(0, MAX_CASE_FIELD);
  return { konu: `${m[1] ? `${m[1]}: ` : ""}${belirti}`.slice(0, 120), belirti, ...(body ? { cozum: body.slice(0, MAX_CASE_FIELD) } : {}), beyinler: beyinler.length ? beyinler : ["gelistirici"] };
}

const taughtFile = (workRoot: string) => path.join(devBrainDir(workRoot), "aktarilan-dersler.jsonl");

async function taughtCommits(workRoot: string): Promise<Set<string>> {
  const f = taughtFile(workRoot);
  if (!existsSync(f)) return new Set();
  return new Set(
    (await fs.readFile(f, "utf8"))
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [(JSON.parse(l) as { id: string }).id];
        } catch {
          return [];
        }
      }),
  );
}

/** A lesson this close to one the brain already has is not written again. */
export const SAME_LESSON = 0.7;

/**
 * Every not yet taught commit's lesson trailers into the brains' memories, and every commit's cases into the case
 * library; each commit is taught once and its cases recorded once (a commit taught before cases existed still gets its
 * cases: they are told apart by the commit sha in the library, not by the taught list).
 */
export async function learnCommitLessons(d: { readonly repoRoot: string; readonly workRoot: string; readonly refs?: readonly string[]; readonly log?: (s: string) => void }, limit = 400): Promise<{ commit: number; ders: number; vaka: number; ozet: string }> {
  // One Git call: the message, then (after \x1d) the files the commit changed.
  const r = await git(d.repoRoot, ["log", "--no-merges", "--name-only", "-n", String(limit), "--format=%x1e%H%x1f%cI%x1f%B%x1d", ...(d.refs?.length ? d.refs : ["HEAD"])]);
  if (r.code !== 0) return { commit: 0, ders: 0, vaka: 0, ozet: "commit dersleri okunamadı" };
  const done = await taughtCommits(d.workRoot);
  const cased = new Set((await listCases(d.workRoot)).flatMap((c) => (c.commit ? [c.commit] : [])));
  let commit = 0;
  let ders = 0;
  let vaka = 0;
  let turetilen = 0;
  const per: Record<string, number> = {};
  const entries = r.stdout.split("\x1e").map((e) => e.replace(/^\s+/, "")).filter(Boolean).reverse();
  for (const e of entries) {
    const [head = "", files = ""] = e.split("\x1d");
    const [sha, tarih, ...body] = head.split("\x1f");
    if (!sha || !tarih) continue;
    const message = body.join("\x1f");
    if (!cased.has(sha)) {
      const own = commitCases(message);
      const derived = own.length ? undefined : derivedCase(message);
      const dosyalar = [...new Set(files.split(/\r?\n/).map((f) => f.trim().replace(/\\/g, "/")).filter(Boolean))];
      const list: (CommitCase & { readonly id: string; readonly kaynak: DevCase["kaynak"] })[] = derived ? [{ ...derived, id: `${sha}#t`, kaynak: "turetilmis" }] : own.map((c, k) => ({ ...c, id: `${sha}#${k + 1}`, kaynak: "commit" }));
      for (const c of list) await recordCase(d.workRoot, { ...c, tarih, commit: sha, ...(dosyalar.length ? { dosyalar } : {}) });
      if (list.length) cased.add(sha);
      vaka += own.length;
      if (derived) turetilen++;
    }
    if (done.has(sha)) continue;
    const lessons = commitLessons(message);
    if (!lessons.length) continue;
    for (const l of lessons) {
      if (l.beyin === "gelistirici") await recordLesson(d.workRoot, { tarih, id: sha, metin: l.metin });
      else {
        const beyin: BrainId = l.beyin;
        if (await hasSimilarLesson(d.workRoot, beyin, l.metin, SAME_LESSON)) continue;
        await remember(d.workRoot, { bolum: `commit ${sha.slice(0, 10)}`, beyin, tur: "ders", konu: l.konu, metin: l.metin });
      }
      per[l.beyin] = (per[l.beyin] ?? 0) + 1;
      ders++;
    }
    await fs.mkdir(path.dirname(taughtFile(d.workRoot)), { recursive: true });
    await fs.appendFile(taughtFile(d.workRoot), `${JSON.stringify({ id: sha, tarih, dersler: lessons.length })}\n`);
    done.add(sha);
    commit++;
  }
  const vakaOzet = vaka || turetilen ? `vaka kitaplığına ${vaka} vaka${turetilen ? ` + düzeltme commit'lerinden ${turetilen} türetilmiş vaka` : ""} yazıldı` : "";
  if (!commit) {
    if (vakaOzet) await say(d.workRoot, `Commit'lerdeki vakaları kitaplığa yazdım: ${vakaOzet}.`);
    return { commit: 0, ders: 0, vaka: vaka + turetilen, ozet: vakaOzet ? `yeni commit dersi yok; ${vakaOzet}` : "yeni commit dersi yok" };
  }
  const ozet = `${commit} commit'ten ${ders} ders aktarıldı (${Object.entries(per).map(([b, n]) => `${b} ${n}`).join(", ")})${vakaOzet ? `; ${vakaOzet}` : ""}`;
  await say(d.workRoot, `Commit'lerdeki dersleri beyinlere aktardım: ${ozet}.`);
  return { commit, ders, vaka: vaka + turetilen, ozet };
}

/** Main-AYAS commits read per pass (newest first; Git only — the first passes work through the history). */
export const AYAS_CODE_PER_PASS = 30;

/** Main AYAS's new commits as code experience (files, declarations, added code, tests) — Git only, no model. */
export async function learnAyasCode(d: { readonly repoRoot: string; readonly workRoot: string; readonly refs?: readonly string[] }, max = AYAS_CODE_PER_PASS, limit = 400): Promise<{ kod: number; ozet: string }> {
  const r = await git(d.repoRoot, ["log", "--no-merges", "-n", String(limit), "--format=%H%x09%cI%x09%s", ...(d.refs?.length ? d.refs : ["HEAD"]), "--", ...AYAS_CODE_PATHS]);
  if (r.code !== 0) return { kod: 0, ozet: "AYAS commit'leri okunamadı" };
  const known = new Set((await listAyasCodeExperience(d.workRoot)).map((x) => x.id));
  const fresh = r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.split("\t"))
    .filter((x) => x.length >= 3 && !known.has(x[0]!))
    .slice(0, Math.max(0, max));
  let kod = 0;
  for (const [sha, tarih, ...konu] of fresh) {
    const x = await readCodeExperience(d.repoRoot, sha!, { id: sha!, tarih: tarih!, gorev: commitTask(konu.join("\t")) }, AYAS_CODE_SCOPE);
    // Recorded even without code files, so it is read once.
    await recordAyasCodeExperience(d.workRoot, x);
    if (x.dosyalar.length) kod++;
  }
  if (!fresh.length) return { kod: 0, ozet: "yeni AYAS commit'i yok" };
  const ozet = `${fresh.length} AYAS commit'i okundu (${kod} tanesinin kodu)`;
  if (kod) await say(d.workRoot, `Ana AYAS'tan ${kod} değişikliğin kodunu okudum (hangi dosyada hangi fonksiyon, eklenen kod, testi).`);
  return { kod, ozet };
}
