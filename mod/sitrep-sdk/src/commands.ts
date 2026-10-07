// Typed command registry: the write-side twin of `./topics.ts`.
//
// Exports a `CommandId` string-literal union of every command the mod declares, plus
// `CommandArgs<Command>` and `CommandReply<Command>` mapped types resolving each command to the
// arguments it takes and the value its dispatch resolves with. `useCommand` is keyed
// on this union, so a command's args and its reply are both known at the call site
// instead of being `unknown` in each direction.
//
// ── Single source of truth (CODEGEN) ────────────────────────────────────────────────
// The bulk of this registry (`GeneratedCommandArgsMap`, `GeneratedCommandReplyMap` and
// `GENERATED_COMMAND_IDS` in `./__generated__/command-map.ts`) is GENERATED from
// `Sitrep.Contract`: every command's args class is tagged `[SitrepCommand("<id>")]`,
// and `mod/codegen.sh` (via `RtConfig.EmitCommandMap`) reflects over those tags. A
// command added or removed in C# flows through codegen into this file with no hand
// edit, and `commands-cs-sync.test.ts` re-reads the C# `const string ...Command`
// declarations and fails on a command the map has never heard of.
//
// ── The Uplink half ─────────────────────────────────────────────────────────────────
// Most commands belong to an Uplink rather than to core, and an Uplink's wire types
// live in its own contract slice, never in `Sitrep.Contract`. So each such slice gets
// its OWN generated command map, and its client package augments `CommandArgsMap` /
// `CommandReplyMap` here through `declare module "@ksp-gonogo/sitrep-sdk"` and calls
// `registerUplinkCommand` at module load for the runtime half. That is exactly the
// route a THIRD-PARTY Uplink takes for its own commands: there is no first-party
// shortcut, and the bundled Uplinks are the worked examples.
//
// ── What is deliberately absent ─────────────────────────────────────────────────────
// A DYNAMIC command, addressed per subject at runtime, has no static member here for
// the same reason a dynamic Topic has none in `./topics.ts`. `useCommand` still takes
// it: an id that is not a `CommandId` falls to the untyped overload and behaves
// exactly as every call did before this registry existed.

import type {
  GeneratedCommandArgsMap,
  GeneratedCommandReplyMap,
} from "./__generated__/command-map";
import {
  GENERATED_COMMAND_IDS,
  GENERATED_COMMAND_RAIL,
} from "./__generated__/command-map";
import type { CommandResultOf } from "./__generated__/contract";
import type { CommandRail } from "./rail-tags";

/**
 * Every command id mapped to the type of the arguments it takes.
 * {@link CommandId} and {@link CommandArgs} are read from it.
 *
 * An Uplink adds its own commands by augmenting this interface and
 * {@link CommandReplyMap} from its client package, and registers each id at
 * load with {@link registerUplinkCommand}:
 *
 * ```ts
 * declare module "@ksp-gonogo/sitrep-sdk" {
 *   interface CommandArgsMap {
 *     "myuplink.probe.deploy": { probeId: string };
 *   }
 *   interface CommandReplyMap {
 *     "myuplink.probe.deploy": CommandResult;
 *   }
 * }
 * ```
 *
 * @category Commands
 */
export interface CommandArgsMap extends SdkOwnedCommandArgsMap {}

/**
 * Every command id mapped to the type its `send` resolves with.
 *
 * A refusal is never a reply. On the wire the game's "no" is a
 * `command-response` whose result has `success: false`, and the client turns
 * that into a rejection before it reaches you: `send` rejects with an error
 * carrying the `CommandErrorCode`, which {@link classifyCommandRejection}
 * reads. So a reply always means the command ran: write a `catch`, and never a
 * check of `success`. Most commands reply with a bare `CommandResult`; those
 * with a value to return reply with `CommandResultOf<Payload>`, the value on
 * `payload`.
 *
 * @category Commands
 */
export interface CommandReplyMap extends SdkOwnedCommandReplyMap {}

/**
 * The reply type of a command handle whose command is not known: the result
 * envelope every command replies with, its own value on `payload`. It is the
 * default `Reply` of {@link useCommand} and {@link UseCommandResult}.
 *
 * `system.bodies.statesAt` is the one exception: it replies with a
 * `BodyStatesReply` rather than an envelope, so its handle cannot be passed
 * where a bare `UseCommandResult` is expected.
 *
 * @category Commands
 */
export type AnyCommandReply = CommandResultOf<unknown>;

/**
 * The SDK's OWN command maps: the generated entries and nothing else.
 * DELIBERATELY distinct from the augmentable maps above, so a downstream Uplink
 * augmentation, which adds a key and registers an id at runtime but never
 * touches the static `COMMAND_IDS` array, cannot turn the SDK's own array↔map
 * assertions into false failures. Same split, and same reason, as
 * `SdkOwnedTopicPayloadMap`.
 */
interface SdkOwnedCommandArgsMap extends GeneratedCommandArgsMap {}

interface SdkOwnedCommandReplyMap extends GeneratedCommandReplyMap {}

/**
 * Every command id with known argument and reply types, as a string-literal
 * union, including those an Uplink added to {@link CommandArgsMap}.
 *
 * @category Commands
 */
export type CommandId = keyof CommandArgsMap;

