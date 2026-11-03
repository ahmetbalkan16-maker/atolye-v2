import { BRAIN_NAMES } from "./Council";
import type { DevProposal } from "./SelfImprovement";

/**
 * The development queue (owner, 3 Nov 2026: "iş kuyruğuna gitsin ve geliştirmeyi kendisi ya da AYAS yapsın"): an
 * approved proposal waits here until the studio's developer builds it. The developer works only while no order runs,
 * in a git worktree of its own, never on the live tree; a build is kept only when the type check, every V3 smoke and the
 * lint pass and it touched only the V3 studio's own files. A kept build is committed on its own local branch and waits
 * "hazir" for the owner (or a development session) to apply it; nothing here pushes or goes live.
 */

/** What the developer did with one proposal. */
export interface DevJob {
  /** Attempts so far (a failed build is tried once more after a day). */
  readonly deneme: number;
  readonly baslangic: string;
  readonly bitis?: string;
  /** The local branch holding a kept build. */
  readonly dal?: string;
  /** The developer's own summary of what it changed. */
  readonly ozet?: string;
  readonly dosyalar?: readonly string[];
  /** Why a build was not kept. */
  readonly sorunlar?: readonly string[];
  /** Where the agent's transcript and the checks' output are kept. */
  readonly kayit?: string;
}

export const MAX_DEV_TRIES = 2;
const RETRY_AFTER_MS = 24 * 3_600_000;

/** The next proposal to build: the earliest approved one, else a failed one that may be tried again. */
export function nextJob(proposals: readonly DevProposal[], now = Date.now()): DevProposal | undefined {
  const approved = proposals.filter((p) => p.durum === "onaylandi").sort((a, b) => (a.karar?.tarih ?? a.tarih).localeCompare(b.karar?.tarih ?? b.tarih));
  if (approved[0]) return approved[0];
  return proposals.find((p) => p.durum === "yapilamadi" && (p.is?.deneme ?? 0) < MAX_DEV_TRIES && now - Date.parse(p.is?.bitis ?? p.tarih) >= RETRY_AFTER_MS);
}

/** The files a build may change: the V3 studio's own code, tests, content and notes. */
const ALLOWED = [/^src\/lib\/v3\//, /^scripts\/v3\//, /^scripts\/smoke-v3-[\w-]+\.ts$/, /^remotion-v3\/src\//, /^content\/v3\//, /^docs\/v3\//];

/** Changed files outside the allowed area (dependencies, secrets, AYAS, the live app, git config…). */
export function forbiddenChanges(files: readonly string[]): string[] {
  return files.map((f) => f.replace(/\\/g, "/")).filter((f) => !ALLOWED.some((re) => re.test(f)));
}

/**
 * Whether the developer may work now: switched on (`ATOLYE_V3_GELISTIRICI=1`) and inside its hours — by default 1–7 at
 * night, so its Claude use does not eat into the owner's own sessions (`ATOLYE_V3_GELISTIRICI_SAAT="1-7"`).
 */
export function developerWindow(env: Readonly<Record<string, string | undefined>>, now = new Date()): { acik: boolean; neden: string } {
  if (env.ATOLYE_V3_GELISTIRICI !== "1") return { acik: false, neden: "geliştirici kapalı (ATOLYE_V3_GELISTIRICI=1 ile açılır)" };
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(env.ATOLYE_V3_GELISTIRICI_SAAT?.trim() || "1-7");
  const [from, to] = m ? [Number(m[1]), Number(m[2])] : [1, 7];
  const h = now.getHours();
  const inside = from <= to ? h >= from && h < to : h >= from || h < to;
  return inside ? { acik: true, neden: `çalışma saatleri ${from}–${to}` } : { acik: false, neden: `çalışma saatleri dışında (${from}–${to})` };
}

/** The rules the unattended developer works under, added to its own system prompt. */
export const DEVELOPER_RULES = `You are the Atölye V3 studio's unattended developer, running in a sandbox git worktree with no one watching.
- Do NOT run git and do not commit, push, pull or switch branches; the studio commits your work itself after its checks.
- Ignore the session start and end steps of AGENTS.md (git pull, commit/push, checkpoint, Graphify): they are not yours.
- Change only the V3 studio: src/lib/v3/, scripts/v3/, scripts/smoke-v3-*.ts, remotion-v3/src/, content/v3/, docs/v3/. Never
  package.json, lock files, .env files, src/lib/ayas/, app/ or anything outside these; a change there throws the build away.
- Follow CLAUDE.md's code conventions (match the surrounding code, its comment density and naming; Turkish log text,
  English code comments). Keep the change small and backward compatible; never break a working feature.
- Prove it: add or extend a scenario in the matching scripts/smoke-v3-*.ts, run \`npx tsc --noEmit\` and the smoke suites you
  touched until they pass.
- End with a short summary in Turkish: what you changed, in which files, and how you tested it.`;

/** The task for one proposal: what the brains asked for, why, and from which productions. */
export function taskPacket(p: Pick<DevProposal, "id" | "beyin" | "baslik" | "neden" | "kaynaklar" | "kaynakTuru" | "karar">, previous?: Pick<DevJob, "sorunlar">): string {
  return `ATÖLYE V3 GELİŞTİRME İŞİ ${p.id}
The owner approved this development proposal of the ${BRAIN_NAMES[p.beyin] ?? p.beyin} (${p.kaynakTuru === "olcum" ? "a fault the brains measured" : "an idea the brains raised"}):
TITLE: ${p.baslik}
WHY: ${p.neden}
RAISED BY THE PRODUCTIONS: ${p.kaynaklar.join(", ") || "—"}${p.karar?.not ? `\nOWNER'S NOTE: ${p.karar.not}` : ""}${
    previous?.sorunlar?.length ? `\nTHE LAST ATTEMPT WAS THROWN AWAY BECAUSE: ${previous.sorunlar.join(" | ")}` : ""
  }

First find out whether the studio already does this (search src/lib/v3 and scripts/v3; read docs/v3/FAZ_RAPORLARI.md): if it
does, change nothing and say so in your summary. Otherwise build the smallest change that does what the proposal asks,
inside the existing modules, with its smoke scenario.`;
}
