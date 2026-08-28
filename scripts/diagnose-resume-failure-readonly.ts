import { initializeProductionProcessRuntime } from "../src/lib/runtime/ProductionRuntimeCompositionRoot";
import { ProductionAcceptanceOrchestrator } from "../src/lib/production/ProductionAcceptanceOrchestrator";

const SLUG = "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5";

async function main() {
  await initializeProductionProcessRuntime();
  console.log("=== calling resumeAndFinalize ===");
  const result = await ProductionAcceptanceOrchestrator.resumeAndFinalize(SLUG);
  console.log("=== SUCCESS ===");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("=== FULL ERROR (not swallowed) ===");
  console.error(error);
  console.error("=== error keys ===");
  console.error(Object.keys(error));
  console.error("=== JSON attempt ===");
  try { console.error(JSON.stringify(error, Object.getOwnPropertyNames(error), 2)); } catch (e) { console.error("cant stringify", e); }
  process.exitCode = 1;
});
