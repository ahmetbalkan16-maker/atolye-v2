import type { Asset } from "@/types/asset";
import type { VideoData } from "@/types/video";
import { isCompatibleVideoData } from "./VideoDataValidation";

type VideoServiceOptions = {
  endpoint?: string;
  fetcher?: typeof fetch;
};

export type GenerateVideoInput = VideoServiceOptions & {
  slug: string;
};

export type VideoServiceResult = {
  video: VideoData | null;
  assets: Asset[];
};

type VideoApiResponse = {
  success?: boolean;
  video?: VideoData | null;
  assets?: Asset[];
  error?: string;
};

const defaultEndpoint = "/api/video";

export class VideoService {
  static async generateVideo({
    slug,
    endpoint,
    fetcher,
  }: GenerateVideoInput): Promise<VideoServiceResult> {
    const request = fetcher ?? fetch;
    const response = await request(endpoint ?? defaultEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ slug }),
    });
    const data = (await response.json()) as VideoApiResponse;

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Video service request failed.");
    }

    return {
      video: isCompatibleVideoData(data.video) ? data.video : null,
      assets: isAssets(data.assets) ? data.assets : [],
    };
  }
}

export async function generateVideo(
  input: GenerateVideoInput,
): Promise<VideoServiceResult> {
  return VideoService.generateVideo(input);
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
