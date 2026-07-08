import type { Asset } from "@/types/asset";
import type { AudioData } from "@/types/audio";

type AudioServiceOptions = {
  endpoint?: string;
  fetcher?: typeof fetch;
};

export type GenerateAudioInput = AudioServiceOptions & {
  slug: string;
};

export type AudioServiceResult = {
  audio: AudioData | null;
  assets: Asset[];
};

type AudioApiResponse = {
  success?: boolean;
  audio?: AudioData | null;
  assets?: Asset[];
  error?: string;
};

const defaultEndpoint = "/api/audio";

export class AudioService {
  static async generateAudio({
    slug,
    endpoint,
    fetcher,
  }: GenerateAudioInput): Promise<AudioServiceResult> {
    const request = fetcher ?? fetch;
    const response = await request(endpoint ?? defaultEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ slug }),
    });
    const data = (await response.json()) as AudioApiResponse;

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Audio service request failed.");
    }

    return {
      audio: isAudioData(data.audio) ? data.audio : null,
      assets: isAssets(data.assets) ? data.assets : [],
    };
  }
}

export async function generateAudio(
  input: GenerateAudioInput,
): Promise<AudioServiceResult> {
  return AudioService.generateAudio(input);
}

function isAudioData(value: unknown): value is AudioData {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Array.isArray((value as AudioData).sections) &&
    typeof (value as AudioData).createdAt === "string"
  );
}

function isAssets(value: unknown): value is Asset[] {
  return (
    Array.isArray(value) &&
    value.every(
      (asset) =>
        Boolean(asset) &&
        typeof asset === "object" &&
        typeof (asset as Asset).id === "string" &&
        typeof (asset as Asset).projectId === "string" &&
        typeof (asset as Asset).type === "string" &&
        typeof (asset as Asset).status === "string" &&
        typeof (asset as Asset).provider === "string" &&
        typeof (asset as Asset).prompt === "string" &&
        typeof (asset as Asset).createdAt === "string",
    )
  );
}
