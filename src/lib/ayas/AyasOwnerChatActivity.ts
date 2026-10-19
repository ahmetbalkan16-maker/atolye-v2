import fs from "node:fs";
import path from "node:path";

/**
 * Owner decision 2026-10-19 — the time of the owner's latest chat turn, so the automatic live publish
 * (scripts/ayas-update-executor.ts) does not restart the live app in the middle of a conversation.
 *
 *   <repo>/data/brain/phone-access/owner-chat-activity.json   { "schemaVersion": 1, "lastChatAt": "<ISO>" }
 *
 * Only a timestamp, never the text. Scheduling only: it can delay a publish, never permit anything. A failed write is
 * ignored and never changes the chat answer.
 */
export const AYAS_OWNER_CHAT_ACTIVITY_FILE = path.join("data", "brain", "phone-access", "owner-chat-activity.json");

export function markAyasOwnerChatActivity(repoRoot: string = process.cwd(), now: Date = new Date()): void {
  try {
    const file = path.join(repoRoot, AYAS_OWNER_CHAT_ACTIVITY_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify({ schemaVersion: 1, lastChatAt: now.toISOString() })}\n`, "utf8");
    fs.renameSync(temporary, file);
  } catch { /* scheduling hint only */ }
}

/** The latest chat turn's time, or undefined when none is recorded or the record is unreadable. */
export function readAyasOwnerChatActivityAt(repoRoot: string = process.cwd()): string | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(repoRoot, AYAS_OWNER_CHAT_ACTIVITY_FILE), "utf8")) as { readonly lastChatAt?: unknown };
    return typeof parsed.lastChatAt === "string" && Number.isFinite(Date.parse(parsed.lastChatAt)) ? parsed.lastChatAt : undefined;
  } catch { return undefined; }
}
