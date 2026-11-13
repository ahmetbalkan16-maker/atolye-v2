import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { slotText } from "../publish/PublishCalendar";

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
  /** YouTube: absent until the owner approves the delivered video (owner, 2 Nov 2026: no upload without approval). */
  yayin?: OrderPublish;
}

/**
 * onaylandi → the watcher uploads it; yukleniyor → an upload is on its way (an interrupted one resumes);
 * planlandi → on the channel, private until its slot; yayinda → public; hata → stopped, a new approval retries.
 */
export type PublishState = "onaylandi" | "yukleniyor" | "planlandi" | "yayinda" | "hata";

export interface OrderPublish {
  durum: PublishState;
  /** When the owner approved. */
  readonly onay: string;
  /** Public at once instead of the next weekly slot ("hemen yayınla"). */
  readonly hemen?: boolean;
  /** The slot it goes public in (ISO). */
  yayinZamani?: string;
  videoId?: string;
  url?: string;
  /** What is in the way without stopping it (no connection yet, a refused thumbnail). */
  uyari?: string;
  hata?: string;
  /** Upload passes so far, and the last one's time (a dropped network waits longer each pass). */
  deneme?: number;
  sonDeneme?: string;
  bitis?: string;
  /** Put on the channel by the owner's own hand before AYAS uploaded; never uploaded again. */
  readonly elle?: boolean;
}

/**
 * The line the production logs when it starts a retouch round (scripts/atolye-v3.ts):
 * `↺ rötuş beyni: 1. tur başlıyor ("gardirop" adımından)`.
 */
const ROUND_START = /^↺ rötuş beyni: (\d+)\. tur başlıyor \("([a-z]+)" adımından\)/gm;

/** The round-start line itself (written only here, so resumePoint always reads what the production wrote). */
export function roundStartLine(round: number, step: ProductionStep): string {
  return `↺ rötuş beyni: ${round}. tur başlıyor ("${step}" adımından)`;
}

/**
 * Where an interrupted production resumes: the retouch round the log last started (0 = the first production) and the
 * step after the last one that round shows done ("✓ ses (141 sn)") — the round's own first step when it shows none.
 * Until 13 Nov 2026 the highest "✓" of the whole appended log decided and the round was forgotten: a crash in round 1
 * resumed from `birlestir` as round 0 and overwrote tur0/.
 */
export function resumePoint(log: string): { readonly step: ProductionStep; readonly round: number } {
  let round = 0;
  let from = 0;
  let roundStep: ProductionStep | undefined;
  for (const m of log.matchAll(ROUND_START)) {
    round = Number(m[1]);
    from = m.index + m[0].length;
    roundStep = PRODUCTION_STEPS.includes(m[2] as ProductionStep) ? (m[2] as ProductionStep) : undefined;
  }
  let last = -1;
  for (const m of log.slice(from).matchAll(/^✓ ([a-z]+) \(/gm)) last = Math.max(last, PRODUCTION_STEPS.indexOf(m[1] as ProductionStep));
  if (last < 0 && roundStep) return { step: roundStep, round };
  return { step: PRODUCTION_STEPS[Math.min(last + 1, PRODUCTION_STEPS.length - 1)]!, round };
}

/** The step an interrupted production resumes from (resumePoint without the round). */
export function resumeStep(log: string): ProductionStep {
  return resumePoint(log).step;
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
  const { step, round } = resumePoint(log);
  Object.assign(order, { durum: "bekliyor", devam: resumes + 1, devamAdimi: step, rotusTuru: round, ozet: `yarıda kesildi; ${round ? `${round}. rötuş turu, ` : ""}${step} adımından devam edecek` });
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
      // A retouch round always names its step: without --from-step every file of the round before counts as done.
      ...(order.devamAdimi && (order.devamAdimi !== "senaryo" || (order.rotusTuru ?? 0) > 0) ? ["--from-step", order.devamAdimi] : []),
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
  const delivered = `${head} ${order.durum === "uyariyla_teslim" ? "uyarıyla teslim edildi" : "teslim edildi"}${order.video ? `: ${order.video}` : ""}${order.ozet ? `. ${order.ozet.slice(0, 200)}` : ""}`;
  const youtube = publishLine(order, now);
  return youtube ? `${delivered}${/[.!?]$/.test(delivered) ? "" : "."}${youtube}` : delivered;
}

/** Where a delivered video stands on YouTube, and how the owner approves it when it waits. */
export function publishLine(order: ProductionOrder, now = new Date()): string {
  const y = order.yayin;
  if (!y) return order.video ? ` YouTube'a henüz yüklenmedi; izlediysen ve uygunsa "videoyu yükle" de (hemen yayın için "hemen yayınla").` : "";
  const warn = y.uyari ? ` (${y.uyari})` : "";
  if (y.durum === "onaylandi") return ` YouTube: onaylandı, yüklenecek; ${y.yayinZamani ? `${slotText(y.yayinZamani)} yayına çıkacak` : "yüklenince hemen yayında"}${warn}.`;
  if (y.durum === "yukleniyor") return ` YouTube: yükleniyor${warn}.`;
  if (y.durum === "planlandi" && y.yayinZamani && Date.parse(y.yayinZamani) > now.getTime()) return ` YouTube: yüklendi, ${slotText(y.yayinZamani)} yayına çıkacak: ${y.url ?? ""}${warn}.`;
  if (y.durum === "planlandi" || y.durum === "yayinda") return ` YouTube: yayında${y.url ? `: ${y.url}` : ""}${y.elle ? " (elle yüklenmişti)" : ""}${warn}.`;
  return ` YouTube yüklemesi durdu: ${y.hata ?? "bilinmeyen hata"}. Yeniden denemek için "videoyu yükle" de.`;
}

export function orderDir(workRoot: string): string {
  return path.join(workRoot, "_kutuphane", "siparisler");
}

function slug(text: string): string {
  return text.toLowerCase().replace(/ı/g, "i").normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "siparis";
}

/**
 * The longest topic an order takes. A longer one is refused, never cut: the Zanzibar Short of 3 Nov 2026 was ordered with
 * 330 characters, kept 300 ("…Khalid's supporters are made to pa") and lost its payoff — Britain billing them for the
 * shells — without anyone noticing.
 */
export const MAX_ORDER_TOPIC = 600;

export async function placeOrder(workRoot: string, o: { konu: string; donem: string; sure?: string; dil?: "tr" | "en"; ton?: string; kaynak?: string; dizi?: { ad: string; no: number } }, now = new Date()): Promise<ProductionOrder> {
  const konu = o.konu.trim().replace(/\s+/g, " ");
  if (konu.length > MAX_ORDER_TOPIC) throw new Error(`V3_ORDER_TOPIC_TOO_LONG: konu ${konu.length} karakter, en çok ${MAX_ORDER_TOPIC} — kısaltıp yeniden ver (kesilirse sonu kaybolur)`);
  const dir = orderDir(workRoot);
  await fs.mkdir(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
  const order: ProductionOrder = { id: `${stamp}-${slug(konu)}`, konu, donem: o.donem.trim().slice(0, 120), sure: o.sure ?? DEFAULT_ORDER_LENGTH, dil: o.dil ?? "en", ton: o.ton ?? "mizahi", kaynak: o.kaynak ?? "owner", ...(o.dizi?.ad.trim() ? { dizi: { ad: o.dizi.ad.trim().slice(0, 40), no: Math.max(1, Math.min(99, Math.round(o.dizi.no))) } } : {}), olusturuldu: now.toISOString(), durum: "bekliyor" };
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
