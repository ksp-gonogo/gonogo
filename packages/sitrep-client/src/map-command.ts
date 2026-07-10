/**
 * The M3 write-half analog of `map-topic.ts`'s `mapTopic` (`m3-migration-plan
 * .md` §4-commands / §Build 1 "command shim"): old Telemachus action-string
 * key (as passed to `useExecuteAction("data")(action)` today, e.g.
 * `"t.timeWarp[4]"`, `"t.pause"`) -> the new typed `vessel.*`/`time.*`
 * command + wire-shaped args, or `undefined` when there is no new command
 * home yet. `undefined` is the explicit "fall back to the legacy
 * `DataSource.execute(action)` path" signal — mirrors `mapTopic`'s own
 * "`undefined` is not an identity fallback" contract exactly, for the same
 * reason: a caller (`@gonogo/core`'s `useExecuteAction` shim) needs to know
 * when it CAN'T route, not receive something it has to guess is unrouted.
 *
 * Only `dataSourceId === "data"` is covered, matching `mapTopic` — nothing
 * else (`"kos"`, `"kerbcast"`) is wired to the new command surface yet.
 *
 * **Scope of this table.** The full command table for every `useExecuteAction`
 * action key found in `packages/components/src` (`map-command.coverage.test
 * .ts` in `@gonogo/core` is the coverage gate — every widget action key must
 * resolve here OR be in `KNOWN_COMMAND_GAPS`, no silent miss). Command topics
 * and arg shapes are confirmed against `mod/Sitrep.Host/
 * VesselCommandProvider.cs` (the 17 registered commands) and
 * `mod/Sitrep.Contract/VesselCommands.cs` (their arg/result shapes). The
 * wire's field CASING is camelCase, not the C#-source PascalCase — every
 * payload field in the real captured `local_docs/telemetry-mod/recordings/
 * reference-wire-fixture.json` is camelCase, and `mod/Sitrep.Host
 * .IntegrationTests/WireFixtureGeneratorTests.cs` pins
 * `JsonNamingPolicy.CamelCase` for the same serialization pipeline. Enums
 * (`SasMode`, `TargetKind`) serialize as their C#-declared-order NUMERIC
 * ordinal — no `JsonStringEnumConverter` anywhere in the Host pipeline;
 * confirmed against the generated `Quality`/`Staleness` TS enums in
 * `mod/sitrep-sdk/src/__generated__/contract.ts`, which are plain numeric
 * `enum { X = 0, ... }`.
 *
 * **The three harder arg-shape bridges** (`m3-migration-plan.md`'s own
 * flagged watch-items):
 *
 * 1. **toggle -> absolute.** Every Telemachus `f.<x>` action is a pure "flip
 *    whatever it currently is" toggle with NO state encoded in the action
 *    string; every M1 actuation command is absolute-set-only (`SetEnabledArgs
 *    .Enabled`, doc comment: "a toggle racing an unknown intervening state
 *    under light-time delay is a footgun this contract doesn't reproduce").
 *    `buildArgs` gets a `getCurrentValue(topic)` reader (backed by the
 *    mounted `TimelineStore`'s `sample()`, wired in `useExecuteAction.ts`) and
 *    inverts the CURRENT value to build the absolute one. When the current
 *    value isn't known yet (`undefined`) or isn't the expected shape, this
 *    returns `INVALID` — the shim falls back to legacy rather than ever
 *    dispatching an ambiguous toggle as a blind set. See `toggleHome`/
 *    `actionGroupHome` below.
 * 2. **index -> stable-id — UN-GAPPED as of the M3 vessel-gap batch.**
 *    `o.updateManeuverNode[id,...]`/`o.removeManeuverNode[id]` used to carry
 *    only a positional array INDEX (`useManeuverNodes.ts`: "Index of this
 *    node in `o.maneuverNodes`"), while the new `vessel.maneuver.update`/
 *    `.remove` commands need the opaque `NodeId` `vessel.maneuver.add`'s OWN
 *    result returns (`KspVesselActuator.AddManeuverNode`:
 *    `Guid.NewGuid().ToString()`). M3 R3 closed this by making
 *    `vessel.maneuver.nodes[].id` republish that same guid on EVERY node,
 *    not just ones created through the command path — `map-topic.ts`'s new
 *    `o.maneuverNodeIds` key exposes it, and `ManeuverPlanner` resolves the
 *    real id from that read before dispatching. `tar.setTargetVessel[index]`
 *    is the identical shape of problem — `system.vessels`' roster entries
 *    now carry a stable `vesselId` too (`SystemViewProvider
 *    .BuildSystemVessels`), so `TargetPicker` resolves that the same way.
 *    Both are real `TELEMACHUS_COMMAND_HOMES` entries below now, not
 *    `KNOWN_COMMAND_GAPS`.
 * 3. **positional -> named.** `f.setThrottle[v]`, `f.setSASMode[Mode]`,
 *    `tar.setTargetBody[index]`, `o.addManeuverNode[ut,radial,normal,prograde]`
 *    each carry positional legacy args that get parsed and re-packed as the
 *    new command's NAMED args (with a documented field-order note where a
 *    prior project finding flagged a real mis-order risk — see
 *    `maneuverAddHome`).
 *
 * **Malformed / unmappable args always fall back to legacy** — `buildArgs`
 * returns the `INVALID` sentinel (never a real args value containing e.g.
 * `NaN`) whenever a raw arg fails to parse, an enum name isn't recognized, or
 * a toggle's current value can't be read; `mapCommand` turns that into an
 * overall `undefined`, which is `useExecuteAction`'s existing "use the legacy
 * path" signal. This repo NEVER dispatches a `{index: NaN}`-class malformed
 * command — see `map-command.test.ts`'s malformed-arg cases.
 */

