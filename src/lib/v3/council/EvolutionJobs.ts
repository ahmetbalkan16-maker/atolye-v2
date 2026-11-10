import { promises as fs } from "node:fs";
import path from "node:path";
import { type DevProposal, listProposals, proposalDir } from "./SelfImprovement";

/**
 * Failed controlled-evolution cases become main-AYAS development jobs (owner decision 2026-11-10, the code lane's
 * optional follow-up: "başarısız kontrollü evrim vakalarından otomatik ana AYAS işi"). The discovery child measures the
 * registered benchmark at HEAD (`AyasControlledEvolutionLocalGaps`); a failing case group that no owner-reviewed strategy
 * covers can only be reported there (NEEDS_EXPERIMENT_DESIGN). Here such a gap becomes one job in the development queue:
 * the evening developer writes a fix in its own worktree, and the owner's ONAYLA VE UYGULA stays the only way it is
 * applied. Nothing here changes code or starts anything; it reads one status file and writes queue records.
 */

/** One measured gap: a benchmark's dimension with failing cases, as the controlled-evolution status names it. */
export interface EvolutionGap {
  /** `<benchmark>|<dimension>`: one job per gap, whatever HEAD it was measured at. */
  readonly imza: string;
  readonly benchmarkId: string;
  readonly dimension: string;
  readonly count: number;
  readonly head: string;
}

/** A status older than this is not acted on (HEAD has likely moved; the next measurement says again). */
export const EVOLUTION_STATUS_MAX_AGE_H = 48;
/** A closed job's gap is not opened again within this many days (a fix may need a new measurement first). */
export const EVOLUTION_REOPEN_DAYS = 7;
/** At most this many evolution jobs wait at once, so one bad measurement cannot fill the evening. */
export const MAX_OPEN_EVOLUTION_JOBS = 3;

const SOURCE = "kontrollü evrim: ";

/** Where the discovery child writes the controlled-evolution status (`ayasControlledEvolutionStatusFile`). */
export function evolutionStatusFile(repoRoot: string): string {
  return path.join(repoRoot, "data", "brain", "self-improvement", "evolution", "last-cycle.json");
}

/**
 * The gaps a status reports without a strategy: measured (LOCAL_EVALUATOR) opportunities whose Stage 8 outcome is
 * NEEDS_EXPERIMENT_DESIGN, read from their need ("3 INTENT_ACCURACY case(s) of cognitive-quality fail at <head>").
 * A status that is not this shape, has no measurement or is older than EVOLUTION_STATUS_MAX_AGE_H gives none.
 */
export function evolutionGaps(status: unknown, now = Date.now()): EvolutionGap[] {
  if (typeof status !== "object" || status === null) return [];
  const s = status as { at?: unknown; head?: unknown; snapshot?: unknown; opportunities?: unknown };
  const at = typeof s.at === "string" ? Date.parse(s.at) : NaN;
  if (!Number.isFinite(at) || now - at > EVOLUTION_STATUS_MAX_AGE_H * 3_600_000 || !s.snapshot || typeof s.head !== "string" || !Array.isArray(s.opportunities)) return [];
  const out: EvolutionGap[] = [];
  for (const o of s.opportunities as unknown[]) {
    if (typeof o !== "object" || o === null) continue;
    const { origin, stage8, need } = o as { origin?: unknown; stage8?: unknown; need?: unknown };
    if (origin !== "LOCAL_EVALUATOR" || stage8 !== "NEEDS_EXPERIMENT_DESIGN" || typeof need !== "string") continue;
    const m = /^(\d+) ([A-Z][A-Z_]*) case\(s\) of ([\w.-]+) fail\b/.exec(need);
    if (!m) continue;
    const gap = { imza: `${m[3]}|${m[2]}`, benchmarkId: m[3]!, dimension: m[2]!, count: Number(m[1]), head: s.head };
    if (!out.some((g) => g.imza === gap.imza)) out.push(gap);
  }
  return out;
}

/** The gap a queue record was opened for, if it came from controlled evolution. */
export function evolutionSignature(p: Pick<DevProposal, "kaynaklar">): string | undefined {
  return p.kaynaklar.find((k) => k.startsWith(SOURCE))?.slice(SOURCE.length);
}

