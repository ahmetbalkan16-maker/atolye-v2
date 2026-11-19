/**
 * AYAS Content-Security-Policy (owner approval 19 Nov 2026; open since the 14 Nov 2026 security audit). A per-request
 * nonce from `middleware.ts`, on the response and on the request Next renders from, so Next stamps it on its own
 * scripts and nothing else runs. Source + in-process middleware only: no server, no browser, no network (the browser
 * side is proven by the UI audit on a production build).
 *
 * Run: npx tsx scripts/smoke-ayas-content-security-policy.ts
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { NextRequest } from "next/server";

import { issueSession } from "../src/lib/auth/accessGate";
import {
  buildContentSecurityPolicy,
  contentSecurityPolicyFor,
  newContentSecurityPolicyNonce,
  ONNXRUNTIME_WEB_FOR_TRANSFORMERS,
  resolveContentSecurityPolicyMode,
} from "../src/lib/auth/contentSecurityPolicy";
import { middleware } from "../middleware";

const REPO_ROOT = path.resolve(__dirname, "..");
const KEY = "correct-horse-battery-staple-xyz";

let count = 0;
async function scenario(name: string, run: () => unknown | Promise<unknown>): Promise<void> {
  await run();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function directives(policy: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of policy.split(";").map((p) => p.trim()).filter(Boolean)) {
    const [name, ...values] = part.split(/\s+/);
    assert.ok(!out.has(name!), `directive ${name} appears once`);
    out.set(name!, values);
  }
  return out;
}

/** What Next reads the nonce from (`getScriptNonceFromHeader`): the first `'nonce-…'` of script-src. */
function nonceOf(policy: string): string | undefined {
  return directives(policy).get("script-src")?.map((v) => /^'nonce-([^']+)'$/.exec(v)?.[1]).find(Boolean);
}

