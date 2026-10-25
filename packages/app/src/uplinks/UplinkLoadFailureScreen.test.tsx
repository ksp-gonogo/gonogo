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
  },
  {
    id: "widget-b",
    name: "widget-b",
    kind: "assembly" as const,
    why: "The game could not start it: missing Foo",
  },
];

describe("UplinkLoadFailureScreen", () => {
  it("names each failing Uplink with why, and the fix, with no way past", async () => {
    const { container } = render(
      <UplinkLoadFailureScreen audience="main" failures={failures} />,
    );
    expect(
      screen.getByRole("heading", {
        name: "2 installed Uplinks failed to load",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Widget A")).toBeInTheDocument();
    expect(screen.getByText(/HTTP 404/)).toBeInTheDocument();
    expect(screen.getByText(/missing Foo/)).toBeInTheDocument();
    expect(
      screen.getByText(/remove the Uplink from the GameData folder/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("tells a station the main screen needs fixing, naming the Uplinks", async () => {
    const { container } = render(
      <UplinkLoadFailureScreen
        audience="station"
        failures={[{ id: "widget-a", name: "Widget A" }]}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "The main screen needs fixing" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Widget A")).toBeInTheDocument();
    expect(screen.queryByText(/GameData/)).not.toBeInTheDocument();
    await expectNoA11yViolations(container);
  });
});
