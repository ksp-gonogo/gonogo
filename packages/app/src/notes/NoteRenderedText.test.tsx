import { TelemetryClient, TelemetryProvider } from "@ksp-gonogo/sitrep-client";
import { SITUATION_NAMES } from "@ksp-gonogo/sitrep-sdk";
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { NoteRenderedText } from "./NoteRenderedText";

function renderNote(body: string, transport: StubTransport) {
  const client = new TelemetryClient(transport);
  render(
    <TelemetryProvider client={client}>
      <p data-testid="note">
        <NoteRenderedText body={body} />
      </p>
    </TelemetryProvider>,
  );
}

describe("a note tag naming an enum", () => {
  it("prints an enum the wire carries by ordinal as its member's name", async () => {
    const transport = new StubTransport();
    renderNote("Now {{vessel.identity.situation}}", transport);

    act(() => transport.emit("vessel.identity", { situation: 2 }));

    expect(await screen.findByText(`Now ${SITUATION_NAMES[2]}`)).toBeTruthy();
  });

  it("prints an enum the wire carries by name as that name", async () => {
    const transport = new StubTransport();
    renderNote("Last {{commcast.traffic.kind}}", transport);

    act(() => transport.emit("commcast.traffic", { kind: "text" }));

    expect(await screen.findByText("Last text")).toBeTruthy();
  });
});

describe("a note tag naming a quantity", () => {
  it("prints a Value through the same Unit formatting every other readout uses, not its JSON shape", async () => {
    const transport = new StubTransport();
    renderNote("Throttle {{vessel.control.throttle}}", transport);

    act(() => transport.emit("vessel.control", { throttle: 0.75 }));

    expect(await screen.findByText("Throttle 75 %")).toBeTruthy();
    expect(screen.queryByText(/magnitude/)).toBeNull();
  });
});
