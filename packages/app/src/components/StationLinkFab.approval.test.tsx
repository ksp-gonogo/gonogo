import { act, render, screen, within } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { Hub } = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;

  class Emitter {
    private listeners = new Map<string, Listener[]>();
    on(event: string, cb: Listener) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), cb]);
    }
    emit(event: string, ...args: unknown[]) {
      for (const cb of this.listeners.get(event) ?? []) cb(...args);
    }
  }

  class Connection extends Emitter {
    open = true;
    told: unknown[] = [];
    constructor(readonly peer: string) {
      super();
    }
    send(msg: unknown) {
      this.told.push(msg);
    }
    close() {
      this.open = false;
      this.emit("close");
    }
  }

  class Peer extends Emitter {
    static current: Peer | undefined;
    // The broker socket a real Peer carries; the endpoint join signal listens on it.
    socket = { on() {}, off() {}, send(_m: unknown) {} };
    constructor(readonly id: string) {
      super();
      Peer.current = this;
      queueMicrotask(() => this.emit("open", this.id));
    }
    destroy() {}
  }

  return { Hub: { Peer, Connection } };
});

vi.mock("peerjs", () => ({ default: Hub.Peer }));

import { peerHostService } from "../peer/PeerHostService";
import { StationApprovalPrompt } from "../stationApproval/StationApprovalPrompt";
import { StationLinkFab } from "./StationLinkFab";

const stations: InstanceType<typeof Hub.Connection>[] = [];

/** A station joining with the share code, introduced by name and credential. */
async function join(peerId: string, name: string) {
  const peer = Hub.Peer.current;
  if (!peer) throw new Error("host peer not started");
  const conn = new Hub.Connection(peerId);
  stations.push(conn);
  await act(async () => {
    peer.emit("connection", conn);
    conn.emit("open");
    await Promise.resolve();
    conn.emit("data", {
      type: "station-credential",
      credential: `c-${peerId}`,
    });
    conn.emit("data", {
      type: "station-info",
      name,
      stationKey: `key-${peerId}`,
    });
  });
  return conn;
}

afterEach(() => {
  act(() => {
    peerHostService.stop();
  });
  stations.length = 0;
});

describe("Add station panel with a join request waiting", () => {
  it("offers Approve and Refuse inside the dialog, where the modal's overlay cannot cover them", async () => {
    const user = userEvent.setup();
    await act(async () => {
      await peerHostService.start();
    });
    render(
      <ModalProvider>
        <StationApprovalPrompt host={peerHostService} />
        <StationLinkFab />
      </ModalProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Add station" }));
    const flight = await join("p1", "Flight");

    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: /^Approve station Flight/ }),
    );
    expect(peerHostService.pendingStations()).toEqual([]);
    expect(flight.open).toBe(true);

    const capcom = await join("p2", "Capcom");
    await user.click(
      within(dialog).getByRole("button", { name: /^Refuse station Capcom/ }),
    );
    expect(peerHostService.pendingStations()).toEqual([]);
    expect(capcom.open).toBe(false);
  });
});
