/** Explicit host diagnostic preparation. No production registry or readiness writes. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { isBuiltin } from "node:module";
import ts from "typescript";
import { ayasLocalCodingCandidatePins as pins, verifyAyasLocalCodingArtifact } from "../src/lib/brain/autonomy/AyasLocalCodingPins";
import { AYAS_LOCAL_CODING_QUALIFICATION_VAULT } from "./fixtures/ayas-local-coding-qualification-vault";
import { AYAS_LOCAL_CODING_RETRIEVAL_CASE } from "./fixtures/ayas-local-coding-qualification-retrieval-case";

const repo = process.cwd();
const sha = (b: Buffer): string => crypto.createHash("sha256").update(b).digest("hex");
function ownedRoot(value: string): string {
  const root = fs.realpathSync(value);
  if (path.dirname(root).toLowerCase() !== fs.realpathSync(os.tmpdir()).toLowerCase()
    || !path.basename(root).startsWith("ayas-qualification-") || fs.lstatSync(root).isSymbolicLink()) throw Error("TEMP_ROOT_REFUSED");
  return root;
}
// Narrow tar reader: checksum, regular/link types, closed relative paths and bounded inflated size.
function tar(bytes: Buffer): Map<string, { bytes?: Buffer; link?: string }> {
  const inflated = zlib.gunzipSync(bytes, { maxOutputLength: 256 * 1024 * 1024 });
  const entries = new Map<string, { bytes?: Buffer; link?: string }>();
  const field = (b: Buffer): string => b.toString("utf8").split("\0")[0]!;
  for (let at = 0; at + 512 <= inflated.length;) {
    const header = inflated.subarray(at, at + 512); if (header.every(v => v === 0)) break;
    const checksum = parseInt(field(header.subarray(148, 156)).trim(), 8);
    const actual = header.reduce((sum, v, i) => sum + (i >= 148 && i < 156 ? 32 : v), 0);
    if (checksum !== actual) throw Error("TAR_CHECKSUM_REFUSED");
    const prefix = field(header.subarray(345, 500));
    const name = (prefix ? `${prefix}/` : "") + field(header.subarray(0, 100));
    const normalized = name.replace(/\/$/, "");
    if (!/^[A-Za-z0-9_.+-]+(?:\/[A-Za-z0-9_.+-]+)*$/.test(normalized)
      || normalized.split("/").some(v => v === "." || v === "..") || entries.has(normalized)) throw Error("TAR_PATH_REFUSED");
    const size = parseInt(field(header.subarray(124, 136)).trim() || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0 || at + 512 + size > inflated.length) throw Error("TAR_SIZE_REFUSED");
    const kind = field(header.subarray(156, 157));
    if (kind === "0" || kind === "") entries.set(normalized, { bytes: inflated.subarray(at + 512, at + 512 + size) });
    else if (kind === "2") {
      const link = field(header.subarray(157, 257));
      if (!/^[A-Za-z0-9_.+-]+$/.test(link) || link === "." || link === "..") throw Error("TAR_LINK_REFUSED");
      entries.set(normalized, { link });
    } else if (kind !== "5") throw Error(`TAR_TYPE_REFUSED:${kind}`);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}
function write(root: string, file: string, bytes: Buffer | string): void {
  const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { flag: "wx", mode: 0o555 });
}
function seal(context: string, role: "INFERENCE" | "EVALUATOR"): void {
  const files: { path: string; sizeBytes: number; sha256: string }[] = [];
  const root = path.join(context, "payload");
  function walk(dir: string): void {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) { walk(file); continue; }
      if (!item.isFile() || item.isSymbolicLink()) throw Error("PAYLOAD_TYPE_REFUSED");
      const handle = fs.openSync(file, "r"); const hash = crypto.createHash("sha256"); const buffer = Buffer.alloc(1048576);
      try { let count: number; while ((count = fs.readSync(handle, buffer)) > 0) hash.update(buffer.subarray(0, count)); }
      finally { fs.closeSync(handle); }
      files.push({ path: path.relative(root, file).split(path.sep).join("/"), sizeBytes: fs.statSync(file).size, sha256: hash.digest("hex") });
    }
  }
  walk(root); files.sort((a,b) => a.path.localeCompare(b.path));
  write(context, "BUILD_INPUT.json", JSON.stringify({ schemaVersion: "1", role, files }, null, 2));
  for (const name of ["Containerfile", "verify-payload.mjs", "probe.mjs", "evaluate.cjs"])
    write(context, name, fs.readFileSync(path.join(repo, "sandbox/ayas-local-coding", name)));
}
function git(object: string): Buffer { return execFileSync("git", ["show", object], { cwd: repo, windowsHide: true, maxBuffer: 8_000_000, stdio: ["ignore", "pipe", "ignore"] }); }
async function main(): Promise<void> {
  const root = ownedRoot(process.argv[2]!); const role = process.argv[3];
  if (role === "evaluator") {
    const context = path.join(root, "evaluator-build"); fs.mkdirSync(context);
    const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8")); const pin = lock.packages["node_modules/typescript"];
    if (pin.version !== "5.9.3" || pin.resolved !== "https://registry.npmjs.org/typescript/-/typescript-5.9.3.tgz") throw Error("TOOLCHAIN_PIN_REFUSED");
    const bytes = fs.readFileSync(path.join(root, "typescript-5.9.3.tgz"));
    if (`sha512-${crypto.createHash("sha512").update(bytes).digest("base64")}` !== pin.integrity) throw Error("TOOLCHAIN_INTEGRITY_REFUSED");
    const compiler = tar(bytes).get("package/lib/typescript.js")?.bytes; if (!compiler) throw Error("COMPILER_MEMBER_MISSING");
    write(context, "payload/toolchain/typescript.js", compiler);
    const license = tar(bytes).get("package/LICENSE.txt")?.bytes; if (!license) throw Error("COMPILER_LICENSE_MISSING");
    write(context, "payload/toolchain/LICENSE.txt", license);
    for (const name of ["react", "react-dom", "scheduler", "tsx", "esbuild", "@esbuild/linux-x64"]) {
      const dependency = lock.packages[`node_modules/${name}`];
      if (!dependency || !dependency.resolved.startsWith("https://registry.npmjs.org/")) throw Error("DEPENDENCY_SOURCE_REFUSED");
      const archive = fs.readFileSync(path.join(root, `${name.replace("/", "-")}-${dependency.version}.tgz`));
      if (`sha512-${crypto.createHash("sha512").update(archive).digest("base64")}` !== dependency.integrity) throw Error("DEPENDENCY_INTEGRITY_REFUSED");
      for (const [file, entry] of tar(archive)) {
        if (!entry.bytes || !file.startsWith("package/")) throw Error("DEPENDENCY_MEMBER_REFUSED");
        write(context, `payload/toolchain/node_modules/${name}/${file.slice(8)}`, entry.bytes);
      }
    }
    // Native executor contract: the lockfile's exact esbuild pair and a linux/x86-64 ELF, never a host-platform binary.
    const nativeRoot = path.join(context, "payload/toolchain/node_modules/@esbuild/linux-x64");
    const native = fs.readFileSync(path.join(nativeRoot, "bin/esbuild"));
    const nativePackage = JSON.parse(fs.readFileSync(path.join(nativeRoot, "package.json"), "utf8"));
    if (native.readUInt32BE(0) !== 0x7f454c46 || native[4] !== 2 || native[5] !== 1 || native.readUInt16LE(18) !== 0x3e
      || String(nativePackage.os) !== "linux" || String(nativePackage.cpu) !== "x64"
      || nativePackage.version !== lock.packages["node_modules/esbuild"].version) throw Error("NATIVE_EXECUTOR_CONTRACT_REFUSED");
    fs.writeFileSync(path.join(root, "evaluator-toolchain.json"), JSON.stringify({
      archives: ["typescript", "react", "react-dom", "scheduler", "tsx", "esbuild", "@esbuild/linux-x64"].map(name => ({ name,
        version: lock.packages[`node_modules/${name}`].version, resolved: lock.packages[`node_modules/${name}`].resolved,
        lockfileIntegrity: lock.packages[`node_modules/${name}`].integrity })),
      nativeExecutor: { path: "toolchain/node_modules/@esbuild/linux-x64/bin/esbuild", sha256: sha(native), sizeBytes: native.length,
        elf: "ELF64 little-endian x86-64", os: nativePackage.os, cpu: nativePackage.cpu },
      childExecutorCli: "toolchain/node_modules/tsx/dist/cli.mjs", packageInstall: "NONE",
    }, null, 2) + "\n");
    const cases = [...AYAS_LOCAL_CODING_QUALIFICATION_VAULT, AYAS_LOCAL_CODING_RETRIEVAL_CASE];
    const security = cases.find(v => v.domain === "SECURITY")!;
    const manifest = [];
    for (const item of [...cases, { ...security, caseId: `${security.caseId}-oracle`, baseHead: security.fixHead }]) {
      const copied = new Set<string>(); const external = new Set<string>();
      const destination = `payload/cases/${item.caseId}/`;
      function copy(file: string, supplied?: Buffer): void {
        if (copied.has(file)) return;
        if (!/^(src|scripts)\/[A-Za-z0-9_./-]+\.tsx?$/.test(file) || file.split("/").includes("..")) throw Error(`IMPORT_PATH_REFUSED:${file}`);
        copied.add(file); const source = supplied ?? git(`${item.baseHead}:${file}`); write(context, destination + file, source);
        // Resolve runtime imports only; type-only dependencies never execute in this loader.
        const runtime = ts.transpileModule(source.toString("utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: file }).outputText;
        for (const dependency of ts.preProcessFile(runtime, true, true).importedFiles) {
          const request = dependency.fileName;
          if (isBuiltin(request)) continue;
          if (!request.startsWith(".") && !request.startsWith("@/")) {
            if (!["react", "react-dom", "scheduler"].some(name => request === name || request.startsWith(`${name}/`))) external.add(request);
            continue;
          }
          const relative = request.startsWith("@/") ? `src/${request.slice(2)}` : path.posix.normalize(path.posix.join(path.posix.dirname(file), request));
          const candidates = /\.tsx?$/.test(relative) ? [relative] : [`${relative}.ts`, `${relative}.tsx`, `${relative}/index.ts`];
          let found = false;
          for (const candidate of candidates) {
            let content: Buffer; try { content = git(`${item.baseHead}:${candidate}`); } catch { continue; }
            copy(candidate, content); found = true; break;
          }
          if (!found) throw Error(`IMPORT_MISSING:${request}:${file}`);
        }
      }
      const evaluator = git(item.evaluatorBlob); copy(item.evaluatorScript, evaluator);
      for (const file of item.exactFiles) copy(file);
      write(context, destination + "tsconfig.json", git(`${item.baseHead}:tsconfig.json`));
      copied.add("tsconfig.json");
      if (item.caseId === "historical-explicit-computer-plan") copy("scripts/fixtures/ayas-memory-temporal-writer-child.ts");
      // Frozen UI evaluator reads these source/CSS bytes as data rather than imports.
      // They remain evaluator-side and are not transpiled, executed or model-facing.
      if (item.domain === "UI") for (const file of ["src/components/brain/BrainConsoleView.tsx", "src/components/brain/BrainCore.css"]) {
        write(context, destination + file, git(`${item.baseHead}:${file}`)); copied.add(file);
      }
      if (external.size) throw Error(`UNSEALED_EXTERNAL_IMPORTS:${[...external]}`);
      manifest.push({ caseId: item.caseId, evaluatorScript: item.evaluatorScript, evaluatorBlob: item.evaluatorBlob,
        evaluatorSha256: sha(evaluator), exactFiles: item.exactFiles, files: [...copied].sort() });
    }
    write(context, "payload/CASES.json", JSON.stringify(manifest, null, 2)); seal(context, "EVALUATOR");
    console.log(JSON.stringify({ context, role, compilerSha256: sha(compiler), cases: manifest.map(v => ({ id: v.caseId, files: v.files.length })) }));
  } else if (role === "inference") {
    const archive = path.join(root, "llama-b11146-bin-ubuntu-x64.tar.gz");
    await verifyAyasLocalCodingArtifact(archive, pins.engine.linuxArchive);
    const model = path.join(root, pins.model.file); await verifyAyasLocalCodingArtifact(model, pins.model);
    const members = JSON.parse(fs.readFileSync("docs/ayas-execution/2026-09-27-master/03_STAGE15_BASE/hardening/15A/ENGINE_ARCHIVE_MEMBERS.json", "utf8"));
    const entries = tar(fs.readFileSync(archive));
    const context = path.join(root, "inference-build"); fs.mkdirSync(context);
    const proof = [];
    const expectedMembers = members.regularMembers as { path: string; sizeBytes: number; sha256: string }[];
    if (!Array.isArray(expectedMembers)) throw Error("ARCHIVE_MEMBER_EVIDENCE_SCHEMA");
    for (const [name, entry] of entries) {
      let target = name;
      const visited = new Set<string>();
      while (!entries.get(target)?.bytes) {
        if (visited.has(target) || visited.size >= 8) throw Error("ARCHIVE_LINK_CYCLE_REFUSED");
        visited.add(target); const link = entries.get(target)?.link;
        if (!link) throw Error("ARCHIVE_LINK_TARGET_MISSING");
        target = path.posix.join(path.posix.dirname(target), link);
      }
      const content = entries.get(target)?.bytes; const expected = expectedMembers.find(v => v.path === target);
      if (!content || !expected || content.length !== expected.sizeBytes || sha(content) !== expected.sha256) throw Error(`ARCHIVE_DERIVATION_REFUSED:${name}`);
      const relative = name.replace(/^llama-b11146\//, ""); if (relative.includes("/")) throw Error("ENGINE_MEMBER_SCOPE_REFUSED");
      write(context, `payload/engine/bin/${relative}`, content);
      proof.push({ path: relative, sourceMember: target, sha256: expected.sha256, flattenedLink: !!entry.link });
    }
    fs.mkdirSync(path.join(context, "payload/model"), { recursive: true });
    fs.copyFileSync(model, path.join(context, "payload/model", pins.model.file));
    fs.copyFileSync(archive, path.join(context, "payload/engine/llama-b11146-bin-ubuntu-x64.tar.gz"));
    write(context, "payload/engine/DERIVATION.json", JSON.stringify(proof, null, 2));
    seal(context, "INFERENCE"); console.log(JSON.stringify({ context, role, derivedMembers: proof.length }));
  } else throw Error("ROLE_REFUSED");
}
void main();
