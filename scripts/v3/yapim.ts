/**
 * Atölye V3 production orders — the door AYAS (the manager) uses: an order is a topic; the queue runner makes the whole
 * video (research → script → costume → voices → faces → settings → render → mix) with every brain and the repair
 * brain, and the quality brain's delivery is written back to the order. Orders live in runtime storage
 * (`<workRoot>/_kutuphane/siparisler/`); the live server only writes them, this separate process makes them.
 *
 *   npx tsx scripts/v3/yapim.ts siparis --konu "…" --donem "…" [--sure 120sn] [--dil en] [--ton mizahi] [--kaynak ayas]
 *        [--dizi "<dizi adı>" --dizi-no <n>]
 *   npx tsx scripts/v3/yapim.ts kuyruk          # makes every waiting order once, one after another
 *   npx tsx scripts/v3/yapim.ts izle            # keeps watching for orders (started at logon, one instance); idle:
 *                                                 the brains' self-improvement cycle (scripts/v3/gelisim.ts), and
 *                                                 from 16:30 the development queue (scripts/v3/gelistirici.ts aksam)
 *   npx tsx scripts/v3/yapim.ts durum           # lists orders and their state
 *   npx tsx scripts/v3/yapim.ts onayla <id> [--hemen]   # the owner's YouTube approval of a delivered video
 *   npx tsx scripts/v3/yapim.ts yayinla         # uploads the approved videos once (`izle` does it every 30 s)
 */
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { developerWindow, nextJob } from "../../src/lib/v3/council/DevQueue";
import { listStudyRequests } from "../../src/lib/v3/council/ReferenceStore";
import { CYCLE_EVERY_H, cycleDue, improvementDir, listCycles, listProposals } from "../../src/lib/v3/council/SelfImprovement";
import { listOrders, orderDir, ordersSummary, placeOrder, productionCommand, type ProductionOrder, publishLine, recoverInterrupted, saveOrder } from "../../src/lib/v3/orders/ProductionOrders";
import { approvePublish } from "../../src/lib/v3/publish/PublishApproval";
import { publishApproved } from "../../src/lib/v3/publish/PublishOrder";
import { youtubeSettings } from "../../src/lib/v3/publish/YoutubeAuth";
import { loadEnvFile, resolveV3Paths, type V3Paths } from "../../src/lib/v3/V3Paths";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function makeOrder(paths: V3Paths, file: string, order: ProductionOrder): Promise<void> {
  const out = path.join(paths.workRoot, "bolumler", order.id);
  await fs.mkdir(out, { recursive: true });
  Object.assign(order, { durum: "calisiyor", baslangic: new Date().toISOString(), cikti: out });
  await saveOrder(file, order);
  console.log(`üretim başladı: ${order.id}`);
  const logFile = createWriteStream(path.join(out, "uret.log"), { flags: "a" });
  const { command, args } = productionCommand(paths.repoRoot, order, out, process.env.ATOLYE_V3_SCRIPT_PROVIDER ?? "openai");
  const code = await new Promise<number>((resolve) => {
    const child = spawn(command, args, { cwd: paths.repoRoot, env: process.env, windowsHide: true });
    child.stdout.pipe(logFile, { end: false });
    child.stderr.pipe(logFile, { end: false });
    child.on("exit", (c) => resolve(c ?? 1));
    child.on("error", () => resolve(1));
  });
  logFile.end();
  const video = path.join(out, "final.mp4");
  const qc = existsSync(path.join(out, "QC.md")) ? await fs.readFile(path.join(out, "QC.md"), "utf8") : "";
  const delivery = /Teslim: (.+)/.exec(qc)?.[1] ?? "";
  Object.assign(order, {
    bitis: new Date().toISOString(),
    durum: code === 0 && existsSync(video) ? (/UYARIYLA/.test(delivery) ? "uyariyla_teslim" : "teslim") : "hata",
    ...(existsSync(video) ? { video } : {}),
    ozet: code === 0 ? delivery || "teslim edildi" : `üretim durdu (çıkış ${code}); ayrıntı uret.log ve yapim-raporu.json`,
  });
  await saveOrder(file, order);
  console.log(`${order.durum}: ${order.id}`);
}

async function runQueue(paths: V3Paths): Promise<number> {
  let made = 0;
  for (const { file, order } of await listOrders(paths.workRoot)) {
    if (order.durum !== "bekliyor") continue;
    await makeOrder(paths, file, order);
    made++;
  }
  return made;
}

/** After a cycle that ended badly, the watcher waits this long before it starts another. */
const CYCLE_RETRY_MS = 30 * 60_000;
let lastCycleFailure = 0;