/**
 * The arguments `Command` takes. A command whose arguments type is empty takes
 * none, and its `send()` is called with no argument.
 *
 * @category Commands
 */
export type CommandArgs<Command extends CommandId> = CommandArgsMap[Command];

/**
 * What `send` resolves with for `Command`. See {@link CommandReplyMap}.
 *
 * @category Commands
 */
export type CommandReply<Command extends CommandId> =
  Command extends keyof CommandReplyMap ? CommandReplyMap[Command] : unknown;

/**
 * Every command id the SDK itself declares, as an array.
 *
 * Commands an Uplink registers at load are not in it;
 * {@link getAllKnownCommandIds} and {@link isCommandId} include them.
 *
 * @category Commands
 */
export const COMMAND_IDS = [
  ...GENERATED_COMMAND_IDS,
] as const satisfies readonly CommandId[];

const COMMAND_ID_SET: ReadonlySet<string> = new Set(COMMAND_IDS);

/**
 * Runtime registry of Uplink-owned command ids, the commands whose args types
 * live in an Uplink's own contract slice rather than in `Sitrep.Contract`. Each
 * owning Uplink's client package calls `registerUplinkCommand` at module load,
 * mirroring `registerBarePrimitiveTopic` on the read side, so the SDK can
 * enumerate and narrow them without naming a single mod token in this file.
 */
const uplinkCommandIds = new Set<string>();

/**
 * The rail rows of Uplink-owned commands: whether anything answers each.
 * Populated by the same `registerUplinkCommand` call that enrols the id, out of
 * the Uplink's own generated map.
 *
 * It has to be a runtime registry rather than a table in this package for the
 * reason the whole Uplink model exists: an Uplink ships on its own schedule and
 * this build has never heard of it, so a list written here could only ever
 * describe core's commands and would answer for everyone else's by guessing.
 */
const uplinkCommandRails = new Map<string, CommandRail>();

/**
 * Registers a command id that an Uplink adds, so {@link isCommandId} and
 * {@link getAllKnownCommandIds} include it. Call it when the Uplink's client
 * package loads, beside its augmentation of {@link CommandArgsMap}: the
 * augmentation types `send`, and this call makes the id known at runtime.
 * Registering an id twice does nothing.
 *
 * `rail` says how the command travels, such as whether a reply comes back.
 * Take it from `GENERATED_COMMAND_RAIL` in the `command-map.ts` that
 * `uplink-tools codegen` writes beside your generated types, which has a row
 * for every command your contract slice declares with `[SitrepCommand]`.
 * Without it the command is drawn as a single command that gets a reply.
 *
 * @category Commands
 */
export function registerUplinkCommand(id: string, rail?: CommandRail): void {
  uplinkCommandIds.add(id);
  if (rail) uplinkCommandRails.set(id, rail);
}

/**
 * Returns how a command travels, as declared by the SDK or by the Uplink that
 * registered it, or `null` when nothing has declared it. That covers a command
 * whose id is built at runtime and one from an Uplink whose client has not
 * loaded. {@link railTagsForCommand} turns either result into tags to draw.
 *
 * @category Commands
 */
export function commandRail(id: string): CommandRail | null {
  const own = (GENERATED_COMMAND_RAIL as Record<string, CommandRail>)[id];
  return own ?? uplinkCommandRails.get(id) ?? null;
}

/**
 * Every command id known now: {@link COMMAND_IDS} and every id an Uplink has
 * registered so far. An Uplink's commands appear once its client package has
 * loaded.
 *
 * @category Commands
 */
export function getAllKnownCommandIds(): readonly string[] {
  return [...COMMAND_IDS, ...uplinkCommandIds];
}

/**
 * Returns whether `value` is a known {@link CommandId}: one the SDK declares,
 * or one an Uplink has registered with {@link registerUplinkCommand}.
 *
 * @category Commands
 */
export function isCommandId(value: string): value is CommandId {
  return COMMAND_ID_SET.has(value) || uplinkCommandIds.has(value);
}

// ── Compile-time invariants (checked by `pnpm typecheck`) ───────────────────────────
// These bind the runtime `COMMAND_IDS` array to the SDK-OWNED maps in both directions
// and prove that every SDK-owned command names a reply, so a drift between the array
// and the map is a build error rather than a silent runtime gap. They use the fixed
// SDK-owned maps, NOT the augmentable ones, for the reason `topics.ts` gives at the
// same point: an Uplink augmentation is present in the union and absent from the
// array BY DESIGN.

type AssertNever<Leftover extends never> = Leftover;

type SdkOwnedCommandId = keyof SdkOwnedCommandArgsMap;
type _MissingFromRuntime = Exclude<
  SdkOwnedCommandId,
  (typeof COMMAND_IDS)[number]
>;
type _ExtraInRuntime = Exclude<(typeof COMMAND_IDS)[number], SdkOwnedCommandId>;
export type _AssertNoMissingCommands = AssertNever<_MissingFromRuntime>;
export type _AssertNoExtraCommands = AssertNever<_ExtraInRuntime>;

// Every SDK-owned command names a reply. The args map is what `CommandId` is derived
// from, so a command present in one map and missing from the other would type its
// reply `unknown` with nothing failing.
type _Replyless = Exclude<SdkOwnedCommandId, keyof SdkOwnedCommandReplyMap>;
export type _AssertEveryCommandNamesAReply = AssertNever<_Replyless>;