/** Reads the CURRENT value of a new-SDK stream topic, if one is live —
 * backed by a mounted `TimelineStore`'s `sample()` in production
 * (`useExecuteAction.ts`), a plain stub in tests. `undefined` when nothing
 * has arrived yet or no store is mounted; a `buildArgs` that needs the
 * current value to invert a toggle MUST treat that as "can't safely build
 * this command" (return `INVALID`), never assume a default. */
export type GetCurrentValue = (topic: string) => unknown;

/**
 * Sentinel `buildArgs` returns to mean "these raw args / this current state
 * can't be safely turned into a command — fall back to legacy". Deliberately
 * NOT `undefined`, because several commands (`vessel.control.stage`,
 * `vessel.target.clear`) are valid with NO args at all (`buildArgs` returns
 * `null` for those, matching the C# handler's `object? _` signature) —
 * colliding "no args needed" with "invalid" would be its own bug class.
 */
const INVALID: unique symbol = Symbol("map-command-invalid-args");

interface CommandHome {
  command: string;
  buildArgs: (
    rawArgs: readonly string[],
    getCurrentValue: GetCurrentValue,
  ) => unknown;
}

/**
 * toggle -> absolute bridge for the 5 action-group booleans that DO have a
 * clean per-field read home (`map-topic.ts`'s `TELEMACHUS_CLEAN_HOMES`:
 * `v.sasValue`/`v.rcsValue`/`v.gearValue`/`v.brakeValue`/`v.lightValue` ->
 * `vessel.control.{sas,rcs,gear,brakes,lights}`). `readTopic` is the exact
 * same stream topic a migrated `useDataValue` read of the sibling `v.<x>
 * Value` key would use — the SAME `ActionGroupComponent` instance that fires
 * this toggle already reads that topic for its own state pill
 * (`useDataValue("data", group.value)`), so by the time a user can click the
 * toggle button the read subscription (and therefore the store's cached
 * value) is already live. `getCurrentValue` returning anything other than a
 * `boolean` (nothing arrived yet, or a shape surprise) is `INVALID` — never
 * dispatch an ambiguous toggle as a blind set.
 */
function toggleHome(command: string, readTopic: string): CommandHome {
  return {
    command,
    buildArgs: (_rawArgs, getCurrentValue) => {
      const current = getCurrentValue(readTopic);
      if (typeof current !== "boolean") return INVALID;
      return { enabled: !current };
    },
  };
}