async function withEnv<T>(env: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await run();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function main(): Promise<void> {
  await scenario("production policy: scripts only from us + the nonce; no unsafe-inline / unsafe-eval; strict defaults", () => {
    const nonce = newContentSecurityPolicyNonce();
    const d = directives(buildContentSecurityPolicy({ nonce, development: false }));
    const script = d.get("script-src")!;
    assert.ok(script.includes("'self'") && script.includes(`'nonce-${nonce}'`));
    assert.ok(!script.includes("'unsafe-inline'"), "no inline scripts without the nonce");
    assert.ok(!script.includes("'unsafe-eval'"), "no eval in production");
    assert.ok(!script.some((v) => v === "https:" || v === "*" || v.endsWith("jsdelivr.net") || v.endsWith("jsdelivr.net/")), "no whole CDN or scheme");
    assert.ok(script.includes("'wasm-unsafe-eval'"), "WebAssembly for the wake engine and the phone model lab");
    assert.deepEqual(d.get("default-src"), ["'self'"]);
    assert.deepEqual(d.get("object-src"), ["'none'"]);
    assert.deepEqual(d.get("base-uri"), ["'self'"]);
    assert.deepEqual(d.get("form-action"), ["'self'"]);
    assert.deepEqual(d.get("frame-ancestors"), ["'self'"], "same rule as X-Frame-Options: SAMEORIGIN");
    assert.deepEqual(d.get("worker-src"), ["'self'", "blob:"]);
    assert.ok(!d.get("connect-src")!.some((v) => v === "ws:" || v === "wss:" || v === "*" || v === "https:"), "no open connect in production");
  });

  await scenario("development adds only eval (React dev tooling) and websockets (HMR)", () => {
    const nonce = newContentSecurityPolicyNonce();
    const prod = directives(buildContentSecurityPolicy({ nonce, development: false }));
    const dev = directives(buildContentSecurityPolicy({ nonce, development: true }));
    assert.deepEqual(dev.get("script-src"), [...prod.get("script-src")!, "'unsafe-eval'"]);
    assert.deepEqual(dev.get("connect-src"), [...prod.get("connect-src")!, "ws:", "wss:"]);
    for (const name of prod.keys()) if (name !== "script-src" && name !== "connect-src") assert.deepEqual(dev.get(name), prod.get(name), name);
  });

  await scenario("the phone LLM gateway Worker is allowed only as an https origin", () => {
    const nonce = newContentSecurityPolicyNonce();
    const connect = (url?: string) => directives(buildContentSecurityPolicy({ nonce, development: false, phoneWorkerUrl: url })).get("connect-src")!;
    assert.ok(connect("https://ayas-phone-gateway.example.workers.dev/some/path?x=1").includes("https://ayas-phone-gateway.example.workers.dev"));
    assert.deepEqual(connect("http://insecure.example"), connect(undefined));
    assert.deepEqual(connect("not a url"), connect(undefined));
    assert.deepEqual(connect("  "), connect(undefined));
    assert.ok(connect(undefined).includes("https://huggingface.co") && connect(undefined).includes("https://*.hf.co"), "pinned phone-model downloads and their CDN redirects");
  });

  await scenario("nonces: 128 random bits, base64, fresh each time; a malformed nonce is refused", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const nonce = newContentSecurityPolicyNonce();
      assert.match(nonce, /^[A-Za-z0-9+/]{22}==$/);
      seen.add(nonce);
    }
    assert.equal(seen.size, 200);
    for (const bad of ["", "short", "abc'; script-src *", "x".repeat(15)]) {
      assert.throws(() => buildContentSecurityPolicy({ nonce: bad, development: false }), /invalid CSP nonce/);
    }
  });

  await scenario("AYAS_CSP: enforce by default, report-only and off only when spelled exactly", () => {
    assert.equal(resolveContentSecurityPolicyMode({}), "enforce");
    assert.equal(resolveContentSecurityPolicyMode({ AYAS_CSP: "OFF" }), "enforce");
    assert.equal(resolveContentSecurityPolicyMode({ AYAS_CSP: "0" }), "enforce");
    assert.equal(resolveContentSecurityPolicyMode({ AYAS_CSP: " off " }), "off");
    assert.equal(resolveContentSecurityPolicyMode({ AYAS_CSP: "report-only" }), "report-only");
    assert.equal(contentSecurityPolicyFor({ AYAS_CSP: "off" }, undefined), null);
    assert.equal(contentSecurityPolicyFor({ AYAS_CSP: "report-only" }, undefined)!.name, "content-security-policy-report-only");
    assert.equal(contentSecurityPolicyFor({}, undefined)!.name, "content-security-policy");
  });

  await scenario("middleware: every page response carries the policy, and the request Next renders from carries the same nonce", async () => {
    await withEnv({ AYAS_ACCESS_KEY: KEY, AYAS_CSP: undefined }, async () => {
      const cookie = `ayas_session=${await issueSession(KEY)}`;
      const cases: Array<[string, Record<string, string>, number | null]> = [
        ["https://ayas.example/brain", { cookie, accept: "text/html" }, null], // signed in, passes
        ["https://ayas.example/login", { accept: "text/html" }, null], // open page
        ["https://ayas.example/brain/voice-lab/phone-llm", { accept: "text/html" }, null], // open lab
        ["https://ayas.example/brain", { accept: "text/html" }, 307], // login redirect
        ["https://ayas.example/sw.js", {}, null], // the service worker script (its own context's policy)
      ];
      const nonces = new Set<string>();
      for (const [url, headers, status] of cases) {
        const res = await middleware(new NextRequest(url, { headers: { host: "ayas.example", ...headers } }));
        const policy = res.headers.get("content-security-policy");
        assert.ok(policy, `${url}: response policy`);
        const nonce = nonceOf(policy)!;
        assert.ok(nonce, `${url}: nonce in script-src`);
        nonces.add(nonce);
        if (status === null) {
          assert.equal(res.headers.get("x-middleware-next"), "1", `${url}: passes`);
          assert.equal(res.headers.get("x-middleware-request-content-security-policy"), policy, `${url}: Next renders with the same nonce`);
          assert.match(res.headers.get("x-middleware-override-headers") ?? "", /content-security-policy/);
        } else {
          assert.equal(res.status, status, url);
        }
      }
      assert.equal(nonces.size, cases.length, "a fresh nonce per request");
    });
  });

  await scenario("middleware: API responses get no page policy, so a route's own policy (inert SVG assets) is kept", async () => {
    await withEnv({ AYAS_ACCESS_KEY: KEY, AYAS_CSP: undefined }, async () => {
      const cookie = `ayas_session=${await issueSession(KEY)}`;
      for (const [url, headers, status] of [
        ["https://ayas.example/api/assets/images/p/x.svg", { cookie }, null],
        ["https://ayas.example/api/brain/snapshot", {}, 401],
        ["https://ayas.example/api/auth/login", {}, null],
      ] as Array<[string, Record<string, string>, number | null]>) {
        const res = await middleware(new NextRequest(url, { headers: { host: "ayas.example", ...headers } }));
        assert.equal(res.headers.get("content-security-policy"), null, url);
        assert.equal(res.headers.get("x-middleware-request-content-security-policy"), null, url);
        if (status !== null) assert.equal(res.status, status, url);
      }
    });
    // Next writes a route's header only when the middleware did not already set it (send-response.js), so the page
    // policy on /api would silently replace this one.
    const svgRoute = fs.readFileSync(path.join(REPO_ROOT, "app", "api", "assets", "images", "[slug]", "[fileName]", "route.ts"), "utf8");
    assert.match(svgRoute, /"default-src 'none'; style-src 'unsafe-inline'; sandbox"/);
    const send = fs.readFileSync(path.join(REPO_ROOT, "node_modules", "next", "dist", "server", "send-response.js"), "utf8");
    assert.ok(send.includes("const isHeaderPresent = typeof res.getHeader(name) !== 'undefined';"), "Next still keeps a header the middleware set");
  });

  await scenario("middleware: a policy header sent by the client never reaches Next (it would choose the nonce)", async () => {
    await withEnv({ AYAS_ACCESS_KEY: KEY, AYAS_CSP: undefined }, async () => {
      const res = await middleware(new NextRequest("https://ayas.example/login", {
        headers: { host: "ayas.example", "content-security-policy": "script-src 'nonce-AAAAAAAAAAAAAAAAAAAAAA=='", "content-security-policy-report-only": "script-src 'nonce-BBBBBBBBBBBBBBBBBBBBBB=='" },
      }));
      const forwarded = res.headers.get("x-middleware-request-content-security-policy")!;
      assert.notEqual(nonceOf(forwarded), "AAAAAAAAAAAAAAAAAAAAAA==");
      assert.equal(res.headers.get("x-middleware-request-content-security-policy-report-only"), null, "the client's report-only header is dropped");
      assert.match(res.headers.get("x-middleware-override-headers") ?? "", /content-security-policy-report-only|content-security-policy/);
    });
  });

  await scenario("middleware: report-only sends the report header; off sends none and changes nothing else", async () => {
    await withEnv({ AYAS_ACCESS_KEY: KEY, AYAS_CSP: "report-only" }, async () => {
      const res = await middleware(new NextRequest("https://ayas.example/login", { headers: { host: "ayas.example" } }));
      assert.equal(res.headers.get("content-security-policy"), null);
      assert.ok(nonceOf(res.headers.get("content-security-policy-report-only")!));
      assert.equal(res.headers.get("x-middleware-request-content-security-policy-report-only"), res.headers.get("content-security-policy-report-only"));
    });
    await withEnv({ AYAS_ACCESS_KEY: KEY, AYAS_CSP: "off" }, async () => {
      const res = await middleware(new NextRequest("https://ayas.example/login", { headers: { host: "ayas.example" } }));
      assert.equal(res.headers.get("content-security-policy"), null);
      assert.equal(res.headers.get("content-security-policy-report-only"), null);
      assert.equal(res.headers.get("x-middleware-next"), "1");
      const brain = await middleware(new NextRequest("https://ayas.example/brain", { headers: { host: "ayas.example", accept: "text/html" } }));
      assert.equal(brain.status, 307, "the access gate does not depend on the policy switch");
    });
  });

  await scenario("the pinned onnxruntime-web folder is the one the installed Transformers.js loads", () => {
    const nested = path.join(REPO_ROOT, "node_modules", "@huggingface", "transformers", "node_modules", "onnxruntime-web", "package.json");
    const top = path.join(REPO_ROOT, "node_modules", "@huggingface", "transformers", "package.json");
    const declared = (JSON.parse(fs.readFileSync(top, "utf8")) as { dependencies?: Record<string, string> }).dependencies?.["onnxruntime-web"];
    assert.equal(declared, ONNXRUNTIME_WEB_FOR_TRANSFORMERS, "update ONNXRUNTIME_WEB_FOR_TRANSFORMERS with Transformers.js");
    if (fs.existsSync(nested)) assert.equal((JSON.parse(fs.readFileSync(nested, "utf8")) as { version: string }).version, ONNXRUNTIME_WEB_FOR_TRANSFORMERS);
    const onnx = fs.readFileSync(path.join(REPO_ROOT, "node_modules", "@huggingface", "transformers", "src", "backends", "onnx.js"), "utf8");
    assert.match(onnx, /https:\/\/cdn\.jsdelivr\.net\/npm\/onnxruntime-web@\$\{ONNX_ENV\.versions\.web\}\/dist\//, "Transformers.js still loads ort from this jsDelivr folder");
  });

  await scenario("wiring: every page renders per request (a prerendered page has no nonce); Node.js middleware", () => {
    const layout = fs.readFileSync(path.join(REPO_ROOT, "app", "layout.tsx"), "utf8");
    assert.match(layout, /^export const dynamic = "force-dynamic";$/m);
    const mw = fs.readFileSync(path.join(REPO_ROOT, "middleware.ts"), "utf8");
    assert.match(mw, /contentSecurityPolicyFor\(process\.env, process\.env\.NEXT_PUBLIC_AYAS_WORKER_URL\)/);
    assert.match(mw, /runtime: "nodejs"/);
    for (const file of fs.readdirSync(path.join(REPO_ROOT, "app"), { recursive: true }) as string[]) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      const text = fs.readFileSync(path.join(REPO_ROOT, "app", file), "utf8");
      assert.ok(!/export const dynamic = "force-static"|export const dynamic = 'force-static'/.test(text), `app/${file} must not prerender`);
    }
  });

  console.log(`AYAS content security policy: PASS (${count} scenarios)`);
}

main().catch((error: unknown) => {
  console.error("AYAS content security policy FAILED:", error);
  process.exitCode = 1;
});
