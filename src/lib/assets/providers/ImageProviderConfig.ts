export type ImageProviderName = "mock" | "openai";

export interface ImageProviderConfig {
  defaultProvider: ImageProviderName;
}

export const imageProviderConfig: ImageProviderConfig = {
  defaultProvider: "mock",
};
