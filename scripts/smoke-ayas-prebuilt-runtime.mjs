import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { qualifyPrebuiltRuntime, verifyPrebuiltRuntime, verifyPinnedTunnel } from './ayas-prebuilt-runtime.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ayas-prebuilt-smoke-'));
const repo = path.join(temp, 'Atölye fixture');
const manifest = path.join(temp, 'qualified.json');
const cloud = path.join(temp, 'cloudflared.exe');
const config = path.join(temp, 'tunnel.yml');
let scenarios = 0;
const put = (name, value) => { const target = path.join(repo, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value); };
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();
const check = () => verifyPrebuiltRuntime(repo, manifest, cloud, config);
function scenario(name, action) { action(); scenarios += 1; console.log(`PASS ${name}`); }
function changed(file, value, code = 'AYAS_PREBUILT_RUNTIME_CHANGED') {
  const target = path.join(repo, file);
  const before = fs.readFileSync(target);
  fs.writeFileSync(target, value);
  try { assert.throws(check, new RegExp(code)); } finally { fs.writeFileSync(target, before); }
}
try {
  put('app/page.tsx', 'original app'); put('src/core.ts', 'original core');
  put('package.json', '{"name":"fixture"}');
  put('package-lock.json', '{"packages":{"node_modules/next":{"version":"16.3.8"}}}');
  put('node_modules/next/package.json', '{"version":"16.2.10"}');
  put('node_modules/next/dist/bin/next', 'next cli');
  put('node_modules/react/index.js', 'react');
  put('.next/BUILD_ID', 'qualified-build'); put('.next/server/page.js', 'built page');
  put('.next/static/app.js', 'built client'); put('.next/cache/state', 'cache before');
  fs.writeFileSync(cloud, 'existing tunnel executable'); fs.writeFileSync(config, 'existing config');
  git('init', '--quiet'); git('add', 'app', 'src', 'package.json', 'package-lock.json');
  git('-c', 'user.name=AYAS fixture', '-c', 'user.email=fixture@invalid.example', 'commit', '--quiet', '-m', 'fixture');
  put('.next/ayas-build-stamp.json', JSON.stringify({ treeState: 'CLEAN', gitHead: git('rev-parse', 'HEAD'),
    lockfileSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, 'package-lock.json'))).digest('hex') }));
  scenario('explicit qualification pins existing mismatch without upgrading', () => {
    const result = qualifyPrebuiltRuntime(repo, manifest, cloud, config);
    assert.equal(result.installedNext, '16.2.10'); assert.equal(result.lockedNext, '16.3.8');
    assert.deepEqual(check(), result);
  });
  scenario('qualification never overwrites prior proof', () => assert.throws(() => qualifyPrebuiltRuntime(repo, manifest, cloud, config), /QUALIFICATION_EXISTS/));
  scenario('server modification refused', () => changed('.next/server/page.js', 'changed'));
  scenario('client modification refused', () => changed('.next/static/app.js', 'changed'));
  scenario('build identifier change refused', () => changed('.next/BUILD_ID', 'other build'));
  scenario('Next CLI modification refused', () => changed('node_modules/next/dist/bin/next', 'changed'));
  scenario('non-Next dependency modification refused', () => changed('node_modules/react/index.js', 'changed'));
  scenario('source drift refused without rebuilding', () => changed('src/core.ts', 'changed', 'APPLICATION_SOURCE_CHANGED'));
  scenario('lock drift refused before startup', () => changed('package-lock.json', '{}', 'STAMP_UNVERIFIED'));
  scenario('extra output refused', () => { put('.next/server/extra.js', 'extra'); try { assert.throws(check, /RUNTIME_CHANGED/); } finally { fs.unlinkSync(path.join(repo, '.next/server/extra.js')); } });
  scenario('missing dependency refused', () => { const target = path.join(repo, 'node_modules/react/index.js'); const bytes = fs.readFileSync(target); fs.unlinkSync(target); try { assert.throws(check, /RUNTIME_CHANGED/); } finally { fs.writeFileSync(target, bytes); } });
  scenario('cache changes do not invalidate production output', () => { put('.next/cache/state', 'cache after'); check(); });
  scenario('build stamp dirty refused', () => changed('.next/ayas-build-stamp.json', '{}', 'STAMP_UNVERIFIED'));
  scenario('tunnel configuration change refused', () => { const value = fs.readFileSync(config); fs.writeFileSync(config, 'changed'); try { assert.throws(check, /RUNTIME_CHANGED/); } finally { fs.writeFileSync(config, value); } });
  scenario('malformed qualification refused', () => { const value = fs.readFileSync(manifest); fs.writeFileSync(manifest, '{}'); try { assert.throws(check, /RUNTIME_CHANGED/); } finally { fs.writeFileSync(manifest, value); } });
  scenario('external build junction refused', () => {
    const link = path.join(repo, '.next/node_modules/external'); fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(temp, link, 'junction');
    try { assert.throws(check, /LINK_REFUSED/); } finally { fs.unlinkSync(link); }
  });
  scenario('new internal junction changes pinned structure', () => {
    const link = path.join(repo, '.next/node_modules/react');
    fs.symlinkSync(path.join(repo, 'node_modules/react'), link, 'junction');
    try { assert.throws(check, /RUNTIME_CHANGED/); } finally { fs.unlinkSync(link); }
  });
  scenario('restored original still verifies', check);
  scenario('tunnel recovery uses its own qualified executable and configuration', () => verifyPinnedTunnel(repo, manifest, cloud, config));
  scenario('tunnel-only check refuses configuration drift', () => {
    const value = fs.readFileSync(config); fs.writeFileSync(config, 'changed');
    try { assert.throws(() => verifyPinnedTunnel(repo, manifest, cloud, config), /TUNNEL_CHANGED/); } finally { fs.writeFileSync(config, value); }
  });
} finally {
  if (path.dirname(temp) !== os.tmpdir() || !path.basename(temp).startsWith('ayas-prebuilt-smoke-')) throw new Error('unsafe fixture cleanup');
  fs.rmSync(temp, { recursive: true });
}
console.log(`AYAS prebuilt runtime smoke: PASS (${scenarios} scenarios)`);
