import type { Transport } from "@ksp-gonogo/sitrep-client";
import { TelemetryClient } from "@ksp-gonogo/sitrep-client";

/**
 * A `TelemetryClient` over a transport you supply, for a test that genuinely
 * needs the client object itself.
 *
 * REACH FOR `setupStreamFixture` FIRST. It gives a transport, a store, a fake
 * wall clock and a mounted `Provider` together, and its verbs (`emit`,
 * `subscribe`, `transport.isSubscribed`, `transport.sentCommands`,
 * `wall.advanceBy`) are what almost every test is actually after. If you find
 * yourself wanting a raw client, the fixture is usually missing a verb, and
 * adding one there is better than every test reassembling the plumbing.
 *
 * A FACTORY, not the class. The class is spine plumbing: it owns the
 * transport, the store, command lifecycle and loss detection, and publishing
 * it would freeze all of that as public API where every future change becomes
 * someone else's breaking change. A factory freezes one call shape instead,
 * which is the whole of what a test depends on.
 */
export function createTestTelemetryClient(
  transport: Transport,
): TelemetryClient {
  return new TelemetryClient(transport);
}
