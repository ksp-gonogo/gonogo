import { describe, expect, it } from "vitest";
import { CommsDelaySource } from "../__generated__/contract";
import { value } from "../unit-system/value";
import { DelayAuthority, type DelaySubscribable } from "./delay-authority";

function at(vantage: string): DelaySubscribable {
  return { subscribe: () => () => {}, selectedVantage: vantage };
}

/**
 * A forward centre's own route is not home's. When its row leaves
 * `commandCentre.activeVesselDelay`, that centre has lost its path to the
 * craft, and timing its screen by home's delay would show it pictures and
 * readings on a path it does not have.
 */
describe("DelayAuthority for a centre other than home", () => {
  it("holds the centre's own last delay after its row goes, never home's", () => {
    const authority = new DelayAuthority();
    authority.attach(at("vessel:forward"));
    authority.observe({
      oneWaySeconds: value("s", 2),
      source: CommsDelaySource.SignalDelay,
    });
    authority.observeCentreDelays({
      centres: [{ id: "vessel:forward", oneWaySeconds: value("s", 40) }],
    });
    expect(authority.delaySeconds()).toBe(40);

    authority.observeCentreDelays({ centres: [] });
    expect(authority.delaySeconds()).toBe(40);
  });

  it("takes the centre's new row once it has one again", () => {
    const authority = new DelayAuthority();
    authority.attach(at("vessel:forward"));
    authority.observeCentreDelays({
      centres: [{ id: "vessel:forward", oneWaySeconds: value("s", 40) }],
    });
    authority.observeCentreDelays({ centres: [] });
    authority.observeCentreDelays({
      centres: [{ id: "vessel:forward", oneWaySeconds: value("s", 12) }],
    });
    expect(authority.delaySeconds()).toBe(12);
  });

  it("times home, which is never listed, by comms.delay", () => {
    const authority = new DelayAuthority();
    authority.attach(at("ground:ksc"));
    authority.observe({
      oneWaySeconds: value("s", 7),
      source: CommsDelaySource.SignalDelay,
    });
    authority.observeCentreDelays({
      centres: [{ id: "vessel:forward", oneWaySeconds: value("s", 40) }],
    });
    expect(authority.delaySeconds()).toBe(7);
  });
});
