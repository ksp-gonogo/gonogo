/**
 * The write-half analog of `map-topic.ts`'s `mapTopic`: old Telemachus action-string
 * key (as passed to `useExecuteAction("data")(action)` today, e.g.
 * `"t.timeWarp[4]"`, `"t.pause"`) -> the new typed `vessel.*`/`time.*`
 * command + wire-shaped args, or `undefined` when there is no new command
 * home yet. `undefined` is the explicit "fall back to the legacy
 * `DataSource.execute(action)` path" signal — mirrors `mapTopic`'s own
 * "`undefined` is not an identity fallback" contract exactly, for the same
 * reason: a caller (`@ksp-gonogo/core`'s `useExecuteAction` shim) needs to know
 * when it CAN'T route, not receive something it has to guess is unrouted.
 *
 * Only `dataSourceId === "data"` is covered, matching `mapTopic` — nothing
 * else (`"kos"`, `"kerbcast"`) is wired to the new command surface yet.
 *
 * **Scope of this table.** The full command table for every `useExecuteAction`
 * action key found in `packages/components/src` (`map-command.coverage.test
 * .ts` in `@ksp-gonogo/core` is the coverage gate — every widget action key must
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
 * **The three harder arg-shape bridges:**
 *
 * 1. **toggle -> absolute.** Every Telemachus `f.<x>` action is a pure "flip
 *    whatever it currently is" toggle with NO state encoded in the action
 *    string; every actuation command is absolute-set-only (`SetEnabledArgs
 *    .Enabled`, doc comment: "a toggle racing an unknown intervening state
 *    under light-time delay is a footgun this contract doesn't reproduce").
 *    `buildArgs` gets a `getCurrentValue(topic)` reader (backed by the
 *    mounted `TimelineStore`'s `sample()`, wired in `useExecuteAction.ts`) and
 *    inverts the CURRENT value to build the absolute one. When the current
 *    value isn't known yet (`undefined`) or isn't the expected shape, this
 *    returns `INVALID` — the shim falls back to legacy rather than ever
 *    dispatching an ambiguous toggle as a blind set. See `toggleHome`/
 *    `actionGroupHome` below.
 * 2. **index -> stable-id — now UN-GAPPED.**
 *    `o.updateManeuverNode[id,...]`/`o.removeManeuverNode[id]` used to carry
 *    only a positional array INDEX (`useManeuverNodes.ts`: "Index of this
 *    node in `o.maneuverNodes`"), while the new `vessel.maneuver.update`/
 *    `.remove` commands need the opaque `NodeId` `vessel.maneuver.add`'s OWN
 *    result returns (`KspVesselActuator.AddManeuverNode`:
 *    `Guid.NewGuid().ToString()`). This was closed by making
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
 * (`useTelemetry(group.value)`), so by the time a user can click the
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
 * toggle -> absolute bridge as `toggleHome`: read the current state, send its
 * negation as an absolute.
 *
 * **This used to index the raw array BY POSITION**
 * (`vessel.control.actionGroups.${groupNumber - 1}`), exploiting the store's
 * raw-field-subtopic walk treating a numeric path segment as an array index.
 * That is now WRONG at the root: `VesselControl.actionGroups` is a NAMED list
 * (`{ index, name, state }[]`), so position no longer implies identity —
 * element 0 is merely the first group the elected backend happened to report,
 * which under AGX could be group 3. Reading `.0` would have silently toggled
 * the wrong group.
 *
 * It now reads the WHOLE `vessel.control` record and finds the entry whose own
 * `index` matches — the same keyed lookup the widget does. Deliberately NOT the
 * derived `vessel.state.actionGroup{n}` home: that would newly couple this
 * write bridge to the derived-channel layer, whereas reading the raw record
 * keeps exactly the dependency profile (and the caveat below) this always had.
 *
 * **This bridge only resolves once something has subscribed to the raw
 * `vessel.control` topic.** In practice the `ActionGroup` widget firing `f.ag1`
 * is itself a `vessel.control` reader, so its own subscription satisfies this;
 * a headless dispatcher (e.g. an alarm's `onFire`) needs some mounted widget to
 * be carrying the topic. Otherwise `getCurrentValue` yields `undefined` and the
 * shim safely falls back to legacy — the documented "if unknowable, prefer the
 * safest mapping" contract, never a guessed toggle.
 *
 * `f.abort` is UN-GAPPED and uses `toggleHome` against `vessel.control.abort`
 * (see `map-topic.ts`'s `TELEMACHUS_CLEAN_HOMES`) rather than this, since
 * Abort is a stock singleton with its own field and command.
 */
