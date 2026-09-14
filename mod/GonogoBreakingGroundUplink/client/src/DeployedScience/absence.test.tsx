import { DeployedPowerState } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import {
  expectNoA11yViolations,
  renderWidget,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { parseBases } from "./index";
import "./index";

/**
 * What the Deployed Base Monitor does with a science figure the mod withheld.
 *
 * `BreakingGroundViewProvider` reads all four through `SnapshotDict.GetDouble`,
 * so each is null when absent, non-numeric or non-finite, and zero is a real
 * reading: a freshly planted experiment reports 0%. The substituted zero drew
 * the card at "0%" with an empty bar AND lit the collecting dot, because
 * `collecting` was `pct < 100` and 0 satisfies it, so an experiment nobody had
 * heard from presented as one gathering nothing while hard at work.
 */

const CARRIED = ["deployed.bases", "game.dlc"];

const flatEntry = (
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  vesselName: "Mun Surface Base",
  partName: "Seismometer",
  body: "Mun",
  situation: "LANDED",
  biome: "Highlands",
  experimentId: "deployedSeismic",
  scienceCompletedPercentage: 50,
  scienceTransmittedPercentage: 50,
  scienceValue: 30,
  scienceLimit: 60,
  powerState: "Powered",
  connectionState: "Connected",
  power: DeployedPowerState.Powered,
  controllerConnected: true,
  powerAvailable: 3,
  powerRequired: 2,
  deployedOnGround: true,
  ...over,
});

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

function mount(entries: Array<Record<string, unknown>>) {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 10,
  });
  const result = renderWidget("deployed-science", {
    instanceId: "ds-absence",
    w: 5,
    h: 9,
    wrapper: fixture.Provider,
  });
  renderedTrees.push(result.unmount);
  act(() => {
    fixture.emit("game.dlc", { breakingGround: true, makingHistory: false });
    fixture.emit("deployed.bases", entries);
  });
  return { fixture, ...result };
}

describe("parseBases: a withheld science figure is not a zero", () => {
  it("withholds progress and the collecting verdict together", () => {
    const parsed = parseBases([
      flatEntry({ scienceCompletedPercentage: null }),
    ]);
    const exp = parsed?.[0]?.experiments[0];
    expect(exp?.progress).toBeNull();
    // Derived as `pct < 100`, which the substituted zero satisfied: the card
    // claimed the experiment was actively collecting.
    expect(exp?.collecting).toBeNull();
  });

  it("withholds the stored and transmitted split when the value is unread", () => {
    const parsed = parseBases([flatEntry({ scienceValue: null })]);
    const exp = parsed?.[0]?.experiments[0];
    expect(exp?.total).toBeNull();
    expect(exp?.transmitted).toBeNull();
    expect(exp?.stored).toBeNull();
  });

  it("keeps a genuine 0% as the reading it is", () => {
    // The distinction the null exists for: a freshly planted experiment.
    const parsed = parseBases([
      flatEntry({ scienceCompletedPercentage: 0, scienceValue: 0 }),
    ]);
    const exp = parsed?.[0]?.experiments[0];
    expect(exp?.progress).toBe(0);
    expect(exp?.collecting).toBe(true);
  });
});

describe("DeployedScience: a withheld progress is withheld on screen", () => {
  it("says the progress is unknown rather than showing 0%", async () => {
    const { container } = mount([
      flatEntry({ scienceCompletedPercentage: null }),
    ]);

    await waitFor(() =>
      expect(visibleText(container)).toContain("Progress unknown"),
    );
    expect(visibleText(container)).not.toContain("0 %");
  });

  it("draws no bar, so nothing reports aria-valuenow 0", async () => {
    mount([flatEntry({ scienceCompletedPercentage: null })]);

    await screen.findByText(/Progress unknown/i);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("does not light the collecting dot for an unread experiment", async () => {
    const { container } = mount([
      flatEntry({ scienceCompletedPercentage: null }),
    ]);

    await screen.findByText(/Progress unknown/i);
    // The dot is aria-hidden, so it is only visible in the markup.
    expect(container.innerHTML).not.toContain("●");
  });

  it("still draws the bar and the dot for a real 0% reading", async () => {
    // The control: 0% is a reading, and it keeps its bar and its dot.
    const { container } = mount([flatEntry({ scienceCompletedPercentage: 0 })]);

    const bar = await screen.findByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("0");
    expect(container.innerHTML).toContain("●");
  });

  it("has no a11y violations with every science figure withheld", async () => {
    const { container } = mount([
      flatEntry({
        scienceCompletedPercentage: null,
        scienceTransmittedPercentage: null,
        scienceValue: null,
        scienceLimit: null,
      }),
    ]);
    await screen.findByText(/Progress unknown/i);
    await expectNoA11yViolations(container);
  });
});

describe("DeployedScience: an unstated power state is not unpowered", () => {
  it("withholds the powered flag rather than reading it as false", () => {
    const parsed = parseBases([flatEntry({ power: null })]);
    expect(parsed?.[0]?.powered).toBeNull();
    expect(parsed?.[0]?.partialPower).toBe(false);
  });

  it("says the power is unknown rather than painting a red Unpowered pill", async () => {
    mount([flatEntry({ power: null, powerState: "Powered" })]);

    await screen.findByText("Mun");
    /* `power === DeployedPowerState.Powered` answered false for an absent
       `power`, and `POWER_TONE.unpowered` is `nogo`, so an unread cluster drew
       the same red pill as a genuinely dark one. */
    expect(screen.queryByText(/Unpowered/i)).toBeNull();
    const pill = screen.getByRole("status");
    expect(pill.textContent).toContain("Power unknown");
    expect(pill.getAttribute("data-tone")).toBe("neutral");
  });

  it("still paints the red pill for a cluster that really is dark", async () => {
    // The control: an actual Unpowered ordinal keeps its `nogo` verdict.
    mount([
      flatEntry({ power: DeployedPowerState.Unpowered, powerState: "Powered" }),
    ]);

    await screen.findByText("Mun");
    const pill = screen.getByRole("status");
    expect(pill.textContent).toContain("Unpowered");
    expect(pill.getAttribute("data-tone")).toBe("nogo");
  });
});

describe("DeployedScience: an unread roster is not an empty one", () => {
  it("says it is waiting rather than claiming nothing is planted", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });
    const result = renderWidget("deployed-science", {
      instanceId: "ds-absence-roster",
      w: 5,
      h: 9,
      wrapper: fixture.Provider,
    });
    renderedTrees.push(result.unmount);
    act(() => {
      // The DLC is present, so the widget cannot blame a missing expansion.
      // Nothing lands on `deployed.bases`, which is what a mod that does not
      // carry the channel looks like, and `parseBases` answers null for it.
      fixture.emit("game.dlc", { breakingGround: true, makingHistory: false });
    });

    await waitFor(() =>
      expect(
        screen.getByText(/Waiting for the deployed-base roster/i),
      ).toBeInTheDocument(),
    );
    // The `?? []` turned that null into an empty array, and the panel then
    // told an operator with four bases on Duna that they had none.
    expect(screen.queryByText(/No deployed bases/i)).toBeNull();
  });

  it("still says the roster is empty when the mod says it is", async () => {
    // The control: an observed empty array IS "nothing planted".
    mount([]);
    await waitFor(() =>
      expect(screen.getByText(/No deployed bases/i)).toBeInTheDocument(),
    );
  });
});
