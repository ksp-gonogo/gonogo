import { act, render, screen, within } from "@ksp-gonogo/test-utils";
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
import { InviteFab } from "./InviteFab";

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

/** A relay whose endpoint is running, with automatic port forwarding `enabled` and its router attempt in `portState`. */
function relayRunning(portState: string | null, enabled = portState !== null) {
  server.use(
    http.get("http://localhost:3002/bootstrap-config", () =>
      HttpResponse.json({ kspHost: null, stationEndpoint: true }),
    ),
    stationsSocket.addEventListener("connection", ({ client }) => {
      client.send(
        JSON.stringify({ type: "status", port: 47100, publicIp: null }),
      );
    }),
    http.get("http://localhost:3002/port-forward", () =>
      HttpResponse.json({
        enabled,
        portMapping: portState
          ? { state: portState, message: `router said ${portState}.` }
          : null,
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
      <InviteFab />
    </ModalProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Invite" }));
  return { user, dialog: screen.getByRole("dialog") };
}

describe("Invite relay line", () => {
  it("says only this network can join while the relay is not running", async () => {
    const { dialog } = await openPanel();
    expect(
      await within(dialog).findByText(/The relay is not running/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("link", { name: "Networking guide" }),
    ).toBeInTheDocument();
  });

  it("says another main screen is serving stations when the relay turns this one away", async () => {
    server.use(
      http.get("http://localhost:3002/bootstrap-config", () =>
        HttpResponse.json({ kspHost: null, stationEndpoint: true }),
      ),
      stationsSocket.addEventListener("connection", ({ client }) => {
        client.send(JSON.stringify({ type: "busy" }));
      }),
    );
    const { dialog } = await openPanel();
    expect(
      await within(dialog).findByText(
        "Another main screen is serving stations. Close it and this one takes over.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/The relay is not running/)).toBeNull();
  });

  it("says forwarding is off, and opens Settings from the setting's name", async () => {
    relayRunning(null, false);
    const { user, dialog } = await openPanel();
    const button = await within(dialog).findByRole("button", {
      name: "Automatic port forwarding",
    });
    expect(
      within(dialog).getByText(/Stations on this network can join/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/is off/)).toBeInTheDocument();

    const asked: Array<string | undefined> = [];
    const stop = onSettingsRequested((tab) => asked.push(tab));
    await user.click(button);
    stop();
    expect(asked).toEqual(["general"]);
  });

  it("says forwarding is on but not working, with the router's answer", async () => {
    relayRunning("refused");
    const { dialog } = await openPanel();
    expect(
      await within(dialog).findByText(
        /is on but not working: router said refused\./,
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByText(/Stations on this network can join/),
    ).toBeNull();
  });

  it("says the router opened the port once it did", async () => {
    relayRunning("mapped");
    const { dialog } = await openPanel();
    expect(
      await within(dialog).findByText(/is on: router said mapped\./),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByText(/Stations on this network can join/),
    ).toBeNull();
  });
});
