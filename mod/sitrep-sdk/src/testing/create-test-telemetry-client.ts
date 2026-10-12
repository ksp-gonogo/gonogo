import type { Transport } from "../api/transport";
import { TelemetryClient } from "../spine";

/**
 * A {@link TelemetryClient} over a transport you supply, for a test that needs
 * the client itself.
 *
 * Try {@link setupStreamFixture} first: it gives a transport, a store, a fake
 * wall clock and a `Provider` together, and covers what most tests need. Useful
 * for testing code that reads or sends through a telemetry client directly.
 *
 * @category Stream fixture
 */
export function createTestTelemetryClient(
  transport: Transport,
): TelemetryClient {
  return new TelemetryClient(transport);
}
