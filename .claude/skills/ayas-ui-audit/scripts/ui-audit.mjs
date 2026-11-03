// AYAS UI audit: drives headless Chromium over CDP (Node 24 global WebSocket, no dependencies).
// Visits each route, clicks only non-mutating controls (tabs, toggles, navigation), records errors.
// Usage: node ui-audit.mjs <baseUrl> <outDir> <routesJson>   (run-audit.mjs starts the isolated server and calls this)
// Env: AUDIT_KEY_FILE (log in first), AUDIT_PROBE (probe mode), AUDIT_ACTIONS (everyday buttons, isolated server only),
//      AUDIT_CHROME (chrome.exe; default: the newest Playwright Chromium already installed), AUDIT_CDP_PORT (9333).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const [baseUrl, outDir, routesArg] = process.argv.slice(2);
const routes = JSON.parse(routesArg);
mkdirSync(outDir, { recursive: true });

/** The newest Chromium Playwright already downloaded (nothing is downloaded here). */
function findChrome() {
  if (process.env.AUDIT_CHROME) return process.env.AUDIT_CHROME;
  const root = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  const dirs = existsSync(root) ? readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1])) : [];
  for (const d of dirs) {
    const exe = path.join(root, d, "chrome-win64", "chrome.exe");
    if (existsSync(exe)) return exe;
  }
  throw new Error(`No Chromium under ${root}; set AUDIT_CHROME to a chrome.exe`);
}
const CHROME = findChrome();
const PORT = Number(process.env.AUDIT_CDP_PORT ?? 9333);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(outDir, "..", "chrome-profile")}`,
  "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1440,1000", "about:blank",
], { stdio: "ignore" });

let targets;
for (let i = 0; i < 60; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.some((t) => t.type === "page")) break; } catch { /* not up yet */ }
  await sleep(500);
}
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pending = new Map();
const listeners = [];
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); return; }
  for (const l of listeners) l(msg);
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };

// --- event capture ---
let bucket = [];
const inflight = new Set();
let lastNet = Date.now();
let docStatus = 0;
listeners.push((m) => {
  const p = m.params ?? {};
  if (m.method === "Runtime.exceptionThrown") bucket.push({ kind: "exception", text: (p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? "").slice(0, 400) });
  if (m.method === "Runtime.consoleAPICalled" && p.type === "error") bucket.push({ kind: "console.error", text: p.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 400) });
  if (m.method === "Log.entryAdded" && p.entry.level === "error") bucket.push({ kind: "log.error", text: `${p.entry.text} ${p.entry.url ?? ""}`.slice(0, 400) });
  if (m.method === "Network.requestWillBeSent") { inflight.add(p.requestId); lastNet = Date.now(); }
  if (m.method === "Network.loadingFinished" || m.method === "Network.loadingFailed") { inflight.delete(p.requestId); lastNet = Date.now(); }
  if (m.method === "Network.loadingFailed" && !p.canceled && p.type !== "EventSource") bucket.push({ kind: "net.failed", text: `${p.errorText} ${p.type}` });
  if (m.method === "Network.responseReceived") {
    const u = p.response.url;
    if (p.type === "Document") docStatus = p.response.status;
    if (p.response.status >= 400 && !u.includes("favicon") && !u.includes("__nextjs")) bucket.push({ kind: `http ${p.response.status}`, text: `${p.type} ${u.replace(baseUrl, "")}`.slice(0, 300) });
  }
});
await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable"); await send("Log.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

async function settle(maxMs = 90_000, quietMs = 1500) {
  const start = Date.now();
  await sleep(300);
  while (Date.now() - start < maxMs) {
    // Long-lived streams (SSE/polling) keep requests open; treat "nothing new for quietMs" as settled.
    if (Date.now() - lastNet > quietMs) return;
    await sleep(200);
  }
}
let loaded = false;
listeners.push((m) => { if (m.method === "Page.loadEventFired") loaded = true; });
async function go(url) {
  docStatus = 0;
  loaded = false;
  await send("Page.navigate", { url });
  // A cold dev route compiles first: wait for the load event, then for the network to go quiet. The load event alone
  // is not enough: on a warm server about:blank's late load event arrived first and the login ran on a blank page.
  const origin = new URL(url).origin;
  const arrived = async () => {
    try {
      return (await evaluate("location.origin + '|' + document.readyState")) === `${origin}|complete`;
    } catch {
      return false;
    }
  };
  const start = Date.now();
  while (!(loaded && (await arrived())) && Date.now() - start < 240_000) await sleep(250);
  await settle();
  return docStatus;
}

// Text that marks a control as state-changing: never clicked, only listed.
const ACTION = /onayla|uygula|reddet|\bsil\b|silin|başlat|baslat|gönder|gonder|\büret|yayınla|yayinla|kaydet|çalıştır|calistir|yükle|yukle|\bdene\b|denemeye|iptal|geri al|rollback|indir|bağla|kur\b|ekle|oluştur|sipariş|siparis|durdur|sıfırla|çıkış|cikis|logout|onar|approve|apply|reject|delete|execute|\brun\b|start|send|submit|deploy|commit|push|publish|upload|save|reset|stop|create|install|retry|yeniden dene|kilidi|unlock|kabul|ertele|arşivle|tamamla|kapat ve|mikrofon|microphone|dinle|konuş|record|kayda|izin ver|grant|revoke|geri çek|enable|disable|aktif|pasif/i;
// Text that marks a control as safe to click (pure view state).
const SAFE = /göster|gizle|daha fazla|tümü|aç$|^aç|ayrıntı|detay|kapat$|^×$|^✕$|filtre|sekme|geri$|panel|menü|menu|yenile$|kopyala|copy|more|less|show|hide|details|expand|collapse|toggle|önceki|sonraki|next|prev|›|‹|→|←/i;

const enumerate = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const els = [...document.querySelectorAll('button, a[href], [role=button], [role=tab], summary, select, input[type=checkbox], input[type=radio]')].filter(vis);
  const seen = {};
  return els.map((el) => {
    const label = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.value || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || '';
    const key = tag + '|' + role + '|' + label;
    seen[key] = (seen[key] || 0) + 1;
    return { key, n: seen[key], tag, role, label, href: el.getAttribute('href') || '', disabled: !!(el.disabled || el.getAttribute('aria-disabled') === 'true'), type: el.getAttribute('type') || '', inForm: !!el.closest('form'), testid: el.getAttribute('data-testid') || '' };
  });
})()`;
const clickByKey = (key, n) => `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const els = [...document.querySelectorAll('button, a[href], [role=button], [role=tab], summary, select, input[type=checkbox], input[type=radio]')].filter(vis);
  let c = 0;
  for (const el of els) {
    const label = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.value || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
    const k = el.tagName.toLowerCase() + '|' + (el.getAttribute('role') || '') + '|' + label;
    if (k === ${JSON.stringify(key)} && ++c === ${n}) { el.scrollIntoView({ block: 'center' }); el.click(); return true; }
  }
  return false;
})()`;
const pageProblems = `(() => {
  const t = document.body ? document.body.innerText : '';
  const out = [];
  const portal = document.querySelector('nextjs-portal');
  if (portal && portal.shadowRoot) {
    const s = portal.shadowRoot.textContent || '';
    if (/Unhandled Runtime Error|Runtime Error|Build Error|Console Error|Server Error/i.test(s)) out.push('next overlay: ' + s.replace(/\\s+/g, ' ').slice(0, 300));
    const badge = portal.shadowRoot.querySelector('[data-issues-count], [data-nextjs-dev-tools-button]');
    const cnt = portal.shadowRoot.querySelector('[data-issues-count]');
    if (cnt && Number(cnt.textContent) > 0) out.push('next issues badge: ' + cnt.textContent);
  }
  for (const pat of ['Application error', 'Internal Server Error', 'This page could not be found', 'Unhandled Runtime Error', 'Something went wrong', 'Bir hata oluştu']) if (t.includes(pat)) out.push('page text: ' + pat);
  return { title: document.title, url: location.href, problems: out, textLen: t.length };
})()`;

