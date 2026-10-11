import { type CommsHop, value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { CommsPathRoute } from "./CommsPathRoute";

function hop(overrides: Partial<CommsHop>): CommsHop {
  return {
    from: "Probe",
    to: "home",
    kind: 0,
    fromIsHome: false,
    toIsHome: true,
    ...overrides,
  };
}

function mount(hops: CommsHop[]) {
  return render(
    <CommsPathRoute
      hops={hops}
      vesselLabel="Probe"
      centreLabel="KSC"
      pathDelay={value("s", 1)}
      rateByHopId={new Map()}
      rateMarkingByHopId={new Map()}
    />,
  );
}

describe("CommsPathRoute leg detail", () => {
  it("draws a measured distance", () => {
    mount([hop({ distanceMeters: value("m", 419_000) })]);
    expect(screen.getByText(/419/)).toBeTruthy();
  });

  it("marks an unmeasured distance with the absence dash", () => {
    const { container } = mount([hop({ distanceMeters: null })]);
    expect(container.textContent).not.toMatch(/NaN|null|undefined/);
    expect(container.textContent).toBe(`RouteProbe${NULL_DISPLAY}KSC`);
  });
});
