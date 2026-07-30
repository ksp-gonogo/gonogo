import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { FramedDisplay } from "./FramedDisplay";

describe("FramedDisplay", () => {
  it("renders its visual content", () => {
    render(
      <FramedDisplay>
        <svg aria-label="diagram" />
      </FramedDisplay>,
    );
    expect(screen.getByLabelText("diagram")).toBeInTheDocument();
  });

  it("forwards div props so it can be laid out by the caller", () => {
    // The caller decides how much room the visual gets; the frame never
    // sizes itself.
    const { container } = render(<FramedDisplay className="probe" />);
    expect(container.querySelector(".probe")).not.toBeNull();
  });
});
