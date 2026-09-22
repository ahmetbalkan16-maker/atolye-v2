import assert from "node:assert/strict";

import { AYAS_CAPABILITY_CATEGORIES, isAyasCapabilityCategory, AYAS_CAPABILITY_CATEGORY_RELATED_PATHS } from "../src/lib/brain/autonomy/AyasCapabilityTaxonomy";

let count = 0;
function scenario(name: string, fn: () => void) { fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

scenario("every category has a defined related-paths entry (possibly empty, never missing)", () => {
  for (const category of AYAS_CAPABILITY_CATEGORIES) {
    assert.ok(category in AYAS_CAPABILITY_CATEGORY_RELATED_PATHS, `${category} must have a related-paths entry`);
    assert.ok(Array.isArray(AYAS_CAPABILITY_CATEGORY_RELATED_PATHS[category]), "assert.ok(Array.isArray(AYAS_CAPABILITY_CATEGORY_RELATED_PATHS[category]))");
  }
});

scenario("isAyasCapabilityCategory correctly validates real categories and rejects unknown strings", () => {
  assert.equal(isAyasCapabilityCategory("SUBTITLES"), true, "assert.equal(isAyasCapabilityCategory(\"SUBTITLES\"), true)");
  assert.equal(isAyasCapabilityCategory("NOT_A_REAL_CATEGORY"), false, "assert.equal(isAyasCapabilityCategory(\"NOT_A_REAL_CATEGORY\"), false)");
  assert.equal(isAyasCapabilityCategory(""), false, "assert.equal(isAyasCapabilityCategory(\"\"), false)");
});

scenario("the taxonomy contains no vendor/provider name — it stays vendor-neutral by construction", () => {
  const vendors = ["capcut", "elevenlabs", "adobe", "runway", "descript", "canva", "davinci"];
  for (const category of AYAS_CAPABILITY_CATEGORIES) {
    const lower = category.toLowerCase();
    for (const vendor of vendors) assert.ok(!lower.includes(vendor), `category "${category}" must not name a vendor`);
  }
});

scenario("category names are unique", () => {
  assert.equal(new Set(AYAS_CAPABILITY_CATEGORIES).size, AYAS_CAPABILITY_CATEGORIES.length, "assert.equal(new Set(AYAS_CAPABILITY_CATEGORIES).size, AYAS_CAPABILITY_CATEGORIES.length)");
});

console.log(`AYAS capability taxonomy smoke: PASS (${count} scenarios)`);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-capability-taxonomy", scenarios: count }));
