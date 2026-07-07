import { describe, expect, it } from "vitest";
import { mapCommand } from "./map-command";

/**
 * The M3 write-half analog of `map-topic.ts`'s `mapTopic` (`m3-migration-plan
 * .md` §4-commands/§Build 1's "command shim"): old Telemachus action-string
 * key -> new `vessel.*`/`time.*` typed command + args. Only the WarpControl
 * pilot's two actions are seeded here — `mod/Sitrep.Host/
 * VesselCommandProvider.cs`'s `SetWarpIndexCommand`/`SetPausedCommand`
 * constants and `mod/Sitrep.Contract/VesselCommands.cs`'s
 * `SetWarpIndexArgs{Index}`/`SetPausedArgs{Paused}` are the source of truth
 * for the command topic strings; the wire's arg CASING is camelCase (every
 * payload field in `local_docs/telemetry-mod/recordings/
 * reference-wire-fixture.json` is camelCase — `JsonNamingPolicy.CamelCase`,
 * confirmed in `mod/Sitrep.Host.IntegrationTests/WireFixtureGeneratorTests
 * .cs`), so `{ index }`/`{ paused }`, not the C#-cased `{ Index }`/
 * `{ Paused }`. The full command table for every other widget's actions is
 * later-wave work (`m3-migration-plan.md` §4-commands lists the "clean 1:1"
 * candidates) — not built here.
 */
describe("mapCommand", () => {
  it("maps a warp-index action string with its bracketed index arg", () => {
    expect(mapCommand("data", "t.timeWarp[4]")).toEqual({
      command: "time.setWarpIndex",
      args: { index: 4 },
    });
    expect(mapCommand("data", "t.timeWarp[0]")).toEqual({
      command: "time.setWarpIndex",
      args: { index: 0 },
    });
  });

  it("maps pause/unpause to the absolute setPaused command", () => {
    expect(mapCommand("data", "t.pause")).toEqual({
      command: "time.setPaused",
      args: { paused: true },
    });
    expect(mapCommand("data", "t.unpause")).toEqual({
      command: "time.setPaused",
      args: { paused: false },
    });
  });

  it("returns undefined for an action with no new command home yet", () => {
    expect(mapCommand("data", "f.sas")).toBeUndefined();
    expect(
      mapCommand("data", "kos.compute.my-feed.dispatchNow"),
    ).toBeUndefined();
  });

  it("returns undefined for a dataSourceId other than 'data' — nothing else is wired to commands yet", () => {
    expect(mapCommand("kos", "t.timeWarp[4]")).toBeUndefined();
  });
});
