/**
 * The Uplink-handle registry moved to `@ksp-gonogo/sitrep-sdk`.
 *
 * It is an UPLINK's registry: the id it keys on is an Uplink id, and eight
 * Uplink test files call `clearUplinkHandles` between cases. Reaching it meant
 * importing this package, which is `private: true`, so the registry an Uplink is
 * the primary writer of was one an outside author could not read back.
 *
 * It named nothing at all, which is why it moves rather than staying a host
 * shim: the shim existed to reach the app's single instance, and a registry with
 * no dependencies can BE the single instance instead. The state moved to a
 * `globalThis` slot in the same change, for the reason the sdk file gives.
 *
 * Re-exported so this package's importers keep their import site.
 */
export {
  clearUplinkHandles,
  getUplinkHandle,
  registerUplinkHandle,
  unregisterUplinkHandle,
} from "@ksp-gonogo/sitrep-sdk";
