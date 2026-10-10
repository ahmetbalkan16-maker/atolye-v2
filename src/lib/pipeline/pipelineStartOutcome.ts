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

/** How far a project's `createdAt` may precede the request: phone and server clocks differ. */
export const STARTED_PROJECT_CLOCK_TOLERANCE_MS = 5 * 60_000;

/**
 * The project page of the project this start request created, once the
 * projects list (`GET /api/projects`) shows it — or `null`.
 *
 * `POST /api/pipeline` runs the whole production inside the request, and a
 * proxy in front of the server (Cloudflare answers 524 after 100 s) can drop
 * the response long before it ends, while the production keeps running. The
 * project is created first, so the start screen can find it by the topic's own
 * slug and take the user to its live progress page instead of an error. A
 * project of the same slug created before this request (beyond the clock
 * tolerance) is an older project and is never taken for it.
 */
export function findStartedProjectUrl(
  projects: unknown,
  slug: string,
  requestStartedAtMs: number,
  toleranceMs: number = STARTED_PROJECT_CLOCK_TOLERANCE_MS,
): string | null {
  const projectUrl = `/project/${slug}`;
  if (!SAFE_PROJECT_URL.test(projectUrl) || !Array.isArray(projects) || !Number.isFinite(requestStartedAtMs)) return null;
  const found = projects.some((project: unknown) => {
    if (!project || typeof project !== "object") return false;
    const { slug: projectSlug, createdAt } = project as { slug?: unknown; createdAt?: unknown };
    const created = typeof createdAt === "string" ? Date.parse(createdAt) : Number.NaN;
    return projectSlug === slug && Number.isFinite(created) && created >= requestStartedAtMs - toleranceMs;
  });
  return found ? projectUrl : null;
}
