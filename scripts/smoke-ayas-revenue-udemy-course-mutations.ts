/** Exact source mutations; every counterfactual must load and fail its named assertion in the whole grader. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const repo = process.cwd(), parent = fs.realpathSync.native(os.tmpdir()), temp = fs.mkdtempSync(path.join(parent, "ayas-udemy-course-audit-")), link = path.join(temp, "node_modules"), copied = new Set<string>();
function copy(file: string) {
  if (copied.has(file)) return; copied.add(file); const target = path.join(temp, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(repo, file), target);
  if (!/\.tsx?$/.test(file)) return;
  for (const m of fs.readFileSync(target, "utf8").matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]/g)) {
    const base = path.resolve(path.dirname(path.join(repo, file)), m[1]!); const found = [base, base + ".ts", base + ".tsx", base + ".json", path.join(base, "index.ts")].find(f => fs.existsSync(f) && fs.statSync(f).isFile());
    if (found) { const rel = path.relative(repo, found).replace(/\\/g, "/"); assert.ok(!rel.startsWith("..") && !path.isAbsolute(rel)); copy(rel); }
  }
}
const P = "src/lib/ayas/revenue/content/AyasCourseProductionPlan.ts", M = "src/lib/ayas/revenue/content/AyasCourseAssetManifest.ts", U = "src/lib/ayas/revenue/adapters/udemy/AyasUdemyAdapter.ts", S = "src/lib/ayas/revenue/adapters/udemy/AyasUdemySupportWorkflow.ts", R = "src/lib/ayas/revenue/adapters/udemy/AyasUdemyCourseReadModel.ts";
const C = "scripts/smoke-ayas-course-production-plan.ts", A = "scripts/smoke-ayas-revenue-udemy-adapter.ts";
const mutants: readonly (readonly [string, string, string, string, string, string])[] = [
  ["plan authority widened", P, 'authority: "NONE"', 'authority: "EXECUTE"', C, "P01"],
  ["plan source missing", P, ' || p.sourceEvidenceDigests.length === 0', '', C, "P05"],
  ["plan version upper bound", P, 'courseInteger(p.version, 1, 10_000)', 'courseInteger(p.version, 1, 100_000)', C, "P04"],
  ["duplicate outcomes", P, 'if (outcomes.size !== p.outcomes.length) return null;', '', C, "P06"],
  ["section chronology", P, 's.order !== i + 1', 'false', C, "P07"],
  ["lesson chronology", P, 'l.order !== j + 1', 'false', C, "P08"],
  ["duplicate lessons", P, ' || lessons.has(l.lessonId)', '', C, "P09"],
  ["unmapped outcome hidden", P, 'if (!mapped.has(o as string)) issues.push', 'if (false) issues.push', C, "P11"],
  ["duration bounds widened", P, 'courseInteger(l.durationSeconds, 30, 3600)', 'courseInteger(l.durationSeconds, 0, 7200)', C, "P12"],
  ["script gap hidden", P, 'if (l.script === null) issues.push', 'if (false) issues.push', C, "P13"],
  ["visual gap hidden", P, 'if (l.visualPlan.length === 0) issues.push', 'if (false) issues.push', C, "P14"],
  ["exercise gap hidden", P, 'if (l.exercise === null) issues.push', 'if (false) issues.push', C, "P15"],
  ["rights gap hidden", P, 'if (l.rightsEvidenceDigest === null) issues.push', 'if (false) issues.push', C, "P16"],
  ["generated policy gap hidden", P, 'l.mediaPolicy === "GENERATED_ALLOWED" && l.generatedPolicyDigest === null', 'false', C, "P17"],
  ["regulated claim review bypass", P, 'l.claimClass !== "GENERAL" && l.qualifiedClaimReviewDigest === null', 'false', C, "P18"],
  ["manifest plan rebound", M, ' || m.planDigest !== plan.planDigest', '', C, "P23"],
  ["missing lesson hidden", M, 'if (!seen.has(l.lessonId)) {', 'if (false) {', C, "P24"],
  ["audio quality ignored", M, 'v.audioIntelligible !== true', 'false', C, "P29"],
  ["caption coverage ignored", M, 'v.captionsComplete !== true', 'false', C, "P30"],
  ["visual quality ignored", M, 'v.visualQuality !== true', 'false', C, "P31"],
  ["video receipt rebound", M, 'v.videoDigest !== row.video.digest', 'false', C, "P32"],
  ["script evidence rebound", M, 'if (row.sourceScriptDigest !== scriptDigest) return null;', '', C, "P33"],
  ["owner review removed", M, 'review === null || review.pass !== true', 'false', C, "P41"],
  ["owner review payload rebound", M, ' || review.assetRowsDigest !== digestAyasRevenueData(m.lessons)', '', C, "P43"],
  ["owner review before media accepted", M, ' || review.reviewedAt < latestMediaReview', '', C, "P51"],
  ["publication before owner review accepted", M, ' || e.observedAt < (manifest.ownerQualityReview.reviewedAt as string)', '', C, "P52"],
  ["model publication accepted", M, 'e.source !== "OWNER_INPUT"', '!["OWNER_INPUT", "MODEL_OUTPUT"].includes(e.source as string)', C, "P47"],
  ["publication manifest rebound", M, ' || e.manifestDigest !== readiness.manifestDigest', '', C, "P48"],
  ["owner upload requirement removed", M, 'ownerMustUpload: true', 'ownerMustUpload: false', C, "P01"],
  ["file effect falsely available", M, 'opensFiles: false', 'opensFiles: true', C, "H12"],
  ["owner read callback bypassed", U, ' || approve(AYAS_UDEMY_READ_POLICY_DIGEST, accountRef) !== true', '', A, "P06"],
  ["zero-cost qualification bypassed", U, ' || cost() !== true', '', A, "P07"],
  ["request account rebound", U, 'r.accountRef !== accountRef || ', '', A, "P10"],
  ["invented platform scopes accepted", U, ' || s.grantedScopes.length !== 0', '', A, "P11"],
  ["reauth ignored", U, ' || s.reauthRequired', '', A, "P13"],
  ["expiration ignored", U, ' || (s.expiresAt !== null && s.expiresAt <= at)', '', A, "P14"],
  ["verification freshness ignored", U, 'Date.parse(at) - Date.parse(s.lastVerifiedAt) > AYAS_REVENUE_CONNECTION_LIMITS.verificationMaxAgeMs', 'false', A, "P16"],
  ["unsupported endpoint payload accepted", U, 'r.payload.kind !== kind', 'false', A, "P20"],
  ["page bound widened", U, 'courseInteger(limit, 1, 25)', 'courseInteger(limit, 1, 100)', A, "P31"],
  ["page horizon widened", U, 'courseInteger(page, 1, 40)', 'courseInteger(page, 1, 100)', A, "P34"],
  ["next URL host ignored", U, 'u.origin !== AYAS_UDEMY_HOST', 'false', A, "P35"],
  ["private next path accepted", U, 'u.pathname !== path', 'false', A, "P36"],
  ["next loop accepted", U, 'u.searchParams.get("page") !== String(page + 1)', 'false', A, "P37"],
  ["backoff ignored", U, 'clock < nextAllowed', 'false', A, "P39"],
  ["retry after ignored", U, 'Math.max(backoff, Math.min(86_400_000, seconds || dateDelay || 0))', 'backoff', A, "P40"],
  ["maintenance halt shortened", U, 'nextAllowed = responseClock + maintenance', 'nextAllowed = responseClock + interval', A, "P41"],
  ["connection change after await ignored", U, 'if (gate(now()) !== connectionDigest) return fail(r, "CONNECTION_CHANGED");', '', A, "P51"],
  ["rating range widened", R, 'r.rating > 5', 'r.rating > 10', A, "P47"],
  ["reply owner review removed", S, 'ownerReviewRequired: true', 'ownerReviewRequired: false', A, "P25"],
  ["reply submission opened", S, 'submission: "CLOSED"', 'submission: "OPEN"', A, "P24"],
  ["minimum lecture count bypass", M, 'wanted.length < AYAS_COURSE_UDEMY_MINIMUM_POLICY.lectures', 'false', C, "P53"],
  ["measured video duration bypass", M, 'measuredVideoSeconds < AYAS_COURSE_UDEMY_MINIMUM_POLICY.videoSeconds', 'false', C, "P54"],
  ["HD minimum bypass", M, 'v.videoHeight < AYAS_COURSE_UDEMY_MINIMUM_POLICY.height', 'false', C, "P55"],
  ["stereo minimum bypass", M, 'v.audioChannels !== AYAS_COURSE_UDEMY_MINIMUM_POLICY.audioChannels', 'false', C, "P56"],
  ["dynamic visuals bypass", M, 'v.dynamicVisuals !== true', 'false', C, "P57"],
  ["duplicate identity using whole fact hash", U, 'return item.courseRefDigest ?? item.threadRefDigest;', 'return digestAyasRevenueData(item);', A, "P52"],
];
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" }; for (const k of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[k]) env[k] = process.env[k];
const run = (script: string) => spawnSync(process.execPath, ["--import", "tsx", script], { cwd: temp, env, encoding: "utf8", windowsHide: true, timeout: 60_000, maxBuffer: 6_000_000 });
try {
  copy(C); copy(A); copy("tsconfig.json"); copy("package.json"); fs.symlinkSync(fs.realpathSync(path.join(repo, "node_modules")), link, process.platform === "win32" ? "junction" : "dir");
  const baselines = [C, A].map(script => { const r = run(script); assert.equal(r.status, 0, r.stdout + r.stderr); return JSON.parse(r.stdout); });
  const caught: { name: string; grader: string; assertion: string; failedAssertions: string[] }[] = [];
  for (const [name, file, before, after, grader, id] of mutants) {
    const target = path.join(temp, file), original = fs.readFileSync(target, "utf8"); assert.ok(original.includes(before), `${name}: missing exact anchor`);
    let r: ReturnType<typeof run>; try { fs.writeFileSync(target, original.replaceAll(before, () => after)); r = run(grader); } finally { fs.writeFileSync(target, original); }
    assert.equal(r.signal, null, `${name}: timeout`); assert.equal(r.status, 1, `${name}: survived or loader failed: ${r.stderr}`);
    assert.equal(r.stderr, "", `${name}: runtime/loader output`);
    const report = JSON.parse(r.stdout), failed = report.results.filter((x: { ok: boolean }) => !x.ok);
    assert.ok(failed.some((x: { id: string; failureKind: string }) => x.id === id && x.failureKind === "ASSERTION"), `${name}: named assertion did not catch: ${r.stdout}`);
    assert.ok(failed.every((x: { failureKind: string }) => x.failureKind === "ASSERTION"), `${name}: runtime failure is not assertion evidence`);
    caught.push({ name, grader, assertion: id, failedAssertions: failed.map((x: { id: string }) => x.id) });
  }
  console.log(JSON.stringify({ status: "PASS", baselines, negativeControls: { total: mutants.length, caught, equivalents: [] }, noLiveIO: true }));
} finally {
  if (fs.existsSync(link)) { if (process.platform === "win32") fs.rmdirSync(link); else fs.unlinkSync(link); }
  assert.ok(!fs.existsSync(link)); assert.equal(path.dirname(fs.realpathSync.native(temp)).toLowerCase(), parent.toLowerCase()); assert.ok(path.basename(temp).startsWith("ayas-udemy-course-audit-"));
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
