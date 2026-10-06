export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initializeProductionProcessRuntime } = await import("@/lib/runtime/ProductionRuntimeCompositionRoot");
    await initializeProductionProcessRuntime();
  }
}
