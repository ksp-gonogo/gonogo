import { render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { DimmedOverlay } from "./DimmedOverlay";

describe("DimmedOverlay", () => {
  it("renders children directly when show is false", () => {
    render(
      <DimmedOverlay show={false} message="Vessel in flight required">
        <div>live content</div>
      </DimmedOverlay>,
    );
    expect(screen.getByText("live content")).toBeInTheDocument();
    expect(
      screen.queryByText(/Vessel in flight required/i),
    ).not.toBeInTheDocument();
  });

  it("dims children and shows the banner when show is true", () => {
    render(
      <DimmedOverlay show={true} message="Vessel in flight required">
        <div>stale content</div>
      </DimmedOverlay>,
    );
    expect(screen.getByText("stale content")).toBeInTheDocument();
    expect(screen.getByText(/Vessel in flight required/i)).toBeInTheDocument();
  });

  it("renders the optional hint line", () => {
    render(
      <DimmedOverlay
        show={true}
        message="No active save"
        hint="Start a career save to see this"
      >
        <div>x</div>
      </DimmedOverlay>,
    );
    expect(
      screen.getByText(/Start a career save to see this/i),
    ).toBeInTheDocument();
  });
});

describe("DimmedOverlay controls under the banner", () => {
  /** jsdom's focus order ignores `inert`, so the tab behaviour itself is proved in the render harness, in a real engine. */
  it("marks the dimmed controls inert, with no a11y violation", async () => {
    const { container } = render(
      <DimmedOverlay show={true} message="No active save">
        <button type="button">dimmed control</button>
      </DimmedOverlay>,
    );

    expect(
      screen.getByText("dimmed control").closest("[inert]"),
    ).not.toBeNull();
    expect(container.querySelector("[aria-hidden]")).toBeNull();
    await expectNoA11yViolations(container);
  });
});
