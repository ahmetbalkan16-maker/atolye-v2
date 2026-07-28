import { types as utilTypes } from "node:util";
import { randomUUID } from "node:crypto";
import type { ProductionStepKey, ProjectPackageRunType } from "@/types/project";

export interface ProductionAcceptanceProviderOptions {
  readonly aiProvider?: object;
  readonly visualAssetProvider?: object;
  readonly animationProvider?: object;
  readonly videoProvider?: object;
  readonly audioProvider?: object;
  readonly videoAssemblyProvider?: object;
  readonly thumbnailProvider?: object;
  readonly youtubeProvider?: object;
  readonly youtubePublishProvider?: object;
}

export const productionAcceptanceProviderSelectionVersion =
  "production-acceptance-provider-selection-v1" as const;

export interface ProductionAcceptanceProviderSelection {
  readonly version: typeof productionAcceptanceProviderSelectionVersion;
  readonly selectionId: string;
  readonly stage: ProductionStepKey;
  readonly providerCapabilityScope: readonly string[];
  readonly providers: readonly ProductionAcceptanceProviderBinding[];
  /** Exact one-read snapshot used by dispatch; never serialize provider objects. */
  readonly dispatchOptions: Readonly<ProductionAcceptanceProviderOptions>;
}

export const productionAcceptanceExecutionScopeVersion =
  "production-acceptance-execution-scope-v1" as const;

export interface ProductionAcceptanceProviderBinding {
  readonly capability: string;
  readonly slot: keyof ProductionAcceptanceProviderOptions;
  readonly adapterId: string;
  readonly identifier: string;
  readonly injected: boolean;
  readonly reference?: object;
}

export const productionAcceptanceProviderAdapterErrorCode =
  "PRODUCTION_ACCEPTANCE_PROVIDER_ADAPTER_UNAVAILABLE" as const;

export class ProductionAcceptanceProviderAdapterError extends Error {
  readonly code = productionAcceptanceProviderAdapterErrorCode;
  constructor(readonly slot: keyof ProductionAcceptanceProviderOptions) {
    super("Production provider immutable dispatch adapter is unavailable.");
    this.name = "ProductionAcceptanceProviderAdapterError";
    this.stack = undefined;
  }
}

type ProviderAdapterFactoryName =
  | "createImmutableAiDispatchAdapter"
  | "createImmutableImageDispatchAdapter"
  | "createImmutableAnimationDispatchAdapter"
  | "createImmutableAudioDispatchAdapter"
  | "createImmutableVideoDispatchAdapter"
  | "createImmutableAssemblyDispatchAdapter"
  | "createImmutableThumbnailDispatchAdapter"
  | "createImmutableYoutubeDispatchAdapter"
  | "createImmutablePublishDispatchAdapter";

const adapterFactoryNames: Readonly<Record<keyof ProductionAcceptanceProviderOptions,
  ProviderAdapterFactoryName>> = Object.freeze({
    aiProvider: "createImmutableAiDispatchAdapter",
    visualAssetProvider: "createImmutableImageDispatchAdapter",
    animationProvider: "createImmutableAnimationDispatchAdapter",
    audioProvider: "createImmutableAudioDispatchAdapter",
    videoProvider: "createImmutableVideoDispatchAdapter",
    videoAssemblyProvider: "createImmutableAssemblyDispatchAdapter",
    thumbnailProvider: "createImmutableThumbnailDispatchAdapter",
    youtubeProvider: "createImmutableYoutubeDispatchAdapter",
    youtubePublishProvider: "createImmutablePublishDispatchAdapter",
  });

export function createExplicitImmutableProviderAuthority(
  option: keyof ProductionAcceptanceProviderOptions,
  name: string,
  createAdapter: () => object,
): object {
  const authority = Object.create(null) as Record<PropertyKey, unknown>;
  Object.defineProperties(authority, {
    name: { enumerable: true, configurable: false, writable: false, value: name },
    [adapterFactoryNames[option]]: { enumerable: false, configurable: false,
      writable: false, value: createAdapter },
  });
  return Object.freeze(authority);
}

export interface ProductionAcceptanceStageExecutionScope {
  readonly version: typeof productionAcceptanceExecutionScopeVersion;
  readonly projectSlug: string;
  readonly stage: ProductionStepKey;
  readonly runType: ProjectPackageRunType;
  readonly operation: string;
  readonly executionFingerprint: string;
  readonly providerCapabilityScope: readonly string[];
  readonly providers: readonly ProductionAcceptanceProviderBinding[];
  readonly providerSelection: ProductionAcceptanceProviderSelection;
}

