import { describe, expect, it } from "vitest";
import {
  hasCommandHome,
  isKnownCommandGap,
  KNOWN_COMMAND_GAPS,
  mapCommand,
} from "./map-command";

/**
 * The write-half analog of `map-topic.ts`'s `mapTopic`: old Telemachus action-string
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
        // f.abort is UN-GAPPED — VesselControl.Abort now
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

    /**
     * Finds each group by its own `index` in the raw `vessel.control` record.
     * It used to index the array by POSITION
     * (`vessel.control.actionGroups.{n-1}`) — wrong now that the wire shape is
     * a named list, since position no longer implies identity. The list here is
     * deliberately SPARSE and UNSORTED (no 4..9; 10 before 3) so a positional
     * read could not possibly pass.
     */
    it("f.ag1..f.ag10 find the group by index in vessel.control and invert it", () => {
      const control = {
        actionGroups: [
          { index: 1, name: "AG1", state: true },
          { index: 10, name: "AG10", state: false },
          { index: 2, name: "AG2", state: false },
          { index: 3, name: "AG3", state: true },
        ],
      };
      const getCurrentValue = (topic: string): unknown =>
        topic === "vessel.control" ? control : undefined;

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

    /**
     * A group the elected backend doesn't report has no current state, so there
     * is nothing to invert — the toggle -> absolute bridge must decline rather
     * than guess. Guards against a stray `state: true` being sent for a group
     * that doesn't exist (e.g. a saved AGX group after AGX is uninstalled).
     */
    it("declines a group the record doesn't carry rather than guessing", () => {
      const getCurrentValue = (topic: string): unknown =>
        topic === "vessel.control"
          ? { actionGroups: [{ index: 1, name: "AG1", state: true }] }
          : undefined;

      expect(mapCommand("data", "f.ag1", getCurrentValue)).toEqual({
        command: "vessel.control.setActionGroup",
        args: { group: 1, state: false },
      });
      expect(mapCommand("data", "f.ag7", getCurrentValue)).toBeUndefined();
    });

    it("f.abort is no longer a known command gap", () => {
      expect(isKnownCommandGap("data", "f.abort")).toBe(false);
    });

    /**
     * AGX (Action Groups Extended) assigns indices well past the stock 1..10
     * range — up to 250. `f.ag1`/`f.ag10` are the REGRESSION guard (byte-
     * identical to the old static-table behaviour); `f.ag11`/`f.ag50`/
     * `f.ag250` are the bug this test locks down — before the fix these
     * resolved to `undefined` (no table row), silently no-opping the
     * toggle even though the group renders correctly off the index-generic
     * read path.
     */
    it("resolves f.ag<N> for ANY positive N, not just the stock 1..10 range (AGX groups)", () => {
      const control = {
        actionGroups: [
          { index: 1, name: "AG1", state: true },
          { index: 10, name: "AG10", state: false },
          { index: 11, name: "AG11", state: true },
          { index: 50, name: "Docking Lights", state: false },
          { index: 250, name: "Last AGX Slot", state: true },
        ],
      };
      const getCurrentValue = (topic: string): unknown =>
        topic === "vessel.control" ? control : undefined;

      // Regression guard: f.ag1/f.ag10 resolve exactly as they always did.
      expect(mapCommand("data", "f.ag1", getCurrentValue)).toEqual({
        command: "vessel.control.setActionGroup",
        args: { group: 1, state: false },
      });
      expect(mapCommand("data", "f.ag10", getCurrentValue)).toEqual({
        command: "vessel.control.setActionGroup",
        args: { group: 10, state: true },
      });

      // The bug: these used to be undefined (no static table row).
      expect(mapCommand("data", "f.ag11", getCurrentValue)).toEqual({
        command: "vessel.control.setActionGroup",
        args: { group: 11, state: false },
      });
      expect(mapCommand("data", "f.ag50", getCurrentValue)).toEqual({
        command: "vessel.control.setActionGroup",
        args: { group: 50, state: true },
      });
      expect(mapCommand("data", "f.ag250", getCurrentValue)).toEqual({
        command: "vessel.control.setActionGroup",
        args: { group: 250, state: false },
      });
    });

    it("hasCommandHome reports a home for f.ag<N> at any N, not just the stock range", () => {
      expect(hasCommandHome("data", "f.ag1")).toBe(true);
      expect(hasCommandHome("data", "f.ag10")).toBe(true);
      expect(hasCommandHome("data", "f.ag11")).toBe(true);
      expect(hasCommandHome("data", "f.ag250")).toBe(true);
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

    it("tar.setTargetPosition maps [bodyIndex,lat,lon] to the Position-kind discriminated union", () => {
      expect(mapCommand("data", "tar.setTargetPosition[1,-0.5,74.7]")).toEqual({
        command: "vessel.target.set",
        args: { kind: 3, bodyIndex: 1, latitude: -0.5, longitude: 74.7 },
      });
    });

    it("a malformed tar.setTargetPosition arg falls back to legacy", () => {
      expect(
        mapCommand("data", "tar.setTargetPosition[notanumber,-0.5,74.7]"),
      ).toBeUndefined();
      expect(
        mapCommand("data", "tar.setTargetPosition[1,notanumber,74.7]"),
      ).toBeUndefined();
      expect(
        mapCommand("data", "tar.setTargetPosition[1,-0.5,notanumber]"),
      ).toBeUndefined();
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
  // Bridge 2: index -> stable-id — now UN-GAPPED
  //
  // The read side now round-trips a stable id (vessel.maneuver.nodes[].id
  // and system.vessels[].vesselId), so ManeuverPlanner/TargetPicker
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

  describe("science.experiment.* — partId passthrough", () => {
    it("sci.deploy carries the part id as arg[0]", () => {
      expect(mapCommand("data", "sci.deploy[42]")).toEqual({
        command: "science.experiment.deploy",
        args: { partId: "42" },
      });
      expect(isKnownCommandGap("data", "sci.deploy[42]")).toBe(false);
    });

    it("sci.transmit carries the part id as arg[0]", () => {
      expect(mapCommand("data", "sci.transmit[99]")).toEqual({
        command: "science.experiment.transmit",
        args: { partId: "99" },
      });
      expect(isKnownCommandGap("data", "sci.transmit[99]")).toBe(false);
    });

    it("an empty sci.deploy part id falls back to legacy", () => {
      expect(mapCommand("data", "sci.deploy[]")).toBeUndefined();
    });

    it("an empty sci.transmit part id falls back to legacy", () => {
      expect(mapCommand("data", "sci.transmit[]")).toBeUndefined();
    });
  });

  describe("isKnownCommandGap", () => {
    it("is false for a mapped action", () => {
      expect(isKnownCommandGap("data", "f.sas")).toBe(false);
    });

    it("is false for a dataSourceId other than 'data'", () => {
      expect(isKnownCommandGap("kos", "f.abort")).toBe(false);
    });

    it("KNOWN_COMMAND_GAPS is now empty — the fly-by-wire batch was the last remaining command gap", () => {
      expect(KNOWN_COMMAND_GAPS.size).toBe(0);
    });

    it("strips bracketed args before checking the gap set (regression guard: a bracketed hasCommandHome key must never misread as a gap)", () => {
      expect(isKnownCommandGap("data", "f.sas[true]")).toBe(false);
      expect(isKnownCommandGap("data", "v.setFbW[1]")).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // career.*, robotics.*, ksp.*/tar.switchVessel now
  // have registered mod handlers AND their read-side ids stream (career.
  // status.*, parts.robotics — see map-topic.ts), so they move out of
  // KNOWN_COMMAND_GAPS.
  // ---------------------------------------------------------------------

  describe("career.* — command-ungap batch", () => {
    it("strategies.activate carries the strategy id and factor", () => {
      expect(mapCommand("data", "strategies.activate[SETI,0.5]")).toEqual({
        command: "career.strategy.activate",
        args: { strategyId: "SETI", factor: 0.5 },
      });
      expect(isKnownCommandGap("data", "strategies.activate[SETI,0.5]")).toBe(
        false,
      );
    });

    it("an empty strategies.activate id falls back to legacy", () => {
      expect(mapCommand("data", "strategies.activate[,0.5]")).toBeUndefined();
    });

    it("strategies.deactivate carries the strategy id", () => {
      expect(mapCommand("data", "strategies.deactivate[SETI]")).toEqual({
        command: "career.strategy.deactivate",
        args: { strategyId: "SETI" },
      });
    });

    it("tech.unlock carries the tech id", () => {
      expect(mapCommand("data", "tech.unlock[start]")).toEqual({
        command: "career.tech.unlock",
        args: { techId: "start" },
      });
    });

    it("contracts.accept/decline/cancel carry the contract id", () => {
      expect(mapCommand("data", "contracts.accept[c1]")).toEqual({
        command: "career.contract.accept",
        args: { contractId: "c1" },
      });
      expect(mapCommand("data", "contracts.decline[c1]")).toEqual({
        command: "career.contract.decline",
        args: { contractId: "c1" },
      });
      expect(mapCommand("data", "contracts.cancel[c1]")).toEqual({
        command: "career.contract.cancel",
        args: { contractId: "c1" },
      });
    });

    it("an empty contract id falls back to legacy", () => {
      expect(mapCommand("data", "contracts.accept[]")).toBeUndefined();
    });

    it("kc.upgradeFacility bridges the widget's short code to the SpaceCenterFacility enum name", () => {
      expect(mapCommand("data", "kc.upgradeFacility[vab]")).toEqual({
        command: "career.facility.upgrade",
        args: { facilityId: "VehicleAssemblyBuilding" },
      });
      expect(mapCommand("data", "kc.upgradeFacility[astronaut]")).toEqual({
        command: "career.facility.upgrade",
        args: { facilityId: "AstronautComplex" },
      });
    });

    it("an unrecognized kc.upgradeFacility short code falls back to legacy", () => {
      expect(mapCommand("data", "kc.upgradeFacility[hangar]")).toBeUndefined();
    });
  });

  describe("robotics.* — command-ungap batch", () => {
    it("robotics.servo.setTarget carries the partId and value", () => {
      expect(mapCommand("data", "robotics.servo.setTarget[11,65]")).toEqual({
        command: "robotics.servo.setTarget",
        args: { partId: "11", value: 65 },
      });
      expect(isKnownCommandGap("data", "robotics.servo.setTarget[11,65]")).toBe(
        false,
      );
    });

    it("robotics.servo.setMotor/setLock carry the partId and enabled bool", () => {
      expect(mapCommand("data", "robotics.servo.setMotor[11,true]")).toEqual({
        command: "robotics.servo.setMotor",
        args: { partId: "11", enabled: true },
      });
      expect(mapCommand("data", "robotics.servo.setLock[11,false]")).toEqual({
        command: "robotics.servo.setLock",
        args: { partId: "11", enabled: false },
      });
    });

    it("robotics.rotor.setRpmLimit carries the partId and value with no range check", () => {
      expect(mapCommand("data", "robotics.rotor.setRpmLimit[101,310]")).toEqual(
        {
          command: "robotics.rotor.setRpmLimit",
          args: { partId: "101", value: 310 },
        },
      );
    });

    it("robotics.rotor.setTorqueLimit rejects an out-of-0..100-range value", () => {
      expect(
        mapCommand("data", "robotics.rotor.setTorqueLimit[101,150]"),
      ).toBeUndefined();
      expect(
        mapCommand("data", "robotics.rotor.setTorqueLimit[101,80]"),
      ).toEqual({
        command: "robotics.rotor.setTorqueLimit",
        args: { partId: "101", value: 80 },
      });
    });

    it("robotics.rotor.setBrake rejects an out-of-0..200-range value", () => {
      expect(
        mapCommand("data", "robotics.rotor.setBrake[101,250]"),
      ).toBeUndefined();
      expect(mapCommand("data", "robotics.rotor.setBrake[101,150]")).toEqual({
        command: "robotics.rotor.setBrake",
        args: { partId: "101", value: 150 },
      });
    });

    it("robotics.rotor.setMotor/setLock carry the partId and enabled bool", () => {
      expect(mapCommand("data", "robotics.rotor.setMotor[101,true]")).toEqual({
        command: "robotics.rotor.setMotor",
        args: { partId: "101", enabled: true },
      });
      expect(mapCommand("data", "robotics.rotor.setLock[101,false]")).toEqual({
        command: "robotics.rotor.setLock",
        args: { partId: "101", enabled: false },
      });
    });

    it("robotics.rotor.reverse carries the partId only", () => {
      expect(mapCommand("data", "robotics.rotor.reverse[101]")).toEqual({
        command: "robotics.rotor.reverse",
        args: { partId: "101" },
      });
    });

    it("an empty robotics partId falls back to legacy", () => {
      expect(
        mapCommand("data", "robotics.servo.setTarget[,65]"),
      ).toBeUndefined();
      expect(mapCommand("data", "robotics.rotor.reverse[]")).toBeUndefined();
    });
  });

  describe("ksp.* flight-ops / tar.switchVessel -> ksp.switchVessel — command-ungap batch", () => {
    it("ksp.recover/revertToLaunch/toTrackingStation need no args", () => {
      expect(mapCommand("data", "ksp.recover")).toEqual({
        command: "ksp.recover",
        args: null,
      });
      expect(mapCommand("data", "ksp.revertToLaunch")).toEqual({
        command: "ksp.revertToLaunch",
        args: null,
      });
      expect(mapCommand("data", "ksp.toTrackingStation")).toEqual({
        command: "ksp.toTrackingStation",
        args: null,
      });
      for (const key of [
        "ksp.recover",
        "ksp.revertToLaunch",
        "ksp.toTrackingStation",
      ]) {
        expect(isKnownCommandGap("data", key)).toBe(false);
      }
    });

    it("ksp.revertToEditor carries the literal editor string", () => {
      expect(mapCommand("data", "ksp.revertToEditor[vab]")).toEqual({
        command: "ksp.revertToEditor",
        args: { editor: "vab" },
      });
      expect(isKnownCommandGap("data", "ksp.revertToEditor[vab]")).toBe(false);
    });

    it("tar.switchVessel maps to the renamed ksp.switchVessel command, carrying arg[0] verbatim as vesselId", () => {
      expect(mapCommand("data", "tar.switchVessel[aaaa-1111]")).toEqual({
        command: "ksp.switchVessel",
        args: { vesselId: "aaaa-1111" },
      });
      expect(isKnownCommandGap("data", "tar.switchVessel[aaaa-1111]")).toBe(
        false,
      );
    });

    it("an empty tar.switchVessel id falls back to legacy", () => {
      expect(mapCommand("data", "tar.switchVessel[]")).toBeUndefined();
    });

    it("ksp.launch unwinds the semicolon crew blob into a real array", () => {
      expect(
        mapCommand(
          "data",
          "ksp.launch[Kerbal X,VAB,LaunchPad,Jebediah Kerman;Bill Kerman]",
        ),
      ).toEqual({
        command: "ksp.launch",
        args: {
          shipName: "Kerbal X",
          facility: "VAB",
          site: "LaunchPad",
          crew: ["Jebediah Kerman", "Bill Kerman"],
        },
      });
      expect(
        isKnownCommandGap(
          "data",
          "ksp.launch[Kerbal X,VAB,LaunchPad,Jebediah Kerman;Bill Kerman]",
        ),
      ).toBe(false);
    });

    it("ksp.launch with an empty crew slot launches unmanned", () => {
      expect(mapCommand("data", "ksp.launch[Kerbal X,SPH,Runway,]")).toEqual({
        command: "ksp.launch",
        args: {
          shipName: "Kerbal X",
          facility: "SPH",
          site: "Runway",
          crew: [],
        },
      });
    });

    it("ksp.launch defaults a missing site to LaunchPad", () => {
      expect(mapCommand("data", "ksp.launch[Kerbal X,VAB]")).toEqual({
        command: "ksp.launch",
        args: {
          shipName: "Kerbal X",
          facility: "VAB",
          site: "LaunchPad",
          crew: [],
        },
      });
    });

    it("ksp.launch with no ship name or facility falls back to legacy", () => {
      expect(mapCommand("data", "ksp.launch[,VAB,LaunchPad,]")).toBeUndefined();
      expect(
        mapCommand("data", "ksp.launch[Kerbal X,,LaunchPad,]"),
      ).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------
  // Fly-by-wire — command-ungap batch. vessel.control.setFlyByWire
  // arms/disarms the mod's persistent override; vessel.control.setAxes is a
  // nullable-partial single-field update, not a toggle bridge.
  // ---------------------------------------------------------------------

  describe("fly-by-wire — command-ungap batch", () => {
    it("v.setPitch/v.setYaw/v.setRoll each map to their own named setAxes field", () => {
      const table: Array<[string, "pitch" | "yaw" | "roll"]> = [
        ["v.setPitch", "pitch"],
        ["v.setYaw", "yaw"],
        ["v.setRoll", "roll"],
      ];
      for (const [action, field] of table) {
        expect(mapCommand("data", `${action}[0.5]`)).toEqual({
          command: "vessel.control.setAxes",
          args: { [field]: 0.5 },
        });
      }
    });

    it("axis values are clamped to -1..1", () => {
      expect(mapCommand("data", "v.setPitch[2.5]")).toEqual({
        command: "vessel.control.setAxes",
        args: { pitch: 1 },
      });
      expect(mapCommand("data", "v.setYaw[-3]")).toEqual({
        command: "vessel.control.setAxes",
        args: { yaw: -1 },
      });
    });

    it("a malformed axis arg falls back to legacy", () => {
      expect(mapCommand("data", "v.setPitch[not-a-number]")).toBeUndefined();
      expect(mapCommand("data", "v.setPitch")).toBeUndefined();
    });

    it("f.setPitchTrim/f.setYawTrim/f.setRollTrim each map to their own named setAxes trim field", () => {
      const table: Array<[string, "pitchTrim" | "yawTrim" | "rollTrim"]> = [
        ["f.setPitchTrim", "pitchTrim"],
        ["f.setYawTrim", "yawTrim"],
        ["f.setRollTrim", "rollTrim"],
      ];
      for (const [action, field] of table) {
        expect(mapCommand("data", `${action}[-0.25]`)).toEqual({
          command: "vessel.control.setAxes",
          args: { [field]: -0.25 },
        });
      }
    });

    it("v.setTranslation maps all three positional floats to named x/y/z, clamped", () => {
      expect(mapCommand("data", "v.setTranslation[0.5,-2,1]")).toEqual({
        command: "vessel.control.setAxes",
        args: { x: 0.5, y: -1, z: 1 },
      });
    });

    it("a malformed v.setTranslation arg falls back to legacy", () => {
      expect(mapCommand("data", "v.setTranslation[0.5,x,1]")).toBeUndefined();
      expect(mapCommand("data", "v.setTranslation[0.5,1]")).toBeUndefined();
    });

    it("v.setFbW maps a positive state to enabled:true and non-positive to enabled:false", () => {
      expect(mapCommand("data", "v.setFbW[1]")).toEqual({
        command: "vessel.control.setFlyByWire",
        args: { enabled: true },
      });
      expect(mapCommand("data", "v.setFbW[0]")).toEqual({
        command: "vessel.control.setFlyByWire",
        args: { enabled: false },
      });
    });

    it("a malformed v.setFbW arg falls back to legacy", () => {
      expect(mapCommand("data", "v.setFbW[armed]")).toBeUndefined();
    });

    it("f.throttleUp/f.throttleDown apply the legacy +-0.1 nudge to the live throttle reading, clamped 0..1", () => {
      expect(
        mapCommand("data", "f.throttleUp", (topic) =>
          topic === "vessel.control.throttle" ? 0.5 : undefined,
        ),
      ).toEqual({
        command: "vessel.control.setThrottle",
        args: { value: 0.6 },
      });

      expect(
        mapCommand("data", "f.throttleDown", (topic) =>
          topic === "vessel.control.throttle" ? 0.5 : undefined,
        ),
      ).toEqual({
        command: "vessel.control.setThrottle",
        args: { value: 0.4 },
      });

      expect(
        mapCommand("data", "f.throttleUp", (topic) =>
          topic === "vessel.control.throttle" ? 0.95 : undefined,
        ),
      ).toEqual({ command: "vessel.control.setThrottle", args: { value: 1 } });

      expect(
        mapCommand("data", "f.throttleDown", (topic) =>
          topic === "vessel.control.throttle" ? 0.05 : undefined,
        ),
      ).toEqual({ command: "vessel.control.setThrottle", args: { value: 0 } });
    });

    it("f.throttleUp/f.throttleDown without a live current value fall back to legacy — never a blind nudge", () => {
      expect(mapCommand("data", "f.throttleUp")).toBeUndefined();
      expect(
        mapCommand("data", "f.throttleDown", () => undefined),
      ).toBeUndefined();
      expect(
        mapCommand("data", "f.throttleUp", () => "not-a-number"),
      ).toBeUndefined();
    });

    it("every fly-by-wire key is no longer a known command gap", () => {
      const keys = [
        "v.setPitch",
        "v.setYaw",
        "v.setRoll",
        "v.setTranslation",
        "v.setFbW",
        "f.setPitchTrim",
        "f.setYawTrim",
        "f.setRollTrim",
        "f.throttleUp",
        "f.throttleDown",
      ];
      for (const key of keys) {
        expect(isKnownCommandGap("data", key)).toBe(false);
      }
    });
  });
});
