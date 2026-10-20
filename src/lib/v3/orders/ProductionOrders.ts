import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

/**
 * Video production orders — the door between AYAS (the manager) and Atölye V3. An order is a JSON file in runtime
 * storage; AYAS writes one when the owner asks for a video, the queue runner (`scripts/v3/yapim.ts izle`, a separate
 * process — the live server never starts a production) makes it and writes the delivery back. Append-only in spirit:
 * an order's file is only ever updated with its own progress.
 */
export type OrderState = "bekliyor" | "calisiyor" | "teslim" | "uyariyla_teslim" | "hata";

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
  const order: ProductionOrder = { id: `${stamp}-${slug(o.konu)}`, konu: o.konu.trim().slice(0, 300), donem: o.donem.trim().slice(0, 120), sure: o.sure ?? "120sn", dil: o.dil ?? "en", ton: o.ton ?? "mizahi", kaynak: o.kaynak ?? "owner", olusturuldu: now.toISOString(), durum: "bekliyor" };
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
