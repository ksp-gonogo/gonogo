import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { StubTransport } from "./stub-transport";
import { useStream } from "./use-stream";

function Alt() {
  const v = useStream<number>("v.alt");
  return <div>alt:{v ?? "—"}</div>;
}

describe("useStream", () => {
  it("renders the latest stream value and updates on new data", async () => {
    const t = new StubTransport();
    const client = new TelemetryClient(t);
    render(
      <TelemetryProvider client={client}>
        <Alt />
      </TelemetryProvider>,
    );
    expect(screen.getByText("alt:—")).toBeTruthy();
    act(() => {
      t.emit("v.alt", 123);
    });
    // `TelemetryProvider` coalesces `beginFrame()` to the next animation
    // frame rather than minting one per ingest, so
    // the re-render lands one frame after the emit, not synchronously.
    await waitFor(() => expect(screen.getByText("alt:123")).toBeTruthy());
  });
});
