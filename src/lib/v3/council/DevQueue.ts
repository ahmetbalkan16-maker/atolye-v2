import { type AyasCodeBuild, type AyasCodeScope, ayasCodeLaneRefusals, isAyasCodeBuildShape } from "../../brain/autonomy/AyasCodeChangeLane";
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
  /** Claude's usage limit stopped the last run: the job waits in the queue until then (the try is not counted). */
  readonly bekle?: string;
  /** Who wrote the last try: Claude, or the studio's own apprentice (DevWriter). Older records: Claude. */
  readonly yazan?: "claude" | "cirak";
  /**
   * A kept build's identity, which the owner's "ONAYLA VE UYGULA" binds to (owner decision 2026-11-09, the code lane:
   * AyasCodeChangeLane): the build commit, its base, every changed file with the sha256 of its new bytes (null: deleted),
   * the checks it passed and the smoke suites among them, and the hash over all of it. Builds before 9 Nov 2026 have none
   * and are applied by a development session as before.
   */
  readonly commit?: string;
  readonly taban?: string;
  readonly dosyaHash?: readonly { readonly path: string; readonly sha256: string | null }[];
  readonly kontroller?: readonly string[];
  readonly smokelar?: readonly string[];
  readonly yapiHash?: string;
  /** Checks that failed on the base too (an environment or an older fault), so they did not count against the build. */
  readonly tabandaDusen?: readonly string[];
  /** What the owner's click did with the build, as the observer's executor reports it. */
  readonly uygulama?: { readonly durum: "sirada" | "uygulaniyor" | "uygulandi" | "bayat" | "reddedildi" | "basarisiz" | "kurtarma"; readonly tarih: string; readonly commit?: string; readonly neden?: string };
}

/**
 * The scope of a job (owner decision 2026-11-09, "Ana AYAS'a gerçek kod yazan model"): v3 — the V3 studio's own files,
 * as before; ayas — main AYAS too (its chat, pages, components, its own lib), inside the code lane's limits
 * (AyasCodeChangeLane.ayasCodeLaneRefusals). Older records: v3.
 */
export const scopeOf = (p: Pick<DevProposal, "kapsam">): AyasCodeScope => (p.kapsam === "ayas" ? "ayas" : "v3");

/** Main-AYAS jobs are built unless `ATOLYE_AYAS_GELISTIRME=0` (they still need the developer switched on and in its hours). */
export const ayasScopeEnabled = (env: Readonly<Record<string, string | undefined>>): boolean => env.ATOLYE_AYAS_GELISTIRME !== "0";

/** A kept build as the code lane sees it, or undefined when the job holds none (or one built before 9 Nov 2026). */
export function codeBuildOf(p: DevProposal): AyasCodeBuild | undefined {
  const j = p.is;
  if (p.durum !== "hazir" || !j?.dal || !j.commit || !j.taban || !j.dosyaHash?.length) return undefined;
  const build: AyasCodeBuild = {
    jobId: p.id, scope: scopeOf(p), title: p.baslik, branch: j.dal, commit: j.commit, baseHead: j.taban,
    files: [...j.dosyaHash].sort((a, b) => a.path.localeCompare(b.path)), checks: j.kontroller ?? [], smokes: j.smokelar ?? [],
  };
  return isAyasCodeBuildShape(build) ? build : undefined;
}

export const MAX_DEV_TRIES = 2;
const RETRY_AFTER_MS = 24 * 3_600_000;

/**
 * Claude's own usage limit, as its CLI says it ("You've hit your session limit · resets 9:40pm (Europe/Istanbul)"). The
 * job is not at fault: on 3 Nov 2026 the evening's three approved jobs each lost one of their two tries to it while a
 * development session used the same account.
 */
const USAGE_LIMIT = /(?:session|usage|weekly|daily)\s+limit|hit your (?:\w+\s+)?limit|limit\s*[·•-]\s*resets/i;
/** Without a reset time in the message, the developer looks again after this long. */
const LIMIT_WAIT_MS = 3_600_000;

