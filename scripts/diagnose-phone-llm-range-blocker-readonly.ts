/**
 * READ-ONLY diagnostic runner: executes the real `runRangeDiagnosis` (from
 * `phoneLlmRangeDiagnostic.ts`, unmodified) against the REAL Hugging Face
 * CDN over this machine's real network, using Node's own `fetch`
 * (undici) — NOT a browser, NOT the real-device bug's environment. This
 * establishes the PC-side baseline data point only; it cannot reproduce or
 * disprove an iOS/WebKit-specific `fetch()`+cache behavior. Never reads a
 * response body (same guarantee as the module it calls). No production
 * code touched, no storage written.
 */

import { AYAS_PHONE_LLM_MODELS } from "../src/components/brain/voice/localLlm/phoneLlmModelResources";
import { formatRangeDiagnosis, runRangeDiagnosis } from "../src/components/brain/voice/localLlm/phoneLlmRangeDiagnostic";

async function main() {
  const model = AYAS_PHONE_LLM_MODELS[0];
  const result = await runRangeDiagnosis(model);
  console.log(formatRangeDiagnosis(result));
}

main().catch((error) => {
  console.error("diagnose-phone-llm-range-blocker-readonly FAILED:", error);
  process.exitCode = 1;
});
