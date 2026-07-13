export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { initializeProductionProcessRuntime } = await import("@/lib/runtime/ProductionRuntimeCompositionRoot");
  await initializeProductionProcessRuntime();
}
