import { act, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  SETUP_LINKS,
  UPDATE_PULL_COMMAND,
  UPDATE_REMOVE_COMMAND,
} from "../firstRun/setupGuide";
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

  it("tells the operator how to update the container when the app is older", async () => {
    const { container } = render(<ModVersionBanner />);
    await act(async () =>
      reportSitrepHello({
        modVersion: "v1.3.0",
        contractMajor: hostCompat.contractMajor + 1,
        contractMinor: 0,
      }),
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Update this app");
    expect(alert).toHaveTextContent(UPDATE_PULL_COMMAND);
    expect(alert).toHaveTextContent(UPDATE_REMOVE_COMMAND);
    expect(screen.getByRole("link", { name: "upgrade steps" })).toHaveAttribute(
      "href",
      SETUP_LINKS.upgrading,
    );
    await expectNoA11yViolations(container);
  });

  it("gives no container commands when the mod is the older side", async () => {
    render(<ModVersionBanner />);
    await act(async () =>
      reportSitrepHello({
        modVersion: "v1.3.0",
        contractMajor: hostCompat.contractMajor - 1,
        contractMinor: 0,
      }),
    );
    expect(screen.queryByRole("link", { name: "upgrade steps" })).toBeNull();
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
