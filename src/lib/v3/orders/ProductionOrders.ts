import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

/**
 * Video production orders — the door between AYAS (the manager) and Atölye V3. An order is a JSON file in runtime
 * storage; AYAS writes one when the owner asks for a video, the queue runner (`scripts/v3/yapim.ts izle`, a separate
 * process — the live server never starts a production) makes it and writes the delivery back. Append-only in spirit:
 * an order's file is only ever updated with its own progress.
 */
export type OrderState = "bekliyor" | "calisiyor" | "teslim" | "uyariyla_teslim" | "hata";

/** The production steps in order (scripts/atolye-v3.ts runs them; a resumed order starts after the last one done). */
export const PRODUCTION_STEPS = ["senaryo", "gardirop", "ses", "senkron", "gorsel", "render", "kapak", "miks", "birlestir"] as const;
export type ProductionStep = (typeof PRODUCTION_STEPS)[number];

/** A video ordered without a length (owner, 21 Oct 2026: videos are at least 15–20 minutes). */
export const DEFAULT_ORDER_LENGTH = "20dk";

/** How many times an interrupted order is resumed before it is reported as stopped. */
export const MAX_RESUMES = 2;

export interface ProductionOrder {
  readonly id: string;
  readonly konu: string;
  readonly donem: string;
  readonly sure: string;
  readonly dil: "tr" | "en";
  readonly ton: string;
  /** Who placed it: "owner" from the command line, "ayas" from a conversation. */
  readonly kaynak: string;
  /** An episode of a series ("Fatih 06"): its writer is told what the series' earlier episodes told. */
  readonly dizi?: { readonly ad: string; readonly no: number };
  readonly olusturuldu: string;
  durum: OrderState;
  baslangic?: string;
  bitis?: string;
  cikti?: string;
  video?: string;
  ozet?: string;
  /** Times the order was resumed after its production stopped mid-way (PC off, crash). */
  devam?: number;
  /** The step the resumed production starts from. */
  devamAdimi?: ProductionStep;
  /** The retouch round to resume (its plan is rotus-plani.json in the work dir); a resumed order without it forgot it. */
  rotusTuru?: number;
}

