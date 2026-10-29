import { describe, expect, it } from "vitest";
import { CommsDelaySource } from "../__generated__/contract";
import { value } from "../unit-system/value";
import { DelayAuthority, type DelaySubscribable } from "./delay-authority";

const HOME = "ground:Kerbin: KSC";
const FORWARD = "vessel:forward";
const LINKED = "vessel:92868329-cd07-e665-3ece-761f05a52c8c";
const UNLINKED = "vessel:0556f872-7559-0466-d6d6-f7648bcd4344";

function at(vantage: string): DelaySubscribable {
  return { subscribe: () => () => {}, selectedVantage: vantage };
}

function measured(seconds: number, craft = LINKED) {
  return {
    oneWaySeconds: value("s", seconds),
    source: CommsDelaySource.SignalDelay,
    meta: { source: craft },
  };
}

describe("the delay of a command to the active craft", () => {
  it("is unknown before any comms.delay figure, never zero", () => {
    const authority = new DelayAuthority();
    authority.attach(at(HOME));
    expect(authority.commandDelaySeconds()).toBeNull();
  });

  it("is home's comms.delay figure at home", () => {
    const authority = new DelayAuthority();
    authority.attach(at(HOME));
    authority.observe(measured(7));
    expect(authority.commandDelaySeconds()).toBe(7);
  });

  it("is a forward centre's own row at that centre, not home's", () => {
    const authority = new DelayAuthority();
    authority.attach(at(FORWARD));
    authority.observe(measured(7));
    authority.observeCentreDelays({
      centres: [{ id: FORWARD, oneWaySeconds: value("s", 40) }],
    });
    expect(authority.commandDelaySeconds()).toBe(40);
  });

  it("is the named centre's row for a command sent from another centre", () => {
    const authority = new DelayAuthority();
    authority.attach(at(HOME));
    authority.observe(measured(7));
    authority.observeCentreDelays({
      centres: [{ id: FORWARD, oneWaySeconds: value("s", 40) }],
    });
    expect(authority.commandDelaySeconds(FORWARD)).toBe(40);
  });

  it("is unknown once comms.delay reports no path, where the view clock holds", () => {
    const authority = new DelayAuthority();
    authority.attach(at(HOME));
    authority.observe(measured(7));
    authority.observe({
      oneWaySeconds: null,
      source: CommsDelaySource.None,
      meta: { source: LINKED },
    });
    expect(authority.commandDelaySeconds()).toBeNull();
    expect(authority.delaySeconds()).toBe(7);
  });
});

describe("a change of craft seen only on vessel.identity", () => {
  it("makes the command delay unknown while the identity is withdrawn", () => {
    const authority = new DelayAuthority();
    authority.attach(at(HOME));
    authority.observeIdentity({ vesselId: "a" });
    authority.observe(measured(285));

    authority.observeIdentity(null);

    expect(authority.commandDelaySeconds()).toBeNull();
  });

  it("forgets the craft before it when the new craft is named, its delay still withheld", () => {
    const authority = new DelayAuthority();
    authority.attach(at(HOME));
    authority.observeIdentity({ vesselId: "a" });
    authority.observe(measured(285));

    authority.observeIdentity(null);
    authority.observeIdentity({ vesselId: "b" });

    expect(authority.commandDelaySeconds()).toBeNull();
    expect(authority.delaySeconds()).toBe(Number.POSITIVE_INFINITY);
  });

  it("times the new craft by its own figure once that arrives", () => {
    const authority = new DelayAuthority();
    authority.attach(at(HOME));
    authority.observeIdentity({ vesselId: "a" });
    authority.observe(measured(285));
    authority.observeIdentity({ vesselId: "b" });

    authority.observe(measured(12, UNLINKED));

    expect(authority.commandDelaySeconds()).toBe(12);
    expect(authority.delaySeconds()).toBe(12);
  });

  it("keeps the new craft's figure when comms.delay moved before the identity did", () => {
    const authority = new DelayAuthority();
    authority.attach(at(HOME));
    authority.observeIdentity({ vesselId: "a" });
    authority.observe(measured(285));
    authority.observe(measured(12, UNLINKED));

    authority.observeIdentity({ vesselId: "b" });

    expect(authority.commandDelaySeconds()).toBe(12);
  });

  it("drops a forward centre's row for the craft before", () => {
    const authority = new DelayAuthority();
    authority.attach(at(FORWARD));
    authority.observeIdentity({ vesselId: "a" });
    authority.observeCentreDelays({
      centres: [{ id: FORWARD, oneWaySeconds: value("s", 40) }],
    });

    authority.observeIdentity({ vesselId: "b" });

    expect(authority.commandDelaySeconds()).toBeNull();
  });

  it("is not a change of craft when the same craft is named again", () => {
    const authority = new DelayAuthority();
    authority.attach(at(HOME));
    authority.observeIdentity({ vesselId: "a" });
    authority.observe(measured(285));
    authority.observeIdentity({ vesselId: "a" });
    expect(authority.commandDelaySeconds()).toBe(285);
  });
});
