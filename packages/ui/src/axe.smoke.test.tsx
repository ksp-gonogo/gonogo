import { render } from "@testing-library/react";
import { useEffect } from "react";
import { describe, it } from "vitest";
import { Button, GhostButton, IconButton, PrimaryButton } from "./Button";
import { ModalProvider, useModal } from "./Modal";
import { SignalLossBanner } from "./SignalLossBanner";
import { Switch } from "./Switch";
import { Tabs } from "./Tabs";
import { axe } from "./test/axe";

describe("a11y smoke (jest-axe)", () => {
  it("Button variants have no axe violations", async () => {
    const { container } = render(
      <>
        <Button>Go</Button>
        <PrimaryButton>Primary</PrimaryButton>
        <GhostButton>Ghost</GhostButton>
        <IconButton aria-label="close">×</IconButton>
      </>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("Modal (open) has no axe violations", async () => {
    function Harness() {
      const { open } = useModal();
      useEffect(() => {
        open(<p>Dialog body</p>, { title: "Demo modal" });
      }, [open]);
      return null;
    }
    const { container } = render(
      <ModalProvider>
        <Harness />
      </ModalProvider>,
    );
    const results = await axe(container.ownerDocument.body);
    expect(results).toHaveNoViolations();
  });

  it("Tabs have no axe violations", async () => {
    const { container } = render(
      <Tabs
        tabs={[
          { id: "one", label: "One", content: <span>panel 1</span> },
          { id: "two", label: "Two", content: <span>panel 2</span> },
        ]}
        activeId="one"
        onChange={() => undefined}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("Switch has no axe violations", async () => {
    const { container } = render(
      <Switch checked={false} onChange={() => undefined} label="Follow" />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("SignalLossBanner has no axe violations", async () => {
    const { container } = render(
      <SignalLossBanner state="lost" elapsedMs={12345} />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
