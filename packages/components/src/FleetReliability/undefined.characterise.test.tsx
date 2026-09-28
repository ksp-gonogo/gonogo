import type { TopicId } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { ReadingProbe } from "../test/ReadingProbe";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { FleetReliabilityUpdates } from "./index";

/**
 * What the augment does when a `useTelemetry` read comes back with nothing.
 * Each absence has its own sentence, named rather than asserted as a blank;
 * only the identity gate renders nothing, since an augment that cannot bind to
 * a row must not draw on one. Every test renders on the row the augment belongs
 * to.
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
    condition: "failed",
    conditionDetail: "turbopump failure",
  },
];

function renderAugment(vesselId: string, { probe }: { probe?: TopicId } = {}) {
  const fixture = setupStreamFixture({
    suspendFrames: true,
  });
  const utils = render(
    <fixture.Provider>
      {probe && <ReadingProbe topic={probe} />}
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

/**
 * A summary that lets the augment draw, so a test asserting a blank can then
 * show the identity and parts it emitted did arrive and were withheld only by
 * the summary under test.
 */
function emitModelledSummary(fixture: StreamFixture) {
  act(() => {
    fixture.emit("reliability.summary", {
      source: "testflight",
      coverage: "modeled",
    });
  });
}

describe("FleetReliability, what an unread channel renders", () => {
  it("renders nothing at all when no channel has emitted", () => {
    // The one that stays blank: without an identity the augment does not know which row it is on.
    const { container } = renderAugment("v-active");

    expect(
      screen.queryByRole("group", { name: "Reliability updates" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/at risk/)).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("SUPPRESSES a fully-known failure list while vessel.identity is undefined", async () => {
    // Only the unread identity withholds data that would otherwise render; emitting it makes the data appear.
    const { fixture, container } = renderAugment("v-active");
    act(() => {
      fixture.emit("reliability.summary", {
        source: "testflight",
        coverage: "modeled",
      });
      fixture.emit("reliability.parts", FAILING_PARTS);
    });

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByText("LV-909 Terrier")).not.toBeInTheDocument();

    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
    });
    await waitFor(() =>
      expect(screen.getByText("LV-909 Terrier")).toBeInTheDocument(),
    );
  });

  it("suppresses the same list for a CONFIRMED identity tombstone, same as never-arrived", async () => {
    // A tombstoned identity renders the same blank as never-heard.
    const { fixture, container } = renderAugment("v-active");
    act(() => {
      fixture.emit("reliability.summary", {
        source: "testflight",
        coverage: "modeled",
      });
      fixture.emit("reliability.parts", FAILING_PARTS);
      fixture.emit("vessel.identity", null);
    });

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByText("LV-909 Terrier")).not.toBeInTheDocument();
  });

  it("says the parts are not reporting rather than reading them as no failures", async () => {
    // A backend modelling with no part list yet is not a craft with zero failing parts.
    const { fixture } = renderAugment("v-active");
    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
      fixture.emit("reliability.summary", {
        source: "testflight",
        coverage: "modeled",
      });
    });

    expect(
      await screen.findByText("testflight parts not reporting"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/at risk/)).not.toBeInTheDocument();

    act(() => {
      fixture.emit("reliability.parts", FAILING_PARTS);
    });
    await waitFor(() =>
      expect(screen.getByText("1 at risk")).toBeInTheDocument(),
    );
    expect(
      screen.queryByText("testflight parts not reporting"),
    ).not.toBeInTheDocument();
  });

  it("refuses to assert a failure with NO summary at all", async () => {
    // An unread summary must never let the augment assert a failure.
    const { fixture } = renderAugment("v-active");
    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
      fixture.emit("reliability.parts", FAILING_PARTS);
    });

    // With no summary there is no reading to qualify, so no notice either.
    expect(screen.queryByText("LV-909 Terrier")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Reliability updates" }),
    ).not.toBeInTheDocument();

    emitModelledSummary(fixture);
    expect(await screen.findByText("LV-909 Terrier")).toBeInTheDocument();
  });

  it("treats a CONFIRMED summary tombstone the same way", async () => {
    // A `null` summary is still not a statement about the parts.
    const { fixture } = renderAugment("v-active", {
      probe: "reliability.summary",
    });
    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
      fixture.emit("reliability.summary", null);
      fixture.emit("reliability.parts", FAILING_PARTS);
    });

    await screen.findByText("reliability.summary: absent");
    expect(screen.queryByText("LV-909 Terrier")).not.toBeInTheDocument();

    emitModelledSummary(fixture);
    expect(await screen.findByText("LV-909 Terrier")).toBeInTheDocument();
  });

  it("stays silent when a producer never set a coverage", async () => {
    // A source with no coverage is unknown, and must never read as "modelled".
    const { fixture } = renderAugment("v-active", {
      probe: "reliability.summary",
    });
    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
      fixture.emit("reliability.summary", { source: "somemod" });
      fixture.emit("reliability.parts", FAILING_PARTS);
    });

    await screen.findByText("reliability.summary: observed");
    expect(screen.queryByText("LV-909 Terrier")).not.toBeInTheDocument();

    emitModelledSummary(fixture);
    expect(await screen.findByText("LV-909 Terrier")).toBeInTheDocument();
  });

  it("labels a failing part with an undefined title as 'Unknown part'", async () => {
    // The part failed critically and its title did not arrive: a placeholder name and no `title` attribute.
    const { fixture } = renderAugment("v-active");
    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
      fixture.emit("reliability.summary", {
        source: "kerbalism",
        coverage: "modeled",
      });
      fixture.emit("reliability.parts", [
        { partId: "9:0", condition: "failed-critical" },
      ]);
    });

    const unknown = await screen.findByText("Unknown part");
    expect(unknown).not.toHaveAttribute("title");
    // The severity is still asserted off the fields that DID arrive.
    expect(screen.getByText("critical failure")).toBeInTheDocument();
    expect(screen.getByText("1 at risk")).toBeInTheDocument();
  });
});
