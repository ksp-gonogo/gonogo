import { ScreenProvider } from "@ksp-gonogo/core";
import { act, fireEvent, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { asHostService } from "../test/peerFakes";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { GoNoGoHostProvider } from "./GoNoGoHostContext";
import { GoNoGoHostService, type Vote } from "./GoNoGoHostService";
import { MainPollHeader } from "./MainPollHeader";
import { PollSettingsControl } from "./PollSettingsControl";
import { pollSettings } from "./pollSettings";

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
  sendToPeer = () => {};
}

const services: GoNoGoHostService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.dispose();
  localStorage.clear();
});

function hostWith(stations: [string, string, Vote][]): GoNoGoHostService {
  const peers = new ScenePeers();
  const service = new GoNoGoHostService(asHostService(peers));
  services.push(service);
  for (const [peerId, name, vote] of stations) {
    peers.fire("connect", peerId);
    peers.fire("info", peerId, { name });
    peers.fire("vote", peerId, vote);
  }
  return service;
}

function mainHeader(service: GoNoGoHostService, scene = "Flight") {
  const fixture = setupStreamFixture({ suspendFrames: true });
  const view = render(
    <ScreenProvider value="main">
      <GoNoGoHostProvider service={service}>
        <fixture.Provider>
          <MainPollHeader />
          <PollSettingsControl />
        </fixture.Provider>
      </GoNoGoHostProvider>
    </ScreenProvider>,
  );
  act(() => fixture.emit("spaceCenter.scene", { scene }));
  return view;
}

const MIXED: [string, string, Vote][] = [
  ["a", "Flight Director", "go"],
  ["b", "Propulsion", "no-go"],
  ["c", "Capcom", null],
];

async function openSettings() {
  fireEvent.click(await screen.findByRole("button", { name: /On go:/ }));
}

describe("GO/NO-GO in the main screen's header", () => {
  it("names every station, coloured by its vote, with nothing for one that has not voted", async () => {
    const { container } = mainHeader(hostWith(MIXED));
    expect(
      await screen.findByLabelText("Flight Director: GO"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Propulsion: NO-GO")).toBeInTheDocument();
    expect(screen.getByLabelText("Capcom")).toHaveTextContent(/^Capcom$/);
    await expectNoA11yViolations(container);
  });

  it("is not drawn outside the flight scene", () => {
    mainHeader(hostWith(MIXED), "SpaceCenter");
    expect(screen.queryByText("Flight Director")).toBeNull();
    expect(screen.queryByRole("button", { name: /On go:/ })).toBeNull();
  });

  it("replaces the stations with the countdown once every station is GO", async () => {
    mainHeader(
      hostWith([
        ["a", "Flight Director", "go"],
        ["b", "Guidance", "go"],
      ]),
    );
    expect(await screen.findByRole("timer")).toHaveTextContent(/^Stage in T −/);
    expect(screen.queryByText("Flight Director")).toBeNull();
  });

  it("reads a plain T-minus when nothing is chosen", async () => {
    pollSettings.update({ onGo: "none" });
    mainHeader(hostWith([["a", "Flight Director", "go"]]));
    expect(await screen.findByRole("timer")).toHaveTextContent(/^T −/);
  });

  it("offers Stage first and Nothing last, and saves the choice", async () => {
    const service = hostWith(MIXED);
    mainHeader(service);
    await openSettings();
    const labels = screen
      .getAllByRole("option")
      .map((o) => o.textContent ?? "");
    expect(labels[0]).toBe("Stage");
    expect(labels.at(-1)).toBe("Nothing");
    fireEvent.change(screen.getByLabelText("On go"), {
      target: { value: "none" },
    });
    expect(pollSettings.get().onGo).toBe("none");
    expect(service.getSnapshot().config.onGoLabel).toBeNull();
    expect(screen.getByRole("button", { name: /On go:/ })).toHaveTextContent(
      "Nothing",
    );
  });

  it("locks the choice while the countdown runs", async () => {
    mainHeader(hostWith([["a", "Flight Director", "go"]]));
    await openSettings();
    expect(screen.getByLabelText("On go")).toBeDisabled();
  });

  it("sets the countdown length", async () => {
    const service = hostWith(MIXED);
    mainHeader(service);
    await openSettings();
    const input = screen.getByLabelText("Countdown length (s)");
    fireEvent.change(input, { target: { value: "20" } });
    fireEvent.blur(input);
    expect(service.getSnapshot().config.countdownLengthMs).toBe(20_000);
  });

  it("resets the poll, keeping the chosen action", async () => {
    pollSettings.update({ onGo: "Gear" });
    const service = hostWith([["a", "Flight Director", "go"]]);
    mainHeader(service);
    await openSettings();
    expect(service.getSnapshot().countdown).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    const snap = service.getSnapshot();
    expect(snap.countdown).toBeNull();
    expect(snap.stations.every((st) => st.status === null)).toBe(true);
    expect(snap.config.onGo).toBe("Gear");
  });

  it("closes the settings on Escape and returns focus to the chip", async () => {
    mainHeader(hostWith(MIXED));
    await openSettings();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByLabelText("On go")).toBeNull();
    expect(screen.getByRole("button", { name: /On go:/ })).toHaveFocus();
  });
});