/**
 * `f.ag1`..`f.ag10` -> `vessel.control.setActionGroup{group, state}`. Same
 * toggle -> absolute bridge as `toggleHome`, but there is no per-index CLEAN
 * read home for an individual action group (`map-topic.ts`'s
 * `TELEMACHUS_KNOWN_GAPS`: "`v.ag1Value`..`v.ag10Value`: `VesselControl` only
 * carries a single fixed-order `ActionGroups: bool[]` array ... there is no
 * per-index subtopic"). Rather than leave the whole action-group family a
 * command gap, this reads the RAW `vessel.control` record's
 * `actionGroups[groupNumber-1]` element directly via the store's raw-field-
 * subtopic mechanism (`TimelineStore.resolveRawFieldSubtopic`/
 * `sampleRawFieldSubtopic` walk any `"<raw-topic>.<field...>"` string, and a
 * numeric path segment indexes a JS array exactly like an object key —
 * `"0" in [true, false]` is `true`). `mapCommand`'s bridge isn't bound by
 * `useDataValue`'s "one clean scalar subtopic per widget key" contract, so it
 * can reach into the array a plain widget read can't (yet) address.
 *
 * **This bridge only resolves once something has subscribed to the raw
 * `vessel.control` topic** — unlike the 5 booleans above, NO widget today
 * reads an ag-group value through the stream (the per-index read is itself a
 * gap), so `ActionGroupComponent` firing `f.ag1` alone does not create that
 * subscription. In a dashboard where a sibling SAS/RCS/Gear/Brakes/Lights
 * `ActionGroup` instance (or any future `vessel.control.*` reader) is also
 * mounted, the shared `TimelineStore` already has the array live and this
 * resolves for free; otherwise `getCurrentValue` returns `undefined` and the
 * shim safely falls back to legacy — exactly the documented "if unknowable,
 * prefer the safest mapping" contract, never a guessed toggle.
 *
 * `f.abort` UN-GAPPED (P4a command batch): `VesselControl` now carries a
 * plain `Abort` field (`vessel.control.abort` — see `map-topic.ts`'s
 * `TELEMACHUS_CLEAN_HOMES`), so it gets the same clean `toggleHome` bridge
 * as sas/rcs/gear/brake/light below rather than this array-indexing one.
 */
function actionGroupHome(groupNumber: number): CommandHome {
  const readTopic = `vessel.control.actionGroups.${groupNumber - 1}`;
  return {
    // VesselCommandProvider.SetActionGroupCommand
    command: "vessel.control.setActionGroup",
    buildArgs: (_rawArgs, getCurrentValue) => {
      const current = getCurrentValue(readTopic);
      if (typeof current !== "boolean") return INVALID;
      return { group: groupNumber, state: !current };
    },
  };
}

function parseFiniteNumber(raw: string | undefined): number | typeof INVALID {
  if (raw === undefined) return INVALID;
  const n = Number(raw);
  return Number.isFinite(n) ? n : INVALID;
}

/**
 * `SasMode` C# enum order (`mod/Sitrep.Contract/VesselControl.cs`) — the
 * name -> ordinal bridge for `f.setSASMode[<Name>]`. Navball sends the same
 * PascalCase mode names KSP's own `VesselAutopilot.AutopilotMode` uses
 * (confirmed against the enum's own doc comment); `Unknown` (ordinal 10) is
 * the contract's own read-side fallback value, never something a client
 * sends, so it's deliberately excluded from this table — an unrecognized
 * name is `INVALID`, not a guess at "Unknown".
 */
const SAS_MODE_ORDINALS: Readonly<Record<string, number>> = {
  StabilityAssist: 0,
  Prograde: 1,
  Retrograde: 2,
  Normal: 3,
  Antinormal: 4,
  RadialIn: 5,
  RadialOut: 6,
  Target: 7,
  AntiTarget: 8,
  Maneuver: 9,
};

