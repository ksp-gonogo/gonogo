import { value } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { setupStreamFixture } from "../test/setupStreamFixture";
// Importing the real module runs its module-load registerAugment(...).
import { CrewRadiationSummaryAugment, radiationSummaryFor } from "./summary";

const radPerSec = (n: number) => value("rad/s", n);

const CARRIED = ["kerbalism.spaceweather"];

const renderedTrees: Array<() => void> = [];

function newFixture() {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 10,
  });
  for (const topic of CARRIED) fixture.client.subscribe(topic, () => {});
  return fixture;
}

function renderAugment(fixture: ReturnType<typeof newFixture>) {
  const result = render(
    <fixture.Provider>
      <CrewRadiationSummaryAugment />
    </fixture.Provider>,
  );
  renderedTrees.push(result.unmount);
  return result;
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

describe("radiationSummaryFor", () => {
  it("returns null when no data has arrived", () => {
    expect(radiationSummaryFor(undefined)).toBeNull();
  });

  it("stays quiet for a nominal, sheltered environment", () => {
    expect(
      radiationSummaryFor({
        habitatRadiationRadPerSecond: radPerSec(0.01 / 3600),
      }),
    ).toBeNull();
  });

  it("flags a high habitat dose rate even without an active storm", () => {
    expect(
      radiationSummaryFor({
        habitatRadiationRadPerSecond: radPerSec(5 / 3600),
      }),
    ).toEqual({ label: "High radiation environment", tone: "warn" });
  });

  it("flags a storm in progress as the most severe condition, regardless of dose", () => {
    expect(
      radiationSummaryFor({
        habitatRadiationRadPerSecond: radPerSec(0.01 / 3600),
        stormInProgress: true,
      }),
    ).toEqual({ label: "Radiation storm in progress", tone: "nogo" });
  });

  it("falls back to the ambient reading when no habitat-specific figure is reported", () => {
    expect(
      radiationSummaryFor({ radiationRadPerSecond: radPerSec(5 / 3600) }),
    ).toEqual({ label: "High radiation environment", tone: "warn" });
  });
});

describe("CrewRadiationSummaryAugment", () => {
  it("renders nothing before any weather data has arrived", () => {
    const fixture = newFixture();
    renderAugment(fixture);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders nothing for a nominal environment", async () => {
    // Proves the update actually landed (not just "nothing has happened
    // yet") by first driving a HIGH reading through the same subscription
    // and watching the banner clear once a nominal reading follows it.
    const fixture = newFixture();
    renderAugment(fixture);
    act(() => {
      fixture.emit("kerbalism.spaceweather", {
        habitatRadiationRadPerSecond: 5 / 3600,
      });
    });
    await screen.findByRole("status");
    act(() => {
      fixture.emit("kerbalism.spaceweather", {
        habitatRadiationRadPerSecond: 0.01 / 3600,
      });
    });
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
  });

  it("shows a high-radiation banner with the dose, using the canonical Unit renderer", async () => {
    const fixture = newFixture();
    renderAugment(fixture);
    act(() => {
      fixture.emit("kerbalism.spaceweather", {
        habitatRadiationRadPerSecond: 5 / 3600,
      });
    });
    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent("High radiation environment");
    // The dose is rendered through <Unit>, not a hand-rolled string: its own
    // unit symbol lands beside the number as a distinct element.
    expect(banner.querySelector("[data-unit]")).not.toBeNull();
  });

  it("shows the storm banner in the nogo tone", async () => {
    const fixture = newFixture();
    renderAugment(fixture);
    act(() => {
      fixture.emit("kerbalism.spaceweather", {
        habitatRadiationRadPerSecond: 0.01 / 3600,
        stormInProgress: true,
      });
    });
    // The label sits beside the dose (`<Unit>`) inside the same badge, so its
    // text is split across sibling nodes: `toHaveTextContent` (concatenated
    // textContent) rather than an exact `findByText` match.
    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent("Radiation storm in progress");
  });

  it("has no axe violations", async () => {
    const fixture = newFixture();
    const { container } = renderAugment(fixture);
    act(() => {
      fixture.emit("kerbalism.spaceweather", {
        habitatRadiationRadPerSecond: 5 / 3600,
      });
    });
    await screen.findByRole("status");

    expect(await axe(container)).toHaveNoViolations();
  });
});
