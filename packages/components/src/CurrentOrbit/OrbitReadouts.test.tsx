import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { OrbitReadoutGrid } from "./OrbitReadouts";

describe("OrbitReadoutGrid: apsides the frame in force does not have", () => {
  it("suppresses the time-to-apsis rows too, not just the apsis values", () => {
    // A countdown to an apsis that does not exist counts to an event that never happens.
    render(
      <OrbitReadoutGrid
        tight={false}
        narrow={false}
        isLandscape={false}
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
      "title",
      "No apoapsis in this frame",
    );
  });
});
