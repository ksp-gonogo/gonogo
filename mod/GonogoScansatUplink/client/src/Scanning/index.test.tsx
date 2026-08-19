import type { DataKey } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/sitrep-sdk/testing";
import {
  BufferedDataSource,
  clearRegistry,
  createTestTelemetryClient,
  MemoryStore,
  MockDataSource,
  registerDataSource,
  registerStockBodies,
  StubTransport,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-testing";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { ScanningComponent } from "./index";

// `scansat.available`, `vessel.identity`, `system.bodies`, and
// `vessel.surface` (body name + biome) all ride the native TelemetryClient
// stream now (this task migrated the widget off the
// `v.body`/`v.biome`/`scansat.available` two-arg shim).
//
// `scansat.coverage.<body>.<type>` and `scansat.anomalies.<body>` (still
// read via the legacy two-arg `useTelemetry("data", key)` shim inside
// `useScanLayers.ts`, untouched by this migration) turn out to ALSO ride
// the stream the moment any `TelemetryProvider` is mounted:
// `DYNAMIC_CARRIED_TOPIC_PREFIXES` (`@ksp-gonogo/sitrep-client`'s
// `default-carried-topics.ts`) unconditionally folds in the
// `scansat.coverage.`/`scansat.anomalies.` prefixes, so `mapTopic` resolves
// them AND the carried-channels gate passes regardless of what
// `carriedChannels` prop (if any) this test's `TelemetryProvider` is given.
// Emitting those two families on the legacy `MockDataSource` here would
// silently never reach the widget once a provider is mounted: they must go
// over `transport.emit`, matching production. `scansat.scanningVessels` is
// the one family that ISN'T in that carried set (only a literal-string
// member of the app's `DEFAULT_SITREP_CARRIED_TOPICS`, which this bare
// `TelemetryProvider` doesn't apply), so it genuinely stays on the legacy
// "data" source here.
const KEYS: DataKey[] = [{ key: "scansat.scanningVessels" }];

/** `system.bodies` fixture carrying just the one body the tests need. */
const SYSTEM_BODIES = { bodies: [{ index: 1, name: "Kerbin" }] };
/** `vessel.identity` fixture: active vessel orbiting/landed at Kerbin (index 1). */
const VESSEL_IDENTITY_AT_KERBIN = { parentBodyIndex: 1 };

describe("ScanningComponent", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;
  let transport: StubTransport;
  let client: TelemetryClient;

  // Rendered trees, tracked so afterEach can unmount them BEFORE disconnecting
  // the buffered source. RTL auto-cleanup runs after this file's afterEach, so
  // it can't be relied on to unmount first, disconnecting a live source while
  // the widget is still mounted fires a status change into it, a state update
  // outside act() (the documented anti-pattern in CLAUDE.md).
  const renderedTrees: Array<() => void> = [];

  function renderScanning(ui: ReactElement) {
    const result = render(
      <TelemetryProvider client={client}>{ui}</TelemetryProvider>,
    );
    renderedTrees.push(result.unmount);
    return result;
  }

  beforeEach(async () => {
    clearRegistry();
    registerStockBodies();
    source = new MockDataSource({ keys: KEYS });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();
    transport = new StubTransport();
    client = createTestTelemetryClient(transport);
  });

  afterEach(() => {
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
    buffered.disconnect();
  });

  it("shows the empty state when SCANsat is not installed", async () => {
    renderScanning(<ScanningComponent config={{}} id="scanning" />);
    act(() => {
      transport.emit("scansat.available", false);
    });
    await screen.findByText(/SCANsat is not installed/i);
  });

  it("renders the coverage / vessels / anomalies layout when SCANsat is present", async () => {
    renderScanning(<ScanningComponent config={{}} id="scanning" />);
    act(() => {
      transport.emit("scansat.available", true);
      transport.emit("system.bodies", SYSTEM_BODIES);
      transport.emit("vessel.identity", VESSEL_IDENTITY_AT_KERBIN);
      source.emit("scansat.scanningVessels", []);
    });
    await screen.findByText(/Coverage: Kerbin/);
    expect(screen.getByText(/Scanning vessels/)).toBeInTheDocument();
    expect(
      screen.getByText(/No vessels tracked by SCANsat yet/),
    ).toBeInTheDocument();
  });

  it("renders coverage percentages for each scan type when values are emitted", async () => {
    renderScanning(<ScanningComponent config={{}} id="scanning" />);
    act(() => {
      transport.emit("scansat.available", true);
      transport.emit("system.bodies", SYSTEM_BODIES);
      transport.emit("vessel.identity", VESSEL_IDENTITY_AT_KERBIN);
      source.emit("scansat.scanningVessels", []);
    });
    await screen.findByText(/Coverage: Kerbin/);
    act(() => {
      // `scansat.coverage.<body>.<type>` rides the stream (see header note):
      // once the per-body coverage rows mount, wait for their subscribe then
      // emit over `transport`, not `source`.
      // Distinct non-zero values for each of the 5 DISPLAY_SCAN_TYPES
      transport.emit("scansat.coverage.Kerbin.2", 12.3); // AltimetryHiRes
      transport.emit("scansat.coverage.Kerbin.1", 34.5); // AltimetryLoRes
      transport.emit("scansat.coverage.Kerbin.8", 56.7); // Biome
      transport.emit("scansat.coverage.Kerbin.16", 78.9); // Anomaly
      transport.emit("scansat.coverage.Kerbin.256", 91.0); // ResourceHiRes
    });
    // `visibleText`, not `findByText`: these render through <Unit>, which puts
    // the number and its symbol in separate elements with a thin space
    // between, so no single node holds "12.3 %".
    await waitFor(() => expect(visibleText()).toContain("12.3 %"));
    expect(visibleText()).toContain("34.5 %");
    expect(visibleText()).toContain("56.7 %");
    expect(visibleText()).toContain("78.9 %");
    expect(visibleText()).toContain("91.0 %");
  });

  it("renders anomaly names according to discovery state", async () => {
    renderScanning(<ScanningComponent config={{}} id="scanning" />);
    act(() => {
      transport.emit("scansat.available", true);
      transport.emit("system.bodies", SYSTEM_BODIES);
      transport.emit("vessel.identity", VESSEL_IDENTITY_AT_KERBIN);
      source.emit("scansat.scanningVessels", []);
    });
    await screen.findByText(/Coverage: Kerbin/);
    act(() => {
      // `scansat.anomalies.<body>` rides the stream too (see header note).
      transport.emit("scansat.anomalies.Kerbin", [
        // detail=true → show the name
        {
          name: "Monolith One",
          latitude: 10.5,
          longitude: 20.5,
          known: true,
          detail: true,
        },
        // known=true, detail=false → "(unknown)"
        {
          name: "Hidden Site",
          latitude: 30.5,
          longitude: 40.5,
          known: true,
          detail: false,
        },
        // known=false, detail=false → "(undetected)"
        {
          name: "Mystery Spot",
          latitude: 50.5,
          longitude: 60.5,
          known: false,
          detail: false,
        },
      ]);
    });
    await screen.findByText("Monolith One");
    expect(screen.getByText("(unknown)")).toBeInTheDocument();
    expect(screen.getByText("(undetected)")).toBeInTheDocument();
  });

  it("renders the biome readout from vessel.surface once the vessel is on a body", async () => {
    renderScanning(<ScanningComponent config={{}} id="scanning" />);
    act(() => {
      transport.emit("scansat.available", true);
      transport.emit("system.bodies", SYSTEM_BODIES);
      transport.emit("vessel.identity", VESSEL_IDENTITY_AT_KERBIN);
      transport.emit("vessel.surface", { biome: "Highlands" });
      source.emit("scansat.scanningVessels", []);
    });
    await waitFor(() =>
      expect(screen.getByText(/Biome: Highlands/)).toBeInTheDocument(),
    );
  });

  it("passes an a11y smoke when SCANsat is unavailable", async () => {
    const { container } = renderScanning(
      <ScanningComponent config={{}} id="scanning" />,
    );
    act(() => {
      transport.emit("scansat.available", false);
    });
    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