const providerSlots: Readonly<Record<ProductionStepKey, readonly {
  capability: string;
  option: keyof ProductionAcceptanceProviderOptions;
  environment: string;
  fallback: string;
}[]>> = {
  research: [{ capability: "ai-generation", option: "aiProvider",
    environment: "AI_PROVIDER", fallback: "mock" }],
  script: [{ capability: "ai-generation", option: "aiProvider",
    environment: "AI_PROVIDER", fallback: "mock" }],
  scenes: [{ capability: "ai-generation", option: "aiProvider",
    environment: "AI_PROVIDER", fallback: "mock" }],
  visuals: [
    { capability: "ai-generation", option: "aiProvider", environment: "AI_PROVIDER", fallback: "mock" },
    { capability: "image-generation", option: "visualAssetProvider",
      environment: "IMAGE_PROVIDER", fallback: "mock" },
  ],
  animation: [
    { capability: "ai-generation", option: "aiProvider", environment: "AI_PROVIDER", fallback: "mock" },
    { capability: "animation-generation", option: "animationProvider",
      environment: "ANIMATION_PROVIDER", fallback: "mock" },
  ],
  video: [{ capability: "video-generation", option: "videoProvider",
    environment: "VIDEO_PROVIDER", fallback: "mock" }],
  audio: [
    { capability: "ai-generation", option: "aiProvider", environment: "AI_PROVIDER", fallback: "mock" },
    { capability: "audio-generation", option: "audioProvider",
      environment: "AUDIO_PROVIDER", fallback: "mock" },
  ],
  assembly: [
    { capability: "ai-generation", option: "aiProvider", environment: "AI_PROVIDER", fallback: "mock" },
    { capability: "video-assembly", option: "videoAssemblyProvider",
      environment: "VIDEO_ASSEMBLY_PROVIDER", fallback: "mock" },
  ],
  thumbnail: [{ capability: "thumbnail-generation", option: "thumbnailProvider",
    environment: "THUMBNAIL_PROVIDER", fallback: "mock" }],
  seo: [{ capability: "ai-generation", option: "aiProvider",
    environment: "AI_PROVIDER", fallback: "mock" }],
  youtube: [
    { capability: "youtube-package", option: "youtubeProvider",
      environment: "YOUTUBE_PROVIDER", fallback: "mock" },
    { capability: "youtube-publish", option: "youtubePublishProvider",
      environment: "YOUTUBE_PROVIDER", fallback: "mock" },
  ],
  export: [],
};

export function createProductionAcceptanceStageExecutionScope(input: {
  projectSlug: string;
  stage: ProductionStepKey;
  runType: ProjectPackageRunType;
  operation: string;
  executionFingerprint: string;
  options?: ProductionAcceptanceProviderOptions;
  providerSelection?: ProductionAcceptanceProviderSelection;
}): ProductionAcceptanceStageExecutionScope {
  const selection = input.providerSelection ??
    createProductionAcceptanceProviderSelection(input.stage, input.options);
  if (selection.stage !== input.stage) throw new Error("Provider selection stage mismatch.");
  return Object.freeze({
    version: productionAcceptanceExecutionScopeVersion,
    projectSlug: input.projectSlug,
    stage: input.stage,
    runType: input.runType,
    operation: input.operation,
    executionFingerprint: input.executionFingerprint,
    providerCapabilityScope: selection.providerCapabilityScope,
    providers: selection.providers,
    providerSelection: selection,
  });
}

export function createProductionAcceptanceProviderSelection(
  stage: ProductionStepKey,
  options: ProductionAcceptanceProviderOptions = {},
  configuredOptions: readonly (keyof ProductionAcceptanceProviderOptions)[] = [],
): ProductionAcceptanceProviderSelection {
  const selectionId = `provider-selection-${randomUUID()}`;
  const copied: Record<string, object> = {};
  const providers = providerSlots[stage].map((slot) => {
    const originalReference = options[slot.option];
    const configured = configuredOptions.includes(slot.option) || !originalReference;
    const reference = originalReference
      ? createExplicitProviderDispatchAdapter(slot.option, originalReference)
      : undefined;
    if (reference) copied[slot.option] = reference;
    return Object.freeze({
      capability: slot.capability,
      slot: slot.option,
      adapterId: `${selectionId}:${slot.option}`,
      identifier: configured
        ? `configured:${configuredProvider(slot.environment, slot.fallback)}`
        : `injected:${providerName(reference!)}`,
      injected: !configured,
      ...(reference ? { reference: reference as object } : {}),
    });
  });
  return Object.freeze({
    version: productionAcceptanceProviderSelectionVersion,
    selectionId,
    stage,
    providerCapabilityScope: Object.freeze(providers.map((provider) => provider.capability)),
    providers: Object.freeze(providers),
    dispatchOptions: Object.freeze(copied) as Readonly<ProductionAcceptanceProviderOptions>,
  });
}

function createExplicitProviderDispatchAdapter(
  option: keyof ProductionAcceptanceProviderOptions,
  provider: object,
): object {
  if (utilTypes.isProxy(provider)) throw new ProductionAcceptanceProviderAdapterError(option);
  const factoryName = adapterFactoryNames[option];
  let owner: object | null = provider;
  let descriptor: PropertyDescriptor | undefined;
  while (owner && owner !== Object.prototype) {
    if (utilTypes.isProxy(owner)) throw new ProductionAcceptanceProviderAdapterError(option);
    descriptor = Object.getOwnPropertyDescriptor(owner, factoryName);
    if (descriptor) break;
    owner = Object.getPrototypeOf(owner);
  }
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
    throw new ProductionAcceptanceProviderAdapterError(option);
  }
  let adapter: unknown;
  try { adapter = Reflect.apply(descriptor.value, provider, []); }
  catch { throw new ProductionAcceptanceProviderAdapterError(option); }
  if (!adapter || typeof adapter !== "object" || adapter === provider || utilTypes.isProxy(adapter)) {
    throw new ProductionAcceptanceProviderAdapterError(option);
  }
  try { return normalizeImmutableProviderDispatchAdapter(option, adapter); }
  catch { throw new ProductionAcceptanceProviderAdapterError(option); }
}

