import {
  clearStationBrokers,
  registerStationBroker,
  type StationBroker,
} from "@ksp-gonogo/sitrep-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { asClientService, idlePeerClient } from "../test/peerFakes";
import { attachStationBrokers } from "./stationBrokers";

const UPLINK_ID = "planted";
const TURN: RTCIceServer = { urls: "turn:relay.example:3478" };

afterEach(() => {
  clearStationBrokers();
});

function capture(): { broker: () => StationBroker } {
  let captured: StationBroker | undefined;
  registerStationBroker(UPLINK_ID, (broker) => {
    captured = broker;
  });
  return {
    broker: () => {
      if (!captured) throw new Error("no broker was attached");
      return captured;
    },
  };
}

describe("attachStationBrokers", () => {
  it("relays a registered Uplink's calls to the host under that Uplink's own id", async () => {
    const sendUplinkRelay = vi.fn(() => Promise.resolve({ answered: true }));
    const client = asClientService({
      ...idlePeerClient(),
      sendUplinkRelay,
    });
    const { broker } = capture();
    attachStationBrokers(client);

    await expect(broker().relay("ping", { n: 1 })).resolves.toEqual({
      answered: true,
    });
    expect(sendUplinkRelay).toHaveBeenCalledWith(UPLINK_ID, "ping", { n: 1 });
  });

  it("reads the host's broadcast TURN credentials and their rotation", () => {
    const listeners: ((servers: RTCIceServer[]) => void)[] = [];
    let current: RTCIceServer[] = [];
    const client = asClientService({
      ...idlePeerClient(),
      getRelayIceServers: () => current,
      onRelayIceServersChange: (cb: (servers: RTCIceServer[]) => void) => {
        listeners.push(cb);
        return () => {};
      },
    });
    const { broker } = capture();
    attachStationBrokers(client);

    const rotated = vi.fn();
    broker().iceServers.onChange(rotated);
    current = [TURN];
    for (const cb of listeners) cb(current);

    expect(broker().iceServers.current()).toEqual([TURN]);
    expect(rotated).toHaveBeenCalledWith([TURN]);
  });

  it("attaches an Uplink whose bundle registers after the station came up", () => {
    const client = asClientService(idlePeerClient());
    attachStationBrokers(client);
    const attach = vi.fn();
    registerStationBroker(UPLINK_ID, attach);
    expect(attach).toHaveBeenCalledTimes(1);
  });

  it("keeps attaching the rest when one Uplink's attach throws", () => {
    registerStationBroker("throws", () => {
      throw new Error("boom");
    });
    const attach = vi.fn();
    registerStationBroker(UPLINK_ID, attach);
    expect(() =>
      attachStationBrokers(asClientService(idlePeerClient())),
    ).not.toThrow();
    expect(attach).toHaveBeenCalledTimes(1);
  });

  it("stops attaching once the station unmounts", () => {
    const stop = attachStationBrokers(asClientService(idlePeerClient()));
    stop();
    const attach = vi.fn();
    registerStationBroker(UPLINK_ID, attach);
    expect(attach).not.toHaveBeenCalled();
  });
});
