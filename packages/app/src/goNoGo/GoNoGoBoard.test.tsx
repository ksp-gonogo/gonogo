import { DashboardItemContext, ScreenProvider } from "@ksp-gonogo/core";
import { render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { PeerClientProvider } from "../peer/PeerClientContext";
import { asHostService, idlePeerClient } from "../test/peerFakes";
import { GoNoGoComponent } from "./GoNoGoComponent";
import { GoNoGoHostProvider } from "./GoNoGoHostContext";
import { GoNoGoHostService } from "./GoNoGoHostService";

type Listener = (...args: unknown[]) => void;

/** A peer host that hands the vote aggregator the stations the test tells it about. */
class ScenePeers {
  private listeners = new Map<string, Set<Listener>>();

  private on(event: string, cb: Listener): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(cb);
    this.listeners.set(event, set);
    return () => set.delete(cb);
  }

  fire(event: string, ...args: unknown[]): void {
    for (const cb of this.listeners.get(event) ?? []) cb(...args);
  }

  onPeerConnect = (cb: Listener) => this.on("connect", cb);
  onPeerDisconnect = (cb: Listener) => this.on("disconnect", cb);
  onStationInfo = (cb: Listener) => this.on("info", cb);
  onGonogoVote = (cb: Listener) => this.on("vote", cb);
  onGonogoAbort = (cb: Listener) => this.on("abort", cb);
  broadcast = () => {};
}

const services: GoNoGoHostService[] = [];

function hostWithStations(): GoNoGoHostService {
  const peers = new ScenePeers();
  const service = new GoNoGoHostService(asHostService(peers));
  services.push(service);
  for (const [peerId, name] of [
    ["a", "Flight"],
    ["b", "Booster"],
  ]) {
    peers.fire("connect", peerId);
    peers.fire("info", peerId, { name });
    peers.fire("vote", peerId, "no-go");
  }
  return service;
}

afterEach(() => {
  for (const service of services.splice(0)) service.dispose();
});

function mainBoard(w: number) {
  return render(
    <ScreenProvider value="main">
      <PeerClientProvider client={idlePeerClient()}>
        <GoNoGoHostProvider service={hostWithStations()}>
          <DashboardItemContext.Provider value={{ instanceId: "gng" }}>
            <GoNoGoComponent id="gng" w={w} h={8} />
          </DashboardItemContext.Provider>
        </GoNoGoHostProvider>
      </PeerClientProvider>
    </ScreenProvider>,
  );
}

describe("GO/NO-GO main board", () => {
  it("leaves the auto-stage chip out of a tile too narrow to hold it beside the title", () => {
    mainBoard(6);
    expect(screen.getByText("GO / NO-GO")).toBeInTheDocument();
    expect(screen.queryByText("AUTO STAGE AT T-0")).toBeNull();
  });

  it("shows the auto-stage chip once the tile can hold it", () => {
    mainBoard(8);
    expect(screen.getByText("AUTO STAGE AT T-0")).toBeInTheDocument();
  });
});
