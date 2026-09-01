// Kerbalism client-owned command registration: this Uplink's five commands, both
// halves.
//
// Its command args types live in THIS Uplink's own contract slice, never in
// `Sitrep.Contract`, so the SDK's own generated command map knows nothing about
// them and both halves are registered here:
//
//   • TYPE: a `declare module "@ksp-gonogo/sitrep-sdk"` augmentation extends
//     `CommandArgsMap` / `CommandReplyMap` with this slice's generated maps, so
//     `useCommand("kerbalism.file.delete")` resolves its args and its reply in
//     any program that statically imports this module.
//   • RUNTIME: `registerUplinkCommand` at module load feeds the SDK's runtime
//     registry, so `isCommandId` / `getAllKnownCommandIds` enumerate them
//     without the SDK ever naming a token of this mod's.
//
// Both halves are driven by the GENERATED maps rather than by a list written
// here, so a command added to this Uplink's contract needs no new line in this
// file. Exactly the route a third-party Uplink takes for its own commands: there
// is no first-party shortcut.
//
// `index.ts` RE-EXPORTS this module (rather than importing it for side effect
// alone) so the augmentation reaches the emitted `dist/index.d.ts`, the same
// reason `topics.ts` is re-exported.
import { registerUplinkCommand } from "@ksp-gonogo/sitrep-sdk";
import {
  GENERATED_COMMAND_IDS,
  type GeneratedCommandArgsMap,
  type GeneratedCommandReplyMap,
} from "./__generated__/command-map";

declare module "@ksp-gonogo/sitrep-sdk" {
  interface CommandArgsMap extends GeneratedCommandArgsMap {}
  interface CommandReplyMap extends GeneratedCommandReplyMap {}
}

for (const id of GENERATED_COMMAND_IDS) {
  registerUplinkCommand(id);
}

/** This Uplink's own command ids, as the generated map declares them. */
export { GENERATED_COMMAND_IDS as UPLINK_COMMAND_IDS };
