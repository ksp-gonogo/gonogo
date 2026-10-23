import { describe, expect, it } from "vitest";
import { CommsDelaySource } from "../__generated__/contract";
import { value } from "../unit-system/value";
import { DelayAuthority, type DelaySubscribable } from "./delay-authority";
import { ViewClock } from "./view-clock";

const AT_HOME: DelaySubscribable = {
  subscribe: () => () => {},
  selectedVantage: "ground:Kerbin: KSC",
};

const LINKED = "vessel:92868329-cd07-e665-3ece-761f05a52c8c";
const UNLINKED = "vessel:0556f872-7559-0466-d6d6-f7648bcd4344";

describe("DelayAuthority across a change of craft", () => {
  it("does not time a craft with no path by the delay of the craft before it", () => {
    const authority = new DelayAuthority();
    authority.attach(AT_HOME);
    authority.observe({
      oneWaySeconds: value("s", 285.97),
      source: CommsDelaySource.SignalDelay,
      meta: { source: LINKED },
    });
    authority.observeCentreDelays({
      centres: [
        { id: "ground:Kerbin: KSC", oneWaySeconds: value("s", 285.97) },
      ],
    });
    expect(authority.delaySeconds()).toBeCloseTo(285.97);

    authority.observe({
      oneWaySeconds: null,
      source: CommsDelaySource.None,
      meta: { source: UNLINKED },
    });

    expect(authority.delaySeconds()).toBe(0);
  });

  it("still holds a craft's own last delay through its own blackout", () => {
    const authority = new DelayAuthority();
    authority.attach(AT_HOME);
    authority.observe({
      oneWaySeconds: value("s", 285.97),
      source: CommsDelaySource.SignalDelay,
      meta: { source: LINKED },
    });
    authority.observe({
      oneWaySeconds: null,
      source: CommsDelaySource.None,
      meta: { source: LINKED },
    });
    expect(authority.delaySeconds()).toBeCloseTo(285.97);
  });
});

describe("the view clock after a change of craft", () => {
  it("advances at once on a craft with no path, with no signal-delay freeze", () => {
    let wall = 0;
    const authority = new DelayAuthority();
    authority.attach(AT_HOME);
    const clock = new ViewClock({
      nowWall: () => wall,
      delaySeconds: authority.delaySeconds,
    });
    authority.observe({
      oneWaySeconds: value("s", 286),
      source: CommsDelaySource.SignalDelay,
      meta: { source: LINKED },
    });
    clock.observeSample(1000, 1000);
    authority.observe({
      oneWaySeconds: null,
      source: CommsDelaySource.None,
      meta: { source: UNLINKED },
    });

    wall = 10;
    clock.observeSample(1010, 1010);

    expect(clock.viewUt()).toBe(1010);
  });
});
