import type { TelemetryClient } from "@ksp-gonogo/sitrep-sdk";
/**
 * Render helper for delayed-command widgets under test. Mounts a REAL
 * `TelemetryClient` over an in-memory `StubTransport` inside a
 * `TelemetryProvider`, so `useCommand().send()` dispatches for real and the
 * command envelope lands in `transport.sentCommands` verbatim. No module mocks:
 * the widget, the hook, and the client all run; only the wire is a stub (the
 * testing-philosophy default for this repo).
 *
 * Returns the `transport` (assert on `sentCommands`) and the `client`; queries
 * go through the global `screen`, so the RTL result is intentionally NOT spread
 * (its inferred type leaks `pretty-format` across the package boundary).
 */

import {
  createTestTelemetryClient,
  render,
  StubTransport,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-sdk/testing";
import type { ReactElement } from "react";

export interface CommandClientHarness {
  transport: StubTransport;
  client: TelemetryClient;
}

export function renderWithCommandClient(
  ui: ReactElement,
): CommandClientHarness {
  const transport = new StubTransport();
  // Answer every command so the in-flight → confirmed lifecycle settles cleanly
  // (echoing the request), rather than leaving a dangling in-flight command.
  transport.setCommandHandler((command, args) => ({ command, args }));
  const client = createTestTelemetryClient(transport);
  render(<TelemetryProvider client={client}>{ui}</TelemetryProvider>);
  return { transport, client };
}
