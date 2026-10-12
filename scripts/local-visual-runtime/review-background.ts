import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { isCharacterBackdropPng } from "../../src/lib/character/CharacterSceneRasterizer";

/** Explicit engineering review, after visual inspection; never called by production. */
function main() {
  const [theme, name, confirmation] = process.argv.slice(2);
  if (!["OTTOMAN", "BYZANTINE", "ROMAN", "EGYPTIAN"].includes(theme ?? "") || !name || !new RegExp(`^${theme!.toLowerCase()}-[0-9]+\\.png$`).test(name) || confirmation !== "--engineering-reviewed") throw new Error("LOCAL_BACKDROP_REVIEW_REQUIRED");
  const root = fs.realpathSync.native(process.cwd());
  const runtime = path.join(root, "bin", "ayas-local-visual");
  const candidate = path.join(runtime, "candidates", name);
  const actual = fs.realpathSync.native(candidate);
  if (path.dirname(actual) !== fs.realpathSync.native(path.join(runtime, "candidates"))) throw new Error("LOCAL_BACKDROP_REVIEW_PATH");
  const source = JSON.parse(fs.readFileSync(candidate.replace(/\.png$/, ".json"), "utf8"));
  const guard = JSON.parse(fs.readFileSync(candidate.replace(/\.png$/, ".guard.json"), "utf8"));
  const model = JSON.parse(fs.readFileSync(path.join(runtime, "model-manifest.json"), "utf8"));
  const png = fs.readFileSync(candidate), sha256 = createHash("sha256").update(png).digest("hex");
  if (!isCharacterBackdropPng(png) || sha256 !== source.sha256 || source.theme !== theme || source.kind === "character" || source.offlineInference !== true || source.paidCalls !== 0 || source.modelRevision !== model.revision || guard.result.failed || guard.result.timedOut || guard.result.exitCode !== 0 || guard.paidCalls !== 0) throw new Error("LOCAL_BACKDROP_REVIEW_INTEGRITY");
  const directory = path.join(runtime,"library"); fs.mkdirSync(directory,{recursive:true});
  if (path.dirname(fs.realpathSync.native(directory)) !== fs.realpathSync.native(runtime)) throw new Error("LOCAL_BACKDROP_LIBRARY_PATH");
  const file = path.join(directory, `${theme!.toLowerCase()}.png`), receipt = file.replace(/\.png$/, ".json");
  if (fs.existsSync(file) || fs.existsSync(receipt)) throw new Error("LOCAL_BACKDROP_LIBRARY_EXISTS");
  fs.writeFileSync(file,png,{flag:"wx"});
  try { fs.writeFileSync(receipt,JSON.stringify({schema:1,reviewStatus:"ENGINEERING_ACCEPTED",theme,provider:"sdxl-local",modelRevision:model.revision,sha256,sourceCandidate:name,paidCalls:0,offlineInference:true,ownerQualityAccepted:false},null,2),{flag:"wx"}); }
  catch(error) { fs.unlinkSync(file); throw error; }
  console.log(JSON.stringify({theme,sha256,bytes:png.length,reviewStatus:"ENGINEERING_ACCEPTED"}));
}
main();
