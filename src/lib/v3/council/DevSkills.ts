import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

/**
 * The project's skills for the studio's own developer (owner, 6 Nov 2026: "skilleri entegre et kullansın"): the same
 * SKILL.md guides Claude Code loads from `.claude/skills` — the V3 developer's guide, the test guide, scene direction,
 * the Remotion skills — read from the checkout and put into the apprentice's prompt as guidance, the ones that fit the
 * task. A skill is advice, never an order: it cannot widen what the apprentice may change. Reads files only.
 */
export interface SkillDoc {
  /** `v3-gelistirici`, `ayas/tests`, `remotion-maps`… (its folder under `.claude/skills`). */
  readonly id: string;
  readonly ad: string;
  readonly aciklama: string;
  /** Repo-relative path of the SKILL.md. */
  readonly dosya: string;
  /** The body after the front matter. */
  readonly govde: string;
}

/** Always given: the V3 guide and how this repo proves a change. */
export const BASE_SKILLS = ["v3-gelistirici", "ayas/tests"] as const;
/** Skills chosen per task, beside the base ones. */
export const MAX_TASK_SKILLS = 2;
/** Characters of one skill's body in a prompt. */
export const SKILL_CHARS = 4_000;

/** Front matter and body of a SKILL.md (a file without a name is no skill). */
export function parseSkill(id: string, dosya: string, text: string): SkillDoc | undefined {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return undefined;
  const field = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, "m").exec(m[1]!)?.[1]?.trim().replace(/^["']|["']$/g, "");
  const ad = field("name");
  if (!ad) return undefined;
  return { id, ad, aciklama: field("description") ?? "", dosya, govde: m[2]!.trim() };
}

/** The checkout's skills: `.claude/skills/<name>/SKILL.md` and one level deeper (`.claude/skills/ayas/<name>`). */
export async function listSkills(repoRoot: string): Promise<SkillDoc[]> {
  const root = path.join(repoRoot, ".claude", "skills");
  if (!existsSync(root)) return [];
  const out: SkillDoc[] = [];
  const visit = async (rel: string, depth: number) => {
    const dir = path.join(root, rel);
    const file = path.join(dir, "SKILL.md");
    if (rel && existsSync(file)) {
      const s = parseSkill(rel.replace(/\\/g, "/"), `.claude/skills/${rel.replace(/\\/g, "/")}/SKILL.md`, await fs.readFile(file, "utf8"));
      if (s) out.push(s);
      return;
    }
    if (depth >= 2) return;
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) if (e.isDirectory() || e.isSymbolicLink()) await visit(path.join(rel, e.name), depth + 1);
  };
  await visit("", 0);
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Task signals that call for a skill (Turkish folded and English words, or the files the task is expected to touch). */
const RULES: readonly { readonly id: string; readonly kelime?: RegExp; readonly dosya?: RegExp }[] = [
  { id: "remotion-best-practices", dosya: /^remotion-v3\/src\//, kelime: /remotion|render|frame|kare|interpolat|spring|composition/ },
  { id: "remotion-maps", kelime: /harita|\bmap|rozet|badge|sinir|border|kiyi|coast/, dosya: /MapView|MapUnits|maps\// },
  { id: "remotion-markup", kelime: /animasyon|animation|gecis|transition|efekt|effect|hareket|motion/, dosya: /^remotion-v3\/src\/scene\// },
  { id: "remotion-captions", kelime: /altyazi|caption|subtitle|balon|bubble/ },
  { id: "ayas/scene-direction", kelime: /sahne|scene|jest|gesture|oyun|aksesuar|prop|anlatilan|told|mekan|setting/ },
  { id: "ayas/editorial-animation", kelime: /karakter|character|kukla|puppet|kostum|costume|yuz|face|benzerlik|likeness|cizim|drawn/ },
];

const fold = (s: string) => s.replace(/ı/g, "i").replace(/İ/g, "I").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/**
 * The skills for one task: the base ones, then at most MAX_TASK_SKILLS whose signals the task's words or expected files
 * show (more signals first). A skill that is not installed in the checkout is simply skipped.
 */
export function pickSkills(skills: readonly SkillDoc[], task: string, files: readonly string[] = []): SkillDoc[] {
  const byId = new Map(skills.map((s) => [s.id, s]));
  const words = fold(task);
  const norm = files.map((f) => f.replace(/\\/g, "/"));
  const scored = RULES.map((r) => ({ id: r.id, n: (r.kelime && r.kelime.test(words) ? 1 : 0) + (r.dosya && norm.some((f) => r.dosya!.test(f)) ? 2 : 0) }))
    .filter((x) => x.n > 0 && byId.has(x.id))
    .sort((a, b) => b.n - a.n)
    .slice(0, MAX_TASK_SKILLS);
  return [...BASE_SKILLS.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])), ...scored.map((x) => byId.get(x.id)!)];
}

/** The guides as the prompt shows them: name, path (the apprentice may read the skill's other files), body. */
export function skillsText(list: readonly SkillDoc[], chars = SKILL_CHARS): string {
  return list.map((s) => `--- SKILL ${s.ad} (${s.dosya}): ${s.aciklama}\n${s.govde.length > chars ? `${s.govde.slice(0, chars)}\n… (rest: OKU: ${s.dosya})` : s.govde}`).join("\n\n");
}
