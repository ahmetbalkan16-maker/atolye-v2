import type {
  VideoAssemblyInput,
  VideoAssemblyProviderName,
  VideoAssemblyResult,
} from "@/types/videoAssembly";

export interface VideoAssemblyProvider {
  readonly name: VideoAssemblyProviderName;
  assemble(input: VideoAssemblyInput): Promise<VideoAssemblyResult>;
}
