import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { FleetReliabilityUpdates } from "./index";

/**
 * When the reliability read is no longer current, the augment stops asserting
 * conditions and says why, on the row: a held list could keep a failed craft
 * looking clean. The identity is a fact and is kept, so the notice still lands
 * on the right row. Both reliability topics go stale together.
 */

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
  const fixture = setupStreamFixture({
    suspendFrames: true,
  });
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
    // The control: without it the assertions below would pass on an augment that never renders a failure.
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
    // A blank row is a healthy craft's render, and a dropped link must never reach it.
    const { fixture, container } = renderAugment("v-active");
    emitFailure(fixture);
    expect(await screen.findByText("LV-909 Terrier")).toBeInTheDocument();

    dropTheLink(fixture);

    await waitFor(() => expect(container).not.toBeEmptyDOMElement());
    expect(screen.getByText("not current")).toBeInTheDocument();
  });

  it("keeps the notice on the ACTIVE row only, because identity is held rather than withheld", async () => {
    // The identity survives the drop, so the notice lands on the craft being described and every other row stays blank.
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

  it("does not call a cold start a dropped link", async () => {
    // A cold start is not a dropped link: there is no reading to call stale.
    const { fixture, container } = renderAugment("v-active");
    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
    });

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByText("not current")).not.toBeInTheDocument();
  });

  it("still renders blank for the none backend after the link drops", async () => {
    // A vanilla install has no reliability model to lose currency on.
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
