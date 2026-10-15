import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { issueSession, resolveAccessGate } from "../src/lib/auth/accessGate";
import { AyasSafeModeBlockedError } from "../src/lib/ayas/safety/AyasSafeModeReader";
import {
  admitAyasOwnerApproval, checkAyasOwnerAdmissionBinding, checkAyasOwnerExecutionAdmission, isAyasOwnerAdmissionActionCompatible,
  type AyasOwnerAdmission, type AyasOwnerAdmissionAction, type AyasOwnerAdmissionSubject,
} from "../src/lib/brain/autonomy/AyasOwnerApprovalAdmission";
import {
  AyasUpdateApprovalError, createAyasUpdateApprovalStore, decideAyasUpdateApproval, isAyasUpdateApprovalOwnerAdmitted, listAyasUpdateApprovals,
  type AyasUpdateApprovalRecord,
} from "../src/lib/brain/autonomy/AyasUpdateApprovalStore";
import type { AyasResearchSeenItem } from "../src/lib/brain/autonomy/AyasResearchNoveltyStore";
import { buildAyasUpdateRadar, type AyasUpdateRadarItem } from "../src/lib/brain/autonomy/AyasUpdateRadar";

/**
 * Update radar owner approvals (owner request 2026-10-15, option A): a click records sealed consent for one exact
 * update and nothing else. Synthetic repository, approval store and session key in TEMP: no network, model, install,
 * commit or production state.
 */
const originalKey = process.env.AYAS_ACCESS_KEY;
const KEY = "update-approval-smoke-key-long-enough";
process.env.AYAS_ACCESS_KEY = KEY;
const gate = resolveAccessGate({ AYAS_ACCESS_KEY: KEY, NODE_ENV: "production" });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-update-approval-"));
const repo = path.join(temp, "repo");
const writeLock = (versions: Record<string, string>): void => {
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(repo, "package-lock.json"), JSON.stringify({ packages: Object.fromEntries(Object.entries(versions).map(([name, version]) => [`node_modules/${name}`, { version }])) }));
};
writeLock({ next: "16.3.8", eslint: "9.39.4" });

const seen = (sourceId: string, versionTag: string): AyasResearchSeenItem => ({
  schemaVersion: "1", itemId: `${sourceId}-${versionTag}`, sourceId, normalizedUrl: `https://example.test/${sourceId}/${versionTag}`,
  versionTag, contentFingerprint: "f", firstSeenAt: "2026-10-15T06:00:00.000Z", lastSeenAt: "2026-10-15T06:00:00.000Z", timesSeen: 1,
} as AyasResearchSeenItem);
const radarFor = (tags: readonly [string, string][]): readonly AyasUpdateRadarItem[] =>
  buildAyasUpdateRadar({ repoRoot: repo, seenItems: tags.map(([sourceId, tag]) => seen(sourceId, tag)), findings: [] });

let storeIndex = 0;
const freshStore = () => createAyasUpdateApprovalStore({ rootDir: path.join(temp, `store-${storeIndex++}`) });
let admitCalls = 0;
const admitAs = (action: AyasOwnerAdmissionAction = "decideAyasUpdateRadar") => async (subject: AyasOwnerAdmissionSubject): Promise<AyasOwnerAdmission> => {
  admitCalls += 1;
  return admitAyasOwnerApproval({ gate, token: await issueSession(KEY), action, subject });
};
const rejects = async (promise: Promise<unknown>, code: string): Promise<void> => {
  await assert.rejects(promise, (error: unknown) => (error as { code?: string }).code === code);
};

let count = 0;
const scenario = async (name: string, fn: () => Promise<void> | void): Promise<void> => { await fn(); count += 1; void name; };

