/**
 * Uplink client identity handles (Uplink Client Contract design §3.1).
 *
 * One handle per client bundle, declared once and imported by every widget/
 * augment the client registers:
 *
 *   // <uplink-repo>/client/src/uplink.ts
 *   export const MY_UPLINK = defineUplinkClient({ id: "my-uplink", version: "0.0.0-dev", name: "My Uplink" });
 *   registerComponent({ ...def, owner: MY_UPLINK });
 *
 * `defineUplinkClient` is the explicit-handle model (confirmed with the
 * operator over an ambient "currently importing uplink", fragile under
 * static imports, and doesn't survive the loader's dynamic `import()`
 * case). It both returns the frozen handle a registration stamps onto
 * `owner`, AND records the client in a module-level registry so the app can
 * enumerate which Uplink clients are actually present in this build (the
 * membership half: health/settings UI grows off this same registry).
 *
 * Mod-agnostic like `uplinkHandles.ts`: never import a mod-specific type or
 * hardcode a mod name here.
 */

export interface UplinkClientHandle {
  /** MUST match the mod's `[SitrepUplink("<id>")]` id and its gonogo-uplink.json id. */
  id: string;
  /** The Uplink's one version line (mod + client, spec §5). Phase 1: a
   *  per-client placeholder constant; Phase 2 build-injects it. */
  version: string;
  /** Human label for management/health surfaces. */
  name: string;
}

const clients = new Map<string, UplinkClientHandle>();

/**
 * Declare a client's identity and record it in the client registry. Returns
 * a frozen handle: stamp it as `owner` on every `registerComponent`/
 * `registerAugment` call the client makes.
 *
 * Best-effort on re-declaration under the same id: last-write-wins (a plain
 * `Map.set`), matching `registerUplinkHandle`'s overwrite semantics rather
 * than `registerComponent`'s throw-on-collision. A client's own `uplink.ts`
 * re-evaluating (HMR, a test re-importing the module after `resetModules`)
 * is a benign, common case for a single-owner declaration, there is no
 * cross-package collision risk to guard against the way there is for widget
 * ids shared across a flat namespace.
 */
export function defineUplinkClient(
  cfg: UplinkClientHandle,
): UplinkClientHandle {
  const handle = Object.freeze({ ...cfg });
  clients.set(handle.id, handle);
  return handle;
}

/** Every declared Uplink client, in registration order. */
export function getUplinkClients(): UplinkClientHandle[] {
  return Array.from(clients.values());
}

/** Remove every declared client. For use in tests only. */
export function clearUplinkClients(): void {
  clients.clear();
}
