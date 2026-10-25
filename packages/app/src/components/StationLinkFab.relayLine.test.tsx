import { act, render, screen, waitFor, within } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http, ws } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { Hub } = vi.hoisted(() => {
  class Peer {
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    constructor(readonly id: string) {
      queueMicrotask(() => this.emit("open", this.id));
    }
    on(event: string, cb: (...args: unknown[]) => void) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), cb]);
    }
    emit(event: string, ...args: unknown[]) {
      for (const cb of this.listeners.get(event) ?? []) cb(...args);
    }
    destroy() {}
  }
  return { Hub: { Peer } };
});

vi.mock("peerjs", () => ({ default: Hub.Peer }));

import { peerHostService } from "../peer/PeerHostService";
import { onSettingsRequested } from "../settings/settingsRequest";
import { StationLinkFab } from "./StationLinkFab";

const stationsSocket = ws.link("ws://localhost:3002/stations");
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => {
  act(() => {
    peerHostService.stop();
  });
  server.resetHandlers();
});
afterAll(() => server.close());

/** A relay whose endpoint is running, reporting `portState` for its own attempt to open the router's port. */
function relayRunning(portState: string | null) {
  server.use(
    stationsSocket.addEventListener("connection", ({ client }) => {
      client.send(
        JSON.stringify({ type: "status", port: 47100, publicIp: null }),
      );
    }),
    http.get("http://localhost:3002/health", () =>
      HttpResponse.json({
        status: "ok",
        ...(portState
          ? { portMapping: { state: portState, message: "router said" } }
          : {}),
      }),
    ),
  );
}

async function openPanel() {
  const user = userEvent.setup();
  await act(async () => {
    await peerHostService.start();
  });
  render(
    <ModalProvider>
      <StationLinkFab />
    </ModalProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Add station" }));
  return { user, dialog: screen.getByRole("dialog") };
}

describe("Add station relay line", () => {
  it("says only this network can join while the relay is not running", async () => {
    const { dialog } = await openPanel();
    expect(
      await within(dialog).findByText(/The relay is not running/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("link", { name: "Networking guide" }),
    ).toBeInTheDocument();
  });

  it("points to the setting rather than explaining it, and opens Settings from it", async () => {
    relayRunning("refused");
    const { user, dialog } = await openPanel();
    const button = await within(dialog).findByRole("button", {
      name: "Automatic port forwarding",
    });
    expect(
      within(dialog).getByText(/Stations on this network can join/),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/router said/)).toBeNull();

    const asked: Array<string | undefined> = [];
    const stop = onSettingsRequested((tab) => asked.push(tab));
    await user.click(button);
    stop();
    expect(asked).toEqual(["general"]);
  });

  it("shows no relay line once the router opened the port", async () => {
    relayRunning("mapped");
    const { dialog } = await openPanel();
    // The panel says the relay is not running until the endpoint reports, then points to the setting until the relay says the port is open.
    await waitFor(() => {
      expect(within(dialog).queryByText(/The relay is not running/)).toBeNull();
      expect(
        within(dialog).queryByText(/Stations on this network can join/),
      ).toBeNull();
    });
    expect(
      within(dialog).queryByRole("button", {
        name: "Automatic port forwarding",
      }),
    ).toBeNull();
  });
});
