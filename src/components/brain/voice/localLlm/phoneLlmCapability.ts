/**
 * AYAS phone-local LLM — capability detection (Tier 2 prototype).
 *
 * Deliberately separate from `ayasVoice.ts`'s `isWakeEngineCapable` — that one
 * is synchronous (mic/AudioWorklet globals are either present or not). WebGPU
 * capability genuinely cannot be known from a `typeof` check alone: the API
 * can be present while `requestAdapter()`/`requestDevice()` still fail (driver
 * denylist, disabled flag, out-of-memory GPU process, …), so this is async and
 * actually attempts the handshake.
 *
 * Pure w.r.t. the DOM beyond that one GPU round-trip — no state, no caching,
 * no fallback decision. It answers ONE question — "can this browser even
 * attempt Tier 2 right now?" — and always returns a concrete reason on `false`
 * (spec: "Telefon local beyin bu cihazda kullanılamıyor." + why, never a
 * silent no-op). The caller decides what to do with the answer; this module
 * never itself falls back to anything.
 */

export type AyasPhoneLlmCapabilityReason =
  | "insecure-context"
  | "webgpu-api-missing"
  | "no-adapter"
  | "device-request-failed"
  | "unknown-error";

export interface AyasPhoneLlmCapabilityResult {
  readonly capable: boolean;
  readonly secureContext: boolean;
  readonly webgpuApiPresent: boolean;
  readonly adapterObtained: boolean;
  readonly deviceObtained: boolean;
  /** `navigator.deviceMemory` in GB, when the browser exposes it (Chrome/Android only — Safari never does). */
  readonly deviceMemoryGb: number | null;
  /** Safe, non-vendor-identifying adapter info when available (no fingerprinting-grade detail surfaced). */
  readonly adapterVendor: string | null;
  /** `typeof WebAssembly !== "undefined"` — informational only (Transformers.js's own `device: "wasm"` fallback needs this; this module never picks it automatically). */
  readonly wasmAvailable: boolean;
  /** Raw `navigator.userAgent`, display-only (the capability panel's "Browser" line). */
  readonly userAgent: string | null;
  readonly reason: AyasPhoneLlmCapabilityReason | null;
  readonly detail: string | null;
}

/** The minimal `navigator.gpu` shape this module needs — matches the real WebGPU API. */
export interface AyasWebGpuNavigatorLike {
  readonly gpu?: {
    requestAdapter: (options?: unknown) => Promise<AyasWebGpuAdapterLike | null>;
  };
  readonly deviceMemory?: number;
  readonly userAgent?: string;
}

export interface AyasWebGpuAdapterLike {
  readonly info?: { readonly vendor?: string };
  requestDevice: (descriptor?: unknown) => Promise<unknown>;
}

export interface AyasPhoneLlmCapabilityWindowLike {
  readonly isSecureContext?: boolean;
  readonly navigator?: AyasWebGpuNavigatorLike;
  readonly WebAssembly?: unknown;
}

function fail(
  partial: Partial<AyasPhoneLlmCapabilityResult>,
  reason: AyasPhoneLlmCapabilityReason,
  detail: string,
): AyasPhoneLlmCapabilityResult {
  return {
    capable: false,
    secureContext: false,
    webgpuApiPresent: false,
    adapterObtained: false,
    deviceObtained: false,
    deviceMemoryGb: null,
    adapterVendor: null,
    wasmAvailable: false,
    userAgent: null,
    ...partial,
    reason,
    detail,
  };
}

export async function detectAyasPhoneLlmCapability(
  win: AyasPhoneLlmCapabilityWindowLike | undefined,
): Promise<AyasPhoneLlmCapabilityResult> {
  if (!win) {
    return fail({}, "unknown-error", "window ortamı yok (SSR/dev-only sayfa dışında çağrıldı).");
  }

  const wasmAvailable = typeof win.WebAssembly !== "undefined";
  const userAgent = typeof win.navigator?.userAgent === "string" ? win.navigator.userAgent : null;

  const secureContext = win.isSecureContext === true;
  if (!secureContext) {
    return fail(
      { secureContext, wasmAvailable, userAgent },
      "insecure-context",
      "Sayfa güvenli bağlamda (HTTPS) değil — WebGPU yalnızca https/localhost üzerinde çalışır.",
    );
  }

  const gpu = win.navigator?.gpu;
  if (!gpu || typeof gpu.requestAdapter !== "function") {
    return fail(
      { secureContext, webgpuApiPresent: false, wasmAvailable, userAgent },
      "webgpu-api-missing",
      "navigator.gpu bu tarayıcıda yok — WebGPU desteklenmiyor (Safari < 26 / eski Chrome / WebGPU kapalı).",
    );
  }

  const deviceMemoryGb = typeof win.navigator?.deviceMemory === "number" ? win.navigator.deviceMemory : null;

  let adapter: AyasWebGpuAdapterLike | null;
  try {
    adapter = await gpu.requestAdapter();
  } catch (error) {
    return fail(
      { secureContext, webgpuApiPresent: true, deviceMemoryGb, wasmAvailable, userAgent },
      "no-adapter",
      `requestAdapter() hata verdi: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!adapter) {
    return fail(
      { secureContext, webgpuApiPresent: true, deviceMemoryGb, wasmAvailable, userAgent },
      "no-adapter",
      "requestAdapter() null döndü — bu cihaz/tarayıcı kombinasyonunda uygun bir GPU adaptörü yok.",
    );
  }

  const adapterVendor = typeof adapter.info?.vendor === "string" ? adapter.info.vendor : null;

  try {
    await adapter.requestDevice();
  } catch (error) {
    return fail(
      { secureContext, webgpuApiPresent: true, adapterObtained: true, deviceMemoryGb, adapterVendor, wasmAvailable, userAgent },
      "device-request-failed",
      `requestDevice() hata verdi: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return {
    capable: true,
    secureContext,
    webgpuApiPresent: true,
    adapterObtained: true,
    deviceObtained: true,
    deviceMemoryGb,
    adapterVendor,
    wasmAvailable,
    userAgent,
    reason: null,
    detail: null,
  };
}

/** The fixed, user-facing fail-closed message (spec) — one place, never re-worded per call site. */
export const AYAS_PHONE_LLM_UNAVAILABLE_MESSAGE = "Telefon local beyin bu cihazda kullanılamıyor.";
