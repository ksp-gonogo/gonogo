// Workspace definition for pnpm test (turbo per-package runs use their own configs).
// pnpm coverage uses vitest.config.ts directly, not this file: for a single-process
// cross-package coverage run.
import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/core/vitest.config.ts",
  "packages/ui/vitest.config.ts",
  "packages/components/vitest.config.ts",
  "packages/app/vitest.config.ts",
  "packages/proxy/vitest.config.ts",
]);