// Log in with the throwaway test key (never printed), exactly like the login form's JSON path.
if (process.env.AUDIT_KEY_FILE) {
  const { readFileSync } = await import("node:fs");
  const key = readFileSync(process.env.AUDIT_KEY_FILE, "utf8").trim();
  await go(`${baseUrl}/login`);
  const ok = await evaluate(`fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: ${JSON.stringify(key)} }) }).then((r) => r.status)`);
  console.log(`login: HTTP ${ok}`);
}

// Probe mode: for each {route, label} click every control whose label matches, each on a freshly loaded page.
if (process.env.AUDIT_PROBE) {
  const probes = JSON.parse(process.env.AUDIT_PROBE);
  const out = [];
  for (const { route, label } of probes) {
    await go(baseUrl + route);
    const matches = (await evaluate(enumerate)).filter((c) => new RegExp(label).test(c.label));
    for (const c of matches) {
      bucket = [];
      await go(baseUrl + route);
      const loadErrs = bucket; bucket = [];
      const state = `(() => { const els = [...document.querySelectorAll('summary')].filter((s) => s.innerText.replace(/\\s+/g, ' ').trim().slice(0, 80) === ${JSON.stringify(c.label)}); const s = els[${c.n - 1}]; return s ? !!s.parentElement.open : null; })()`;
      const before = await evaluate(state);
      const clicked = await evaluate(clickByKey(c.key, c.n));
      await settle(30_000, 1000);
      const after = await evaluate(state);
      const probs = (await evaluate(pageProblems)).problems;
      out.push({ route, label: c.label, n: c.n, clicked, openBefore: before, openAfter: after, loadErrs, errors: bucket, probs });
      console.log(`${route} | ${c.label} #${c.n}: clicked=${clicked} open ${before}→${after} errors=${bucket.length} loadErrors=${loadErrs.length} ${probs.join(";")}`);
    }
  }
  writeFileSync(path.join(outDir, "probe.json"), JSON.stringify(out, null, 1));
  ws.close(); chrome.kill(); process.exit(0);
}

