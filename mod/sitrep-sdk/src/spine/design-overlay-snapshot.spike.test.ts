import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../testing";

/*
 * Spike evidence for the design overlay: a snapshot Topic (the craft, stamped
 * once at its last edit) beside a series Topic (the predicted flight, stamped
 * at launchUt + t). Reported as the reading state at several cursor positions.
 */
const LAUNCH = 1_000_000;

function stateAt(cursor: number, snapshotAt: number) {
  const f = setupStreamFixture({ pinnedUt: LAUNCH + cursor });
  f.client.attachStore(f.store);
  f.subscribe("vessel.structure");
  f.subscribe("vessel.flight");
  f.emit(
    "vessel.structure",
    { currentStage: 5, partCount: 8 },
    {
      validAt: snapshotAt,
      deliveredAt: snapshotAt,
    },
  );
  for (let t = 0; t <= 430; t += 0.5) {
    f.emit(
      "vessel.flight",
      { altitudeAsl: t * 100 },
      { validAt: LAUNCH + t, deliveredAt: LAUNCH + t },
    );
  }
  f.store.beginFrame();
  const snap = f.store.sampleReading(
    "vessel.structure",
    f.store.currentFrame(),
  );
  const series = f.store.sampleReading("vessel.flight", f.store.currentFrame());
  return { snapshot: snap.state, series: series.state };
}

describe("design overlay: a snapshot under a moving cursor", () => {
  for (const cursor of [0, 40, 430]) {
    it(`cursor T+${cursor}`, () => {
      const r = stateAt(cursor, LAUNCH - 1);
      console.info("SNAPSHOT", cursor, JSON.stringify(r));
      expect(r.series).toBe("observed");
    });
    it(`cursor T+${cursor}, snapshot stamped at the cursor`, () => {
      const r = stateAt(cursor, LAUNCH + cursor);
      console.info("RESTAMPED", cursor, JSON.stringify(r));
      expect(r.series).toBe("observed");
    });
  }
});
