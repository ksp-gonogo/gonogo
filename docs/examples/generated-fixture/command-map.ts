// Stand-in for the file `mod/codegen.sh` writes into an Uplink's client at
// `src/__generated__/command-map.ts`. The guide imports it by that path, so the
// checker needs something with the real shape to resolve against.
//
// It is hand-written because the guide's example Uplink has no C# to reflect
// over. Keep the three exports and their relationship: the ids array is the
// runtime half, the two interfaces are the type half, and every id must appear
// in both maps or the guide's own `registerUplinkCommand` loop stops typing.

export interface ExampleSetOutputArgs {
  /** Requested reactor output, in kW. */
  readonly targetPower: number;
}

export interface GeneratedCommandArgsMap {
  "example.setOutput": ExampleSetOutputArgs;
}

export interface GeneratedCommandReplyMap {
  "example.setOutput": void;
}

export const GENERATED_COMMAND_IDS = ["example.setOutput"] as const;
