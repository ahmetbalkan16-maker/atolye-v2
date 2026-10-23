/**
 * Atölye V3 production orders — the door AYAS (the manager) uses: an order is a topic; the queue runner makes the whole
 * video (research → script → costume → voices → faces → settings → render → mix) with every brain and the repair
 * brain, and the quality brain's delivery is written back to the order. Orders live in runtime storage
 * (`<workRoot>/_kutuphane/siparisler/`); the live server only writes them, this separate process makes them.
 *
 *   npx tsx scripts/v3/yapim.ts siparis --konu "…" --donem "…" [--sure 120sn] [--dil en] [--ton mizahi] [--kaynak ayas]
 *        [--dizi "<dizi adı>" --dizi-no <n>]
 *   npx tsx scripts/v3/yapim.ts kuyruk          # makes every waiting order once, one after another
 *   npx tsx scripts/v3/yapim.ts izle            # keeps watching for orders (started at logon, one instance)
 *   npx tsx scripts/v3/yapim.ts durum           # lists orders and their state
 */
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { listOrders, orderDir, ordersSummary, placeOrder, productionCommand, type ProductionOrder, recoverInterrupted, saveOrder } from "../../src/lib/v3/orders/ProductionOrders";
import { resolveV3Paths, type V3Paths } from "../../src/lib/v3/V3Paths";

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
    for (const { order: o } of orders) console.log(`${o.durum.padEnd(16)} ${o.id}  ${o.video ?? ""}${o.ozet ? `\n${" ".repeat(17)}${o.ozet}` : ""}`);
    console.log(ordersSummary(orders.map((x) => x.order)));
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
    for (;;) {
      await runQueue(paths).catch((e: Error) => console.error(`kuyruk hatası: ${e.message}`));
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
  throw new Error("Kullanım: yapim.ts siparis | kuyruk | izle | durum");
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
