import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  useStream,
} from "@ksp-gonogo/sitrep-client";
import { act, cleanup, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { ModalTelemetryBridge } from "./ModalTelemetryBridge";

function AltitudeReader() {
  const value = useStream<number>("v.alt");
  return (
    <div data-testid="altitude">
      {value === undefined ? "no-client" : String(value)}
    </div>
  );
}

/**
 * Stands in for the real app topology `ModalTelemetryBridge`'s own doc
 * comment describes: the app's own `TelemetryProvider` (here, a stand-in for
 * `SitrepTelemetryProvider`) and a modal's `ModalTelemetryBridge` are
 * SIBLINGS, not ancestor/descendant — a portal preserves the call site's
 * context, not the app provider's. `connected` toggles the app provider's
 * mount, standing in for the moment the Sitrep client actually connects.
 */
function Harness({
  connected,
  client,
}: {
  connected: boolean;
  client: TelemetryClient;
}) {
  return (
    <>
      {connected && (
        <TelemetryProvider client={client}>
          <div />
        </TelemetryProvider>
      )}
      <ModalTelemetryBridge>
        <AltitudeReader />
      </ModalTelemetryBridge>
    </>
  );
}

/**
 * Regression guard for the first-run auto-open hang: the Uplink Hub wizard
 * can open its Settings modal BEFORE the app's `TelemetryProvider` has
 * mounted (the client hasn't connected yet). A one-shot
 * `getActiveTelemetryClient()` read at `ModalTelemetryBridge`'s own render
 * would capture `undefined` at that moment and never re-render, leaving
 * every telemetry read inside the modal (e.g. the wizard's `useUplinkGap`,
 * which reads `system.uplinks` via `useStream`) permanently unavailable —
 * "Checking installed Uplinks..." forever, confirmed live on the Deck.
 */
describe("ModalTelemetryBridge — recovers once the client connects after the modal has already rendered", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders children with no telemetry context before connection, then provides the client the moment it appears", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    const { rerender } = render(<Harness connected={false} client={client} />);

    // No `TelemetryProvider` mounted anywhere yet: the bridge passes
    // children through untouched, so the child read is unavailable.
    expect(screen.getByTestId("altitude")).toHaveTextContent("no-client");

    // The Sitrep client connects a moment later — the app's own provider
    // mounts, as a SIBLING of the already-rendered bridge (matching the
    // real portal topology), not a remount of the modal itself.
    rerender(<Harness connected={true} client={client} />);

    // Proof the bridge picked this up WITHOUT the modal being closed/
    // reopened: a value emitted now must reach the child's `useStream` read,
    // which is only possible if `ModalTelemetryBridge` re-rendered, wrapped
    // `children` in its own `TelemetryProvider`, and that provider's context
    // reached `AltitudeReader` in time for it to subscribe. A one-shot
    // `getActiveTelemetryClient()` read (the pre-fix behaviour) would have
    // left the bridge rendering children with no provider at all, forever,
    // so this value could never arrive.
    act(() => {
      transport.emit("v.alt", 12345);
    });
    await waitFor(() =>
      expect(screen.getByTestId("altitude")).toHaveTextContent("12345"),
    );

    client.dispose();
  });
});
