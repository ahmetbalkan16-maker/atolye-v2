import assert from "node:assert/strict";

import {
  isAyasGuidedRepairQuery,
  resolveAyasPreReasoningIntent,
} from "../src/lib/ayas/AyasIntentRouting";
import { resolveDeterministicToolCandidate } from "../src/lib/ayas/AyasChatStream";

let scenarios = 0;
function scenario(name: string, test: () => void): void {
  test();
  scenarios += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${scenarios}: ${name}`);
}

function expectRoute(text: string, kind: ReturnType<typeof resolveAyasPreReasoningIntent>["kind"]): void {
  assert.equal(resolveAyasPreReasoningIntent(text).kind, kind, text);
}

scenario("Bugün is not a repair token", () => assert.equal(isAyasGuidedRepairQuery("Bugün nasılsın?"), false));
scenario("standalone bug is a repair token", () => assert.equal(isAyasGuidedRepairQuery("bug var"), true));
scenario("bug in a sentence is a repair token", () => assert.equal(isAyasGuidedRepairQuery("bir bug buldum"), true));
scenario("bug repair imperative is detected", () => assert.equal(isAyasGuidedRepairQuery("bug düzelt"), true));
scenario("Turkish uppercase Bugün remains negative", () => assert.equal(isAyasGuidedRepairQuery("BUGÜN"), false));
scenario("Unicode uppercase repair term is detected", () => assert.equal(isAyasGuidedRepairQuery("ÇALIŞMIYOR"), true));
scenario("one-character Turkish typo in a long repair term is tolerated", () => assert.equal(isAyasGuidedRepairQuery("uygulama çalşmıyor"), true));
scenario("short near-match remains ordinary text", () => assert.equal(isAyasGuidedRepairQuery("düzlem geometrisi"), false));
scenario("punctuated bug is detected", () => assert.equal(isAyasGuidedRepairQuery("(bug), var!"), true));
scenario("adjacent debug is not a repair token", () => assert.equal(isAyasGuidedRepairQuery("debug çıktısını göster"), false));
scenario("hata remains detected", () => assert.equal(isAyasGuidedRepairQuery("bir hata var"), true));
scenario("exception remains detected", () => assert.equal(isAyasGuidedRepairQuery("Exception aldım"), true));
scenario("çöktü remains detected", () => assert.equal(isAyasGuidedRepairQuery("uygulama çöktü"), true));
scenario("düzelt remains detected", () => assert.equal(isAyasGuidedRepairQuery("şunu düzelt"), true));

scenario("repair statement routes to Guided Repair", () => expectRoute("Bir bug buldum", "guided-repair"));
scenario("broken feature routes to Guided Repair", () => expectRoute("Bu özellik çalışmıyor", "guided-repair"));
scenario("repair imperative routes to Guided Repair", () => expectRoute("Şu hatayı düzelt", "guided-repair"));
scenario("today-development wording is not swallowed by bug", () => expectRoute("Bugün hangi yönlerini geliştirdin?", "development-status"));
scenario("approval question routes to development status", () => expectRoute("Benden ne onay bekliyorsun?", "development-status"));
scenario("proposal approval question routes to development status", () => expectRoute("Şu an benden onay bekleyen gelişim önerilerin neler?", "development-status"));
scenario("self-development approval routes to development status", () => expectRoute("Kendi gelişimin için hangi onayları bekliyorsun?", "development-status"));
scenario("today approval development route stays specific", () => expectRoute("Bugün hangi geliştirmeler için benden onay bekliyorsun?", "development-status"));
scenario("development reports prefer development status", () => expectRoute("Gelişim raporlarını göster", "development-status"));
scenario("named AYAS waiting query routes to development status", () => expectRoute("AYAS bugün senden ne bekliyor?", "development-status"));
scenario("generic approval alone does not trigger development status", () => expectRoute("Onay", "reasoning"));
scenario("Report Center pending-report wording is preserved", () => expectRoute("Onay bekleyen raporları göster", "report-center"));
scenario("bug report request prefers Report Center over repair", () => expectRoute("Bug raporunu göster", "report-center"));
scenario("today bug-discovery question prefers Report Center", () => expectRoute("Bugün bir bug buldun mu?", "report-center"));
scenario("today report availability routes to Report Center", () => expectRoute("Bugün rapor var mı?", "report-center"));
scenario("reporting the day remains ordinary reasoning", () => expectRoute("Bugünü raporla", "reasoning"));

scenario("development status resolves to its deterministic read-only tool", () => {
  assert.equal(resolveDeterministicToolCandidate("Benden ne onay bekliyorsun?")?.action, "ayas-development-status");
});
scenario("report-only phrasing does not resolve to development-status tool", () => {
  assert.notEqual(resolveDeterministicToolCandidate("Onay bekleyen raporları göster")?.action, "ayas-development-status");
});

console.log(JSON.stringify({ status: "PASS", suite: "ayas-intent-routing", scenarios }));
