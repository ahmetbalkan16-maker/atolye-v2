import { execFileSync } from "node:child_process";

/**
 * The one `git push` an owner-approved publication performs, with a bounded
 * retry for a failure that a later identical attempt can succeed at.
 *
 * Why (2026-11-04): an owner-approved publication committed its change, then
 * GitHub answered the single push with
 *
 *     remote: Internal Server Error
 *      ! [remote rejected]   <branch> -> <branch> (Internal Server Error)
 *     error: failed to push some refs to '…'
 *
 * The commit was real, so the guard correctly refused to rewrite it and the
 * proposal became RECOVERY_REQUIRED; nothing pushed it and Graphify stayed on
 * the old HEAD for 21 hours. A server error is a temporary condition, not an
 * answer about the change.
 *
 * Retrying is safe by construction: the arguments are always exactly
 * `push <remote> <branch>` — never `--force`, `--force-with-lease` or a
 * `+refspec` — so a repeat can only fast-forward the remote to the same
 * commits or fail again. That is why only a failure that is a real answer is
 * excluded (the remote moved, the credentials or permissions refuse, a hook
 * or branch protection declines, the repository is wrong); every other
 * failure, including an unrecognised one, is tried again a bounded number of
 * times. Git reports a server error as `[remote rejected] … (Internal Server
 * Error)`, so the word "rejected" alone decides nothing: the local
 * `[rejected]` marker and the reason in parentheses do.
 */
export type AyasGitPushFailureClass = "TRANSIENT" | "PERMANENT";

/** Answers that a repeat would get byte-for-byte again. */
const PERMANENT_PATTERNS: readonly RegExp[] = [
  // The remote moved: Git's own local rejection, never the server's "[remote rejected]".
  /(?<!remote )\[rejected\]/i,
  /non-fast-forward/i,
  /\(fetch first\)/i,
  /updates were rejected because/i,
  // The server declined on purpose.
  /hook declined/i,
  /protected branch/i,
  /\bGH0\d\d\b/,
  // Credentials, permissions, the repository itself.
  /authentication failed/i,
  /permission denied/i,
  /permission to .+ denied/i,
  /access denied/i,
  /not allowed to push/i,
  /could not read (?:username|password)/i,
  /terminal prompts disabled/i,
  /repository not found/i,
  /does not appear to be a git repository/i,
  /src refspec .+ does not match any/i,
  /the requested url returned error: 40[0-9]/i,
];

export function classifyAyasGitPushFailure(message: string): AyasGitPushFailureClass {
  return PERMANENT_PATTERNS.some((pattern) => pattern.test(message)) ? "PERMANENT" : "TRANSIENT";
}

export interface AyasGitPushRetryOptions {
  /** Total attempts including the first; default 4, clamped to 1..6. */
  readonly attempts?: number;
  /** Pause before attempt 2, 3, … (the last value repeats); default 2 s, 8 s, 20 s. */
  readonly backoffMs?: readonly number[];
  /** Test seam; production runs `git <args>` exactly as the publication lanes always did. */
  readonly run?: (repoRoot: string, args: readonly string[]) => void;
  /** Test seam; production pauses the calling thread (the lanes already run Git synchronously, in a worker). */
  readonly sleep?: (milliseconds: number) => void;
  /** Called before each retry, for the caller's log. */
  readonly onRetry?: (attempt: number, failureClass: AyasGitPushFailureClass, message: string) => void;
}

const DEFAULT_ATTEMPTS = 4;
const DEFAULT_BACKOFF_MS: readonly number[] = [2_000, 8_000, 20_000];

/** The lanes' own Git call: same options, so a failure carries the same message (stderr included). */
function runGit(repoRoot: string, args: readonly string[]): void {
  execFileSync("git", [...args], { cwd: repoRoot, encoding: "utf8", windowsHide: true });
}

function pause(milliseconds: number): void {
  if (Number.isFinite(milliseconds) && milliseconds > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function ayasGitFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `git push <remoteName> <branch>`, retried while the failure is TRANSIENT.
 * Returns the number of attempts it took; when it gives up it rethrows the
 * last failure unchanged, so a caller's existing catch path (recovery record,
 * returned message) behaves exactly as for the single attempt it replaces.
 */
export function pushAyasBranchWithRetry(repoRoot: string, remoteName: string, branch: string, options: AyasGitPushRetryOptions = {}): { readonly attempts: number } {
  if (!remoteName || remoteName.startsWith("-") || !branch || branch.startsWith("-") || branch.startsWith("+") || branch.includes(":")) {
    throw new Error(`AYAS_GIT_PUSH_REFUSED: "${remoteName}" "${branch}" is not a plain remote and branch`);
  }
  const attempts = Math.max(1, Math.min(6, Math.trunc(options.attempts ?? DEFAULT_ATTEMPTS)));
  const backoff = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const run = options.run ?? runGit;
  const sleep = options.sleep ?? pause;
  for (let attempt = 1; ; attempt += 1) {
    try {
      run(repoRoot, ["push", remoteName, branch]);
      return { attempts: attempt };
    } catch (error) {
      const failureClass = classifyAyasGitPushFailure(ayasGitFailureMessage(error));
      if (failureClass === "PERMANENT" || attempt >= attempts) throw error;
      options.onRetry?.(attempt, failureClass, ayasGitFailureMessage(error));
      sleep(backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 0);
    }
  }
}

/**
 * `git fetch <remoteName> <branch>`: brings `<remoteName>/<branch>` up to date
 * so a recovery decides from what the remote holds now, not from the last
 * push this checkout made. It writes only the remote-tracking ref. Returns
 * false (never throws) when the remote cannot be reached.
 */
export function fetchAyasRemoteBranch(repoRoot: string, remoteName: string, branch: string, run: (repoRoot: string, args: readonly string[]) => void = runGit): boolean {
  if (!remoteName || remoteName.startsWith("-") || !branch || branch.startsWith("-") || branch.includes(":")) return false;
  try {
    // The "+" is Git's default for a remote-tracking ref: it follows the remote even if the remote was rewritten,
    // which is exactly what a recovery must see. Local branches are never touched.
    run(repoRoot, ["fetch", "--quiet", "--no-tags", remoteName, `+refs/heads/${branch}:refs/remotes/${remoteName}/${branch}`]);
    return true;
  } catch {
    return false;
  }
}
