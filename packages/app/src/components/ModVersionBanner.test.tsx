import { act, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  reportSitrepHello,
  resetSitrepRuntimeForTests,
} from "../telemetry/sitrepRuntime";
import { hostCompat } from "../uplinks/hostCompat";
import { ModVersionBanner } from "./ModVersionBanner";

afterEach(() => resetSitrepRuntimeForTests());

describe("ModVersionBanner", () => {
  it("shows nothing before the mod has said hello", () => {
    const { container } = render(<ModVersionBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing when the contracts agree", async () => {
    const { container } = render(<ModVersionBanner />);
    await act(async () =>
      reportSitrepHello({
        modVersion: "v1.4.0",
        contractMajor: hostCompat.contractMajor,
        contractMinor: hostCompat.contractMinor,
      }),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("warns, naming both sides, when the mod's major is older", async () => {
    const { container } = render(<ModVersionBanner />);
    await act(async () =>
      reportSitrepHello({
        modVersion: "v1.3.0",
        contractMajor: hostCompat.contractMajor - 1,
        contractMinor: 0,
      }),
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("mod 1.3.0");
    expect(alert).toHaveTextContent(`contract ${hostCompat.contractMajor - 1}`);
    expect(alert).toHaveTextContent("Update the mod");
    await expectNoA11yViolations(container);
  });

  it("warns that an old mod sending no version is too old to say", async () => {
    render(<ModVersionBanner />);
    await act(async () => reportSitrepHello({}));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "too old to report its version",
    );
  });

  it("stays quiet for a minor difference", async () => {
    const { container } = render(<ModVersionBanner />);
    await act(async () =>
      reportSitrepHello({
        contractMajor: hostCompat.contractMajor,
        contractMinor: hostCompat.contractMinor + 1,
      }),
    );
    expect(container).toBeEmptyDOMElement();
  });
});
