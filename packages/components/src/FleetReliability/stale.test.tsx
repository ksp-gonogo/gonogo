import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { FleetReliabilityUpdates } from "./index";

/**
 * What the reliability augment does when the reliability read is no longer
 * current.
 *
 * The decision: it stops asserting conditions and says why, on the row. A
 * "critical failure" pill next to a part name is a claim about the craft now,
 * and a held part list makes that claim from evidence about the craft some
 * seconds ago: it would keep flagging a part the crew has since repaired, and
 * (the way round that matters) keep a craft that has since failed looking clean.
 *
 * Which is exactly why the withholding has to be VISIBLE here. A silent refusal
 * is indistinguishable from a healthy craft, from a non-active row, and from an
 * augment that crashed. The assertions below pair "the markers are gone" with
 * "the reason is on screen" for that reason; neither half alone would catch a
 * regression.
 *
 * The identity read is NOT withheld (see the module doc's per-topic split), and
 * one test is the proof: the notice still lands on the correct row after the
 * link drops, which it could not do if the active vessel had been withheld along
 * with the parts.
 *
 * Note the staleness gate now watches BOTH reliability topics, not just the
 * parts. They publish from one capture at one UT and go stale together, so
 * either one going stale is the same event.
 */
const CARRIED = ["reliability.summary", "reliability.parts", "vessel.identity"];

const ACTIVE_IDENTITY = {
  vesselId: "v-active",
  name: "Active One",
  vesselType: 0,
  situation: 3,
};

const FAILING_PARTS = [
  {
    partId: "1:0",
    title: "LV-909 Terrier",
    condition: "failed-critical",
    conditionDetail: "busted",
  },
];

function renderAugment(vesselId: string) {
  const fixture = setupStreamFixture({ carriedChannels: CARRIED });
  const utils = render(
    <fixture.Provider>
      <FleetReliabilityUpdates
        vesselId={vesselId}
        vesselName="Row"
        body="Kerbin"
        compact={false}
      />
    </fixture.Provider>,
  );
  return { fixture, ...utils };
}

function emitFailure(fixture: ReturnType<typeof setupStreamFixture>): void {
  act(() => {
    fixture.emit("vessel.identity", ACTIVE_IDENTITY);
    fixture.emit("reliability.summary", {
      source: "testflight",
      coverage: "modeled",
    });
    fixture.emit("reliability.parts", FAILING_PARTS);
  });
}

function dropTheLink(fixture: ReturnType<typeof setupStreamFixture>): void {
  act(() => {
    fixture.store.setTransportConnected(false);
    fixture.store.beginFrame();
  });
}

describe("FleetReliability when the reliability read is not current", () => {
  it("flags the failing part while the read is current", async () => {
    // The control. Without it every assertion below would also pass on an augment
    // that never renders a failure at all.
    const { fixture } = renderAugment("v-active");
    emitFailure(fixture);

    expect(await screen.findByText("LV-909 Terrier")).toBeInTheDocument();
    expect(screen.getByText("1 at risk")).toBeInTheDocument();
    expect(
      screen.queryByRole("status", { name: "Reliability not current" }),
    ).not.toBeInTheDocument();
  });

  it("withholds the markers and SAYS the reliability read is not current", async () => {
    const { fixture } = renderAugment("v-active");
    emitFailure(fixture);
    expect(await screen.findByText("LV-909 Terrier")).toBeInTheDocument();

    dropTheLink(fixture);

    await waitFor(() =>
      expect(
        screen.getByRole("status", { name: "Reliability not current" }),
      ).toBeInTheDocument(),
    );
    // Withheld, not merely reworded: no part name, no severity word, no count.
    expect(screen.queryByText("LV-909 Terrier")).not.toBeInTheDocument();
    expect(screen.queryByText("critical failure")).not.toBeInTheDocument();
    expect(screen.queryByText(/at risk/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Reliability updates" }),
    ).not.toBeInTheDocument();
  });

  it("does not blank the row entirely, so withheld is distinguishable from healthy", async () => {
    // The failure mode this file exists to prevent. A blank row is what a craft
    // with nothing wrong with it renders, and reaching that state from a dropped
    // link reports a healthy craft whose failures nobody is watching.
    const { fixture, container } = renderAugment("v-active");
    emitFailure(fixture);
    expect(await screen.findByText("LV-909 Terrier")).toBeInTheDocument();

    dropTheLink(fixture);

    await waitFor(() => expect(container).not.toBeEmptyDOMElement());
    expect(screen.getByText("not current")).toBeInTheDocument();
  });

  it("keeps the notice on the ACTIVE row only, because identity is held rather than withheld", async () => {
    // vessel.identity is a fact and survives the drop, so the row-matching gate
    // still works: the notice belongs to the craft the reliability feed was
    // describing, and every other row stays blank.
    const active = renderAugment("v-active");
    emitFailure(active.fixture);
    expect(await screen.findByText("LV-909 Terrier")).toBeInTheDocument();
    dropTheLink(active.fixture);
    await waitFor(() =>
      expect(screen.getByText("not current")).toBeInTheDocument(),
    );
    active.unmount();

    const other = renderAugment("v-other");
    emitFailure(other.fixture);
    dropTheLink(other.fixture);

    await waitFor(() => expect(other.container).toBeEmptyDOMElement());
    expect(screen.queryByText("not current")).not.toBeInTheDocument();
  });

  it("says it is not REPORTING, not that it went stale, before anything has arrived", async () => {
    // A cold start is not a dropped link, and conflating them would accuse the
    // mod of going quiet on every first paint. Both are now spoken states rather
    // than the same blank, so this asserts which one is on screen.
    const { fixture } = renderAugment("v-active");
    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
    });

    expect(await screen.findByText("not reporting")).toBeInTheDocument();
    expect(screen.queryByText("not current")).not.toBeInTheDocument();
  });

  it("still renders blank for the none backend after the link drops", async () => {
    // The elected backend is a fact too. A vanilla install has no reliability
    // model to lose currency on, so it must not start reporting a dropped link
    // for data it was never going to publish.
    const { fixture, container } = renderAugment("v-active");
    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
      fixture.emit("reliability.summary", { source: "none", coverage: "none" });
      fixture.emit("reliability.parts", []);
    });
    await waitFor(() => expect(container).toBeEmptyDOMElement());

    dropTheLink(fixture);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByText("not current")).not.toBeInTheDocument();
  });
});