// Action mode (isolated test server only): the owner's everyday buttons, pressed for real.
if (process.env.AUDIT_ACTIONS) {
  const log = (s) => console.log(s);
  const errs = () => { const b = bucket; bucket = []; return b.length ? ` ERRORS ${JSON.stringify(b).slice(0, 400)}` : ""; };
  const activeTab = `(() => { const t = document.querySelector('[role=tab][aria-selected=true]'); return (t ? t.innerText.replace(/\\s+/g,' ').trim() : '-') + ' @ ' + location.search; })()`;

  // 1. Control Center domain cards open their panel.
  await go(`${baseUrl}/brain?panel=chat`); bucket = [];
  const cards = await evaluate(`[...document.querySelectorAll('button[data-testid^=bc-cc-domain-]')].map((b) => b.dataset.testid)`);
  for (const id of cards) {
    await go(`${baseUrl}/brain?panel=chat`); bucket = [];
    await evaluate(`document.querySelector('[data-testid=${id}]').click()`);
    await settle(30_000, 1000);
    log(`kart ${id} → ${await evaluate(activeTab)}${errs()}`);
  }

  // 2. Homepage view switches.
  for (const label of ["Görevler", "Konuş"]) {
    await go(`${baseUrl}/`); bucket = [];
    const ok = await evaluate(`(() => { const b = [...document.querySelectorAll('button,[role=tab]')].find((x) => x.innerText.replace(/\\s+/g,' ').trim().endsWith(${JSON.stringify(label)})); if (!b) return 'yok'; b.click(); return 'tıklandı'; })()`);
    await settle(30_000, 1000);
    const shown = await evaluate(`[...document.querySelectorAll('[aria-selected=true],[aria-pressed=true],[aria-current]')].map((x) => x.innerText.replace(/\\s+/g,' ').trim().slice(0, 30)).join(' | ')`);
    log(`ana sayfa "${label}": ${ok}; seçili: ${shown}${errs()}`);
  }

  // 3. Chat: type and press Gönder; wait for AYAS's answer.
  await go(`${baseUrl}/brain?panel=chat`); bucket = [];
  const before = await evaluate(`document.querySelector('[data-testid=bc-chat-log]').innerText.length`);
  await evaluate(`document.querySelector('[data-testid=bc-input]').focus()`);
  await send("Input.insertText", { text: "merhaba, kısa bir cümleyle durumunu söyler misin?" });
  await sleep(300);
  await evaluate(`document.querySelector('[data-testid=bc-send]').click()`);
  const t0 = Date.now();
  let answer = "";
  while (Date.now() - t0 < 180_000) {
    await sleep(2000);
    const st = await evaluate(`({ pending: document.querySelector('[data-testid=bc-send]').disabled, log: document.querySelector('[data-testid=bc-chat-log]').innerText })`);
    if (!st.pending && st.log.length > before + 60) { answer = st.log.slice(-400); break; }
  }
  log(`sohbet: ${answer ? `yanıt geldi (${Math.round((Date.now() - t0) / 1000)} sn): …${answer.replace(/\s+/g, " ").slice(-200)}` : "180 sn içinde yanıt yok"}${errs()}`);

  // 4. Briefing "Gördüm" (records an acknowledgement in the test server's own store).
  await go(`${baseUrl}/brain/briefing`); bucket = [];
  const ack = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].filter((x) => x.innerText.trim() === 'Gördüm'); const en = b.filter((x) => !x.disabled); if (!en.length) return 'Gördüm: ' + b.length + ' düğme, hepsi pasif'; en[0].click(); return 'tıklandı'; })()`);
  await settle(30_000, 1500);
  const seen = await evaluate(`[...document.querySelectorAll('button')].filter((x) => x.innerText.trim() === 'Görüldü').length`);
  log(`brifing: ${ack}; "Görüldü" sayısı ${seen}${errs()}`);

  // 5. Çıkış logs out.
  await go(`${baseUrl}/brain?panel=chat`); bucket = [];
  await evaluate(`[...document.querySelectorAll('button,a')].find((x) => x.innerText.trim() === 'Çıkış').click()`);
  await settle(30_000, 1500);
  await go(`${baseUrl}/brain?panel=chat`);
  log(`çıkış sonrası /brain → ${await evaluate("location.pathname + location.search")}${errs()}`);
  ws.close(); chrome.kill(); process.exit(0);
}

const report = [];
for (const route of routes) {
  const url = baseUrl + route;
  bucket = [];
  const status = await go(url);
  const loadErrors = bucket; bucket = [];
  const info = await evaluate(pageProblems).catch((e) => ({ problems: [`eval failed: ${e.message}`] }));
  const shot = path.join(outDir, `${route.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home"}.png`);
  const png = await send("Page.captureScreenshot", { format: "png" }).catch(() => null);
  if (png) writeFileSync(shot, Buffer.from(png.data, "base64"));
  const controls = await evaluate(enumerate).catch(() => []);
  const entry = { route, status, title: info.title, finalUrl: info.url, textLen: info.textLen, pageProblems: info.problems, loadErrors, controls: [], links: [], actions: [] };
  for (const c of controls) {
    if (c.tag === "a") { entry.links.push(`${c.label} → ${c.href}`); continue; }
    const isAction = c.type === "submit" || ACTION.test(c.label) || (c.inForm && !SAFE.test(c.label) && c.role !== "tab");
    const isSafe = c.role === "tab" || c.tag === "summary" || SAFE.test(c.label) || c.testid.startsWith("bc-tab-");
    if (isAction || !isSafe || c.tag === "select" || c.tag === "input") { entry.actions.push({ label: c.label || `(${c.tag} ${c.testid})`, disabled: c.disabled, testid: c.testid }); continue; }
    // Safe control: click it, see what happens, then restore the route.
    bucket = [];
    const before = await evaluate("location.href");
    const clicked = await evaluate(clickByKey(c.key, c.n)).catch(() => false);
    await settle(30_000, 1000);
    const after = await evaluate("location.href").catch(() => "?");
    const probs = (await evaluate(pageProblems).catch(() => ({ problems: [] }))).problems;
    entry.controls.push({ label: c.label, role: c.role, clicked, navigated: after !== before ? after.replace(baseUrl, "") : "", errors: bucket, problems: probs });
    if (after !== before) await go(url);
  }
  report.push(entry);
  console.log(`${route}: HTTP ${status}, ${entry.loadErrors.length} load errors, ${entry.pageProblems.length} page problems, clicked ${entry.controls.length}, actions ${entry.actions.length}, links ${entry.links.length}`);
  writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 1));
}
ws.close();
chrome.kill();
process.exit(0);
