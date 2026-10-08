import type { Rule } from "../types";
import { declarationRules } from "./declarations";

/** Groups `check` knows, in the order it reports them. A group with no rule yet is listed as skipped. */
export const GROUPS = [
  "declarations",
  "page",
  "manifest",
  "bake",
  "codegen",
  "imports",
  "plugin",
  "docs-prose",
] as const;

export const RULES: readonly Rule[] = [...declarationRules];
