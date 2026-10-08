import type { Rule } from "../types";
import { actionRules } from "./actions";
import { bakeRules } from "./bake";
import { codegenRules } from "./codegen";
import { declarationRules } from "./declarations";
import { importsRules } from "./imports";
import { manifestRules } from "./manifest";
import { pageRules } from "./page";
import { pluginRules } from "./plugin";

/** Groups `check` knows, in the order it reports them. A group with no rule yet is listed as skipped. */
export const GROUPS = [
  "declarations",
  "page",
  "manifest",
  "bake",
  "codegen",
  "imports",
  "plugin",
  "actions",
  "docs-prose",
] as const;

export const RULES: readonly Rule[] = [
  ...declarationRules,
  ...pageRules,
  ...manifestRules,
  ...bakeRules,
  ...codegenRules,
  ...importsRules,
  ...pluginRules,
  ...actionRules,
];
