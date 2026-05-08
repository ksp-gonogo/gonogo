/**
 * Top-level integration test driving the full mission-control app against
 * a real recorded KSP launch (`test/recorded_fixtures/launch_to_apoapsis_10000.json`).
 *
 * Two passes, sequential because the data-source registry is global and both
 * screens subscribe to id "data":
 *
 *   1. Main screen — render the real `<App/>`, register the recorded flight
 *      as the buffered `"data"` source, walk the replay to chosen flight
 *      moments, and assert the user-visible telemetry (body name, apoapsis,
 *      target text) appears in the dashboard.
 *
 *   2. Station screen — start the real `peerHostService` against an
 *      in-process `peerjs` mock, wire `BufferedDataSource → PeerBroadcastingDataSource`
 *      on the host side, route `?host=<id>` into the `<App/>` so it routes to
 *      `StationScreen`, wait for the real `PeerClientService` to handshake,
 *      add a Current Orbit widget through the real overlay flow, walk the
 *      replay, and assert the same telemetry arrives on the station via
 *      the peer network.
 *
 * Why this shape: the recorded fixture is the closest we can get to "what
 * Telemachus actually emits" without spinning up KSP. The two screens are
 * the load-bearing UX surface; together this exercises the registry, every
 * dashboard widget that has data in the fixture, the orchestrator, and (on
 * the station pass) the full peer transport.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ErrorBoundary,
  formatDistance,
  PerfBudget,
  registerDataSource,
  registerStockBodies,
} from "@gonogo/core";
import "@gonogo/components"; // self-register every built-in widget
// We deliberately do NOT import `../dataSources` here. That module's
// side-effect registers Telemachus + kOS + the production buffered source,
// which would auto-connect to ws://localhost:8085 / the kOS proxy and emit
// a torrent of error noise plus race against our `"data"` override. The
// replay-backed BufferedDataSource we register below is the only data
// source the dashboard widgets need under test.
import {
  BufferedDataSource,
  type FlightFixture,
  FlightReplayDataSource,
  MemoryStore,
} from "@gonogo/data";
import { ModalProvider } from "@gonogo/ui";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Eager-imported so `renderApp` is fully synchronous: nesting an async
// `await import(...)` inside an outer `act(async)` was causing the
// surrounding act window to deadlock waiting on React's scheduler.
import App from "../App";
import { peerHostService } from "../peer/PeerHostService";

// ---------------------------------------------------------------------------
// Mocks — must be hoisted above any code that imports peerjs / xterm.
// ---------------------------------------------------------------------------

// In-process FakePeer registry. Two FakePeers in the same process find each
// other by ID through this Map; `peer.connect(otherId)` looks the remote up
// and pairs DataConnections so messages routed by `send()` land in the other
// peer's `"data"` listener. Closest mock to "real PeerJS" we can get without
// shipping WebRTC into jsdom.
const peerRegistry = vi.hoisted(() => new Map<string, FakePeerCtx>());

interface FakePeerCtx {
  emit: (event: string, ...args: unknown[]) => void;
  destroyed: boolean;
}

vi.mock("peerjs", () => {
  type Listener = (...args: unknown[]) => void;

  class FakeDataConnection {
    peer: string;
    open = false;
    private listeners = new Map<string, Listener[]>();
    private remote: FakeDataConnection | null = null;

    constructor(remotePeerId: string) {
      this.peer = remotePeerId;
    }

    on(event: string, cb: Listener): this {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(cb);
      this.listeners.set(event, bucket);
      return this;
    }

    off(event: string, cb: Listener): this {
      const bucket = this.listeners.get(event);
      if (bucket)
        this.listeners.set(
          event,
          bucket.filter((l) => l !== cb),
        );
      return this;
    }

    emit(event: string, ...args: unknown[]) {
      this.listeners
        .get(event)
        ?.slice()
        .forEach((cb) => {
          cb(...args);
        });
    }

    pair(remote: FakeDataConnection) {
      this.remote = remote;
      remote.remote = this;
    }

    markOpen() {
      this.open = true;
      queueMicrotask(() => this.emit("open"));
    }

    send(data: unknown) {
      if (!this.remote) return;
      // Deep-copy so the receiver can't mutate the sender's object. Use
      // `structuredClone` rather than JSON round-trip: real PeerJS uses
      // BinaryPack and preserves typed arrays, dates, Maps, etc.; JSON
      // would silently drop a `Uint8Array` to `{}`, which broke the
      // fog-snapshot path before this fix.
      const copy = structuredClone(data);
      queueMicrotask(() => this.remote?.emit("data", copy));
    }

    close() {
      if (!this.open) return;
      this.open = false;
      this.emit("close");
      this.remote?.emit("close");
    }
  }

  class FakePeer {
    id: string;
    open = false;
    destroyed = false;
    private listeners = new Map<string, Listener[]>();

    constructor(id?: string) {
      this.id =
        typeof id === "string" && id.length > 0
          ? id
          : `STN-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      peerRegistry.set(this.id, {
        emit: (event, ...args) => this.emit(event, ...args),
        destroyed: false,
      });
      // Match real PeerJS: "open" fires asynchronously after construction.
      queueMicrotask(() => {
        if (this.destroyed) return;
        this.open = true;
        this.emit("open", this.id);
      });
    }

    on(event: string, cb: Listener): this {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(cb);
      this.listeners.set(event, bucket);
      return this;
    }

    off(event: string, cb: Listener): this {
      const bucket = this.listeners.get(event);
      if (bucket)
        this.listeners.set(
          event,
          bucket.filter((l) => l !== cb),
        );
      return this;
    }

    emit(event: string, ...args: unknown[]) {
      this.listeners
        .get(event)
        ?.slice()
        .forEach((cb) => {
          cb(...args);
        });
    }

    connect(otherId: string): FakeDataConnection {
      const localConn = new FakeDataConnection(otherId);
      queueMicrotask(() => {
        const remote = peerRegistry.get(otherId);
        if (!remote || remote.destroyed) {
          localConn.emit("error", new Error(`peer ${otherId} not found`));
          return;
        }
        const remoteConn = new FakeDataConnection(this.id);
        localConn.pair(remoteConn);
        remote.emit("connection", remoteConn);
        // Both ends report "open" after the connection event has been
        // dispatched, mirroring real PeerJS.
        queueMicrotask(() => {
          localConn.markOpen();
          remoteConn.markOpen();
        });
      });
      return localConn;
    }

    destroy() {
      this.destroyed = true;
      const ctx = peerRegistry.get(this.id);
      if (ctx) ctx.destroyed = true;
      peerRegistry.delete(this.id);
    }
  }

  return { default: FakePeer };
});

// xterm needs a canvas DOM that jsdom can't provide. Same stub strategy as
// `KosTerminal/index.test.tsx` — the kos-terminal widget mounts harmlessly
// without an actual terminal.
vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn(function (this: object) {
    Object.assign(this, {
      loadAddon: vi.fn(),
      open: vi.fn(),
      write: vi.fn(),
      writeln: vi.fn(),
      onData: vi.fn(() => ({ dispose: () => {} })),
      onResize: vi.fn(() => ({ dispose: () => {} })),
      resize: vi.fn(),
      dispose: vi.fn(),
      cols: 80,
      rows: 24,
    });
  }),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn(function (this: object) {
    Object.assign(this, {
      fit: vi.fn(),
      proposeDimensions: vi.fn(() => ({ cols: 80, rows: 24 })),
    });
  }),
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

// jsdom omits `indexedDB` and `window.matchMedia`. The fog-snapshot test
// below needs a working IndexedDB so it can read the station's
// FogMaskStore back, so fake-indexeddb is imported (via `auto` at the
// top of the file) instead of the no-op `open()` stub this file used to
// carry — that stub kept the orphan promise pending, which was fine
// when nothing queried the store but blocked observing fog persistence.
// react-grid-layout's "scroll newly added widget into view" effect calls
// `element.scrollIntoView(...)`. jsdom doesn't implement it; stub a no-op
// on the prototype so the dashboard's add-and-scroll flow stays quiet.
if (
  typeof Element !== "undefined" &&
  typeof Element.prototype.scrollIntoView !== "function"
) {
  Element.prototype.scrollIntoView = () => {};
}
if (typeof globalThis.matchMedia === "undefined") {
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
// repo root = packages/app/src/__tests__/ → ../../../..
const repoRoot = resolve(here, "..", "..", "..", "..");
const FIXTURE_PATH = resolve(
  repoRoot,
  "test",
  "recorded_fixtures",
  "launch_to_apoapsis_10000.json",
);

const fixture: FlightFixture = JSON.parse(
  readFileSync(FIXTURE_PATH, "utf8"),
) as FlightFixture;

/**
 * Find the most-recent sample value for `key` at or before `elapsedMs` past
 * launch. Mirrors what `FlightReplayDataSource` would emit at that seek
 * point — used to derive expected widget text from the fixture itself
 * rather than hard-coding numbers.
 */
