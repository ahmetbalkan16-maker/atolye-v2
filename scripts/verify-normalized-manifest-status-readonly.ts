import { ProjectManager } from "../src/lib/projects/ProjectManager";

/** READ-ONLY: confirms ProjectManager.ensureManifest's normalized status for
 * the real i-stanbul-un-fethi-1453 assembly package. manifest.json already
 * exists, so ensureManifest -> getManifest only reads; it never writes. */
async function main() {
  const manifest = await ProjectManager.ensureManifest("i-stanbul-un-fethi-1453");
  console.log("normalized assembly status:", manifest?.packages.assembly.status);
  console.log("normalized assembly attempts.total:", manifest?.packages.assembly.attempts?.total);
  console.log("normalized assembly completedAt:", manifest?.packages.assembly.completedAt);
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
