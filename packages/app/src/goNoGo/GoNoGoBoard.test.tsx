import { DashboardItemContext, ScreenProvider } from "@ksp-gonogo/core";
import { act, fireEvent, render, screen } from "@ksp-gonogo/test-utils";
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
  sendToPeer = () => {};
}

const services: GoNoGoHostService[] = [];

function hostWithStations(vote: "go" | "no-go" = "no-go"): GoNoGoHostService {
  const peers = new ScenePeers();
  const service = new GoNoGoHostService(asHostService(peers));
  services.push(service);
  for (const [peerId, name] of [
    ["a", "Flight"],
    ["b", "Booster"],
  ]) {
    peers.fire("connect", peerId);
    peers.fire("info", peerId, { name });
    peers.fire("vote", peerId, vote);
  }
  return service;
}

afterEach(() => {
  for (const service of services.splice(0)) service.dispose();
});

interface BoardOptions {
  vote?: "go" | "no-go";
  config?: { onGo?: string };
  onConfigChange?: (config: { onGo?: string }) => void;
}

function mainBoard(w: number, options: BoardOptions = {}) {
  return render(
    <ScreenProvider value="main">
      <PeerClientProvider client={idlePeerClient()}>
        <GoNoGoHostProvider service={hostWithStations(options.vote)}>
          <DashboardItemContext.Provider value={{ instanceId: "gng" }}>
            <GoNoGoComponent
              id="gng"
              w={w}
              h={8}
              config={options.config}
              onConfigChange={options.onConfigChange}
            />
          </DashboardItemContext.Provider>
        </GoNoGoHostProvider>
      </PeerClientProvider>
    </ScreenProvider>,
  );
}

describe("GO/NO-GO main board", () => {
  it("shows the T-0 action line, defaulting to Stage", () => {
    mainBoard(6);
    expect(screen.getByText("GO / NO-GO")).toBeInTheDocument();
    expect(screen.getByLabelText("On go:")).toHaveValue("Stage");
  });

  it("leaves the T-0 action line out of a tile too narrow to hold it", () => {
    mainBoard(3);
    expect(screen.queryByLabelText("On go:")).toBeNull();
  });

  it("offers Stage first and Nothing last", () => {
    mainBoard(6);
    const labels = screen
      .getAllByRole("option")
      .map((o) => o.textContent ?? "");
    expect(labels[0]).toBe("Stage");
    expect(labels.at(-1)).toBe("Nothing");
  });

  it("saves the choice into the widget's config", () => {
    const saved: Array<{ onGo?: string }> = [];
    mainBoard(6, { onConfigChange: (c) => saved.push(c) });
    fireEvent.change(screen.getByLabelText("On go:"), {
      target: { value: "none" },
    });
    expect(saved).toEqual([{ onGo: "none" }]);
  });

  it("names the action in the countdown banner and locks the choice", () => {
    mainBoard(6, { vote: "go" });
    expect(screen.getByRole("timer")).toHaveTextContent(/^Stage in T −/);
    expect(screen.getByLabelText("On go:")).toBeDisabled();
  });

  it("reads a plain T-minus when nothing is chosen", () => {
    mainBoard(6, { vote: "go", config: { onGo: "none" } });
    expect(screen.getByRole("timer")).toHaveTextContent(/^T −/);
  });

  it("resets the poll from the Reset control, keeping the chosen action", () => {
    const service = hostWithStations("go");
    render(
      <ScreenProvider value="main">
        <PeerClientProvider client={idlePeerClient()}>
          <GoNoGoHostProvider service={service}>
            <DashboardItemContext.Provider value={{ instanceId: "gng" }}>
              <GoNoGoComponent id="gng" w={6} h={8} config={{ onGo: "Gear" }} />
            </DashboardItemContext.Provider>
          </GoNoGoHostProvider>
        </PeerClientProvider>
      </ScreenProvider>,
    );
    expect(service.getSnapshot().countdown).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    const snap = service.getSnapshot();
    expect(snap.countdown).toBeNull();
    expect(snap.stations.every((st) => st.status === null)).toBe(true);
    expect(snap.config.onGo).toBe("Gear");
  });
});

describe("GO/NO-GO station button", () => {
  it("shows what the host fires at T-0, read-only", async () => {
    const client = {
      ...idlePeerClient(),
      onGonogoOnGo: (cb: (label: string | null) => void) => {
        cb("Custom 03");
        return () => {};
      },
    };
    render(
      <ScreenProvider value="station">
        <PeerClientProvider client={client}>
          <DashboardItemContext.Provider value={{ instanceId: "gng" }}>
            <GoNoGoComponent id="gng" w={4} h={4} />
          </DashboardItemContext.Provider>
        </PeerClientProvider>
      </ScreenProvider>,
    );
    expect(await screen.findByText("Custom 03")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("has no Reset control", () => {
    render(
      <ScreenProvider value="station">
        <PeerClientProvider client={idlePeerClient()}>
          <DashboardItemContext.Provider value={{ instanceId: "gng" }}>
            <GoNoGoComponent id="gng" w={6} h={8} />
          </DashboardItemContext.Provider>
        </PeerClientProvider>
      </ScreenProvider>,
    );
    expect(screen.queryByRole("button", { name: /reset/i })).toBeNull();
  });

  it("drops its vote and countdown when the host resets the poll", async () => {
    let reset: (reopened: boolean) => void = () => {};
    const votes: Array<"go" | "no-go" | null> = [];
    const client = {
      ...idlePeerClient(),
      sendGonogoVote: (v: "go" | "no-go" | null) => votes.push(v),
      onGonogoReset: (cb: (reopened: boolean) => void) => {
        reset = cb;
        return () => {};
      },
      onGonogoCountdownStart: (cb: (t0Ms: number) => void) => {
        cb(Date.now() + 30_000);
        return () => {};
      },
    };
    render(
      <ScreenProvider value="station">
        <PeerClientProvider client={client}>
          <DashboardItemContext.Provider value={{ instanceId: "gng" }}>
            <GoNoGoComponent id="gng" w={6} h={8} />
          </DashboardItemContext.Provider>
        </PeerClientProvider>
      </ScreenProvider>,
    );
    fireEvent.click(
      (await screen.findByText("NO-GO")).closest("button") as HTMLElement,
    );
    expect(await screen.findByText("GO")).toBeInTheDocument();
    expect(screen.getByRole("timer")).toBeInTheDocument();
    await act(async () => reset(false));
    expect(await screen.findByText("NO-GO")).toBeInTheDocument();
    expect(screen.queryByRole("timer")).toBeNull();
    expect(votes.at(-1)).toBe("no-go");
  });
});
