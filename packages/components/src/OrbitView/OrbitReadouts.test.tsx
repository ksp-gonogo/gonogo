import { type Reading, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { OrbitReadoutGrid } from "./OrbitReadouts";

describe("OrbitReadoutGrid: apsides the frame in force does not have", () => {
  it("suppresses the time-to-apsis rows too, not just the apsis values", () => {
    // A countdown to an apsis that does not exist counts to an event that never happens.
    render(
      <OrbitReadoutGrid
        tight={false}
        narrow={false}
        showInclinationRow
        showApProgressRows
        showEccentricityRows
        apsides="invalid"
        noApsidesHere
        apoapsisAltitude={100_000}
        periapsisAltitude={80_000}
        timeToAp={undefined}
        timeToPe={undefined}
        inclination={undefined}
        eccentricity={undefined}
        period={undefined}
      />,
    );

    expect(screen.getAllByText("no Ap here")).toHaveLength(2);
    expect(screen.getAllByText("no Pe here")).toHaveLength(2);
    expect(screen.getAllByText("no Ap here")[0]).toHaveAttribute(
      "data-tooltip",
      "No apoapsis in this frame",
    );
  });
});

describe("OrbitReadoutGrid: an apoapsis inside the atmosphere", () => {
  const toApoapsis: Reading<Value<"s">> = {
    state: "observed",
    value: value("s", 550),
    atUt: value("ut", 100),
    reckoning: { status: "none" },
  };

  const grid = (apoapsisInAir: boolean) => (
    <OrbitReadoutGrid
      tight={false}
      narrow={false}
      showInclinationRow
      showApProgressRows
      showEccentricityRows
      apsides="valid"
      noApsidesHere={false}
      apoapsisInAir={apoapsisInAir}
      apoapsisAltitude={363.5}
      periapsisAltitude={-1_200}
      timeToAp={toApoapsis}
      timeToPe={undefined}
      inclination={undefined}
      eccentricity={undefined}
      period={undefined}
    />
  );

  it("reads as a figure while nothing says it lies in the air", () => {
    const { container } = render(grid(false));
    expect(visibleText(container)).toContain("363.5");
    expect(visibleText(container)).toContain("9min");
  });

  it("shows neither the apoapsis nor the countdown to it when it lies in the air, since drag decides where the craft goes", () => {
    const { container } = render(grid(true));
    expect(visibleText(container)).not.toContain("363.5");
    expect(visibleText(container)).not.toContain("9min");
  });
});
