export type ImageProviderName = "mock" | "openai";

export interface ImageProviderConfig {
  defaultProvider: ImageProviderName;
  openai: {
    model: string;
    size: string;
    mimeType: string;
  };
}

export const imageProviderConfig: ImageProviderConfig = {
  defaultProvider: "mock",
  openai: {
    model: "gpt-image-1",
    size: "1024x1024",
    mimeType: "image/png",
  },
};