/**
 * The brains' self-improvement while the studio is idle (owner approval, 2 Nov 2026; scripts/v3/gelisim.ts): a cycle
 * runs as its own process when no order waits or runs, and the pause since the last cycle is over or an owner's video
 * link waits to be studied; it stops at its next task when an order comes in. `ATOLYE_V3_GELISIM=0` turns it off.
 */
async function idleImprovement(paths: V3Paths): Promise<void> {
  if (process.env.ATOLYE_V3_GELISIM === "0" || Date.now() - lastCycleFailure < CYCLE_RETRY_MS) return;
  if ((await listOrders(paths.workRoot)).some((x) => x.order.durum === "bekliyor" || x.order.durum === "calisiyor")) return;
  const requestsWaiting = (await listStudyRequests(paths.workRoot)).some((x) => x.request.durum === "bekliyor");
  const everyH = Number(process.env.ATOLYE_V3_GELISIM_ARALIK_SA) || CYCLE_EVERY_H;
  if (!cycleDue(await listCycles(paths.workRoot), { everyH, requestsWaiting })) return;
  const dir = improvementDir(paths.workRoot);
  await fs.mkdir(dir, { recursive: true });
  const logFile = createWriteStream(path.join(dir, "dongu.log"), { flags: "a" });
  logFile.write(`\n=== ${new Date().toISOString()} gelişim döngüsü${requestsWaiting ? " (video isteği var)" : ""}\n`);
  console.log("gelişim döngüsü başladı");
  const code = await new Promise<number>((resolve) => {
    const child = spawn(process.execPath, [path.join(paths.repoRoot, "node_modules", "tsx", "dist", "cli.mjs"), path.join(paths.repoRoot, "scripts", "v3", "gelisim.ts"), "dongu"], { cwd: paths.repoRoot, env: process.env, windowsHide: true });
    child.stdout.pipe(logFile, { end: false });
    child.stderr.pipe(logFile, { end: false });
    child.on("exit", (c) => resolve(c ?? 1));
    child.on("error", () => resolve(1));
  });
  logFile.end();
  if (code !== 0) lastCycleFailure = Date.now();
  console.log(`gelişim döngüsü bitti (çıkış ${code})`);
}

/** After an evening run the watcher looks at the development queue again this much later at the soonest. */
const EVENING_RECHECK_MS = 10 * 60_000;
let lastEvening = 0;

/**
 * The evening's development (owner, 3 Nov 2026: "her akşam otomatik olarak Claude bunları işleme alsın, 16:30'da"):
 * while the developer is switched on and inside its hours, no order waits or runs and an approved job waits,
 * `gelistirici.ts aksam` builds the queue — the developer brain's research note first, Claude in its own worktree, the
 * studio's checks, then the brain grades itself. The switch is read from `.env.v3.local` each time, so turning it on or
 * off needs no restart.
 */
async function eveningDevelopment(paths: V3Paths): Promise<void> {
  if (Date.now() - lastEvening < EVENING_RECHECK_MS) return;
  const env = { ...loadEnvFile(path.join(paths.repoRoot, ".env.v3.local")), ...process.env };
  if (!developerWindow(env).acik) return;
  if ((await listOrders(paths.workRoot)).some((x) => x.order.durum === "bekliyor" || x.order.durum === "calisiyor")) return;
  if (!nextJob((await listProposals(paths.workRoot)).map((x) => x.proposal))) return;
  lastEvening = Date.now();
  const dir = improvementDir(paths.workRoot);
  await fs.mkdir(dir, { recursive: true });
  const logFile = createWriteStream(path.join(dir, "gelistirici.log"), { flags: "a" });
  logFile.write(`\n=== ${new Date().toISOString()} akşam geliştirmesi\n`);
  console.log("akşam geliştirmesi başladı");
  const code = await new Promise<number>((resolve) => {
    const child = spawn(process.execPath, [path.join(paths.repoRoot, "node_modules", "tsx", "dist", "cli.mjs"), path.join(paths.repoRoot, "scripts", "v3", "gelistirici.ts"), "aksam"], { cwd: paths.repoRoot, env: process.env, windowsHide: true });
    child.stdout.pipe(logFile, { end: false });
    child.stderr.pipe(logFile, { end: false });
    child.on("exit", (c) => resolve(c ?? 1));
    child.on("error", () => resolve(1));
  });
  logFile.end();
  console.log(`akşam geliştirmesi bitti (çıkış ${code})`);
}

