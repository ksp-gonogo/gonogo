// Typed command registry: the write-side twin of `./topics.ts`.
//
// Exports a `CommandId` string-literal union of every command the mod declares, plus
// `CommandArgs<C>` and `CommandReply<C>` mapped types resolving each command to the
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
import { GENERATED_COMMAND_IDS } from "./__generated__/command-map";

/**
 * The command → args-type map. Keys are the wire command strings; values are the
 * object a `command-request` on that command carries as its `args`. The generated
 * entries come from `Sitrep.Contract`'s `[SitrepCommand]` tags; an Uplink's own
 * commands augment this interface from its client package (see the file header).
 *
 * The AUGMENTABLE surface. `SdkOwnedCommandArgsMap` below is the fixed SDK-owned
 * subset the compile invariants pin `COMMAND_IDS` against, exactly as `topics.ts`
 * splits the two.
 */
export interface CommandArgsMap extends SdkOwnedCommandArgsMap {}

/**
 * The command → reply-type map: what `send()` RESOLVES with, which is not the same
 * question as what the handler returns.
 *
 * A refusal never arrives here. The mod answers `CommandResult.Fail(code)` when the
 * game says no, and the client turns that into a rejection carrying the
 * `CommandErrorCode`, so a resolved value is always a command that ran. Most commands
 * resolve a bare `CommandResult`; the few that have something to say resolve
 * `CommandResultOf<T>` with the value on `payload`.
 */
export interface CommandReplyMap extends SdkOwnedCommandReplyMap {}

/**
 * The SDK's OWN command maps: the generated entries and nothing else. DELIBERATELY
 * distinct from the augmentable maps above, so a downstream Uplink augmentation,
 * which adds a key and registers an id at runtime but never touches the static
 * `COMMAND_IDS` array, cannot turn the SDK's own array↔map assertions into false
 * failures. Same split, and same reason, as `SdkOwnedTopicPayloadMap`.
 */
interface SdkOwnedCommandArgsMap extends GeneratedCommandArgsMap {}

interface SdkOwnedCommandReplyMap extends GeneratedCommandReplyMap {}

/** Every command the mod declares statically, as a string-literal union. */
export type CommandId = keyof CommandArgsMap;

/**
 * The arguments command `C` takes. An empty interface (`NoCommandArgs`, or an
 * Uplink's own marker) means the command takes none, and `useCommand(...).send()`
 * accepts no argument for it.
 */
export type CommandArgs<C extends CommandId> = CommandArgsMap[C];

/**
 * What dispatching command `C` resolves with. See {@link CommandReplyMap} for why a
 * refusal is not one of these.
 */
export type CommandReply<C extends CommandId> = C extends keyof CommandReplyMap
  ? CommandReplyMap[C]
  : unknown;

/**
 * Runtime list of the SDK's OWN `CommandId`s. Kept in lock-step with
 * `CommandArgsMap`'s SDK-owned keys by the compile-time assertions below. An Uplink's
 * own commands register at load into `uplinkCommandIds` and are NOT in this array;
 * use `getAllKnownCommandIds()` / `isCommandId` for the live full set.
 */
export const COMMAND_IDS = [
  ...GENERATED_COMMAND_IDS,
] as const satisfies readonly CommandId[];

const COMMAND_ID_SET: ReadonlySet<string> = new Set(COMMAND_IDS);

/**
 * Runtime registry of Uplink-owned command ids, the commands whose args types live in
 * an Uplink's own contract slice rather than in `Sitrep.Contract`. Each owning
 * Uplink's client package calls `registerUplinkCommand` at module load, mirroring
 * `registerBarePrimitiveTopic` on the read side, so the SDK can enumerate and narrow
 * them without naming a single mod token in this file.
 */
const uplinkCommandIds = new Set<string>();

/**
 * Self-register an Uplink-owned command id absent from this SDK's own generated
 * registry. Called at module load by the owning Uplink's client package alongside its
 * `declare module` augmentation of `CommandArgsMap` / `CommandReplyMap`. Idempotent
 * (a `Set`), so a double import is harmless.
 *
 * The registration is the RUNTIME half and the augmentation is the TYPE half; they
 * are separate because they answer to different things. Without the augmentation an
 * author's `send` stays untyped; without this call the command is missing from
 * `getAllKnownCommandIds()` and `isCommandId` says no about a command that works.
 */
export function registerUplinkCommand(id: string): void {
  uplinkCommandIds.add(id);
}

/**
 * Every command id currently known at runtime: the SDK's own `COMMAND_IDS` plus every
 * Uplink command registered so far. Reflects only Uplinks whose client package has
 * loaded, which is what makes it the honest answer to "what can this session
 * dispatch" rather than "what could some session dispatch".
 */
export function getAllKnownCommandIds(): readonly string[] {
  return [...COMMAND_IDS, ...uplinkCommandIds];
}

/**
 * Runtime narrowing guard: is `value` a known command? True for an SDK-owned command
 * OR an Uplink command whose owning client package has registered it.
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

type AssertNever<T extends never> = T;

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
