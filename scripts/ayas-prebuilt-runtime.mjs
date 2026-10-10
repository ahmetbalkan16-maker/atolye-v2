import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Qualification is an explicit maintenance action. Startup only verifies it;
// this module never installs, builds, launches, deletes or reads data/brain.
const HASH_BUFFER = Buffer.allocUnsafe(1024 * 1024);
function sha(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('AYAS_PREBUILT_UNSAFE_FILE');
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    let size;
    while ((size = fs.readSync(fd, HASH_BUFFER, 0, HASH_BUFFER.length, null))) hash.update(HASH_BUFFER.subarray(0, size));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

function tree(root, prefix, ignore) {
  const digest = crypto.createHash('sha256');
  let files = 0;
  let bytes = 0;
  function visit(relative) {
    const absolute = path.join(root, relative);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      // Turbopack's build output contains a junction to the same pinned
      // dependency tree. Never follow an external or arbitrary link.
      const target = fs.realpathSync.native(absolute);
      const dependencyRelative = path.relative(path.join(root, 'node_modules'), target);
      if (!relative.startsWith('.next/node_modules/') || !dependencyRelative ||
          dependencyRelative === '..' || dependencyRelative.startsWith(`..${path.sep}`) || path.isAbsolute(dependencyRelative)) {
        throw new Error('AYAS_PREBUILT_LINK_REFUSED');
      }
      digest.update(JSON.stringify([relative, 'pinned-dependency-link', dependencyRelative]) + '\n');
      return;
    }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) {
        const child = `${relative}/${name}`;
        if (!ignore.has(child)) visit(child);
      }
    } else if (stat.isFile()) {
      digest.update(JSON.stringify([relative, stat.size, sha(absolute)]) + '\n');
      files += 1;
      bytes += stat.size;
    } else { throw new Error('AYAS_PREBUILT_UNSAFE_FILE'); }
  }
  visit(prefix);
  return { hash: digest.digest('hex'), files, bytes };
}

export function collectPrebuiltRuntime(repoRoot, cloudflaredExe, tunnelConfig) {
  const root = fs.realpathSync.native(repoRoot);
  const stamp = JSON.parse(fs.readFileSync(path.join(root, '.next/ayas-build-stamp.json'), 'utf8'));
  const lockHash = sha(path.join(root, 'package-lock.json'));
  if (stamp.treeState !== 'CLEAN' || !/^[a-f0-9]{40}$/.test(stamp.gitHead) || stamp.lockfileSha256 !== lockHash) {
    throw new Error('AYAS_PREBUILT_STAMP_UNVERIFIED');
  }
  const drift = execFileSync('git', ['diff', '--name-only', stamp.gitHead, '--', 'app', 'src', 'package.json', 'package-lock.json'], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000,
  }).trim();
  if (drift) throw new Error('AYAS_PREBUILT_APPLICATION_SOURCE_CHANGED');
  const buildId = fs.readFileSync(path.join(root, '.next/BUILD_ID'), 'utf8').trim();
  if (!buildId) throw new Error('AYAS_PREBUILT_BUILD_MISSING');
  const installedNext = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/next/package.json'), 'utf8')).version;
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  return {
    schemaVersion: 1, repoRoot: root, buildHead: stamp.gitHead, buildId, lockHash,
    nodeExecutable: process.execPath, nodeHash: sha(process.execPath), installedNext,
    lockedNext: lock.packages['node_modules/next'].version,
    // All dependencies and production output are paired, including extra files.
    // Only Next's mutable cache/traces and dependency caches are excluded.
    build: tree(root, '.next', new Set(['.next/cache', '.next/trace', '.next/trace-build', '.next/diagnostics'])),
    dependencies: tree(root, 'node_modules', new Set(['node_modules/.cache'])),
    cloudflaredExe: fs.realpathSync.native(cloudflaredExe), cloudflaredHash: sha(cloudflaredExe),
    tunnelConfig: path.resolve(tunnelConfig), tunnelConfigHash: sha(tunnelConfig),
  };
}

export function qualifyPrebuiltRuntime(repoRoot, manifestPath, cloudflaredExe, tunnelConfig) {
  if (fs.existsSync(manifestPath)) throw new Error('AYAS_PREBUILT_QUALIFICATION_EXISTS');
  const qualified = collectPrebuiltRuntime(repoRoot, cloudflaredExe, tunnelConfig);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(qualified, null, 2) + '\n', { flag: 'wx' });
  return qualified;
}

export function verifyPrebuiltRuntime(repoRoot, manifestPath, cloudflaredExe, tunnelConfig) {
  const stat = fs.lstatSync(manifestPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw new Error('AYAS_PREBUILT_MANIFEST_INVALID');
  const expected = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const actual = collectPrebuiltRuntime(repoRoot, cloudflaredExe, tunnelConfig);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('AYAS_PREBUILT_RUNTIME_CHANGED');
  return actual;
}

export function verifyPinnedTunnel(repoRoot, manifestPath, cloudflaredExe, tunnelConfig) {
  const stat = fs.lstatSync(manifestPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw new Error('AYAS_PREBUILT_MANIFEST_INVALID');
  const expected = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (expected.schemaVersion !== 1 || expected.repoRoot !== fs.realpathSync.native(repoRoot) ||
      expected.cloudflaredExe !== fs.realpathSync.native(cloudflaredExe) || expected.cloudflaredHash !== sha(cloudflaredExe) ||
      expected.tunnelConfig !== path.resolve(tunnelConfig) || expected.tunnelConfigHash !== sha(tunnelConfig)) {
    throw new Error('AYAS_PREBUILT_TUNNEL_CHANGED');
  }
  return expected;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, repoRoot, manifestPath, cloudflaredExe, tunnelConfig, ...extra] = process.argv.slice(2);
    if (!['--qualify', '--check', '--check-tunnel'].includes(mode) || !repoRoot || !manifestPath || !cloudflaredExe || !tunnelConfig || extra.length) {
      throw new Error('AYAS_PREBUILT_ARGUMENT_INVALID');
    }
    const result = mode === '--qualify'
      ? qualifyPrebuiltRuntime(repoRoot, manifestPath, cloudflaredExe, tunnelConfig)
      : mode === '--check-tunnel' ? verifyPinnedTunnel(repoRoot, manifestPath, cloudflaredExe, tunnelConfig)
        : verifyPrebuiltRuntime(repoRoot, manifestPath, cloudflaredExe, tunnelConfig);
    console.log(JSON.stringify({ status: 'PASS', buildId: result.buildId, installedNext: result.installedNext,
      lockedNext: result.lockedNext, buildFiles: result.build.files, dependencyFiles: result.dependencies.files }));
  } catch (error) {
    console.error(error instanceof Error && /^AYAS_PREBUILT_[A-Z_]+$/.test(error.message) ? error.message : 'AYAS_PREBUILT_CHECK_FAILED');
    process.exitCode = 1;
  }
}
