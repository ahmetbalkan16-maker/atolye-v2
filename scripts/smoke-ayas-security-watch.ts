/**
 * Smoke: the security brain ("Bekçi", owner 2026-11-26) — judgement, exam, brute-force lock, case library, labels,
 * and that its rules cannot be loosened by automatic development. TEMP roots only; no network, no live app.
 *
 *   npx tsx scripts/smoke-ayas-security-watch.ts
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CLEAN_FACTS, evaluateSecurityWatch, LOGIN_LOCK_FAILURES_PER_HOUR, runSecurityExam, SECURITY_EXAM_CASES, securityWatchLabel, vetLearnedChecks,
  type SecurityWatchReport,
} from "../src/lib/brain/security/SecurityWatchModel";
import {
  liftLoginLock, loadSecurityWatchView, loginLockedUntil, readLoginFacts, readSecurityCases, recordLoginOutcome, recordSecurityCases,
  securityWatchDir, writeSecurityWatchReport,
} from "../src/lib/brain/security/SecurityWatchStore";
import { classifyPatchTarget } from "../src/lib/brain/selfheal/BrainPatchSafety";
import { ayasCodeLaneRefusals } from "../src/lib/brain/autonomy/AyasCodeChangeLane";
import { ayasReviewSecurityNeed, deriveSecurityNeeds, graceApproveSecurityProposals, proposeSecurityImprovements, securityGraceMs, SECURITY_PROPOSAL_SOURCE } from "../src/lib/brain/security/SecurityWatchImprovement";
import { LEARNED_SECURITY_CHECKS } from "../src/lib/security-watch/LearnedChecks";
import { decideProposal, listProposals } from "../src/lib/v3/council/SelfImprovement";

let count = 0;
const check = async (name: string, fn: () => void | Promise<void>) => { await fn(); count++; console.log(`PASS ${count}: ${name}`); };
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-security-watch-"));
const NOW = Date.parse("2026-11-26T12:00:00.000Z");

async function main(): Promise<void> {
try {
  await check("a clean machine gives no finding; every seeded incident is caught (exam)", () => {
    assert.deepEqual(evaluateSecurityWatch(CLEAN_FACTS, "2026-11-26T12:00:00.000Z"), [], "assert.deepEqual(evaluateSecurityWatch(CLEAN_FACTS, \"2026-11-26T12:00:00.000Z\"), [])");
    const exam = runSecurityExam("2026-11-26T12:00:00.000Z");
    assert.equal(exam.total, SECURITY_EXAM_CASES.length, "assert.equal(exam.total, SECURITY_EXAM_CASES.length)");
    assert.equal(exam.passed, exam.total, `missed: ${exam.missed.join(", ")}`);
    assert.equal(exam.falseAlarms, 0, "assert.equal(exam.falseAlarms, 0)");
  });

  await check("findings are ordered most severe first and never carry the passcode", () => {
    const found = evaluateSecurityWatch({
      ...CLEAN_FACTS,
      ports: { value: [{ port: 445, address: "0.0.0.0", process: "System" }, { port: 3000, address: "0.0.0.0", process: "node" }], at: "x" },
      secrets: { value: [{ file: "src/a.ts", kind: "OpenAI anahtarı" }], at: "x" },
    }, "2026-11-26T12:00:00.000Z");
    assert.deepEqual(found.map((f) => f.id), ["sir:git", "port:3000", "port:445"], "assert.deepEqual(found.map((f) => f.id), [\"sir:git\", \"port:3000\", \"port:445\"])");
    assert.ok(found.every((f) => f.ownerAction), "closing ports and rotating keys are the owner's");
  });

  await check("an unmeasured fact is reported as unmeasured, never as safe", () => {
    const found = evaluateSecurityWatch({ ...CLEAN_FACTS, vulnerabilities: { value: null, at: "x", error: "osv.dev yanıt vermedi" } }, "2026-11-26T12:00:00.000Z");
    assert.deepEqual(found.map((f) => f.id), ["olculemedi:acik"], "assert.deepEqual(found.map((f) => f.id), [\"olculemedi:acik\"])");
    assert.match(found[0]!.evidence, /osv\.dev/);
  });

  await check("loopback-only listeners are fine; all-interface ones are not", () => {
    assert.equal(evaluateSecurityWatch({ ...CLEAN_FACTS, ports: { value: [{ port: 3000, address: "::1", process: "node" }], at: "x" } }, "2026-11-26T12:00:00.000Z").length, 0, "assert.equal(evaluateSecurityWatch({ ...CLEAN_FACTS, ports: { value: [{ port: 3000, address: \"::1\", process: \"node\" }], at: \"x\" } }, \"2026-11-26T12:00:00.000Z\").length, 0)");
    assert.equal(evaluateSecurityWatch({ ...CLEAN_FACTS, ports: { value: [{ port: 11434, address: "::", process: "ollama" }], at: "x" } }, "2026-11-26T12:00:00.000Z")[0]?.id, "port:11434", "assert.equal(evaluateSecurityWatch({ ...CLEAN_FACTS, ports: { value: [{ port: 11434, address: \"::\", process: \"ollama\" }], at: \"x\" } }, \"2026-11-26T12:00:00.000Z\")[0]?.id, \"port:11434\")");
  });

  await check("brute force: the lock starts at the limit, ends existing nothing, and the owner can lift it", () => {
    for (let i = 0; i < LOGIN_LOCK_FAILURES_PER_HOUR - 1; i++) assert.equal(recordLoginOutcome(false, NOW + i * 1000, temp).lockedNow, false, "assert.equal(recordLoginOutcome(false, NOW + i * 1000, temp).lockedNow, false)");
    assert.equal(loginLockedUntil(NOW + 60_000, temp), null, "one below the limit stays open");
    assert.equal(recordLoginOutcome(false, NOW + 61_000, temp).lockedNow, true, "assert.equal(recordLoginOutcome(false, NOW + 61_000, temp).lockedNow, true)");
    const until = loginLockedUntil(NOW + 62_000, temp);
    assert.ok(until && Date.parse(until) > NOW + 50 * 60_000, "locked for about an hour");
    const facts = readLoginFacts(NOW + 62_000, temp);
    assert.equal(facts.failuresLastHour, LOGIN_LOCK_FAILURES_PER_HOUR, "assert.equal(facts.failuresLastHour, LOGIN_LOCK_FAILURES_PER_HOUR)");
    assert.equal(facts.locksLastDay, 1, "assert.equal(facts.locksLastDay, 1)");
    assert.equal(liftLoginLock(NOW + 63_000, temp), true, "assert.equal(liftLoginLock(NOW + 63_000, temp), true)");
    assert.equal(loginLockedUntil(NOW + 64_000, temp), null, "assert.equal(loginLockedUntil(NOW + 64_000, temp), null)");
    // After a lift only new failures count: one more failure does not re-lock at once.
    assert.equal(recordLoginOutcome(false, NOW + 65_000, temp).lockedNow, false, "assert.equal(recordLoginOutcome(false, NOW + 65_000, temp).lockedNow, false)");
    assert.equal(loginLockedUntil(NOW + 66_000, temp), null, "assert.equal(loginLockedUntil(NOW + 66_000, temp), null)");
  });

  await check("a success is not tracked, and the lock expires by itself", () => {
    const root = fs.mkdtempSync(path.join(temp, "ok-"));
    recordLoginOutcome(true, NOW, root);
    assert.equal(fs.existsSync(path.join(securityWatchDir(root), "login-state.json")), false, "assert.equal(fs.existsSync(path.join(securityWatchDir(root), \"login-state.json\")), false)");
    for (let i = 0; i < LOGIN_LOCK_FAILURES_PER_HOUR; i++) recordLoginOutcome(false, NOW + i, root);
    assert.ok(loginLockedUntil(NOW + 1000, root), "assert.ok(loginLockedUntil(NOW + 1000, root))");
    assert.equal(loginLockedUntil(NOW + 61 * 60_000, root), null, "expired after LOGIN_LOCK_MINUTES");
  });

  await check("an unreadable login state never locks the owner out", () => {
    const root = fs.mkdtempSync(path.join(temp, "bad-"));
    fs.mkdirSync(securityWatchDir(root), { recursive: true });
    fs.writeFileSync(path.join(securityWatchDir(root), "login-state.json"), "{not json");
    assert.equal(loginLockedUntil(NOW, root), null, "assert.equal(loginLockedUntil(NOW, root), null)");
    assert.equal(recordLoginOutcome(false, NOW, root).lockedNow, false, "never throws into the login route");
  });

  await check("the case library records a finding when seen and when gone", () => {
    const root = fs.mkdtempSync(path.join(temp, "cases-"));
    const a = evaluateSecurityWatch({ ...CLEAN_FACTS, ports: { value: [{ port: 445, address: "0.0.0.0", process: "System" }], at: "x" } }, "2026-11-26T12:00:00.000Z");
    assert.equal(recordSecurityCases([], a, "2026-11-26T12:00:00.000Z", root).length, 1, "assert.equal(recordSecurityCases([], a, \"2026-11-26T12:00:00.000Z\", root).length, 1)");
    assert.equal(recordSecurityCases(a, a, "2026-11-26T12:15:00.000Z", root).length, 0, "a lasting finding is not re-recorded");
    assert.equal(recordSecurityCases(a, [], "2026-11-26T13:00:00.000Z", root)[0]?.event, "gitti", "assert.equal(recordSecurityCases(a, [], \"2026-11-26T13:00:00.000Z\", root)[0]?.event, \"gitti\")");
    assert.deepEqual(readSecurityCases(10, root).map((c) => c.event), ["gitti", "goruldu"], "assert.deepEqual(readSecurityCases(10, root).map((c) => c.event), [\"gitti\", \"goruldu\"])");
  });

  await check("labels: never ran, stale, locked, serious, minor, clean", () => {
    const now = "2026-11-26T12:00:00.000Z";
    const report = (findings: SecurityWatchReport["findings"], checkedAt = now): SecurityWatchReport => ({ schemaVersion: 1, checkedAt, findings, measuredAt: {} as SecurityWatchReport["measuredAt"] });
    assert.equal(securityWatchLabel(null, now).label, "BEKÇİ HENÜZ ÇALIŞMADI", "assert.equal(securityWatchLabel(null, now).label, \"BEKÇİ HENÜZ ÇALIŞMADI\")");
    assert.equal(securityWatchLabel(report([], "2026-11-26T11:00:00.000Z"), now).label, "BEKÇİ ÇALIŞMIYOR", "assert.equal(securityWatchLabel(report([], \"2026-11-26T11:00:00.000Z\"), now).label, \"BEKÇİ ÇALIŞMIYOR\")");
    assert.equal(securityWatchLabel(report([{ id: "giris:kilitli", severity: "kritik", title: "", evidence: "", advice: "", ownerAction: true }]), now).level, "ACTION_REQUIRED", "assert.equal(securityWatchLabel(report([{ id: \"giris:kilitli\", severity: \"kritik\", title: \"\", evidence: \"\", advice: \"\", ownerAction: true }]), now).level, \"ACTION_REQUIRED\")");
    assert.equal(securityWatchLabel(report([{ id: "port:445", severity: "orta", title: "", evidence: "", advice: "", ownerAction: true }]), now).label, "1 KÜÇÜK BULGU", "assert.equal(securityWatchLabel(report([{ id: \"port:445\", severity: \"orta\", title: \"\", evidence: \"\", advice: \"\", ownerAction: true }]), now).label, \"1 KÜÇÜK BULGU\")");
    assert.equal(securityWatchLabel(report([]), now).level, "HEALTHY", "assert.equal(securityWatchLabel(report([]), now).level, \"HEALTHY\")");
  });

  await check("the panel view shows an unreadable report as an error, not as clean", () => {
    const root = fs.mkdtempSync(path.join(temp, "view-"));
    assert.equal(loadSecurityWatchView(NOW, root).report, null, "assert.equal(loadSecurityWatchView(NOW, root).report, null)");
    writeSecurityWatchReport({ schemaVersion: 1, checkedAt: "2026-11-26T12:00:00.000Z", findings: [], measuredAt: {} as SecurityWatchReport["measuredAt"] }, root);
    assert.equal(loadSecurityWatchView(NOW, root).report?.findings.length, 0, "assert.equal(loadSecurityWatchView(NOW, root).report?.findings.length, 0)");
    fs.writeFileSync(path.join(securityWatchDir(root), "report.json"), "{broken");
    assert.ok(loadSecurityWatchView(NOW, root).error, "assert.ok(loadSecurityWatchView(NOW, root).error)");
  });

  await check("the login route checks the lock before comparing any passcode, and records the outcome", () => {
    const route = fs.readFileSync("app/api/auth/login/route.ts", "utf8");
    const lock = route.indexOf("loginLockedUntil(Date.now())");
    const compare = route.indexOf("timingSafeEqual(key, gate.key");
    assert.ok(lock > 0 && compare > lock, "assert.ok(lock > 0 && compare > lock)");
    assert.ok(route.includes("recordLoginOutcome(ok, Date.now())") && route.includes("status: 423"), "assert.ok(route.includes(\"recordLoginOutcome(ok, Date.now())\") && route.includes(\"status: 423\"))");
  });

  await check("learned checks: useful ones add findings; useless, noisy, broken or 'kritik' ones are switched off", () => {
    const base = { title: "t", advice: "a", learnedFrom: "test" } as const;
    const good = { ...base, id: "ollama-dis", severity: "yuksek" as const, evaluate: (f: typeof CLEAN_FACTS) => (f.ports.value ?? []).some((p) => p.port === 11434 && p.address === "0.0.0.0") ? "ollama dışa açık" : null, exam: { ports: { value: [{ port: 11434, address: "0.0.0.0", process: "ollama" }], at: "x" } } };
    const useless = { ...base, id: "hic-tutmaz", severity: "orta" as const, evaluate: () => null, exam: {} };
    const noisy = { ...base, id: "hep-alarm", severity: "dusuk" as const, evaluate: () => "her zaman", exam: {} };
    const broken = { ...base, id: "cokuyor", severity: "orta" as const, evaluate: () => { throw new Error("x"); }, exam: {} };
    const critical = { ...base, id: "kritik-iddia", severity: "kritik" as unknown as "yuksek", evaluate: (f: typeof CLEAN_FACTS) => (f.secrets.value?.length ? "x" : null), exam: { secrets: { value: [{ file: "a", kind: "b" }], at: "x" } } };
    const { active, verdicts } = vetLearnedChecks([good, useless, noisy, broken, critical]);
    assert.deepEqual(active.map((c) => c.id), ["ollama-dis"], "assert.deepEqual(active.map((c) => c.id), [\"ollama-dis\"])");
    assert.deepEqual(verdicts.map((v) => v.status), ["aktif", "gereksiz", "yanlis-alarm", "hatali", "hatali"], "assert.deepEqual(verdicts.map((v) => v.status), [\"aktif\", \"gereksiz\", \"yanlis-alarm\", \"hatali\", \"hatali\"])");
    assert.deepEqual(evaluateSecurityWatch(CLEAN_FACTS, "2026-11-26T12:00:00.000Z", [good, noisy]), [], "a clean machine stays quiet even with a noisy learned check");
    const found = evaluateSecurityWatch({ ...CLEAN_FACTS, ...good.exam }, "2026-11-26T12:00:00.000Z", [good]);
    assert.ok(found.some((f) => f.id === "ogrenilen:ollama-dis") && found.some((f) => f.id === "port:11434"), "a learned check adds; the core finding stays");
    assert.deepEqual(LEARNED_SECURITY_CHECKS.filter((c) => vetLearnedChecks([c]).active.length === 0).map((c) => c.id), [], "every shipped learned check passes its own vetting");
  });

  await check("AYAS reviews Bekçi's needs: evidence only, benefit and harm written, no repeats, daily and open limits", () => {
    const at = (h: number) => new Date(NOW - h * 3600_000).toISOString();
    const seen = (h: number) => ({ at: at(h), event: "goruldu" as const, id: "port:445", severity: "orta" as const, title: "SMB açık", evidence: "e", advice: "a" });
    assert.equal(deriveSecurityNeeds([seen(1), seen(5)], null, NOW).length, 0, "twice is not a pattern");
    const needs = deriveSecurityNeeds([seen(1), seen(5), seen(30)], { schemaVersion: 1, checkedAt: at(0), findings: [], measuredAt: {} as SecurityWatchReport["measuredAt"], learned: [{ id: "hep-alarm", status: "yanlis-alarm", learnedFrom: "x" }] }, NOW);
    assert.deepEqual(needs.map((n) => n.kind), ["tekrarlayan-bulgu", "kapatilan-kontrol"], "assert.deepEqual(needs.map((n) => n.kind), [\"tekrarlayan-bulgu\", \"kapatilan-kontrol\"])");
    const review = ayasReviewSecurityNeed(needs[0]!, [], NOW);
    assert.equal(review.verdict, "oneriyor", "assert.equal(review.verdict, \"oneriyor\")");
    assert.ok(review.yarar.length > 20 && /LearnedChecks\.ts/.test(review.zarar) && /LearnedChecks\.ts/.test(review.gorev ?? ""), "assert.ok(review.yarar.length > 20 && /LearnedChecks\\.ts/.test(review.zarar) && /LearnedChecks\\.ts/.test(review.gorev ?? \"\"))");
    const mine = (durum: "bekliyor" | "reddedildi" | "yapildi", h: number, kaynak = "bekci:x") => ({ kaynaklar: [kaynak], durum, tarih: at(h), ayasOneriyor: { kaynak: SECURITY_PROPOSAL_SOURCE, yarar: "", zarar: "", otomatikOnay: "" } });
    assert.equal(ayasReviewSecurityNeed(needs[0]!, [mine("reddedildi", 100, `bekci:${needs[0]!.key}`)], NOW).verdict, "onermiyor", "a rejection is final");
    assert.equal(ayasReviewSecurityNeed(needs[0]!, [mine("yapildi", 2)], NOW).verdict, "onermiyor", "one a day");
    assert.equal(ayasReviewSecurityNeed(needs[0]!, [mine("bekliyor", 30), mine("bekliyor", 50)], NOW).verdict, "onermiyor", "two open at most");
  });

  await check("Bekçi's proposal lands as 'AYAS ÖNERİYOR', waits the grace, then is approved; a rejection is never overridden", async () => {
    const work = fs.mkdtempSync(path.join(temp, "v3-"));
    const now = new Date(NOW);
    const need = { key: "tekrar:port:445", kind: "tekrarlayan-bulgu" as const, title: "Tekrarlayan güvenlik bulgusu: SMB açık", evidence: "3 kez" };
    const env = { AYAS_GRACE_AUTO_APPROVE_MS: "300000" } as unknown as NodeJS.ProcessEnv;
    const filed = await proposeSecurityImprovements(work, [need], env, now);
    assert.deepEqual(filed.filed, ["tekrar:port:445"], "assert.deepEqual(filed.filed, [\"tekrar:port:445\"])");
    const [p] = (await listProposals(work)).map((x) => x.proposal);
    assert.equal(p!.durum, "bekliyor", "assert.equal(p!.durum, \"bekliyor\")"); assert.equal(p!.kapsam, "ayas", "assert.equal(p!.kapsam, \"ayas\")"); assert.equal(p!.ayasOneriyor?.kaynak, SECURITY_PROPOSAL_SOURCE, "assert.equal(p!.ayasOneriyor?.kaynak, SECURITY_PROPOSAL_SOURCE)");
    assert.equal(p!.ayasOneriyor?.otomatikOnay, new Date(NOW + 300_000).toISOString(), "assert.equal(p!.ayasOneriyor?.otomatikOnay, new Date(NOW + 300_000).toISOString())");
    assert.deepEqual(await graceApproveSecurityProposals(work, env, new Date(NOW + 299_000)), [], "not before the grace");
    assert.deepEqual(await graceApproveSecurityProposals(work, { AYAS_GRACE_AUTO_APPROVE: "0" } as unknown as NodeJS.ProcessEnv, new Date(NOW + 999_000)), [], "the owner's off switch");
    assert.equal((await graceApproveSecurityProposals(work, env, new Date(NOW + 301_000))).length, 1, "assert.equal((await graceApproveSecurityProposals(work, env, new Date(NOW + 301_000))).length, 1)");
    assert.equal((await listProposals(work))[0]!.proposal.durum, "onaylandi", "assert.equal((await listProposals(work))[0]!.proposal.durum, \"onaylandi\")");
    // A second need the same day is refused by AYAS; a rejected one stays rejected.
    assert.equal((await proposeSecurityImprovements(work, [{ ...need, key: "tekrar:port:139" }], env, new Date(NOW + 400_000))).filed.length, 0, "assert.equal((await proposeSecurityImprovements(work, [{ ...need, key: \"tekrar:port:139\" }], env, new Date(NOW + 400_000))).filed.length, 0)");
    const work2 = fs.mkdtempSync(path.join(temp, "v3b-"));
    await proposeSecurityImprovements(work2, [need], env, now);
    await decideProposal(work2, (await listProposals(work2))[0]!.proposal.id, "reddedildi");
    assert.deepEqual(await graceApproveSecurityProposals(work2, env, new Date(NOW + 999_000)), [], "assert.deepEqual(await graceApproveSecurityProposals(work2, env, new Date(NOW + 999_000)), [])");
    assert.equal(securityGraceMs({ AYAS_GRACE_AUTO_APPROVE_MS: "1000" } as unknown as NodeJS.ProcessEnv), 60_000, "never under a minute");
  });

  await check("automatic development may change only the learned checks, never the core, the review or the watcher", () => {
    assert.deepEqual(ayasCodeLaneRefusals(["src/lib/security-watch/LearnedChecks.ts", "scripts/smoke-ayas-security-watch-learned.ts"]), [], "assert.deepEqual(ayasCodeLaneRefusals([\"src/lib/security-watch/LearnedChecks.ts\", \"scripts/smoke-ayas-security-watch-learned.ts\"]), [])");
    for (const f of ["src/lib/brain/security/SecurityWatchModel.ts", "src/lib/brain/security/SecurityWatchImprovement.ts", "src/lib/brain/security/SecurityWatchStore.ts", "scripts/ayas-security-watch.ts"]) assert.equal(ayasCodeLaneRefusals([f]).length, 1, f);
    const learned = fs.readFileSync("src/lib/security-watch/LearnedChecks.ts", "utf8");
    assert.deepEqual([...learned.matchAll(/^import (?!type )/gm)].length, 0, "learned checks import types only (pure, no I/O)");
  });

  await check("automatic development can never loosen the security brain's rules or its watcher", () => {
    for (const file of ["src/lib/brain/security/SecurityWatchModel.ts", "src/lib/brain/security/SecurityWatchStore.ts"]) {
      assert.equal(classifyPatchTarget(file).level, "FORBIDDEN_AUTONOMOUS", file);
    }
    const watcher = fs.readFileSync("scripts/ayas-security-watch.ts", "utf8");
    assert.ok(!/\bfetch\s*\(/.test(watcher), "the watcher sends nothing itself");
    assert.ok(!/Test-NetConnection|nmap|Invoke-WebRequest/.test(watcher), "no network scanning");
  });
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log(`PASS (${count} scenarios)`);
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
