/**
 * Decides what the "start a project" UI should do with a `POST /api/pipeline`
 * response. Extracted from HomeClient so the branching is unit-testable.
 *
 * Contract: the route returns `projectUrl` whenever a project exists that the
 * user can act on — a full success, a `stopReason` stop, OR a mid-pipeline
 * failure where the project was already created. In every one of those cases
 * the user belongs on the project page (progress + resume/retry). Only a
 * response with no `projectUrl` (empty topic, or a failure before the project
 * was created) is shown as an inline error on the start screen.
 */
export interface PipelineStartResponseBody {
  readonly success?: boolean;
  readonly slug?: string;
  readonly projectUrl?: string;
  readonly error?: string;
}

export type PipelineStartOutcome =
  | { readonly kind: "navigate"; readonly to: string }
  | { readonly kind: "error"; readonly message: string };

const GENERIC_ERROR = "Üretim akışı tamamlanamadı.";

const SAFE_PROJECT_URL = /^\/project\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function resolvePipelineStartOutcome(
  body: PipelineStartResponseBody | null | undefined,
): PipelineStartOutcome {
  const projectUrl = typeof body?.projectUrl === "string" ? body.projectUrl : undefined;

  // Only ever navigate to a project route the route contract can actually
  // produce (`/project/<slug>` with slug = lowercase alnum + dashes). Anything
  // else is treated as "no usable reference".
  if (projectUrl && SAFE_PROJECT_URL.test(projectUrl)) {
    return { kind: "navigate", to: projectUrl };
  }

  const message = typeof body?.error === "string" && body.error.trim()
    ? body.error
    : GENERIC_ERROR;
  return { kind: "error", message };
}
