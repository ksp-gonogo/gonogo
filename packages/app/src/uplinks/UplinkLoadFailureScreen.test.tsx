import { render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { UplinkLoadFailureScreen } from "./UplinkLoadFailureScreen";

const failures = [
  {
    id: "widget-a",
    name: "Widget A",
    kind: "client" as const,
    why: "Its client could not be loaded: HTTP 404",
    fix: "Update the Uplink, or remove it from GameData.",
  },
  {
    id: "widget-b",
    name: "widget-b",
    kind: "assembly" as const,
    why: "The game could not start it: missing Foo",
    fix: null,
  },
];

describe("UplinkLoadFailureScreen", () => {
  it("names each failing Uplink with why, and the fix, with no way past", async () => {
    const { container } = render(
      <UplinkLoadFailureScreen audience="main" failures={failures} />,
    );
    expect(
      screen.getByRole("heading", {
        name: "Gonogo can't start",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Widget A")).toBeInTheDocument();
    expect(screen.getByText(/HTTP 404/)).toBeInTheDocument();
    expect(screen.getByText(/missing Foo/)).toBeInTheDocument();
    expect(
      screen.getByText(/Update the Uplink, or remove it from GameData/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("shows a tagged Uplink's own words alone, with no fix line of Gonogo's", () => {
    render(
      <UplinkLoadFailureScreen
        audience="main"
        failures={[
          {
            id: "widget-c",
            name: "Widget C",
            kind: "reported",
            why: "Install the partner mod, then restart KSP",
            fix: null,
          },
        ]}
      />,
    );
    expect(
      screen.getByText("Install the partner mod, then restart KSP"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Update the/)).not.toBeInTheDocument();
  });

  it("tells a station the main screen cannot start, naming the Uplinks", async () => {
    const { container } = render(
      <UplinkLoadFailureScreen
        audience="station"
        failures={[{ id: "widget-a", name: "Widget A" }]}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "The main screen can't start" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Widget A")).toBeInTheDocument();
    expect(screen.queryByText(/GameData/)).not.toBeInTheDocument();
    await expectNoA11yViolations(container);
  });
});