/** One watcher at a time: a lock file with our pid; a stale lock (its process gone) is taken over. */
async function takeLock(file: string): Promise<boolean> {
  if (existsSync(file)) {
    const pid = Number((await fs.readFile(file, "utf8")).trim());
    try {
      if (pid) {
        process.kill(pid, 0);
        return false;
      }
    } catch {
      // The process that held the lock is gone.
    }
  }
  await fs.writeFile(file, String(process.pid));
  return true;
}

async function main() {
  const paths = resolveV3Paths();
  await fs.mkdir(orderDir(paths.workRoot), { recursive: true });
  const cmd = process.argv[2];
  if (cmd === "siparis") {
    const konu = arg("--konu");
    const donem = arg("--donem");
    if (!konu || !donem) throw new Error('Kullanım: yapim.ts siparis --konu "…" --donem "…"');
    const order = await placeOrder(paths.workRoot, { konu, donem, ...(arg("--sure") ? { sure: arg("--sure")! } : {}), ...(arg("--dil") ? { dil: arg("--dil") as "tr" | "en" } : {}), ...(arg("--ton") ? { ton: arg("--ton")! } : {}), ...(arg("--dizi") ? { dizi: { ad: arg("--dizi")!, no: Number(arg("--dizi-no") ?? 1) } } : {}), kaynak: arg("--kaynak") ?? "owner" });
    console.log(`sipariş alındı: ${order.id}`);
    return;
  }
  if (cmd === "durum") {
    const orders = await listOrders(paths.workRoot);
    for (const { order: o } of orders) console.log(`${o.durum.padEnd(16)} ${o.id}  ${o.video ?? ""}${o.ozet ? `\n${" ".repeat(17)}${o.ozet}` : ""}${publishLine(o) ? `\n${" ".repeat(16)}${publishLine(o)}` : ""}`);
    console.log(ordersSummary(orders.map((x) => x.order)));
    return;
  }
  if (cmd === "onayla") {
    const id = process.argv[3];
    const all = await listOrders(paths.workRoot);
    const hit = all.find((x) => x.order.id === id);
    if (!hit) throw new Error(`Kullanım: yapim.ts onayla <sipariş id> [--hemen] — "${id ?? ""}" bulunamadı`);
    approvePublish(hit.order, all.map((x) => x.order), process.argv.includes("--hemen"));
    await saveOrder(hit.file, hit.order);
    console.log(`onaylandı: ${hit.order.id}${publishLine(hit.order)}`);
    return;
  }
  if (cmd === "yayinla") {
    console.log(`YouTube'a yüklenen: ${await publishApproved(paths.workRoot, { fetcher: fetch, settings: youtubeSettings(paths.repoRoot), log: console.log })}`);
    return;
  }
  if (cmd === "kuyruk") {
    await runQueue(paths);
    return;
  }
  if (cmd === "izle") {
    const lock = path.join(orderDir(paths.workRoot), ".izleyici.pid");
    if (!(await takeLock(lock))) {
      console.log("izleyici zaten çalışıyor");
      return;
    }
    console.log(`sipariş izleyici başladı (pid ${process.pid}): ${orderDir(paths.workRoot)}`);
    // Holding the one-watcher lock, an order still "calisiyor" was left by a watcher that is gone.
    for (const { file, order } of await listOrders(paths.workRoot)) {
      if (order.durum !== "calisiyor") continue;
      const log = order.cikti && existsSync(path.join(order.cikti, "uret.log")) ? await fs.readFile(path.join(order.cikti, "uret.log"), "utf8") : "";
      recoverInterrupted(order, log);
      await saveOrder(file, order);
      console.log(`yarıda kalan sipariş: ${order.id} → ${order.durum}${order.devamAdimi ? ` (${order.devamAdimi} adımından)` : ""}`);
    }
    // Uploads run beside the productions, so an approved video never waits behind an overnight episode; each loop
    // writes only its own orders (a production's order is never a delivered one).
    const settings = youtubeSettings(paths.repoRoot);
    void (async () => {
      for (;;) {
        await publishApproved(paths.workRoot, { fetcher: fetch, settings, log: console.log }).catch((e: Error) => console.error(`YouTube hatası: ${e.message}`));
        await new Promise((r) => setTimeout(r, 30_000));
      }
    })();
    for (;;) {
      await runQueue(paths).catch((e: Error) => console.error(`kuyruk hatası: ${e.message}`));
      await idleImprovement(paths).catch((e: Error) => console.error(`gelişim döngüsü hatası: ${e.message}`));
      await eveningDevelopment(paths).catch((e: Error) => console.error(`akşam geliştirmesi hatası: ${e.message}`));
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
  throw new Error("Kullanım: yapim.ts siparis | kuyruk | izle | durum | onayla <id> [--hemen] | yayinla");
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
