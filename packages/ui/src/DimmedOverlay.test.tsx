import { render, screen } from "@ksp-gonogo/test-utils";
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
    // Children still rendered (legible enough to verify shape) but the
    // banner is now visible too.
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
