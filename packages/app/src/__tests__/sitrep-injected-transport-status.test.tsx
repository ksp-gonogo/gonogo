import { clearRegistry, registerDataSource } from "@ksp-gonogo/core";
import type { TransportStatus } from "@ksp-gonogo/sitrep-sdk";
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sitrepStreamSource } from "../dataSources/sitrep";
import { SitrepTelemetryProvider } from "../telemetry/SitrepTelemetryProvider";
import {
  getSitrepTransportStatus,
  resetSitrepRuntimeForTests,
} from "../telemetry/sitrepRuntime";

/**
 * A pilot or station screen never opens a socket to the game: it reads the
 * host's stream over the peer link through an injected transport. The
 * "Telemetry stream" source that gates every instrument and the offline banner
 * must report that link, not the absent direct socket.
 */

class LinkTransport extends StubTransport {
  private readonly listeners = new Set<(status: TransportStatus) => void>();
  private current: TransportStatus = "connected";

  constructor() {
    super();
    Object.defineProperty(this, "status", { get: () => this.current });
  }

  override onStatusChange(listener: (status: TransportStatus) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  move(status: TransportStatus) {
    this.current = status;
    for (const listener of this.listeners) listener(status);
  }
}

beforeEach(() => {
  registerDataSource(sitrepStreamSource);
});
afterEach(() => {
  clearRegistry();
  resetSitrepRuntimeForTests();
});

describe("SitrepTelemetryProvider with an injected transport", () => {
  it("reports the stream connected while the injected link is up", () => {
    render(
      <SitrepTelemetryProvider transport={new LinkTransport()}>
        <div />
      </SitrepTelemetryProvider>,
    );
    expect(getSitrepTransportStatus()).toBe("connected");
  });

  it("follows the injected link when it drops and returns", async () => {
    const link = new LinkTransport();
    render(
      <SitrepTelemetryProvider transport={link}>
        <div />
      </SitrepTelemetryProvider>,
    );
    await act(async () => link.move("disconnected"));
    expect(getSitrepTransportStatus()).toBe("disconnected");
    await act(async () => link.move("connected"));
    expect(getSitrepTransportStatus()).toBe("connected");
  });
});
