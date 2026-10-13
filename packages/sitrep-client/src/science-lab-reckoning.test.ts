import type { LabEntry } from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import type { TopicReading } from "./reading";
import { clearReckoners, registerCoreReckoners } from "./reckoners";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * A running lab's stored science, grown at its own rate to the view time.
 *
 * The rate is per game day, so a fixture rate of 2 per day over a quarter of a
 * day (5,400 s in a 21,600 s day) gains 0.5.
 */

const DELAY_SECONDS = 10;
const QUARTER_DAY = 5_400;

const RUNNING = 0;
const IDLE = 1;
const UNSTAFFED = 2;

function lab(partId: string, overrides: Partial<LabEntry> = {}): LabEntry {
  return {
    partId,
    partName: "Mobile Processing Lab",
    dataStored: value("Mit", 100),
    dataStorage: value("Mit", 750),
    storedScience: value("science", 10),
    processingData: true,
    scientistCount: value("count", 1),
    scienceRate: value("science/day", 2),
    isOperational: true,
    ...overrides,
  };
}

const LABS: LabEntry[] = [
  lab("4001"),
  lab("4002", { processingData: false }),
  lab("4003", { scientistCount: value("count", 0), isOperational: false }),
];

function scene(labs: LabEntry[] = LABS) {
  const point = (
    validAt: number,
    payload: LabEntry[],
  ): TimelinePoint<LabEntry[]> => ({
    validAt,
    payload,
    meta: makeMeta({
      validAt,
      deliveredAt: validAt + DELAY_SECONDS,
      source: "vessel:probe",
    }),
    epoch: 0,
  });
  let wall = DELAY_SECONDS;
  const clock = new ViewClock({
    nowWall: () => wall,
    warpRate: () => 1,
    delaySeconds: () => DELAY_SECONDS,
  });
  const store = new TimelineStore(clock, {});
  store.setTransportConnected(false);
  store.ingest("science.lab", point(0, labs));
  return {
    at(scetUt: number): TopicReading<LabEntry[]> {
      wall = scetUt;
      store.beginFrame();
      return store.sampleReading<LabEntry[]>("science.lab");
    },
  };
}

function reckoned(readings: TopicReading<LabEntry[]>, index: number) {
  const stored = readings[index]?.storedScience;
  return stored?.reckoning.status === "available"
    ? stored.reckoning
    : undefined;
}

beforeEach(() => {
  clearReckoners();
  registerCoreReckoners();
});

describe("a science lab's stored science under delay", () => {
  it("grows at the lab's rate and reads as modelled", () => {
    const readings = scene().at(QUARTER_DAY);

    const reckoning = reckoned(readings, RUNNING);
    expect(reckoning?.basis).toBe("rate-integration");
    expect(reckoning?.modelled?.magnitude).toBeCloseTo(10.5, 6);
  });

  it("stops at the lab's science cap", () => {
    const readings = scene([
      lab("4001", { scienceCap: value("science", 10.2) }),
    ]).at(QUARTER_DAY);

    expect(reckoned(readings, RUNNING)?.modelled?.magnitude).toBeCloseTo(
      10.2,
      6,
    );
  });

  it("carries a lab whose cap could not be read without a limit", () => {
    const readings = scene([lab("4001", { scienceCap: null })]).at(QUARTER_DAY);

    expect(reckoned(readings, RUNNING)?.modelled?.magnitude).toBeCloseTo(
      10.5,
      6,
    );
  });

  it("leaves a lab that is not processing at what was observed", () => {
    const readings = scene().at(QUARTER_DAY);

    expect(reckoned(readings, IDLE)).toBeUndefined();
  });

  it("leaves a lab nobody is working in at what was observed", () => {
    const readings = scene().at(QUARTER_DAY);

    expect(reckoned(readings, UNSTAFFED)).toBeUndefined();
  });

  it("offers nothing when no lab is converting data", () => {
    const readings = scene([lab("4001", { processingData: false })]).at(
      QUARTER_DAY,
    );

    expect(reckoned(readings, 0)).toBeUndefined();
  });

  it("follows a lab by its part id when the list reorders", () => {
    const readings = scene([...LABS].reverse()).at(QUARTER_DAY);

    expect(reckoned(readings, 2)?.modelled?.magnitude).toBeCloseTo(10.5, 6);
    expect(reckoned(readings, 0)).toBeUndefined();
  });
});