function actionGroupHome(groupNumber: number): CommandHome {
  return {
    // VesselCommandProvider.SetActionGroupCommand
    command: "vessel.control.setActionGroup",
    buildArgs: (_rawArgs, getCurrentValue) => {
      const control = getCurrentValue("vessel.control") as
        | { actionGroups?: { index: number; state: boolean }[] | null }
        | null
        | undefined;
      const current = control?.actionGroups?.find(
        (group) => group.index === groupNumber,
      )?.state;
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
 * `kc.upgradeFacility[<shortCode>]` -> `UpgradeFacilityArgs.FacilityId`'s
 * full `SpaceCenterFacility` enum name. The widget dispatches its own short
 * code (`launchPad`/`vab`/`sph`/..., `SpaceCenterStatus/index.tsx`'s
 * `FacilityKey`), the same short codes `career.status.facilities` reads back
 * onto via `ENUM_FACILITY_TO_KEY` — this is that table's inverse. An
 * unrecognized short code is `INVALID`.
 */
const FACILITY_KEY_TO_ENUM: Readonly<Record<string, string>> = {
  launchPad: "LaunchPad",
  runway: "Runway",
  vab: "VehicleAssemblyBuilding",
  sph: "SpaceplaneHangar",
  mission: "MissionControl",
  tracking: "TrackingStation",
  admin: "Administration",
  rd: "ResearchAndDevelopment",
  astronaut: "AstronautComplex",
};

/**
 * Shared `{ partId, value }` bridge for the robotics servo/rotor value
 * commands — `RoboticsCommandProvider`'s `ServoSetTargetArgs`/
 * `RotorSetValueArgs` both wire as `{partId, value}`. `range`, when given,
 * mirrors the server's own bound (`RoboticsCommandProvider`'s
 * `TorqueLimitMax`/`BrakePercentMax`) client-side too — belt-and-suspenders
 * against ever dispatching an out-of-range value, same posture as
 * `f.setThrottle`'s 0..1 check.
 */
function roboticsValueHome(
  command: string,
  range?: [number, number],
): CommandHome {
  return {
    command,
    buildArgs: (rawArgs) => {
      const partId = rawArgs[0];
      const value = parseFiniteNumber(rawArgs[1]);
      if (!partId || value === INVALID) return INVALID;
      if (range && (value < range[0] || value > range[1])) return INVALID;
      return { partId, value };
    },
  };
}

/**
 * Shared `{ partId, enabled }` bridge for the robotics servo/rotor
 * motor/lock commands — `RoboticsCommandProvider`'s `ServoSetEnabledArgs`
 * wire shape, absolute-set-only (there is no toggle -> absolute inversion
 * here; the widget already tracks and sends the target state directly).
 */
function roboticsEnabledHome(command: string): CommandHome {
  return {
    command,
    buildArgs: (rawArgs) => {
      const partId = rawArgs[0];
      if (!partId) return INVALID;
      return { partId, enabled: rawArgs[1] === "true" };
    },
  };
}

/** Clamps a raw axis/trim value to the −1..1 range `vessel.control.setAxes`
 * accepts — belt-and-suspenders alongside the mod's own admission-gate clamp
 * (`SetControlAxesArgs` doc comment), same posture as `f.setThrottle`'s 0..1
 * check. */
function clampAxis(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/**
 * `v.setPitch[f]`/`v.setYaw[f]`/`v.setRoll[f]`/`f.setPitchTrim[f]`/
 * `f.setYawTrim[f]`/`f.setRollTrim[f]` -> a single named field of
 * `vessel.control.setAxes`'s nullable-partial `SetControlAxesArgs`. Each of
 * these legacy actions carries exactly ONE raw float; sending only that one
 * field (rather than zero-padding the others) is what makes the partial
 * update non-clobbering — see `VesselCommandProvider.SetControlAxesCommand`'s
 * own doc comment on `SetControlAxesArgs`.
 */
function axisHome(
  field: "pitch" | "yaw" | "roll" | "pitchTrim" | "yawTrim" | "rollTrim",
): CommandHome {
  return {
    // VesselCommandProvider.SetControlAxesCommand
    command: "vessel.control.setAxes",
    buildArgs: (rawArgs) => {
      const value = parseFiniteNumber(rawArgs[0]);
      if (value === INVALID) return INVALID;
      return { [field]: clampAxis(value) };
    },
  };
}

/**
 * Absolute-throttle reconstruction of the legacy relative `f.throttleUp`/
 * `f.throttleDown` nudge — the new `vessel.control.setThrottle` command is
 * absolute-only (no relative-nudge command exists), so this reads the LIVE
 * current throttle off `vessel.control.throttle` (the same topic
 * `map-topic.ts`'s `f.throttle` read maps to) and applies the legacy ±0.1
 * step (confirmed against the decompiled fork's `mainThrottle += 0.1f`),
 * clamped 0..1. When the current value isn't known yet, this is `INVALID`
 * (falls back to legacy) rather than ever guessing a blind nudge — same
 * "if unknowable, never assume a default" posture as `toggleHome`.
 */
function throttleNudgeHome(delta: number): CommandHome {
  return {
    command: "vessel.control.setThrottle",
    buildArgs: (_rawArgs, getCurrentValue) => {
      const current = getCurrentValue("vessel.control.throttle");
      if (typeof current !== "number" || !Number.isFinite(current)) {
        return INVALID;
      }
      return { value: Math.max(0, Math.min(1, current + delta)) };
    },
  };
}

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
  // --- time.* (sim-meta, never delayed) ---
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
  // VesselCommandProvider.SetAbortCommand.
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
  "f.throttleUp": throttleNudgeHome(0.1),
  "f.throttleDown": throttleNudgeHome(-0.1),

  // --- vessel.control.* fly-by-wire — a PERSISTENT OVERRIDE the mod
  // re-applies from a Vessel.OnFlyByWire callback every frame while armed,
  // not a one-shot actuation. setFlyByWire arms/disarms; setAxes partially
  // updates the held pitch/yaw/roll/translation/trim (nullable-partial, so
  // each single-axis Navball action sends only its own field). See
  // `FlyByWireCommands.cs`'s doc comments.
  "v.setPitch": axisHome("pitch"),
  "v.setYaw": axisHome("yaw"),
  "v.setRoll": axisHome("roll"),
  "f.setPitchTrim": axisHome("pitchTrim"),
  "f.setYawTrim": axisHome("yawTrim"),
  "f.setRollTrim": axisHome("rollTrim"),
  "v.setTranslation": {
    // VesselCommandProvider.SetControlAxesCommand — the Navball's translate
    // handlers still zero-pad the other two axes into one legacy
    // `v.setTranslation[x,y,z]` call (see this file's FOLLOW-UP note below);
    // all three provided values are forwarded as named fields.
    command: "vessel.control.setAxes",
    buildArgs: (rawArgs) => {
      const x = parseFiniteNumber(rawArgs[0]);
      const y = parseFiniteNumber(rawArgs[1]);
      const z = parseFiniteNumber(rawArgs[2]);
      if (x === INVALID || y === INVALID || z === INVALID) return INVALID;
      return { x: clampAxis(x), y: clampAxis(y), z: clampAxis(z) };
    },
  },
  "v.setFbW": {
    // VesselCommandProvider.SetFlyByWireCommand — arm/disarm is NOT a
    // toggle (state is encoded in the legacy arg itself), so this needs no
    // getCurrentValue inversion, unlike toggleHome above.
    command: "vessel.control.setFlyByWire",
    buildArgs: (rawArgs) => {
      const state = parseFiniteNumber(rawArgs[0]);
      if (state === INVALID) return INVALID;
      return { enabled: state > 0 }; // legacy: on_attitude > 0 means armed
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

  // --- bridge 2 un-gap: vessel.maneuver.nodes[].id now
  // round-trips a stable per-node guid, closing this
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

  // --- science.experiment.* — delayed:true actuation on the craft, same
  // partId shape ScienceOfficer already sends as its bracketed arg
  // (`sci.deploy[${instrument.partId}]`/`sci.transmit[${instrument.partId}]`,
  // ScienceOfficer/index.tsx). Confirmed against
  // `mod/Sitrep.Host/ScienceCommandProvider.cs`'s `DeployCommand`/
  // `TransmitCommand` consts and `mod/Sitrep.Contract/ScienceCommands.cs`'s
  // `ExperimentActionArgs.PartId` (wire-cased `partId`). An empty partId is
  // never dispatched — the handler's own fail-fast treats it as
  // `CommandErrorCode.NotFound`, so there's no reason to let a blank string
  // through when the shim can catch it client-side first.
  "sci.deploy": {
    command: "science.experiment.deploy",
    buildArgs: (rawArgs) => {
      const partId = rawArgs[0];
      return partId ? { partId } : INVALID;
    },
  },
  "sci.transmit": {
    command: "science.experiment.transmit",
    buildArgs: (rawArgs) => {
      const partId = rawArgs[0];
      return partId ? { partId } : INVALID;
    },
  },

  // --- bridge 2 un-gap: system.vessels' roster entries
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

  // --- career.* commands. career.status.* already streams every id these
  // commands key on — strategy id (`strategies.all[].id`), tech id
  // (`tech.nodes[].id`), contract id (`contracts.*[].id`) all read straight
  // off that stream, so there is no read-side dependency left to close.
  // CareerCommandProvider handlers
  // (mod/Sitrep.Host/CareerCommandProvider.cs) fail-fast NotFound on an
  // empty id, but buildArgs still rejects a blank string client-side to
  // fall back cleanly — same posture as the science bridges above.
  "strategies.activate": {
    // CareerCommandProvider.HandleActivateStrategy
    command: "career.strategy.activate",
    buildArgs: (rawArgs) => {
      const strategyId = rawArgs[0];
      const factor = parseFiniteNumber(rawArgs[1]);
      if (!strategyId || factor === INVALID) return INVALID;
      return { strategyId, factor };
    },
  },
  "strategies.deactivate": {
    // CareerCommandProvider.HandleDeactivateStrategy
    command: "career.strategy.deactivate",
    buildArgs: (rawArgs) => {
      const strategyId = rawArgs[0];
      return strategyId ? { strategyId } : INVALID;
    },
  },
  "tech.unlock": {
    // CareerCommandProvider.HandleUnlockTech
    command: "career.tech.unlock",
    buildArgs: (rawArgs) => {
      const techId = rawArgs[0];
      return techId ? { techId } : INVALID;
    },
  },
  "contracts.accept": {
    // CareerCommandProvider.HandleAcceptContract
    command: "career.contract.accept",
    buildArgs: (rawArgs) => {
      const contractId = rawArgs[0];
      return contractId ? { contractId } : INVALID;
    },
  },
  "contracts.decline": {
    // CareerCommandProvider.HandleDeclineContract
    command: "career.contract.decline",
    buildArgs: (rawArgs) => {
      const contractId = rawArgs[0];
      return contractId ? { contractId } : INVALID;
    },
  },
  "contracts.cancel": {
    // CareerCommandProvider.HandleCancelContract
    command: "career.contract.cancel",
    buildArgs: (rawArgs) => {
      const contractId = rawArgs[0];
      return contractId ? { contractId } : INVALID;
    },
  },
  "kc.upgradeFacility": {
    // CareerCommandProvider.HandleUpgradeFacility — short-code -> enum-name
    // bridge (FACILITY_KEY_TO_ENUM above). SpaceCenterStatus dispatches its
    // own short code; an unrecognized one is INVALID rather than sending a
    // facility id the mod can never resolve.
    command: "career.facility.upgrade",
    buildArgs: (rawArgs) => {
      const facilityId = rawArgs[0]
        ? FACILITY_KEY_TO_ENUM[rawArgs[0]]
        : undefined;
      return facilityId ? { facilityId } : INVALID;
    },
  },

  // --- robotics.* commands. `parts.robotics` is already
  // RoboticsConsole/RotorTachometer's whole identity list, and
  // every entry carries the stable stringified `partId` these commands key
  // on — read-side dependency already closed. RoboticsCommandProvider
  // (mod/Sitrep.Host/RoboticsCommandProvider.cs) re-validates torque/brake
  // ranges server-side; the client-side range checks below are belt-and-
  // suspenders, same posture as `f.setThrottle`.
  "robotics.servo.setTarget": roboticsValueHome("robotics.servo.setTarget"),
  "robotics.servo.setMotor": roboticsEnabledHome("robotics.servo.setMotor"),
  "robotics.servo.setLock": roboticsEnabledHome("robotics.servo.setLock"),
  "robotics.rotor.setRpmLimit": roboticsValueHome("robotics.rotor.setRpmLimit"),
  "robotics.rotor.setTorqueLimit": roboticsValueHome(
    "robotics.rotor.setTorqueLimit",
    [0, 100],
  ),
  "robotics.rotor.setBrake": roboticsValueHome(
    "robotics.rotor.setBrake",
    [0, 200],
  ),
  "robotics.rotor.setMotor": roboticsEnabledHome("robotics.rotor.setMotor"),
  "robotics.rotor.setLock": roboticsEnabledHome("robotics.rotor.setLock"),
  "robotics.rotor.reverse": {
    // RoboticsCommandProvider.HandleRotorReverse — direction flip, no state
    // to invert (the lone robotics command with no value/enabled field).
    command: "robotics.rotor.reverse",
    buildArgs: (rawArgs) => {
      const partId = rawArgs[0];
      return partId ? { partId } : INVALID;
    },
  },

  // --- ksp.* flight-ops commands (FlightOpsCommandProvider,
  // mod/Sitrep.Host/FlightOpsCommandProvider.cs). recover/revertToLaunch/
  // revertToEditor/toTrackingStation have no read-side id dependency at
  // all — they un-gap unconditionally regardless of LaunchDirector's other
  // reads staying hybrid.
  "ksp.recover": {
    // FlightOpsCommandProvider.HandleRecover — HandleRecover ignores its
    // args entirely (`object? _`).
    command: "ksp.recover",
    buildArgs: () => null,
  },
  "ksp.revertToLaunch": {
    command: "ksp.revertToLaunch",
    buildArgs: () => null,
  },
  "ksp.revertToEditor": {
    // FlightOpsCommandProvider.HandleRevertToEditor — literal "vab"/"sph";
    // an unrecognized value is the handler's own Range rejection, no need
    // to duplicate the enum bridge client-side.
    command: "ksp.revertToEditor",
    buildArgs: (rawArgs) => {
      const editor = rawArgs[0];
      return editor ? { editor } : INVALID;
    },
  },
  "ksp.toTrackingStation": {
    command: "ksp.toTrackingStation",
    buildArgs: () => null,
  },

  // FlightOpsCommandProvider.HandleLaunch. LaunchDirector fires the legacy
  // `ksp.launch[${ship.name},${ship.facility},${site},${crewSemis}]`, where
  // `crewSemis = Array.from(selectedCrew).join(";")` — Telemachus split action
  // args on comma, so crew names were packed into the 4th comma-arg with `;`.
  // This is the ONE place that `;`-blob is unwound back into a real array for
  // the JSON command (LaunchArgs.Crew); the mod never sees the semicolon
  // encoding. An empty ship name or facility can't build a craft path, so it
  // falls back to legacy rather than dispatching a launch the handler would
  // only reject as NotFound/Range.
  "ksp.launch": {
    command: "ksp.launch",
    buildArgs: (rawArgs) => {
      const [shipName, facility, site, crewSemis] = rawArgs;
      if (!shipName || !facility) return INVALID;
      const crew = crewSemis ? crewSemis.split(";").filter(Boolean) : [];
      return { shipName, facility, site: site || "LaunchPad", crew };
    },
  },

  // --- tar.switchVessel -> ksp.switchVessel (RENAMED). system.vessels'
  // roster entries carry a stable vesselId (SystemViewProvider
  // .BuildSystemVessels) — same index -> stable-id shape as
  // tar.setTargetVessel above. buildArgs takes rawArgs[0] verbatim; the
  // server no-ops an unknown id (harmless), an empty id is INVALID.
  // FOLLOW-UP: LaunchDirector's onSwitchVessel still dispatches the
  // legacy positional array index (`entry.index`), not system.vessels'
  // vesselId — the widget itself needs the same rework already applied to
  // TargetPicker before this command actually resolves anything live.
  "tar.switchVessel": {
    // FlightOpsCommandProvider.HandleSwitchVessel
    command: "ksp.switchVessel",
    buildArgs: (rawArgs) => {
      const vesselId = rawArgs[0];
      return vesselId ? { vesselId } : INVALID;
    },
  },
};

/**
 * Old action keys with NO new command home yet — the command-side
 * analog of `map-topic.ts`'s `TELEMACHUS_KNOWN_GAPS`. Exported so
 * `@ksp-gonogo/core`'s coverage test can assert "mapped OR declared gap"
 * without a silent third case.
 */
export const KNOWN_COMMAND_GAPS: ReadonlySet<string> = new Set([
  // f.abort is UN-GAPPED — see toggleHome's
  // TELEMACHUS_COMMAND_HOMES entry above.
  // v.setPitch/setYaw/setRoll/setTranslation/v.setFbW,
  // f.setPitchTrim/setYawTrim/setRollTrim, f.throttleUp/f.throttleDown are
  // all UN-GAPPED — see the fly-by-wire TELEMACHUS_COMMAND_HOMES entries
  // above (axisHome/throttleNudgeHome, vessel.control.setAxes/setFlyByWire).
  // robotics.servo.*/robotics.rotor.* are routed above — see
  // roboticsValueHome/roboticsEnabledHome's TELEMACHUS_COMMAND_HOMES
  // entries; parts.robotics already streams the partId these key on.
  // strategies.activate/deactivate, tech.unlock, contracts.accept/decline/
  // cancel, kc.upgradeFacility are routed above — see the career.*
  // TELEMACHUS_COMMAND_HOMES entries; career.status.* already streams every
  // id these key on.
  // ksp.recover/revertToLaunch/revertToEditor/toTrackingStation,
  // tar.switchVessel -> ksp.switchVessel, and ksp.launch are all routed above
  // — see the ksp.*/tar.switchVessel TELEMACHUS_COMMAND_HOMES entries.
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
 * isn't `"data"`. The `@ksp-gonogo/core` `useExecuteAction` shim falls back to
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
