import "fake-indexeddb/auto";
import { MissionHistorySource, MissionStore } from "@ksp-gonogo/data";
import { describe, expect, it } from "vitest";
import { PeerBroadcastingDataSource } from "./PeerBroadcastingDataSource";
import { peerHostService } from "./PeerHostService";

describe("PeerBroadcastingDataSource around the mission history source", () => {
  it("stores and lists a contract finish through the wrapper the host registers", async () => {
    const real = new MissionHistorySource(
      new MissionStore({ dbName: "pbds-contract-finish" }),
    );
    const wrapper = new PeerBroadcastingDataSource(real, peerHostService);
    const finish = {
      id: "15220046646",
      title: "Launch our first vessel!",
      outcome: "Completed" as const,
      validAt: 204.94,
      deliveredAt: 204.94,
    };

    await wrapper.saveContractFinish(finish);

    expect(await wrapper.listContractFinishes()).toEqual([finish]);
  });

  it("forwards every public method of the mission history source", () => {
    const own = (type: object) =>
      Object.getOwnPropertyNames(type).filter((name) => name !== "constructor");
    const internal = new Set([
      "pruneToKeepCount",
      "inOrder",
      "getFullHistoryStore",
    ]);
    const wrapped = own(PeerBroadcastingDataSource.prototype);
    const inherited = own(
      Object.getPrototypeOf(PeerBroadcastingDataSource.prototype),
    );

    const missing = own(MissionHistorySource.prototype).filter(
      (name) =>
        !internal.has(name) &&
        !wrapped.includes(name) &&
        !inherited.includes(name),
    );

    expect(missing).toEqual([]);
  });
});
