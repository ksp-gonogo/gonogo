import { findReading, type TopicPayload, value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { makeMeta } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

type Stages = TopicPayload<"dv.stages">;

function storeWith(stages: Stages): TimelineStore {
  const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
  clock.scrubTo(20);
  const store = new TimelineStore(clock);
  store.beginFrame();
  store.ingest("dv.stages", {
    validAt: 10,
    payload: stages,
    meta: makeMeta({ validAt: 10, deliveredAt: 10 }),
    epoch: 0,
  });
  store.beginFrame();
  return store;
}

const STAGES = [
  { stage: 2, dvVac: value("m/s", 900) },
  { stage: 1, dvVac: value("m/s", 3100) },
] as Stages;

describe("findReading", () => {
  it("returns the field readings of the element the predicate picks", () => {
    const stages = storeWith(STAGES).sampleReading<Stages>("dv.stages");

    const picked = findReading(stages, (entry) => entry.stage === 1);

    expect(picked?.dvVac.state).toBe("observed");
    expect(picked?.dvVac.value?.magnitude).toBe(3100);
  });

  it("answers undefined where no element matches", () => {
    const stages = storeWith(STAGES).sampleReading<Stages>("dv.stages");

    expect(findReading(stages, (entry) => entry.stage === 9)).toBeUndefined();
  });

  it("answers undefined while the list holds no value", () => {
    const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
    const store = new TimelineStore(clock);
    store.beginFrame();

    const stages = store.sampleReading<Stages>("dv.stages");

    expect(stages.state).toBe("pending");
    expect(findReading(stages, () => true)).toBeUndefined();
  });

  it("reads a field the element omits as absent", () => {
    const stages = storeWith(STAGES).sampleReading<Stages>("dv.stages");

    expect(
      findReading(stages, (entry) => entry.stage === 2)?.twrVac.state,
    ).toBe("absent");
  });
});
