import { logger } from "@ksp-gonogo/logger";
import { setupStreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reportSitrepTransportStatus } from "../telemetry/sitrepRuntime";
import { analyticsConsentService } from "./AnalyticsConsentService";
import { ModLogForwarder } from "./ModLogForwarder";

function modLines(): string[] {
  return logger
    .getBuffer()
    .filter((e) => e.tag === "mod")
    .map((e) => e.message);
}

function mount(tail: { lines: string[]; total: number }) {
  const fixture = setupStreamFixture();
  const asked: string[] = [];
  fixture.transport.setCommandHandler((command) => {
    asked.push(command);
    return { success: true, payload: tail };
  });
  render(
    <fixture.Provider>
      <ModLogForwarder />
    </fixture.Provider>,
  );
  return asked;
}

describe("ModLogForwarder", () => {
  beforeEach(() => {
    localStorage.clear();
    logger.clearBuffer();
    logger.setEnabled(true);
    reportSitrepTransportStatus("connected");
  });

  afterEach(() => {
    reportSitrepTransportStatus("disconnected");
    logger.clearBuffer();
    localStorage.clear();
  });

  it("copies the mod's lines into the log while analytics is on", async () => {
    analyticsConsentService.set("enabled");
    mount({
      lines: ["[Gonogo] Started", "[Gonogo] uplinks: 7 loaded"],
      total: 2,
    });

    await waitFor(() =>
      expect(modLines()).toEqual([
        "[mod] [Gonogo] Started",
        "[mod] [Gonogo] uplinks: 7 loaded",
      ]),
    );
    await act(async () => {});
  });

  it("asks the mod for nothing while analytics is off", async () => {
    analyticsConsentService.set("disabled");
    const asked = mount({ lines: ["[Gonogo] Started"], total: 1 });

    await act(async () => {});
    expect(asked).toEqual([]);
    expect(modLines()).toEqual([]);
  });
});
