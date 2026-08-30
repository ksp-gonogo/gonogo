import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { FleetReliabilityUpdates } from "./index";

/**
 * What the augment does when a `useTelemetry` read comes back with nothing.
 *
 * This file used to be a CHARACTERISATION of three gates that all failed the
 * same way: an unread summary fell through an optional chain and was treated as
 * "some backend other than none", an unread part list became `parts ?? []` and
 * so a confirmed absence of failures, and an unread identity was the only one
 * that withheld anything. Two of the three said "everything is fine" about a
 * craft nobody had heard from.
 *
 * It is a SPECIFICATION now. Each absence has its own sentence, and the tests
 * below name the sentence rather than asserting a blank, because a blank was
 * exactly what could not be told apart from good news. The identity gate is the
 * one that still renders nothing, and that is deliberate and stated: an augment
 * that cannot bind itself to a roster row must not draw on one.
 *
 * Every test renders on the row the augment is SUPPOSED to render on, so a blank
 * is attributable to the absence under test and not to the row-matching gate.
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
    condition: "failed",
    conditionDetail: "turbopump failure",
  },
];

function renderAugment(vesselId: string) {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
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

describe("FleetReliability, what an unread channel renders", () => {
  it("renders nothing at all when no channel has emitted", () => {
    // The cold case, and the ONE that stays blank: without an identity the
    // augment does not know which row it is on, so it draws on none of them.
    const { container } = renderAugment("v-active");

    expect(
      screen.queryByRole("group", { name: "Reliability updates" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/at risk/)).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("SUPPRESSES a fully-known failure list while vessel.identity is undefined", async () => {
    // Proved by contrast within one test: the summary and a failed part are both
    // present and would render, and the ONLY thing withholding them is the unread
    // identity. Emitting it afterwards makes the same data appear.
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
    // null-vs-undefined: `!identity` is a falsy test rather than a strict
    // undefined one, so a confirmed "this vessel has no identity record"
    // tombstone renders exactly the same blank as "we have not heard yet". The
    // widget cannot tell them apart, and says nothing either way.
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
    // The gate that used to be `parts ?? []`. A backend that says it IS
    // modelling, with no part list yet, is not a craft with zero failing parts.
    // Proved non-vacuous by the emission at the end, which replaces the notice
    // with the real list and nothing else changes.
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
    // The gate that used to be `summary?.source === "none"`, optional-chained,
    // so an unread summary fell through to a full render and the augment
    // asserted a part was broken without having heard which backend, or whether
    // any backend, was modelling reliability.
    const { fixture } = renderAugment("v-active");
    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
      fixture.emit("reliability.parts", FAILING_PARTS);
    });

    // The property under test is that it does not ASSERT A FAILURE, and that is
    // unchanged. What went is the notice: with no summary there is no reading to
    // qualify, and whether that is a comms problem is the signal status's story.
    await waitFor(() =>
      expect(screen.queryByText("LV-909 Terrier")).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("group", { name: "Reliability updates" }),
    ).not.toBeInTheDocument();
  });

  it("treats a CONFIRMED summary tombstone the same way", async () => {
    // Same gate, the tombstone side. A `null` summary is a confirmed "there is
    // no reliability summary", which is still not a statement about the parts.
    const { fixture } = renderAugment("v-active");
    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
      fixture.emit("reliability.summary", null);
      fixture.emit("reliability.parts", FAILING_PARTS);
    });

    await waitFor(() =>
      expect(screen.queryByText("LV-909 Terrier")).not.toBeInTheDocument(),
    );
  });

  it("stays silent when a producer never set a coverage", async () => {
    // A payload with a source and no coverage is a producer bug, and the honest
    // answer is that we do not know. Reading it as "modelled" would resurrect
    // the boolean this field replaced, so the part list must stay unrendered;
    // that is the assertion. The notice went with the other install-level ones.
    const { fixture } = renderAugment("v-active");
    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
      fixture.emit("reliability.summary", { source: "somemod" });
      fixture.emit("reliability.parts", FAILING_PARTS);
    });

    await waitFor(() =>
      expect(screen.queryByText("LV-909 Terrier")).not.toBeInTheDocument(),
    );
  });

  it("labels a failing part with an undefined title as 'Unknown part'", async () => {
    // Partial payload inside an arrived record: the part is known to have failed
    // critically, its title is not. The row still renders, with a placeholder
    // name and no `title` tooltip attribute.
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
