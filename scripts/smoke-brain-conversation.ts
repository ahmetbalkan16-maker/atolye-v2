/**
 * Atölye Brain — conversation persistence smoke.
 *
 * Deterministic / no browser. The pure core behind the `sessionStorage`-backed
 * transcript that survives an iPhone reload so AYAS does NOT re-introduce itself
 * and does NOT lose earlier turns: round-trip, TTL, cap, corruption tolerance,
 * stable turn ordinal, and the model-history filter that drops the welcome line.
 */

import assert from "node:assert/strict";

import {
  BRAIN_CONVERSATION_MAX_MESSAGES,
  BRAIN_CONVERSATION_TTL_MS,
  conversationHistoryForModel,
  newConversationId,
  parsePersistedConversation,
  serializeConversation,
  shouldSeedWelcome,
  type BrainConversationMessage,
} from "../src/lib/brain/ui/brainConversation";

let count = 0;
function scenario(name: string, fn: () => void) {
  fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

const msg = (over: Partial<BrainConversationMessage> = {}): BrainConversationMessage => ({
  id: "c1-u1",
  role: "user",
  text: "merhaba",
  ...over,
});

const welcome: BrainConversationMessage = { id: "brain-welcome", role: "system", text: "Ben AYAS — ..." };

scenario("round-trips a transcript with a stable id + turnSeq", () => {
  const now = 1_000_000;
  const raw = serializeConversation({
    conversationId: "cABC",
    turnSeq: 7,
    messages: [welcome, msg({ id: "cABC-u1", text: "kaç proje var" }), msg({ id: "cABC-b2", role: "brain", text: "16 proje" })],
    nowMs: now,
  });
  const back = parsePersistedConversation(raw, now + 5_000);
  assert.ok(back);
  assert.equal(back!.conversationId, "cABC");
  assert.equal(back!.turnSeq, 7);
  assert.equal(back!.messages.length, 3);
  assert.equal(back!.messages[1].text, "kaç proje var");
});

scenario("drops a transcript past the TTL", () => {
  const now = 10_000_000;
  const raw = serializeConversation({ conversationId: "c1", turnSeq: 3, messages: [msg()], nowMs: now });
  assert.ok(parsePersistedConversation(raw, now + BRAIN_CONVERSATION_TTL_MS - 1));
  assert.equal(parsePersistedConversation(raw, now + BRAIN_CONVERSATION_TTL_MS + 1), null, "stale → fresh session");
});

scenario("caps the stored transcript to the newest N messages", () => {
  const many = Array.from({ length: BRAIN_CONVERSATION_MAX_MESSAGES + 40 }, (_, i) =>
    msg({ id: `c1-m${i}`, text: `m${i}` }),
  );
  const raw = serializeConversation({ conversationId: "c1", turnSeq: 999, messages: many, nowMs: 1 });
  const back = parsePersistedConversation(raw, 2);
  assert.equal(back!.messages.length, BRAIN_CONVERSATION_MAX_MESSAGES);
  assert.equal(back!.messages[0].text, `m40`, "oldest dropped, newest kept");
  assert.equal(back!.messages.at(-1)!.text, `m${BRAIN_CONVERSATION_MAX_MESSAGES + 39}`);
});

scenario("tolerates corruption — bad JSON / wrong shape / no messages → null", () => {
  assert.equal(parsePersistedConversation(null, 1), null);
  assert.equal(parsePersistedConversation("}{", 1), null);
  assert.equal(parsePersistedConversation(JSON.stringify({ conversationId: "c1" }), 1), null, "no messages array");
  assert.equal(
    parsePersistedConversation(JSON.stringify({ conversationId: "c1", messages: [], savedAt: 1 }), 2),
    null,
    "empty transcript → treat as new",
  );
  // mixed valid + junk messages → keeps the valid ones
  const back = parsePersistedConversation(
    JSON.stringify({
      conversationId: "c1",
      turnSeq: 4,
      savedAt: 1,
      messages: [msg(), { id: 5, role: "user" }, { role: "brain", text: "hi" }, msg({ id: "c1-b2", role: "brain", text: "iyi" })],
    }),
    2,
  );
  assert.equal(back!.messages.length, 2);
});

scenario("shouldSeedWelcome — new session yes, restored-with-content no", () => {
  assert.equal(shouldSeedWelcome(null), true);
  const restored = parsePersistedConversation(
    serializeConversation({ conversationId: "c1", turnSeq: 2, messages: [msg()], nowMs: 1 }),
    2,
  );
  assert.equal(shouldSeedWelcome(restored), false);
});

scenario("conversationHistoryForModel — drops the system welcome, keeps the last N turns", () => {
  const transcript: BrainConversationMessage[] = [
    welcome,
    msg({ id: "c1-u1", role: "user", text: "kaç proje" }),
    msg({ id: "c1-b2", role: "brain", text: "16" }),
    msg({ id: "c1-u3", role: "user", text: "kaçı bitti" }),
    msg({ id: "c1-b4", role: "brain", text: "6" }),
  ];
  const h = conversationHistoryForModel(transcript, 6);
  assert.equal(h.length, 4, "the system welcome is NOT in the history");
  assert.ok(!h.some((m) => (m.role as string) === "system"));
  assert.deepEqual(h.map((m) => m.role), ["user", "brain", "user", "brain"]);
  // cap at N
  assert.equal(conversationHistoryForModel(transcript, 2).length, 2);
  assert.deepEqual(conversationHistoryForModel(transcript, 2).map((m) => m.text), ["kaçı bitti", "6"]);
});

scenario("newConversationId — short, prefixed, unique", () => {
  const a = newConversationId();
  const b = newConversationId();
  assert.match(a, /^c[a-z0-9]+$/i);
  assert.notEqual(a, b);
  assert.ok(a.length >= 5 && a.length <= 20);
});

scenario("turnSeq falls back to messages.length when absent from storage", () => {
  const back = parsePersistedConversation(
    JSON.stringify({ conversationId: "c1", savedAt: 1, messages: [msg(), msg({ id: "c1-b2", role: "brain" })] }),
    2,
  );
  assert.equal(back!.turnSeq, 2);
});

console.log(`Brain conversation smoke: PASS (${count} scenarios)`);
console.log(JSON.stringify({ status: "PASS", suite: "brain-conversation", scenarios: count }));