function valueAt(key: string, elapsedMs: number): unknown {
  const samples = fixture.samples[key];
  if (!samples || samples.length === 0) return undefined;
  const target = fixture.flight.launchedAt + elapsedMs;
  let v: unknown;
  for (const [t, val] of samples) {
    if (t <= target) v = val;
    else break;
  }
  return v;
}

// Two seek points chosen so widgets have meaningfully different values:
//  - T+300s: mid-ascent, ~50 km altitude, suborbital
//  - T+600s: near apoapsis (~100 km), the launch's big payoff
const T_MID = 300_000;
const T_HIGH = 600_000;

// ---------------------------------------------------------------------------
// Render harness — App is the real router (PeerHostProvider on `/`,
// StationScreen on `/station`). Wrapping providers mirror `main.tsx`.
// ---------------------------------------------------------------------------

function renderApp() {
  return render(
    <ErrorBoundary>
      <ModalProvider>
        <App />
      </ModalProvider>
    </ErrorBoundary>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Each test renders the full app, walks the replay through several seek
// points, and adds widgets through the real overlay flow — comfortably
// past the 5s default. Lift the per-test budget so a normal run isn't
// racing the clock under CPU contention from sibling test files.
const TEST_TIMEOUT_MS = 20_000;

describe("recorded launch — full mission control flow", () => {
  let replay: FlightReplayDataSource;
  let buffered: BufferedDataSource;

  beforeEach(() => {
    // Don't `clearRegistry()` — it wipes registered components/themes too,
    // and the @gonogo/components self-registration at module load only
    // runs once. We want the full widget catalogue, so we leave the registry
    // alone and override only the `"data"` source below.
    localStorage.clear();
    peerRegistry.clear();
    globalThis.history.replaceState({}, "", "/");
    registerStockBodies();

    replay = new FlightReplayDataSource({ fixture, id: "data-replay" });
    buffered = new BufferedDataSource({
      source: replay,
      store: new MemoryStore(),
    });
    // BufferedDataSource defaults to id `"data"`. Registering this entry
    // overwrites the production telemachus-backed buffered source from the
    // `../dataSources` import above — Map.set keyed by source.id.
    registerDataSource(buffered);
  });

  afterEach(async () => {
    cleanup();
    buffered.disconnect();
    replay.disconnect();
    // Stop the host between tests so `start()` in the station test gets a
    // fresh peer. Lazy-imported so the main test doesn't pay for it.
    const { peerHostService } = await import("../peer/PeerHostService");
    peerHostService.stop();
    // Walking the entire recording in one `seek()` intentionally bursts
    // the BufferedDataSource sample-rate budget — that's the cost of
    // collapsing a real launch into a few synchronous frames. Same opt-out
    // pattern as `peer-broadcast-benchmark.test.ts`.
    for (const b of PerfBudget.getAll()) b.reset();
  });

  it(
    "main screen — DEMO_CONFIG widgets render fixture telemetry as user seeks the flight",
    async () => {
      const user = userEvent.setup();
      renderApp();
      // PeerHostProvider mounts inside <App/> and immediately starts the
      // broker handshake; the FakePeer fires its "open" event in a
      // microtask, and the resulting setPeerId would land in the
      // await-gap between renderApp and the next assertion if we didn't
      // explicitly wait for the peer to settle here. `waitFor` wraps each
      // polling iteration in act so the eventual setState lands inside a
      // tracked window.
      await waitFor(() => {
        expect(peerHostService.peerId).not.toBeNull();
      });

      // Dashboard mounts with DEMO_CONFIG — Current Orbit's "ORBIT" heading
      // is the cheapest "the orchestrator put the widget on screen" signal.
      await screen.findByRole("heading", { name: /^orbit$/i });
      await screen.findByText(/MAP VIEW/i);

      // Before any seek, replay hasn't emitted samples — Current Orbit shows
      // dashes, MapView its waiting state. We don't assert that here; the
      // payoff is what shows up after we walk the timeline.
      await screen.findByText(/Waiting for telemetry/i);

      // Seek mid-ascent. valueAt() reads the same fixture row replay would
      // emit, so the formatted expectation tracks the recording. Wrap in
      // act() because seek() synchronously fires DataSource subscribers,
      // and the React state updates that follow happen outside any
      // testing-library event handler — the documented pattern for
      // "I'm changing state from outside React's normal event flow."
      act(() => {
        replay.seek(fixture.flight.launchedAt + T_MID);
      });

      // Body name appears in MapView header (and CurrentOrbit reference body).
      expect(valueAt("v.body", T_MID)).toBe("Kerbin");
      await waitFor(() => {
        expect(screen.getAllByText("Kerbin").length).toBeGreaterThan(0);
      });

      // Apoapsis from o.ApA, formatted by the same util the widget uses.
      const apaMid = valueAt("o.ApA", T_MID) as number;
      expect(typeof apaMid).toBe("number");
      await screen.findByText(formatDistance(apaMid));

      // Distance-to-target shows the recorded "No Target Selected." string.
      expect(valueAt("tar.name", T_MID)).toBe("No Target Selected.");
      await screen.findByText(/No Target Selected\./);

      // Seek near apoapsis — apoapsis text should change to the new value.
      act(() => {
        replay.seek(fixture.flight.launchedAt + T_HIGH);
      });

      const apaHigh = valueAt("o.ApA", T_HIGH) as number;
      expect(typeof apaHigh).toBe("number");
      expect(apaHigh).not.toBe(apaMid); // sanity: the seek actually advanced
      await screen.findByText(formatDistance(apaHigh));

      // The user adds three more telemetry widgets through the overlay so
      // the assertions cover a richer slice of what the recording emits —
      // fuel/ΔV, attitude, and thermals all come from different Telemachus
      // buckets and would catch different breakage patterns.
      async function addWidget(query: string, exactName: string) {
        await user.click(
          screen.getByRole("button", { name: /add component/i }),
        );
        const dialog = await screen.findByRole("dialog", {
          name: /add a component/i,
        });
        await user.type(within(dialog).getByPlaceholderText(/search/i), query);
        const heading = await within(dialog).findByText(exactName);
        const card = heading.closest("button");
        if (!card) throw new Error(`${exactName} card has no enclosing button`);
        await user.click(card);
      }

      await addWidget("Fuel", "Fuel & ΔV");

      // Total ΔV: dv.totalDVActual rounded to whole m/s. The widget renders
      // `${value.toFixed(0)} m/s`.
      const totalDvHigh = valueAt("dv.totalDVActual", T_HIGH) as number;
      expect(typeof totalDvHigh).toBe("number");
      await screen.findByText(`${totalDvHigh.toFixed(0)} m/s`);

      // LiquidFuel readout: the widget reads the *stage* scope for LF
      // (`r.resourceCurrent[LiquidFuel]`), not the vessel total. Format is
      // `${formatAmount(value)} / ${formatAmount(max)}` with toFixed(1) for
      // values ≥100.
      const lfValue = valueAt(
        "r.resourceCurrent[LiquidFuel]",
        T_HIGH,
      ) as number;
      const lfMax = valueAt(
        "r.resourceCurrentMax[LiquidFuel]",
        T_HIGH,
      ) as number;
      expect(typeof lfValue).toBe("number");
      expect(typeof lfMax).toBe("number");
      // The readout interpolates value, " / ", and max into separate React
      // text children, so a string matcher can't span them. Match against the
      // element's combined textContent instead.
      const lfReadout = `${lfValue.toFixed(1)} / ${lfMax.toFixed(1)}`;
      await screen.findByText((_content, el) => el?.textContent === lfReadout);

      // Navball: heading is rendered as `${heading.toFixed(0)}°`.
      await addWidget("Navball", "Navball / Attitude Director");
      const heading = valueAt("n.heading", T_HIGH) as number;
      expect(typeof heading).toBe("number");
      await screen.findByText(`${heading.toFixed(0)}°`);

      // Thermal: hottestPartName is shown verbatim, temperature in °C is
      // formatted with one decimal for values |c| < 1000.
      await addWidget("Thermal", "Thermal");
      const hotName = valueAt("therm.hottestPartName", T_HIGH) as string;
      const hotTempC = valueAt("therm.hottestPartTemp", T_HIGH) as number;
      expect(typeof hotName).toBe("string");
      expect(typeof hotTempC).toBe("number");
      await screen.findByText(hotName);
      await screen.findByText(`${hotTempC.toFixed(1)}°C`);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "station screen — receives fixture telemetry over the peer network and renders it in a user-added widget",
    async () => {
      const user = userEvent.setup();

      // 1) Stand up the host harness. We do *not* render `<MainScreen/>` here
      //    — what we care about is that the station's data crosses the peer
      //    network. The host's PBDS bridges buffered samples to broadcasts.
      const { peerHostService } = await import("../peer/PeerHostService");
      const { PeerBroadcastingDataSource } = await import(
        "../peer/PeerBroadcastingDataSource"
      );

      await buffered.connect();
      await peerHostService.start();
      // Wait for the host's FakePeer to emit "open" with its assigned ID.
      const hostId = await new Promise<string>((res) => {
        const unsub = peerHostService.onPeerIdChange((id) => {
          if (id) {
            unsub();
            res(id);
          }
        });
      });
      new PeerBroadcastingDataSource(buffered, peerHostService);

      // 2) Route App to the station and feed the host id via the QR-code
      //    URL param. StationScreen's mount-only effect will read it and
      //    auto-connect.
      globalThis.history.replaceState({}, "", `/station?host=${hostId}`);

      renderApp();

      // 3) Real PeerClientService handshakes with the host through FakePeer.
      //    Once the host's schema arrives, StationScreen flips into the
      //    connected branch and mounts the dashboard. The station's default
      //    config only contains the data-source-status widget — proving the
      //    dashboard rendered means the schema event made it across.
      await screen.findByRole(
        "button",
        { name: /add component/i },
        { timeout: 5000 },
      );

      // 4) User adds a Current Orbit widget through the real overlay flow.
      //    No registry shortcut — same clicks a person would make. Search to
      //    narrow the list to one card so the click target is unambiguous.
      await user.click(screen.getByRole("button", { name: /add component/i }));
      const dialog = await screen.findByRole("dialog", {
        name: /add a component/i,
      });
      const search = within(dialog).getByPlaceholderText(/search/i);
      await user.type(search, "Current Orbit");
      // After filtering, the panel renders one card whose visible heading is
      // "Current Orbit". The card itself is a <button>; click it.
      const cardHeading = await within(dialog).findByText("Current Orbit");
      const card = cardHeading.closest("button");
      if (!card) throw new Error("Current Orbit card has no enclosing button");
      await user.click(card);

      // The widget is now on the station's dashboard. Walk the replay; PBDS
      // broadcasts each new sample over the FakePeer transport, the station's
      // PeerClientDataSource fans it out, and Current Orbit re-renders.
      await screen.findByRole("heading", { name: /^orbit$/i });

      act(() => {
        replay.seek(fixture.flight.launchedAt + T_HIGH);
      });

      const apaHigh = valueAt("o.ApA", T_HIGH) as number;
      expect(typeof apaHigh).toBe("number");
      await screen.findByText(formatDistance(apaHigh), undefined, {
        timeout: 5000,
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "station screen — receives the host's fog snapshot on connect",
    async () => {
      const { peerHostService } = await import("../peer/PeerHostService");
      const { FogMaskStore } = await import("@gonogo/data");
      const { FogSyncHostService } = await import("../fog/FogSyncHostService");

      await peerHostService.start();
      const hostId = await new Promise<string>((res) => {
        const unsub = peerHostService.onPeerIdChange((id) => {
          if (id) {
            unsub();
            res(id);
          }
        });
      });

      // Pre-populate a host-side fog store with one body's mask. We use a
      // unique dbName so the host's pre-population can't be confused with
      // anything the station writes — the assertion below reads from the
      // *default* dbName (what `StationScreen` creates internally), so a
      // hit there proves the snapshot crossed the wire.
      const PROFILE = "fog-test-profile";
      const BODY = "kerbin";
      const data = new Uint8Array([0, 255, 0, 0, 255, 0, 0, 0]);
      const hostFog = new FogMaskStore({ dbName: "fog-test-host" });
      await hostFog.save(PROFILE, BODY, data, 4, 2);

      const fogSync = new FogSyncHostService({
        peerHost: peerHostService,
        fogStore: hostFog,
        getActiveProfileId: () => PROFILE,
      });
      fogSync.start();

      globalThis.history.replaceState({}, "", `/station?host=${hostId}`);
      renderApp();

      // Same gate the previous station test uses — schema arrival flips
      // the connection screen into the dashboard, which mounts the FAB.
      await screen.findByRole(
        "button",
        { name: /add component/i },
        { timeout: 5000 },
      );

      // Read back from a fresh FogMaskStore using the default dbName the
      // StationScreen's internal store uses. The snapshot save() is
      // fire-and-forget on the receive side, so wait for it to land.
      const stationFog = new FogMaskStore();
      await waitFor(
        async () => {
          const mask = await stationFog.load(PROFILE, BODY);
          expect(mask).not.toBeNull();
          expect(Array.from(mask?.data ?? [])).toEqual(Array.from(data));
          expect(mask?.width).toBe(4);
          expect(mask?.height).toBe(2);
        },
        { timeout: 5000 },
      );

      fogSync.stop();
    },
    TEST_TIMEOUT_MS,
  );
});
