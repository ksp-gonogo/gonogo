import { type DataKey, registerAugment } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  createTestTelemetryClient,
  render,
  StubTransport,
  screen,
} from "@ksp-gonogo/sitrep-sdk/testing";
import {
  BufferedDataSource,
  clearRegistry,
  MemoryStore,
  MockDataSource,
  registerDataSource,
  registerStockBodies,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-testing";
import { clearAugments, getAugmentsForSlot } from "@ksp-gonogo/ui-kit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScanningComponent, type ScanningSlotContext } from "./index";

/**
 * Scanning augment-slot exposure: SCANsat-OWNED widget exposing slots
 * OTHER Uplinks fill. The slots (`scanning.sections`, `scanning.badges`)
 * are exposed but ship no filler here (that's an Uplink augment): an empty
 * slot must render cleanly, and a test augment registered into it must
 * appear, receiving the widget's body focus as typed slot props.
 */

// `scansat.available`, `vessel.identity`, and `system.bodies` ride the
// native TelemetryClient stream (see Scanning/index.test.tsx's header note);
// only `scansat.scanningVessels`/`scansat.coverage.*`/`scansat.anomalies.*`
// still ride the legacy "data" DataSource.
const KEYS: DataKey[] = [
  { key: "scansat.scanningVessels" },
  { key: "scansat.coverage.Kerbin.2" },
  { key: "scansat.coverage.Kerbin.1" },
  { key: "scansat.coverage.Kerbin.8" },
  { key: "scansat.coverage.Kerbin.16" },
  { key: "scansat.coverage.Kerbin.256" },
  { key: "scansat.anomalies.Kerbin" },
];

const SYSTEM_BODIES = { bodies: [{ index: 1, name: "Kerbin" }] };
const VESSEL_IDENTITY_AT_KERBIN = { parentBodyIndex: 1 };

describe("Scanning: augment slots (spec §4)", () => {
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
    // Wipe any test augment so it never leaks into other suites.
    clearAugments();
  });

  // Drive the widget to the present-SCANsat layout, where both the `badges`
  // header slot and the `sections` coverage slot render. Resolves once the
  // body name has landed: the TelemetryProvider commits transport frames on
  // a rAF, so `vessel.identity`/`system.bodies` resolve a tick after the
  // synchronous act() below, not within it.
  async function renderPresent() {
    const result = render(
      <TelemetryProvider client={client}>
        <ScanningComponent config={{}} id="scanning" />
      </TelemetryProvider>,
    );
    renderedTrees.push(result.unmount);
    act(() => {
      transport.emit("scansat.available", true);
      transport.emit("system.bodies", SYSTEM_BODIES);
      transport.emit("vessel.identity", VESSEL_IDENTITY_AT_KERBIN);
      source.emit("scansat.scanningVessels", []);
    });
    await screen.findByText(/Coverage: Kerbin/);
  }

  it("exposes both slots with no augments bound by default", () => {
    expect(getAugmentsForSlot("scanning.sections")).toEqual([]);
    expect(getAugmentsForSlot("scanning.badges")).toEqual([]);
  });

  it("renders the layout with empty slots inert (stock readout unchanged)", async () => {
    await renderPresent();
    expect(screen.getByText(/Coverage: Kerbin/)).toBeInTheDocument();
    expect(screen.queryByTestId("scan-section-augment")).toBeNull();
    expect(screen.queryByTestId("scan-badge-augment")).toBeNull();
  });

  it("renders a test augment bound to the sections slot, passing the focused body as slot props", async () => {
    function SectionAugment({ bodyName }: ScanningSlotContext) {
      return (
        <div data-testid="scan-section-augment">RESOURCE-SCAN: {bodyName}</div>
      );
    }
    await renderPresent();

    act(() => {
      registerAugment({
        id: "test-scan-section",
        augments: "scanning.sections",
        component: SectionAugment,
      });
    });

    const augment = await screen.findByTestId("scan-section-augment");
    expect(augment.textContent).toBe("RESOURCE-SCAN: Kerbin");
  });

  it("renders a test augment bound to the badges slot in the header", async () => {
    function BadgeAugment({ bodyName }: ScanningSlotContext) {
      return <span data-testid="scan-badge-augment">{bodyName}!</span>;
    }
    await renderPresent();

    act(() => {
      registerAugment({
        id: "test-scan-badge",
        augments: "scanning.badges",
        component: BadgeAugment,
      });
    });

    const badge = await screen.findByTestId("scan-badge-augment");
    expect(badge.textContent).toBe("Kerbin!");
  });
});
