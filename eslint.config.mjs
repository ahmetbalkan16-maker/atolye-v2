import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  { files: ["scripts/smoke-production-execution-durable-attempt.ts"], rules: { "@typescript-eslint/no-explicit-any": "off" } },
  { files: ["src/types/productionExecutionDurableAttempt.ts"], rules: { "@typescript-eslint/no-empty-object-type": "off" } },
  { files: ["src/lib/production/ProductionExecutionDurableAttempt.ts"], rules: { "@typescript-eslint/no-unused-vars": "off" } },
]);

export default eslintConfig;
