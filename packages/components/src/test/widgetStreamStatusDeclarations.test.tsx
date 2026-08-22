import { useWidgetStreamStatus } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "./setupStreamFixture";

/**
 * What a widget is allowed to write in `dataRequirements` and still get a
 * panel badge.
 *
 * The hook used to accept exactly two shapes: a flat legacy key, or a
 * two-segment `TopicId`. Neither is what a migrated widget wants to say. The
 * modern spelling of `career.funds` is the field subtopic
 * `career.status.economy.funds`, which is not a `TopicId` (`isTopicId` covers
 * the wire's channels, not paths inside their payloads), so declaring it
 * resolved to nothing and silently withheld the badge. Same for a derived
 * channel id like `vessel.state`, which no widget could name at all.
 */
const CARRIED = [
  "career.status",
  "vessel.state",
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
];

describe("useWidgetStreamStatus: which declarations resolve", () => {
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(() => {
    stream = setupStreamFixture({ carriedChannels: CARRIED, pinnedUt: 10 });
  });

  function Probe({ requirements }: { requirements: string[] }) {
    const status = useWidgetStreamStatus(requirements);
    return <output data-testid="status">{status ?? "null"}</output>;
  }

  function renderWith(requirements: string[]) {
    render(
      <stream.Provider>
        <Probe requirements={requirements} />
      </stream.Provider>,
    );
  }

  function emitCareer() {
    act(() => {
      stream.emit(
        "career.status",
        { economy: { funds: 289_848, reputation: 12, science: 40 } },
        { quality: Quality.Loaded },
      );
    });
  }

  it("resolves a legacy key (unmigrated widget, unchanged)", () => {
    renderWith(["career.funds"]);
    emitCareer();
    expect(screen.getByTestId("status")).not.toHaveTextContent("null");
  });

  it("resolves a channel-level topic id (unchanged)", () => {
    renderWith(["career.status"]);
    emitCareer();
    expect(screen.getByTestId("status")).not.toHaveTextContent("null");
  });

  it("resolves a field subtopic, the modern spelling of a legacy key", () => {
    renderWith(["career.status.economy.funds"]);
    emitCareer();
    expect(screen.getByTestId("status")).not.toHaveTextContent("null");
  });

  it("resolves a derived channel id a widget reads wholesale", () => {
    renderWith(["vessel.state"]);
    act(() => {
      stream.emit(
        "vessel.orbit",
        {
          referenceBodyIndex: 1,
          sma: 700_000,
          ecc: 0,
          inc: 0,
          lan: null,
          argPe: null,
          meanAnomalyAtEpoch: 0,
          epoch: 0,
          mu: 3.5316e12,
        },
        { quality: Quality.Loaded },
      );
    });
    expect(screen.getByTestId("status")).not.toHaveTextContent("null");
  });

  it("still reports nothing known for a requirement that is carried by nothing", () => {
    // A real channel this fixture deliberately does not carry: widening what
    // the hook accepts must not turn "nothing is known" into a badge.
    renderWith(["vessel.surface"]);
    expect(screen.getByTestId("status")).toHaveTextContent("null");
  });
});
