import { describe, expect, it } from "vitest";
import type { DashboardItem } from "./index";
import {
  migrateComponentId,
  migrateDashboardItems,
  RENAMED_COMPONENT_IDS,
} from "./layoutNormalization";

const item = (i: string, componentId: string): DashboardItem => ({
  i,
  componentId,
});

describe("component-id migration", () => {
  it("maps a renamed id forward", () => {
    expect(migrateComponentId("mission-director")).toBe("contract-manager");
    expect(migrateComponentId("mission-status")).toBe("objectives");
    expect(migrateComponentId("distance-to-target")).toBe("targeting");
  });

  it("leaves a current id untouched", () => {
    expect(migrateComponentId("fuel-status")).toBe("fuel-status");
  });

  it("rewrites componentId on persisted items, preserving everything else", () => {
    const items: DashboardItem[] = [
      { i: "a", componentId: "mission-director", config: { x: 1 } },
      item("b", "fuel-status"),
    ];
    const migrated = migrateDashboardItems(items);
    expect(migrated[0]?.componentId).toBe("contract-manager");
    expect(migrated[0]?.config).toEqual({ x: 1 });
    expect(migrated[0]?.i).toBe("a");
    expect(migrated[1]).toBe(items[1]); // untouched entries keep identity
  });

  it("returns the same array reference when nothing changed", () => {
    const items = [item("a", "fuel-status")];
    expect(migrateDashboardItems(items)).toBe(items);
  });

  it("never maps an id to itself (would be a pointless/loop entry)", () => {
    for (const [from, to] of Object.entries(RENAMED_COMPONENT_IDS)) {
      expect(from).not.toBe(to);
    }
  });
});

describe("value-key migration", () => {
  /*
   * A saved plot on a key the picker no longer offers. It still resolves, so
   * nothing is visibly broken, and that is the point: left alone it quietly
   * keeps drawing off a derived copy carrying no band while the operator can
   * no longer make the same plot again.
   */
  it("moves a plotted axis and series onto the key the picker offers", () => {
    const items: DashboardItem[] = [
      {
        i: "a",
        componentId: "graph",
        config: {
          xKey: "vessel.state.altitudeAsl",
          windowSec: 300,
          series: [
            { id: "s1", key: "vessel.state.orbitalSpeed", label: "Speed" },
            { id: "s2", key: "vessel.flight.mach", label: "Mach" },
          ],
        },
      },
    ];
    const migrated = migrateDashboardItems(items);

    expect(migrated[0].config).toEqual({
      xKey: "vessel.flight.altitudeAsl",
      windowSec: 300,
      series: [
        { id: "s1", key: "vessel.flight.orbitalSpeed", label: "Speed" },
        { id: "s2", key: "vessel.flight.mach", label: "Mach" },
      ],
    });
  });

  it("hands back the same item when no key moved", () => {
    const items: DashboardItem[] = [
      { i: "a", componentId: "graph", config: { xKey: "$time", series: [] } },
    ];
    expect(migrateDashboardItems(items)[0]).toBe(items[0]);
  });

  /* A config this migration knows nothing about must come through untouched:
     a string that happens to look like a value key is not one. */
  it("leaves a config with no plotted keys alone", () => {
    const items: DashboardItem[] = [
      {
        i: "a",
        componentId: "notes",
        config: { body: "vessel.state.altitudeAsl" },
      },
    ];
    const migrated = migrateDashboardItems(items);
    expect(migrated).toBe(items);
    expect(migrated[0].config).toEqual({ body: "vessel.state.altitudeAsl" });
  });
});
