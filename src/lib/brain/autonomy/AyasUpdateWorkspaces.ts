import path from "node:path";

/**
 * Sub-packages with their own package.json and lock beside the root app (owner decision 2026-11-02, "hangisi ayası
 * atölyeyi gelişime açacaksa yapalım": the radar's "dene, sonra uygula" also covers V3's Remotion). The root lock is the
 * live app's; a sub-package's lock only feeds its own tool, so its update is tried, committed and installed on its own.
 * This module says, for each one, where it lives, what npm does not install that the tool still needs, which smokes load
 * its modules and how the tool itself is run once in a trial. Pure: no file is read here.
 */
export interface AyasUpdateWorkspace {
  /** The folder, relative to the repository root (forward slashes). */
  readonly dir: string;
  /** Folders inside node_modules that npm does not install and the tool needs; carried over from the installed copy. */
  readonly carry: readonly string[];
  /** Smokes that load the sub-package's modules. */
  readonly smokes: readonly string[];
  /** One real run of the tool after the install, from the sub-package folder with the trial's node. */
  readonly check: { readonly label: string; readonly args: (outDir: string) => readonly string[] };
}

export const AYAS_UPDATE_WORKSPACES: Readonly<Record<string, AyasUpdateWorkspace>> = Object.freeze({
  "remotion-v3": Object.freeze({
    dir: "remotion-v3",
    // Remotion's headless Chrome: downloaded once by the first render, never part of the lock.
    carry: Object.freeze(["node_modules/.remotion"]),
    smokes: Object.freeze(["scripts/smoke-v3-motion.ts", "scripts/smoke-v3-episode-director.ts", "scripts/smoke-v3-render.ts"]),
    check: Object.freeze({
      label: "Remotion ile 15 karelik deneme videosu",
      // The Episode composition with its empty default plan: bundling, the headless Chrome and the encoder, end to end.
      args: (outDir: string) => Object.freeze(["node_modules/@remotion/cli/remotion-cli.js", "render", "src/index.ts", "Episode", path.join(outDir, "ayas-update-trial.mp4"), "--frames=0-14", "--log=error"]),
    }),
  }),
});

const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/** The radar target of an npm tool: `npm:<package>` at the root, `npm:<workspace>/<package>` in a sub-package. */
export function ayasUpdateTarget(packageName: string, workspace?: string): string {
  return `npm:${workspace ? `${workspace}/` : ""}${packageName}`;
}

/** The inverse of ayasUpdateTarget; undefined for anything else (an unknown folder is never a workspace). */
export function parseAyasUpdateTarget(target: string): { readonly packageName: string; readonly workspace?: AyasUpdateWorkspace } | undefined {
  if (typeof target !== "string" || !target.startsWith("npm:")) return undefined;
  const rest = target.slice("npm:".length);
  const workspace = Object.values(AYAS_UPDATE_WORKSPACES).find((entry) => rest.startsWith(`${entry.dir}/`));
  const packageName = workspace ? rest.slice(workspace.dir.length + 1) : rest;
  return NPM_NAME.test(packageName) ? Object.freeze({ packageName, ...(workspace ? { workspace } : {}) }) : undefined;
}

/** The two files a dependency update of this package set changes, sorted: the root's, or the sub-package's. */
export function ayasDependencyUpdateFiles(workspace?: AyasUpdateWorkspace): readonly string[] {
  const prefix = workspace ? `${workspace.dir}/` : "";
  return Object.freeze([`${prefix}package-lock.json`, `${prefix}package.json`]);
}
