import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { FleetReliabilityUpdates } from "./index";

/**
 * Characterisation, not specification: what the FleetReliability augment DOES
 * today when its `useTelemetry` reads come back `undefined`.
 *
 * Three absence sites, all of which stop gating the moment the read answers
 * with an always-truthy `Reading`:
 *
 *   1. `if (!identity || identity.vesselId !== vesselId) return null`: the
 *      whole-augment gate. A truthy-object read makes `!identity` dead and
 *      sends the comparison straight at `identity.vesselId`
 *   2. `if (summary?.source === "none") return null`, optional-chained, so an
 *      unread summary is read as "some backend other than none"
 *   3. `(parts ?? []).filter(isFailing)`, an unread parts list becomes a
 *      confirmed empty one
 *
 * Every test here renders the augment on the row it is SUPPOSED to render on
 * (`vesselId` matching the active identity), so a blank result is attributable
 * to the absence under test and not to the row-matching gate.
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
    partId: "p1",
    title: "LV-909 Terrier",
    broken: true,
    critical: false,
    needsRepair: false,
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
      />
    </fixture.Provider>,
  );
  return { fixture, ...utils };
}

describe("FleetReliability, what undefined telemetry renders today", () => {
  it("renders nothing at all when no channel has emitted", () => {
    // The cold case. Asserted against the augment's own named landmarks rather
    // than an empty container alone, so this cannot be satisfied by a component
    // that happens to render nothing for a different reason.
    const { container } = renderAugment("v-active");

    expect(
      screen.queryByRole("group", { name: "Reliability updates" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/at risk/)).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("SUPPRESSES a fully-known failure list while vessel.identity is undefined", async () => {
    // Gate 1, proved by contrast within one test: the summary and a broken part
    // are both present and would render, and the ONLY thing withholding them is
    // the unread identity. Emitting the identity afterwards makes the same data
    // appear, which is what makes the suppression attributable to `!identity`
    // rather than to anything else being missing.
    const { fixture, container } = renderAugment("v-active");
    act(() => {
      fixture.emit("reliability.summary", {
        source: "testflight",
        malfunction: true,
        critical: false,
      });
      fixture.emit("reliability.parts", FAILING_PARTS);
    });

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByText("LV-909 Terrier")).not.toBeInTheDocument();
    expect(screen.queryByText("1 at risk")).not.toBeInTheDocument();

    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
    });
    await waitFor(() =>
      expect(screen.getByText("LV-909 Terrier")).toBeInTheDocument(),
    );
  });

  it("suppresses the same list for a CONFIRMED identity tombstone, same as never-arrived", async () => {
    // null-vs-undefined: `!identity` is falsy-truthy rather than a strict
    // undefined test, so a confirmed "this vessel has no identity record"
    // tombstone renders exactly the same blank as "we have not heard yet". The
    // widget cannot tell them apart, and says nothing either way.
    const { fixture, container } = renderAugment("v-active");
    act(() => {
      fixture.emit("reliability.summary", { source: "testflight" });
      fixture.emit("reliability.parts", FAILING_PARTS);
      fixture.emit("vessel.identity", null);
    });

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByText("LV-909 Terrier")).not.toBeInTheDocument();
  });

  it("reads an undefined reliability.parts as a CONFIRMED absence of failures", async () => {
    // Gate 3, `parts ?? []`. Identity matches and the elected backend says it is
    // reporting malfunctions, yet the unread part list renders as zero failing
    // parts: silence and "everything is fine" are the same picture. Proved
    // non-vacuous by the parts emission at the end, which makes the marker
    // appear with nothing else changing.
    const { fixture, container } = renderAugment("v-active");
    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
      fixture.emit("reliability.summary", {
        source: "testflight",
        malfunction: true,
        critical: true,
      });
    });

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByText(/at risk/)).not.toBeInTheDocument();

    act(() => {
      fixture.emit("reliability.parts", FAILING_PARTS);
    });
    await waitFor(() =>
      expect(screen.getByText("1 at risk")).toBeInTheDocument(),
    );
  });

  it("renders the failure markers with NO summary at all, because the none-backend gate is optional-chained", async () => {
    // Gate 2, `summary?.source === "none"`. An unread summary is not treated as
    // "backend unknown, hold off": it falls through to a full render, so the
    // augment asserts a part is broken without having heard which backend, or
    // whether any backend, is modelling reliability at all.
    const { fixture } = renderAugment("v-active");
    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
      fixture.emit("reliability.parts", FAILING_PARTS);
    });

    await waitFor(() =>
      expect(screen.getByText("LV-909 Terrier")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("group", { name: "Reliability updates" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 at risk")).toBeInTheDocument();
    expect(screen.getByText("broken")).toBeInTheDocument();
  });

  it("renders the failure markers for a CONFIRMED summary tombstone too", async () => {
    // Same gate, the tombstone side: `null?.source` is undefined, so a
    // confirmed "no reliability summary" is also read as "not the none
    // backend" and the markers render.
    const { fixture } = renderAugment("v-active");
    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
      fixture.emit("reliability.summary", null);
      fixture.emit("reliability.parts", FAILING_PARTS);
    });

    await waitFor(() =>
      expect(screen.getByText("LV-909 Terrier")).toBeInTheDocument(),
    );
  });

  it("labels a failing part with an undefined title as 'Unknown part'", async () => {
    // Partial payload inside an arrived record: the part is known to be
    // critical, its title is not. The row still renders, with a placeholder
    // name and no `title` tooltip attribute.
    const { fixture } = renderAugment("v-active");
    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
      fixture.emit("reliability.summary", { source: "kerbalism" });
      fixture.emit("reliability.parts", [
        { partId: "p9", broken: false, critical: true, needsRepair: false },
      ]);
    });

    const unknown = await screen.findByText("Unknown part");
    expect(unknown).not.toHaveAttribute("title");
    // The severity is still asserted off the fields that DID arrive.
    expect(screen.getByText("critical")).toBeInTheDocument();
    expect(screen.getByText("1 at risk")).toBeInTheDocument();
  });
});
