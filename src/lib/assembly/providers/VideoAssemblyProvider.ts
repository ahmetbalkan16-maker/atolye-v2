import type {
  VideoAssemblyInput,
  VideoAssemblyProviderName,
  VideoAssemblyResult,
} from "@/types/videoAssembly";
import type { ProviderDispatchAdapterAuthority } from "@/lib/providers/ProviderDispatchAdapterAuthority";

export interface VideoAssemblyProvider {
  readonly name: VideoAssemblyProviderName;
  assemble(input: VideoAssemblyInput): Promise<VideoAssemblyResult>;
}

export type ConfiguredVideoAssemblyProvider = VideoAssemblyProvider &
  ProviderDispatchAdapterAuthority<"createImmutableAssemblyDispatchAdapter">;
