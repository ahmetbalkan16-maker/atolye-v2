/**
 * Atölye V3 production orders — the door AYAS (the manager) uses: an order is a topic; the queue runner makes the whole
 * video (research → script → costume → voices → faces → settings → render → mix) with every brain and the repair
 * brain, and the quality brain's delivery is written back to the order. Orders and their status are plain JSON in
 * runtime storage (`<workRoot>/_kutuphane/siparisler/`), so AYAS can place one and follow it without new endpoints.
 *
 *   npx tsx scripts/v3/yapim.ts siparis --konu "…" --donem "…" [--sure 120sn] [--dil en] [--ton mizahi] [--kaynak ayas]
 *   npx tsx scripts/v3/yapim.ts kuyruk          # makes every waiting order, one after another
 *   npx tsx scripts/v3/yapim.ts durum           # lists orders and their state
 */
import { spawn } from "node:child_process";
import { existsSync, createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { resolveV3Paths } from "../../src/lib/v3/V3Paths";

interface Order {
  readonly id: string;
  readonly konu: string;
  readonly donem: string;
  readonly sure: string;
  readonly dil: "tr" | "en";
  readonly ton: string;
  readonly kaynak: string;
  readonly olusturuldu: string;
  durum: "bekliyor" | "calisiyor" | "teslim" | "uyariyla_teslim" | "hata";
  baslangic?: string;
  bitis?: string;
  cikti?: string;
  video?: string;
  ozet?: string;
}

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

function slug(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "siparis";
}

async function main() {
  const paths = resolveV3Paths();
  const dir = path.join(paths.workRoot, "_kutuphane", "siparisler");
  await fs.mkdir(dir, { recursive: true });
  const readAll = async (): Promise<{ file: string; order: Order }[]> =>
    Promise.all((await fs.readdir(dir)).filter((n) => n.endsWith(".json")).sort().map(async (n) => ({ file: path.join(dir, n), order: JSON.parse(await fs.readFile(path.join(dir, n), "utf8")) as Order })));
  const save = (file: string, order: Order) => fs.writeFile(file, `${JSON.stringify(order, null, 2)}\n`);
  const cmd = process.argv[2];

  if (cmd === "siparis") {
    const konu = arg("--konu");
    const donem = arg("--donem");
    if (!konu || !donem) throw new Error('Kullanım: yapim.ts siparis --konu "…" --donem "…"');
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
    const order: Order = { id: `${stamp}-${slug(konu)}`, konu, donem, sure: arg("--sure") ?? "120sn", dil: (arg("--dil") ?? "en") as "tr" | "en", ton: arg("--ton") ?? "mizahi", kaynak: arg("--kaynak") ?? "owner", olusturuldu: new Date().toISOString(), durum: "bekliyor" };
    await save(path.join(dir, `${order.id}.json`), order);
    console.log(`sipariş alındı: ${order.id}`);
    return;
  }

  if (cmd === "durum") {
    for (const { order: o } of await readAll()) console.log(`${o.durum.padEnd(16)} ${o.id}  ${o.video ?? ""}${o.ozet ? `\n${" ".repeat(17)}${o.ozet}` : ""}`);
    return;
  }

  if (cmd === "kuyruk") {
    for (const { file, order } of await readAll()) {
      if (order.durum !== "bekliyor") continue;
      const out = path.join(paths.workRoot, "bolumler", order.id);
      await fs.mkdir(out, { recursive: true });
      Object.assign(order, { durum: "calisiyor", baslangic: new Date().toISOString(), cikti: out });
      await save(file, order);
      console.log(`üretim başladı: ${order.id}`);
      const logFile = createWriteStream(path.join(out, "uret.log"), { flags: "a" });
      const args = ["tsx", path.join(paths.repoRoot, "scripts", "atolye-v3.ts"), "uret", "--konu", order.konu, "--donem", order.donem, "--sure", order.sure, "--dil", order.dil, "--ton", order.ton, "--saglayici", process.env.ATOLYE_V3_SCRIPT_PROVIDER ?? "openai", "--cikti", out];
      const code = await new Promise<number>((resolve) => {
        const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", args, { cwd: paths.repoRoot, env: process.env, windowsHide: true, shell: process.platform === "win32" });
        child.stdout.pipe(logFile, { end: false });
        child.stderr.pipe(logFile, { end: false });
        child.on("exit", (c) => resolve(c ?? 1));
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
      await save(file, order);
      console.log(`${order.durum}: ${order.id}`);
    }
    return;
  }
  throw new Error("Kullanım: yapim.ts siparis | kuyruk | durum");
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
