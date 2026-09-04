import {
  type RevealedEventSourceDefinition,
  registerRevealedEventSource,
} from "../api/event-reveal";
import {
  type RootProviderDefinition,
  registerRootProvider,
} from "../api/root-providers";
import type { ContributionDefinition, ContributionDep } from "../api/types";
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
 * Uplink client identity handles.
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
 * This is the ONE declaration of the handle: `api/types.ts` re-exports it
 * rather than declaring a loose "name+arity probe" copy of its own.
 * `ResolvedDeps`, `ReckonerFor`, `DerivedChannelDefinition` and
 * `ProcessorHandle` are all sdk-side, so there is nothing the leaf cannot name
 * and no reason to reach for `any`. Two
 * declarations of a handle whose methods are typed `any` on one side is the
 * divergence shape that cannot fail loudly, which is the same reason the
 * contribution declaration-merge seam was collapsed to one.
 */
export interface UplinkClientHandle {
  /** MUST match the mod's `[SitrepUplink("<id>")]` id and its gonogo-uplink.json id. */
  id: string;
  /** The Uplink's one version line, spanning mod and client. Phase 1: a
   *  per-client placeholder constant; Phase 2 build-injects it. */
  version: string;
  /** Human label for management/health surfaces. */
  name: string;
  /**
   * What this Uplink does, in one or two sentences.
   *
   * A FIELD rather than a prose file, and the distinction is the whole point. It
   * was a `uplink.md` beside the client, and a markdown file is an invitation to
   * write markdown: the ten in this repo grew install notes, per-widget
   * rationale, and restatements of rules true of every Uplink, none of which
   * belongs on a generated page. A field has a shape and one job.
   *
   * Read by `gonogo-uplink docs` as the page's opening line, and by any
   * management surface listing what is installed. Keep it to what the Uplink
   * does; each widget's own description is on its registration.
   *
   * Optional in the TYPE and required in PRACTICE: `gonogo-uplink docs` refuses
   * to write a page without one. Optional because this interface ships in a
   * published package and a new required field is a breaking change for every
   * consumer already on the old one, and because the enforcement belongs where
   * the field is consumed rather than where a probe harness happens to construct
   * a throwaway handle.
   */
  description?: string;
  /**
   * Register a contribution auto-namespaced to this client: `def.id` is
   * stamped `${this.id}:${def.id}` before it
   * reaches the flat ContributionRegistry, so two Uplinks can never collide
   * on a local id. Throws synchronously at THIS call site (registerContribution's
   * own collision check) on a genuine id clash within one client's own ids.
   */
  /**
   * Mounts a context Provider at the ROOT of every screen's tree, so an
   * Uplink whose widgets share state can establish it without the app
   * importing the Uplink to hand-wire it in.
   *
   * <p>Auto-namespaced like `registerContribution`. The Provider is handed the
   * screen it is mounted for and MUST key any persisted state by it, or a
   * station and the main screen on one machine overwrite each other.</p>
   */
  registerRootProvider(def: RootProviderDefinition): void;

  /**
   * Feeds this Uplink's event occurrences to the `event` alarm trigger.
   *
   * <p>Auto-namespaced like the rest. The reader is handed the operator's
   * DELAYED view UT, not the live one, so returning everything it holds is
   * wrong: return what has been revealed by that instant and the signal delay
   * comes out right for free.</p>
   */
  registerRevealedEventSource(def: RevealedEventSourceDefinition): void;

  registerContribution<
    S extends string,
    const D extends readonly ContributionDep[],
  >(def: Omit<ContributionDefinition<S, D>, "owner">): void;
  /**
   * Register a Processor auto-namespaced to this client (mirrors
   * registerContribution's owner-stamping). `defineProcessor` takes a plain
   * string owner rather than a handle, so this method is the bridge that lets a
   * client call it by handle instead of by hand-typed id.
   */
  registerProcessor<
    const Deps extends readonly Dep[],
    R,
    const Id extends string,
  >(def: {
    id: Id;
    deps: Deps;
    compute: (values: ResolvedDeps<Deps>, frame: ProcessorFrame) => R;
  }): ProcessorHandle<R, `${string}:${Id}`>;
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
  description?: string;
}): UplinkClientHandle {
  const handle: UplinkClientHandle = Object.freeze({
    id: cfg.id,
    version: cfg.version,
    name: cfg.name,
    description: cfg.description,
    registerRootProvider(def: RootProviderDefinition): void {
      registerRootProvider({ ...def, id: `${cfg.id}:${def.id}` });
    },
    registerRevealedEventSource(def: RevealedEventSourceDefinition): void {
      registerRevealedEventSource({ ...def, id: `${cfg.id}:${def.id}` });
    },
    registerContribution<
      S extends string,
      const D extends readonly ContributionDep[],
    >(def: Omit<ContributionDefinition<S, D>, "owner">): void {
      registerContribution({
        ...def,
        id: `${cfg.id}:${def.id}`,
        owner: handle,
      });
    },
    registerProcessor<
      const Deps extends readonly Dep[],
      R,
      const Id extends string,
    >(def: {
      id: Id;
      deps: Deps;
      compute: (values: ResolvedDeps<Deps>, frame: ProcessorFrame) => R;
    }): ProcessorHandle<R, `${string}:${Id}`> {
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
