import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, it, vi } from "vitest";
import { ReadFrameControl } from "./ReadFrameControl";

describe("ReadFrameControl a11y", () => {
  it("has no axe violations with several offered frames", async () => {
    const { container } = render(
      <ReadFrameControl
        id="rf"
        label="Draw the picture in"
        value={{ kind: "body-centred-inertial", bodyIndex: 1 }}
        options={[
          {
            choice: { kind: "body-centred-inertial", bodyIndex: 1 },
            label: "Hold the sky still",
          },
          {
            choice: { kind: "parent-direction", bodyIndex: 1 },
            label: "Hold the parent still",
          },
          {
            choice: { kind: "follow-control-frame" },
            label: "Follow the in-game view",
          },
        ]}
        onChange={vi.fn()}
        hint="This changes what the axes do."
      />,
    );

    await expectNoA11yViolations(container);
  });
});
