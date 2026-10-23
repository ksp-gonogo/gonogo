import {
  TelemetryClient,
  TelemetryProvider,
  useStream,
} from "@ksp-gonogo/sitrep-client";
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { ModalProvider } from "@ksp-gonogo/ui";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AlarmsFab } from "./AlarmsFab";

function Reader() {
  const reading = useStream<number>("v.alt");
  const value =
    reading.state === "observed" || reading.state === "held"
      ? reading.value
      : undefined;
  return <div data-testid="reader">{value === undefined ? "none" : value}</div>;
}

describe("AlarmsFab", () => {
  it("gives the modal it opens the live telemetry client, though the modal portals outside the screen's provider", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    render(
      <ModalProvider>
        <TelemetryProvider client={client}>
          <div />
        </TelemetryProvider>
        <AlarmsFab
          bottom={0}
          useSnapshot={() => ({ alarms: [] }) as never}
          onAdd={() => {}}
          onUpdate={() => {}}
          onDelete={() => {}}
          ModalComponent={Reader as never}
        />
      </ModalProvider>,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Mission alarms" }),
    );
    act(() => {
      transport.emit("v.alt", 42);
    });
    await waitFor(() =>
      expect(screen.getByTestId("reader")).toHaveTextContent("42"),
    );
    client.dispose();
  });
});
