import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { FleetReliabilityUpdates } from "./index";

/**
 * The one assertion this augment most needed and never had: that its outcomes
 * are DIFFERENT FROM EACH OTHER.
 *
 * Every test that predated this file asserted `null` for an absence, one file at
 * a time. Six situations therefore passed six separate tests while rendering the
 * same nothing: no reliability mod installed, a mod installed and not modelling
 * this save, a probe that could not tell, a provider whose factory threw, a
 * modelled craft whose parts had not arrived, and a craft with nothing wrong.
 * Those were corroborating copies of one belief, not controls. A test that says
 * "this renders blank" cannot notice that everything else does too.
 *
 * So this renders every state through the REAL augment and asserts no two
 * non-empty renders read alike, and that the silences are exactly the two the
 * design accepts, named rather than counted: nothing installed that could be
 * broken, and everything installed reporting the craft is fine. Any third state
 * landing in that list is a state whose absence has gone invisible again.
 *
 * It is deliberately only HALF the instrument. A render-side matrix cannot see a
 * producer that is only capable of emitting one state, because it is handed the
 * states. `mod/Sitrep.Host.Tests/ReliabilityStateWireTests.cs` is the other kind,
 * asserting distinctness on the bytes the real backends and the real JsonWriter
 * produce.
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
  const fixture = setupStreamFixture({ carriedChannels: CARRIED });
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

  // An emitted sample reaches the tree on the view clock's next FRAME, not on
  // the emit, so the render has to be awaited across one. Read before this and
  // every case reports the cold-start blank instead of its own answer, which is
  // exactly the false agreement this file exists to detect.
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });

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
     * The silences are enumerated rather than counted, because WHICH states are
     * allowed to share one is the whole design decision, and the decision
     * changed: every state that is not MODELLED is now silent here.
     *
     * They are facts about the install, not about this craft, they hold for the
     * whole session, and none is actionable from a roster row, so each one had
     * been a permanent badge on every active row. `system.uplinkHealth` carries
     * them instead, and the settings panel and the Uplink wizard read it.
     *
     * What this list still guards is the half that kept its content: among the
     * states where something IS modelling, no two may read alike, and a
     * modelled state arriving in this list would be a real finding going
     * invisible. S9 is the one modelled member, and it is silent because
     * "nothing is wrong" is the absence of news rather than news.
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

  /**
   * The gate above the ladder, kept out of the distinctness sweep because it is
   * SUPPOSED to render the same nothing as S6: an augment that cannot bind
   * itself to a row must not draw on one.
   */
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

  /**
   * The staleness caption outranks the count, so it must fire even when there is
   * a critical failure to report: a "3 at risk" drawn from a possibly-held frame
   * is worst precisely during the occlusion or the burn that held it.
   */
  it("withholds a critical count rather than dating it", async () => {
    const fixture = setupStreamFixture({ carriedChannels: CARRIED });
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
