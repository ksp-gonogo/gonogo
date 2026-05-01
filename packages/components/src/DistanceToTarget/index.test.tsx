import type { DataKey, MockDataSource } from "@gonogo/core";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { DistanceToTargetComponent } from "./index";

const KEYS: DataKey[] = [
  { key: "v.name" },
  { key: "v.missionTime" },
  { key: "comm.connected" },
  { key: "tar.name" },
  { key: "tar.type" },
  { key: "tar.distance" },
  { key: "tar.o.relativeVelocity" },
  { key: "o.closestTgtApprUT" },
  { key: "t.universalTime" },
  { key: "dock.ax" },
  { key: "dock.ay" },
  { key: "dock.az" },
  { key: "dock.x" },
  { key: "dock.y" },
];

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
      source.emit("tar.distance", 47_000_000);
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
      source.emit("tar.distance", 90);
      source.emit("dock.ax", 1.2);
      source.emit("dock.ay", -0.5);
      source.emit("tar.o.relativeVelocity", -0.8);
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
      source.emit("tar.distance", 50);
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
      source.emit("tar.distance", 50);
    });
    expect(screen.queryByRole("region", { name: /Docking HUD/ })).toBeNull();
  });

  it("applies hysteresis — stays in HUD until distance rises past 150 m", () => {
    render(<DistanceToTargetComponent config={{}} id="tar" />);
    act(() => {
      prime(source);
      source.emit("tar.name", "Test Station");
      source.emit("tar.type", "Vessel");
      source.emit("tar.distance", 80);
    });
    expect(
      screen.getByRole("region", { name: /Docking HUD/ }),
    ).toBeInTheDocument();

    act(() => {
      source.emit("tar.distance", 130);
    });
    expect(
      screen.getByRole("region", { name: /Docking HUD/ }),
    ).toBeInTheDocument();

    act(() => {
      source.emit("tar.distance", 200);
    });
    expect(screen.queryByRole("region", { name: /Docking HUD/ })).toBeNull();
  });

  it("switches to approach mode for Vessel targets between 100 m and 5 km", () => {
    render(<DistanceToTargetComponent config={{}} id="tar" />);
    act(() => {
      prime(source);
      source.emit("tar.name", "Test Station");
      source.emit("tar.type", "Vessel");
      source.emit("tar.distance", 1_500);
      source.emit("tar.o.relativeVelocity", -3.4);
    });
    expect(screen.getByText("APPROACH")).toBeInTheDocument();
    expect(screen.getByText("Test Station")).toBeInTheDocument();
    expect(screen.getByText("Closing rate")).toBeInTheDocument();
    // Closing → negative relVel → minus-sign + magnitude
    expect(screen.getByText(/−3\.4 m\/s/)).toBeInTheDocument();
  });

  it("renders TCA when closestTgtApprUT and universalTime are both available", () => {
    render(<DistanceToTargetComponent config={{}} id="tar" />);
    act(() => {
      prime(source);
      source.emit("tar.name", "Test Station");
      source.emit("tar.type", "Vessel");
      source.emit("tar.distance", 2_000);
      source.emit("t.universalTime", 1_000);
      source.emit("o.closestTgtApprUT", 1_125); // 125 s in future = T−02:05
    });
    expect(screen.getByText(/T−02:05/)).toBeInTheDocument();
  });

  it("never enters approach mode for CelestialBody targets even at close range", () => {
    render(<DistanceToTargetComponent config={{}} id="tar" />);
    act(() => {
      prime(source);
      source.emit("tar.name", "Mun");
      source.emit("tar.type", "CelestialBody");
      source.emit("tar.distance", 1_500);
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
      source.emit("tar.distance", 50_000);
    });
    expect(screen.getByText("TARGET")).toBeInTheDocument();

    act(() => {
      source.emit("tar.distance", 2_000);
    });
    expect(screen.getByText("APPROACH")).toBeInTheDocument();

    act(() => {
      source.emit("tar.distance", 80);
    });
    expect(
      screen.getByRole("region", { name: /Docking HUD/ }),
    ).toBeInTheDocument();
  });
});
