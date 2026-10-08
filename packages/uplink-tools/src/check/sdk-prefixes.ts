import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { packageDirOf, SDK_PACKAGE } from "./index-reader";

export interface SdkPrefixes {
  prefixes: readonly string[];
  /** Why the installed sdk's prefixes could not be read, when they could not. */
  problem?: string;
}

const DECLARATION = /DYNAMIC_WHOLE_TOPIC_PREFIXES\s*=\s*(\[[\s\S]*?\])\s*;/;

/**
 * The prefixes the sdk registers itself, read from the installed copy's
 * registry module without loading it: the module is a literal list of strings
 * and comments, and the sdk's entry points, which pull in React, may not load
 * in bare Node.
 */
export function sdkDynamicPrefixes(clientDir: string): SdkPrefixes {
  const dir = packageDirOf(SDK_PACKAGE, clientDir);
  const file = dir && join(dir, "dist", "runtime-topic-registry.js");
  if (!file || !existsSync(file)) {
    return {
      prefixes: [],
      problem: `${SDK_PACKAGE} is not installed and built where ${clientDir} can see it`,
    };
  }
  const literal = DECLARATION.exec(readFileSync(file, "utf8"))?.[1];
  const prefixes: unknown = literal && runInNewContext(literal, {});
  if (
    !Array.isArray(prefixes) ||
    !prefixes.every((p) => typeof p === "string")
  ) {
    return {
      prefixes: [],
      problem: `${file} does not list DYNAMIC_WHOLE_TOPIC_PREFIXES as a literal array of strings`,
    };
  }
  return { prefixes };
}
