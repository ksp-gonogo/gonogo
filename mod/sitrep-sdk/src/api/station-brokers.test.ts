import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearStationBrokers,
  registerStationBroker,
  unregisterStationBroker,
  watchStationBrokers,
} from "./station-brokers";
import type { StationBroker } from "./types";

const BROKER: StationBroker = {
  relay: () => Promise.resolve(undefined),
  iceServers: { current: () => [], onChange: () => () => {} },
};

afterEach(() => {
  clearStationBrokers();
});

describe("station brokers", () => {
  it("hands a registration made before the watch starts to the watcher", () => {
    const attach = vi.fn();
    registerStationBroker("early", attach);
    watchStationBrokers((_, a) => a(BROKER));
    expect(attach).toHaveBeenCalledWith(BROKER);
  });

  it("hands a registration made after the watch starts to the watcher", () => {
    const seen: string[] = [];
    watchStationBrokers((id) => {
      seen.push(id);
    });
    registerStationBroker("late", () => {});
    expect(seen).toEqual(["late"]);
  });

  it("never calls an attach when nothing is watching, which is the main screen", () => {
    const attach = vi.fn();
    registerStationBroker("unwatched", attach);
    expect(attach).not.toHaveBeenCalled();
  });

  it("hands a live watcher the replacement when the same id registers again", () => {
    const first = vi.fn();
    const second = vi.fn();
    watchStationBrokers((_, a) => a(BROKER));
    registerStationBroker("replaced", first);
    registerStationBroker("replaced", second);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(BROKER);

    const later = vi.fn();
    watchStationBrokers(later);
    expect(later).toHaveBeenCalledWith("replaced", second);
  });

  it("does not hand an unregistered id to a later watcher", () => {
    registerStationBroker("removed", () => {});
    unregisterStationBroker("removed");
    const watcher = vi.fn();
    watchStationBrokers(watcher);
    expect(watcher).not.toHaveBeenCalled();
  });

  it("stops handing registrations over once the watch stops", () => {
    const watcher = vi.fn();
    const stop = watchStationBrokers(watcher);
    stop();
    registerStationBroker("after-stop", () => {});
    expect(watcher).not.toHaveBeenCalled();
  });
});
