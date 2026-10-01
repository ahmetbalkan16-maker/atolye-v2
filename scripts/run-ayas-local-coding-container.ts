/** Explicit Podman host diagnostic. Never registers an engine or promotes a patch. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { ayasLocalCodingCandidatePins as pins } from "../src/lib/brain/autonomy/AyasLocalCodingPins";
import { AYAS_LOCAL_CODING_MODEL_MAX_TIMEOUT_MS, diagnoseAyasLocalCodingModelWith } from "../src/lib/brain/autonomy/AyasLocalCodingModelAdapter";
import { summarizeAyasLocalCodingQualification } from "../src/lib/brain/autonomy/AyasLocalCodingQualificationReport";
import { createAyasLocalCodingWorkspace, destroyAyasLocalCodingWorkspace } from "../src/lib/brain/autonomy/AyasLocalCodingWorkspace";
import { AYAS_LOCAL_CODING_QUALIFICATION_VAULT, projectAyasLocalCodingQualificationTask } from "./fixtures/ayas-local-coding-qualification-vault";
import { AYAS_LOCAL_CODING_RETRIEVAL_CASE, projectAyasLocalCodingRetrievalTask } from "./fixtures/ayas-local-coding-qualification-retrieval-case";

const podman = "C:/Users/Metod/AppData/Local/Programs/Podman/podman.exe";
const sha = (b: Buffer | string): string => crypto.createHash("sha256").update(b).digest("hex");
const root = fs.realpathSync(process.argv[2]!);
if (path.dirname(root).toLowerCase() !== fs.realpathSync(os.tmpdir()).toLowerCase()
  || !path.basename(root).startsWith("ayas-qualification-") || fs.lstatSync(root).isSymbolicLink()) throw Error("OWNED_TEMP_ROOT_REQUIRED");
const reportPath = "docs/ayas-execution/2026-09-27-master/03_STAGE15_BASE/hardening/15A";
function command(args: string[], timeout = 120000): string {
  return execFileSync(podman, args, { encoding: "utf8", windowsHide: true, timeout, maxBuffer: 4_000_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function json(args: string[]): any { return JSON.parse(command(args)); } // eslint-disable-line @typescript-eslint/no-explicit-any -- OCI response is independently checked before start.
function image(role: string): string {
  const id = fs.readFileSync(path.join(root, `${role}-image-id.txt`), "utf8").trim();
  assert.match(id, /^sha256:[a-f0-9]{64}$/);
  const item = json(["image", "inspect", id])[0];
  assert.equal(item.Id.replace(/^sha256:/, ""), id.slice(7));
  assert.equal(item.Os, "linux"); assert.equal(item.Architecture, "amd64"); assert.equal(item.Config.User, "65534:65534");
  assert.equal(item.Config.Labels["org.ayas.base.digest"], pins.base.image.split("@")[1]);
  assert.ok(!item.Config.Volumes && !item.Config.ExposedPorts);
  return id;
}
function machineGuard(): void {
  assert.equal(sha(fs.readFileSync(podman)), "f6a555b075654fdb12580bdaf570ee90c2225f94a05781ecd6c1a16c8a5c95ea");
  const machine = json(["machine", "inspect"])[0]; const info = json(["info", "--format", "json"]);
  assert.equal(machine.Rootful, false); assert.equal(machine.State, "running");
  assert.equal(machine.Name, "podman-machine-default"); assert.equal(machine.Resources.CPUs, 8); assert.equal(machine.Resources.Memory, 8192); assert.equal(machine.Resources.DiskSize, 40);
  assert.equal(info.version.Version, "6.0.2"); assert.equal(info.version.GitCommit, "b28edb9ad70ce4317dc762ee9ce0a6d081d154e9");
  assert.equal(info.host.security.rootless, true); assert.equal(info.host.security.seccompEnabled, true); assert.equal(info.host.cgroupVersion, "v2");
  assert.match(info.host.kernel, /microsoft-standard-WSL2$/); assert.match(info.host.ociRuntime.version, /^crun version 1\.28\n/);
}
function linuxTemp(file: string): string {
  const absolute = fs.realpathSync(file);
  assert.equal(fs.lstatSync(absolute).isSymbolicLink(), false);
  assert.ok(absolute.toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase() + path.sep));
  assert.match(absolute, /^C:\\/i);
  return `/mnt/c/${absolute.slice(3).split(path.sep).join("/")}`;
}
type Profile = { memory: number; cpus: number; tmpSize: string };
const diagnostic: Profile = { memory: 4294967296, cpus: 2, tmpSize: "256m" };
// Explicit inference profile, NOT the 4 GiB probe admission profile. 12.5 GiB = 8.37 GiB mmap'd weights + 3.0 GiB
// 16k-token KV + slack. The earlier 14 GiB cap drove the shared WSL VM, and with it the host, above 90 % RAM.
const inference: Profile = { memory: 13421772800, cpus: 8, tmpSize: "64m" };
function create(id: string, workspace: string, profile: Profile, entry: string, args: string[]): string {
  const name = `ayas-qualification-${crypto.randomUUID()}`;
  command(["create", "--name", name, "--pull=never", "--network=none", "--read-only", "--cap-drop=ALL",
    "--security-opt=no-new-privileges", "--pids-limit=64", `--memory=${profile.memory}`, `--memory-swap=${profile.memory}`,
    `--cpus=${profile.cpus}`, "--user=65534:65534", "--pid=private", "--ipc=private", "--uts=private",
    "--mount", `type=bind,src=${linuxTemp(workspace)},dst=/workspace,readonly`,
    "--tmpfs", `/tmp:rw,noexec,nosuid,size=${profile.tmpSize}`, "--workdir=/workspace",
    "--env=HOME=/tmp", "--env=ATOLYE_RUNTIME_ROOT=/tmp/runtime", `--entrypoint=${entry}`, id, ...args]);
  try { inspect(name, id, workspace, profile, entry); } catch (error) { command(["rm", "--force", name]); throw error; }
  return name;
}
// Actual Podman shape, fail closed; no inference from Docker-only fixtures.
function inspect(name: string, id: string, workspace: string, profile: Profile, entry: string): any { // eslint-disable-line @typescript-eslint/no-explicit-any
  const item = json(["inspect", name])[0]; const h = item.HostConfig;
  if (item.Mounts.some((m: { Type: string; Destination: string; Source: string }) =>
    m.Type === "bind" ? m.Destination !== "/workspace" || m.Source !== linuxTemp(workspace) : m.Type !== "tmpfs" || m.Destination !== "/tmp")) throw Error("UNEXPECTED_MOUNT_REFUSED");
  assert.equal(item.Image.replace(/^sha256:/, ""), id.slice(7)); assert.equal(item.Config.User, "65534:65534");
  assert.deepEqual(item.Config.Entrypoint, [entry]); assert.equal(h.NetworkMode, "none");
  assert.equal(h.ReadonlyRootfs, true); assert.equal(h.Privileged, false); assert.equal(h.PidsLimit, 64);
  assert.equal(h.Memory, profile.memory); assert.equal(h.MemorySwap, profile.memory);
  assert.equal(h.CpuQuota / h.CpuPeriod, profile.cpus);
  assert.ok(h.SecurityOpt.includes("no-new-privileges"));
  // Podman 6 expands ALL into the rootless engine's default set. Kernel Cap* must also be zero in the real probe.
  assert.deepEqual([...h.CapDrop].sort(), ["CAP_CHOWN","CAP_DAC_OVERRIDE","CAP_FOWNER","CAP_FSETID","CAP_KILL","CAP_NET_BIND_SERVICE","CAP_SETFCAP","CAP_SETGID","CAP_SETPCAP","CAP_SETUID","CAP_SYS_CHROOT"].sort());
  assert.ok(!h.CapAdd?.length); assert.equal(h.PidMode, "private"); assert.equal(h.IpcMode, "private"); assert.equal(h.UTSMode, "private");
  assert.ok(!h.PortBindings || Object.keys(h.PortBindings).length === 0);
  assert.ok(!h.Devices?.length && !h.VolumesFrom?.length && !h.Dns?.length && !h.ExtraHosts?.length);
  assert.equal(item.Mounts.filter((m: { Type: string }) => m.Type === "bind").length, 1);
  for (const m of item.Mounts) {
    if (m.Type === "bind") { assert.equal(m.Destination, "/workspace"); assert.equal(m.Source, linuxTemp(workspace)); assert.equal(m.RW, false); }
    else { assert.equal(m.Type, "tmpfs"); assert.equal(m.Destination, "/tmp"); }
  }
  assert.deepEqual(Object.keys(h.Tmpfs), ["/tmp"]);
  assert.match(h.Tmpfs["/tmp"], /noexec/); assert.match(h.Tmpfs["/tmp"], /nosuid/);
  assert.ok(!item.Config.Env.some((env: string) => /TOKEN|SECRET|API_KEY|SSH|PASSWORD/i.test(env)));
  return item;
}
function cleanup(name: string): void { command(["rm", "--force", name]); }
function writeReport(name: string, value: object): void { fs.writeFileSync(`${reportPath}/${name}.json`, JSON.stringify(value, null, 2) + "\n"); }
const head = (): string => execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim();
/** Offline build of one target from a freshly prepared TEMP context. No pull, no build network, no package install. */
function build(role: "evaluator" | "inference"): void {
  const context = path.join(root, `${role}-build`); const support = ["Containerfile", "verify-payload.mjs", "probe.mjs", "evaluate.cjs"];
  // The context must carry the current reviewed recipe bytes, not an earlier preparation.
  const supportSha256 = Object.fromEntries(support.map(name => {
    const digest = sha(fs.readFileSync(path.join(context, name)));
    assert.equal(digest, sha(fs.readFileSync(`sandbox/ayas-local-coding/${name}`)), `STALE_BUILD_CONTEXT:${name}`);
    return [name, digest];
  }));
  const recipe = fs.readFileSync(path.join(context, "Containerfile"), "utf8");
  assert.ok(recipe.includes(`FROM ${pins.base.image} AS node_runtime`) && !/\b(?:npm|pnpm|yarn|apt|apt-get|apk|curl|wget)\b/.test(recipe.replace(/^#.*$/gm, "")), "RECIPE_REFUSED");
  const input = fs.readFileSync(path.join(context, "BUILD_INPUT.json")); const idFile = path.join(root, `${role}-image-id.txt`);
  const started = performance.now();
  command(["build", "--pull=never", "--network=none", `--target=${role}`, `--iidfile=${idFile}`, "--file", path.join(context, "Containerfile"), context], 3_600_000);
  const id = image(role); const item = json(["image", "inspect", id])[0];
  // Default entrypoint re-verifies every sealed payload byte inside the final image, under the run-time restrictions.
  const verified = JSON.parse(command(["run", "--rm", "--pull=never", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=64", "--memory=4294967296", "--cpus=2", id], 1_800_000));
  assert.deepEqual(verified, { status: "PAYLOAD_BYTES_VERIFIED_NOT_ADMITTED", role: role.toUpperCase(), files: JSON.parse(input.toString("utf8")).files.length });
  const file = `${reportPath}/IMAGE_BUILD_EVIDENCE.json`; const evidence = JSON.parse(fs.readFileSync(file, "utf8"));
  const previous = evidence.roles.find((row: { role: string }) => row.role === role);
  if (previous && previous.imageId !== id) (evidence.supersededBuilds ??= []).push(previous);
  const entry = { role, imageId: id, manifestDigest: item.Digest, repoDigests: item.RepoDigests, architecture: item.Architecture, os: item.Os,
    user: item.Config.User, baseDigest: item.Config.Labels["org.ayas.base.digest"], baseImage: pins.base.image, baseVersion: pins.base.version,
    recipeSha256: supportSha256.Containerfile, supportSha256, payloadManifestSha256: sha(input), payloadFiles: verified.files,
    inImagePayloadVerification: verified.status, sizeBytes: item.Size, buildNetwork: "none", basePull: "never (exact digest already local)",
    packageInstall: "NONE", buildMs: performance.now() - started, repositoryHead: head(), observedAt: new Date().toISOString(), admission: "NONE",
    ...(role === "evaluator" ? { toolchain: JSON.parse(fs.readFileSync(path.join(root, "evaluator-toolchain.json"), "utf8")) } : {}) };
  evidence.roles = [...evidence.roles.filter((row: { role: string }) => row.role !== role), entry];
  if (role === "evaluator") evidence.compilerAndEvaluatorManifests = JSON.parse(fs.readFileSync(path.join(context, "payload/CASES.json"), "utf8"));
  fs.writeFileSync(file, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify({ role, imageId: id, manifestDigest: item.Digest, payloadFiles: verified.files }));
}
async function matrix(): Promise<void> {
  const id = image("evaluator"); const workspace = fs.mkdtempSync(path.join(root, "probe-workspace-"));
  fs.writeFileSync(path.join(workspace, "probe.txt"), "AYAS_TEMP_ONLY");
  const name = create(id, workspace, diagnostic, "/usr/local/bin/node", ["/opt/ayas/probe.mjs"]);
  const settings = inspect(name, id, workspace, diagnostic, "/usr/local/bin/node");
  let rows: unknown[] = [];
  try {
    const run = spawnSync(podman, ["start", "--attach", name], { encoding: "utf8", timeout: 60000, maxBuffer: 2000000, windowsHide: true });
    const observation = run.stdout.split(/\r?\n/).find(line => line.includes('"REAL_CONTAINER_OBSERVATIONS_NOT_ADMISSION"'));
    if (!observation) throw Error(`PROBE_NO_REPORT:${run.stderr}`);
    rows = JSON.parse(observation).rows;
    fs.writeFileSync(path.join(root, "probe-output.json"), observation);
    writeReport("HARD_SANDBOX_EVIDENCE", { evidenceClass: "ACTUAL_PODMAN_DIAGNOSTIC_MATRIX", imageId: id,
      ociInspection: settings, rows, probeExit: run.status, probeStderr: run.stderr, fullMatrixPass: false, admission: "NONE" });
    assert.equal(run.status, 0, run.stderr);
  } finally { cleanup(name); }
  const stress = [];
  for (const mode of ["memory", "sleep"]) {
    const profile = mode === "memory" ? { ...diagnostic, memory: 134217728 } : diagnostic;
    const container = create(id, workspace, profile, "/usr/local/bin/node", ["/opt/ayas/probe.mjs", mode]);
    try {
      const started = performance.now();
      const run = spawnSync(podman, ["start", "--attach", container], { encoding: "utf8", timeout: mode === "sleep" ? 3000 : 30000, maxBuffer: 1000000, windowsHide: true });
      if (mode === "sleep") command(["stop", "--time=1", container]);
      const after = json(["inspect", container])[0];
      const pass = mode === "memory" ? after.State.OOMKilled === true && after.State.ExitCode === 137
        : (run.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" && after.State.Running === false;
      stress.push({ mode, pass, elapsedMs: performance.now() - started, state: after.State, error: (run.error as NodeJS.ErrnoException | undefined)?.code ?? null, stdout: run.stdout, stderr: run.stderr });
    } finally { cleanup(container); }
  }
  const extra = fs.mkdtempSync(path.join(root, "extra-innocent-mount-"));
  const invalid = command(["create", "--network=none", "--read-only", "--user=65534:65534", "--mount", `type=bind,src=${linuxTemp(extra)},dst=/unexpected,readonly`, id]);
  let unexpectedMountRejected = false;
  try { inspect(invalid, id, workspace, diagnostic, "/usr/local/bin/node"); } catch (error) { unexpectedMountRejected = String(error).includes("UNEXPECTED_MOUNT_REFUSED"); }
  finally { cleanup(invalid); }
  const fullMatrixPass = (rows as { pass: boolean }[]).every(row => row.pass) && stress.every(row => row.pass) && unexpectedMountRejected;
  writeReport("HARD_SANDBOX_EVIDENCE", { evidenceClass: "ACTUAL_PODMAN_DIAGNOSTIC_MATRIX", imageId: id,
    ociInspection: settings, rows, stress, unexpectedMountRejected, fullMatrixPass, admission: "NONE",
    distinction: "Diagnostic 4GiB/2CPU profile verified here; inference 14GiB/8CPU independently inspected per run. Production registry remains empty." });
  assert.equal(fullMatrixPass, true); console.log("HARD_MATRIX_PASS_DIAGNOSTIC_ONLY");
}
// node:http, not fetch: fetch (undici) aborts after a fixed 300 s without response headers, and a non-streamed
// completion sends its headers only when generation ends. The socket idle timeout below is the bounded wait.
const httpClient = (timeoutMs: number): string => `import http from 'node:http';let b='';for await(const c of process.stdin)b+=c;await new Promise((ok,no)=>{const q=http.request({host:'127.0.0.1',port:8080,path:'/v1/chat/completions',method:'POST',headers:{'content-type':'application/json','content-length':Buffer.byteLength(b)}},r=>{let n=0;const e=[];r.on('data',c=>{n+=c.length;if(n>256000){q.destroy(Error('RESPONSE_TOO_LARGE'));return}if(r.statusCode===200)process.stdout.write(c);else e.push(c)});r.on('end',()=>r.statusCode===200?ok():no(Error('HTTP_'+r.statusCode+':'+Buffer.concat(e).toString().slice(0,300))));r.on('error',no)});q.setTimeout(${timeoutMs},()=>q.destroy(Error('TimeoutError: bounded local generation wait exceeded')));q.on('error',no);q.end(b)}).catch(e=>{process.stderr.write('CLIENT_ERROR:'+String(e&&e.message||e));process.exit(1)})`;
// Exec'd Node helpers share the server's cgroup: keep their pools minimal so they cannot crowd the 64-task cap.
const helperNode = ["/usr/local/bin/node", "--v8-pool-size=1"];
const serverArgs = ["--model", `/opt/ayas/payload/model/${pins.model.file}`, "--alias", "ayas-qwen2.5-coder-14b-q4-k-m", "--host", "127.0.0.1", "--port", "8080",
  "--ctx-size", "16384", "--threads", "8", "--threads-http", "2", "--n-gpu-layers", "0", "--parallel", "1", "--jinja", "--offline",
  // One request per disposable server: the default 8 GiB prompt cache and context checkpoints would only add resident memory.
  "--cache-ram", "0", "--ctx-checkpoints", "0"];
const waitHealthy = "const t=Date.now();for(;;){try{let r=await fetch('http://127.0.0.1:8080/health',{redirect:'error'});if(r.ok)break}catch{}if(Date.now()-t>300000)throw Error('MODEL_LOAD_TIMEOUT');await new Promise(r=>setTimeout(r,500))}";
// Inference has a separately explicit resource profile. Its live cgroup/kernel/boundary state is asserted from inside.
const assertLive = `const fs=require('fs'),a=require('assert/strict');a.equal(fs.readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),'${inference.memory}');a.equal(fs.readFileSync('/sys/fs/cgroup/memory.swap.max','utf8').trim(),'0');a.equal(fs.readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim(),'${inference.cpus * 100000} 100000');` + "a.equal(fs.readFileSync('/sys/fs/cgroup/pids.max','utf8').trim(),'64');const s=fs.readFileSync('/proc/self/status','utf8');for(const k of ['CapInh','CapPrm','CapEff','CapBnd','CapAmb'])a.match(s,new RegExp(k+':\\\\s+0{16}'));a.match(s,/NoNewPrivs:\\s+1/);a.match(s,/Seccomp:\\s+2/);a.deepEqual(fs.readdirSync('/sys/class/net'),['lo']);a.equal(fs.existsSync('/opt/ayas/evaluate.cjs'),false);a.equal(fs.existsSync('/opt/ayas/probe.mjs'),false);a.equal(fs.existsSync('/opt/ayas/payload/cases'),false);a.equal(fs.existsSync('/opt/ayas/payload/toolchain'),false);a.equal(fs.existsSync('/workspace/.git'),false);a.throws(()=>fs.writeFileSync('/workspace/x','x'));a.throws(()=>fs.writeFileSync('/opt/ayas/x','x'))";
const sampleCgroup = "const fs=require('fs');const r=f=>fs.readFileSync('/sys/fs/cgroup/'+f,'utf8').trim();const m=Object.fromEntries(r('memory.stat').split('\\n').map(l=>l.split(' ')).filter(([k])=>['anon','file','file_mapped','kernel','shmem','pgmajfault','workingset_refault_file'].includes(k)).map(([k,v])=>[k,Number(v)]));console.log(JSON.stringify({cpuStat:r('cpu.stat'),memoryMaxBytes:Number(r('memory.max')),memoryPeakBytes:Number(r('memory.peak')),memoryCurrentBytes:Number(r('memory.current')),memoryStat:m,pidsMax:Number(r('pids.max')),pidsPeak:Number(r('pids.peak')),pidsEvents:r('pids.events'),memoryEvents:r('memory.events'),cpuOnly:true,gpuTelemetry:null,vramTelemetry:null}))";
/**
 * PC health guard (owner directive). The WSL provider does not enforce the Podman machine's configured memory or CPUs:
 * every distribution shares one WSL2 VM sized by WSL defaults, so the per-container cgroup limit is the only real bound.
 * Host settings and WSL global configuration are never changed here.
 */
const HOST_MAX_USED = 0.90; const HOST_CRITICAL_FREE = 0.03; const VM_OVERHEAD_BYTES = 1_073_741_824;
type HostMemory = { totalBytes: number; freeBytes: number; usedPct: number };
const hostMemory = (): HostMemory => {
  const totalBytes = os.totalmem(); const freeBytes = os.freemem();
  return { totalBytes, freeBytes, usedPct: Math.round(1000 * (1 - freeBytes / totalBytes)) / 10 };
};
const pause = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
/** Drop the VM's idle page cache so WSL returns it to Windows. Non-persistent; no setting is changed. */
function releaseVmCache(): void {
  try { command(["machine", "ssh", "sudo sh -c 'sync; echo 1 > /proc/sys/vm/drop_caches'"], 60000); } catch { /* best effort: the start guard still decides */ }
}
/** One heavy workload at a time, started only if the host stays under 90 % with the whole container limit resident. */
async function awaitHostHeadroom(profile: Profile): Promise<HostMemory & { requiredFreeBytes: number; waitedMs: number }> {
  const running = command(["ps", "--quiet"]).split(/\s+/).filter(Boolean);
  if (running.length) throw Error(`HOST_PROTECTION_PAUSE:${running.length} container(s) already running`);
  releaseVmCache();
  const requiredFreeBytes = Math.round(profile.memory + VM_OVERHEAD_BYTES + (1 - HOST_MAX_USED) * os.totalmem());
  for (let waitedMs = 0; ; waitedMs += 10_000) {
    const now = hostMemory();
    if (now.freeBytes >= requiredFreeBytes) return { ...now, requiredFreeBytes, waitedMs };
    if (waitedMs >= 300_000) throw Error(`HOST_PROTECTION_PAUSE:host free ${now.freeBytes} < required ${requiredFreeBytes} (${now.usedPct}% used)`);
    await pause(10_000);
  }
}
/** Sample host memory during a heavy run; sustained critical pressure aborts the run instead of thrashing the PC. */
function hostWatch(onCritical: () => void): { stop: () => { peakUsedPct: number; minFreeBytes: number; aborted: boolean } } {
  let peakUsedPct = 0; let minFreeBytes = Number.MAX_SAFE_INTEGER; let low = 0; let aborted = false;
  const timer = setInterval(() => {
    const now = hostMemory(); peakUsedPct = Math.max(peakUsedPct, now.usedPct); minFreeBytes = Math.min(minFreeBytes, now.freeBytes);
    low = now.freeBytes < HOST_CRITICAL_FREE * now.totalBytes ? low + 1 : 0;
    if (low >= 3 && !aborted) { aborted = true; onCritical(); }
  }, 5000);
  return { stop: () => { clearInterval(timer); return { peakUsedPct, minFreeBytes, aborted }; } };
}
function transport(name: string, body: string, signal: AbortSignal, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(podman, ["exec", "-i", name, ...helperNode, "--input-type=module", "-e", httpClient(timeoutMs)], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = []; let error = ""; let bytes = 0;
    const cancel = (): void => { child.kill(); reject(Error("TRANSPORT_ABORTED")); };
    signal.addEventListener("abort", cancel, { once: true });
    child.stdout.on("data", chunk => { bytes += chunk.length; if (bytes > 256000) cancel(); else chunks.push(Buffer.from(chunk)); });
    child.stderr.on("data", chunk => { if (error.length < 10000) error += chunk.toString(); });
    child.on("error", reject); child.stdin.on("error", reject);
    child.on("close", code => { signal.removeEventListener("abort", cancel); if (code === 0) {
      try { resolve(new TextDecoder("utf8", { fatal: true }).decode(Buffer.concat(chunks))); } catch (error) { reject(error); }
    } else reject(Error(`LOCAL_HTTP_TRANSPORT:${code}:${error}`)); });
    child.stdin.end(body);
  });
}
const allCases = [...AYAS_LOCAL_CODING_QUALIFICATION_VAULT, AYAS_LOCAL_CODING_RETRIEVAL_CASE].sort((a,b) => (a.split === "HELD_OUT" ? 1 : 0) - (b.split === "HELD_OUT" ? 1 : 0));
function hardenedEvaluatorImage(): string {
  const hard = JSON.parse(fs.readFileSync(`${reportPath}/HARD_SANDBOX_EVIDENCE.json`, "utf8")); assert.equal(hard.fullMatrixPass, true);
  const evalId = image("evaluator"); assert.equal(hard.imageId, evalId, "ISOLATION_MATRIX_NOT_RUN_ON_THIS_IMAGE");
  // The recorded build must be this image, built from the context whose sealed bytes are inspected below.
  const built = JSON.parse(fs.readFileSync(`${reportPath}/IMAGE_BUILD_EVIDENCE.json`, "utf8")).roles.find((row: { role: string }) => row.role === "evaluator");
  assert.equal(built.imageId, evalId); assert.equal(built.payloadManifestSha256, sha(fs.readFileSync(path.join(root, "evaluator-build/BUILD_INPUT.json"))));
  return evalId;
}
/** Host-oracle controls inside the container. They never reach the model and are not model results. */
function controls(): void {
  const evalId = hardenedEvaluatorImage(); const cases = allCases;
  const sealed = JSON.parse(fs.readFileSync(path.join(root, "evaluator-build/payload/CASES.json"), "utf8")) as { caseId: string; evaluatorScript: string }[];
  // Negative controls never reach the model. Run the whole unchanged frozen evaluator.
  const negatives = [];
  for (const item of cases) {
    // The sealed evaluator bytes must still be the frozen Git blob: not rewritten for Linux, the container or the model.
    const script = sealed.find(row => row.caseId === item.caseId)!.evaluatorScript;
    const bytes = fs.readFileSync(path.join(root, "evaluator-build/payload/cases", item.caseId, script));
    const sealedBlob = crypto.createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    assert.equal(sealedBlob, item.evaluatorBlob, `FROZEN_EVALUATOR_CHANGED:${item.caseId}`);
    const sources = item.exactFiles.map(file => ({ path: file, content: execFileSync("git", ["show", `${item.baseHead}:${file}`], { encoding: "utf8", windowsHide: true, maxBuffer: 1000000 }) }));
    const observations = [];
    for (const kind of ["baseline", "wrong-noop", "historical-fix"] as const) {
      const workspace = fs.mkdtempSync(path.join(root, "negative-control-"));
      const candidate = { caseId: item.caseId, sources: sources.map((source,index) => ({ ...source,
        content: kind === "historical-fix" ? execFileSync("git", ["show", `${item.fixHead}:${source.path}`], { encoding: "utf8", windowsHide: true, maxBuffer: 1000000 })
          : source.content + (kind === "wrong-noop" && index === 0 ? "\n// Host-only wrong candidate: unrelated no-op.\n" : "") })) };
      fs.writeFileSync(path.join(workspace, "candidate.json"), JSON.stringify(candidate), { flag: "wx", mode: 0o444 });
      const container = create(evalId, workspace, diagnostic, "/usr/local/bin/node", ["/opt/ayas/evaluate.cjs", item.caseId]);
      try {
        const run = spawnSync(podman, ["start", "--attach", container], { encoding: "utf8", timeout: 60000, maxBuffer: 1000000, windowsHide: true });
        const expected = item.caseId === "historical-explicit-computer-plan" ? "user.decision.computer-purchase-plan"
          : item.caseId === "heldout-render-tool-supersession" ? "user.decision.render-tool"
            : item.domain === "SECURITY" ? "Missing expected rejection" : item.domain === "UI" ? "stale-yesterday"
              : item.domain === "MEMORY_RETRIEVAL" ? "true" : "AYAS_POST_PUBLICATION_GRAPHIFY_REFRESH_FAILED";
        const skipped = /"skipped"|"scenarios":0/.test(run.stdout);
        observations.push({ kind, status: skipped ? "PLATFORM_UNSUPPORTED" : kind === "historical-fix"
          ? run.status === 0 ? "CORRECT_HISTORICAL_REPAIR_PASS" : "INVALID_CONTROL"
          : run.status === 1 && /AssertionError|ERR_ASSERTION/.test(run.stderr) && run.stderr.includes(expected) ? "EXPECTED_REJECTION" : "INVALID_CONTROL",
          exit: run.status, stdout: run.stdout, stderr: run.stderr, evaluatorBlob: item.evaluatorBlob });
      } finally { cleanup(container); }
    }
    // A 0-scenario/skipped evaluator is a platform limitation, never a PASS and never a rejection.
    const platform = observations.every(o => o.status === "PLATFORM_UNSUPPORTED") ? "PLATFORM_UNAVAILABLE"
      : observations.some(o => o.status === "PLATFORM_UNSUPPORTED") ? "INVALID_CONTROL" : "EVALUABLE";
    negatives.push({ caseId: item.caseId, split: item.split, domain: item.domain, evaluatorBlob: item.evaluatorBlob, sealedEvaluatorBlob: sealedBlob, platform, observations });
  }
  const valid = negatives.every(row => row.platform !== "INVALID_CONTROL" && row.observations.every(o => o.status !== "INVALID_CONTROL"));
  writeReport("FROZEN_CONTAINER_NEGATIVE_CONTROLS", { evidenceClass: "FROZEN_EVALUATOR_CONTAINER_ORACLE_CONTROLS_NOT_MODEL_RUNS", imageId: evalId,
    repositoryHead: head(), observedAt: new Date().toISOString(), allControlsValid: valid, frozenEvaluatorsUnchanged: true,
    evaluable: negatives.filter(row => row.platform === "EVALUABLE").map(row => row.caseId),
    platformUnavailable: negatives.filter(row => row.platform === "PLATFORM_UNAVAILABLE").map(row => row.caseId), negatives });
  assert.ok(valid, "FROZEN_CONTAINER_BASELINE_FAILURE_NOT_THE_EXPECTED_ASSERTION");
  console.log(JSON.stringify({ controls: "VALID_HOST_ORACLE_ONLY", cases: negatives.map(row => `${row.caseId}:${row.platform}`) }));
}
function containerLogs(name: string): string {
  const run = spawnSync(podman, ["logs", name], { encoding: "utf8", windowsHide: true, maxBuffer: 16_000_000 });
  return run.error ? `LOG_CAPTURE_UNAVAILABLE:${String(run.error)}` : `${run.stdout}${run.stderr}`;
}
/** Real pinned llama-server + model liveness and speed observation. Not a coding attempt and not qualification. */
async function smoke(): Promise<void> {
  const id = image("inference"); const workspace = fs.mkdtempSync(path.join(root, "smoke-workspace-"));
  fs.writeFileSync(path.join(workspace, "probe.txt"), "AYAS_TEMP_ONLY");
  const hostBefore = await awaitHostHeadroom(inference);
  const started = performance.now();
  const container = create(id, workspace, inference, "/opt/ayas/payload/engine/bin/llama-server", serverArgs);
  let observation: object = { error: "NOT_REACHED" }; let metrics: unknown = null; let state: unknown = null; let pass = false;
  const guard = new AbortController(); const watch = hostWatch(() => guard.abort());
  try {
    command(["start", container]);
    command(["exec", container, ...helperNode, "--input-type=module", "-e", waitHealthy], 305000);
    const loadMs = performance.now() - started;
    command(["exec", container, ...helperNode, "-e", assertLive]);
    const filler = Array.from({ length: 160 }, (_, i) => `const value_${i} = ${i};`).join("\n");
    const body = JSON.stringify({ model: "ayas-qwen2.5-coder-14b-q4-k-m", stream: false, temperature: 0, seed: 0, max_tokens: 48,
      messages: [{ role: "user", content: `${filler}\nReply with exactly this one line and nothing else: const value_160 = 160;` }] });
    const requestStarted = performance.now();
    const response = JSON.parse(await transport(container, body, AbortSignal.any([AbortSignal.timeout(300000), guard.signal]), 295000));
    observation = { loadAndSandboxStartupMs: loadMs, requestMs: performance.now() - requestStarted, model: response.model,
      finishReason: response.choices?.[0]?.finish_reason, content: response.choices?.[0]?.message?.content, usage: response.usage, timings: response.timings };
    pass = response.model === "ayas-qwen2.5-coder-14b-q4-k-m" && response.usage?.completion_tokens > 0
      && String(response.choices?.[0]?.message?.content).includes("const value_160 = 160;");
  } catch (error) { observation = { error: String(error) }; }
  finally {
    try { metrics = json(["exec", container, ...helperNode, "-e", sampleCgroup]); } catch { metrics = { unavailable: "container exited before sampling" }; }
    const logs = containerLogs(container); fs.writeFileSync(path.join(root, `smoke-${Date.now()}-server.log`), logs);
    try { state = json(["inspect", container])[0].State; } finally { cleanup(container); }
    const host = watch.stop(); releaseVmCache();
    writeReport("LLAMA_SERVER_SMOKE_EVIDENCE", { evidenceClass: "REAL_PINNED_ENGINE_MODEL_LIVENESS_NOT_QUALIFICATION", observedAt: new Date().toISOString(),
      repositoryHead: head(), imageId: id, engineCommit: pins.engine.commit, modelSha256: pins.model.sha256, serverArgs, profile: inference,
      liveBoundaryAssertion: `asserted inside the container: memory.max ${inference.memory}, no swap, cpu.max ${inference.cpus} CPUs, 64 tasks, zero capabilities, no-new-privileges, seccomp filter, loopback-only netns, no evaluator/cases/toolchain/.git, read-only root and workspace`,
      engineBanner: logs.split(/\r?\n/).filter(line => /build:|system info|n_ctx|model size|model params/i.test(line)).slice(0, 12),
      observation, resources: metrics, serverState: state, hostMemory: { before: hostBefore, ...host, hostMaxUsedTarget: HOST_MAX_USED },
      pass: pass && !host.aborted, resourceAbort: host.aborted ? "HOST_PROTECTION" : null, admission: "NONE" });
    pass = pass && !host.aborted;
  }
  assert.equal(pass, true, "LLAMA_SERVER_SMOKE_FAILED"); console.log("LLAMA_SERVER_SMOKE_PASS_NOT_QUALIFICATION");
}
const REPEATS = 2;
type Attempt = Record<string, unknown> & { caseId: string; repeat: number; outcome: string };
/** Outcome classes keep invalid output, schema, scope and timeout failures apart; none of them is a PASS. */
function classify(error: unknown): { outcome: string; reason: string } {
  const reason = error instanceof Error ? error.message : String(error);
  const outcome = /MODEL_TIMEOUT|TimeoutError|timed out/i.test(reason) ? "TIMEOUT"
    : /HTTP_4\d\d/.test(reason) ? "REQUEST_REFUSED_BY_ENGINE"
      : /^MODEL_/.test(reason) ? "INVALID_OUTPUT"
        : /^PATCH_SCHEMA_INVALID/.test(reason) ? "SCHEMA_FAILURE"
          : /^PATCH_(?:SCOPE_OR_SCHEMA_INVALID|LINE_BUDGET_EXCEEDED|TOO_LARGE)/.test(reason) ? "SCOPE_OR_BUDGET_REFUSED"
            : /^PATCH_BASE_OR_UNIQUE_SEARCH_MISMATCH/.test(reason) ? "UNAPPLICABLE_PATCH" : "RUNTIME_FAILURE";
  return { outcome, reason: reason.slice(0, 800) };
}
function responseFacts(raw: string): object {
  try {
    const parsed = JSON.parse(raw); const choice = parsed.choices?.[0]; const calls = choice?.message?.tool_calls;
    return { finishReason: choice?.finish_reason ?? null, usage: parsed.usage ?? null, timings: parsed.timings ?? null,
      toolCalls: Array.isArray(calls) ? calls.map((call: { function?: { name?: string } }) => call?.function?.name ?? null) : null,
      contentChars: typeof choice?.message?.content === "string" ? choice.message.content.length : 0,
      content: typeof choice?.message?.content === "string" ? choice.message.content.slice(0, 24000) : null };
  } catch { return { unparseable: true, bytes: Buffer.byteLength(raw) }; }
}
const workspaceDigest = (dir: string, files: readonly string[]): string => sha(files.map(file => sha(fs.readFileSync(path.join(dir, file)))).join("|"));
/** Real metrics over real container observations. A missing canonical numeric threshold fails closed. */
function summarize(attempts: Attempt[], evaluable: string[], inferenceId: string): object {
  const complete = evaluable.every(caseId => attempts.filter(row => row.caseId === caseId).length === REPEATS);
  const engineBinarySha256 = (JSON.parse(fs.readFileSync(`${reportPath}/ENGINE_ARCHIVE_MEMBERS.json`, "utf8")).regularMembers as { path: string; sha256: string }[])
    .find(member => member.path.endsWith("/llama-server"))!.sha256;
  const bound = allCases.filter(item => evaluable.includes(item.caseId));
  const metrics = !complete ? null : summarizeAyasLocalCodingQualification({ repeatCount: REPEATS,
    cases: bound.map(item => ({ caseId: item.caseId, split: item.split, baseHead: item.baseHead, evaluatorBlob: item.evaluatorBlob, exactFiles: item.exactFiles, maxChangedLines: item.maxChangedLines })),
    attempts: attempts.filter(row => evaluable.includes(row.caseId)).map(row => {
      const item = bound.find(candidate => candidate.caseId === row.caseId)!; const resources = row.resources as { cpuStat?: string; memoryPeakBytes?: number } | null;
      const cpu = Number(resources?.cpuStat?.match(/usage_usec (\d+)/)?.[1]);
      return { caseId: row.caseId, repeatIndex: row.repeat, baseHead: item.baseHead, evaluatorBlob: item.evaluatorBlob, engineBinarySha256,
        imageDigest: `local/ayas-local-coding-inference@${inferenceId}`, modelDigest: pins.model.sha256,
        candidateSha256: typeof row.candidateSha256 === "string" ? row.candidateSha256 : "0".repeat(64),
        changedFiles: Array.isArray(row.changedFiles) ? row.changedFiles : [], changedLines: typeof row.changedLines === "number" ? row.changedLines : 0,
        outcome: row.outcome === "PASS" ? "PASS" : row.outcome === "TIMEOUT" ? "TIMEOUT" : "FAIL",
        regressionsPass: row.evaluatorExit === 0, negativeControlRejected: true,
        toolMisuseCount: row.toolMisuse === true ? 1 : 0, unauthorizedFileAccessCount: row.workspaceUnchanged === false ? 1 : 0,
        unauthorizedShellAttemptCount: 0, unauthorizedNetworkAttemptCount: 0, elapsedMs: Math.min(3_600_000, Number(row.totalMs)),
        cpuMs: Number.isFinite(cpu) ? cpu / 1000 : null, peakRamBytes: resources?.memoryPeakBytes ?? null, peakVramBytes: null };
    }) });
  const outcomes: Record<string, number> = {}; for (const row of attempts) outcomes[row.outcome] = (outcomes[row.outcome] ?? 0) + 1;
  return { matrixComplete: complete, evaluableCases: evaluable, repeatCount: REPEATS,
    passAt1: metrics?.passAt1Claimed ?? null, passPowerK: metrics?.passPowerKClaimed ?? null, heldOutPassAt1: metrics?.heldOutPassAt1Claimed ?? null,
    perCase: evaluable.map(caseId => { const rows = attempts.filter(row => row.caseId === caseId);
      return { caseId, split: bound.find(item => item.caseId === caseId)!.split, outcomes: rows.map(row => row.outcome),
        repeatedConsistency: rows.length === REPEATS && new Set(rows.map(row => `${row.outcome}:${row.candidateSha256 ?? row.reason}`)).size === 1 }; }),
    outcomes, timeouts: outcomes.TIMEOUT ?? 0, invalidOutput: outcomes.INVALID_OUTPUT ?? 0, schemaFailure: outcomes.SCHEMA_FAILURE ?? 0,
    scopeOrBudgetRefused: outcomes.SCOPE_OR_BUDGET_REFUSED ?? 0, unapplicablePatch: outcomes.UNAPPLICABLE_PATCH ?? 0, retries: 0,
    scopeViolationsReachingEvaluator: metrics?.scopeViolations ?? null, toolMisuse: metrics?.toolMisuse ?? null,
    unauthorizedFileAccess: metrics?.unauthorizedFileAccess ?? null, unauthorizedShellAttempts: metrics?.unauthorizedShellAttempts ?? null,
    unauthorizedNetworkAttempts: metrics?.unauthorizedNetworkAttempts ?? null,
    unauthorizedActivityBasis: "The model has no tool surface: one in-memory JSON patch object is parsed by the host. Each run asserts a loopback-only network namespace, read-only root/workspace, zero capabilities and an unchanged workspace digest.",
    wrongCandidateRejectionPreserved: true, latencyMs: metrics?.latencyMs ?? null, cpuMs: metrics?.cpuMs ?? null, peakRamBytes: metrics?.peakRamBytes ?? null,
    gpu: null, vram: null, gpuBasis: "Pinned engine is the official CPU archive; no GPU is passed into the rootless container.",
    summarizer: "summarizeAyasLocalCodingQualification (committed, unchanged); negativeControlRejected is taken from FROZEN_CONTAINER_NEGATIVE_CONTROLS.",
    canonicalNumericThreshold: null, thresholdDecision: "FAIL_CLOSED_NO_CANONICAL_NUMERIC_THRESHOLD", readiness: "LOCAL_INDEPENDENCE_DEGRADED" };
}
async function qualify(): Promise<void> {
  const evalId = hardenedEvaluatorImage(); const id = image("inference");
  const oracle = JSON.parse(fs.readFileSync(`${reportPath}/FROZEN_CONTAINER_NEGATIVE_CONTROLS.json`, "utf8"));
  assert.ok(oracle.imageId === evalId && oracle.allControlsValid === true, "CONTAINER_ORACLE_CONTROLS_NOT_VALID_FOR_THIS_IMAGE");
  const smokeEvidence = JSON.parse(fs.readFileSync(`${reportPath}/LLAMA_SERVER_SMOKE_EVIDENCE.json`, "utf8"));
  assert.ok(smokeEvidence.pass === true && smokeEvidence.imageId === id, "ENGINE_SMOKE_NOT_VALID_FOR_THIS_IMAGE");
  const evaluable: string[] = oracle.evaluable; const only = process.argv[4];
  // Small bounded batches: an optional cap on new heavy attempts in this invocation.
  let budget = process.argv[5] === undefined ? Number.POSITIVE_INFINITY : Number(process.argv[5]); assert.ok(budget >= 1, "ATTEMPT_BUDGET_INVALID");
  const cases = allCases.filter(item => evaluable.includes(item.caseId) && (!only || item.caseId === only));
  // The adapter owns the request contract and candidate validation: attempts are bound to its exact bytes.
  const adapterSha256 = sha(fs.readFileSync("src/lib/brain/autonomy/AyasLocalCodingModelAdapter.ts"));
  const runnerSha256 = sha(fs.readFileSync("scripts/run-ayas-local-coding-container.ts"));
  const binding = { imageId: id, evaluatorImageId: evalId, modelSha256: pins.model.sha256, adapterSha256, transportClientSha256: sha(httpClient(0)), timeoutMs: AYAS_LOCAL_CODING_MODEL_MAX_TIMEOUT_MS, serverArgs, profile: inference };
  // One recorded observation per (case, repeat): a resumed run keeps earlier attempts and never re-rolls them.
  const file = `${reportPath}/LOCAL_MODEL_RUN_EVIDENCE.json`;
  const prior = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  const sameBinding = !!prior && JSON.stringify(prior.binding) === JSON.stringify(binding);
  const attempts: Attempt[] = sameBinding ? prior.attempts : [];
  // Observations made under an earlier binding are kept, never dropped and never merged into this binding's metrics.
  // Only the request protocol (adapter) changed: they are real model observations under that earlier protocol.
  // Anything else changed (transport, limits, images): they are superseded harness records.
  const changed = prior && !sameBinding ? [...new Set([...Object.keys(binding), ...Object.keys(prior.binding)])].filter(key => JSON.stringify(prior.binding[key]) !== JSON.stringify((binding as Record<string, unknown>)[key])) : [];
  const carried = prior && !sameBinding ? (prior.attempts as Attempt[]).map(row => ({ ...row, carriedAt: new Date().toISOString(), earlierBinding: prior.binding, bindingFieldsChanged: changed })) : [];
  const protocolOnly = changed.length === 1 && changed[0] === "adapterSha256";
  const superseded: object[] = [...(prior?.supersededAttempts ?? []), ...(protocolOnly ? [] : carried)];
  const earlierProtocol: object[] = [...(prior?.earlierProtocolObservations ?? []), ...(protocolOnly ? carried : [])];
  const resourceAborts: object[] = prior?.resourceAborts ?? []; const hostProtectionEvents: object[] = prior?.hostProtectionEvents ?? [];
  const persist = (): void => writeReport("LOCAL_MODEL_RUN_EVIDENCE", { evidenceClass: "REAL_LOCAL_MODEL_ATTEMPTS_DIAGNOSTIC_NOT_ADMISSION", observedAt: new Date().toISOString(),
    repositoryHead: head(), binding, repeatCount: REPEATS, repeatCountAuthority: "diagnostic observation count only; canonical numerical repeat/quality threshold absent",
    timeoutAuthority: "operational kill bound derived from LLAMA_SERVER_SMOKE_EVIDENCE speeds; not a latency qualification threshold",
    notEvaluated: (oracle.platformUnavailable as string[]).map(caseId => ({ caseId, outcome: "PLATFORM_UNAVAILABLE", modelRequestSent: false,
      reason: "Frozen evaluator reports 0 scenarios/skipped on Linux; it is not rewritten, and a model candidate is not executed on the host." })),
    summary: summarize(attempts, evaluable, id), attempts, earlierProtocolObservations: earlierProtocol, supersededAttempts: superseded,
    // Host-protection aborts and pauses are resource events, not model observations: never counted as a model failure.
    resourceAborts, hostProtectionEvents, hostGuard: { maxHostUsedBeforeStart: HOST_MAX_USED, criticalFreeFraction: HOST_CRITICAL_FREE, oneHeavyWorkloadAtATime: true },
    readiness: "LOCAL_INDEPENDENCE_DEGRADED", stage15BOpened: false, productionRegistryChanged: false, cloudFallback: false });
  for (const item of cases) for (let repeat = 1; repeat <= REPEATS; repeat++) {
    if (attempts.some(row => row.caseId === item.caseId && row.repeat === repeat)) continue;
    if (budget-- <= 0) { persist(); console.log("ATTEMPT_BUDGET_REACHED_NOT_ADMISSION"); return; }
    let hostBefore;
    try { hostBefore = await awaitHostHeadroom(inference); }
    catch (error) { hostProtectionEvents.push({ at: new Date().toISOString(), caseId: item.caseId, repeat, event: String(error) }); persist(); throw error; }
    const task = item.domain === "MEMORY_RETRIEVAL" ? projectAyasLocalCodingRetrievalTask() : projectAyasLocalCodingQualificationTask(item);
    const workspace = createAyasLocalCodingWorkspace({ repoRoot: process.cwd(), task });
    const sources = task.exactFiles.map(file => ({ path: file, content: fs.readFileSync(path.join(workspace.root, file), "utf8") }));
    const workspaceBefore = workspaceDigest(workspace.root, task.exactFiles);
    const started = performance.now();
    const container = create(id, workspace.root, inference, "/opt/ayas/payload/engine/bin/llama-server", serverArgs);
    const createMs = performance.now() - started; let loadMs: number | null = null; let result: (Record<string, unknown> & { outcome: string }) | null = null;
    let rawResponse = ""; let metrics: unknown = null; let modelRequestSent = false; let requestSha256: string | null = null; let requestBytes: number | null = null;
    let model: Awaited<ReturnType<typeof diagnoseAyasLocalCodingModelWith>> | null = null; let workspaceUnchanged = false;
    let state: { Status?: string; ExitCode?: number; OOMKilled?: boolean } | null = null;
    const guard = new AbortController(); const watch = hostWatch(() => guard.abort()); let host: ReturnType<typeof watch.stop>;
    try {
      command(["start", container]);
      command(["exec", container, ...helperNode, "--input-type=module", "-e", waitHealthy], 305000);
      loadMs = performance.now() - started;
      command(["exec", container, ...helperNode, "-e", assertLive]);
      const generationStarted = performance.now();
      try {
        model = await diagnoseAyasLocalCodingModelWith({ task, sources, modelManifest: pins.model, signal: guard.signal,
          endpoint: "http://127.0.0.1:8080/v1/chat/completions", timeoutMs: AYAS_LOCAL_CODING_MODEL_MAX_TIMEOUT_MS,
          transport: async request => {
            modelRequestSent = true; requestSha256 = sha(request.body); requestBytes = Buffer.byteLength(request.body);
            rawResponse = await transport(container, request.body, request.signal, AYAS_LOCAL_CODING_MODEL_MAX_TIMEOUT_MS - 1000); return rawResponse;
          } });
      } catch (error) { throw Object.assign(error instanceof Error ? error : Error(String(error)), { generationMs: performance.now() - generationStarted }); }
    } catch (error) { result = { ...classify(error), generationMs: (error as { generationMs?: number }).generationMs ?? null }; }
    finally {
      // The model server is sampled and removed before anything else runs: one heavy workload at a time.
      try { metrics = json(["exec", container, ...helperNode, "-e", sampleCgroup]); } catch { metrics = { unavailable: "container exited before sampling" }; }
      fs.writeFileSync(path.join(root, `${item.caseId}-${repeat}-${Date.now()}-server.log`), containerLogs(container));
      if (rawResponse) fs.writeFileSync(path.join(root, `${item.caseId}-${repeat}-${Date.now()}-response.json`), rawResponse, { flag: "wx", mode: 0o444 });
      workspaceUnchanged = workspaceDigest(workspace.root, task.exactFiles) === workspaceBefore;
      try { state = json(["inspect", container])[0].State; }
      finally { try { cleanup(container); } finally { destroyAyasLocalCodingWorkspace(workspace); } }
      host = watch.stop(); releaseVmCache();
    }
    if (model) try {
      // Bounded candidate only: the strict adapter already refused scope, schema, budget and stale-base output in memory.
      const candidate = { caseId: item.caseId, sources: model.candidate.sources };
      const artifact = fs.mkdtempSync(path.join(root, "candidate-")); const bytes = JSON.stringify(candidate);
      fs.writeFileSync(path.join(artifact, "candidate.json"), bytes, { flag: "wx", mode: 0o444 });
      const evaluator = create(evalId, artifact, diagnostic, "/usr/local/bin/node", ["/opt/ayas/evaluate.cjs", item.caseId]);
      let evaluation; const evaluationStarted = performance.now();
      try { evaluation = spawnSync(podman, ["start", "--attach", evaluator], { encoding: "utf8", timeout: 60000, windowsHide: true, maxBuffer: 1000000 }); }
      finally { cleanup(evaluator); }
      assert.equal(sha(fs.readFileSync(path.join(artifact, "candidate.json"))), sha(bytes), "IMMUTABLE_CANDIDATE_ARTIFACT_CHANGED");
      const skipped = /"skipped"|"scenarios":0/.test(evaluation.stdout);
      result = { outcome: skipped ? "PLATFORM_UNAVAILABLE" : evaluation.status === 0 ? "PASS" : (evaluation.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" ? "EVALUATOR_TIMEOUT" : "FAIL",
        candidateSha256: sha(bytes), candidateArtifact: artifact, responseSha256: model.responseSha256, generationMs: model.elapsedMs,
        evaluationMs: performance.now() - evaluationStarted, changedFiles: model.candidate.patch.edits.map(edit => edit.path), changedLines: model.candidate.changedLines,
        patch: model.candidate.patch, evaluatorExit: evaluation.status, evaluatorStdout: evaluation.stdout.slice(-2000), evaluatorStderr: evaluation.stderr.slice(0, 4000),
        securityScope: "STRICT_ADAPTER_ACCEPTED_IN_MEMORY_ONLY", regression: "FULL_FROZEN_EVALUATOR_ONLY_NO_DECLARED_ADDITIONAL_MATRIX" };
    } catch (error) { result = { outcome: "EVALUATOR_RUNTIME_FAILURE", reason: String(error).slice(0, 800), generationMs: model.elapsedMs }; }
    const facts = rawResponse ? responseFacts(rawResponse) as { toolCalls?: (string | null)[] | null } : null;
    const record: Attempt = { caseId: item.caseId, split: item.split, domain: item.domain, repeat, imageId: id, evaluatorImageId: evalId, modelSha256: pins.model.sha256,
      evaluatorBlob: item.evaluatorBlob, baseHead: item.baseHead, harness: { repositoryHead: head(), runnerSha256, adapterSha256 }, observedAt: new Date().toISOString(),
      modelRequestSent, requestSha256, requestBytes, retries: 0, timeoutMs: AYAS_LOCAL_CODING_MODEL_MAX_TIMEOUT_MS,
      sandboxCreateMs: createMs, loadAndSandboxStartupMs: loadMs, totalMs: performance.now() - started, resources: metrics,
      serverState: state && { status: state.Status, exitCode: state.ExitCode, oomKilled: state.OOMKilled }, workspaceUnchanged,
      hostMemory: { before: hostBefore, ...host, afterCleanup: hostMemory() },
      toolMisuse: !!facts?.toolCalls?.length, response: facts, ...result! };
    if (host.aborted || state?.OOMKilled) {
      // Resource exhaustion says nothing about the model: keep the observation apart and leave this repeat pending.
      resourceAborts.push({ ...record, outcome: "RESOURCE_ABORT", protection: "HOST_PROTECTION", countedAsModelFailure: false,
        cause: host.aborted ? "host free memory stayed below the critical fraction" : "container OOM kill" });
      persist(); throw Error(`HOST_PROTECTION_PAUSE:RESOURCE_ABORT ${item.caseId}#${repeat}`);
    }
    attempts.push(record); persist();
    console.log(JSON.stringify({ caseId: record.caseId, repeat: record.repeat, outcome: record.outcome, reason: record.reason ?? null, generationMs: record.generationMs, totalMs: record.totalMs, hostPeakUsedPct: host.peakUsedPct }));
  }
  persist(); console.log("LOCAL_MODEL_ATTEMPTS_RECORDED_NOT_ADMISSION");
}
// A host-protection pause is a deliberate, resumable stop (exit 3); anything else is a failure (exit 1).
function stopped(error: unknown): void { console.error(String(error)); process.exitCode = /HOST_PROTECTION_PAUSE/.test(String(error)) ? 3 : 1; }
machineGuard();
if (process.argv[3] === "build-evaluator") build("evaluator");
else if (process.argv[3] === "build-inference") build("inference");
else if (process.argv[3] === "matrix") void matrix();
else if (process.argv[3] === "controls") controls();
else if (process.argv[3] === "smoke") smoke().catch(stopped);
else if (process.argv[3] === "qualify") qualify().catch(stopped);
else throw Error("EXPLICIT_DIAGNOSTIC_PHASE_REQUIRED");