/** `TargetKind` C# enum order (`mod/Sitrep.Contract/VesselTarget.cs`):
 * `Vessel = 0, Body = 1, Other = 2`. Only `Body` is ever sent from this
 * table — `tar.setTargetVessel` is a `KNOWN_COMMAND_GAPS` entry (see the
 * file doc comment's bridge 2), and nothing sends `Other`. */
const TARGET_KIND_BODY_ORDINAL = 1;

/**
 * `o.addManeuverNode[ut,radial,normal,prograde]` -> `vessel.maneuver.add`'s
 * named `{ut, prograde, normal, radialOut}`. Field-order note (load-bearing —
 * see the project's own "Telemachus maneuver-node arg order" finding,
 * reconfirmed by `AddManeuverNodeArgs`'s own doc comment): KSP's node-local
 * `ManeuverNode.DeltaV` is `Vector3d(radialOut, normal, prograde)`, so the
 * ON-WIRE positional order is RADIAL, NORMAL, PROGRADE — exactly matching
 * `ManeuverPlanner`'s own legacy action-string construction
 * (`` `o.addManeuverNode[${ut},${radial},${normal},${prograde}]` ``, see
 * `ManeuverPlanner/index.tsx`'s `dispatchPlanBurns`). This bridge preserves
 * that positional assignment verbatim into the named fields rather than
 * "helpfully" reordering it — reordering here is exactly the class of bug
 * the project has already hit once.
 */
function maneuverAddHome(): CommandHome {
  return {
    // VesselCommandProvider.ManeuverAddCommand
    command: "vessel.maneuver.add",
    buildArgs: (rawArgs) => {
      const ut = parseFiniteNumber(rawArgs[0]);
      const radialOut = parseFiniteNumber(rawArgs[1]);
      const normal = parseFiniteNumber(rawArgs[2]);
      const prograde = parseFiniteNumber(rawArgs[3]);
      if (
        ut === INVALID ||
        radialOut === INVALID ||
        normal === INVALID ||
        prograde === INVALID
      ) {
        return INVALID;
      }
      return { ut, prograde, normal, radialOut };
    },
  };
}