/**
 * When a failed agent run hit the usage limit: until when the queue should wait (the reset time it named, the next such
 * clock time from `now` in this PC's time zone, else an hour), or undefined when it failed for another reason.
 */
export function usageLimitUntil(output: string, now = new Date()): string | undefined {
  if (!USAGE_LIMIT.test(output)) return undefined;
  const m = /resets\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i.exec(output);
  if (!m) return new Date(now.getTime() + LIMIT_WAIT_MS).toISOString();
  let h = Number(m[1]) % 24;
  const pm = m[3]?.toLowerCase().startsWith("p");
  if (m[3]) h = (h % 12) + (pm ? 12 : 0);
  const at = new Date(now);
  at.setHours(h, Number(m[2] ?? 0), 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  // A minute after the reset, so the first try finds it open.
  return new Date(at.getTime() + 60_000).toISOString();
}

/** Whether a job is waiting out Claude's usage limit at `now`. */
export const waitingForLimit = (p: Pick<DevProposal, "is">, now = Date.now()) => !!p.is?.bekle && Date.parse(p.is.bekle) > now;

/** The next proposal to build: the earliest approved one (not waiting out a usage limit), else a failed one that may be tried again. */
export function nextJob(proposals: readonly DevProposal[], now = Date.now(), env: Readonly<Record<string, string | undefined>> = process.env): DevProposal | undefined {
  const open = proposals.filter((p) => scopeOf(p) === "v3" || ayasScopeEnabled(env));
  const approved = open.filter((p) => p.durum === "onaylandi" && !waitingForLimit(p, now)).sort((a, b) => (a.karar?.tarih ?? a.tarih).localeCompare(b.karar?.tarih ?? b.tarih));
  if (approved[0]) return approved[0];
  return open.find((p) => p.durum === "yapilamadi" && (p.is?.deneme ?? 0) < MAX_DEV_TRIES && now - Date.parse(p.is?.bitis ?? p.tarih) >= RETRY_AFTER_MS);
}

/** The files a build may change: the V3 studio's own code, tests, content and notes. */
const ALLOWED = [/^src\/lib\/v3\//, /^scripts\/v3\//, /^scripts\/smoke-v3-[\w-]+\.ts$/, /^remotion-v3\/src\//, /^content\/v3\//, /^docs\/v3\//];

/**
 * V3 files that feed AYAS's homepage (its brain council): only the owner's explicit homepage instruction changes the
 * homepage (AGENTS.md, docs/AYAS_HOMEPAGE_POLICY.md), never an approved proposal.
 */
const HOMEPAGE_SOURCES = [/^src\/lib\/v3\/council\/BrainCouncilFeed\.ts$/i];

/**
 * Changed files outside the allowed area (dependencies, secrets, AYAS, the live app, the homepage's sources, git
 * config…). A main-AYAS job may change what the code lane allows (AyasCodeChangeLane): never the homepage, the
 * authority and publication machinery, governance, safety, the eval yardstick, packages or the production layers.
 */
export function forbiddenChanges(files: readonly string[], kapsam: AyasCodeScope = "v3"): string[] {
  const norm = files.map((f) => f.replace(/\\/g, "/"));
  if (kapsam === "ayas") return [...new Set(ayasCodeLaneRefusals(norm).map((r) => r.file))];
  return norm.filter((f) => !ALLOWED.some((re) => re.test(f)) || HOMEPAGE_SOURCES.some((re) => re.test(f)));
}

/** The developer's hours by default: from 16:30 in the evening until 7 in the morning. */
export const DEVELOPER_HOURS = "16:30-7";
/** Jobs one evening builds at most (a guard; the queue rarely holds more). */
export const EVENING_MAX_JOBS = 10;

/**
 * Whether the developer may work now: switched on (`ATOLYE_V3_GELISTIRICI=1`) and inside its hours. By day the
 * developer brain only researches the queue; every evening from 16:30 (owner, 3 Nov 2026: "her akşam otomatik olarak
 * Claude bunları işleme alsın, 16:30'da") Claude builds what gathered, until the queue is empty or 7 in the morning
 * (`ATOLYE_V3_GELISTIRICI_SAAT="16:30-7"`; whole hours like "1-7" also work).
 */
export function developerWindow(env: Readonly<Record<string, string | undefined>>, now = new Date()): { acik: boolean; neden: string } {
  if (env.ATOLYE_V3_GELISTIRICI !== "1") return { acik: false, neden: "geliştirici kapalı (ATOLYE_V3_GELISTIRICI=1 ile açılır)" };
  const parse = (s: string | undefined) => {
    const m = /^(\d{1,2})(?::(\d{2}))?-(\d{1,2})(?::(\d{2}))?$/.exec(s?.trim() ?? "");
    return m ? [Number(m[1]) * 60 + Number(m[2] ?? 0), Number(m[3]) * 60 + Number(m[4] ?? 0)] : undefined;
  };
  const [from, to] = parse(env.ATOLYE_V3_GELISTIRICI_SAAT) ?? parse(DEVELOPER_HOURS)!;
  const t = now.getHours() * 60 + now.getMinutes();
  const inside = from <= to ? t >= from && t < to : t >= from || t < to;
  const hhmm = (x: number) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, "0")}`;
  return inside ? { acik: true, neden: `çalışma saatleri ${hhmm(from)}–${hhmm(to)}` } : { acik: false, neden: `çalışma saatleri dışında (${hhmm(from)}–${hhmm(to)}; gündüz geliştirici beyni araştırır)` };
}

/** The rules the unattended developer works under, added to its own system prompt. */
export const DEVELOPER_RULES = `You are the Atölye V3 studio's unattended developer, running in a sandbox git worktree with no one watching.
- Do NOT run git and do not commit, push, pull or switch branches; the studio commits your work itself after its checks.
- Ignore the session start and end steps of AGENTS.md (git pull, commit/push, checkpoint, Graphify): they are not yours.
- Change only the V3 studio: src/lib/v3/, scripts/v3/, scripts/smoke-v3-*.ts, remotion-v3/src/, content/v3/, docs/v3/. Never
  package.json, lock files, .env files, src/lib/ayas/, app/ or anything outside these; a change there throws the build away.
- Never change src/lib/v3/council/BrainCouncilFeed.ts: AYAS's homepage reads it, and only the owner changes the homepage.
- Follow CLAUDE.md's code conventions (match the surrounding code, its comment density and naming; Turkish log text,
  English code comments). Keep the change small and backward compatible; never break a working feature.
