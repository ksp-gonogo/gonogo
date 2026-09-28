import { clearRegistry, useTelemetry } from "@ksp-gonogo/core";
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import {
  act,
  probeText,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { beforeEach, describe, expect, it } from "vitest";
import { SitrepTelemetryProvider } from "../telemetry/SitrepTelemetryProvider";

/**
 * Mounting `<SitrepTelemetryProvider enabled>` makes a Topic read come off the
 * streaming pipeline. Nothing internal is mocked: the real provider, a real
 * `TelemetryClient`/`TimelineStore` and the real hook all run, fed by the SDK's
 * scriptable in-memory `StubTransport`. The live `WebSocketTransport` variant is
 * `sitrep-stream-wire.test.tsx`.
 */

beforeEach(() => clearRegistry());

function Throttle() {
  const reading = useTelemetry("vessel.control");
  const throttle =
    reading.state === "observed" ? reading.value.throttle : undefined;
  return (
    <div>throttle:{throttle == null ? NULL_DISPLAY : probeText(throttle)}</div>
  );
}

describe("SitrepTelemetryProvider: enabled-prop stream mount", () => {
  it("a Topic read comes off the stream pipeline", async () => {
    const transport = new StubTransport();

    render(
      <SitrepTelemetryProvider enabled transport={transport}>
        <Throttle />
      </SitrepTelemetryProvider>,
    );

    expect(screen.getByText(`throttle:${NULL_DISPLAY}`)).toBeTruthy();

    act(() => transport.emit("vessel.control", { throttle: 0.75 }));
    await waitFor(() => expect(screen.getByText("throttle:0.75")).toBeTruthy());
  });

  it("when disabled, renders children untouched and the read stays pending", () => {
    render(
      <SitrepTelemetryProvider enabled={false}>
        <Throttle />
      </SitrepTelemetryProvider>,
    );

    expect(screen.getByText(`throttle:${NULL_DISPLAY}`)).toBeTruthy();
  });
});
