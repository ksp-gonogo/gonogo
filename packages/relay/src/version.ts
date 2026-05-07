import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function fallback(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // src/version.ts → ../package.json (dev), dist/version.js → ../package.json (built)
    const pkg = JSON.parse(
      readFileSync(resolve(here, "../package.json"), "utf-8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION = process.env.GONOGO_VERSION ?? fallback();
export const BUILD_TIME =
  process.env.GONOGO_BUILD_TIME ?? new Date().toISOString();
