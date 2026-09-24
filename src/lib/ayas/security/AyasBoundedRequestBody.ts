/** Byte-bound JSON reader for private AYAS request routes. */
export type AyasBoundedJsonResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: "payload_too_large" | "invalid_json" };

export async function readAyasBoundedJsonBody(request: Request, maxBytes: number): Promise<AyasBoundedJsonResult> {
  if (!request.body || !Number.isSafeInteger(maxBytes) || maxBytes < 1) return { ok: false, reason: "invalid_json" };
  const reader = request.body.getReader();
  const bytes = Buffer.allocUnsafe(maxBytes);
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      if (part.value.byteLength > maxBytes - length) {
        void reader.cancel().catch(() => undefined);
        return { ok: false, reason: "payload_too_large" };
      }
      bytes.set(part.value, length);
      length += part.value.byteLength;
    }
    try { return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length))) }; }
    catch { return { ok: false, reason: "invalid_json" }; }
  } catch {
    return { ok: false, reason: "invalid_json" };
  } finally {
    reader.releaseLock();
  }
}
