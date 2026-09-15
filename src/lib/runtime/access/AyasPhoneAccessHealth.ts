import fs from "node:fs";
import path from "node:path";

/**
 * AYAS phone access health (Phone Access sprint).
 *
 * A small, bounded, READ-ONLY view of whether AYAS is reachable from a phone
 * right now — local app server, LAN, and the Cloudflare tunnel.
 * The daemon (`scripts/ayas-access-daemon.ts` → `ayas-access-daemon.ps1`)
 * OWNS process/network truth and writes a tiny status file; this module only
 * ever reads it, deep-validates the shape, and fails safe ("unknown"/
 * "offline") on anything missing, oversized, malformed, or stale — the same
 * fail-safe idiom used across this codebase's other small JSON status/marker
 * readers (e.g. `RuntimeAuthorityGenerationMarker.ts`).
 *
 * Deliberately NOT here and never will be: an execution-gate field, a
 * self-improvement trigger, or a production-resume flag. This module reports
 * "can a phone reach AYAS", nothing else — booting the PC and reaching this
 * "online" is not, and must never become, an execution authorization.
 */

export type AyasPhoneAccessComponentStatus = "online" | "offline" | "starting";
export type AyasPhoneAccessLanStatus = "online" | "offline" | "unknown";
export type AyasPhoneAccessBackendStatus = "online" | "degraded" | "offline";

export interface AyasPhoneAccessHealth {
  readonly appServer: AyasPhoneAccessComponentStatus;
  readonly lanAccess: AyasPhoneAccessLanStatus;
  readonly tunnel: AyasPhoneAccessComponentStatus;
  readonly ayasBackend: AyasPhoneAccessBackendStatus;
  /**
   * The current public tunnel URL, when the daemon reports `tunnel: "online"`.
   * Quick Tunnel URLs are EPHEMERAL — a new daemon run mints a new one —
   * while the named tunnel URL is stable; both are diagnostic, never an
   * execution authority.
   * `null` when no tunnel is up. Shown to the operator, not a secret by
   * itself (it grants no access beyond the same access-gate login every
   * other AYAS URL already requires) — still worth NOT logging broadly, since
   * an unnecessarily-wide audience learning it is a needless exposure surface.
   */
  readonly tunnelUrl: string | null;
  /** ISO timestamp the daemon last wrote this file, or `null` if unknown/absent. */
  readonly updatedAt: string | null;
  /** `true` when the status file is missing, unreadable, malformed, or stale. */
  readonly stale: boolean;
}

const STATUS_RELATIVE_PATH = ["data", "brain", "phone-access", "status.json"] as const;
const MAX_STATUS_BYTES = 4 * 1024;
/** Older than this and the daemon is presumed dead/hung — never trust a frozen "online". */
const STALE_AFTER_MS = 5 * 60 * 1000;

const OFFLINE_HEALTH: AyasPhoneAccessHealth = Object.freeze({
  appServer: "offline",
  lanAccess: "unknown",
  tunnel: "offline",
  ayasBackend: "offline",
  tunnelUrl: null,
  updatedAt: null,
  stale: true,
});

export interface ReadAyasPhoneAccessHealthOptions {
  /** Test seam — defaults to `process.cwd()`-relative `data/brain/phone-access/status.json`. */
  readonly statusFilePath?: string;
  /** Test seam — defaults to `Date.now`. */
  readonly now?: () => number;
}

/** Read-only. Never throws, never writes, never repairs. */
export function readAyasPhoneAccessHealth(
  options: ReadAyasPhoneAccessHealthOptions = {},
): AyasPhoneAccessHealth {
  const statusFilePath = options.statusFilePath ?? path.join(process.cwd(), ...STATUS_RELATIVE_PATH);
  const now = options.now ?? (() => Date.now());

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(statusFilePath);
  } catch {
    return OFFLINE_HEALTH;
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > MAX_STATUS_BYTES) {
    return OFFLINE_HEALTH;
  }

  let parsed: unknown;
  try {
    // Defensive BOM strip — Windows tooling (PowerShell `Set-Content -Encoding
    // utf8`, notably) commonly writes a leading UTF-8 BOM, which `JSON.parse`
    // rejects outright; strip it rather than trust every possible writer.
    const raw = fs.readFileSync(statusFilePath, "utf8").replace(/^﻿/, "");
    parsed = JSON.parse(raw);
  } catch {
    return OFFLINE_HEALTH;
  }
  if (!isRawStatusShape(parsed)) return OFFLINE_HEALTH;

  const updatedAtMs = Date.parse(parsed.updatedAt);
  const stale = !Number.isFinite(updatedAtMs) || now() - updatedAtMs > STALE_AFTER_MS;

  if (stale) {
    // A stale file still names when it was last known-good, but every
    // component reads as its safe default — a frozen daemon must never keep
    // reporting "online" forever.
    return { ...OFFLINE_HEALTH, updatedAt: parsed.updatedAt };
  }

  return Object.freeze({
    appServer: parsed.appServer,
    lanAccess: parsed.lanAccess,
    tunnel: parsed.tunnel,
    ayasBackend: parsed.ayasBackend,
    tunnelUrl: typeof parsed.tunnelUrl === "string" && parsed.tunnelUrl.length > 0 ? parsed.tunnelUrl : null,
    updatedAt: parsed.updatedAt,
    stale: false,
  });
}

interface RawAyasPhoneAccessStatus {
  readonly appServer: AyasPhoneAccessComponentStatus;
  readonly lanAccess: AyasPhoneAccessLanStatus;
  readonly tunnel: AyasPhoneAccessComponentStatus;
  readonly ayasBackend: AyasPhoneAccessBackendStatus;
  readonly tunnelUrl: unknown;
  readonly updatedAt: string;
}

const COMPONENT_STATUSES: readonly AyasPhoneAccessComponentStatus[] = ["online", "offline", "starting"];
const LAN_STATUSES: readonly AyasPhoneAccessLanStatus[] = ["online", "offline", "unknown"];
const BACKEND_STATUSES: readonly AyasPhoneAccessBackendStatus[] = ["online", "degraded", "offline"];
/** Only AYAS Cloudflare tunnel hosts are trusted; arbitrary URLs fail closed. */
const TUNNEL_URL_PATTERN = /^https:\/\/(?:[a-z0-9-]+\.trycloudflare\.com|ayas\.atolyeayas\.com)\/?$/;

function isRawStatusShape(value: unknown): value is RawAyasPhoneAccessStatus {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.appServer === "string" && COMPONENT_STATUSES.includes(record.appServer as AyasPhoneAccessComponentStatus) &&
    typeof record.lanAccess === "string" && LAN_STATUSES.includes(record.lanAccess as AyasPhoneAccessLanStatus) &&
    typeof record.tunnel === "string" && COMPONENT_STATUSES.includes(record.tunnel as AyasPhoneAccessComponentStatus) &&
    typeof record.ayasBackend === "string" && BACKEND_STATUSES.includes(record.ayasBackend as AyasPhoneAccessBackendStatus) &&
    (record.tunnelUrl === null || record.tunnelUrl === undefined ||
      (typeof record.tunnelUrl === "string" && TUNNEL_URL_PATTERN.test(record.tunnelUrl))) &&
    typeof record.updatedAt === "string" && Number.isFinite(Date.parse(record.updatedAt))
  );
}
