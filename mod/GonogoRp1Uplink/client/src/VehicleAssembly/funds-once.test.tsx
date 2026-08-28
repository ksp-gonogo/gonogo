import { registerAugment } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  render,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { WidgetHost } from "@ksp-gonogo/ui-kit/testing";
import { beforeAll, describe, expect, it } from "vitest";
import { VehicleAssembly } from "./index";
import { VEHICLE_ASSEMBLY_SECTIONS } from "./slot";

/**
 * The funds rule, in the one place this widget meets it.
 *
 * <para>The repo rule is that a spend control is never visible without a
 * balance visible in the same WIDGET. Every control in this one spends or
 * refunds: a rollout is billed as the vehicle moves, a scrap pays the vehicle
 * back, and a repeat buys another. None of the sections carrying those controls
 * draws a balance, because a widget that printed the same number under three
 * headings is what the Space Center already did and the operator read the
 * repetition as the defect it was.</para>
 *
 * <para>So the whole rule rests on the host, and no section's own tests can see
 * it break. That is what this file holds, and it is asked of a section that is
 * NOT one of the widget's own: an outside Uplink adding a spend control to this
 * slot is covered by the same one balance, and a check that only ever saw the
 * built-in two would not say so.</para>
 */

const TOPICS = [
  "rp1.available",
  "rp1.warehouse",
  "rp1.buildQueue",
  "rp1.complexes",
  "rp1.pads",
  "rp1.operations",
  "career.status",
];

/** A stand-in for any Uplink section that spends: it exists and it is findable. */
const SPENDING_SECTION_TEXT = "a contributed section with a spend control";

beforeAll(() => {
  registerAugment({
    id: "rp1-vehicle-assembly-funds-probe",
    augments: VEHICLE_ASSEMBLY_SECTIONS,
    component: () => <div>{SPENDING_SECTION_TEXT}</div>,
  });
});

function mount() {
  const fixture = setupStreamFixture({ carriedChannels: TOPICS });
  render(
    <fixture.Provider>
      <WidgetHost widgetId="rp1-vehicle-assembly">
        <VehicleAssembly />
      </WidgetHost>
    </fixture.Provider>,
  );
  return fixture;
}

describe("VehicleAssembly draws the balance wherever a section can spend", () => {
  it("draws exactly one balance, however many sections contribute", async () => {
    // Three sections is the shipped configuration once anyone augments this
    // slot, and a second copy of the balance is what the count shows up in.
    const fixture = mount();
    act(() => {
      fixture.emit("rp1.available", true);
    });
    act(() => {
      fixture.emit("career.status", {
        economy: { funds: 500_000, reputation: 0, science: 0 },
      });
      fixture.emit("rp1.complexes", []);
      fixture.emit("rp1.pads", []);
      fixture.emit("rp1.operations", []);
      fixture.emit("rp1.warehouse", []);
      fixture.emit("rp1.buildQueue", []);
    });

    // Waited on the BALANCE and asserted on the section: the section mounts off
    // the registry and is on screen from the first frame, so waiting on it
    // would let the balance be checked a tick before the career record lands
    // and fail for a reason that is not the one under test.
    await waitFor(() => {
      expect(screen.getAllByTitle("Available funds")).toHaveLength(1);
    });
    // Two facts of DIFFERENT KINDS on purpose. That one balance exists is one;
    // that a spending section is on screen at the same moment is the other,
    // because a state in which the slot renders nothing would satisfy a
    // presence check while proving nothing at all.
    expect(screen.getByText(SPENDING_SECTION_TEXT)).toBeInTheDocument();
  });

  it("draws no balance at all where it draws no controls", async () => {
    // The other direction, and the reason this is not just a presence check: a
    // widget that printed a balance on a stock install would be advertising a
    // spend surface RP-1 is not there to serve.
    const fixture = mount();
    act(() => {
      fixture.emit("rp1.available", false);
    });

    await waitFor(() => {
      expect(fixture.transport.isSubscribed("rp1.available")).toBe(true);
    });
    expect(screen.queryByTitle("Available funds")).toBeNull();
    expect(screen.queryByText(SPENDING_SECTION_TEXT)).toBeNull();
  });
});
