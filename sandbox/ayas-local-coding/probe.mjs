// Actual container observations only. The host must separately inspect OCI settings.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import dns from 'node:dns/promises';
import { spawn, spawnSync } from 'node:child_process';

const rows = [];
function observed(name, fn) {
  try { const detail = fn(); rows.push({ name, pass: true, detail }); }
  catch (error) { rows.push({ name, pass: false, detail: String(error) }); }
}
function denied(fn, codes) {
  let error;
  try { fn(); } catch (e) { error = e; }
  assert.ok(error && codes.includes(error.code), `expected ${codes}, got ${error?.code}`);
  return error.code;
}
const read = file => fs.readFileSync(file, 'utf8').trim();
if (process.argv[2] === 'sleep') { setInterval(() => {}, 1000); }
else if (process.argv[2] === 'memory') {
  console.log(JSON.stringify({ before: read('/sys/fs/cgroup/memory.max') }));
  // Touch actual pages, not just reserve virtual address space; bounded to 512 MiB.
  const allocated = [];
  for (let i = 0; i < 64; i++) allocated.push(Buffer.alloc(8 * 1024 * 1024, 0x5a));
  console.log('MEMORY_LIMIT_FAILED');
} else {
  observed('intended-temp-read', () => { assert.equal(read('/workspace/probe.txt'), 'AYAS_TEMP_ONLY'); return 'exact mounted sentinel'; });
  observed('intended-temp-write', () => { fs.writeFileSync('/tmp/allowed.txt', 'allowed', { flag: 'wx' }); assert.equal(read('/tmp/allowed.txt'), 'allowed'); return '/tmp tmpfs'; });
  observed('readonly-workspace', () => denied(() => fs.writeFileSync('/workspace/forbidden.txt', 'x'), ['EROFS']));
  observed('readonly-root', () => denied(() => fs.writeFileSync('/root-write.txt', 'x'), ['EROFS', 'EACCES']));
  for (const file of ['/workspace/.git/config', '/root/.ssh/id_rsa', '/home/user/.ssh/id_ed25519', '/root/.aws/credentials', '/host-repo/README.md', '/mnt/c/Users/Metod/.env', '/workspace/../host-private-canary.txt']) {
    observed(`absent-host:${file}`, () => denied(() => fs.readFileSync(file), ['ENOENT', 'EACCES']));
  }
  observed('environment-no-secrets', () => { const allowed = ['PATH','HOME','ATOLYE_RUNTIME_ROOT','HOSTNAME','container','TERM']; assert.deepEqual(Object.keys(process.env).filter(k => !allowed.includes(k)), []); return Object.keys(process.env); });
  observed('symlink-host-escape', () => { fs.symlinkSync('/mnt/c/Users/Metod/.ssh/id_rsa', '/tmp/escape'); return denied(() => fs.readFileSync('/tmp/escape'), ['ENOENT']); });
  observed('no-package-manager', () => { const r = spawnSync('npm', ['--version']); assert.equal(r.error?.code, 'ENOENT'); assert.ok(!fs.existsSync('/usr/bin/apt') && !fs.existsSync('/bin/sh')); return 'npm/apt/shell absent from scratch image'; });
  observed('nonroot-root-escalation', () => { assert.equal(process.getuid(), 65534); return denied(() => process.setuid(0), ['EPERM']); });
  observed('capabilities-no-new-privileges-seccomp', () => {
    const s = read('/proc/self/status');
    for (const key of ['CapInh','CapPrm','CapEff','CapBnd','CapAmb']) assert.match(s, new RegExp(`${key}:\\s+0{16}`));
    assert.match(s, /NoNewPrivs:\s+1/); assert.match(s, /Seccomp:\s+2/);
    return s.split('\n').filter(l => /^(Cap|NoNewPrivs|Seccomp)/.test(l));
  });
  observed('privileged-kernel-write', () => denied(() => fs.writeFileSync('/proc/sys/kernel/ns_last_pid', '1'), ['EROFS', 'EACCES', 'EPERM']));
  observed('cgroup-limits', () => {
    assert.equal(read('/sys/fs/cgroup/pids.max'), '64'); assert.equal(read('/sys/fs/cgroup/memory.max'), '4294967296');
    assert.equal(read('/sys/fs/cgroup/cpu.max'), '200000 100000');
    return { pids: read('/sys/fs/cgroup/pids.max'), memory: read('/sys/fs/cgroup/memory.max'), cpu: read('/sys/fs/cgroup/cpu.max') };
  });
  observed('registered-frozen-evaluator', () => {
    const r = spawnSync(process.execPath, ['/opt/ayas/evaluate.cjs', 'historical-atomic-bounded-write-oracle'], { encoding: 'utf8', timeout: 30000, maxBuffer: 1000000 });
    assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /scenarios.*18|18 scenarios/);
    return { status: r.status, stdout: r.stdout };
  });
  // Neither a refused connection nor a DNS error alone proves isolation. Check interfaces too.
  observed('network-namespace-loopback-only', () => {
    const interfaces = fs.readdirSync('/sys/class/net'); assert.deepEqual(interfaces, ['lo']);
    return { interfaces, routes: read('/proc/net/route') };
  });
  try {
    await new Promise((resolve, reject) => {
      const socket = net.connect({ host: '1.1.1.1', port: 443 });
      socket.setTimeout(2000, () => { socket.destroy(); reject(Error('NETWORK_TIMEOUT_NOT_PROOF')); });
      socket.once('connect', () => { socket.destroy(); reject(Error('NETWORK_REACHABLE')); });
      socket.once('error', error => { if (['ENETUNREACH','EHOSTUNREACH'].includes(error.code)) resolve(error.code); else reject(error); });
    }).then(code => rows.push({ name: 'network-connect', pass: true, detail: code }));
  } catch (error) { rows.push({ name: 'network-connect', pass: false, detail: String(error) }); }
  const resolver = new dns.Resolver({ timeout: 1500, tries: 1 }); resolver.setServers(['1.1.1.1']);
  try { await resolver.resolve4('example.com'); rows.push({ name: 'dns', pass: false, detail: 'DNS reachable' }); }
  catch (error) { rows.push({ name: 'dns', pass: ['ECONNREFUSED','ETIMEOUT','EAI_AGAIN'].includes(error.code), detail: { code: error.code, networkNamespaceHasOnlyLoopback: fs.readdirSync('/sys/class/net') } }); }
  // Bounded stress: <=20 children. Node threads make the kernel's 64-task cap observable.
  const children = []; let refused = false;
  for (let i = 0; i < 20; i++) {
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'pipe' }); children.push(child);
    child.on('error', error => { if (error.code === 'EAGAIN') refused = true; });
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const events = read('/sys/fs/cgroup/pids.events');
  const peak = read('/sys/fs/cgroup/pids.peak');
  for (const child of children) child.kill('SIGKILL');
  await new Promise(resolve => setTimeout(resolve, 300));
  rows.push({ name: 'excessive-process-pid-cap', pass: Number(events.match(/max (\d+)/)?.[1]) > 0 && Number(peak) <= 64, detail: { events, peak, refused } });
  console.log(JSON.stringify({ evidenceClass: 'REAL_CONTAINER_OBSERVATIONS_NOT_ADMISSION', rows }));
  if (rows.some(row => !row.pass)) process.exitCode = 1;
}
