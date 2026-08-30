import { act, render, screen } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { MissionEventLogComponent } from "./index";

/**
 * CHARACTERISATION. What the Mission Log RENDERS today when its telemetry reads
 * are `undefined`, ahead of the `Reading<T>` migration. The derivation gates are
 * pinned next door in `useMissionEvents.undefined.characterise.test.tsx`; this
 * file covers the two undefined-reads the component itself makes:
 * the accumulated event list being empty, and `vessel.identity?.launchUt`
 * being absent, which decides whether a row is stamped as a mission-elapsed
 * clock or as a raw UT instant.
 */

const CARRIED = [
  "flight.started",
  "flight.ended",
  "flight.vesselChanged",
  "crash.lastCrash",
  "recovery.lastSummary",
  "vessel.structure",
  "vessel.orbit",
  "vessel.dock",
  "vessel.identity",
  "career.status",
] as const;

const trees: Array<() => void> = [];

function renderLog() {
  const fixture: StreamFixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 1000,
    suspendFrames: true,
  });
  const { unmount } = render(
    <fixture.Provider>
      <MissionEventLogComponent config={{}} id="log" />
    </fixture.Provider>,
  );
  trees.push(unmount);
  return fixture;
}

/** Emit and open the next frame together: the store only re-samples on a frame. */
function feed(fixture: StreamFixture, topic: string, payload: unknown): void {
  act(() => {
    fixture.emit(topic, payload);
    fixture.store.beginFrame();
  });
}

afterEach(() => {
  for (const unmount of trees) unmount();
  trees.length = 0;
});

describe("MissionEventLog with nothing on the stream", () => {
  it("renders the panel, the empty state, and no log furniture at all", () => {
    renderLog();
    expect(screen.getByText("MISSION LOG")).toBeInTheDocument();
    expect(screen.getByText("No mission events yet")).toBeInTheDocument();
    // The `events.length === 0` branch returns EARLY, so the count line and
    // every row is absent rather than reading "0 events". Asserted by name
    // because a widget that renders nothing passes any test about its container.
    expect(screen.queryByText(/\d+ events/)).not.toBeInTheDocument();
    expect(screen.queryByText("LAUNCH")).not.toBeInTheDocument();
    expect(screen.queryByText("CRASH")).not.toBeInTheDocument();
  });

  it("stays on the empty state when a record arrives whose ut field is undefined", () => {
    const fixture = renderLog();
    feed(fixture, "crash.lastCrash", { vesselName: "Doomed", cause: "impact" });
    // A partial payload, not an absent one. `fromCrash` needs a `ut` and drops
    // the record without it, so a crash the operator can see in game reads on
    // screen exactly like a mission where nothing has happened.
    expect(screen.getByText("No mission events yet")).toBeInTheDocument();
    expect(screen.queryByText("CRASH")).not.toBeInTheDocument();
  });
});

describe("MissionEventLog stamping with vessel.identity.launchUt undefined", () => {
  it("stamps a row with the raw UT when no identity has arrived", () => {
    const fixture = renderLog();
    feed(fixture, "crash.lastCrash", {
      ut: 1200,
      vesselName: "Doomed",
      cause: "impact",
    });

    expect(screen.getByText("CRASH")).toBeInTheDocument();
    // `typeof launchUt === "number"` fails on the absent read, so `Stamp` takes
    // its second branch: a `UT <MissionDate>` instant rather than a `T+`
    // mission-elapsed clock. Both are true statements about different
    // quantities, and which one shows is decided by this undefined.
    const text = visibleText();
    expect(text).toContain("UT");
    expect(text).not.toContain("T+");
    expect(text).toContain("Doomed crashed");
    expect(text).toContain("1 events");
  });

  it("still stamps the raw UT when identity arrived but carries no launchUt", () => {
    const fixture = renderLog();
    feed(fixture, "vessel.identity", { vesselType: 0 });
    feed(fixture, "crash.lastCrash", {
      ut: 1200,
      vesselName: "Doomed",
      cause: "impact",
    });

    // The PARTIAL-payload half of the same gate: the identity record is
    // present, so a truthy-record check would pass, and it is the missing
    // `launchUt` FIELD alone that keeps the stamp on the raw-UT branch.
    const text = visibleText();
    expect(text).toContain("UT");
    expect(text).not.toContain("T+");
  });

  it("switches to a T+ mission-elapsed stamp once launchUt is present", () => {
    const fixture = renderLog();
    feed(fixture, "vessel.identity", { vesselType: 0, launchUt: 900 });
    feed(fixture, "crash.lastCrash", {
      ut: 1200,
      vesselName: "Doomed",
      cause: "impact",
    });

    // The other side of the gate, so the pair records which read decides the
    // stamp rather than just that a stamp appears.
    expect(visibleText()).toContain("T+");
  });
});
