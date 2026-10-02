"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AYAS_SESSION_COOKIE, resolveAccessGate, verifySession } from "../../../src/lib/auth/accessGate";
import { constitutionDigest, proposeAyasOwnerConstitution } from "../../../src/lib/ayas/governance/AyasOwnerConstitution";
import { activateAyasOwnerConstitution } from "../../../src/lib/ayas/governance/AyasOwnerConstitutionStore";

/** Cookie authentication is checked before form interpretation; no caller-provided owner/session flag. */
export async function adoptAyasOwnerConstitution(form: FormData): Promise<void> {
  const gate = resolveAccessGate(process.env);
  const session = (await cookies()).get(AYAS_SESSION_COOKIE)?.value;
  if (gate.mode !== "enforced" || !gate.key || !await verifySession(session, gate.key)) throw new Error("AYAS_CONSTITUTION_OWNER_SESSION_REQUIRED");
  const proposal = proposeAyasOwnerConstitution();
  if (form.get("proposalDigest") !== constitutionDigest(proposal) || [...form.keys()].some((key) => key !== "proposalDigest")) throw new Error("AYAS_CONSTITUTION_REVIEW_BINDING_REQUIRED");
  await activateAyasOwnerConstitution({ repoRoot: process.cwd(), policy: proposal, expectedPreviousDigest: null, ownerSession: session });
  redirect("/brain/constitution");
}
