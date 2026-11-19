/**
 * Server-side logout for the AYAS session cookie (owner approval 2026-11-19: "onay bekleyenleri onaylıyorum, tasarım
 * gerekenlerinde yap; bir şeyi yaparken başka bir şeyi bozma").
 *
 * Before this, "Çıkış" only asked the browser to forget the cookie: a copy of it (another tab's backup, a stolen
 * cookie, a synced browser profile) stayed valid for the rest of its 7-day life, because the middleware ran on the
 * edge runtime and could not read anything the logout route wrote. The middleware now runs on the Node.js runtime
 * (`export const config.runtime = "nodejs"` in `middleware.ts`), so a logout records the exact cookie it ended and
 * every later request carrying that cookie is refused.
 *
 * One file per ended cookie, named by a keyed digest of the cookie's signed body (`sessionRevocationTarget` in
 * `accessGate.ts`): a logout never rewrites a shared list, so two logouts at once cannot lose one another, and the
 * check per request is a single `stat`. The file name is not the cookie and cannot be turned back into it. Each record
 * keeps the cookie's own expiry and is removed after it, so the folder holds at most a week of logouts.
 *
 * Only the cookie that was logged out ends; the owner's other devices stay signed in (the gate is one shared passcode,
 * so this is the least surprising logout). Cookies issued before this change carry the same signed body and are
 * revoked the same way — nothing about an existing session changes until it is logged out.
 *
 * The folder sits under `data/brain/phone-access/` (already Git-ignored, the access state's home) relative to the
 * server's working directory — the canonical repo for the live app, like every other `data/brain` store.
 */

import fs from "node:fs";
import path from "node:path";

import { sessionRevocationTarget } from "./accessGate";

export const AYAS_SESSION_REVOCATION_DIR = path.join("data", "brain", "phone-access", "session-revocations");
const RECORD_SCHEMA_VERSION = 1;
const RECORD_NAME = /^[0-9a-f]{64}\.json$/;

export function sessionRevocationDir(root: string = process.cwd()): string {
  return path.join(root, AYAS_SESSION_REVOCATION_DIR);
}

/**
 * Whether the cookie with this revocation id was logged out. Fails closed: only "no such file" (or a missing folder)
 * means "not revoked"; any other error reading the record — a permission problem, a broken disk — refuses the session
 * rather than letting a possibly logged-out cookie through. The owner can always sign in again: a fresh cookie has a
 * fresh id.
 */
export function isSessionRevoked(id: string, root: string = process.cwd()): boolean {
  if (!/^[0-9a-f]{64}$/.test(id)) return true;
  try {
    return fs.statSync(path.join(sessionRevocationDir(root), `${id}.json`), { throwIfNoEntry: false }) !== undefined;
  } catch {
    return true;
  }
}

/**
 * Whether this cookie was logged out — what the middleware asks after `verifySession` accepted it. A cookie that does
 * not verify counts as revoked (fail closed), so the answer is never "fine" for a cookie nobody checked.
 */
export async function isSessionTokenRevoked(
  token: string | undefined | null,
  key: string,
  options: { readonly root?: string; readonly now?: number } = {},
): Promise<boolean> {
  const target = await sessionRevocationTarget(token, key, options.now ?? Date.now());
  if (!target) return true;
  return isSessionRevoked(target.id, options.root);
}

/**
 * `verifySession` (inside `sessionRevocationTarget`), then the revocation check, in one call. A malformed, forged or
 * expired cookie is refused before anything touches the disk.
 */
export async function verifyActiveSession(
  token: string | undefined | null,
  key: string,
  options: { readonly root?: string; readonly now?: number } = {},
): Promise<boolean> {
  return !await isSessionTokenRevoked(token, key, options);
}

export type SessionRevocationResult =
  | { readonly kind: "revoked"; readonly id: string }
  | { readonly kind: "not-a-session" }
  | { readonly kind: "write-failed"; readonly reason: string };

/**
 * Records that this cookie was logged out (temp file + rename, so a reader never sees half a record), then removes
 * records whose cookie has expired anyway. A cookie that does not verify (already expired, forged, missing) needs no
 * record: the gate refuses it on its own. The caller still clears the browser's cookie whatever this returns; a
 * failed write is reported so the logout route can say so instead of pretending the cookie is dead.
 */
export async function revokeSession(
  token: string | undefined | null,
  key: string,
  options: { readonly root?: string; readonly now?: number } = {},
): Promise<SessionRevocationResult> {
  const now = options.now ?? Date.now();
  const target = await sessionRevocationTarget(token, key, now);
  if (!target) return { kind: "not-a-session" };
  const dir = sessionRevocationDir(options.root);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${target.id}.json`);
    const temp = path.join(dir, `.pending-${process.pid}-${now}-${Math.random().toString(16).slice(2)}`);
    const record = { schemaVersion: RECORD_SCHEMA_VERSION, revokedAt: Math.floor(now / 1000), expiresAt: target.expiresAt };
    const fd = fs.openSync(temp, "wx");
    try {
      fs.writeFileSync(fd, `${JSON.stringify(record)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, file);
  } catch (error) {
    return { kind: "write-failed", reason: error instanceof Error ? error.message : String(error) };
  }
  pruneExpiredRevocations(options.root, now);
  return { kind: "revoked", id: target.id };
}

/**
 * Deletes the records of cookies that have expired by themselves (the gate refuses those without a record), so the
 * folder never grows beyond a week of logouts. A record that cannot be read is kept: deleting it could bring a
 * logged-out cookie back. Leftover `.pending-*` files older than a minute (a crash between write and rename) go too.
 * Never throws.
 */
export function pruneExpiredRevocations(root: string = process.cwd(), now: number = Date.now()): number {
  const dir = sessionRevocationDir(root);
  let removed = 0;
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  const seconds = Math.floor(now / 1000);
  for (const name of entries) {
    const file = path.join(dir, name);
    try {
      if (name.startsWith(".pending-")) {
        if (now - fs.statSync(file).mtimeMs > 60_000) {
          fs.rmSync(file, { force: true });
          removed += 1;
        }
        continue;
      }
      if (!RECORD_NAME.test(name)) continue;
      const record = JSON.parse(fs.readFileSync(file, "utf8")) as { readonly expiresAt?: unknown };
      if (typeof record.expiresAt === "number" && Number.isFinite(record.expiresAt) && record.expiresAt < seconds) {
        fs.rmSync(file, { force: true });
        removed += 1;
      }
    } catch {
      // unreadable: keep it (fail closed)
    }
  }
  return removed;
}
