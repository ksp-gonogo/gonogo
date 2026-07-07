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
 * **Scope of this table today:** only the WarpControl pilot's two actions
 * (`m3-migration-plan.md`'s G0 "migrate first" pick — zero gap dependency).
 * The plan's full "clean 1:1" candidate list (`f.setThrottle`, `f.stage`,
 * `f.agN`, `tar.clearTarget`, …) and the three harder arg-shape bridges
 * (toggle->absolute, index->stable-id, positional->named) are later-wave
 * work — building the MECHANISM here, not the whole table (per the task
 * brief this file was written for).
 *
 * **Command topics and arg shapes**, confirmed against
 * `mod/Sitrep.Host/VesselCommandProvider.cs` (`SetWarpIndexCommand =
 * "time.setWarpIndex"`, `SetPausedCommand = "time.setPaused"`) and
 * `mod/Sitrep.Contract/VesselCommands.cs` (`SetWarpIndexArgs { Index }`,
 * `SetPausedArgs { Paused }`). The wire's field CASING is camelCase, not the
 * C#-source PascalCase — every payload field in the real captured
 * `local_docs/telemetry-mod/recordings/reference-wire-fixture.json` is
 * camelCase (e.g. `time.warp`'s `warpRate`/`warpRateIndex`/`warpMode`/
 * `paused`), and `mod/Sitrep.Host.IntegrationTests/
 * WireFixtureGeneratorTests.cs` pins `JsonNamingPolicy.CamelCase` for the
 * same serialization pipeline — so the args built here are `{ index }` /
 * `{ paused }`, matching that convention.
 *
 * `time.setPaused` takes the ABSOLUTE state to apply (`SetPausedArgs.Paused`
 * — no toggle, per the contract's own "absolute set, never toggle" design
 * rule, `VesselCommandProvider`'s doc comment). The legacy fork instead
 * ships two separate fire-once action keys, `t.pause`/`t.unpause` — no arg,
 * the boolean is implicit in WHICH key fired. Each maps to the same command
 * with its own fixed literal arg (`true`/`false`) rather than needing any
 * "read current state" bridge — this is the WarpControl widget's own
 * `togglePause()` doing that inversion already, before `execute()` is ever
 * called (see `WarpControl/index.tsx`).
 */

export interface MappedCommand {
  command: string;
  args: unknown;
}

interface CommandHome {
  command: string;
  buildArgs: (rawArgs: readonly string[]) => unknown;
}

const TELEMACHUS_COMMAND_HOMES: Readonly<Record<string, CommandHome>> = {
  "t.timeWarp": {
    command: "time.setWarpIndex",
    buildArgs: (rawArgs) => ({ index: Number(rawArgs[0]) }),
  },
  "t.pause": {
    command: "time.setPaused",
    buildArgs: () => ({ paused: true }),
  },
  "t.unpause": {
    command: "time.setPaused",
    buildArgs: () => ({ paused: false }),
  },
};

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

/**
 * Resolve a widget-facing legacy `(dataSourceId, action)` pair — as passed to
 * `useExecuteAction(dataSourceId)(action)` today — to the new typed command +
 * args it should dispatch instead. Returns `undefined` when there is no new
 * command home yet (see this file's doc comment); the `@gonogo/core`
 * `useExecuteAction` shim falls back to the legacy `execute(action)` path in
 * every `undefined` case.
 */
export function mapCommand(
  dataSourceId: string,
  action: string,
): MappedCommand | undefined {
  if (dataSourceId !== "data") return undefined;

  const { key, args } = parseLegacyAction(action);
  const home = TELEMACHUS_COMMAND_HOMES[key];
  if (!home) return undefined;

  return { command: home.command, args: home.buildArgs(args) };
}