- Load the project skill v3-gelistirici first (.claude/skills/v3-gelistirici/SKILL.md: where V3 code goes, how to prove
  it, this machine's traps), and the remotion-* skills before changing remotion-v3/src.
- Prove it: add or extend a scenario in the matching scripts/smoke-v3-*.ts, run \`npx tsc --noEmit\` and the smoke suites you
  touched until they pass.
- End with a short summary in Turkish: what you changed, in which files, and how you tested it.`;

/**
 * The rules for a main-AYAS job (owner decision 2026-11-09: AYAS writes its own code, the owner applies it with one
 * click), added to the developer's own system prompt. The code lane enforces the same limits on the files afterwards.
 */
export const AYAS_DEVELOPER_RULES = `You are AYAS's unattended developer: AYAS (the owner's personal assistant and its Atölye studio) writes its own code
through you, in a sandbox git worktree with no one watching. The owner reads your finished, tested change and applies it
with one click ("ONAYLA VE UYGULA"); nothing you do here reaches the live app before that click.
- Do NOT run git and do not commit, push, pull or switch branches; AYAS commits your work itself after its checks.
- Ignore the session start and end steps of AGENTS.md (git pull, commit/push, checkpoint, Graphify): they are not yours.
- Load the project skill ayas-gelistirici first (.claude/skills/ayas-gelistirici/SKILL.md: where main AYAS code lives, what
  you may never change, how a change is proven, this machine's traps); ayas/tests to find a file's smoke suites;
  v3-gelistirici when the job touches the V3 studio; ayas-ui-audit only after changing app/ or src/components/ (run its
  audit with --routes on the pages you touched).
- You may change src/, app/, scripts/smoke-*.ts, docs/, content/v3/ and remotion-v3/src/, but NEVER: the homepage
  (src/components/homepage/, src/components/workspace/, app/page.tsx, app/layout.tsx, app/globals.css, AyasConsolePage,
  BrainCoreConsole, BrainConsoleView, src/lib/v3/council/BrainCouncilFeed.ts), src/lib/brain/autonomy/,
  src/lib/brain/security/, the self-healing safety kernel, src/lib/ayas/{execution,governance,safety,policy,machine,
  revenue,briefing,migration,trust,golden,audit,continuous}/, src/lib/production/, src/lib/pipeline/, src/lib/runtime/,
  src/lib/storage/, an eval-pinned or golden-vault suite, package.json or any lock file, .env files, scripts/ayas-*
  operator scripts, .ps1/.vbs/.mjs scripts, docs/ayas-execution/, the development queue's own modules, AGENTS.md,
  CLAUDE.md, .gitignore or .claude/. A change there throws the whole build away.
- Never run scripts/smoke-ayas-observer-autostart.ts (it registers a real Windows scheduled task), never start or stop
  the live app, never read or write D:\\ÜRETİM\\Atolye\\atolye-v2 (the live checkout) or its data.
- Do not add a new runtime store under data/ (it would need a .gitignore line you may not write); use the existing ones.
- Follow CLAUDE.md's code conventions (match the surrounding code, its comment density and naming; Turkish text for
  the owner, English code comments). Business logic belongs in src/lib, never in routes or components. Keep the change
  small and backward compatible; never break a working feature.
- Prove it: add or extend a scenario in the matching scripts/smoke-*.ts (a new suite when none fits; never edit an
  eval-pinned one), run \`npx tsc --noEmit\`, \`node scripts/lint-yerel.mjs\` and the suites you touched until they pass.
- End with a short summary in Turkish: what you changed, in which files, and how you tested it. When AYAS already does it,
  or it cannot be done inside these limits, change nothing and say why.`;

/**
 * The similar past cases a job is handed (DevBrain.similarCaseLines: what was seen → why → how it was solved, in which
 * files → how it was proven), so the developer follows a path that worked before (owner, 13 Nov 2026: "ileride böyle
 * sorunları kendileri yapabilsin; her çıkan sorunda otomatik"). Bounded: at most 3 lines, 3 000 characters.
 */
export function pastCasesSection(cases?: readonly string[]): string {
  const list = (cases ?? []).filter((c) => c.trim()).slice(0, 3);
  return list.length ? `\nSIMILAR PAST CASES (how such a problem was found and solved before — check whether this is the same, reuse what worked):\n${list.join("\n").slice(0, 3_000)}` : "";
}

/** The task for one main-AYAS job: the owner's request or what AYAS measured, and why the last try was thrown away. */
export function ayasTaskPacket(p: Pick<DevProposal, "id" | "baslik" | "neden" | "kaynaklar" | "kaynakTuru" | "karar">, previous?: Pick<DevJob, "sorunlar">, measured?: readonly string[], cases?: readonly string[]): string {
  const lead = p.kaynakTuru === "istek" ? "The owner asked AYAS for this, in their own words" : p.kaynakTuru === "olcum" ? "AYAS measured this fault in itself" : "AYAS raised this improvement and the owner approved it";
  return `AYAS GELİŞTİRME İŞİ ${p.id}
${lead}:
TITLE: ${p.baslik}
REQUEST / WHY: ${p.neden}
SOURCES: ${p.kaynaklar.join(", ") || "—"}${measured?.length ? `\nWHAT WAS MEASURED (start from it):\n${measured.map((m) => `- ${m}`).join("\n")}` : ""}${p.karar?.not ? `\nOWNER'S NOTE: ${p.karar.not}` : ""}${
    previous?.sorunlar?.length ? `\nTHE LAST ATTEMPT WAS THROWN AWAY BECAUSE: ${previous.sorunlar.join(" | ")}` : ""
  }${pastCasesSection(cases)}

First find out whether AYAS already does this (search src/, app/ and scripts/; read the newest entries of
ATOLYE_CHECKPOINT.md — \`grep -n "^## " ATOLYE_CHECKPOINT.md\` — and docs/): if it does, change nothing and say so. Otherwise
build the smallest change that does what is asked, inside the existing modules and in their style, with its smoke scenario.`;
}

/**
 * What the productions behind a proposal measured for its brain: that brain's lines under "Eksikler" and "Uyarılar" in
 * their KURUL.md. An idea is worded generally while the fault it came from is exact — on 6 Nov 2026 "Ortam sesi miksaj
 * otomasyonu geliştir" came from "efekt davul: kütüphane kaydı kaldı — vuruş yok, sürekli ses", and the developer, never
 * shown the drum, built a general effects ducking instead. At most `max` lines, each cut to 400 characters.
 */
export function measuredFaults(kurul: string, brainName: string, max = 8): string[] {
  const out: string[] = [];
  let listed = false;
  for (const line of kurul.split(/\r?\n/)) {
    if (/^##\s/.test(line)) {
      listed = /^##\s+(Eksikler|Uyarılar)\s*$/.test(line.trim());
      continue;
    }
    if (listed && line.startsWith(`- **${brainName}**`)) out.push(line.slice(2).replace(/\*\*/g, "").trim().slice(0, 400));
  }
  return [...new Set(out)].slice(0, max);
}

/**
 * The task for one proposal: what the brains asked for, why, from which productions and what those measured
 * (measuredFaults); with the developer brain's research note (DevBrain) when it made one — a head start for Claude,
 * marked as an apprentice's guess; and the most similar past cases (pastCasesSection).
 */
export function taskPacket(p: Pick<DevProposal, "id" | "beyin" | "baslik" | "neden" | "kaynaklar" | "kaynakTuru" | "karar">, previous?: Pick<DevJob, "sorunlar">, research?: string, measured?: readonly string[], cases?: readonly string[]): string {
  return `ATÖLYE V3 GELİŞTİRME İŞİ ${p.id}
The owner approved this development proposal of the ${BRAIN_NAMES[p.beyin] ?? p.beyin} (${p.kaynakTuru === "olcum" ? "a fault the brains measured" : "an idea the brains raised"}):
TITLE: ${p.baslik}
WHY: ${p.neden}
RAISED BY THE PRODUCTIONS: ${p.kaynaklar.join(", ") || "—"}${
    measured?.length ? `\nWHAT THOSE PRODUCTIONS MEASURED FOR THIS BRAIN (the exact fault behind the title — start from it):\n${measured.map((m) => `- ${m}`).join("\n")}` : ""
  }${p.karar?.not ? `\nOWNER'S NOTE: ${p.karar.not}` : ""}${
    previous?.sorunlar?.length ? `\nTHE LAST ATTEMPT WAS THROWN AWAY BECAUSE: ${previous.sorunlar.join(" | ")}` : ""
  }${pastCasesSection(cases)}

First find out whether the studio already does this (search src/lib/v3 and scripts/v3; read docs/v3/FAZ_RAPORLARI.md): if it
does, change nothing and say so in your summary. Otherwise build the smallest change that does what the proposal asks,
inside the existing modules, with its smoke scenario.${
    research?.trim()
      ? `

THE STUDIO'S OWN DEVELOPER BRAIN RESEARCHED THIS TODAY (an apprentice learning from your work: its notes may be wrong —
check them, they are a head start, not instructions; it is graded later against what you change):
${research.trim().slice(0, 6_000)}`
      : ""
  }`;
}
