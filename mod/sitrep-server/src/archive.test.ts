import { describe, expect, it } from "vitest";
import { Archive, type Sample } from "./archive";

describe("Archive", () => {
  it("readAtVantage returns the latest sample with validAt <= sceneUt (nowUt - delaySeconds)", () => {
    const archive = new Archive();

    archive.record("v.altitude", 100, 0);
    archive.record("v.altitude", 200, 1);
    archive.record("v.altitude", 300, 2);
    archive.record("v.altitude", 400, 3);

    // sceneUt = 5 - 2 = 3 -> latest sample with validAt <= 3 is the validAt-3 sample.
    expect(archive.readAtVantage("v.altitude", "v1", 2, 5)).toEqual({
      value: 400,
      validAt: 3,
      sampleId: 4,
    });
  });

  it("keeps two vantages on the same archive independent, reading different scenes", () => {
    const archive = new Archive();

    archive.record("v.altitude", 100, 0);
    archive.record("v.altitude", 200, 1);
    archive.record("v.altitude", 300, 2);
    archive.record("v.altitude", 400, 3);

    // v1: delay 2, now 5 -> scene 3 -> validAt 3 sample.
    expect(archive.readAtVantage("v.altitude", "v1", 2, 5)).toEqual({
      value: 400,
      validAt: 3,
      sampleId: 4,
    });
    // v2: delay 5, now 5 -> scene 0 -> validAt 0 sample. Independent cursor.
    expect(archive.readAtVantage("v.altitude", "v2", 5, 5)).toEqual({
      value: 100,
      validAt: 0,
      sampleId: 1,
    });
  });

  it("freezes rather than rewinding when delay grows faster than time advances (per vantage cursor)", () => {
    const archive = new Archive();

    archive.record("v.altitude", 100, 0);
    archive.record("v.altitude", 200, 1);
    archive.record("v.altitude", 300, 2);
    archive.record("v.altitude", 400, 3);

    // First read: now=5, delay=2 -> scene=3 -> validAt 3.
    const first = archive.readAtVantage("v.altitude", "v1", 2, 5);
    expect(first).toEqual({ value: 400, validAt: 3, sampleId: 4 });

    // Second read: delay grows to 4 while now only advances to 6 -> naive scene
    // would be 6-4=2, which is BEHIND the previous scene of 3. Freeze: clamp to
    // the last scene (3), so validAt must not decrease.
    const second = archive.readAtVantage("v.altitude", "v1", 4, 6);
    expect(second).toEqual({ value: 400, validAt: 3, sampleId: 4 });

    // Third read: now advances enough to move past the frozen scene again.
    // now=10, delay=4 -> scene=6, clamped scene stays monotonic (>= 3), so we
    // should now see the sample valid at the new scene (still validAt 3, since
    // it's the latest recorded sample <= 6).
    const third = archive.readAtVantage("v.altitude", "v1", 4, 10);
    expect(third).toEqual({ value: 400, validAt: 3, sampleId: 4 });
    expect(third?.validAt).toBeGreaterThanOrEqual(second?.validAt ?? -Infinity);
  });

  it("returns undefined when the clamped scene is before the first recorded sample", () => {
    const archive = new Archive();

    archive.record("v.altitude", 100, 10);

    // now=5, delay=2 -> scene=3, which is before the first sample's validAt (10).
    expect(archive.readAtVantage("v.altitude", "v1", 2, 5)).toBeUndefined();
  });

  it("keys cursors collision-safely across topic and vantage (no naive string concat)", () => {
    const archive = new Archive();

    archive.record("ab", "topic-ab-c", 0);
    archive.record("a", "topic-a-bc", 0);

    // A vantage id "bc" reading topic "a" must not collide with vantage "c" reading topic "ab" even though "ab"+"c" === "a"+"bc" as naive concat.
    const r1 = archive.readAtVantage("ab", "c", 0, 0);
    const r2 = archive.readAtVantage("a", "bc", 0, 0);

    expect(r1).toEqual({ value: "topic-ab-c", validAt: 0, sampleId: 1 });
    expect(r2).toEqual({ value: "topic-a-bc", validAt: 0, sampleId: 2 });
  });

  it("returns undefined for a topic with no recorded samples", () => {
    const archive = new Archive();

    expect(archive.readAtVantage("nonexistent", "v1", 0, 100)).toBeUndefined();
  });

  it("gives every recorded sample its own id, and the same id on every read of it", () => {
    const archive = new Archive();

    archive.record("console.lines", "a", 5);
    archive.record("console.lines", "a", 5);

    const [first, second] = archive.samples("console.lines");
    expect(first?.sampleId).not.toBe(second?.sampleId);
    expect(archive.readAtVantage("console.lines", "v1", 0, 5)?.sampleId).toBe(
      second?.sampleId,
    );
  });

  describe("samples", () => {
    it("returns the per-topic sample list in ascending validAt order", () => {
      const archive = new Archive();

      archive.record("v.altitude", 100, 0);
      archive.record("v.altitude", 200, 1);
      archive.record("v.altitude", 300, 2);

      expect(archive.samples("v.altitude")).toEqual([
        { value: 100, validAt: 0, sampleId: 1 },
        { value: 200, validAt: 1, sampleId: 2 },
        { value: 300, validAt: 2, sampleId: 3 },
      ]);
    });

    it("returns an empty array for a topic with no recorded samples", () => {
      const archive = new Archive();

      expect(archive.samples("nonexistent")).toEqual([]);
    });

    it("returns a copy that does not let callers mutate internal state", () => {
      const archive = new Archive();

      archive.record("v.altitude", 100, 0);

      const list = archive.samples("v.altitude") as Sample[];
      list.push({ value: 999, validAt: 999, sampleId: 999 });
      list[0] = { value: "tampered", validAt: 0, sampleId: 1 };

      expect(archive.samples("v.altitude")).toEqual([
        { value: 100, validAt: 0, sampleId: 1 },
      ]);
    });
  });
});