/** The step after the last one the production log shows done ("✓ ses (141 sn)"); the first step when none is. */
export function resumeStep(log: string): ProductionStep {
  let last = -1;
  for (const m of log.matchAll(/^✓ ([a-z]+) \(/gm)) last = Math.max(last, PRODUCTION_STEPS.indexOf(m[1] as ProductionStep));
  return PRODUCTION_STEPS[Math.min(last + 1, PRODUCTION_STEPS.length - 1)]!;
}

/**
 * An order a gone watcher left "calisiyor" (the PC was switched off or the production crashed): it waits again and
 * resumes from its last finished step, up to MAX_RESUMES times; then it is reported as stopped. Until 21 Oct 2026 such
 * an order stayed "calisiyor" forever — never made, never reported.
 */
export function recoverInterrupted(order: ProductionOrder, log: string, now = new Date()): void {
  const resumes = order.devam ?? 0;
  if (resumes >= MAX_RESUMES) {
    Object.assign(order, { durum: "hata", bitis: now.toISOString(), ozet: `üretim ${resumes + 1}. kez yarıda kesildi (bilgisayar kapandı ya da süreç çöktü); ayrıntı uret.log` });
    return;
  }
  const step = resumeStep(log);
  Object.assign(order, { durum: "bekliyor", devam: resumes + 1, devamAdimi: step, ozet: `yarıda kesildi; ${step} adımından devam edecek` });
}

/**
 * How the queue runner starts one production: node runs tsx's CLI directly, never through a shell. Until 22 Oct 2026
 * it went through `npx` with `shell: true`, and Windows' shell split every argument at its spaces — the first AYAS
 * order ("Sezar’ın rubicon’u geçmesi") reached the producer as "Sezar’ın" — and would have run `&`, `|` in a topic.
 */
export function productionCommand(repoRoot: string, order: ProductionOrder, out: string, provider: string): { readonly command: string; readonly args: readonly string[] } {
  return {
    command: process.execPath,
    args: [
      path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"),
      path.join(repoRoot, "scripts", "atolye-v3.ts"),
      "uret", "--konu", order.konu, "--donem", order.donem, "--sure", order.sure, "--dil", order.dil, "--ton", order.ton, "--saglayici", provider, "--cikti", out,
      ...(order.dizi ? ["--dizi", order.dizi.ad, "--dizi-no", String(order.dizi.no)] : []),
      ...(order.devamAdimi && order.devamAdimi !== "senaryo" ? ["--from-step", order.devamAdimi] : []),
      ...(order.rotusTuru && order.rotusTuru > 0 ? ["--rotus-turu", String(order.rotusTuru)] : []),
    ],
  };
}

/** The steps in the owner's words, for AYAS's progress answer. */
export const STEP_NAMES: Readonly<Record<ProductionStep, string>> = {
  senaryo: "araştırma ve senaryo",
  gardirop: "kostüm",
  ses: "seslendirme",
  senkron: "dudak senkronu",
  gorsel: "arka planlar",
  render: "çizim (render)",
  kapak: "kapak",
  miks: "müzik ve ses miksi",
  birlestir: "birleştirme",
};

function minutesBetween(from: string | undefined, to: Date): string {
  const ms = from ? to.getTime() - Date.parse(from) : NaN;
  if (!Number.isFinite(ms) || ms < 0) return "";
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m} dk` : `${Math.floor(m / 60)} sa ${m % 60} dk`;
}

/**
 * One order in the owner's words with what its production log shows: the steps done, the one running, the repair
 * brain's last remedy, why it stopped. AYAS reads only the order file and its `uret.log`; nothing is produced here.
 */
export function orderProgress(order: ProductionOrder, log: string, now = new Date()): string {
  const done = [...log.matchAll(/^✓ ([a-z]+) \(/gm)].map((m) => m[1] as ProductionStep).filter((s) => PRODUCTION_STEPS.includes(s));
  const failed = /^ADIM ([a-z]+) başarısız: (.+)$/m.exec(log);
  const repairs = [...log.matchAll(/^⚕ onarım beyni \[([a-z]+), deneme (\d+)\]: (.+)$/gm)];
  const name = (s: string) => STEP_NAMES[s as ProductionStep] ?? s;
  const head = `"${order.konu}" (${order.sure.replace(/dk$/, " dk").replace(/sn$/, " sn")})`;
  if (order.durum === "bekliyor") return `${head} sırada${order.devamAdimi ? `; ${name(order.devamAdimi)} adımından devam edecek` : ""}`;
  if (order.durum === "calisiyor") {
    const current = PRODUCTION_STEPS[Math.min(done.length ? PRODUCTION_STEPS.indexOf(done[done.length - 1]!) + 1 : 0, PRODUCTION_STEPS.length - 1)]!;
    const repair = repairs.at(-1);
    const fixing = repair && repair[1] === current ? `; onarım beyni ${repair[2]}. denemede: ${repair[3]!.slice(0, 160)}` : "";
    return `${head} yapılıyor, ${minutesBetween(order.baslangic, now) || "yeni"} oldu. ${done.length ? `Biten adımlar: ${done.map(name).join(", ")}. ` : ""}Şimdi ${name(current)} adımında (${PRODUCTION_STEPS.indexOf(current) + 1}/${PRODUCTION_STEPS.length})${fixing}`;
  }
  if (order.durum === "hata") {
    const took = minutesBetween(order.baslangic, order.bitis ? new Date(order.bitis) : now);
    const why = (failed ? `${name(failed[1]!)} adımında: ${failed[2]!.slice(0, 200).trim()}` : order.ozet ?? "").replace(/^\p{Ll}/u, (c) => c.toLocaleUpperCase("tr")).replace(/(?<=[^.!?])$/u, ".");
    return `${head} durdu${took ? ` (${took} sonra)` : ""}. ${why}${repairs.length ? ` Onarım beyni ${repairs.length} kez denedi.` : ""}`.trim();
  }
  return `${head} ${order.durum === "uyariyla_teslim" ? "uyarıyla teslim edildi" : "teslim edildi"}${order.video ? `: ${order.video}` : ""}${order.ozet ? `. ${order.ozet.slice(0, 200)}` : ""}`;
}

export function orderDir(workRoot: string): string {
  return path.join(workRoot, "_kutuphane", "siparisler");
}

function slug(text: string): string {
  return text.toLowerCase().replace(/ı/g, "i").normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "siparis";
}

export async function placeOrder(workRoot: string, o: { konu: string; donem: string; sure?: string; dil?: "tr" | "en"; ton?: string; kaynak?: string; dizi?: { ad: string; no: number } }, now = new Date()): Promise<ProductionOrder> {
  const dir = orderDir(workRoot);
  await fs.mkdir(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
  const order: ProductionOrder = { id: `${stamp}-${slug(o.konu)}`, konu: o.konu.trim().slice(0, 300), donem: o.donem.trim().slice(0, 120), sure: o.sure ?? DEFAULT_ORDER_LENGTH, dil: o.dil ?? "en", ton: o.ton ?? "mizahi", kaynak: o.kaynak ?? "owner", ...(o.dizi?.ad.trim() ? { dizi: { ad: o.dizi.ad.trim().slice(0, 40), no: Math.max(1, Math.min(99, Math.round(o.dizi.no))) } } : {}), olusturuldu: now.toISOString(), durum: "bekliyor" };
  const file = path.join(dir, `${order.id}.json`);
  if (existsSync(file)) throw new Error(`V3_ORDER_EXISTS: ${order.id}`);
  await fs.writeFile(file, `${JSON.stringify(order, null, 2)}\n`);
  return order;
}

export async function listOrders(workRoot: string): Promise<{ file: string; order: ProductionOrder }[]> {
  const dir = orderDir(workRoot);
  if (!existsSync(dir)) return [];
  const names = (await fs.readdir(dir)).filter((n) => n.endsWith(".json")).sort();
  const out: { file: string; order: ProductionOrder }[] = [];
  for (const n of names) {
    try {
      out.push({ file: path.join(dir, n), order: JSON.parse(await fs.readFile(path.join(dir, n), "utf8")) as ProductionOrder });
    } catch {
      // A half-written file is skipped this time and read on the next pass.
    }
  }
  return out;
}

export async function saveOrder(file: string, order: ProductionOrder): Promise<void> {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(order, null, 2)}\n`);
  await fs.rename(tmp, file);
}

/** One-line Turkish summary of the orders for AYAS's answer. */
export function ordersSummary(orders: readonly ProductionOrder[]): string {
  if (!orders.length) return "Atölye'de bekleyen ya da yapılan video siparişi yok.";
  const recent = [...orders].sort((a, b) => b.olusturuldu.localeCompare(a.olusturuldu)).slice(0, 4);
  const word: Readonly<Record<OrderState, string>> = { bekliyor: "sırada", calisiyor: "yapılıyor", teslim: "teslim edildi", uyariyla_teslim: "uyarıyla teslim edildi", hata: "durdu" };
  return recent.map((o) => `"${o.konu}" ${word[o.durum]}${o.video && (o.durum === "teslim" || o.durum === "uyariyla_teslim") ? ` (${o.video})` : ""}`).join("; ") + ".";
}
