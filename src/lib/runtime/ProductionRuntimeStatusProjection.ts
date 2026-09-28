import type { ProductionRuntimeStatus } from "@/types/productionRuntimeStatus";

// Next may bundle instrumentation and route handlers as separate module graphs.
// Share only a status reader; no lifecycle, initializer, or execution capability crosses this boundary.
const statusProjectionKey = Symbol.for("@atolye/production-runtime-status-projection/v1");

interface StatusProjection {
  readonly schemaVersion: "1";
  reader: (() => ProductionRuntimeStatus) | null;
}

function projection(): StatusProjection {
  const scope = globalThis as typeof globalThis & { [statusProjectionKey]?: unknown };
  const existing = Object.getOwnPropertyDescriptor(scope, statusProjectionKey);
  if (existing) {
    const value = existing.value as StatusProjection | undefined;
    if (
      existing.configurable || existing.writable ||
      value?.schemaVersion !== "1" ||
      (value.reader !== null && typeof value.reader !== "function")
    ) throw new Error("PRODUCTION_RUNTIME_STATUS_PROJECTION_INVALID");
    return value;
  }
  const value: StatusProjection = { schemaVersion: "1", reader: null };
  Object.defineProperty(scope, statusProjectionKey, {
    configurable: false,
    enumerable: false,
    writable: false,
    value,
  });
  return value;
}

export function registerProductionRuntimeStatusReader(reader: () => ProductionRuntimeStatus): void {
  const holder = projection();
  if (holder.reader && holder.reader !== reader) {
    throw new Error("PRODUCTION_RUNTIME_STATUS_READER_CONFLICT");
  }
  holder.reader = reader;
}

export function readProductionRuntimeStatus(fallback: () => ProductionRuntimeStatus): ProductionRuntimeStatus {
  return (projection().reader ?? fallback)();
}