const TELEMACHUS_COMMAND_HOMES: Readonly<Record<string, CommandHome>> = {
  // --- time.* (sim-meta, never delayed) — the M3 pilot's original two ---
  "t.timeWarp": {
    // VesselCommandProvider.SetWarpIndexCommand
    command: "time.setWarpIndex",
    buildArgs: (rawArgs) => {
      const index = parseFiniteNumber(rawArgs[0]);
      return index === INVALID ? INVALID : { index };
    },
  },
  "t.pause": {
    // VesselCommandProvider.SetPausedCommand
    command: "time.setPaused",
    buildArgs: () => ({ paused: true }),
  },
  "t.unpause": {
    command: "time.setPaused",
    buildArgs: () => ({ paused: false }),
  },

  // --- vessel.control.* boolean actuation — toggle -> absolute bridge ---
  "f.sas": toggleHome("vessel.control.setSas", "vessel.control.sas"),
  "f.rcs": toggleHome("vessel.control.setRcs", "vessel.control.rcs"),
  "f.gear": toggleHome("vessel.control.setGear", "vessel.control.gear"),
  "f.brake": toggleHome("vessel.control.setBrakes", "vessel.control.brakes"),
  "f.light": toggleHome("vessel.control.setLights", "vessel.control.lights"),
  // VesselCommandProvider.SetAbortCommand (P4a command batch un-gap).
  "f.abort": toggleHome("vessel.control.setAbort", "vessel.control.abort"),
  "f.ag1": actionGroupHome(1),
  "f.ag2": actionGroupHome(2),
  "f.ag3": actionGroupHome(3),
  "f.ag4": actionGroupHome(4),
  "f.ag5": actionGroupHome(5),
  "f.ag6": actionGroupHome(6),
  "f.ag7": actionGroupHome(7),
  "f.ag8": actionGroupHome(8),
  "f.ag9": actionGroupHome(9),
  "f.ag10": actionGroupHome(10),

  // --- vessel.control.* direct actuation — no state to invert ---
  "f.stage": {
    // VesselCommandProvider.StageCommand — HandleStage ignores its args
    // entirely (`object? _`), matching Telemachus's void fire-and-forget.
    command: "vessel.control.stage",
    buildArgs: () => null,
  },
  "f.setThrottle": {
    // VesselCommandProvider.SetThrottleCommand — positional -> named,
    // 0..1 range pre-validated client-side too (the server independently
    // re-validates and returns E_RANGE — this is belt-and-suspenders
    // against ever dispatching a NaN/out-of-range value at all).
    command: "vessel.control.setThrottle",
    buildArgs: (rawArgs) => {
      const value = parseFiniteNumber(rawArgs[0]);
      if (value === INVALID || value < 0 || value > 1) return INVALID;
      return { value };
    },
  },
  "f.throttleZero": {
    command: "vessel.control.setThrottle",
    buildArgs: () => ({ value: 0 }),
  },
  "f.throttleFull": {
    command: "vessel.control.setThrottle",
    buildArgs: () => ({ value: 1 }),
  },
  "f.setSASMode": {
    // VesselCommandProvider.SetSasModeCommand — name -> ordinal bridge.
    command: "vessel.control.setSasMode",
    buildArgs: (rawArgs) => {
      const name = rawArgs[0];
      const mode = name === undefined ? undefined : SAS_MODE_ORDINALS[name];
      return mode === undefined ? INVALID : { mode };
    },
  },

  // --- vessel.target.* — designation, not actuation ---
  "tar.clearTarget": {
    // VesselCommandProvider.TargetClearCommand — HandleTargetClear ignores
    // its args (`object? _`).
    command: "vessel.target.clear",
    buildArgs: () => null,
  },
  "tar.setTargetBody": {
    // VesselCommandProvider.TargetSetCommand — BodyIndex is "the same
    // system.bodies index" per SetTargetArgs's own doc comment, a plain
    // positional -> named bridge (no stable-id problem, unlike the vessel
    // case below).
    command: "vessel.target.set",
    buildArgs: (rawArgs) => {
      const bodyIndex = parseFiniteNumber(rawArgs[0]);
      if (bodyIndex === INVALID || !Number.isInteger(bodyIndex)) {
        return INVALID;
      }
      return { kind: TARGET_KIND_BODY_ORDINAL, bodyIndex };
    },
  },

  // --- vessel.maneuver.* — add is a CREATE, needs no id (bridge 3) ---
  "o.addManeuverNode": maneuverAddHome(),

  // --- M3 vessel-gap batch: bridge 2 un-gap. vessel.maneuver.nodes[].id now
  // round-trips a stable per-node guid (M3 R3 capture-add), closing this
  // file's own doc comment's "no read channel carries a per-node nodeId" gap.
  // ManeuverPlanner resolves the real id via the new `o.maneuverNodeIds`
  // mapTopic read (map-topic.ts) when available, falling back to the legacy
  // positional array-index STRING otherwise (`String(index)`) — buildArgs
  // below takes rawArgs[0] verbatim either way, matching
  // `UpdateManeuverNodeArgs.NodeId`/`RemoveManeuverNodeArgs.NodeId`'s plain
  // `string` field (the server no-ops on an unrecognized id rather than
  // erroring, so a stale/fallback-index id is a harmless miss, not a crash —
  // same accepted-risk class as this file's toggle bridges when a read is
  // carried but the sibling command topic isn't yet).
  "o.updateManeuverNode": {
    // VesselCommandProvider.ManeuverUpdateCommand — same RADIAL, NORMAL,
    // PROGRADE positional order as maneuverAddHome above (ManeuverPlanner's
    // own `handleEdit` builds `[id,ut,radial,normal,prograde]`).
    command: "vessel.maneuver.update",
    buildArgs: (rawArgs) => {
      const nodeId = rawArgs[0];
      const ut = parseFiniteNumber(rawArgs[1]);
      const radialOut = parseFiniteNumber(rawArgs[2]);
      const normal = parseFiniteNumber(rawArgs[3]);
      const prograde = parseFiniteNumber(rawArgs[4]);
      if (
        !nodeId ||
        ut === INVALID ||
        radialOut === INVALID ||
        normal === INVALID ||
        prograde === INVALID
      ) {
        return INVALID;
      }
      return { nodeId, ut, prograde, normal, radialOut };
    },
  },
  "o.removeManeuverNode": {
    // VesselCommandProvider.ManeuverRemoveCommand
    command: "vessel.maneuver.remove",
    buildArgs: (rawArgs) => {
      const nodeId = rawArgs[0];
      return nodeId ? { nodeId } : INVALID;
    },
  },

  // --- M3 vessel-gap batch: bridge 2 un-gap. system.vessels' roster entries
  // now carry a stable vesselId (Vessel.id guid, SystemViewProvider
  // .BuildSystemVessels), closing this file's own "index -> stable-id" gap
  // for target-by-vessel. TargetPicker passes that guid verbatim as
  // rawArgs[0] when it read the roster off the NEW system.vessels shape;
  // same fallback-to-positional-index / carried-gate reasoning as the
  // maneuver-node bridge above when running off the legacy roster shape.
  "tar.setTargetVessel": {
    // VesselCommandProvider.TargetSetCommand
    command: "vessel.target.set",
    buildArgs: (rawArgs) => {
      const vesselId = rawArgs[0];
      if (!vesselId) return INVALID;
      return { kind: 0 /* TargetKind.Vessel */, vesselId };
    },
  },
};

