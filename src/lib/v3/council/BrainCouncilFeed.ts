import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { listOrders, PRODUCTION_STEPS, type ProductionOrder, type ProductionStep, STEP_NAMES } from "../orders/ProductionOrders";
import { type BrainId, BRAIN_NAMES } from "./Council";
import { recentTalk } from "./DevBrain";
import { type CycleTask, improvementDir, listCycles, TASK_NAMES } from "./SelfImprovement";

/**
 * The brains' council as AYAS's homepage shows it (owner, 3 Nov 2026: "yardımcı beyinler AYAS'ın ana ekranında
 * gözüksün; kendi aralarında konuşacak, geliştirecek, tartışacak; bir video yapılırken iş bölümü yapacak"). Every brain
 * with what it is doing now — a production's step decides who works (the division of labour), the idle loop's task and
 * the evening's build decide the rest — and the brains' latest words, all read from the records they really write: the
 * running production's log, the debates of its report, the director's council, the idle loop's results and the developer
 * brain's own notes. Nothing is made up: a brain with no record says so. Read-only; the live server loads it.
 */
export type CouncilMember = BrainId | "gelistirici";

export const MEMBER_NAMES: Readonly<Record<CouncilMember, string>> = { ...BRAIN_NAMES, gelistirici: "Geliştirici beyni" };

/** The homepage's order of the brains: AYAS first, then the production's brains, the developer last. */
export const COUNCIL_ORDER: readonly CouncilMember[] = ["sef", "arastirma", "kurgu", "mizah", "kostum", "ortam", "ses", "kalite", "onarim", "gelistirici"];

/** Who works in each production step. */
export const STEP_BRAINS: Readonly<Record<ProductionStep, readonly CouncilMember[]>> = {
  senaryo: ["arastirma", "kurgu", "mizah"],
  gardirop: ["kostum"],
  ses: ["ses"],
  senkron: ["ses"],
  gorsel: ["ortam"],
  render: ["sef"],
  kapak: ["ortam"],
  miks: ["ses"],
  birlestir: ["kalite"],
};

/** Who does each task of the idle loop. */
export const TASK_BRAIN: Readonly<Record<CycleTask, CouncilMember>> = {
  istekler: "arastirma",
  karsilastir: "kurgu",
  oneriler: "sef",
  benzer: "arastirma",
  pekistir: "arastirma",
  sinav: "kalite",
  ayar: "kalite",
  ogren: "gelistirici",
  arastir: "gelistirici",
  gelistir: "gelistirici",
};

export interface CouncilLine {
  readonly tarih: string;
  readonly kim: CouncilMember;
  /** The role inside the brain's own debate ("Tarihçi", "Şef"), when the record names one. */
  readonly rol?: string;
  readonly kime?: string;
  readonly metin: string;
}

export interface CouncilMemberView {
  readonly id: CouncilMember;
  readonly ad: string;
  readonly durum: "calisiyor" | "bekliyor";
  /** What it does now, or its last recorded work. */
  readonly is: string;
  readonly son?: string;
}

export interface BrainCouncilView {
  readonly beyinler: readonly CouncilMemberView[];
  /** Newest first. */
  readonly akis: readonly CouncilLine[];
  /** The running production in a line, when one runs. */
  readonly uretim?: string;
}

