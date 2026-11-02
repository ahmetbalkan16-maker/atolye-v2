/**
 * Known vulnerabilities of Atölye's installed npm packages (OSV, the database osv-scanner reads; 2026-11-02):
 *
 *   npx tsx scripts/ayas-dependency-vulnerabilities.ts [--json]
 *
 * Reads package-lock.json and each sub-package's lock (AYAS_UPDATE_WORKSPACES), asks osv.dev for every installed
 * name@version and prints, per lock, the vulnerabilities most severe first. Read-only: it writes no file and changes
 * no package. Sends package names and versions only. Exits 1 when the database cannot be read (never "nothing found").
 */
import fs from "node:fs";
import path from "node:path";

import { listAyasLockPackages, scanAyasLockVulnerabilities, summarizeAyasVulnerabilities } from "../src/lib/brain/autonomy/AyasDependencyVulnerabilities";
import { AYAS_UPDATE_WORKSPACES } from "../src/lib/brain/autonomy/AyasUpdateWorkspaces";

async function main(): Promise<void> {
  const root = process.cwd();
  const locks = [{ name: "kök", file: "package-lock.json" }, ...Object.values(AYAS_UPDATE_WORKSPACES).map((w) => ({ name: w.dir, file: `${w.dir}/package-lock.json` }))]
    .filter((lock) => fs.existsSync(path.join(root, lock.file)));
  const report = [];
  for (const lock of locks) {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, lock.file), "utf8"));
    const found = await scanAyasLockVulnerabilities(parsed);
    report.push({ lock: lock.file, packages: listAyasLockPackages(parsed).length, vulnerabilities: found });
    if (!process.argv.includes("--json")) {
      console.log(`${lock.name} (${lock.file}): ${listAyasLockPackages(parsed).length} paket — ${summarizeAyasVulnerabilities(found)}`);
      const shipped = found.filter((v) => !v.dev);
      console.log(`  uygulamanın kendisinde: ${summarizeAyasVulnerabilities(shipped)}; yalnız geliştirme araçlarında: ${summarizeAyasVulnerabilities(found.filter((v) => v.dev))}`);
      for (const v of found) console.log(`  ${v.severity.padEnd(9)} ${(v.dev ? "geliştirme" : "uygulama").padEnd(10)} ${v.package.padEnd(40)} ${v.id}${v.fixedIn ? ` → ${v.fixedIn}` : ""}  ${v.summary}`);
    }
  }
  if (process.argv.includes("--json")) console.log(JSON.stringify({ checkedAt: new Date().toISOString(), source: "osv.dev", locks: report }));
}

main().catch((error: unknown) => {
  console.error(`Bağımlılık açık denetimi yapılamadı: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
