/**
 * Documentary media effort (Sprint 166): deterministic rights classification.
 *
 * Pure functions, no API. Verifies classifyMediaRightsStatus maps real-world
 * Wikimedia Commons / archive licence strings to the canonical MediaRightsStatus
 * and that isProductionAdmissibleRightsStatus fails closed on unknown/restricted.
 */
import assert from "node:assert/strict";
import {
  classifyMediaRightsStatus,
  isProductionAdmissibleRightsStatus,
} from "../src/lib/assets/MediaRightsPolicy";

let count = 0;
function scenario(name: string, fn: () => void) {
  fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function run() {
  scenario("public-domain: real Wikimedia LicenseShortName values", () => {
    for (const l of [
      "Public domain", "PD-US", "PD-old-100", "PD-Art", "CC0", "CC0 1.0",
      "CC-Zero", "PDM", "No known copyright restrictions", "no restrictions",
    ]) {
      assert.equal(classifyMediaRightsStatus(l), "public-domain", l);
    }
  });

  scenario("open-license: attribution / share-alike / government free licences", () => {
    for (const l of [
      "CC BY 2.0", "CC BY-SA 3.0", "CC BY-SA 4.0", "CC-BY-4.0",
      "Creative Commons Attribution 3.0", "GFDL", "Free Art License",
      "Open Government Licence 3.0", "OGL", "Etalab Open Licence",
    ]) {
      assert.equal(classifyMediaRightsStatus(l), "open-license", l);
    }
  });

  scenario("restricted: explicit non-free / NC / ND / all-rights-reserved", () => {
    for (const l of [
      "All rights reserved", "Copyrighted free use? no - copyrighted",
      "CC BY-NC 4.0", "CC BY-ND 4.0", "CC BY-NC-SA 3.0",
      "Fair use", "Non-free", "noncommercial only",
    ]) {
      assert.equal(classifyMediaRightsStatus(l), "restricted", l);
    }
  });

  scenario("unknown: missing / blank / unrecognised — never silently 'safe'", () => {
    for (const l of [undefined, null, "", "   ", "see file page", "unknown", "custom license 7"]) {
      assert.equal(classifyMediaRightsStatus(l as string | undefined), "unknown", String(l));
    }
  });

  scenario("classifier never returns 'verified' (reserved for out-of-band confirmation)", () => {
    const samples = ["CC BY 4.0", "Public domain", "All rights reserved", "", "verified license"];
    for (const l of samples) assert.notEqual(classifyMediaRightsStatus(l), "verified");
  });

  scenario("isProductionAdmissibleRightsStatus: only confirmed-free passes, fail-closed otherwise", () => {
    assert.equal(isProductionAdmissibleRightsStatus("public-domain"), true);
    assert.equal(isProductionAdmissibleRightsStatus("open-license"), true);
    assert.equal(isProductionAdmissibleRightsStatus("verified"), true);
    assert.equal(isProductionAdmissibleRightsStatus("unknown"), false);
    assert.equal(isProductionAdmissibleRightsStatus("restricted"), false);
    assert.equal(isProductionAdmissibleRightsStatus(undefined), false);
    assert.equal(isProductionAdmissibleRightsStatus(null), false);
  });

  scenario("deterministic + case/whitespace-insensitive", () => {
    assert.equal(classifyMediaRightsStatus("  cc by-sa 4.0  "), classifyMediaRightsStatus("CC BY-SA 4.0"));
    assert.equal(classifyMediaRightsStatus("PUBLIC DOMAIN"), "public-domain");
    assert.equal(classifyMediaRightsStatus("cc0"), classifyMediaRightsStatus("CC0"));
  });

  scenario("aligns with RealPhotoImageProvider.isFreeLicense (superset)", () => {
    // Everything isFreeLicense accepts must classify as admissible free media.
    for (const l of ["public domain", "PD-old", "CC0", "CC BY 2.0", "CC-BY-SA-3.0", "cc by 4"]) {
      assert.equal(isProductionAdmissibleRightsStatus(classifyMediaRightsStatus(l)), true, l);
    }
  });

  console.log(`Media rights policy smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "media-rights-policy", scenarios: count }));
}

try {
  run();
} catch (error) {
  console.error("Media rights policy smoke FAILED:", error);
  process.exitCode = 1;
}
