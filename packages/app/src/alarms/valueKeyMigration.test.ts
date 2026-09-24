import { describe, expect, it } from "vitest";
import { migrateAlarm } from "./types";

const threshold = (dataKey: string, extra: Record<string, unknown> = {}) => ({
  id: "a1",
  name: "Above the interface",
  state: "pending",
  createdBy: "main",
  createdAt: 0,
  trigger: {
    kind: "threshold",
    dataKey,
    op: ">=",
    value: 70_000,
    ...extra,
  },
});

/**
 * A saved alarm on a key the picker has stopped offering.
 *
 * It still resolves and still fires, so nothing is visibly broken. What it
 * cannot do is be made again, and it compares against a derived copy carrying
 * no reckoning where its wire original carries one.
 */
describe("a persisted threshold alarm's value key", () => {
  it("moves onto the Topic the mod publishes", () => {
    const migrated = migrateAlarm(threshold("vessel.state.altitudeAsl"));
    expect(migrated?.trigger).toMatchObject({
      kind: "threshold",
      dataKey: "vessel.flight.altitudeAsl",
    });
  });

  it("moves the orbital speed the same way", () => {
    const migrated = migrateAlarm(threshold("vessel.state.orbitalSpeed"));
    expect(migrated?.trigger).toMatchObject({
      dataKey: "vessel.flight.orbitalSpeed",
    });
  });

  it("leaves a key that did not move", () => {
    const migrated = migrateAlarm(threshold("vessel.flight.mach"));
    expect(migrated?.trigger).toMatchObject({ dataKey: "vessel.flight.mach" });
  });

  /* `migrateAlarm` runs on every load, so a record that has already been
     through it must come out the same rather than moving a second time. */
  it("is idempotent", () => {
    const once = migrateAlarm(threshold("vessel.state.altitudeAsl"));
    const twice = migrateAlarm(once);
    expect(twice?.trigger).toEqual(once?.trigger);
  });

  /* The SCET arm carries its own address, which was always the wire one, so
     the flat key catching up with it must not disturb it. */
  it("leaves a SCET arm's address alone", () => {
    const migrated = migrateAlarm(
      threshold("vessel.state.altitudeAsl", {
        vantage: "scet",
        topic: "vessel.flight",
        fieldPath: "altitudeAsl",
      }),
    );
    expect(migrated?.trigger).toMatchObject({
      vantage: "scet",
      topic: "vessel.flight",
      fieldPath: "altitudeAsl",
      dataKey: "vessel.flight.altitudeAsl",
    });
  });
});