const OPEN: ReadonlySet<DevProposal["durum"]> = new Set(["bekliyor", "onaylandi", "yapiliyor", "hazir", "yapilamadi"]);

/**
 * The gaps that get a job now: none while a job for the same gap is open or was closed within EVOLUTION_REOPEN_DAYS
 * (built, rejected or merged), and never more than MAX_OPEN_EVOLUTION_JOBS open at once.
 */
export function gapsToOpen(gaps: readonly EvolutionGap[], proposals: readonly DevProposal[], now = Date.now()): EvolutionGap[] {
  const own = proposals.filter((p) => evolutionSignature(p) !== undefined);
  let room = MAX_OPEN_EVOLUTION_JOBS - own.filter((p) => OPEN.has(p.durum)).length;
  const out: EvolutionGap[] = [];
  for (const g of gaps) {
    if (room <= 0) break;
    const same = own.filter((p) => evolutionSignature(p) === g.imza);
    const blocked = same.some((p) => OPEN.has(p.durum) || now - Date.parse(p.is?.bitis ?? p.karar?.tarih ?? p.tarih) < EVOLUTION_REOPEN_DAYS * 86_400_000);
    if (blocked) continue;
    out.push(g);
    room--;
  }
  return out;
}

/** The queue record for a gap: a measured fault of AYAS itself, queued for the developer (the build still needs the owner's click). */
export function evolutionJob(gap: EvolutionGap, id: string, now = new Date()): DevProposal {
  const head = gap.head.slice(0, 12);
  return {
    id,
    tarih: now.toISOString(),
    beyin: "sef",
    baslik: `Kontrollü evrim: ${gap.count} ${gap.dimension} vakası geçmiyor (${gap.benchmarkId})`,
    neden: `Kontrollü evrim ${head} sürümünde ${gap.benchmarkId} benchmark'ını ölçtü: ${gap.dimension} boyutunda ${gap.count} vaka geçmiyor ve bu açığı kapatan owner onaylı bir strateji yok (NEEDS_EXPERIMENT_DESIGN). Benchmark betiği AYAS_DEFAULT_IMPROVEMENT_REGISTRY'de yazılı (src/lib/brain/autonomy/AyasResearchExperimentRegistry.ts); betiği çalıştırıp geçmeyen vakaları gör. AYAS'ın davranışını düzelt ki bu vakalar geçsin, geçen ve held-out vakalar düşmesin; değerlendiriciye, fixture'lara ve eval-pinli suite'lere dokunma. Yapılamıyorsa nedenini yaz.`,
    kaynaklar: [`${SOURCE}${gap.imza}`, `${gap.benchmarkId} @ ${head}`],
    sayi: 1,
    kaynakTuru: "olcum",
    kapsam: "ayas",
    durum: "onaylandi",
    karar: { tarih: now.toISOString(), not: "kontrollü evrimden otomatik açıldı (owner kararı 2026-11-10); uygulama yine owner'ın ONAYLA VE UYGULA tıkıyla" },
  };
}

/**
 * Opens the jobs the current status calls for (the order watcher's evening check). An unreadable status opens none.
 * Each record is written atomically like every queue record.
 */
export async function openEvolutionJobs(workRoot: string, repoRoot: string, now = new Date()): Promise<DevProposal[]> {
  let status: unknown;
  try {
    status = JSON.parse(await fs.readFile(evolutionStatusFile(repoRoot), "utf8"));
  } catch {
    return [];
  }
  const gaps = evolutionGaps(status, now.getTime());
  if (!gaps.length) return [];
  const all = await listProposals(workRoot);
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
  const opened: DevProposal[] = [];
  for (const [i, gap] of gapsToOpen(gaps, all.map((x) => x.proposal), now.getTime()).entries()) {
    const job = evolutionJob(gap, `${stamp}-evrim-${all.length + 1 + i}`, now);
    const file = path.join(proposalDir(workRoot), `${job.id}.json`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(`${file}.tmp`, `${JSON.stringify(job, null, 2)}\n`);
    await fs.rename(`${file}.tmp`, file);
    opened.push(job);
  }
  return opened;
}
