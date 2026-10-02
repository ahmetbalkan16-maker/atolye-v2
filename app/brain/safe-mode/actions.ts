"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AYAS_SESSION_COOKIE } from "../../../src/lib/auth/accessGate";
import { readAyasSafeMode } from "../../../src/lib/ayas/safety/AyasSafeModeReader";
import { AyasSafeModeExitRefusedError, enterAyasSafeMode, exitAyasSafeMode } from "../../../src/lib/ayas/safety/AyasSafeModeStore";

/** React's own form fields (`$ACTION_…`) may or may not be present, depending on how the form was submitted. */
const ownFields = (form: FormData): string[] => [...form.keys()].filter((key) => !key.startsWith("$ACTION_"));

/** The one owner-visible action. Entering only tightens; who entered is derived from the cookie session by the store. */
export async function enterSafeReadOnly(form: FormData): Promise<void> {
  if (ownFields(form).length > 0) throw new Error("AYAS_SAFE_MODE_FORM_INVALID");
  const session = (await cookies()).get(AYAS_SESSION_COOKIE)?.value;
  await enterAyasSafeMode({ repoRoot: process.cwd(), ...(session ? { ownerSession: session } : {}) });
  redirect("/brain/safe-mode");
}

/**
 * Leaving the mode. The session is read from the trusted cookie, never from the form; the store verifies it
 * before anything else and again before it writes. The form carries only the digest of the mode the owner was
 * shown, so a stale page cannot leave a mode that was entered again since.
 */
export async function exitSafeReadOnly(form: FormData): Promise<void> {
  const session = (await cookies()).get(AYAS_SESSION_COOKIE)?.value;
  if (ownFields(form).some((key) => key !== "modeDigest")) throw new Error("AYAS_SAFE_MODE_FORM_INVALID");
  const current = readAyasSafeMode(process.cwd());
  if (current.state !== "SAFE_READ_ONLY" || form.get("modeDigest") !== current.lastDigest) throw new Error("AYAS_SAFE_MODE_REVIEW_BINDING_REQUIRED");
  try {
    await exitAyasSafeMode({ repoRoot: process.cwd(), ownerSession: session });
  } catch (error) {
    // A failed health check is not an error page: the page shows the checks as they are now.
    if (!(error instanceof AyasSafeModeExitRefusedError)) throw error;
  }
  redirect("/brain/safe-mode");
}
