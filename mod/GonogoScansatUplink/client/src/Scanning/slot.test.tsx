import {
  clearAugments,
  clearRegistry,
  getAugmentsForSlot,
  MockDataSource,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { BufferedDataSource, MemoryStore } from "@ksp-gonogo/data";
import {
  type DataKey,
  registerAugment,
  registerDataSource,
} from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScanningComponent, type ScanningSlotContext } from "./index";

/**
 * Scanning augment-slot exposure — SCANsat-OWNED widget exposing slots
 * OTHER Uplinks fill. The slots (`scanning.sections`, `scanning.badges`)
 * are exposed but ship no filler here (that's an Uplink augment): an empty
 * slot must render cleanly, and a test augment registered into it must
 * appear, receiving the widget's body focus as typed slot props.
 */

const KEYS: DataKey[] = [
  { key: "scansat.available" },
  { key: "scansat.scanningVessels" },
  { key: "v.body" },
  { key: "v.biome" },
  { key: "scansat.coverage.Kerbin.2" },
  { key: "scansat.coverage.Kerbin.1" },
  { key: "scansat.coverage.Kerbin.8" },
  { key: "scansat.coverage.Kerbin.16" },
  { key: "scansat.coverage.Kerbin.256" },
  { key: "scansat.anomalies.Kerbin" },
];

describe("Scanning — augment slots (spec §4)", () => {
  let source: MockDataSource;
  let buffered: BufferedDataSource;

  // Rendered trees, tracked so afterEach can unmount them BEFORE disconnecting
  // the buffered source. RTL auto-cleanup runs after this file's afterEach, so
  // it can't be relied on to unmount first — disconnecting a live source while
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
  });

  afterEach(() => {
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
    buffered.disconnect();
    // Wipe any test augment so it never leaks into other suites.
    clearAugments();
  });

  // Drive the widget to the present-SCANsat layout, where both the `badges`
  // header slot and the `sections` coverage slot render.
  function renderPresent() {
    const result = render(<ScanningComponent config={{}} id="scanning" />);
    renderedTrees.push(result.unmount);
    act(() => {
      source.emit("scansat.available", true);
      source.emit("v.body", "Kerbin");
      source.emit("scansat.scanningVessels", []);
    });
  }

  it("exposes both slots with no augments bound by default", () => {
    expect(getAugmentsForSlot("scanning.sections")).toEqual([]);
    expect(getAugmentsForSlot("scanning.badges")).toEqual([]);
  });

  it("renders the layout with empty slots inert (stock readout unchanged)", () => {
    renderPresent();
    expect(screen.getByText(/Coverage — Kerbin/)).toBeInTheDocument();
    expect(screen.queryByTestId("scan-section-augment")).toBeNull();
    expect(screen.queryByTestId("scan-badge-augment")).toBeNull();
  });

  it("renders a test augment bound to the sections slot, passing the focused body as slot props", async () => {
    function SectionAugment({ bodyName }: ScanningSlotContext) {
      return (
        <div data-testid="scan-section-augment">RESOURCE-SCAN: {bodyName}</div>
      );
    }
    renderPresent();

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
    renderPresent();

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