const SKIP = /^(GPU \d|sağlık:|render \d|Ollama |CLIP |ekran kartında|beyinlerin hafızası|final:|Shorts:|kurul raporu:|.*hazır \((cuda|cpu))/;

/**
 * Which brain a production log line belongs to (undefined: not a brain's words — progress counters, the PC's health).
 * A finished step is AYAS's (the director moves the production on).
 */
export function logLineBrain(raw: string): { kim: CouncilMember; metin: string } | undefined {
  const line = raw.trim();
  if (!line || SKIP.test(line)) return undefined;
  const step = /^✓ ([a-z]+) \((\d+) sn\)$/.exec(line);
  if (step) return PRODUCTION_STEPS.includes(step[1] as ProductionStep) ? { kim: "sef", metin: `${STEP_NAMES[step[1] as ProductionStep]} bitti (${step[2]} sn)` } : undefined;
  const failed = /^ADIM ([a-z]+) başarısız: (.+)$/.exec(line);
  if (failed) return { kim: "sef", metin: `${STEP_NAMES[failed[1] as ProductionStep] ?? failed[1]} adımı durdu: ${failed[2]}` };
  const rules: readonly [RegExp, CouncilMember][] = [
    [/^⚕ onarım beyni/, "onarim"],
    [/^↺ rötuş|^kurul|AYAS \d/, "sef"],
    [/^kapak /, "ortam"],
    [/portre|^benzerlik:|^gardırop:|kostüm/i, "kostum"],
    [/dönem görseli|DÖNEME AİT|tasarım · konu|konu fotoğrafı|^[·✓✗] konu \d+\/10/, "ortam"],
    [/^(müzik|ses üretildi|ses temizliği|ses:|seslendirme)/, "ses"],
    [/^kalite (beyni|ölçümü)|^- \[[x ]\] /, "kalite"],
    [/^araştırma:/, "arastirma"],
    [/^senaryo:|^yazar/, "kurgu"],
    [/mizah|şaka/i, "mizah"],
  ];
  const hit = rules.find(([re]) => re.test(line));
  return hit ? { kim: hit[1], metin: line.replace(/^[⚕↺]\s*/, "").replace(/^- \[x\] /, "✓ ").replace(/^- \[ \] /, "✗ ").slice(0, 220) } : undefined;
}

/** The step a running production is in (the one after its last finished step). */
export function currentStep(log: string): ProductionStep {
  let last = -1;
  for (const m of log.matchAll(/^✓ ([a-z]+) \(/gm)) last = Math.max(last, PRODUCTION_STEPS.indexOf(m[1] as ProductionStep));
  return PRODUCTION_STEPS[Math.min(last + 1, PRODUCTION_STEPS.length - 1)]!;
}

/** Whether the process holding a lock file is alive. */
async function lockAlive(file: string): Promise<boolean> {
  if (!existsSync(file)) return false;
  const pid = Number((await fs.readFile(file, "utf8")).trim());
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** The lines of a list that share one time, kept in their order (a millisecond apart). */
const stamped = (iso: string, n: number, i: number) => new Date(Date.parse(iso) - (n - i)).toISOString();

/** The latest delivered production's own debates (yapim-raporu.json: a brain's specialists and its chief). */
async function reportDebates(workRoot: string, orders: readonly ProductionOrder[]): Promise<CouncilLine[]> {
  const latest = orders.filter((o) => o.cikti && o.bitis && existsSync(path.join(o.cikti, "yapim-raporu.json"))).sort((a, b) => b.bitis!.localeCompare(a.bitis!))[0];
  if (!latest) return [];
  const report = await readJson<{ tarih?: string; tartismalar?: { beyin?: string; konu?: string; kayit?: { rol?: string; metin?: string }[] }[] }>(path.join(latest.cikti!, "yapim-raporu.json"));
  const tarih = report?.tarih ?? latest.bitis!;
  const lines = (report?.tartismalar ?? []).slice(-4).flatMap((d) =>
    (d.kayit ?? []).slice(0, 3).flatMap((k): CouncilLine[] => (typeof k.metin === "string" && k.metin.trim() && d.beyin && d.beyin in MEMBER_NAMES ? [{ tarih, kim: d.beyin as CouncilMember, ...(k.rol ? { rol: k.rol } : {}), metin: `${d.konu ? `${d.konu}: ` : ""}${k.metin.replace(/\s+/g, " ").trim()}`.slice(0, 260) }] : [])),
  );
  return lines.map((l, i) => ({ ...l, tarih: stamped(tarih, lines.length, i) }));
}

/** What the director's council said (BrainsReport reads it; given here so the session is read once). */
export interface CouncilSummary {
  readonly tarih?: string;
  readonly beyinler: readonly { readonly ad: string; readonly puan: number; readonly notlar: readonly string[] }[];
  readonly itirazlar: readonly string[];
  readonly ayas: string;
}

const memberByName = (ad: string) => COUNCIL_ORDER.find((m) => MEMBER_NAMES[m] === ad);

function councilLines(k: CouncilSummary | undefined): CouncilLine[] {
  if (!k?.tarih) return [];
  const lines: Omit<CouncilLine, "tarih">[] = [];
  for (const b of k.beyinler) {
    const kim = memberByName(b.ad);
    if (kim) lines.push({ kim, kime: "AYAS", metin: `${b.puan}/10${b.notlar[0] ? ` — ${b.notlar[0]}` : ""}` });
  }
  for (const x of k.itirazlar.slice(0, 3)) {
    const m = /^(.+?) \((.+?)\): (.+)$/.exec(x);
    const kim = m ? memberByName(m[1]!) : undefined;
    if (kim) lines.push({ kim, metin: `itiraz (${m![2]}): ${m![3]}` });
  }
  if (k.ayas) lines.push({ kim: "sef", metin: k.ayas });
  return lines.map((l, i) => ({ ...l, metin: l.metin.slice(0, 260), tarih: stamped(k.tarih!, lines.length, i) }));
}

/** The council: who works now and the latest words. Never throws; a store it cannot read adds nothing. */
export async function loadBrainCouncil(workRoot: string, kurul?: CouncilSummary, now = new Date()): Promise<BrainCouncilView> {
  const orders = (await listOrders(workRoot).catch(() => [])).map((x) => x.order);
  const working = new Map<CouncilMember, string>();
  const lines: CouncilLine[] = [];
  let uretim: string | undefined;
  // A production running: its step's brains work; its log's latest lines are their words.
  const running = orders.find((o) => o.durum === "calisiyor" && o.cikti);
  if (running) {
    const file = path.join(running.cikti!, "uret.log");
    const log = existsSync(file) ? await fs.readFile(file, "utf8").catch(() => "") : "";
    const step = currentStep(log);
    uretim = `"${running.konu}" yapılıyor — ${STEP_NAMES[step]} adımı (${PRODUCTION_STEPS.indexOf(step) + 1}/${PRODUCTION_STEPS.length})`;
    for (const b of STEP_BRAINS[step]) working.set(b, `${STEP_NAMES[step]} adımında`);
    const mtime = existsSync(file) ? (await fs.stat(file)).mtime.toISOString() : now.toISOString();
    const said = log.split(/\r?\n/).slice(-160).flatMap((l) => {
      const hit = logLineBrain(l);
      return hit ? [hit] : [];
    }).slice(-8);
    said.forEach((s, i) => lines.push({ tarih: stamped(mtime, said.length, i), ...s }));
    const repair = said.filter((s) => s.kim === "onarim").at(-1);
    if (repair && said.at(-1) === repair) working.set("onarim", repair.metin.slice(0, 120));
  }
  // The idle loop running: the brain of its current task works.
  const dir = improvementDir(workRoot);
  if (!running && (await lockAlive(path.join(dir, ".dongu.pid")))) {
    const log = await fs.readFile(path.join(dir, "dongu.log"), "utf8").catch(() => "");
    const name = [...log.matchAll(/^• (.+)$/gm)].at(-1)?.[1]?.trim();
    const task = (Object.entries(TASK_NAMES) as [CycleTask, string][]).find(([, n]) => n === name)?.[0];
    if (task) working.set(TASK_BRAIN[task], TASK_NAMES[task]);
  }
  if (await lockAlive(path.join(dir, ".gelistirici.pid"))) working.set("gelistirici", "akşam geliştirmesi: işi Claude ile yapıyor");
  for (const c of (await listCycles(workRoot).catch(() => [])).slice(-3)) {
    for (const t of c.gorevler) if (t.sonuc !== "atlandi" && t.gorev in TASK_BRAIN) lines.push({ tarih: t.bitis, kim: TASK_BRAIN[t.gorev], metin: `${TASK_NAMES[t.gorev]}: ${t.ayrinti}`.slice(0, 260) });
  }
  lines.push(...(await reportDebates(workRoot, orders).catch(() => [])));
  lines.push(...councilLines(kurul));
  for (const t of await recentTalk(workRoot, 8).catch(() => [])) lines.push({ tarih: t.tarih, kim: "gelistirici", ...(t.kime ? { kime: t.kime } : {}), metin: t.metin });
  const newestFirst = (a: CouncilLine, b: CouncilLine) => Date.parse(b.tarih) - Date.parse(a.tarih);
  const dated = lines.filter((l) => !Number.isNaN(Date.parse(l.tarih))).sort(newestFirst);
  const akis = dated.slice(0, 16);
  const beyinler = COUNCIL_ORDER.map((id): CouncilMemberView => {
    const last = dated.find((l) => l.kim === id);
    const doing = working.get(id);
    return { id, ad: MEMBER_NAMES[id], durum: doing ? "calisiyor" : "bekliyor", is: doing ?? (last ? last.metin.slice(0, 120) : "henüz kaydı yok"), ...(last ? { son: last.tarih } : {}) };
  });
  return { beyinler, akis, ...(uretim ? { uretim } : {}) };
}
