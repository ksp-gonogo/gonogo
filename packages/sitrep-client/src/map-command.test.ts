import { describe, expect, it } from "vitest";
import { isKnownCommandGap, mapCommand } from "./map-command";

/**
 * The M3 write-half analog of `map-topic.ts`'s `mapTopic` (`m3-migration-plan
 * .md` §4-commands/§Build 1's "command shim"): old Telemachus action-string
 * key -> new `vessel.*`/`time.*` typed command + args. Command topics/arg
 * shapes are confirmed against `mod/Sitrep.Host/VesselCommandProvider.cs` and
 * `mod/Sitrep.Contract/VesselCommands.cs`; the wire's arg CASING is
 * camelCase (every payload field in `local_docs/telemetry-mod/recordings/
 * reference-wire-fixture.json` is camelCase — `JsonNamingPolicy.CamelCase`,
 * confirmed in `mod/Sitrep.Host.IntegrationTests/WireFixtureGeneratorTests
 * .cs`), so `{ index }`/`{ paused }`, not the C#-cased `{ Index }`/
 * `{ Paused }`. See `map-command.ts`'s own doc comment for the three
 * harder arg-shape bridges (toggle -> absolute, index -> stable-id,
 * positional -> named) this table implements.
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
    expect(
      mapCommand("data", "kos.compute.my-feed.dispatchNow"),
    ).toBeUndefined();
  });

  it("returns undefined for a dataSourceId other than 'data' — nothing else is wired to commands yet", () => {
    expect(mapCommand("kos", "t.timeWarp[4]")).toBeUndefined();
  });

  // ---------------------------------------------------------------------
  // Bridge 1: toggle -> absolute
  // ---------------------------------------------------------------------

  describe("toggle -> absolute bridge", () => {
    it("f.sas inverts the current vessel.control.sas value into an absolute setSas command", () => {
      expect(
        mapCommand("data", "f.sas", (topic) =>
          topic === "vessel.control.sas" ? true : undefined,
        ),
      ).toEqual({ command: "vessel.control.setSas", args: { enabled: false } });

      expect(
        mapCommand("data", "f.sas", (topic) =>
          topic === "vessel.control.sas" ? false : undefined,
        ),
      ).toEqual({ command: "vessel.control.setSas", args: { enabled: true } });
    });

    it("f.rcs/f.gear/f.brake/f.light/f.abort each invert their own sibling read topic", () => {
      const table: Array<[string, string, string]> = [
        ["f.rcs", "vessel.control.rcs", "vessel.control.setRcs"],
        ["f.gear", "vessel.control.gear", "vessel.control.setGear"],
        ["f.brake", "vessel.control.brakes", "vessel.control.setBrakes"],
        ["f.light", "vessel.control.lights", "vessel.control.setLights"],
        // f.abort UN-GAPPED (P4a command batch) — VesselControl.Abort now
        // ships on the wire, same clean toggle bridge as its siblings.
        ["f.abort", "vessel.control.abort", "vessel.control.setAbort"],
      ];
      for (const [action, readTopic, command] of table) {
        expect(
          mapCommand("data", action, (topic) =>
            topic === readTopic ? true : undefined,
          ),
        ).toEqual({ command, args: { enabled: false } });
      }
    });

    it("without a getCurrentValue reader, a bare toggle can never resolve — falls back to legacy (never a blind set)", () => {
      // No third arg at all — mirrors every existing 2-arg call site.
      expect(mapCommand("data", "f.sas")).toBeUndefined();
      expect(mapCommand("data", "f.rcs")).toBeUndefined();
    });

    it("an unknown (undefined) current value falls back to legacy instead of guessing", () => {
      expect(mapCommand("data", "f.sas", () => undefined)).toBeUndefined();
    });

    it("a non-boolean current value (shape surprise) falls back to legacy", () => {
      expect(mapCommand("data", "f.sas", () => 42)).toBeUndefined();
    });

    it("f.ag1..f.ag10 read the raw actionGroups array element and invert it", () => {
      const actionGroups = [
        true,
        false,
        true,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
      ];
      const getCurrentValue = (topic: string): unknown => {
        const match = /^vessel\.control\.actionGroups\.(\d+)$/.exec(topic);
        if (!match) return undefined;
        return actionGroups[Number(match[1])];
      };

      expect(mapCommand("data", "f.ag1", getCurrentValue)).toEqual({
        command: "vessel.control.setActionGroup",
        args: { group: 1, state: false },
      });
      expect(mapCommand("data", "f.ag3", getCurrentValue)).toEqual({
        command: "vessel.control.setActionGroup",
        args: { group: 3, state: false },
      });
      expect(mapCommand("data", "f.ag2", getCurrentValue)).toEqual({
        command: "vessel.control.setActionGroup",
        args: { group: 2, state: true },
      });
      expect(mapCommand("data", "f.ag10", getCurrentValue)).toEqual({
        command: "vessel.control.setActionGroup",
        args: { group: 10, state: true },
      });
    });

    it("f.ag1 falls back to legacy when the raw vessel.control topic hasn't been read by anything yet", () => {
      expect(mapCommand("data", "f.ag1", () => undefined)).toBeUndefined();
    });

    it("f.abort is no longer a known command gap", () => {
      expect(isKnownCommandGap("data", "f.abort")).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // Bridge 3: positional -> named (+ malformed -> legacy, RED->GREEN)
  // ---------------------------------------------------------------------

  describe("positional -> named bridge", () => {
    it("f.setThrottle maps its single positional arg to the named 0..1 value", () => {
      expect(mapCommand("data", "f.setThrottle[0.500]")).toEqual({
        command: "vessel.control.setThrottle",
        args: { value: 0.5 },
      });
    });

    it("f.throttleZero/f.throttleFull map to the absolute endpoints — no toggle bridge needed", () => {
      expect(mapCommand("data", "f.throttleZero")).toEqual({
        command: "vessel.control.setThrottle",
        args: { value: 0 },
      });
      expect(mapCommand("data", "f.throttleFull")).toEqual({
        command: "vessel.control.setThrottle",
        args: { value: 1 },
      });
    });

    it("a malformed (non-numeric) throttle arg falls back to legacy — never dispatches NaN", () => {
      // RED (pre-fix behaviour this test locks in as GREEN): a naive bridge
      // would send `{ value: NaN }` straight to the wire. This must instead
      // resolve to `undefined` so useExecuteAction's shim uses legacy execute().
      expect(mapCommand("data", "f.setThrottle[notanumber]")).toBeUndefined();
    });

    it("an out-of-range throttle arg falls back to legacy rather than relying solely on the server's E_RANGE", () => {
      expect(mapCommand("data", "f.setThrottle[1.5]")).toBeUndefined();
      expect(mapCommand("data", "f.setThrottle[-0.1]")).toBeUndefined();
    });

    it("f.setSASMode maps the mode name to its C#-declared-order ordinal", () => {
      expect(mapCommand("data", "f.setSASMode[StabilityAssist]")).toEqual({
        command: "vessel.control.setSasMode",
        args: { mode: 0 },
      });
      expect(mapCommand("data", "f.setSASMode[Prograde]")).toEqual({
        command: "vessel.control.setSasMode",
        args: { mode: 1 },
      });
      expect(mapCommand("data", "f.setSASMode[Maneuver]")).toEqual({
        command: "vessel.control.setSasMode",
        args: { mode: 9 },
      });
    });

    it("an unrecognized SAS mode name falls back to legacy", () => {
      expect(mapCommand("data", "f.setSASMode[NotARealMode]")).toBeUndefined();
    });

    it("tar.setTargetBody maps the body index to the Body-kind discriminated union", () => {
      expect(mapCommand("data", "tar.setTargetBody[3]")).toEqual({
        command: "vessel.target.set",
        args: { kind: 1, bodyIndex: 3 },
      });
    });

    it("tar.clearTarget needs no args", () => {
      expect(mapCommand("data", "tar.clearTarget")).toEqual({
        command: "vessel.target.clear",
        args: null,
      });
    });

    it("f.stage needs no args", () => {
      expect(mapCommand("data", "f.stage")).toEqual({
        command: "vessel.control.stage",
        args: null,
      });
    });

    it("o.addManeuverNode maps [ut,radial,normal,prograde] to the named RADIAL/NORMAL/PROGRADE-preserving args", () => {
      expect(mapCommand("data", "o.addManeuverNode[100.5,1,2,3]")).toEqual({
        command: "vessel.maneuver.add",
        args: { ut: 100.5, radialOut: 1, normal: 2, prograde: 3 },
      });
    });

    it("a malformed maneuver-add arg falls back to legacy", () => {
      expect(
        mapCommand("data", "o.addManeuverNode[100,1,notanumber,3]"),
      ).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------
  // Bridge 2: index -> stable-id — UN-GAPPED (M3 vessel-gap batch)
  //
  // The read side now round-trips a stable id (vessel.maneuver.nodes[].id
  // and system.vessels[].vesselId, M3 R3), so ManeuverPlanner/TargetPicker
  // resolve the real id and pass it as the FIRST positional arg — these
  // three commands now have real homes instead of being declared gaps.
  // ---------------------------------------------------------------------

  describe("index -> stable-id bridge — un-gapped now that the id round-trips", () => {
    it("o.updateManeuverNode carries the node id as arg[0], RADIAL/NORMAL/PROGRADE for the rest", () => {
      expect(
        mapCommand(
          "data",
          "o.updateManeuverNode[3aabdda0-9d2a-4931-8511-d9bfa4be4b4e,100,1,2,3]",
        ),
      ).toEqual({
        command: "vessel.maneuver.update",
        args: {
          nodeId: "3aabdda0-9d2a-4931-8511-d9bfa4be4b4e",
          ut: 100,
          radialOut: 1,
          normal: 2,
          prograde: 3,
        },
      });
      expect(
        isKnownCommandGap(
          "data",
          "o.updateManeuverNode[3aabdda0-9d2a-4931-8511-d9bfa4be4b4e,100,1,2,3]",
        ),
      ).toBe(false);
    });

    it("o.removeManeuverNode carries the node id as arg[0]", () => {
      expect(
        mapCommand(
          "data",
          "o.removeManeuverNode[3aabdda0-9d2a-4931-8511-d9bfa4be4b4e]",
        ),
      ).toEqual({
        command: "vessel.maneuver.remove",
        args: { nodeId: "3aabdda0-9d2a-4931-8511-d9bfa4be4b4e" },
      });
      expect(
        isKnownCommandGap(
          "data",
          "o.removeManeuverNode[3aabdda0-9d2a-4931-8511-d9bfa4be4b4e]",
        ),
      ).toBe(false);
    });

    it("a fallback positional-index id (pre-round-trip / no-stream) still resolves — the server no-ops an unknown id", () => {
      // ManeuverPlanner's resolveNodeId falls back to String(index) when no
      // stream id has arrived; it's still a non-empty string, so the command
      // builds. (Accepted-risk: a stale index is a harmless server-side miss,
      // never a crash — see map-command.ts's own doc comment.)
      expect(mapCommand("data", "o.removeManeuverNode[0]")).toEqual({
        command: "vessel.maneuver.remove",
        args: { nodeId: "0" },
      });
    });

    it("a malformed maneuver-update numeric arg falls back to legacy", () => {
      expect(
        mapCommand("data", "o.updateManeuverNode[some-id,100,notanumber,2,3]"),
      ).toBeUndefined();
    });

    it("an empty node id falls back to legacy (never dispatch a blank id)", () => {
      expect(mapCommand("data", "o.removeManeuverNode[]")).toBeUndefined();
    });

    it("tar.setTargetVessel carries the vessel id as arg[0] with kind=Vessel(0)", () => {
      expect(
        mapCommand("data", "tar.setTargetVessel[aaaa-1111-bbbb-2222]"),
      ).toEqual({
        command: "vessel.target.set",
        args: { kind: 0, vesselId: "aaaa-1111-bbbb-2222" },
      });
      expect(
        isKnownCommandGap("data", "tar.setTargetVessel[aaaa-1111-bbbb-2222]"),
      ).toBe(false);
    });

    it("an empty tar.setTargetVessel id falls back to legacy", () => {
      expect(mapCommand("data", "tar.setTargetVessel[]")).toBeUndefined();
    });
  });

  describe("isKnownCommandGap", () => {
    it("is false for a mapped action", () => {
      expect(isKnownCommandGap("data", "f.sas")).toBe(false);
    });

    it("is false for a dataSourceId other than 'data'", () => {
      expect(isKnownCommandGap("kos", "f.abort")).toBe(false);
    });

    it("strips bracketed args before checking the gap set", () => {
      expect(isKnownCommandGap("data", "robotics.servo.setTarget[3,45]")).toBe(
        true,
      );
    });
  });
});