/**
 * Old action keys with NO new command home yet — the M3 command-side
 * analog of `map-topic.ts`'s `TELEMACHUS_KNOWN_GAPS`. Exported so
 * `@gonogo/core`'s coverage test can assert "mapped OR declared gap"
 * without a silent third case.
 */
export const KNOWN_COMMAND_GAPS: ReadonlySet<string> = new Set([
  // f.abort UN-GAPPED (P4a command batch) — see toggleHome's
  // TELEMACHUS_COMMAND_HOMES entry above.

  // --- no discrete command exists for a continuous raw control axis ---
  // v.setPitch/setYaw/setRoll/setTranslation: the M1 vessel.control.*
  // command set is discrete actuation only (booleans, throttle, SAS mode,
  // stage) — there is no "set raw control-surface axis" command.
  "v.setPitch",
  "v.setYaw",
  "v.setRoll",
  "v.setTranslation",
  // v.setFbW: fly-by-wire arm/disarm has no server actuator at all in this
  // contract (kOS-adjacent concept, not a vessel.control.* command).
  "v.setFbW",
  // f.setPitchTrim/setYawTrim/setRollTrim: no trim command on the contract.
  "f.setPitchTrim",
  "f.setYawTrim",
  "f.setRollTrim",
  // f.throttleUp/f.throttleDown: a RELATIVE nudge — the new command needs an
  // absolute value, and there's no defined step size in the contract to
  // reconstruct one (unlike throttleZero/throttleFull, which ARE absolute
  // and mapped above).
  "f.throttleUp",
  "f.throttleDown",

  // --- robotics / parts-surface — own asset-class work, matches the
  // robotics.* read-side gaps (map-topic.ts) ---
  "robotics.servo.setTarget",
  "robotics.servo.setMotor",
  "robotics.servo.setLock",
  "robotics.rotor.setRpmLimit",
  "robotics.rotor.setTorqueLimit",
  "robotics.rotor.setBrake",
  "robotics.rotor.setMotor",
  "robotics.rotor.setLock",
  "robotics.rotor.reverse",

  // --- science domain — matches sci.* read-side gaps ---
  "sci.deploy",
  "sci.transmit",

  // --- career domain — out of vessel-provider scope by design, matches the
  // career.*/kc.*/contracts.*/strategies.*/tech.* read-side gaps ---
  "strategies.activate",
  "strategies.deactivate",
  "tech.unlock",
  "contracts.accept",
  "contracts.decline",
  "contracts.cancel",
  "kc.upgradeFacility",

  // --- scene/meta actions — matches the ksp.canRevertToEditor/Launch
  // read-side gaps ---
  "ksp.recover",
  "ksp.revertToLaunch",
  "ksp.revertToEditor",
  "ksp.toTrackingStation",
  "ksp.launch",
  "tar.switchVessel",
]);

