/**
 * `TimelineStore` moved to `@ksp-gonogo/sitrep-sdk` (`src/spine/`).
 *
 * It is the READ SEMANTICS of a topic: the derived-channel path, the
 * raw-field-subtopic fallback the legacy-key table rides on, epoch handling on
 * a rewind, frame-coherent memoisation. A widget depends on every one of those
 * while it renders, so a test harness that stubbed them would produce tests
 * that pass against a store nobody ships. Its whole transitive import closure
 * was already the sdk and itself, so this is a MOVE, and an Uplink's tests now
 * run the real store rather than a stand-in.
 */
export * from "@ksp-gonogo/sitrep-sdk/spine";
