import { logger } from "@ksp-gonogo/logger";
import { renderHook } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { PeerClientService } from "../peer/PeerClientService";
import type { PeerMessage } from "../peer/protocol";
import { useFollowHostAnalytics } from "./useFollowHostAnalytics";

/** The client's private message intake, driven here the way the data channel would. */
function deliver(client: PeerClientService, message: PeerMessage): void {
  const intake: unknown = Reflect.get(client, "handleMessage");
  if (typeof intake !== "function") throw new Error("no message intake");
  intake.call(client, message);
}

describe("useFollowHostAnalytics", () => {
  afterEach(() => logger.setRunId(undefined));

  it("stamps the main screen's run while it has analytics on, and drops it on unmount", () => {
    const client = new PeerClientService();
    const { unmount } = renderHook(() => useFollowHostAnalytics(client));
    expect(logger.getRunId()).toBeUndefined();

    deliver(client, {
      type: "analytics-consent",
      enabled: true,
      runId: "run-a",
    });
    expect(logger.getRunId()).toBe("run-a");

    unmount();
    expect(logger.getRunId()).toBeUndefined();
  });
});
