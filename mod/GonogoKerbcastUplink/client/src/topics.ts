// kerbcast Uplink — bare-primitive Topic ownership.
//
// `kerbcast.available` is a bare JSON boolean (the Uplink's source is `_ => true` /
// `_ => false`, so the wire is a naked boolean, not an object — see ../KerbcastUplink.cs's
// `AvailableTopic`), so it has no named `Sitrep.Contract` payload type for codegen to
// reflect. It is ALSO owned solely by this Uplink. Rather than hand-declare the mod token
// in the shared, mod-agnostic `@ksp-gonogo/sitrep-sdk` facade (the exact "mod-specific line
// in a generic file" leak the Uplink decoupling exists to kill), this Uplink's own client
// package owns it, in two halves that mirror the `SlotRegistry` / `registerComponent` split:
//
//   • TYPE — a `declare module "@ksp-gonogo/sitrep-sdk"` augmentation adds the Topic to
//     `TopicPayloadMap`, so `useTelemetry("kerbcast.available")` resolves to `boolean` in
//     any program that statically imports this module (the accepted Option-A trade-off:
//     a dynamically-loaded Uplink never statically imported types it `unknown` until load).
//   • RUNTIME — `registerBarePrimitiveTopic(...)` at module load feeds the SDK's runtime
//     registry, so `isTopicId` / `getAllKnownTopicIds` enumerate it without the SDK ever
//     naming the string.
//
// kerbcast's camera CONTROL data rides `kerbcast.cameras` (generated, `KerbcastCameraEntry[]`);
// its VIDEO does not ride the Topic stream at all — it stays on kerbcast's own WebRTC path.
//
// `index.ts` imports this module for its side effect (the registration + the ambient
// augmentation), so importing the package wires both halves.

import type { TopicPayload } from "@ksp-gonogo/sitrep-sdk";
import { registerBarePrimitiveTopic } from "@ksp-gonogo/sitrep-sdk";

/**
 * The bare-boolean presence-gate Topic this Uplink publishes. Its value MUST match
 * `KerbcastUplink.AvailableTopic` in ../KerbcastUplink.cs — `topics.test.ts` asserts that.
 */
export const KERBCAST_AVAILABLE_TOPIC = "kerbcast.available";

declare module "@ksp-gonogo/sitrep-sdk" {
  interface TopicPayloadMap {
    "kerbcast.available": boolean;
  }
}

registerBarePrimitiveTopic(KERBCAST_AVAILABLE_TOPIC);

// ── Compile-time invariant (checked by `pnpm build`/`typecheck`) ────────────────────
// Proves the augmentation above is in-program and resolves the Topic to its real payload
// type rather than the `unknown` a missing augmentation would leave. This is the per-Uplink
// half of the SDK's `_AssertNoTopicResolvesToUnknown`, devolved here because the SDK leaf
// cannot see this augmenting module (2026-07-20). Kept inline (type-only, erased at
// runtime) rather than in a `.test-d.ts` — the client's build tsconfig does not exclude
// `*.test-d.ts`, so a separate file would be emitted into `dist`.
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;
export type _ResolvesKerbcastAvailable = Expect<
  Equal<TopicPayload<"kerbcast.available">, boolean>
>;