function normalizeImmutableProviderDispatchAdapter(
  option: keyof ProductionAcceptanceProviderOptions,
  adapter: object,
): object {
  if (utilTypes.isProxy(adapter) || Object.getPrototypeOf(adapter) !== Object.prototype) {
    throw new TypeError("Provider adapter must be a plain object.");
  }
  const facade = Object.create(null) as Record<PropertyKey, unknown>;
  for (const key of Reflect.ownKeys(adapter)) {
    const descriptor = Object.getOwnPropertyDescriptor(adapter, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError("Provider adapter accessors are unsupported.");
    }
    const value = descriptor.value;
    if (typeof value === "object" && value !== null) {
      throw new TypeError("Provider adapter configuration must be primitive.");
    }
    Object.defineProperty(facade, key, { configurable: false, enumerable: descriptor.enumerable,
      writable: false, value });
  }
  for (const method of providerAdapterMethods[option]) {
    if (typeof facade[method] !== "function") {
      throw new TypeError(`Provider adapter method ${method} is unavailable.`);
    }
  }
  return Object.freeze(facade);
}

const providerAdapterMethods: Readonly<Record<keyof ProductionAcceptanceProviderOptions,
  readonly string[]>> = Object.freeze({
  aiProvider: ["generate"], visualAssetProvider: ["generateImage"],
  animationProvider: ["generateAnimation"], audioProvider: ["validateInput", "generateAudio"],
  videoProvider: ["generateVideo"], videoAssemblyProvider: ["assemble"],
  thumbnailProvider: ["generateThumbnailPlan", "generateThumbnailAsset"],
  youtubeProvider: ["generatePublishingPackage"], youtubePublishProvider: ["publish"],
});

export function sameProductionAcceptanceProviderSelection(
  left: ProductionAcceptanceProviderSelection,
  right: ProductionAcceptanceProviderSelection,
): boolean {
  return left.version === right.version && left.stage === right.stage &&
    left.selectionId === right.selectionId &&
    JSON.stringify(serializableProductionAcceptanceProviderSelection(left)) ===
      JSON.stringify(serializableProductionAcceptanceProviderSelection(right)) &&
    left.providers.length === right.providers.length &&
    left.providers.every((provider, index) => provider.reference === right.providers[index]?.reference);
}

export function serializableProductionAcceptanceProviderSelection(
  selection: ProductionAcceptanceProviderSelection,
) {
  return { version: selection.version, selectionId: selection.selectionId, stage: selection.stage,
    providerCapabilityScope: [...selection.providerCapabilityScope],
    providers: selection.providers.map(({ capability, slot, adapterId, identifier, injected }) =>
      ({ capability, slot, adapterId, identifier, injected })) };
}

export function productionAcceptanceProviderCapabilitiesForStage(
  stage: ProductionStepKey,
): readonly string[] {
  return providerSlots[stage].map((slot) => slot.capability);
}

export function serializableProductionAcceptanceExecutionScope(
  scope: ProductionAcceptanceStageExecutionScope,
) {
  return {
    version: scope.version,
    projectSlug: scope.projectSlug,
    stage: scope.stage,
    runType: scope.runType,
    operation: scope.operation,
    executionFingerprint: scope.executionFingerprint,
    providerCapabilityScope: [...scope.providerCapabilityScope],
    providers: scope.providers.map(({ capability, slot, adapterId, identifier, injected }) =>
      ({ capability, slot, adapterId, identifier, injected })),
  };
}

export function sameProductionAcceptanceExecutionScope(
  left: ProductionAcceptanceStageExecutionScope,
  right: ProductionAcceptanceStageExecutionScope,
): boolean {
  return JSON.stringify(serializableProductionAcceptanceExecutionScope(left)) ===
    JSON.stringify(serializableProductionAcceptanceExecutionScope(right)) &&
    left.providers.length === right.providers.length &&
    left.providers.every((provider, index) =>
      provider.reference === right.providers[index]?.reference);
}

function configuredProvider(environment: string, fallback: string): string {
  const value = process.env[environment]?.trim();
  return value && /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(value) ? value : fallback;
}

function providerName(value: object): string {
  const candidate = (value as { name?: unknown }).name;
  if (typeof candidate === "string" && /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(candidate)) {
    return candidate;
  }
  const constructorName = value.constructor?.name;
  return typeof constructorName === "string" && /^[a-zA-Z0-9_$]{1,80}$/.test(constructorName)
    ? constructorName
    : "anonymous";
}
