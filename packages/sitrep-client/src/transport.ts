/**
 * The `Transport` contract now lives on `@ksp-gonogo/sitrep-sdk`, which is
 * where it always belonged: it is defined entirely in terms of the sdk's own
 * wire messages (`ClientMessage`/`ServerMessage`) and names nothing above the
 * leaf. Moving it is what lets `StubTransport` ship from the sdk's testing
 * subpath, so an Uplink author can build a transport double without a
 * dependency on this package, which is unpublished.
 *
 * Re-exported rather than re-declared: a second declaration of the same
 * interface is exactly the drift the shared-surface guard exists to prevent.
 */
export type {
  LostCommand,
  Transport,
  TransportStatus,
  UndeliveredCommand,
} from "@ksp-gonogo/sitrep-sdk";
