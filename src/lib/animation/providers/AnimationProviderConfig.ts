export const ANIMATION_PROVIDER_CONFIGURATION_ERROR =
  "Animation provider configuration is invalid.";

export function resolveAnimationProviderName(
  value: string | undefined = process.env.ANIMATION_PROVIDER,
) {
  const normalized = value?.trim().toLowerCase();

  if (!normalized || normalized === "mock") {
    return "mock" as const;
  }

  throw new Error(ANIMATION_PROVIDER_CONFIGURATION_ERROR);
}
