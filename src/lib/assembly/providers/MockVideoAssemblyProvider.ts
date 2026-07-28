import { createProviderDispatchAdapter } from "@/lib/providers/ProviderDispatchAdapterAuthority";
import type { ConfiguredVideoAssemblyProvider } from "./VideoAssemblyProvider";

export class MockVideoAssemblyProvider implements ConfiguredVideoAssemblyProvider {
  readonly name = "mock";

  createImmutableAssemblyDispatchAdapter() {
    return createProviderDispatchAdapter(this, {
      metadata: { name: this.name }, requiredMethods: ["assemble"],
    });
  }

  async assemble() {
    return {
      success: true as const,
      provider: "mock" as const,
      status: "planned" as const,
      filePath: "" as const,
      url: "" as const,
      mimeType: "video/mock" as const,
      byteLength: 0 as const,
      durationSeconds: 0 as const,
      createdAt: new Date().toISOString(),
    };
  }
}
