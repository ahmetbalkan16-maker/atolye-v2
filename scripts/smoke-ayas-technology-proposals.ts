/**
 * Technology watch → "AYAS ÖNERİYOR · Teknoloji izleme" (owner 2026-11-27): a failed update trial that needs a code
 * change, or a release note that deprecates an API our files use, becomes a reviewed main-AYAS proposal; everything
 * else stays out. TEMP roots only: no network (a fake feed), no model, no live data.
 *
 *   npx tsx scripts/smoke-ayas-technology-proposals.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, promises as fs, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ayasCodeLaneRefusals } from "../src/lib/brain/autonomy/AyasCodeChangeLane";
import { loadAtolyeBrainsView } from "../src/lib/v3/council/BrainsReport";
import { listProposals, needsOwner } from "../src/lib/v3/council/SelfImprovement";
import {
  ayasReviewTechnologyNeed, codeTokensOf, errorFilesOf, findingEntries, graceApproveTechnologyProposals, parseReleaseAtom, proposeTechnologyAdaptations,
  recommendedTokensOf, releaseNoteNeeds, TECH_PROPOSAL_SOURCE, technologyWatchRound, toolUsersFromRepo, trialAdaptationNeeds, type TechnologyNeed,
} from "../src/lib/v3/council/TechnologyJobs";

let count = 0;
async function scenario(name: string, run: () => Promise<void> | void): Promise<void> {
  await run();
  count++;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const NOW = new Date("2026-11-27T10:00:00.000Z");
const DAY = 86_400_000;
const temp = mkdtempSync(path.join(os.tmpdir(), "ayas-technology-proposals-"));
const ALLOWED = "src/lib/v3/script/V3Budget.ts";
const PROTECTED = "src/lib/brain/autonomy/AyasPatchDetectors.ts";

function trial(over: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: 1, trialId: "ayas-update-trial-1", sourceId: "typescript", toolName: "TypeScript", target: "npm:typescript",
    installedVersion: "5.9.3", targetVersion: "7.0.2", status: "FAILED", startedAt: new Date(NOW.getTime() - DAY).toISOString(),
    failedStep: "TYPECHECK", failureReason: "TypeScript hata verdi; güncelleme kod değişikliği gerektiriyor",
    steps: [{ name: "TYPECHECK", ok: false, summary: `D:/X/private/temp/ayas-update-trial-ab12/node_modules/typescript/lib/version").\n${ALLOWED}(12,5): error TS2339: Property 'x' does not exist.` }],
    ...over,
  };
}

function need(over: Partial<TechnologyNeed> = {}): TechnologyNeed {
  return { key: "deneme:npm:typescript@7.0.2", kind: "deneme-basarisiz", toolName: "TypeScript", scope: "ayas", title: "Teknoloji: TypeScript 7.0.2 güncellemesi kodumuzun uyarlanmasını bekliyor", files: [ALLOWED], detail: "Update trial t1 failed at TYPECHECK.", evidence: "TypeScript 5.9.3 → 7.0.2 denemesi TYPECHECK adımında kaldı", ...over };
}

const ATOM = `<?xml version="1.0"?><feed>
<entry><updated>2026-11-20T10:00:00Z</updated><link rel="alternate" type="text/html" href="https://github.com/vercel/next.js/releases/tag/v16.4.0"/><title>v16.4.0</title>
<content type="html">&lt;ul&gt;&lt;li&gt;Deprecate &lt;code&gt;unstable_fooBar()&lt;/code&gt;, use &lt;code&gt;fooBar&lt;/code&gt; instead (#1)&lt;/li&gt;&lt;li&gt;docs: deprecate &lt;code&gt;unstable_docsOnly&lt;/code&gt;&lt;/li&gt;&lt;li&gt;Deprecate &lt;code&gt;unstable_notOurs&lt;/code&gt;&lt;/li&gt;&lt;li&gt;Add &lt;code&gt;unstable_fooBar&lt;/code&gt; tracing&lt;/li&gt;&lt;li&gt;The &lt;code&gt;config&lt;/code&gt; option is deprecated&lt;/li&gt;&lt;/ul&gt;</content></entry>
<entry><updated>2026-11-21T10:00:00Z</updated><link href="https://github.com/vercel/next.js/releases/tag/v16.5.0-canary.3"/><title>v16.5.0-canary.3</title><content type="html">&lt;li&gt;Deprecate &lt;code&gt;unstable_fooBar&lt;/code&gt;&lt;/li&gt;</content></entry>
<entry><updated>2026-11-22T10:00:00Z</updated><link href="https://github.com/vercel/next.js/releases/tag/v16.9.0"/><title>v16.9.0</title><content type="html">&lt;li&gt;Deprecate &lt;code&gt;unstable_fooBar&lt;/code&gt;&lt;/li&gt;</content></entry>
<entry><updated>2026-05-01T10:00:00Z</updated><link href="https://github.com/vercel/next.js/releases/tag/v16.1.0"/><title>v16.1.0</title><content type="html">&lt;li&gt;Deprecate &lt;code&gt;unstable_fooBar&lt;/code&gt;&lt;/li&gt;</content></entry>
</feed>`;

async function repoFixture(name: string): Promise<string> {
  const repo = path.join(temp, name);
  await fs.mkdir(path.join(repo, "src", "lib", "v3", "script"), { recursive: true });
  await fs.writeFile(path.join(repo, "package-lock.json"), JSON.stringify({ packages: { "node_modules/next": { version: "16.4.6" }, "node_modules/typescript": { version: "5.9.3" } } }));
  await fs.writeFile(path.join(repo, ALLOWED), `import { unstable_fooBar, fooBar } from "next/cache";\nexport const a = unstable_fooBar(fooBar);\n`);
  await fs.writeFile(path.join(repo, "src", "lib", "v3", "script", "Other.ts"), `export const unstable_notOurs = 1; // does not import next\n`);
  return repo;
}

async function main(): Promise<void> {
  await scenario("the code lane's own policy separates the two fixture files", () => {
    assert.deepEqual(ayasCodeLaneRefusals([ALLOWED]), [], `${ALLOWED} must be a file the code lane may change`);
    assert.ok(ayasCodeLaneRefusals([PROTECTED]).length > 0, `${PROTECTED} must be refused by the code lane`);
  });

  await scenario("tool output names repository files, without the trial worktree prefix", () => {
    const out = `D:/T/ayas-update-trial-9/x\nsrc/lib/a/B.ts(1,2): error TS1\napp/brain/page.tsx:12 error\n  remotion-v3/src/scene/C.tsx(3,4): error\nnode_modules/x/y.ts(1,1): error`;
    assert.deepEqual(errorFilesOf(out), ["app/brain/page.tsx", "remotion-v3/src/scene/C.tsx", "src/lib/a/B.ts"], "error files");
  });

  await scenario("a failed code step of the newest trial is a need; passed, network, installed, old and unreadable are not", () => {
    const installed = () => "5.9.3";
    const now = NOW.getTime();
    const one = trialAdaptationNeeds({ schemaVersion: 1, trials: [trial({})] }, installed, now);
    assert.equal(one.length, 1, "one need from the failed TYPECHECK");
    assert.equal(one[0]!.key, "deneme:npm:typescript@7.0.2", "key binds target and version");
    assert.deepEqual(one[0]!.files, [ALLOWED], "files from the error output");
    assert.equal(one[0]!.scope, "ayas", "root tool is main AYAS");
    assert.ok(!/ayas-update-trial-ab12/.test(one[0]!.detail), "the worktree path is not in the task");
    const later = trial({ trialId: "t2", status: "PASSED", startedAt: new Date(now - 1000).toISOString() });
    assert.deepEqual(trialAdaptationNeeds({ schemaVersion: 1, trials: [trial({}), later] }, installed, now), [], "a newer passing trial closes it");
    const net = trial({ failedStep: "RENDER", steps: [{ name: "RENDER", ok: false, summary: "Error: getaddrinfo EAI_AGAIN remotion.media" }] });
    assert.deepEqual(trialAdaptationNeeds({ schemaVersion: 1, trials: [net] }, installed, now), [], "a network failure is not a code need");
    assert.deepEqual(trialAdaptationNeeds({ schemaVersion: 1, trials: [trial({ failedStep: "VULNERABILITIES" })] }, installed, now), [], "a non-code step is not a code need");
    assert.deepEqual(trialAdaptationNeeds({ schemaVersion: 1, trials: [trial({})] }, () => "7.0.2", now), [], "installed since: nothing to adapt");
    assert.deepEqual(trialAdaptationNeeds({ schemaVersion: 1, trials: [trial({ startedAt: new Date(now - 40 * DAY).toISOString() })] }, installed, now), [], "an old trial is not acted on");
    assert.deepEqual(trialAdaptationNeeds({ schemaVersion: 2, trials: [trial({})] }, installed, now), [], "unknown schema: fail closed");
    assert.deepEqual(trialAdaptationNeeds(undefined, installed, now), [], "unreadable: fail closed");
    const remotion = trialAdaptationNeeds({ schemaVersion: 1, trials: [trial({ sourceId: "remotion", toolName: "Remotion", target: "npm:remotion-v3/remotion", failedStep: "SMOKES", steps: [{ name: "SMOKES", ok: false, summary: "remotion-v3/src/scene/A.tsx(1,1): error" }] })] }, () => "4.0.547", now);
    assert.equal(remotion[0]?.scope, "v3", "a Remotion adaptation is a V3 job");
  });

  await scenario("AYAS recommends an adaptation of allowed files with benefit, harm and a bounded task", () => {
    const r = ayasReviewTechnologyNeed(need(), [], NOW.getTime(), {});
    assert.equal(r.verdict, "oneriyor", r.neden);
    assert.match(r.yarar, /yeni sürüm denendi/, "benefit says why");
    assert.match(r.zarar, /Paket dosyaları değişmez/, "harm names the limit");
    assert.match(r.gorev!, /Do not edit package\.json or package-lock\.json and do not install packages/, "the task forbids package changes");
    assert.match(r.gorev!, new RegExp(`change only: ${ALLOWED.replace(/\./g, "\\.")}`), "the task names its files");
  });

  await scenario("AYAS refuses protected files, a paid cloud, repeats, main-AYAS off and the limits", () => {
    const now = NOW.getTime();
    const prot = ayasReviewTechnologyNeed(need({ files: [ALLOWED, PROTECTED] }), [], now, {});
    assert.equal(prot.verdict, "onermiyor", "protected file refused");
    assert.match(prot.neden!, /kod hattının dokunamadığı/, "says why");
    assert.match(prot.neden!, /AyasPatchDetectors/, "names the file");
    assert.equal(ayasReviewTechnologyNeed(need({ detail: "Add renderMediaOnLambda streaming" }), [], now, {}).verdict, "onermiyor", "paid cloud refused");
    const seen = [{ kaynaklar: ["teknoloji:deneme:npm:typescript@7.0.2"], durum: "reddedildi" as const, tarih: new Date(now - 30 * DAY).toISOString() }];
    assert.match(ayasReviewTechnologyNeed(need(), seen, now, {}).neden!, /daha önce önerildi/, "a rejection is final");
    assert.match(ayasReviewTechnologyNeed(need(), [], now, { ATOLYE_AYAS_GELISTIRME: "0" }).neden!, /kapalı/, "main AYAS off: not proposed");
    const mine = (tarih: number, durum: "bekliyor" | "yapildi") => ({ kaynaklar: ["teknoloji:x"], durum, tarih: new Date(tarih).toISOString(), ayasOneriyor: { kaynak: TECH_PROPOSAL_SOURCE, yarar: "", zarar: "", otomatikOnay: "" } });
    assert.match(ayasReviewTechnologyNeed(need(), [mine(now - 3_600_000, "yapildi")], now, {}).neden!, /günde en fazla bir/, "one a day");
    assert.match(ayasReviewTechnologyNeed(need(), [mine(now - 3 * DAY, "bekliyor"), mine(now - 4 * DAY, "bekliyor")], now, {}).neden!, /Açıkta iki/, "two open at most");
    const other = { kaynaklar: ["bekci:x"], durum: "bekliyor" as const, tarih: new Date(now - 60_000).toISOString(), ayasOneriyor: { kaynak: "Bekçi (güvenlik beyni)", yarar: "", zarar: "", otomatikOnay: "" } };
    assert.equal(ayasReviewTechnologyNeed(need(), [other], now, {}).verdict, "oneriyor", "another brain's proposal does not count against the limit");
  });

  await scenario("release notes: tokens, the recommended form and the feed parser", () => {
    assert.deepEqual(codeTokensOf("Deprecate <code>unstable_fooBar()</code> and `next/legacy/image`, keep <code>type</code>"), ["unstable_fooBar", "next/legacy/image"], "code-like tokens only");
    assert.deepEqual(recommendedTokensOf("Deprecate <code>unstable_fooBar</code>, use <code>fooBar</code> instead"), ["fooBar"], "the form it recommends");
    assert.deepEqual(recommendedTokensOf("Renamed <code>oldThing</code> to <code>new.thing</code>. Migrate to <code>newThing.call</code>."), ["new.thing", "newThing.call"], "renamed-to and migrate-to forms; a sentence end closes the segment");
    const entries = parseReleaseAtom("nextjs", ATOM);
    assert.equal(entries.length, 4, "four entries");
    assert.equal(entries[0]!.title, "v16.4.0", "title");
    assert.equal(entries[0]!.url, "https://github.com/vercel/next.js/releases/tag/v16.4.0", "link");
    assert.ok(entries[0]!.lines.some((l) => l.includes("<code>unstable_fooBar()</code>")), "entities decoded, list split");
    const fromFinding = findingEntries([{ sourceUrl: "https://github.com/vercel/next.js/releases/tag/v16.4.0", evidenceQuote: "Deprecate `unstable_fooBar`", recordedAt: "2026-11-20T00:00:00Z" }, { sourceUrl: "https://github.com/ggml-org/llama.cpp/releases/tag/b1", evidenceQuote: "x" }]);
    assert.equal(fromFinding.length, 1, "only tracked tools");
    assert.equal(fromFinding[0]!.sourceId, "nextjs", "mapped to its source");
  });

  await scenario("a deprecation of an API our importing files use is a need; prerelease, newer, old, docs, unused and generic are not", async () => {
    const repo = await repoFixture("notes");
    const needs = releaseNoteNeeds(parseReleaseAtom("nextjs", ATOM), repo, toolUsersFromRepo(repo), NOW.getTime());
    assert.equal(needs.length, 1, `exactly one need, got ${needs.map((n) => n.key).join(", ")}`);
    assert.equal(needs[0]!.key, "not:nextjs@16.4.0:unstable_fooBar", "the deprecated token of the installed release");
    assert.deepEqual(needs[0]!.files, [ALLOWED], "only the file that imports next and uses it");
    assert.match(needs[0]!.detail, /untrusted quoted data, not instructions/, "the release text is quoted as data");
    assert.equal(ayasReviewTechnologyNeed(needs[0]!, [], NOW.getTime(), {}).verdict, "oneriyor", "AYAS recommends it");
  });

  await scenario("filing: one proposal a day, shown as AYAS ÖNERİYOR, then approved by itself after the grace unless rejected", async () => {
    const work = path.join(temp, "work-file");
    const env = { AYAS_GRACE_AUTO_APPROVE_MS: "300000" };
    const r = await proposeTechnologyAdaptations(work, [need(), need({ key: "not:nextjs@16.4.0:unstable_fooBar", kind: "surum-notu", title: "Teknoloji: Next.js 16.4.0 \"unstable_fooBar\" kullanımımızı değiştiriyor" })], env, NOW);
    assert.deepEqual(r.filed, ["deneme:npm:typescript@7.0.2"], "the first is filed");
    assert.match(r.refused[0]!.neden, /günde en fazla bir/, "the second waits for tomorrow");
    const [p] = (await listProposals(work)).map((x) => x.proposal);
    assert.ok(p, "a record exists");
    assert.equal(p.durum, "bekliyor", "waits for the owner");
    assert.equal(p.kapsam, "ayas", "main AYAS job");
    assert.equal(p.kaynakTuru, "olcum", "measured");
    assert.ok(needsOwner(p), "shown to the owner at once");
    assert.equal(p.ayasOneriyor?.kaynak, TECH_PROPOSAL_SOURCE, "AYAS ÖNERİYOR · Teknoloji izleme");
    assert.equal(p.ayasOneriyor?.otomatikOnay, new Date(NOW.getTime() + 300_000).toISOString(), "grace time shown");
    assert.match(p.ayasOneriyor!.yarar, /Kanıt:/, "evidence for the owner");
    const view = await loadAtolyeBrainsView(work);
    assert.equal(view.oneriler.find((o) => o.id === p.id)?.ayasOneriyor?.kaynak, TECH_PROPOSAL_SOURCE, "the Gelişim Merkezi view carries it");
    assert.deepEqual(await graceApproveTechnologyProposals(work, env, new Date(NOW.getTime() + 60_000)), [], "not before the grace");
    assert.deepEqual(await graceApproveTechnologyProposals(work, { AYAS_GRACE_AUTO_APPROVE: "0" }, new Date(NOW.getTime() + DAY)), [], "grace off: never by itself");
    assert.deepEqual(await graceApproveTechnologyProposals(work, env, new Date(NOW.getTime() + 301_000)), [p.id], "approved after the grace");
    const after = (await listProposals(work)).find((x) => x.proposal.id === p.id)!.proposal;
    assert.equal(after.durum, "onaylandi", "in the development queue");
    assert.match(after.karar?.not ?? "", /itiraz etmedi/, "the decision says how");
    const again = await proposeTechnologyAdaptations(work, [need()], env, new Date(NOW.getTime() + 3 * DAY));
    assert.match(again.refused[0]!.neden, /daha önce önerildi/, "never proposed twice");
  });

  await scenario("a rejected technology proposal stays rejected", async () => {
    const work = path.join(temp, "work-reject");
    await proposeTechnologyAdaptations(work, [need()], {}, NOW);
    const { file, proposal } = (await listProposals(work))[0]!;
    await fs.writeFile(file, JSON.stringify({ ...proposal, durum: "reddedildi" }));
    assert.deepEqual(await graceApproveTechnologyProposals(work, {}, new Date(NOW.getTime() + DAY)), [], "a rejection is never overridden");
  });

  await scenario("the round: trial store + research + one feed into one proposal, a protected trial refused with its reason", async () => {
    const repo = await repoFixture("round");
    const store = path.join(repo, "data", "brain", "self-improvement");
    await fs.mkdir(path.join(store, "update-trials"), { recursive: true });
    await fs.mkdir(path.join(store, "external-research"), { recursive: true });
    const protectedTrial = trial({ steps: [{ name: "TYPECHECK", ok: false, summary: `${PROTECTED}(324,10): error TS2339: Property 'isIdentifier' does not exist` }] });
    await fs.writeFile(path.join(store, "update-trials", "state.json"), JSON.stringify({ schemaVersion: 1, trials: [protectedTrial], applies: [] }));
    await fs.writeFile(path.join(store, "external-research", "a.json"), JSON.stringify({ sourceUrl: "https://github.com/ggml-org/llama.cpp/releases/tag/b1", evidenceQuote: "nothing of ours", recordedAt: NOW.toISOString() }));
    const asked: string[] = [];
    const fetchText = async (url: string) => { asked.push(url); return url.includes("vercel/next.js") ? { ok: true as const, body: ATOM, contentType: "application/atom+xml", finalUrl: url } : { ok: false as const, code: "AYAS_FETCH_HTTP_ERROR", message: "404" }; };
    const work = path.join(temp, "work-round");
    const r = await technologyWatchRound({ repoRoot: repo, workRoot: work, env: {}, fetchText, now: NOW });
    assert.ok(asked.length >= 2 && asked.every((u) => /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\.atom$/.test(u)), "only the tracked tools' release feeds are read");
    assert.equal(r.yeni, 1, r.satir);
    assert.match(r.satir, /1 sürüm akışı, 2 ihtiyaç, 1 öneri/, r.satir);
    assert.match(r.satir, /kod hattının dokunamadığı/, "the protected trial is refused with its reason");
    const filed = (await listProposals(work)).map((x) => x.proposal);
    assert.equal(filed.length, 1, "one record");
    assert.ok(filed[0]!.kaynaklar.includes("teknoloji:not:nextjs@16.4.0:unstable_fooBar"), "the release-note need");
    assert.ok(filed[0]!.kaynaklar.includes("https://github.com/vercel/next.js/releases/tag/v16.4.0"), "with its source");
    const offline = await technologyWatchRound({ repoRoot: repo, workRoot: path.join(temp, "work-offline"), env: {}, now: NOW });
    assert.equal(offline.yeni, 0, "without a feed and with only a protected trial nothing is filed");
  });
}

main()
  .then(() => console.log(`PASS (${count} scenarios)`))
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => rmSync(temp, { recursive: true, force: true }));
