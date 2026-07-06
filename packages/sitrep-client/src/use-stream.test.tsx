import { act, render, screen } from "@testing-library/react";
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
  it("renders the latest stream value and updates on new data", () => {
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
    expect(screen.getByText("alt:123")).toBeTruthy();
  });
});
