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

import { HostRole } from "../hosting/HostRole";
import { registerHostRole } from "../hosting/HostRoleContext";
import { ModApprovalBook } from "../peer/approvalBook";
import { peerHostService } from "../peer/PeerHostService";
import { StationApprovalPrompt } from "../stationApproval/StationApprovalPrompt";
import { FakeHostMod } from "../test/fakeHostMod";
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

describe("Add station panel approved stations", () => {
  it("lists a station approved in the game's record and revokes it there, disconnecting it", async () => {
    const user = userEvent.setup();
    const mod = new FakeHostMod();
    const role = new HostRole("tab-host");
    role.attach(mod.connect());
    await act(async () => {});
    const unregister = registerHostRole(role);
    const detach = peerHostService.attachApprovals(new ModApprovalBook(role));
    await act(async () => {
      await peerHostService.start();
    });
    render(
      <ModalProvider>
        <StationLinkFab />
      </ModalProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Add station" }));
    const flight = await join("p9", "Flight");
    const dialog = screen.getByRole("dialog");
    await user.click(
      await within(dialog).findByRole("button", {
        name: /^Approve station Flight/,
      }),
    );
    /* The approval goes to the game and comes back on its record a few
       microtasks later, re-rendering the open panel. */
    await act(async () => {
      await vi.waitFor(() =>
        expect(
          within(dialog).queryByRole("button", {
            name: "Remove station Flight",
          }),
        ).not.toBeNull(),
      );
    });
    expect(
      within(dialog).getByRole("button", { name: "Remove station Flight" }),
    ).toBeVisible();

    await user.click(
      within(dialog).getByRole("button", { name: "Remove station Flight" }),
    );
    await act(async () => {});
    expect(flight.open).toBe(false);
    expect(mod.record().stations).toEqual([]);
    expect(
      within(dialog).queryByRole("button", { name: "Remove station Flight" }),
    ).toBeNull();
    act(() => {
      detach();
      unregister();
      role.dispose();
    });
  });
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

  it("leaves one Approve on screen while the panel is open, and the banner's returns when it closes", async () => {
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
    await join("p3", "Flight");
    expect(
      screen.getAllByRole("button", { name: /^Approve station Flight/ }),
    ).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Add station" }));
    const buttons = screen.getAllByRole("button", {
      name: /^Approve station Flight/,
    });
    expect(buttons).toHaveLength(1);
    expect(screen.getByRole("dialog")).toContainElement(buttons[0]);

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(
      screen.getAllByRole("button", { name: /^Approve station Flight/ }),
    ).toHaveLength(1);
  });
});