async function main(): Promise<void> {
  const radar = radarFor([["nextjs", "v16.4.1"], ["eslint", "v10.11.0"]]);
  const next = radar.find((item) => item.sourceId === "nextjs")!;

  await scenario("every radar item carries a hash bound to its tool, versions and channel", () => {
    assert.ok(radar.every((item) => /^[0-9a-f]{64}$/.test(item.itemHash)));
    const eslint = radar.find((item) => item.sourceId === "eslint")!;
    assert.notEqual(next.itemHash, eslint.itemHash);
    assert.notEqual(radarFor([["nextjs", "v16.4.2"]])[0]!.itemHash, next.itemHash, "a newer target is a different item");
  });

  await scenario("approving records sealed, owner-admitted consent for the exact item and shows it as waiting", async () => {
    const store = freshStore();
    const record = await decideAyasUpdateApproval({ sourceId: "nextjs", itemHash: next.itemHash, decision: "APPROVE" }, { radar, store, admit: admitAs(), safeModeHold: () => undefined });
    assert.equal(record.targetVersion, "16.4.1"); assert.equal(record.installedVersion, "16.3.8"); assert.equal(record.bump, "MINOR");
    assert.equal(record.ownerAdmission.subject.kind, "update-radar"); assert.equal(record.ownerAdmission.action, "decideAyasUpdateRadar");
    assert.equal(store.load().decisions.length, 1); assert.ok(isAyasUpdateApprovalOwnerAdmitted(store.load().decisions[0]!));
    const [view] = listAyasUpdateApprovals({ decisions: store.load().decisions, radar, repoRoot: repo });
    assert.equal(view?.status, "WAITING"); assert.equal(view?.currentInstalledVersion, "16.3.8"); assert.equal(view?.newerVersionOnRadar, undefined);
    await rejects(decideAyasUpdateApproval({ sourceId: "nextjs", itemHash: next.itemHash, decision: "APPROVE" }, { radar, store, admit: admitAs(), safeModeHold: () => undefined }), "UPDATE_APPROVAL_ALREADY_APPROVED");
    assert.equal(store.load().decisions.length, 1);
  });

  await scenario("a stale, unknown or off-radar item is refused before any owner admission is asked for", async () => {
    const store = freshStore(); admitCalls = 0;
    const deps = { radar, store, admit: admitAs(), safeModeHold: () => undefined };
    await rejects(decideAyasUpdateApproval({ sourceId: "nextjs", itemHash: "a".repeat(64), decision: "APPROVE" }, deps), "UPDATE_APPROVAL_ITEM_CHANGED");
    await rejects(decideAyasUpdateApproval({ sourceId: "react", itemHash: next.itemHash, decision: "APPROVE" }, deps), "UPDATE_APPROVAL_ITEM_NOT_FOUND");
    await rejects(decideAyasUpdateApproval({ sourceId: "left-pad", itemHash: next.itemHash, decision: "APPROVE" }, deps), "UPDATE_APPROVAL_INVALID_INPUT");
    await rejects(decideAyasUpdateApproval({ sourceId: "__proto__", itemHash: next.itemHash, decision: "APPROVE" }, deps), "UPDATE_APPROVAL_INVALID_INPUT");
    await rejects(decideAyasUpdateApproval({ sourceId: "nextjs", itemHash: "not-a-hash", decision: "APPROVE" }, deps), "UPDATE_APPROVAL_INVALID_INPUT");
    await rejects(decideAyasUpdateApproval({ sourceId: "nextjs", itemHash: next.itemHash, decision: "EXECUTE" as never }, deps), "UPDATE_APPROVAL_INVALID_INPUT");
    const forged = { ...next, latestVersion: "99.0.0" };
    await rejects(decideAyasUpdateApproval({ sourceId: "nextjs", itemHash: next.itemHash, decision: "APPROVE" }, { ...deps, radar: [forged] }), "UPDATE_APPROVAL_ITEM_CHANGED");
    await rejects(decideAyasUpdateApproval({ sourceId: "nextjs", itemHash: next.itemHash, decision: "WITHDRAW" }, deps), "UPDATE_APPROVAL_NOT_APPROVED");
    assert.equal(admitCalls, 0); assert.equal(store.load().decisions.length, 0);
  });

  await scenario("SAFE_READ_ONLY refuses the decision before admission and writes nothing", async () => {
    const store = freshStore(); admitCalls = 0;
    await assert.rejects(decideAyasUpdateApproval({ sourceId: "nextjs", itemHash: next.itemHash, decision: "APPROVE" }, { radar, store, admit: admitAs(), safeModeHold: () => "AYAS_SAFE_READ_ONLY" }),
      (error: unknown) => error instanceof AyasSafeModeBlockedError && error.code === "AYAS_SAFE_READ_ONLY");
    await assert.rejects(decideAyasUpdateApproval({ sourceId: "nextjs", itemHash: next.itemHash, decision: "APPROVE" }, { radar, store, admit: admitAs(), safeModeHold: () => "AYAS_SAFE_MODE_UNAVAILABLE" }),
      (error: unknown) => error instanceof AyasSafeModeBlockedError);
    assert.equal(admitCalls, 0); assert.equal(store.load().decisions.length, 0);
  });

  await scenario("an admission for another action, subject or an already used one is rejected", async () => {
    const store = freshStore();
    const deps = { radar, store, safeModeHold: () => undefined };
    await rejects(decideAyasUpdateApproval({ sourceId: "nextjs", itemHash: next.itemHash, decision: "APPROVE" }, { ...deps, admit: admitAs("decideAyasApproval") }), "UPDATE_APPROVAL_ADMISSION_REJECTED");
    const eslint = radar.find((item) => item.sourceId === "eslint")!;
    await rejects(decideAyasUpdateApproval({ sourceId: "nextjs", itemHash: next.itemHash, decision: "APPROVE" }, {
      ...deps, admit: async () => admitAyasOwnerApproval({ gate, token: await issueSession(KEY), action: "decideAyasUpdateRadar", subject: { kind: "update-radar", sourceId: "eslint", itemHash: eslint.itemHash, decision: "APPROVE" } }),
    }), "UPDATE_APPROVAL_ADMISSION_REJECTED");
    await rejects(decideAyasUpdateApproval({ sourceId: "nextjs", itemHash: next.itemHash, decision: "APPROVE" }, {
      ...deps, admit: async (subject) => admitAyasOwnerApproval({ gate, token: await issueSession(KEY, Date.now() - 10 * 60_000), action: "decideAyasUpdateRadar", subject, now: Date.now() - 10 * 60_000 }),
    }), "UPDATE_APPROVAL_ADMISSION_REJECTED");
    let reused: AyasOwnerAdmission | undefined;
    await decideAyasUpdateApproval({ sourceId: "nextjs", itemHash: next.itemHash, decision: "APPROVE" }, { ...deps, admit: async (subject) => (reused = await admitAs()(subject)) });
    await rejects(decideAyasUpdateApproval({ sourceId: "nextjs", itemHash: next.itemHash, decision: "WITHDRAW" }, {
      ...deps, admit: async () => ({ ...reused!, subject: { ...reused!.subject, decision: "WITHDRAW" } as AyasOwnerAdmissionSubject }),
    }), "UPDATE_APPROVAL_ADMISSION_REJECTED");
    // Replay: after a real withdrawal, the first approval's admission cannot approve again.
    await decideAyasUpdateApproval({ sourceId: "nextjs", itemHash: next.itemHash, decision: "WITHDRAW" }, { ...deps, admit: admitAs() });
    await rejects(decideAyasUpdateApproval({ sourceId: "nextjs", itemHash: next.itemHash, decision: "APPROVE" }, { ...deps, admit: async () => reused! }), "UPDATE_APPROVAL_ADMISSION_REJECTED");
    await assert.rejects(admitAyasOwnerApproval({ gate: resolveAccessGate({}), token: await issueSession(KEY), action: "decideAyasUpdateRadar", subject: { kind: "update-radar", sourceId: "nextjs", itemHash: next.itemHash, decision: "APPROVE" } }),
      (error: unknown) => (error as { code?: string }).code === "OWNER_ADMISSION_GATE_UNAVAILABLE");
    assert.equal(store.load().decisions.length, 2);
  });

  await scenario("an update radar admission never authorizes a proposal, a batch or an execution, nor the reverse", async () => {
    const radarAdmission = await admitAs()({ kind: "update-radar", sourceId: "nextjs", itemHash: next.itemHash, decision: "APPROVE" });
    const at = new Date().toISOString();
    assert.equal(checkAyasOwnerAdmissionBinding(radarAdmission, { subject: { kind: "proposal", proposalId: "nextjs", proposalHash: next.itemHash, decision: "APPROVE" }, at, usedActionRefs: new Set() }).ok, false);
    assert.equal(checkAyasOwnerAdmissionBinding(radarAdmission, { subject: { kind: "micro-batch", batchId: "nextjs", batchHash: next.itemHash, decision: "APPROVE" }, at, usedActionRefs: new Set() }).ok, false);
    assert.equal(checkAyasOwnerExecutionAdmission({ decisionId: "d", decidedAt: at, ownerAdmission: radarAdmission }, radarAdmission, { kind: "update-radar", sourceId: "nextjs", itemHash: next.itemHash, decision: "APPROVE" }, at, new Set()), false);
    const proposalAdmission = await admitAyasOwnerApproval({ gate, token: await issueSession(KEY), action: "decideAyasUpdateRadar", subject: { kind: "proposal", proposalId: "p", proposalHash: "h", decision: "APPROVE" } });
    assert.equal(isAyasOwnerAdmissionActionCompatible(proposalAdmission), false);
    assert.equal(isAyasOwnerAdmissionActionCompatible(radarAdmission), true);
  });

  await scenario("withdrawing is a new decision; the approval disappears and can be given again", async () => {
    const store = freshStore();
    const deps = { radar, store, admit: admitAs(), safeModeHold: () => undefined };
    await decideAyasUpdateApproval({ sourceId: "nextjs", itemHash: next.itemHash, decision: "APPROVE" }, deps);
    const withdrawn = await decideAyasUpdateApproval({ sourceId: "nextjs", itemHash: next.itemHash, decision: "WITHDRAW" }, deps);
    assert.equal(withdrawn.decision, "WITHDRAW"); assert.equal(withdrawn.targetVersion, "16.4.1");
    assert.equal(store.load().decisions.length, 2, "history is append-only");
    assert.deepEqual(listAyasUpdateApprovals({ decisions: store.load().decisions, radar, repoRoot: repo }), []);
    await decideAyasUpdateApproval({ sourceId: "nextjs", itemHash: next.itemHash, decision: "APPROVE" }, deps);
    assert.equal(listAyasUpdateApprovals({ decisions: store.load().decisions, radar, repoRoot: repo }).length, 1);
  });

  await scenario("a newer release is flagged on an older approval, and a new approval supersedes it", async () => {
    const store = freshStore();
    const older = radarFor([["nextjs", "v16.4.0"]]);
    await decideAyasUpdateApproval({ sourceId: "nextjs", itemHash: older[0]!.itemHash, decision: "APPROVE" }, { radar: older, store, admit: admitAs(), safeModeHold: () => undefined });
    const [flagged] = listAyasUpdateApprovals({ decisions: store.load().decisions, radar, repoRoot: repo });
    assert.equal(flagged?.targetVersion, "16.4.0"); assert.equal(flagged?.newerVersionOnRadar, "16.4.1");
    await decideAyasUpdateApproval({ sourceId: "nextjs", itemHash: next.itemHash, decision: "APPROVE" }, { radar, store, admit: admitAs(), safeModeHold: () => undefined });
    const views = listAyasUpdateApprovals({ decisions: store.load().decisions, radar, repoRoot: repo });
    assert.equal(views.length, 1); assert.equal(views[0]!.targetVersion, "16.4.1");
  });

  await scenario("once the installed version reaches the target the approval reads as applied", async () => {
    const store = freshStore();
    await decideAyasUpdateApproval({ sourceId: "nextjs", itemHash: next.itemHash, decision: "APPROVE" }, { radar, store, admit: admitAs(), safeModeHold: () => undefined });
    writeLock({ next: "16.4.1", eslint: "9.39.4" });
    try {
      const after = radarFor([["nextjs", "v16.4.1"], ["eslint", "v10.11.0"]]);
      assert.equal(after.some((item) => item.sourceId === "nextjs"), false);
      const [view] = listAyasUpdateApprovals({ decisions: store.load().decisions, radar: after, repoRoot: repo });
      assert.equal(view?.status, "APPLIED"); assert.equal(view?.currentInstalledVersion, "16.4.1");
    } finally { writeLock({ next: "16.3.8", eslint: "9.39.4" }); }
  });

  await scenario("an edited record, a record sealed under another key and an unknown schema are never trusted", async () => {
    const store = freshStore();
    await decideAyasUpdateApproval({ sourceId: "nextjs", itemHash: next.itemHash, decision: "APPROVE" }, { radar, store, admit: admitAs(), safeModeHold: () => undefined });
    const record = store.load().decisions[0]!;
    const edits: Partial<AyasUpdateApprovalRecord>[] = [{ targetVersion: "99.0.0" }, { toolName: "Something" }, { bump: "PATCH" }, { decision: "WITHDRAW" }, { decidedAt: "2026-01-01T00:00:00.000Z" }, { ownerDecisionSeal: "0".repeat(64) }];
    for (const edit of edits) {
      assert.equal(isAyasUpdateApprovalOwnerAdmitted({ ...record, ...edit } as AyasUpdateApprovalRecord), false, JSON.stringify(edit));
      assert.deepEqual(listAyasUpdateApprovals({ decisions: [{ ...record, ...edit } as AyasUpdateApprovalRecord], radar, repoRoot: repo }), []);
    }
    process.env.AYAS_ACCESS_KEY = "a-different-access-key-long-enough";
    try { assert.equal(isAyasUpdateApprovalOwnerAdmitted(record), false); } finally { process.env.AYAS_ACCESS_KEY = KEY; }
    const dir = path.join(temp, "bad-schema"); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ schemaVersion: 2, decisions: [] }));
    assert.throws(() => createAyasUpdateApprovalStore({ rootDir: dir }).load(), /unknown schema/);
    assert.ok(new AyasUpdateApprovalError("UPDATE_APPROVAL_ITEM_CHANGED").message === "UPDATE_APPROVAL_ITEM_CHANGED");
  });
}

main().then(() => {
  fs.rmSync(temp, { recursive: true, force: true });
  if (originalKey === undefined) delete process.env.AYAS_ACCESS_KEY; else process.env.AYAS_ACCESS_KEY = originalKey;
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-update-approval", scenarios: count, modelRuns: 0, networkCalls: 0 }));
}, (error: unknown) => {
  fs.rmSync(temp, { recursive: true, force: true });
  console.error(error);
  process.exit(1);
});
