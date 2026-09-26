import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { FleetReliabilityUpdates } from "./index";

/**
 * The augment's outcomes are DIFFERENT FROM EACH OTHER: every state renders
 * through the real augment, no two non-empty renders read alike, and the
 * silences are named, not counted. Half the instrument:
 * `mod/Sitrep.Host.Tests/ReliabilityStateWireTests.cs` asserts distinctness on
 * the bytes the real producers emit.
 */
const CARRIED = ["reliability.summary", "reliability.parts", "vessel.identity"];

const ACTIVE_IDENTITY = {
  vesselId: "v-active",
  name: "Active One",
  vesselType: 0,
  situation: 3,
};

const FAILED_PART = {
  partId: "1:0",
  title: "Reaction Wheel",
  condition: "failed-critical",
  conditionDetail: "busted",
};

type Case = {
  /** The ladder rung this exercises, so a collision names both sides. */
  state: string;
  summary?: unknown;
  parts?: unknown;
  /** Withhold the readings by dropping the link after they land. */
  goStale?: boolean;
  /** Render on a row that is not the active craft. */
  otherRow?: boolean;
};

const CASES: Case[] = [
  {
    state: "S1 both topics went stale",
    summary: { source: "testflight", coverage: "modeled" },
    parts: [FAILED_PART],
    goStale: true,
  },
  { state: "S2 no summary has arrived", parts: [FAILED_PART] },
  {
    state: "S3 the elected provider could not be read",
    summary: { source: "none", coverage: "unavailable" },
    parts: [],
  },
  {
    state: "S4 the backend cannot tell whether it is modelling",
    summary: { source: "kerbalism", coverage: "indeterminate" },
    parts: [],
  },
  {
    state: "S5 the backend is not modelling this save",
    summary: { source: "kerbalism", coverage: "disabled" },
    parts: [],
  },
  {
    state: "S6 nothing is installed that could model reliability",
    summary: { source: "none", coverage: "none" },
    parts: [],
  },
  {
    state: "S7 modelling, and the part list has not arrived",
    summary: { source: "testflight", coverage: "modeled" },
  },
  {
    state: "S8 modelling, and no part is monitored",
    summary: { source: "testflight", coverage: "modeled" },
    parts: [],
  },
  {
    state: "S9 modelling, monitored, nothing worth saying",
    summary: { source: "testflight", coverage: "modeled" },
    parts: [{ partId: "1:0", title: "Battery", condition: "nominal" }],
  },
  {
    state: "S10 modelling, with something wrong",
    summary: { source: "testflight", coverage: "modeled" },
    parts: [FAILED_PART],
  },
  {
    state: "S11 a coverage value this build has never heard of",
    summary: { source: "somemod", coverage: "quarantined-in-a-future-version" },
    parts: [],
  },
];

async function renderCase(testCase: Case): Promise<string> {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    suspendFrames: true,
  });
  const { container, unmount } = render(
    <fixture.Provider>
      <FleetReliabilityUpdates
        vesselId="v-active"
        vesselName="Row"
        body="Kerbin"
        compact={false}
      />
    </fixture.Provider>,
  );

  act(() => {
    fixture.emit(
      "vessel.identity",
      testCase.otherRow
        ? { ...ACTIVE_IDENTITY, vesselId: "v-somewhere-else" }
        : ACTIVE_IDENTITY,
    );
    if (testCase.summary !== undefined) {
      fixture.emit("reliability.summary", testCase.summary);
    }
    if (testCase.parts !== undefined) {
      fixture.emit("reliability.parts", testCase.parts);
    }
  });

  if (testCase.goStale) {
    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });
  }

  // A sample reaches the tree on a FRAME; the fixture's clock is suspended, so this holds the act scope open across the commit.
  await act(async () => {});

  const text = (container.textContent ?? "").trim();
  unmount();
  return text;
}

describe("what the reliability augment says in each coverage state", () => {
  it("says something different in every state, with exactly one silence", async () => {
    const rendered: { state: string; text: string }[] = [];
    for (const testCase of CASES) {
      rendered.push({
        state: testCase.state,
        text: await renderCase(testCase),
      });
    }

    const collisions = new Map<string, string[]>();
    for (const { state, text } of rendered) {
      if (text === "") continue;
      collisions.set(text, [...(collisions.get(text) ?? []), state]);
    }
    const collided = [...collisions.entries()]
      .filter(([, states]) => states.length > 1)
      .map(
        ([text, states]) =>
          `${states.join(" == ")} (both render ${JSON.stringify(text)})`,
      );

    expect(collided).toEqual([]);
    expect(rendered).toHaveLength(CASES.length);

    /*
     * Which states may be silent is the design decision: every non-modelled
     * state (install facts, carried by `system.uplinkHealth`) and S9, where
     * nothing is wrong. A modelled state arriving here would be a finding
     * going invisible.
     */
    const silent = rendered
      .filter((entry) => entry.text === "")
      .map((entry) => entry.state);
    expect(silent).toEqual([
      "S2 no summary has arrived",
      "S3 the elected provider could not be read",
      "S4 the backend cannot tell whether it is modelling",
      "S5 the backend is not modelling this save",
      "S6 nothing is installed that could model reliability",
      "S9 modelling, monitored, nothing worth saying",
      "S11 a coverage value this build has never heard of",
    ]);

    await act(async () => {});
  });

  /** The identity gate renders the same nothing as S6: an augment that cannot bind to a row must not draw on one. */
  it("renders nothing at all on a row that is not the active craft", async () => {
    expect(
      await renderCase({
        state: "S0",
        summary: { source: "testflight", coverage: "modeled" },
        parts: [FAILED_PART],
        otherRow: true,
      }),
    ).toBe("");
    await act(async () => {});
  });

  /** The staleness caption outranks the count, even over a critical failure. */
  it("withholds a critical count rather than dating it", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      suspendFrames: true,
    });
    render(
      <fixture.Provider>
        <FleetReliabilityUpdates
          vesselId="v-active"
          vesselName="Row"
          body="Kerbin"
          compact={false}
        />
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
      fixture.emit("reliability.summary", {
        source: "testflight",
        coverage: "modeled",
      });
      fixture.emit("reliability.parts", [FAILED_PART]);
    });
    expect(await screen.findByText("1 at risk")).toBeInTheDocument();

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    expect(screen.queryByText(/at risk/)).not.toBeInTheDocument();
    expect(screen.getByText("not current")).toBeInTheDocument();
    await act(async () => {});
  });
});
