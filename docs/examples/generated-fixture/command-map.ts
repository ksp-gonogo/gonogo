/*
 * Stand-in for the file `mod/codegen.sh` writes into an Uplink's client at
 * `src/__generated__/command-map.ts`, as `RtConfig.EmitCommandMap` emits it for
 * an Uplink slice (`resultImportFrom: "@ksp-gonogo/sitrep-sdk"`). The guide
 * imports it by that path, so the checker needs something with the real shape
 * to resolve against.
 *
 * It is hand-written because the guide's example Uplink has no C# to reflect
 * over, and `fixture-shape.mjs` fails the guide check whenever its exports stop
 * matching the committed output of the real generator. The rows are the example
 * contract's own data.
 */

import type { CommandResult } from "@ksp-gonogo/sitrep-sdk";
import type { SetOutputArgs } from "./contract.js";

export interface GeneratedCommandArgsMap {
  "example.setOutput": SetOutputArgs;
}

export interface GeneratedCommandReplyMap {
  "example.setOutput": CommandResult;
}

export interface GeneratedCommandRail {
  readonly replies: boolean;
  readonly delayed: boolean;
}

export const GENERATED_COMMAND_RAIL = {
  "example.setOutput": { replies: true, delayed: true },
} as const satisfies Record<string, GeneratedCommandRail>;

export const GENERATED_COMMAND_IDS = ["example.setOutput"] as const;
