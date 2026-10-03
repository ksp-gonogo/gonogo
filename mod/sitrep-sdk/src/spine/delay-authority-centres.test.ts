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

/**
 * A centre that has never had a ledger row is not home, and once the roster
 * says so it is timed by its own predicted route rather than home's delay.
 */
describe("DelayAuthority for a centre never listed", () => {
  const roster = [
    { id: "ground:ksc", isHome: true },
    { id: "ground:forward", isHome: false },
  ];
  const routes = (seconds: number, live: boolean) => ({
    routes: [
      {
        from: "vessel:probe",
        to: "ground:forward",
        sentUt: value("ut", 1000),
        arrivalUt: value("ut", 1000 + seconds),
        live,
      },
    ],
  });

  it("takes its own routed delay once the roster says it is not home", () => {
    const authority = new DelayAuthority();
    authority.attach(at("ground:forward"));
    authority.observe({
      oneWaySeconds: value("s", 2),
      source: CommsDelaySource.SignalDelay,
    });
    authority.observeRoutes(routes(30, true));
    expect(authority.delaySeconds()).toBe(2);

    authority.observeRoster(roster);
    expect(authority.delaySeconds()).toBe(30);
  });

  it("holds its last live route through a gap, and takes a waiting route only before it has had one", () => {
    const authority = new DelayAuthority();
    authority.attach(at("ground:forward"));
    authority.observeRoster(roster);

    authority.observeRoutes(routes(900, false));
    expect(authority.delaySeconds()).toBe(900);

    authority.observeRoutes(routes(30, true));
    authority.observeRoutes(routes(900, false));
    expect(authority.delaySeconds()).toBe(30);
  });

  it("never times home by a route, and a centre with no route stays on comms.delay", () => {
    const authority = new DelayAuthority();
    authority.attach(at("ground:ksc"));
    authority.observeRoster(roster);
    authority.observe({
      oneWaySeconds: value("s", 7),
      source: CommsDelaySource.SignalDelay,
    });
    authority.observeRoutes({
      routes: [
        {
          from: "vessel:probe",
          to: "ground:ksc",
          sentUt: 1000,
          arrivalUt: 1050,
          live: true,
        },
      ],
    });
    expect(authority.delaySeconds()).toBe(7);

    const island = new DelayAuthority();
    island.attach(at("ground:island"));
    island.observeRoster(roster);
    island.observe({
      oneWaySeconds: value("s", 7),
      source: CommsDelaySource.SignalDelay,
    });
    island.observeRoutes({
      routes: [
        {
          from: "vessel:probe",
          to: "ground:island",
          sentUt: 1000,
          arrivalUt: null,
          live: false,
        },
      ],
    });
    expect(island.delaySeconds()).toBe(7);
  });

  it("prefers the centre's own ledger row to any route", () => {
    const authority = new DelayAuthority();
    authority.attach(at("ground:forward"));
    authority.observeRoster(roster);
    authority.observeRoutes(routes(30, true));
    authority.observeCentreDelays({
      centres: [{ id: "ground:forward", oneWaySeconds: value("s", 25) }],
    });
    expect(authority.delaySeconds()).toBe(25);
  });
});
