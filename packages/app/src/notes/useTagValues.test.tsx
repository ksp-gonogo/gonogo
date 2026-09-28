import { TelemetryClient, TelemetryProvider } from "@ksp-gonogo/sitrep-client";
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, renderHook, waitFor } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { useTagValues } from "./useTagValues";

// A note body's tags read straight off the stream.
function withProvider(client: TelemetryClient) {
  return ({ children }: { children: ReactNode }) => (
    <TelemetryProvider client={client}>{children}</TelemetryProvider>
  );
}

describe("note tag values", () => {
  it("resolves a tag whose topic the allowlist omits, because there is no fallback for the gate to prefer", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    const tags = ["vessel.control.throttle"];
    const { result } = renderHook(() => useTagValues(tags), {
      wrapper: withProvider(client),
    });

    act(() => transport.emit("vessel.control", { throttle: 0.75 }));

    // RED before the gate was dropped: the tag never subscribed, so this stayed empty for the life of the note.
    await waitFor(() =>
      expect(result.current.get("vessel.control.throttle")).toBeDefined(),
    );
  });

  it("does not re-render on animation frames that leave every tag's value unchanged", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const tags = ["vessel.control.throttle"];
    let renders = 0;

    const { result } = renderHook(
      () => {
        renders += 1;
        return useTagValues(tags);
      },
      { wrapper: withProvider(client) },
    );

    act(() => transport.emit("vessel.control", { throttle: 0.75 }));
    await waitFor(() =>
      expect(result.current.get("vessel.control.throttle")).toMatchObject({
        magnitude: 0.75,
      }),
    );

    const settled = renders;
    for (let i = 0; i < 5; i++) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    }

    expect(renders).toBe(settled);
    expect(result.current.get("vessel.control.throttle")).toMatchObject({
      magnitude: 0.75,
    });
  });

  it("leaves a tag naming no topic at all unresolved, which is the only thing that should render as nothing", () => {
    const client = new TelemetryClient(new StubTransport());

    const { result } = renderHook(() => useTagValues(["not.a.real.field"]), {
      wrapper: withProvider(client),
    });

    expect(result.current.get("not.a.real.field")).toBeUndefined();
  });
});
