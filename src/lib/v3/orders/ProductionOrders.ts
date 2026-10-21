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
export const DEFAULT_ORDER_LENGTH = "18dk";

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

export function orderDir(workRoot: string): string {
  return path.join(workRoot, "_kutuphane", "siparisler");
}

function slug(text: string): string {
  return text.toLowerCase().replace(/ı/g, "i").normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "siparis";
}

export async function placeOrder(workRoot: string, o: { konu: string; donem: string; sure?: string; dil?: "tr" | "en"; ton?: string; kaynak?: string }, now = new Date()): Promise<ProductionOrder> {
  const dir = orderDir(workRoot);
  await fs.mkdir(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
  const order: ProductionOrder = { id: `${stamp}-${slug(o.konu)}`, konu: o.konu.trim().slice(0, 300), donem: o.donem.trim().slice(0, 120), sure: o.sure ?? DEFAULT_ORDER_LENGTH, dil: o.dil ?? "en", ton: o.ton ?? "mizahi", kaynak: o.kaynak ?? "owner", olusturuldu: now.toISOString(), durum: "bekliyor" };
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
