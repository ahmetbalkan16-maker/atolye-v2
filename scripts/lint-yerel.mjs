// Local full-repo lint for this Windows machine: `node scripts/lint-yerel.mjs` (same rules as CI's `npm run lint`).
//
// Why (21 Oct 2026 scan): under D:\ÜRETİM, `npm run lint` / `eslint .` reported 167k problems, all from node_modules,
// because none of the config's ignores matched. The "İ" of ÜRETİM lower-cases to two characters ("i̇"), and Windows
// path comparison lower-cases paths, so ESLint's paths relative to the repo come out shifted and match no pattern
// (node_modules, remotion-v3/**, output/**, file-specific rule blocks). CI runs on an ASCII Linux path and is not
// affected. Here ESLint is given the repo through the ASCII junction D:\URETIM (same files) as its working directory;
// with `npx` or the CLI the working directory is resolved back to the Unicode path, so the API is used.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const real = process.cwd();
const ascii = real.replace(/ÜRETİM/i, "URETIM");
const root = ascii !== real && existsSync(path.join(ascii, "package.json")) ? ascii : real;
const require = createRequire(path.join(root, "package.json"));
const { ESLint } = require("eslint");

const eslint = new ESLint({ cwd: root });
const results = await eslint.lintFiles(["."]);
const formatter = await eslint.loadFormatter("stylish");
const text = await formatter.format(results);
if (text) console.log(text);
const errors = results.reduce((n, r) => n + r.errorCount, 0);
const warnings = results.reduce((n, r) => n + r.warningCount, 0);
console.log(`lint (${root}): ${results.length} dosya, ${errors} hata, ${warnings} uyarı`);
process.exit(errors || warnings ? 1 : 0);
