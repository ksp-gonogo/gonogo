/**
 * `StubTransport` moved to `@ksp-gonogo/sitrep-sdk/testing`. It named nothing
 * above the sdk leaf (wire messages, `Meta`, `wrapTopicPayload`), so keeping it
 * here was the only reason an Uplink's transport assertions needed this
 * unpublished package. Re-exported so this package's own ~160 users keep their
 * import site.
 */
export {
  makeMeta,
  observedPayload,
  type SentCommand,
  StubTransport,
  type WireOf,
  wrapWire,
} from "@ksp-gonogo/sitrep-sdk/testing";
