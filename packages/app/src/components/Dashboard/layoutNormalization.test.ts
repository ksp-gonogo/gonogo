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
