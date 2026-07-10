import type { DataKey, MockDataSource } from "@gonogo/core";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { DistanceToTargetComponent } from "./index";

/**
 * Mode-transition + docking-gate behavior, exercised through the legacy
 * `DataSource` fallback path (no `TelemetryProvider` mounted). Post-R6 the
 * widget derives distance / closing rate / docking angles client-side from
 * `vessel.target`/`vessel.dock`'s Vec3 fields, so these tests feed those Vec3
 * reads directly — the widget's `tarDistance` (which drives every mode switch)
 * is `|tar.relativePosition|`. The live TCA readout, which needs the SDK
 * view-UT (`useViewUt`, provider-only), is covered in `stream.test.tsx`.
 */
const KEYS: DataKey[] = [
  { key: "v.name" },
  { key: "v.missionTime" },
  { key: "comm.connected" },
  { key: "tar.name" },
  { key: "tar.type" },
  { key: "tar.relativePosition" },
  { key: "tar.relativeVelocityVec" },
  { key: "dock.relativePosition" },
  { key: "dock.relativeVelocityVec" },
  { key: "dock.distanceScalar" },
  { key: "dock.forwardDot" },
  { key: "o.closestTgtApprUT" },
];

/** Vec3 purely along z, so `|relativePosition|` (the mode driver) === `d`. */
function atRange(d: number) {
  return { x: 0, y: 0, z: d };
}

function prime(source: MockDataSource): void {
  source.emit("comm.connected", true);
  source.emit("v.name", "Test");
  source.emit("v.missionTime", 0);
}

describe("DistanceToTargetComponent", () => {
  let fixture: MockDataSourceFixture;
  let source: MockDataSource;

  beforeEach(async () => {
    fixture = await setupMockDataSource({
      keys: KEYS,
      affectedBySignalLoss: true,
    });
    source = fixture.source;
  });

  afterEach(() => {
    teardownMockDataSource(fixture);
  });

  it("shows a 'no target set' hint until tar.name is reported", () => {
    const { container } = render(
      <DistanceToTargetComponent config={{}} id="tar" />,
    );
    expect(container.textContent).toContain("No target set in KSP");
  });

  it("renders compact-mode distance once target name + distance arrive", () => {
    const { container } = render(
      <DistanceToTargetComponent config={{}} id="tar" />,
    );
    act(() => {
      prime(source);
      source.emit("tar.name", "Minmus");
      source.emit("tar.type", "CelestialBody");
      source.emit("tar.relativePosition", atRange(47_000_000));
    });
    expect(container.textContent).toContain("Minmus");
    expect(container.textContent).toMatch(/\d[\d.]*\s*(k?m|Mm)/);
  });

  it("auto-switches to the docking HUD when a Vessel target drops under 100 m", () => {
    render(<DistanceToTargetComponent config={{}} id="tar" />);
    act(() => {
      prime(source);
      source.emit("tar.name", "Test Station");
      source.emit("tar.type", "Vessel");
      source.emit("tar.relativePosition", atRange(90));
      source.emit("tar.relativeVelocityVec", atRange(-0.8));
    });
    expect(
      screen.getByRole("region", { name: /Docking HUD for Test Station/ }),
    ).toBeInTheDocument();
  });

  it("never HUD-switches on CelestialBody targets", () => {
    render(<DistanceToTargetComponent config={{}} id="tar" />);
    act(() => {
      prime(source);
      source.emit("tar.name", "Mun");
      source.emit("tar.type", "CelestialBody");
      source.emit("tar.relativePosition", atRange(50));
    });
    expect(screen.queryByRole("region", { name: /Docking HUD/ })).toBeNull();
    expect(screen.getByText("Mun")).toBeInTheDocument();
  });

  it("honours autoSwitch=false", () => {
    render(
      <DistanceToTargetComponent config={{ autoSwitch: false }} id="tar" />,
    );
    act(() => {
      prime(source);
      source.emit("tar.name", "Test Station");
      source.emit("tar.type", "Vessel");
      source.emit("tar.relativePosition", atRange(50));
    });
    expect(screen.queryByRole("region", { name: /Docking HUD/ })).toBeNull();
  });

  it("applies hysteresis — stays in HUD until distance rises past 150 m", () => {
    render(<DistanceToTargetComponent config={{}} id="tar" />);
    act(() => {
      prime(source);
      source.emit("tar.name", "Test Station");
      source.emit("tar.type", "Vessel");
      source.emit("tar.relativePosition", atRange(80));
    });
    expect(
      screen.getByRole("region", { name: /Docking HUD/ }),
    ).toBeInTheDocument();

    act(() => {
      source.emit("tar.relativePosition", atRange(130));
    });
    expect(
      screen.getByRole("region", { name: /Docking HUD/ }),
    ).toBeInTheDocument();

    act(() => {
      source.emit("tar.relativePosition", atRange(200));
    });
    expect(screen.queryByRole("region", { name: /Docking HUD/ })).toBeNull();
  });

  it("switches to approach mode for Vessel targets between 100 m and 5 km", () => {
    render(<DistanceToTargetComponent config={{}} id="tar" />);
    act(() => {
      prime(source);
      source.emit("tar.name", "Test Station");
      source.emit("tar.type", "Vessel");
      source.emit("tar.relativePosition", atRange(1_500));
      source.emit("tar.relativeVelocityVec", atRange(-3.4));
    });
    expect(screen.getByText("APPROACH")).toBeInTheDocument();
    expect(screen.getByText("Test Station")).toBeInTheDocument();
    expect(screen.getByText("Closing rate")).toBeInTheDocument();
    // Closing → negative radial rate → minus-sign + magnitude
    expect(screen.getByText(/−3\.4 m\/s/)).toBeInTheDocument();
  });

  it("never enters approach mode for CelestialBody targets even at close range", () => {
    render(<DistanceToTargetComponent config={{}} id="tar" />);
    act(() => {
      prime(source);
      source.emit("tar.name", "Mun");
      source.emit("tar.type", "CelestialBody");
      source.emit("tar.relativePosition", atRange(1_500));
    });
    expect(screen.queryByText("APPROACH")).toBeNull();
    expect(screen.getByText("Mun")).toBeInTheDocument();
  });

  it("steps through tracking → approach → docking-hud as a vessel closes", () => {
    render(<DistanceToTargetComponent config={{}} id="tar" />);
    act(() => {
      prime(source);
      source.emit("tar.name", "Test Station");
      source.emit("tar.type", "Vessel");
      source.emit("tar.relativePosition", atRange(50_000));
    });
    expect(screen.getByText("TARGET")).toBeInTheDocument();

    act(() => {
      source.emit("tar.relativePosition", atRange(2_000));
    });
    expect(screen.getByText("APPROACH")).toBeInTheDocument();

    act(() => {
      source.emit("tar.relativePosition", atRange(80));
    });
    expect(
      screen.getByRole("region", { name: /Docking HUD/ }),
    ).toBeInTheDocument();
  });
});
