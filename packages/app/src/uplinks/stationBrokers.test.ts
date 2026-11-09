import {
  clearStationBrokers,
  registerStationBroker,
  type StationBroker,
} from "@ksp-gonogo/sitrep-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnStatus } from "../peer/PeerClientService";
import { asClientService, idlePeerClient } from "../test/peerFakes";
import { attachStationBrokers } from "./stationBrokers";

const UPLINK_ID = "planted";

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

  it("offers no ICE servers, to an Uplink that still reads them", () => {
    const { broker } = capture();
    attachStationBrokers(asClientService(idlePeerClient()));
    const changed = vi.fn();
    broker().iceServers.onChange(changed);
    expect(broker().iceServers.current()).toEqual([]);
    expect(changed).not.toHaveBeenCalled();
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

  it("tells an Uplink each time the station's link to the main screen comes back, and not on its first connect", () => {
    let emit: (status: ConnStatus) => void = () => {};
    const client = asClientService({
      ...idlePeerClient(),
      getConnStatus: () => "connecting",
      onConnectionStatus: (cb: (status: ConnStatus) => void) => {
        emit = cb;
        return () => {};
      },
    });
    const { broker } = capture();
    attachStationBrokers(client);
    const reset = vi.fn();
    broker().onLinkReset?.(reset);

    emit("connected");
    expect(reset).not.toHaveBeenCalled();
    emit("reconnecting");
    emit("connecting");
    emit("connected");
    expect(reset).toHaveBeenCalledTimes(1);
    emit("connected");
    expect(reset).toHaveBeenCalledTimes(1);
    emit("disconnected");
    emit("connected");
    expect(reset).toHaveBeenCalledTimes(2);
  });

  it("stops telling an Uplink of resets once it unsubscribes or the station unmounts", () => {
    let emit: (status: ConnStatus) => void = () => {};
    const client = asClientService({
      ...idlePeerClient(),
      onConnectionStatus: (cb: (status: ConnStatus) => void) => {
        emit = cb;
        return () => {
          emit = () => {};
        };
      },
    });
    const { broker } = capture();
    const stop = attachStationBrokers(client);
    const kept = vi.fn();
    const dropped = vi.fn();
    broker().onLinkReset?.(kept);
    broker().onLinkReset?.(dropped)();
    emit("reconnecting");
    emit("connected");
    expect(kept).toHaveBeenCalledTimes(1);
    expect(dropped).not.toHaveBeenCalled();
    stop();
    emit("reconnecting");
    emit("connected");
    expect(kept).toHaveBeenCalledTimes(1);
  });

  it("stops attaching once the station unmounts", () => {
    const stop = attachStationBrokers(asClientService(idlePeerClient()));
    stop();
    const attach = vi.fn();
    registerStationBroker(UPLINK_ID, attach);
    expect(attach).not.toHaveBeenCalled();
  });
});
