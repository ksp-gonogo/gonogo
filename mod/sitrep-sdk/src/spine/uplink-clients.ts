import type { ContributionDefinition } from "../api/types";
import type { ReckonerFor } from "../reading";
import type { DerivedChannelDefinition } from "../timeline";
import { contributeDerivedChannel } from "./contributed-channels";
import { registerContribution } from "./contributions";
import type {
  Dep,
  ProcessorFrame,
  ProcessorHandle,
  ResolvedDeps,
} from "./processors";
import { defineProcessor } from "./processors";
import { registerReckoner } from "./reckoners";

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
 * Mod-agnostic like `api/uplink-handles.ts`: never import a mod-specific type or
 * hardcode a mod name here.
 *
 * This is the ONE declaration of the handle. `api/types.ts` used to carry a second,
 * deliberately loose "name+arity probe" copy with five `any`s, because the leaf
 * could not name `ResolvedDeps`, `ReckonerFor`, `DerivedChannelDefinition` or
 * `ProcessorHandle`. All four are sdk-side now, so the apology no longer applies
 * and the probe is gone: `api/types.ts` re-exports this one instead. Two
 * declarations of a handle whose methods were typed `any` on one side is the
 * divergence shape that cannot fail loudly, which is the same reason the
 * contribution declaration-merge seam was collapsed to one.
 */
export interface UplinkClientHandle {
  /** MUST match the mod's `[SitrepUplink("<id>")]` id and its gonogo-uplink.json id. */
  id: string;
  /** The Uplink's one version line (mod + client, spec §5). Phase 1: a
   *  per-client placeholder constant; Phase 2 build-injects it. */
  version: string;
  /** Human label for management/health surfaces. */
  name: string;
  /**
   * Register a contribution auto-namespaced to this client (contribution-
   * slots-spec §14): `def.id` is stamped `${this.id}:${def.id}` before it
   * reaches the flat ContributionRegistry, so two Uplinks can never collide
   * on a local id. Throws synchronously at THIS call site (registerContribution's
   * own collision check) on a genuine id clash within one client's own ids.
   */
  registerContribution<S extends string>(
    def: Omit<ContributionDefinition<S>, "owner">,
  ): void;
  /**
   * Register a Processor auto-namespaced to this client (mirrors
   * registerContribution's owner-stamping). `defineProcessor` takes a plain
   * string owner rather than a handle, so this method is the bridge that lets a
   * client call it by handle instead of by hand-typed id.
   */
  registerProcessor<const Deps extends readonly Dep[], R>(def: {
    id: string;
    deps: Deps;
    compute: (values: ResolvedDeps<Deps>, frame: ProcessorFrame) => R;
  }): ProcessorHandle<R>;
  /**
   * Register this client's forward model for a Topic (same bridge shape as
   * registerProcessor: the owner is passed to the registry as a plain id).
   *
   * Which client owns a model is not a matter of style: only the Uplink that
   * owns a Topic knows the physics behind it, and a topic two clients both
   * claim is served with NO model rather than whichever loaded last. Going
   * through the handle is what makes the owner a stamped field the boundary
   * ratchet and a health surface can read, instead of a hand-typed string.
   */
  registerReckoner<T>(topic: string, reckoner: ReckonerFor<T>): void;
  /**
   * Contribute a derived channel owned by this client.
   *
   * A derived channel is the only mechanism that can join two Topics, so it is
   * what a model needs whenever its inputs are split across them: projecting a
   * consumable wants an amount and a capacity from the generic resource Topic
   * and a rate from whichever Uplink models the consumption, a split the
   * contract makes deliberately. A per-Topic reckoner is handed one point and
   * cannot see across it.
   *
   * Registered after core's own, so an Uplink cannot take over a Topic core
   * already derives, and per (topic, owner), so two Uplinks claiming one Topic
   * yields neither.
   */
  registerDerivedChannel<T>(def: DerivedChannelDefinition<T>): void;
}

/**
 * One global slot rather than a module static, for the same reason every other
 * registry that moved here has one: a second copy is a declared client the
 * health and settings surfaces never enumerate, with no error anywhere.
 */
const UPLINK_CLIENTS_KEY = "__GONOGO_UPLINK_CLIENTS__" as const;

function clients(): Map<string, UplinkClientHandle> {
  const slot = globalThis as typeof globalThis & {
    [UPLINK_CLIENTS_KEY]?: Map<string, UplinkClientHandle>;
  };
  slot[UPLINK_CLIENTS_KEY] ??= new Map();
  return slot[UPLINK_CLIENTS_KEY];
}

/**
 * Declare a client's identity and record it in the client registry. Returns
 * a frozen handle: stamp it as `owner` on every `registerComponent`/
 * `registerAugment` call the client makes, or call its bound
 * `registerContribution` for the contributions path (auto-stamped, no manual
 * `owner` field needed there).
 *
 * Best-effort on re-declaration under the same id: last-write-wins (a plain
 * `Map.set`), matching `registerUplinkHandle`'s overwrite semantics rather
 * than `registerComponent`'s throw-on-collision. A client's own `uplink.ts`
 * re-evaluating (HMR, a test re-importing the module after `resetModules`)
 * is a benign, common case for a single-owner declaration, there is no
 * cross-package collision risk to guard against the way there is for widget
 * ids shared across a flat namespace.
 */
export function defineUplinkClient(cfg: {
  id: string;
  version: string;
  name: string;
}): UplinkClientHandle {
  const handle: UplinkClientHandle = Object.freeze({
    id: cfg.id,
    version: cfg.version,
    name: cfg.name,
    registerContribution<S extends string>(
      def: Omit<ContributionDefinition<S>, "owner">,
    ): void {
      registerContribution({
        ...def,
        id: `${cfg.id}:${def.id}`,
        owner: handle,
      });
    },
    registerProcessor<const Deps extends readonly Dep[], R>(def: {
      id: string;
      deps: Deps;
      compute: (values: ResolvedDeps<Deps>, frame: ProcessorFrame) => R;
    }): ProcessorHandle<R> {
      return defineProcessor({ ...def, owner: cfg.id });
    },
    registerReckoner<T>(topic: string, reckoner: ReckonerFor<T>): void {
      registerReckoner(topic, cfg.id, reckoner);
    },
    registerDerivedChannel<T>(def: DerivedChannelDefinition<T>): void {
      contributeDerivedChannel(def, cfg.id);
    },
  });
  clients().set(handle.id, handle);
  return handle;
}

/** Reserved handle for built-in (packages/core, packages/components) contributions. */
export const CORE_UPLINK_CLIENT: UplinkClientHandle = defineUplinkClient({
  id: "core",
  version: "0.0.0",
  name: "Gonogo Core",
});

/** Every declared Uplink client, in registration order. */
export function getUplinkClients(): UplinkClientHandle[] {
  return Array.from(clients().values());
}

/** Remove every declared client. For use in tests only. */
export function clearUplinkClients(): void {
  clients().clear();
}