/**
 * Splits a legacy Telemachus action string into its key and bracketed args,
 * e.g. `"t.timeWarp[4]"` -> `{ key: "t.timeWarp", args: ["4"] }`;
 * `"t.pause"` -> `{ key: "t.pause", args: [] }`. Mirrors the shape
 * `WarpControl`'s own `setWarp`/`togglePause` already build
 * (`` `t.timeWarp[${idx}]` ``) — this is the inverse parse.
 */
function parseLegacyAction(action: string): {
  key: string;
  args: readonly string[];
} {
  const open = action.indexOf("[");
  if (open === -1) return { key: action, args: [] };
  const close = action.lastIndexOf("]");
  const key = action.slice(0, open);
  const inner = close > open ? action.slice(open + 1, close) : "";
  const args = inner.length === 0 ? [] : inner.split(",");
  return { key, args };
}

export interface MappedCommand {
  command: string;
  args: unknown;
}

/**
 * Resolve a widget-facing legacy `(dataSourceId, action)` pair — as passed to
 * `useExecuteAction(dataSourceId)(action)` today — to the new typed command +
 * args it should dispatch instead. Returns `undefined` when there is no new
 * command home yet, the action's args couldn't be safely built (a toggle
 * whose current value isn't known, a malformed/out-of-range positional arg,
 * an unrecognized enum name — see this file's doc comment), or `dataSourceId`
 * isn't `"data"`. The `@gonogo/core` `useExecuteAction` shim falls back to
 * the legacy `execute(action)` path in every `undefined` case.
 *
 * `getCurrentValue` defaults to "nothing known" (`() => undefined`) so every
 * existing 2-arg call site (including this file's own earlier tests) keeps
 * compiling and behaving exactly as before: a toggle-shaped home simply can't
 * resolve without a real reader and safely reports `undefined`, the same
 * externally-visible outcome as "unmapped".
 */
export function mapCommand(
  dataSourceId: string,
  action: string,
  getCurrentValue: GetCurrentValue = () => undefined,
): MappedCommand | undefined {
  if (dataSourceId !== "data") return undefined;

  const { key, args } = parseLegacyAction(action);
  const home = TELEMACHUS_COMMAND_HOMES[key];
  if (!home) return undefined;

  const built = home.buildArgs(args, getCurrentValue);
  if (built === INVALID) return undefined;

  return { command: home.command, args: built };
}

/**
 * `true` when `action`'s base key (post bracket-strip) is a legacy action
 * with a deliberately-tracked absence of a new command home (as opposed to
 * simply never having been audited). Used by the coverage test to
 * distinguish "known gap" from "silent miss" — mirrors `isKnownTelemachusGap`.
 */
export function isKnownCommandGap(
  dataSourceId: string,
  action: string,
): boolean {
  if (dataSourceId !== "data") return false;
  const { key } = parseLegacyAction(action);
  return KNOWN_COMMAND_GAPS.has(key);
}

/**
 * `true` when `action`'s base key (post bracket-strip) has a registered
 * `CommandHome` — i.e. `mapCommand` COULD resolve it given valid args/a live
 * current value, even if a specific call (missing/malformed args, an unknown
 * toggle state) doesn't. This is a plain key-existence check, deliberately
 * NOT routed through `mapCommand` itself: several homes need real positional
 * args (`f.setThrottle`, `o.addManeuverNode`, ...) or a live
 * `getCurrentValue` reader (the toggle bridges) to actually build a command,
 * so probing with `mapCommand("data", "<bare key, no args>")` would report
 * every one of those as "unmapped" even though they plainly have a home —
 * the coverage test needs "was this key ever audited and given a home",
 * not "does THIS zero-arg call happen to resolve".
 */
export function hasCommandHome(dataSourceId: string, action: string): boolean {
  if (dataSourceId !== "data") return false;
  const { key } = parseLegacyAction(action);
  return key in TELEMACHUS_COMMAND_HOMES;
}
