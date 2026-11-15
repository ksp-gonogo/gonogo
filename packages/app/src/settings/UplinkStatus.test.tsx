import type { UplinkHealthEntry } from "@ksp-gonogo/sitrep-client";
import { render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { WAITING_FOR_UPLINK_REASON } from "../uplinks/loader";
import type { UplinkLoadOutcome } from "../uplinks/loaderState";
import {
  statusNeedsAttention,
  UplinkClientStatus,
  UplinkHealthReport,
} from "./UplinkStatus";

const loaded: UplinkLoadOutcome = {
  id: "widget-y",
  name: "Widget Y",
  version: "2.0.0",
  status: "loaded",
};

const clientRow = (outcome: UplinkLoadOutcome) =>
  render(
    <ul>
      <UplinkClientStatus outcome={outcome} />
    </ul>,
  );

describe("UplinkClientStatus", () => {
  it("says in words that an unvouched development client is running", async () => {
    const { container } = clientRow({ ...loaded, unvouchedDevClient: true });

    expect(
      screen.getByText(/Unvouched development client\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/nothing checked this code before it ran/),
    ).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("says nothing of the kind for a client its plugin vouched for", () => {
    clientRow(loaded);
    expect(screen.queryByText(/Unvouched/)).toBeNull();
  });

  it("says a client held back by its starting Uplink is waiting, not quarantined", async () => {
    const { container } = clientRow({
      ...loaded,
      status: "waiting",
      reason: WAITING_FOR_UPLINK_REASON,
    });

    expect(screen.getByText("waiting")).toBeInTheDocument();
    expect(screen.getByText(WAITING_FOR_UPLINK_REASON)).toBeInTheDocument();
    expect(screen.queryByText("quarantined")).toBeNull();
    await expectNoA11yViolations(container);
  });

  it("says a client held back because its Uplink is unavailable is not loaded, and leaves the reason to the mod's report", async () => {
    const { container } = clientRow({
      ...loaded,
      status: "quarantined",
      reason: "mod reports Uplink unavailable: Example Mod is not installed",
      refusedOnHealth: true,
    });

    expect(screen.getByText("not loaded")).toBeInTheDocument();
    expect(screen.queryByText("quarantined")).toBeNull();
    expect(screen.queryByText(/Example Mod is not installed/)).toBeNull();
    await expectNoA11yViolations(container);
  });

  it("still says quarantined, with the reason, for a client refused for any other cause", () => {
    clientRow({
      ...loaded,
      status: "quarantined",
      reason: "apiVersion major mismatch",
    });

    expect(screen.getByText("quarantined")).toBeInTheDocument();
    expect(screen.getByText("apiVersion major mismatch")).toBeInTheDocument();
  });
});

const starting: UplinkHealthEntry = {
  id: "example-mod",
  name: "Example Mod",
  version: "1.0.0",
  available: true,
  reason: null,
  contract: null,
  ownedPrefixes: [],
  modSettings: false,
  bundled: false,
  health: {
    state: "starting",
    detail: "Example Mod hasn't finished loading.",
    facts: [],
    preventsStart: false,
  },
};

describe("UplinkHealthReport", () => {
  it("shows a starting Uplink as starting, with what it is waiting for", async () => {
    const { container } = render(
      <ul>
        <UplinkHealthReport entry={starting} />
      </ul>,
    );

    expect(screen.getByText("starting")).toBeInTheDocument();
    expect(
      screen.getByText("Example Mod hasn't finished loading."),
    ).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });
});

describe("statusNeedsAttention", () => {
  it("is raised by a loaded client that is an unvouched development build", () => {
    expect(statusNeedsAttention(undefined, loaded)).toBe(false);
    expect(
      statusNeedsAttention(undefined, { ...loaded, unvouchedDevClient: true }),
    ).toBe(true);
  });
});
