import { act, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { FleetReliabilityUpdates } from "./index";

/**
 * The reliability augment consumes the ONE elected reliability.* topic pair
 * (source-agnostic: TestFlight or Kerbalism or a vanilla None fallback feed
 * the same shape) and is ACTIVE-VESSEL scoped (reliability.* carries no
 * vesselId today), so it renders only on the row whose vesselId matches
 * vessel.identity.vesselId, and nothing on every other row.
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
  {
    partId: "p2",
    title: "TR-18A Decoupler",
    broken: false,
    critical: true,
    needsRepair: false,
  },
  {
    partId: "p3",
    title: "FL-T400 Tank",
    broken: false,
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

describe("FleetReliabilityUpdates augment", () => {
  it("lists failing parts + a marker on the ACTIVE vessel's row", async () => {
    const { fixture } = renderAugment("v-active");
    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
      fixture.emit("reliability.summary", {
        source: "testflight",
        malfunction: true,
        critical: true,
      });
      fixture.emit("reliability.parts", FAILING_PARTS);
    });
    expect(await screen.findByText("LV-909 Terrier")).toBeInTheDocument();
    expect(screen.getByText("TR-18A Decoupler")).toBeInTheDocument();
    // The healthy part is excluded from the feed.
    expect(screen.queryByText("FL-T400 Tank")).not.toBeInTheDocument();
    // Marker: 2 of 3 parts are failing.
    expect(screen.getByText("2 at risk")).toBeInTheDocument();
  });

  it("renders nothing on a NON-active vessel's row", () => {
    const { fixture, container } = renderAugment("v-other");
    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
      fixture.emit("reliability.summary", {
        source: "testflight",
        malfunction: true,
      });
      fixture.emit("reliability.parts", FAILING_PARTS);
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the reliability source is none (degrade to blank)", () => {
    const { fixture, container } = renderAugment("v-active");
    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
      fixture.emit("reliability.summary", { source: "none" });
      fixture.emit("reliability.parts", []);
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the active vessel has no failing parts", () => {
    const { fixture, container } = renderAugment("v-active");
    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
      fixture.emit("reliability.summary", { source: "kerbalism" });
      fixture.emit("reliability.parts", [
        {
          partId: "p3",
          title: "FL-T400 Tank",
          broken: false,
          critical: false,
          needsRepair: false,
        },
      ]);
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("is source-agnostic, surfaces a Kerbalism needsRepair part", async () => {
    const { fixture } = renderAugment("v-active");
    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
      fixture.emit("reliability.summary", {
        source: "kerbalism",
        malfunction: true,
      });
      fixture.emit("reliability.parts", [
        { partId: "k1", title: "Chemical Plant", needsRepair: true },
      ]);
    });
    expect(await screen.findByText("Chemical Plant")).toBeInTheDocument();
    expect(screen.getByText("1 at risk")).toBeInTheDocument();
  });

  it("has no axe violations on the active row", async () => {
    const { fixture, container } = renderAugment("v-active");
    act(() => {
      fixture.emit("vessel.identity", ACTIVE_IDENTITY);
      fixture.emit("reliability.summary", {
        source: "testflight",
        malfunction: true,
      });
      fixture.emit("reliability.parts", FAILING_PARTS);
    });
    await expectNoA11yViolations(container);
  });
});
